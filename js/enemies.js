'use strict';
// ---------------------------------------------------------------------------
// Processes: the things that guard each room. A fight is planned from the
// room's seed (waves of enemies within the floor's budget and caps), each
// process glitches into being at a spawn point after a telegraph, and then
// runs its little state machine. Every attack has a tell of at least 0.4 s,
// nothing attacks in its first second, and nothing out of view attacks at all.
// ---------------------------------------------------------------------------

const ENEMY_NAMES = { bug: 'bug', watchdog: 'watchdog.d', firewall: 'firewall.sys', sentinel: 'sentinel', worm: 'worm', exile: 'exile.exe', agent: 'agent', boss: 'agent', clone: 'agent' };
const ELITE_NAMES = { sentinel: 'hypnos.d', worm: 'rem_cycle' };
const MOD_NAMES = { encrypted: 'ENCRYPTED', overclocked: 'OVERCLOCKED', replicating: 'REPLICATING', volatile: 'VOLATILE' };
// collision radius r (at the feet), body height h, hurt radius hr
const BODY = {
  bug: { r: 3, h: 5, hr: 4 }, watchdog: { r: 5, h: 7, hr: 5 }, firewall: { r: 6, h: 10, hr: 6 }, sentinel: { r: 5, h: 10, hr: 6 },
  worm: { r: 4, h: 5, hr: 4 }, exile: { r: 4, h: 13, hr: 5 }, agent: { r: 4, h: 15, hr: 5 }, boss: { r: 5, h: 17, hr: 6 }, clone: { r: 4, h: 15, hr: 5 },
};
const SPAWN_WEIGHT = { bug: 3, watchdog: 3, firewall: 2, sentinel: 2.5, worm: 2, exile: 1.5 };

function makeEnemy(type, x, y, opts = {}) {
  const run = Game.run, n = run.floorN, d = run.depth;
  const base = T.enemies[type] || (type === 'agent' ? T.agent : type === 'boss' ? T.boss : T.agent);
  const body = BODY[type] || BODY.agent;
  const spoon = run.spoonFloor === n ? 1.1 : 1;
  const hp = (opts.hp || base.hp) * (type === 'boss' ? (1 + T.depth.hp * (d - 1)) : T.enemyHp(n, d)) * spoon;
  const e = {
    type, x, y, r: body.r, h: body.h, hr: body.hr, hp, maxHp: hp,
    dmg: (opts.dmg || base.dmg) * T.enemyDmg(n, d), speed: base.speed || 0,
    elite: false, mods: [], shield: 0, shieldMax: 0, rate: 1,
    name: ENEMY_NAMES[type] || type, pid: ++Game.pid,
    state: 'idle', stateT: 0, attackT: 0, spawnT: opts.instant ? 0 : T.spawnTelegraph, graceT: T.spawnGrace,
    flashT: 0, slowT: 0, rot: 0, facing: 1, anim: Math.random() * 4, aim: 0, small: !!opts.small,
    flies: type === 'sentinel', ranged: !!base.ranged || type === 'agent' || type === 'boss' || type === 'clone',
    isAgent: type === 'agent' || type === 'boss' || type === 'clone', isBoss: type === 'boss',
    seg: [], dodgeT: 0, dead: false, deadT: 0, wave: opts.wave || 0,
  };
  if (e.small) { e.r = 3; e.h = 4; e.hr = 3; }
  if (type === 'firewall') e.attackT = 1.0 + Math.random() * 0.8;
  if (type === 'exile') e.attackT = 1.2 + Math.random();
  if (type === 'sentinel') { e.attackT = 1.5 + Math.random(); e.orbitDir = Math.random() < 0.5 ? 1 : -1; }
  if (e.isAgent) setupAgent(e);
  return e;
}

