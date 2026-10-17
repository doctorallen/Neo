'use strict';
// ---------------------------------------------------------------------------
// Agents. The mini-boss agent guards the payphone on floors 3 and 4: it
// strafes, fires aimed three-round bursts after a tell, and sidesteps one
// shot at a time on a cooldown (never in Bullet Time, never mid-burst), so it
// can be baited. The Agent on floor 5 does all that, then replicates, then
// calls down a code storm. Every attack is telegraphed; charges show their
// lane first.
// ---------------------------------------------------------------------------

function setupAgent(e) {
  e.state = 'move';
  e.strafe = Math.random() < 0.5 ? 1 : -1;
  e.strafeT = T.agent.strafe;
  e.attackT = 1.0;
  e.burstLeft = 0;
  e.burstGapT = 0;
  if (e.type === 'clone') {
    e.maxHp = e.hp = T.boss.cloneHp * (1 + T.depth.hp * (Game.run.depth - 1));
    e.onDeath = (c) => { spawnDissolve(c); Sound.play('kill', { vol: 0.5 }); };
    return;
  }
  e.dodge = (shot) => agentDodge(e, shot);
}

function agentDodgeCd(e) {
  const k = counterOn('adaptive') ? 0.5 : 1;
  if (!e.isBoss) return T.agent.dodgeCd * k;
  return (e.phase === 1 ? T.boss.dodgeCd : T.agent.dodgeCd) * k;
}

// Sidestep a shot about to land: off to whichever side is open.
function agentDodge(e, shot) {
  if (e.dodgeT > 0 || Game.bt || e.state === 'burst' || e.state === 'charge' || e.state === 'chargeTell' || e.graceT > 0) return false;
  if (e.isBoss && e.phase === 3) return false;
  const a = Math.atan2(shot.vy, shot.vx);
  for (const side of [1, -1]) {
    const px = Math.cos(a + side * Math.PI / 2), py = Math.sin(a + side * Math.PI / 2);
    const ox = e.x, oy = e.y;
    moveEntity(e, px * 14, py * 14);
    if (dist(ox, oy, e.x, e.y) > 8) {
      e.dodgeT = agentDodgeCd(e);
      e.afterimage = { x: ox, y: oy, t: 0.3 };
      return true;
    }
    e.x = ox; e.y = oy;
  }
  return false;
}

// strafing round Neo at a comfortable range
function agentMove(e, p, dt, want = 72) {
  e.strafeT -= dt;
  if (e.strafeT <= 0) { e.strafe *= -1; e.strafeT = T.agent.strafe * (0.7 + Math.random() * 0.6); }
  const d = dist(e.x, e.y, p.x, p.y);
  let vx, vy;
  if (!lineOfSight(Game.room, e.x, e.y - 8, p.x, p.y - 4) || d > want * 1.8) [vx, vy] = flowDir(e);
  else {
    const a = angleTo(p.x, p.y, e.x, e.y), radial = clamp((d - want) / 30, -1, 1);
    vx = -Math.cos(a) * radial - Math.sin(a) * e.strafe * 0.9;
    vy = -Math.sin(a) * radial + Math.cos(a) * e.strafe * 0.9;
    const m = Math.hypot(vx, vy) || 1; vx /= m; vy /= m;
  }
  if (moveEntity(e, vx * e.speed * dt, vy * e.speed * dt)) e.strafe *= -1;
  e.facing = p.x >= e.x ? 1 : -1;
}

// tell → three (or one) rounds aimed once, at the end of the tell
function agentBurst(e, p, edt, canAttack, cfg) {
  if (e.state === 'tell') {
    e.stateT -= edt;
    e.facing = p.x >= e.x ? 1 : -1;
    if (e.stateT <= 0) {
      e.state = 'burst';
      e.aim = angleTo(e.x, e.y - 9, p.x, p.y - 4);
      e.burstLeft = cfg.burst; e.burstGapT = 0;
    }
    return true;
  }
  if (e.state === 'burst') {
    e.burstGapT -= edt;
    if (e.burstGapT <= 0) {
      if (spawnBullet(e.x + e.facing * 5, e.y - 9, e.aim, cfg.bullet, e.dmg, e.isBoss ? 'the Agent' : 'an agent')) Sound.play('enemy_shot', { vol: 0.5, pitch: 1.2 });
      e.burstLeft--; e.burstGapT = T.agent.burstGap;
      if (e.burstLeft <= 0) { e.state = 'move'; e.attackT = cfg.every; }
    }
    return true;
  }
  return false;
}

