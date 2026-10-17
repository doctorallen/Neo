'use strict';
// ---------------------------------------------------------------------------
// Everything that flies or lingers: Neo's glyph shots (which pierce, chain,
// home or lob), the processes' packets (always red, nothing else is), and
// hazards on the floor (Trinity's trail, a Volatile elite's blast, the code
// storm's columns). Neo's shots run on real time like Neo; packets and hazards
// run on world time, so Bullet Time leaves them hanging in the air.
// ---------------------------------------------------------------------------

const ENEMY_BULLET = '#ff4060';

function spawnShot(o) {
  const glyph = (Math.random() * 16) | 0;
  Game.shots.push({
    x: o.x, y: o.y, vx: Math.cos(o.a) * o.speed, vy: Math.sin(o.a) * o.speed, speed: o.speed,
    dmg: o.dmg, pierce: o.pierce || 0, chain: o.chain || 0, homing: o.homing || 0, target: o.target || null,
    color: o.color, glyph, life: 1.8, hit: o.hit || new Set(), hop: !!o.hop, small: !!o.small, trail: [],
  });
}

function spawnLob(x, y, tx, ty, dmg, radius, color, kernel) {
  const d = dist(x, y, tx, ty), T_ = clamp(d / 130, 0.25, 0.8);
  Game.shots.push({ lob: true, sx: x, sy: y, tx, ty, x, y, t: 0, T: T_, dmg, radius, color, kernel, glyph: 7, hit: new Set(), trail: [] });
}

// opts: a big packet (the Harvester's) has r, life, and a ring of small
// packets it bursts into when its life runs out or it meets a wall
function spawnBullet(x, y, a, speed, dmg, src, opts = null) {
  if (Game.bullets.length >= bulletCap()) return false;
  // Packet Acceleration, and an Unstable item's drawback
  const s = Game.run && Game.run.stats;
  speed *= 1 + (counterOn('fastpackets') ? 0.2 : 0) + (s ? s.packetSpeed : 0);
  const b = { x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, dmg, src, r: T.enemyBullet.radius, life: 6 };
  if (opts) { Object.assign(b, opts); b.big = true; }
  Game.bullets.push(b);
  return true;
}

function bulletCap() {
  const room = Game.room, boss = room && (room.kind === 'boss' || room.harvester);
  return boss ? T.enemyBullet.maxAliveBoss : T.enemyBullet.maxAlive;
}

// a volley that fits under the cap, or nothing at all (a shooter at the cap skips its turn)
function bulletRoom(n) {
  return Game.bullets.length + n <= bulletCap();
}

// a big packet that didn't land bursts into a ring
function popBullet(b) {
  if (!b.ring) return;
  const a0 = Math.random() * Math.PI * 2;
  for (let i = 0; i < b.ring; i++) spawnBullet(b.x, b.y, a0 + (i / b.ring) * Math.PI * 2, b.ringSpeed, b.ringDmg, b.src);
  spawnRing(b.x, b.y, ENEMY_BULLET, 10);
  Sound.play('enemy_shot', { pitch: 0.7, vol: 0.6 });
}

function updateShots(dt) {
  const room = Game.room;
  for (const s of Game.shots) {
    if (s.dead) continue;
    s.trail.push(s.x, s.y); if (s.trail.length > 6) s.trail.splice(0, 2);
    if (s.lob) { updateLob(s, dt); continue; }
    s.life -= dt;
    if (s.life <= 0) { s.dead = true; continue; }
    if (s.homing && s.target && !s.target.dead) {
      const want = angleTo(s.x, s.y, s.target.x, s.target.y - s.target.h / 2);
      let cur = Math.atan2(s.vy, s.vx);
      let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      cur += clamp(diff, -s.homing * dt, s.homing * dt);
      s.vx = Math.cos(cur) * s.speed; s.vy = Math.sin(cur) * s.speed;
    }
    // move in small steps so nothing is skipped
    const steps = Math.max(1, Math.ceil((s.speed * dt) / 4));
    for (let k = 0; k < steps && !s.dead; k++) {
      s.x += (s.vx * dt) / steps; s.y += (s.vy * dt) / steps;
      if (shotBlocked(room, s.x, s.y)) { s.dead = true; spawnBits(s.x, s.y, s.color, 2); break; }
      for (const e of Game.enemies) {
        if (e.dead || e.spawnT > 0 || s.hit.has(e) || e.untargetable) continue;
        const hx = e.x, hy = e.y - e.h / 2, rr = e.hr + 2;
        const d2 = dist2(s.x, s.y, hx, hy);
        // an agent may sidestep a direct shot as it arrives
        if (!s.hop && e.dodge && d2 < (rr + 10) * (rr + 10) && e.dodge(s)) { s.hit.add(e); continue; }
        if (d2 > rr * rr) continue;
        s.hit.add(e);
        damageEnemy(e, s.dmg, { source: 'shot' });
        spawnBits(s.x, s.y, s.color, 3);
        if (s.chain > 0) chainFrom(s, e);
        if (s.pierce > 0) { s.pierce--; continue; }
        s.dead = true;
        break;
      }
    }
  }
  Game.shots = Game.shots.filter((s) => !s.dead);
}