function makeElite(e, rng, nMods) {
  e.elite = true;
  e.maxHp *= T.elite.hp; e.hp = e.maxHp; e.dmg *= T.elite.dmg;
  const pool = T.elite.mods.filter((m) => !(m === 'replicating' && (e.type === 'bug' || e.type === 'worm')));
  rng.shuffle(pool);
  e.mods = pool.slice(0, nMods);
  if (e.mods.includes('encrypted')) { e.shieldMax = e.maxHp * T.elite.shield; e.shield = e.shieldMax; }
  if (e.mods.includes('overclocked')) { e.speed *= T.elite.fast; e.rate = T.elite.fast; }
  e.name = `${MOD_NAMES[e.mods[0]]} ${ELITE_NAMES[e.type] || ENEMY_NAMES[e.type]}`;
}

// ---------------------------------------------------------------------------
// Planning a fight
// ---------------------------------------------------------------------------
function planWaves(room) {
  const run = Game.run, n = run.floorN, rng = new Rng(hashInts(room.seed, 99));
  const recipe = T.floors[n - 1], cap = recipe.alive;
  const types = Object.keys(T.enemies).filter((k) => T.enemies[k].from <= n);
  const fill = (budget, limit) => {
    const out = [];
    let ranged = 0;
    while (budget > 0 && out.length < limit) {
      const ok = types.filter((t) => T.enemies[t].cost <= budget && (!T.enemies[t].ranged || ranged < T.maxRanged));
      if (!ok.length) break;
      const t = rng.weighted(ok.map((k) => [SPAWN_WEIGHT[k], k]));
      out.push(t);
      budget -= T.enemies[t].cost;
      if (T.enemies[t].ranged) ranged++;
    }
    return out;
  };
  const B = T.budget(n);
  const plan = { waves: [], elite: false, eliteMods: n >= 4 ? 2 : 1 };
  if (room.kind === 'boss') { plan.waves = [['boss']]; return plan; }
  if (room.tutorial) { plan.waves = [['bug', 'bug', 'bug'], ['firewall']]; return plan; }
  if (room.kind === 'exit' && n >= 3) {
    plan.waves = [['agent', ...fill(n === 3 ? 3 : 6, n === 3 ? 2 : 3).filter((t) => !T.enemies[t].ranged || t === 'firewall').slice(0, n === 3 ? 2 : 3)]];
    if (n >= 4) plan.waves.push(fill(Math.round(B * T.secondWave), cap));
    return plan;
  }
  plan.waves.push(fill(B, cap));
  if (room.size === 'large' || room.kind === 'exit') plan.waves.push(fill(Math.round(B * T.secondWave), cap));
  plan.elite = room.kind === 'exit' || rng.chance(T.elite.chance(n));
  plan.waves = plan.waves.filter((w) => w.length);
  return plan;
}

function beginFight(room) {
  const plan = planWaves(room);
  room.fight = { plan, wave: -1, startT: 0.45, waveCount: 0, killedInWave: 0, total: plan.waves.reduce((a, w) => a + w.length, 0) };
  Sound.play('door_seal');
  Sound.setTension(1);
  UI.feed(`> scan: ${room.fight.total} process${room.fight.total === 1 ? '' : 'es'}`);
  if (room.kind === 'boss') bossIntro(room);
}

function updateFight(dt) {
  const room = Game.room, f = room && room.fight;
  if (!f || room.cleared) return;
  if (f.wave < 0) {
    if (room.kind === 'boss' && room.introT > 0) { room.introT -= dt; return; }
    f.startT -= dt;
    // the very first fight waits for Neo to move (or three seconds), so the
    // first hint has a moment to land
    if (room.tutorial && !f.moved) { f.moved = Game.player.moveT > 0 || f.startT < -3; if (!f.moved) return; }
    if (f.startT <= 0) spawnWave(room, 0);
    return;
  }
  const alive = Game.enemies.filter((e) => !e.dead).length;
  const next = f.wave + 1;
  if (next < f.plan.waves.length) {
    const inWave = f.waveCount, killed = f.killedInWave;
    if (alive === 0 || (inWave > 0 && killed / inWave >= T.secondWaveAt)) spawnWave(room, next);
  } else if (alive === 0 && !Game.enemies.some((e) => e.pending)) {
    clearRoom(room);
  }
  // the soft-lock failsafe: nothing hurt for a long while, nothing in sight
  Game.idleT = (Game.idleT || 0) + dt;
  if (Game.idleT > T.failsafe.idle) {
    Game.idleT = 0;
    for (const e of Game.enemies) {
      if (e.dead || e.isBoss) continue;
      const pt = spawnPoint(room, Game.run.rng, []);
      if (pt) { e.x = pt.x; e.y = pt.y; e.spawnT = T.spawnTelegraph; e.graceT = T.spawnGrace; }
    }
  }
}