function aiAgent(e, p, dt, edt, canAttack) {
  const clone = e.type === 'clone';
  const cfg = clone ? { burst: 1, bullet: T.boss.cloneBullet, every: 2.2 } : { burst: T.agent.burst, bullet: T.agent.bullet, every: T.agent.burstEvery };
  if (agentBurst(e, p, edt, canAttack, cfg)) return;
  agentMove(e, p, dt, clone ? 60 : 72);
  e.attackT -= edt;
  if (e.attackT <= 0 && canAttack && bulletRoom(cfg.burst) && lineOfSight(Game.room, e.x, e.y - 9, p.x, p.y - 4)) {
    e.state = 'tell'; e.stateT = T.agent.burstTell;
  } else if (e.attackT <= 0) e.attackT = 0.3;
}

// ---------------------------------------------------------------------------
// The Agent
// ---------------------------------------------------------------------------
function bossIntro(room) {
  room.introT = 1.8;
  UI.bossLine('Mr. Anderson.');
  Sound.play('boss_voice');
  Sound.music('boss');
}

function spawnBoss(room) {
  const e = makeEnemy('boss', room.w * TILE / 2, 4 * TILE, { wave: 0 });
  e.name = 'agent';
  e.phase = 1;
  e.ringA = 0;
  e.cloneT = 3;
  e.ringT = T.boss.ringEvery;
  e.chargeT = T.boss.chargeEvery;
  e.stormT = 1.5;
  e.attackT = 1.2;
  e.onDeath = (b) => {
    for (const c of Game.enemies) if (c.type === 'clone' && !c.dead) { c.dead = true; c.deadT = 0; spawnDissolve(c); }
    Game.bullets = [];
    Game.hazards = Game.hazards.filter((h) => h.friendly);
    spawnDissolve(b, true);
    Game.run.kills++;
    Sound.play('kill_elite');
    UI.feed('> kill 1 agent: sleep()');
    if (Save.settings.shake) Game.shake = 4;
  };
  Game.enemies.push(e);
  Game.boss = e;
}

