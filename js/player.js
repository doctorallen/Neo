'use strict';
// ---------------------------------------------------------------------------
// Neo: moving, hacking (auto-firing at the nearest process while standing
// still), Phase (the glitch-dash), Bullet Time, and taking hits. Neo runs on
// real time: during Bullet Time the world slows and he doesn't.
// ---------------------------------------------------------------------------

function makePlayer() {
  return {
    isPlayer: true, x: 0, y: 0, r: T.player.radius, vx: 0, vy: 0, facing: 1,
    stillT: 0, moveT: 0, fireT: 0, shotCount: 0, echoT: -1, echoTarget: null,
    phaseT: 0, phaseDir: [0, 0], phaseCdT: 0, phaseHits: null, phaseDropped: false,
    invulnT: 0, hurtT: 0, anim: 0, walkT: 0, coat: true, daemonA: 0, daemonT: 0,
    afterimages: [], hidden: false, regenAcc: 0,
  };
}

// The nearest live process Neo can see; failing that, the nearest at all.
function chooseTarget(p) {
  let best = null, bd = Infinity, bestSeen = null, bsd = Infinity;
  for (const e of Game.enemies) {
    if (e.dead || e.spawnT > 0 || e.untargetable) continue;
    const d = dist2(p.x, p.y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
    if (d < bsd && lineOfSight(Game.room, p.x, p.y - 6, e.x, e.y - e.h / 2)) { bsd = d; bestSeen = e; }
  }
  return bestSeen || best;
}

function updatePlayer(dt) {
  const p = Game.player, run = Game.run, s = run && run.stats;
  p.anim += dt;
  p.invulnT = Math.max(0, p.invulnT - dt);
  p.hurtT = Math.max(0, p.hurtT - dt);
  p.phaseCdT = Math.max(0, p.phaseCdT - dt);
  for (const a of p.afterimages) a.t -= dt;
  p.afterimages = p.afterimages.filter((a) => a.t > 0);

  // moving
  const mv = Input.move;
  const moving = Input.moving();
  const speed = T.player.speed * (1 + (s ? s.speed : 0));
  if (p.phaseT > 0) {
    const step = Math.min(dt, p.phaseT);
    p.phaseT -= step;
    const v = T.player.phaseDist / T.player.phaseTime;
    moveEntity(p, p.phaseDir[0] * v * step, p.phaseDir[1] * v * step);
    p.afterimages.push({ x: p.x, y: p.y, t: 0.25, f: p.facing });
    if (run) phaseContacts(p, s);
  } else if (moving) {
    p.vx = mv.x * speed; p.vy = mv.y * speed;
    moveEntity(p, p.vx * dt, p.vy * dt);
    if (Math.abs(mv.x) > 0.15) p.facing = mv.x > 0 ? 1 : -1;
    p.walkT += dt * (0.6 + Math.hypot(mv.x, mv.y));
  } else { p.vx = 0; p.vy = 0; }
  if (moving || p.phaseT > 0) { p.stillT = 0; p.moveT += dt; } else { p.stillT += dt; p.moveT = 0; }

  if (Game.scene !== 'run' || !run) return;

  // Phase
  const ph = Input.consumePhase();
  if (ph && p.phaseCdT <= 0 && p.phaseT <= 0) startPhase(p, s, ph);

  // Bullet Time
  if (Input.consumeFocus()) tryBulletTime();

  // regeneration (Blue Pill)
  if (s.powers.bluepill && run.hp < s.maxHp && !Game.flow) { p.regenAcc += dt; if (p.regenAcc >= 0.5) { healPlayer(0.5, false); p.regenAcc -= 0.5; } }

  // the Daemon patch: a drone that orbits and fires on its own
  if (s.powers.daemon) updateDaemon(p, s, dt);

  // hacking
  const bt = !!Game.bt;
  const canFire = bt || Save.settings.fireWhileMoving || (!moving && p.phaseT <= 0 && p.stillT >= T.player.fireDelay);
  const target = Game.enemies.length ? chooseTarget(p) : null;
  if (target && canFire && !Game.flow) {
    if (target.x !== p.x) p.facing = target.x > p.x ? 1 : -1;
    const compiling = p.stillT >= T.player.compileAfter && !bt;
    const rate = s.weapon.rate * (bt ? T.focus.fireRate : 1) * (compiling ? 1 + T.player.compileRate : 1);
    p.fireT -= dt;
    if (p.fireT <= 0) {
      const movingShot = moving && !bt;
      fireExploit(p, s, target, movingShot ? T.player.movingDamage : 1);
      p.fireT += 1 / rate;
      if (p.fireT < 0) p.fireT = 0;
      if (s.powers.echo && run.rng.chance(0.2)) { p.echoT = 0.07; p.echoTarget = target; p.echoMult = movingShot ? T.player.movingDamage : 1; }
    }
    p.firing = true;
  } else {
    p.firing = false;
    // ready to fire the moment Neo stops
    p.fireT = Math.min(p.fireT, 0.02);
  }
  if (p.echoT >= 0) {
    p.echoT -= dt;
    if (p.echoT < 0 && p.echoTarget && !p.echoTarget.dead) fireExploit(p, s, p.echoTarget, p.echoMult, true);
  }
}

function startPhase(p, s, dir) {
  let [dx, dy] = dir;
  const m = Math.hypot(dx, dy);
  if (m < 0.01) { dx = p.facing; dy = 0; } else { dx /= m; dy /= m; }
  p.phaseDir = [dx, dy];
  p.phaseT = T.player.phaseTime;
  p.invulnT = Math.max(p.invulnT, T.player.phaseInvuln);
  p.phaseCdT = s.phaseCd;
  p.phaseHits = new Set();
  p.phaseDropped = false;
  if (Math.abs(dx) > 0.2) p.facing = dx > 0 ? 1 : -1;
  Sound.play('phase');
  buzz(6);
  UI.hintDone('phase');
  if (s.powers.trinity) p.trailFrom = { x: p.x, y: p.y };
}

// While phasing: enemy packets in the way are deleted, and with Glitch Step
// the processes passed through are hurt. Trinity's Wake lays a trail.
function phaseContacts(p, s) {
  const run = Game.run;
  for (const b of Game.bullets) {
    if (b.dead) continue;
    if (dist2(b.x, b.y, p.x, p.y - 4) < 81) {
      b.dead = true;
      if (!Game.bt) run.focus = Math.min(T.focus.max, run.focus + T.player.phaseBulletFocus);
      spawnBits(b.x, b.y, '#ff4060', 4);
      if (!p.phaseDropped) { p.phaseDropped = true; Sound.play('packet_drop'); UI.feed('> packet dropped'); }
    }
  }
  if (s.powers.glitchstep) {
    for (const e of Game.enemies) {
      if (e.dead || e.spawnT > 0 || p.phaseHits.has(e)) continue;
      if (dist(e.x, e.y, p.x, p.y) < e.r + 8) { p.phaseHits.add(e); damageEnemy(e, 40 * flatScale(), { crit: false, source: 'glitch' }); }
    }
  }
  if (s.powers.trinity && p.trailFrom && dist(p.trailFrom.x, p.trailFrom.y, p.x, p.y) > 6) {
    Game.hazards.push({ kind: 'trail', x: p.x, y: p.y - 3, r: 7, t: 1.4, dmg: 20 * flatScale(), hit: new Set(), friendly: true });
    p.trailFrom = { x: p.x, y: p.y };
  }
}

// Flat damage numbers keep pace with the processes' integrity.
function flatScale() {
  const r = Game.run;
  return r ? T.enemyHp(r.floorN || 1, r.depth || 1) : 1;
}

function tryBulletTime() {
  const run = Game.run;
  if (!run || Game.bt || run.focus < T.focus.max) return false;
  startBulletTime(false);
  return true;
}

function startBulletTime(free) {
  const run = Game.run;
  const dur = T.focus.duration * (run.stats.powers.morpheus ? 2 : 1);
  Game.bt = { left: dur, total: dur };
  if (!free) run.focus = 0;
  Sound.play('focus_on');
  Sound.setBulletTime(true);
  buzz(30);
  UI.hintDone('focus');
  UI.feed('> bullet time');
}

// Ends Bullet Time at once (a new floor, death, the end of a run), sound and all.
function endBulletTime() {
  if (Game.bt) Sound.setBulletTime(false);
  Game.bt = null;
  Game.timeScale = 1;
}

function updateBulletTime(dtReal) {
  if (!Game.bt) { Game.timeScale = approach(Game.timeScale, 1, dtReal * 4); return; }
  const b = Game.bt;
  b.left -= dtReal;
  const ramp = T.focus.rampOut;
  Game.timeScale = b.left > ramp ? T.focus.worldScale : lerp(1, T.focus.worldScale, clamp(b.left / ramp, 0, 1));
  if (b.left <= 0) {
    Game.bt = null; Game.timeScale = 1;
    Sound.play('focus_off');
    Sound.setBulletTime(false);
  }
}

// ---------------------------------------------------------------------------
// Firing. Every exploit fires glyphs from Neo's hands; the pattern decides how
// many and how they fly. Extra projectiles deal 60% each.
// ---------------------------------------------------------------------------
function fireExploit(p, s, target, mult = 1, echo = false) {
  const run = Game.run, w = s.weapon;
  const ox = p.x + p.facing * 4, oy = p.y - 7;
  const tx = target.x, ty = target.y - (target.h || 8) / 2;
  const ang = angleTo(ox, oy, tx, ty);
  const dmg = w.dmg * mult;
  const exploit = run.gear.exploit;
  const color = exploit ? (exploit.rarity === 0 ? '#b8ffc8' : T.rarity.colors[exploit.rarity]) : '#b8ffc8';
  const extra = s.proj, xd = T.extraProjDamage;
  const homing = w.pattern === 'homing' ? 5 : s.powers.spoon ? 2 : 0;
  const mk = (a, d, o = {}) => spawnShot({ x: ox, y: oy, a, speed: w.speed, dmg: d, pierce: w.pierce, chain: w.chain, homing, target, color, ...o });
  p.shotCount++;
  const loader = exploit && exploit.unique === 'loader' && p.shotCount % 4 === 0 && !echo;
  if (w.pattern === 'lob') {
    spawnLob(ox, oy, tx, ty, dmg, w.radius, color, exploit && exploit.unique === 'kernel');
    for (let i = 1; i <= extra; i++) {
      const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 16;
      spawnLob(ox, oy, tx + Math.cos(ang + Math.PI / 2) * off, ty + Math.sin(ang + Math.PI / 2) * off, dmg * xd, w.radius, color, false);
    }
  } else if (w.pattern === 'spread') {
    const n = w.shots + extra, step = (w.spread * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a = ang + (i - (n - 1) / 2) * step;
      mk(a, i < w.shots ? dmg : dmg * xd);
    }
  } else {
    mk(ang, dmg);
    for (let i = 1; i <= extra; i++) {
      const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (8 * Math.PI / 180);
      mk(ang + off, dmg * xd);
    }
  }
  if (loader) for (let i = 0; i < 5; i++) mk(ang + (i - 2) * (10 * Math.PI / 180), dmg * 0.7);
  const shotSound = { packet: 'key', fork: 'shot_fork', overflow: 'shot_overflow', worm: 'shot_worm', rootkit: 'shot_rootkit', logic: 'shot_logic' }[w.base] || 'key';
  Sound.play(shotSound, { vol: 0.5, pitch: 0.9 + Math.random() * 0.2 });
}

function updateDaemon(p, s, dt) {
  p.daemonA += dt * 2.4;
  p.daemonT -= dt;
  const dx = p.x + Math.cos(p.daemonA) * 14, dy = p.y - 8 + Math.sin(p.daemonA) * 8;
  p.daemon = { x: dx, y: dy };
  if (p.daemonT <= 0 && Game.enemies.length && !Game.flow) {
    const t = chooseTarget({ x: dx, y: dy + 6 });
    if (t) {
      spawnShot({ x: dx, y: dy, a: angleTo(dx, dy, t.x, t.y - t.h / 2), speed: 170, dmg: 8 * flatScale() * (1 + s.dmg), pierce: 0, chain: 0, homing: 0, target: t, color: '#8cffb0', small: true });
      p.daemonT = 1 / 1.5;
    }
  }
}

// ---------------------------------------------------------------------------
// Taking hits
// ---------------------------------------------------------------------------
function damagePlayer(amount, source) {
  const run = Game.run, p = Game.player;
  if (!run || run.ended || Game.flow || Game.debug.god || p.invulnT > 0 || amount <= 0) return false;
  const s = run.stats, room = Game.room;
  if (s.powers.encryption && !room.encryptionUsed) {
    room.encryptionUsed = true;
    p.invulnT = T.player.hurtInvuln;
    Sound.play('shield');
    spawnRing(p.x, p.y - 6, '#4aa8ff');
    UI.feed('> encryption held');
    return false;
  }
  const dmg = Math.max(1, Math.round(amount * (1 - s.armor)));
  run.hp -= dmg;
  p.invulnT = T.player.hurtInvuln;
  p.hurtT = 0.25;
  addFloat(p.x, p.y - 18, '-' + dmg, '#ff5a6a');
  Sound.play('hurt');
  buzz(12);
  if (Save.settings.shake) Game.shake = Math.max(Game.shake, 3);
  if (!Save.settings.reducedFlash) { Game.glitch = Math.max(Game.glitch, 0.12); flashScreen('#ff2040', 0.25); }
  UI.hint('phase-hurt');
  // Thorns: whatever is close takes it back
  if (s.thorns > 0) for (const e of Game.enemies) if (!e.dead && e.spawnT <= 0 && dist(e.x, e.y, p.x, p.y) < 20 + e.r) damageEnemy(e, s.thorns * flatScale(), { source: 'thorns' });
  // the Nebuchadnezzar Coil
  if (s.powers.coil && !room.coilUsed && run.hp > 0 && run.hp < s.maxHp * 0.3) {
    room.coilUsed = true;
    for (const e of Game.enemies) if (!e.dead && e.spawnT <= 0) damageEnemy(e, 60 * flatScale(), { source: 'emp' });
    spawnRing(p.x, p.y - 6, '#8cffb0', 90);
    Sound.play('explode');
    UI.feed('> EMP discharged');
  }
  if (run.hp <= 0) {
    if (s.powers.onecoat && run.oneCoatFloor !== run.floorN) {
      run.oneCoatFloor = run.floorN;
      run.hp = 1;
      p.invulnT = 1.0;
      startBulletTime(true);
      UI.feed('> not like this.');
      return true;
    }
    if (Save.rank('revive') && !run.reviveUsed) {
      run.reviveUsed = true;
      run.hp = Math.round(s.maxHp * 0.4);
      p.invulnT = 1.5;
      Game.bullets = [];
      spawnRing(p.x, p.y - 6, '#ffffff', 60);
      Sound.play('glitch');
      UI.feed('> déjà vu.');
      UI.banner('DÉJÀ VU');
      return true;
    }
    run.hp = 0;
    run.killedBy = source || 'unknown process';
    playerDies();
  }
  return true;
}

function healPlayer(n, show = true) {
  const run = Game.run;
  if (!run || n <= 0) return;
  const before = run.hp;
  run.hp = Math.min(run.stats.maxHp, run.hp + n);
  const got = run.hp - before;
  if (show && got >= 1) addFloat(Game.player.x, Game.player.y - 18, '+' + Math.round(got), '#3cff6e');
}

function playerDies() {
  if (Game.flow) return;
  Game.flow = { kind: 'death', t: 0 };
  endBulletTime();
  Sound.play('death');
  Sound.heartbeat(false);
  Game.glitch = 1;
  UI.feed('> CONNECTION LOST');
}