function spawnWave(room, i) {
  const f = room.fight, run = Game.run;
  f.wave = i; f.waveCount = f.plan.waves[i].length; f.killedInWave = 0;
  const taken = [];
  let eliteDone = !f.plan.elite || i > 0;
  for (const type of f.plan.waves[i]) {
    if (type === 'boss') { spawnBoss(room); continue; }
    const pt = spawnPoint(room, run.rng, taken) || room.centre();
    taken.push(pt);
    const e = makeEnemy(type, pt.x, pt.y, { wave: i });
    if (!eliteDone && type !== 'agent') { makeElite(e, run.rng, f.plan.eliteMods); eliteDone = true; }
    Game.enemies.push(e);
  }
  Sound.play('spawn');
  if (i === 0) { UI.hint('aim'); if (room.tutorial) $('aim-ghost').hidden = !!Input.aimStick; }
}

// Somewhere to materialise: on open floor, in view, away from Neo, the doors
// and the other spawns. The rules relax if a cramped room can't meet them.
function spawnPoint(room, rng, taken) {
  const p = Game.player;
  const doorNear = (tx, ty) => Object.keys(room.doors).some((d) => room.doorCells(d).some(([cx, cy]) => Math.abs(cx - tx) + Math.abs(cy - ty) <= 2));
  const propNear = (tx, ty) => room.props.some((q) => Math.abs(q.tx - tx) <= 1 && Math.abs(q.ty - ty) <= 1);
  for (const [minD, gap, view] of [[T.spawnMinDist, 20, true], [T.spawnMinDist, 12, true], [40, 8, true], [32, 0, false]]) {
    const pt = randomFloorPoint(room, rng, (x, y, tx, ty) =>
      dist(x, y, p.x, p.y) >= minD && !doorNear(tx, ty) && !propNear(tx, ty) &&
      (!view || onScreen(x, y, -10)) && taken.every((q) => dist(q.x, q.y, x, y) >= gap), 120);
    if (pt) return pt;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------
function updateEnemies(dt) {
  const p = Game.player, room = Game.room, run = Game.run;
  const slowAll = run.stats.powers.packetloss ? 0.85 : 1;
  for (const e of Game.enemies) {
    if (e.dead) { e.deadT += dt; continue; }
    e.anim += dt;
    e.flashT = Math.max(0, e.flashT - dt);
    e.dodgeT = Math.max(0, e.dodgeT - dt);
    if (e.spawnT > 0) { e.spawnT -= dt; if (e.spawnT <= 0) e.spawnT = 0; continue; }
    e.graceT = Math.max(0, e.graceT - dt);
    if (e.rot > 0.5) {
      const d = Math.max(e.rot * dt, Math.min(e.rot, 2 * dt));
      e.rot -= d;
      e.hp -= d;
      if (e.hp <= 0) { killEnemy(e); continue; }
    }
    let slow = slowAll;
    if (e.slowT > 0) { e.slowT -= dt; slow *= e.isBoss ? 1 - T.caps.slow / 2 : 1 - T.caps.slow * 0.8; }
    // all slows together never pass the cap (half of it on bosses)
    slow = Math.max(slow, 1 - (e.isBoss ? T.caps.slow / 2 : T.caps.slow));
    const edt = dt * e.rate; // attack timers run faster when overclocked
    const canAttack = e.graceT <= 0 && onScreen(e.x, e.y - e.h / 2, -2) && !Game.flow;
    const mdt = dt * slow;
    switch (e.type) {
      case 'bug': aiBug(e, p, mdt); break;
      case 'watchdog': aiWatchdog(e, p, mdt, edt, canAttack); break;
      case 'firewall': aiFirewall(e, p, edt, canAttack); break;
      case 'sentinel': aiSentinel(e, p, mdt, edt, canAttack); break;
      case 'worm': aiWorm(e, p, mdt); break;
      case 'exile': aiExile(e, p, edt, canAttack); break;
      case 'agent': case 'clone': aiAgent(e, p, mdt, edt, canAttack); break;
      case 'boss': aiBoss(e, p, mdt, edt, canAttack); break;
    }
    // stuck inside something solid (a teleport gone wrong): out to the nearest floor
    if (circleBlocked(room, e.x, e.y, e.r * 0.6, e)) {
      const f = nearestFloor(room, e.x / TILE, e.y / TILE);
      if (f) { e.x = (f[0] + 0.5) * TILE; e.y = (f[1] + 0.5) * TILE; }
    }
    // contact
    if (e.graceT <= 0 && e.type !== 'firewall' && e.type !== 'exile' && dist2(e.x, e.y, p.x, p.y) < (e.r + p.r + 1) ** 2) {
      const dmg = e.state === 'charge' ? e.dmg * 1.3 : e.dmg;
      damagePlayer(dmg, e.name);
    }
  }
  // processes don't stack on top of each other
  const live = Game.enemies.filter((e) => !e.dead && e.spawnT <= 0 && e.type !== 'firewall');
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j], min = a.r + b.r;
      const d2 = dist2(a.x, a.y, b.x, b.y);
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2), push = (min - d) / 2, nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
        moveEntity(a, nx * push, ny * push); moveEntity(b, -nx * push, -ny * push);
      }
    }
  Game.enemies = Game.enemies.filter((e) => !e.dead || e.deadT < 0.6);
}