function aiBoss(e, p, dt, edt, canAttack) {
  const B = T.boss, room = Game.room;
  const frac = e.hp / e.maxHp;
  const phase = frac > B.phase2 ? 1 : frac > B.phase3 ? 2 : 3;
  if (phase !== e.phase) {
    e.phase = phase;
    if (phase === 2) { UI.bossLine('Me, me, me.'); e.cloneT = 0.5; }
    if (phase === 3) { UI.bossLine('It is inevitable.'); e.stormT = 1.0; }
    Sound.play('boss_voice');
    Game.bullets = Game.bullets.slice(-6);
  }
  // a charge: the lane shows first, then he comes straight down it
  if (e.state === 'chargeTell') {
    e.stateT -= edt;
    if (e.stateT <= 0) { e.state = 'charge'; e.stateT = B.chargeTime; Sound.play('dash'); }
    return;
  }
  if (e.state === 'charge') {
    e.stateT -= dt;
    const bumped = moveEntity(e, Math.cos(e.aim) * B.chargeSpeed * dt, Math.sin(e.aim) * B.chargeSpeed * dt);
    if (e.stateT <= 0 || bumped) { e.state = 'move'; e.attackT = 0.8; if (bumped && Save.settings.shake) Game.shake = Math.max(Game.shake, 2); }
    return;
  }
  if (e.state === 'storm') {
    e.stateT -= edt;
    agentMove(e, p, dt * 0.4, 80);
    if (e.stateT <= 0) { e.state = 'move'; e.attackT = 0.8; }
    return;
  }
  const cfg = { burst: B.burst, bullet: B.bullet, every: B.burstEvery * (phase === 2 ? 1.3 : 1) };
  if (agentBurst(e, p, edt, canAttack, cfg)) return;
  agentMove(e, p, dt, 78);
  if (!canAttack) return;

  e.chargeT -= edt;
  if (e.chargeT <= 0 && dist(e.x, e.y, p.x, p.y) > 30) {
    e.chargeT = phase === 3 ? 3 : phase === 2 ? 5 : B.chargeEvery;
    e.state = 'chargeTell'; e.stateT = B.chargeTell;
    e.aim = angleTo(e.x, e.y, p.x, p.y);
    const len = rayLength(room, e.x, e.y - 4, e.aim);
    Game.hazards.push({ kind: 'lane', x: e.x, y: e.y - 4, a: e.aim, len, w: 12, t: B.chargeTell, total: B.chargeTell });
    Sound.play('tell', { pitch: 0.7 });
    return;
  }
  if (phase >= 2) {
    e.cloneT -= edt;
    const clones = Game.enemies.filter((c) => c.type === 'clone' && !c.dead).length;
    if (e.cloneT <= 0) {
      e.cloneT = B.cloneEvery;
      if (clones < B.clonesMax) {
        const pt = spawnPoint(room, Game.run.rng, [{ x: e.x, y: e.y }]);
        if (pt) { const c = makeEnemy('clone', pt.x, pt.y, { wave: 0 }); Game.enemies.push(c); Sound.play('spawn'); }
      }
    }
    e.ringT -= edt;
    if (e.ringT <= 0 && phase === 2) {
      e.ringT = B.ringEvery;
      if (bulletRoom(B.ringShots)) {
        for (let i = 0; i < B.ringShots; i++) spawnBullet(e.x, e.y - 9, e.ringA + (i / B.ringShots) * Math.PI * 2, B.ringBullet, e.dmg * 0.8, 'the Agent');
        e.ringA += B.ringTurn * Math.PI / 180;
        Sound.play('enemy_shot', { pitch: 0.6 });
      }
    }
  }
  if (phase === 3) {
    e.stormT -= edt;
    if (e.stormT <= 0) {
      e.stormT = B.stormEvery;
      codeStorm(room, e);
      e.state = 'storm'; e.stateT = B.stormWarn + B.stormRain;
      return;
    }
  }
  e.attackT -= edt;
  if (e.attackT <= 0 && bulletRoom(cfg.burst) && lineOfSight(room, e.x, e.y - 9, p.x, p.y - 4)) { e.state = 'tell'; e.stateT = B.burstTell; }
  else if (e.attackT <= 0) e.attackT = 0.3;
}

// Columns of falling code. Of the room's ten floor columns, three light up,
// and there are always at least two side by side left dark to stand in.
function codeStorm(room, boss) {
  const rng = Game.run.rng, B = T.boss;
  let cols;
  for (let tries = 0; tries < 30; tries++) {
    cols = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, B.stormCols).sort((a, b) => a - b);
    // the column Neo stands in is always one of them, so he has to move
    const pc = clamp(Math.floor(Game.player.x / TILE) - 1, 0, 9);
    if (!cols.includes(pc)) cols[0] = pc;
    cols.sort((a, b) => a - b);
    let run = 0, best = 0;
    for (let c = 0; c < 10; c++) { if (cols.includes(c)) run = 0; else { run++; best = Math.max(best, run); } }
    if (best >= 2 && new Set(cols).size === cols.length) break;
  }
  for (const c of cols) Game.hazards.push({ kind: 'storm', x0: (c + 1) * TILE, x1: (c + 2) * TILE, t: 0, dmg: B.stormDmg * T.enemyDmg(5, Game.run.depth) });
  Sound.play('storm_warn');
  UI.feed('> code storm');
}

// how far a ray goes before it meets a wall or an obstacle
function rayLength(room, x, y, a) {
  let d = 0;
  while (d < 400) {
    d += 4;
    const tx = Math.floor((x + Math.cos(a) * d) / TILE), ty = Math.floor((y + Math.sin(a) * d) / TILE);
    const v = room.t(tx, ty);
    if (v !== FLOOR && v !== PIT) break;
  }
  return d;
}
