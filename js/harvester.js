'use strict';
// ---------------------------------------------------------------------------
// The Harvester, guarding the payphone in sector 2: a machine as wide as the
// room, waiting inside its north wall. The wall shakes and cracks when Neo
// walks in, then it breaks out. Its three eyes are its only targets, and
// they take turns: one glows while it charges, then fires a big slow packet
// (it bursts into a ring if it doesn't land) or a laser (its line shows
// first, and stops at a pillar), then shuts for a moment while shots glance
// off it. Each eye lost makes the rest quicker. With one lost, the vents
// between the eyes let out bugs; with one left, its laser follows Neo.
// The state lives on the room, so the wreck stays in the wall.
// ---------------------------------------------------------------------------

const HARVESTER_EYES = [52, 96, 140]; // x of each eye
const HARVESTER_VENTS = [74, 118];
const HARVESTER_EYE_Y = 56; // the eyes' feet: their middle sits just below the wall line

function harvesterIntro(room) {
  room.introT = T.harvester.intro;
  room.harv = { state: 'waking', t: 0, eyes: [], phase: 1, attackT: 1.0, ventT: 1.0, ventOpenT: 0, hurtT: 0 };
  Sound.play('rumble');
  Sound.music('boss');
  UI.feed('> WARNING: unknown process in the wall');
}

// the wall gives way and the eyes open
function spawnHarvester(room) {
  const H = room.harv;
  H.state = 'fight'; H.t = 0;
  for (const x of HARVESTER_EYES) {
    const e = makeEnemy('eye', x, HARVESTER_EYE_Y, { instant: true, hp: T.harvester.eyeHp, dmg: T.harvester.dmg });
    e.speed = 0; e.fixed = true; e.noContact = true; e.state = 'open';
    e.onDeath = harvesterEyeLost;
    H.eyes.push(e);
    Game.enemies.push(e);
  }
  for (let i = 0; i < 16; i++) spawnBits(16 + Math.random() * 160, 8 + Math.random() * 40, Math.random() < 0.3 ? '#ff4060' : '#4b5960', 2);
  Sound.play('explode', { pitch: 0.6 });
  if (Save.settings.shake) Game.shake = 6;
  if (!Save.settings.reducedFlash) Game.flash = { t: 0.12, a: 0.5, color: '#ffffff' };
  UI.banner('HARVESTER.EXE', 'boss');
  UI.feed('> harvester.exe: shoot out its eyes');
}

function updateHarvester(dt, p) {
  const room = Game.room, H = room && room.harv;
  if (!H) return;
  H.t += dt;
  H.hurtT = Math.max(0, H.hurtT - dt);
  H.ventOpenT = Math.max(0, H.ventOpenT - dt);
  if (H.state === 'waking') {
    // the wall shakes harder until it goes
    if (Save.settings.shake) Game.shake = Math.max(Game.shake, 1 + 2 * (H.t / T.harvester.intro));
    if (Math.random() < dt * 14) spawnBits(16 + Math.random() * 160, 48, '#4b5960', 1);
    return;
  }
  if (H.state !== 'fight' || Game.flow) return;
  const C = T.harvester, live = H.eyes.filter((e) => !e.dead);
  const phase = 1 + H.eyes.length - live.length;
  if (phase !== H.phase) { H.phase = phase; if (phase === 2) H.ventT = 1.0; }
  // like any process, nothing in its first second, and only eyes in view fire
  if (live.some((e) => e.graceT > 0)) return;
  H.attackT -= dt;
  if (H.attackT <= 0) {
    const ready = live.filter((e) => e.state === 'open' && onScreen(e.x, e.y - e.h / 2, -2));
    if (ready.length) {
      const rng = Game.run.rng, e = rng.pick(ready);
      const beam = !Game.hazards.some((h) => h.kind === 'beam') && rng.chance(C.beamChance[phase - 1]);
      eyeCharge(e, beam ? 'beam' : 'orb', p);
      H.attackT = C.every[phase - 1];
    } else H.attackT = 0.3;
  }
  if (phase >= 2) {
    H.ventT -= dt;
    if (H.ventT <= 0) {
      H.ventT = C.vents.every;
      const bugs = Game.enemies.filter((e) => !e.dead && e.type === 'bug').length;
      for (let i = 0; i < C.vents.bugs && bugs + i < C.vents.max; i++) {
        Game.enemies.push(makeEnemy('bug', HARVESTER_VENTS[i % 2], HARVESTER_EYE_Y, { wave: 0 }));
        if (room.fight) room.fight.waveCount++;
        H.ventOpenT = 1.0;
      }
      if (H.ventOpenT > 0) Sound.play('spawn');
    }
  }
}