function walkToward(e, dt, speed) {
  const [dx, dy] = flowDir(e);
  moveEntity(e, dx * speed * dt, dy * speed * dt);
  if (Math.abs(dx) > 0.1) e.facing = dx > 0 ? 1 : -1;
}

function aiBug(e, p, dt) {
  const [dx, dy] = flowDir(e);
  const wob = Math.sin(e.anim * 9 + e.pid) * 0.6;
  moveEntity(e, (dx - dy * wob) * e.speed * dt, (dy + dx * wob) * e.speed * dt);
  if (Math.abs(dx) > 0.1) e.facing = dx > 0 ? 1 : -1;
}

function aiWatchdog(e, p, dt, edt, canAttack) {
  const S = T.enemies.watchdog;
  e.stateT -= edt;
  if (e.state === 'idle' || e.state === 'approach') {
    e.state = 'approach';
    walkToward(e, dt, e.speed);
    if (canAttack && dist(e.x, e.y, p.x, p.y) < S.tellRange && lineOfSight(Game.room, e.x, e.y - 4, p.x, p.y - 4)) {
      e.state = 'tell'; e.stateT = S.tell; Sound.play('tell', { vol: 0.5 });
    }
  } else if (e.state === 'tell') {
    if (e.stateT > S.aimLock) { e.aim = angleTo(e.x, e.y, p.x, p.y); e.facing = Math.cos(e.aim) >= 0 ? 1 : -1; }
    if (e.stateT <= 0) { e.state = 'dash'; e.stateT = S.dashTime; Sound.play('dash', { vol: 0.6 }); }
  } else if (e.state === 'dash') {
    const bumped = moveEntity(e, Math.cos(e.aim) * S.dashSpeed * dt, Math.sin(e.aim) * S.dashSpeed * dt);
    if (e.stateT <= 0 || bumped) { e.state = 'rest'; e.stateT = S.rest; }
  } else if (e.state === 'rest') {
    if (e.stateT <= 0) e.state = 'approach';
  }
}