function chainFrom(s, from) {
  let best = null, bd = Infinity;
  const range = Game.run.stats.weapon.chainRange;
  for (const e of Game.enemies) {
    if (e.dead || e.spawnT > 0 || s.hit.has(e) || e === from || e.untargetable) continue;
    const d = dist(from.x, from.y, e.x, e.y);
    if (d < range && d < bd) { bd = d; best = e; }
  }
  if (!best) return;
  const hx = from.x, hy = from.y - from.h / 2;
  spawnShot({ x: hx, y: hy, a: angleTo(hx, hy, best.x, best.y - best.h / 2), speed: 260, dmg: s.dmg * T.chainDamage, pierce: 0, chain: s.chain - 1, homing: 8, target: best, color: s.color, hit: new Set(s.hit), hop: true, small: true });
}

function updateLob(s, dt) {
  s.t += dt;
  const k = clamp(s.t / s.T, 0, 1);
  s.x = lerp(s.sx, s.tx, k);
  s.y = lerp(s.sy, s.ty, k) - Math.sin(k * Math.PI) * 18;
  if (k >= 1) {
    s.dead = true;
    blast(s.tx, s.ty, s.radius, s.dmg, s.color);
    if (s.kernel) for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + Math.random(), r = 16;
      blast(s.tx + Math.cos(a) * r, s.ty + Math.sin(a) * r, 14, s.dmg * 0.4, s.color, 0.12 * (i + 1));
    }
  }
}

// Area damage to processes (Logic Bomb, Kernel Panic), never dodged.
function blast(x, y, r, dmg, color, delay = 0) {
  Game.hazards.push({ kind: 'blast', x, y, r, dmg, color, delay, t: 0.3, done: false, friendly: true });
}

function updateBullets(dt) {
  const room = Game.room, p = Game.player;
  for (const b of Game.bullets) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; popBullet(b); continue; }
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 3));
    for (let k = 0; k < steps; k++) {
      b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
      if (shotBlocked(room, b.x, b.y)) {
        b.dead = true; spawnBits(b.x, b.y, ENEMY_BULLET, 2);
        // back off the wall a little so the ring isn't born inside it
        if (b.ring) { const v = Math.hypot(b.vx, b.vy) || 1; b.x -= (b.vx / v) * 4; b.y -= (b.vy / v) * 4; popBullet(b); }
        break;
      }
      if (dist2(b.x, b.y, p.x, p.y - 4) < (b.r + 4) * (b.r + 4)) {
        if (p.phaseT > 0) break; // phaseContacts deletes it
        if (damagePlayer(b.dmg, b.src)) b.dead = true;
        else if (p.invulnT > 0) { /* passes through a blinking Neo */ }
        break;
      }
    }
  }
  Game.bullets = Game.bullets.filter((b) => !b.dead);
}

function updateHazards(dt, dtReal) {
  const p = Game.player;
  for (const h of Game.hazards) {
    if (h.dead) continue;
    if (h.kind === 'blast') {
      if (h.delay > 0) { h.delay -= dtReal; continue; }
      if (!h.done) {
        h.done = true;
        Sound.play('explode', { vol: 0.6 });
        for (const e of Game.enemies) if (!e.dead && e.spawnT <= 0 && dist(e.x, e.y - e.h / 2, h.x, h.y) < h.r + e.hr) damageEnemy(e, h.dmg, { source: 'blast' });
        spawnRing(h.x, h.y, h.color, h.r);
      }
      h.t -= dtReal; if (h.t <= 0) h.dead = true;
    } else if (h.kind === 'trail') {
      h.t -= dtReal;
      if (h.t <= 0) { h.dead = true; continue; }
      for (const e of Game.enemies) if (!e.dead && e.spawnT <= 0 && !h.hit.has(e) && dist(e.x, e.y, h.x, h.y) < h.r + e.r) { h.hit.add(e); damageEnemy(e, h.dmg, { source: 'trail', crit: false }); }
    } else if (h.kind === 'volatile') {
      h.t -= dt;
      if (h.t <= 0) {
        h.dead = true;
        Sound.play('explode');
        spawnRing(h.x, h.y, ENEMY_BULLET, h.r);
        if (dist(p.x, p.y - 4, h.x, h.y) < h.r + 3) damagePlayer(h.dmg, 'a volatile process');
        if (Save.settings.shake) Game.shake = Math.max(Game.shake, 2);
      }
    } else if (h.kind === 'storm') {
      h.t += dt;
      const warn = T.boss.stormWarn, rain = T.boss.stormRain;
      if (h.t >= warn && !h.rained) { h.rained = true; Sound.play('glitch', { vol: 0.5 }); }
      if (h.t >= warn && h.t < warn + rain && p.x >= h.x0 && p.x < h.x1) damagePlayer(h.dmg, 'the code storm');
      if (h.t >= warn + rain) h.dead = true;
    } else if (h.kind === 'beam') {
      updateBeam(h, dt);
    } else if (h.kind === 'lane') {
      h.t -= dt; if (h.t <= 0) h.dead = true;
    }
  }
  Game.hazards = Game.hazards.filter((h) => !h.dead);
}