function eyeCharge(e, kind, p) {
  const C = T.harvester;
  e.state = 'tell'; e.attack = kind;
  if (kind === 'orb') { e.stateT = C.orb.tell; Sound.play('tell', { pitch: 0.6, vol: 0.6 }); return; }
  e.stateT = C.beam.tell + C.beam.fire;
  const ox = e.x, oy = e.y - e.h / 2 + 2;
  Game.hazards.push({ kind: 'beam', eye: e, x: ox, y: oy, a: angleTo(ox, oy, p.x, p.y - 4), len: 0, t: 0, w: C.beam.w, dmg: e.dmg * C.beam.dmg, sweep: Game.room.harv.phase >= 3 });
  Sound.play('tell', { pitch: 0.45 });
}

function eyeShut(e) {
  const live = Game.room.harv.eyes.filter((x) => !x.dead).length;
  e.state = 'shut'; e.stateT = live <= 1 ? T.harvester.shutLast : T.harvester.shut;
}

function aiEye(e, p, edt) {
  const O = T.harvester.orb;
  if (e.state === 'tell' && e.attack === 'orb') {
    e.stateT -= edt;
    if (e.stateT <= 0) {
      const oy = e.y - e.h / 2 + 3;
      if (spawnBullet(e.x, oy, angleTo(e.x, oy, p.x, p.y - 4), O.speed, e.dmg * O.dmg, e.name, { r: O.r, life: O.life, ring: O.ring, ringSpeed: O.ringSpeed, ringDmg: e.dmg * O.ringDmg }))
        Sound.play('enemy_shot', { pitch: 0.45 });
      eyeShut(e);
    }
  } else if (e.state === 'shut') {
    e.stateT -= edt;
    if (e.stateT <= 0) e.state = 'open';
  }
  // a beam's eye stays open, and can be hit, until its beam is spent
  e.closed = e.state === 'shut';
}

// The laser: it follows Neo while its line shows, holds still for a moment,
// fires, and with the last eye keeps turning after him as it fires.
function updateBeam(h, dt) {
  const e = h.eye, p = Game.player, C = T.harvester.beam;
  if (e.dead) { h.dead = true; return; }
  h.t += dt;
  const aimAt = Game.decoy || p;
  const want = angleTo(h.x, h.y, aimAt.x, aimAt.y - 4);
  if (h.t < C.tell - C.lock) h.a = want;
  else if (h.t >= C.tell && h.sweep) {
    const diff = ((want - h.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI, turn = C.sweep * Math.PI / 180 * dt;
    h.a += clamp(diff, -turn, turn);
  }
  h.len = rayLength(Game.room, h.x, h.y, h.a);
  if (h.t >= C.tell && !h.fired) {
    h.fired = true;
    Sound.play('laser');
    if (Save.settings.shake) Game.shake = Math.max(Game.shake, 2);
  }
  if (h.t >= C.tell && h.t < C.tell + C.fire) {
    const dx = p.x - h.x, dy = p.y - 4 - h.y, c = Math.cos(h.a), s = Math.sin(h.a);
    const along = dx * c + dy * s, across = Math.abs(dy * c - dx * s);
    if (along > 0 && along < h.len && across < h.w / 2 + 3) damagePlayer(h.dmg, "harvester.exe's laser");
  }
  if (h.t >= C.tell + C.fire) { h.dead = true; eyeShut(e); }
}

function harvesterEyeLost(e) {
  const room = Game.room, H = room.harv, run = Game.run;
  run.kills++;
  addData(T.data.elite);
  Game.hazards = Game.hazards.filter((h) => !(h.kind === 'beam' && h.eye === e));
  spawnRing(e.x, e.y - e.h / 2, ENEMY_BULLET, 24);
  spawnBits(e.x, e.y - e.h / 2, '#ff4060', 10);
  spawnBits(e.x, e.y - e.h / 2, '#ffffff', 4);
  Sound.play('explode');
  Sound.play('kill_elite');
  if (Save.settings.shake) Game.shake = Math.max(Game.shake, 4);
  H.hurtT = 0.45;
  UI.feed(`> kill ${e.pid} harvester.eye`);
  if (H.eyes.some((x) => !x.dead)) addFloat(e.x, e.y - 20, 'EYE TERMINATED', '#ffb43a', true);
  else harvesterDown(room);
}

function harvesterDown(room) {
  const H = room.harv, run = Game.run;
  H.state = 'dead'; H.t = 0;
  // what it let out goes with it
  for (const e of Game.enemies) if (!e.dead) { e.dead = true; e.deadT = 0; spawnDissolve(e); }
  Game.bullets = [];
  Game.hazards = Game.hazards.filter((h) => h.friendly);
  addData(T.data.agent);
  dropItem(room.w * TILE / 2, 5.5 * TILE, rollItem(run.rng, { ilvl: run.floorN, luck: run.stats.luck, min: T.drops.agent3 }));
  addFloat(room.w * TILE / 2, 30, 'TERMINATED', '#ffb43a', true);
  UI.feed('> kill harvester.exe');
  Sound.music('floor' + run.floorN);
  if (Save.settings.shake) Game.shake = 6;
}