function aiFirewall(e, p, edt, canAttack) {
  const S = T.enemies.firewall;
  e.facing = p.x >= e.x ? 1 : -1;
  if (e.state === 'tell') {
    e.stateT -= edt;
    if (e.stateT <= 0) {
      e.state = 'idle';
      e.attackT = S.every - S.tell;
      if (bulletRoom(S.shots)) {
        const a = angleTo(e.x, e.y - 7, p.x, p.y - 4);
        for (let i = 0; i < S.shots; i++) spawnBullet(e.x, e.y - 7, a + (i - (S.shots - 1) / 2) * (S.fan * Math.PI / 180), S.bullet, e.dmg, e.name);
        Sound.play('enemy_shot', { vol: 0.6 });
      }
    }
    return;
  }
  e.attackT -= edt;
  if (e.attackT <= 0 && canAttack && lineOfSight(Game.room, e.x, e.y - 7, p.x, p.y - 4)) { e.state = 'tell'; e.stateT = S.tell; }
  else if (e.attackT <= 0) e.attackT = 0.3;
}

function aiSentinel(e, p, dt, edt, canAttack) {
  const S = T.enemies.sentinel;
  if (e.state === 'tell') {
    e.stateT -= edt;
    if (e.stateT > S.aimLock) e.aim = angleTo(e.x, e.y, p.x, p.y);
    if (e.stateT <= 0) { e.state = 'lunge'; e.stateT = S.lungeTime; Sound.play('dash', { vol: 0.5, pitch: 1.3 }); }
    return;
  }
  if (e.state === 'lunge') {
    e.stateT -= edt;
    const bumped = moveEntity(e, Math.cos(e.aim) * S.lungeSpeed * dt, Math.sin(e.aim) * S.lungeSpeed * dt);
    if (e.stateT <= 0 || bumped) { e.state = 'idle'; e.attackT = S.every; }
    return;
  }
  // orbit: round Neo at a distance, closing or opening the gap
  const d = dist(e.x, e.y, p.x, p.y), a = angleTo(p.x, p.y, e.x, e.y);
  let vx, vy;
  if (!lineOfSight(Game.room, e.x, e.y, p.x, p.y) || d > S.orbit * 1.8) {
    [vx, vy] = flowDir(e);
  } else {
    const radial = clamp((d - S.orbit) / 30, -1, 1);
    vx = -Math.cos(a) * radial + -Math.sin(a) * e.orbitDir * 0.8;
    vy = -Math.sin(a) * radial + Math.cos(a) * e.orbitDir * 0.8;
    const m = Math.hypot(vx, vy) || 1; vx /= m; vy /= m;
  }
  if (moveEntity(e, vx * e.speed * dt, vy * e.speed * dt)) e.orbitDir *= -1;
  e.facing = p.x >= e.x ? 1 : -1;
  e.attackT -= edt;
  if (e.attackT <= 0 && canAttack && d < S.orbit * 1.6) { e.state = 'tell'; e.stateT = S.tell; Sound.play('tell', { vol: 0.5, pitch: 1.2 }); }
  else if (e.attackT <= 0) e.attackT = 0.3;
}

function aiWorm(e, p, dt) {
  const [dx, dy] = flowDir(e);
  const wig = Math.sin(e.anim * 5 + e.pid) * 0.7;
  moveEntity(e, (dx - dy * wig) * e.speed * dt * (e.small ? 1.4 : 1), (dy + dx * wig) * e.speed * dt * (e.small ? 1.4 : 1));
  if (Math.abs(dx) > 0.1) e.facing = dx > 0 ? 1 : -1;
  // the body follows the head
  const last = e.seg[0];
  if (!last || dist(last.x, last.y, e.x, e.y) > 3) { e.seg.unshift({ x: e.x, y: e.y }); if (e.seg.length > (e.small ? 6 : 12)) e.seg.pop(); }
}

function aiExile(e, p, edt, canAttack) {
  const S = T.enemies.exile;
  e.facing = p.x >= e.x ? 1 : -1;
  if (e.state === 'flicker') {
    e.stateT -= edt;
    if (e.stateT <= 0) {
      spawnBits(e.x, e.y - 6, '#b48cff', 6);
      e.x = e.dest.x; e.y = e.dest.y; e.dest = null;
      e.state = 'windup'; e.stateT = S.windup;
      Sound.play('teleport', { vol: 0.6 });
    }
    return;
  }
  if (e.state === 'windup') {
    e.stateT -= edt;
    if (e.stateT <= 0) {
      e.state = 'idle'; e.attackT = S.every;
      if (canAttack && bulletRoom(S.shots)) {
        const a = angleTo(e.x, e.y - 8, p.x, p.y - 4);
        for (let i = 0; i < S.shots; i++) spawnBullet(e.x, e.y - 8, a + (i / (S.shots - 1) - 0.5) * (S.fan * Math.PI / 180), S.bullet, e.dmg, e.name);
        Sound.play('enemy_shot', { vol: 0.6, pitch: 0.8 });
      }
    }
    return;
  }
  e.attackT -= edt;
  if (e.attackT <= 0 && canAttack) {
    const dest = randomFloorPoint(Game.room, Game.run.rng, (x, y) => dist(x, y, p.x, p.y) >= S.minDist && onScreen(x, y, -12) && dist(x, y, e.x, e.y) > 24);
    if (dest) { e.dest = dest; e.state = 'flicker'; e.stateT = S.flicker; }
    else e.attackT = 0.5;
  } else if (e.attackT <= 0) e.attackT = 0.4;
}

// ---------------------------------------------------------------------------
// Damage and death
// ---------------------------------------------------------------------------
function damageEnemy(e, dmg, opts = {}) {
  if (e.dead || e.spawnT > 0) return;
  const run = Game.run, s = run.stats;
  let d = dmg;
  if (s.powers.kill9 && (e.elite || e.isAgent)) d *= 1.5;
  let crit = opts.crit;
  if (crit === undefined) crit = run.rng.chance(s.crit);
  if (crit) d *= T.critMult + s.critdmg;
  Game.idleT = 0;
  if (!Game.bt) {
    const before = run.focus;
    run.focus = Math.min(T.focus.max, run.focus + (d * T.focus.perDamage / s.hpMult) * (1 + s.focus));
    if (before < T.focus.max && run.focus >= T.focus.max) { Sound.play('focus_ready'); UI.hint('focus'); }
  }
  if (e.shield > 0) {
    e.shield -= d;
    e.flashT = 0.06;
    if (e.shield <= 0) {
      e.shield = 0;
      Sound.play('shield_break');
      addFloat(e.x, e.y - e.h - 8, 'KEY CRACKED', '#4aa8ff', true);
      spawnHex(e.x, e.y - e.h / 2);
    } else Sound.play('shield', { vol: 0.4 });
    return;
  }
  e.hp -= d;
  e.flashT = 0.07;
  addDamageNumber(e, d, crit);
  Sound.play(crit ? 'crit' : 'hit', { vol: 0.35 });
  if (s.leech > 0) { run.leechAcc = (run.leechAcc || 0) + d * s.leech; if (run.leechAcc >= 1) { const h = Math.floor(run.leechAcc); run.leechAcc -= h; healPlayer(h, false); } }
  if (opts.source === 'shot' || opts.source === 'blast') {
    if (s.corrupt > 0) e.rot = Math.min(e.rot + d * s.corrupt, e.maxHp * 0.8);
    if (s.throttle > 0 && run.rng.chance(s.throttle)) e.slowT = 1.5;
  }
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true; e.deadT = 0; e.hp = 0;
  const run = Game.run, s = run.stats, room = Game.room;
  if (e.onDeath) { e.onDeath(e); return; }
  run.kills++;
  if (room.fight && e.wave === room.fight.wave) room.fight.killedInWave++;
  addData(e.elite ? T.data.elite : e.type === 'agent' ? T.data.agent : T.data.kill);
  Sound.play(e.elite || e.type === 'agent' ? 'kill_elite' : 'kill', { vol: 0.6 });
  spawnDissolve(e);
  UI.feed(`> kill ${e.pid} ${e.elite ? ENEMY_NAMES[e.type] : e.name}`);
  if (e.elite) { run.eliteKills++; addFloat(e.x, e.y - e.h - 6, 'TERMINATED', '#ffb43a', true); if (s.powers.earpiece) refreshStats(); }
  if (s.powers.gc) healPlayer(2, false);
  // what it leaves behind
  const rng = run.rng, n = run.floorN, luck = s.luck;
  if (e.type === 'agent') {
    let opts = { min: n >= 4 ? T.drops.agent4 : T.drops.agent3 };
    if (n >= 4 && Save.meta.reached2 && rng.chance(T.drops.agent4ZeroDay)) { const z = pickZeroDayId(rng); if (z) opts = { zeroDay: z }; }
    dropItem(e.x, e.y, rollItem(rng, { ilvl: n, luck, ...opts }));
    if (Save.unlock('ex_rootkit')) run.newUnlocks.push('Rootkit joins the drop pool');
  } else if (e.elite) {
    const a = rollItem(rng, { ilvl: n, luck }), b = rollItem(rng, { ilvl: n, luck });
    dropItem(e.x, e.y, a.rarity >= b.rarity ? a : b);
    if (rng.chance(T.drops.eliteOrb)) dropOrb(e.x + 6, e.y);
  } else {
    if (rng.chance(T.drops.normal)) dropItem(e.x, e.y, rollItem(rng, { ilvl: n, luck }));
    else if (rng.chance(T.drops.orb)) dropOrb(e.x, e.y);
  }
  // elites with a last trick
  if (e.mods.includes('volatile')) Game.hazards.push({ kind: 'volatile', x: e.x, y: e.y - 4, r: T.elite.blastR, t: T.elite.blastDelay, total: T.elite.blastDelay, dmg: T.elite.blast * T.enemyDmg(n, run.depth) });
  if (e.mods.includes('replicating')) {
    for (let i = 0; i < 2; i++) {
      const c = makeEnemy(e.type, e.x + (i ? 6 : -6), e.y, { instant: true, wave: e.wave });
      c.maxHp = c.hp = e.maxHp * T.elite.copyHp;
      c.graceT = T.spawnGrace;
      Game.enemies.push(c);
      if (room.fight) room.fight.waveCount++;
    }
  }
  if (e.type === 'worm' && !e.small) {
    for (let i = 0; i < 2; i++) {
      const c = makeEnemy('worm', e.x + (i ? 5 : -5), e.y, { instant: true, small: true, hp: T.enemies.worm.splitHp, wave: e.wave });
      c.graceT = T.spawnGrace;
      Game.enemies.push(c);
      if (room.fight) room.fight.waveCount++;
    }
  }
}

function pickZeroDayId(rng) {
  const pool = zeroDayPool();
  return pool.length ? rng.pick(pool) : null;
}

// Loot pops a little way from where it fell, but never into a wall: it has
// to stay where Neo can walk to it.
function dropSpot(x, y) {
  const room = Game.room, me = { r: 4, isPlayer: true };
  if (circleBlocked(room, x, y, 4, me)) { const f = nearestFloor(room, x / TILE, y / TILE); if (f) { x = (f[0] + 0.5) * TILE; y = (f[1] + 0.5) * TILE; } }
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2, tx = x + Math.cos(a) * 8, ty = y + Math.sin(a) * 6;
    if (!circleBlocked(room, tx, ty, 4, me)) return [x, y, tx, ty];
  }
  return [x, y, x, y];
}

function dropItem(x0, y0, item) {
  const [x, y, tx, ty] = dropSpot(x0, y0);
  Game.drops.push({ kind: 'item', item, x, y, tx, ty, t: 0, id: item.id });
  Sound.play('pickup_' + Math.min(4, item.rarity), { vol: 0.5 });
}

function dropOrb(x0, y0) {
  const [x, y, tx, ty] = dropSpot(x0, y0);
  Game.drops.push({ kind: 'orb', x, y, tx, ty, t: 0 });
}
