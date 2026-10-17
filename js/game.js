'use strict';
// ---------------------------------------------------------------------------
// The game's state and the shape of a run. Game holds what's on screen (the
// scene, the room being played, every entity in it) and Game.run what a run
// carries from room to room: the seed, the floor, Neo's gear and patches,
// integrity, focus and the tallies. A run goes:
//   startRun → startFloor(1) → enterRoom(entry) … answer the payphone →
//   patch pick → startFloor(2) … the Agent → endRun(victory)
// and endRun hands over to the summary, and the summary back to the hub.
// Each floor starts with a checkpoint, so Continue can restart that floor.
// ---------------------------------------------------------------------------

const Game = {
  ready: false,
  scene: 'boot', // 'title', 'hub', 'run'
  modal: null, // a card or menu that pauses the simulation
  paused: false,
  t: 0, // simulation seconds (world time, slowed by Bullet Time)
  realT: 0,
  run: null,
  room: null, // the room being played (a dungeon Room, or the apartment)
  player: null,
  enemies: [], shots: [], bullets: [], drops: [], hazards: [], fx: [], floats: [],
  viewH: 208,
  camY: 0,
  bt: null, // Bullet Time: { left, total }
  timeScale: 1,
  shake: 0, glitch: 0, flashT: 0, lastFlashAt: -9,
  transition: null, // { t, dur, then } a short glitch wipe between rooms
  flow: null, // a scripted sequence running (the cold open, the phone, death)
  debug: { god: false, fast: false },
  pid: 3000,
};

function newRun({ seed, depth = 1, daily = false } = {}) {
  const s = seed === undefined ? (Math.random() * 4294967296) >>> 0 : seed >>> 0;
  return {
    seed: s, depth, daily, floorN: 0, floor: null, rng: null,
    gear: { exploit: null, coat: null, shades: null, implant: null },
    patches: [], stats: null, hp: T.player.hp, focus: 0,
    kills: 0, eliteKills: 0, time: 0, data: 0, dataCommitted: 0,
    reviveUsed: false, oneCoatFloor: 0, best: null, killedBy: '', victory: false,
    unlockedZeroDay: null, newUnlocks: [], roomsCleared: 0,
  };
}

function refreshStats() {
  const r = Game.run;
  if (!r) return;
  const before = r.stats ? r.stats.maxHp : null;
  r.stats = computeStats(r.gear, r.patches, r.floorN || 1);
  // gaining max integrity raises integrity with it; losing it clips
  if (before !== null && r.stats.maxHp > before) r.hp += r.stats.maxHp - before;
  r.hp = Math.min(r.hp, r.stats.maxHp);
}

function noteBest(item) {
  const r = Game.run;
  if (!r.best || item.rarity > r.best.rarity || (item.rarity === r.best.rarity && item.ilvl > r.best.ilvl)) r.best = { name: item.name, rarity: item.rarity, ilvl: item.ilvl };
}

// A new run from the apartment door (or the Daily Trace).
function startRun(opts = {}) {
  const run = newRun(opts);
  Game.run = run;
  const rng = new Rng(hashInts(run.seed, 0xbeef));
  run.gear.exploit = starterExploit(rng);
  run.stats = computeStats(run.gear, run.patches, 1);
  run.hp = run.stats.maxHp;
  Save.data.records.runs++;
  Save.write();
  startFloor(1);
}

// Restarts the floor a checkpoint was written at.
function continueRun() {
  const c = Save.data.checkpoint;
  if (!c) return false;
  const run = newRun({ seed: c.seed, depth: c.depth || 1, daily: !!c.daily });
  Object.assign(run, {
    gear: c.gear, patches: c.patches, hp: c.hp, focus: c.focus || 0, kills: c.kills || 0, eliteKills: c.eliteKills || 0,
    time: c.time || 0, data: c.data || 0, dataCommitted: c.data || 0, reviveUsed: !!c.reviveUsed, best: c.best || null,
    roomsCleared: c.roomsCleared || 0,
  });
  for (const k of SLOTS) if (run.gear[k] === undefined) run.gear[k] = null;
  Game.run = run;
  run.stats = computeStats(run.gear, run.patches, c.floor);
  run.hp = clamp(run.hp, 1, run.stats.maxHp);
  startFloor(c.floor, { resumed: true });
  return true;
}

function writeCheckpoint() {
  const r = Game.run;
  commitData();
  Save.data.checkpoint = {
    seed: r.seed, floor: r.floorN, depth: r.depth, daily: r.daily, gear: r.gear, patches: r.patches,
    hp: r.hp, focus: r.focus, kills: r.kills, eliteKills: r.eliteKills, time: r.time, data: r.data,
    reviveUsed: r.reviveUsed, best: r.best, roomsCleared: r.roomsCleared,
  };
  Save.write();
}

// Data earned so far goes into the bank now, so quitting mid-run loses at
// most the current floor's.
function commitData() {
  const r = Game.run;
  if (!r) return;
  const d = Math.floor(r.data) - r.dataCommitted;
  if (d > 0) { Save.meta.data += d; r.dataCommitted += d; }
}

function addData(n) {
  const r = Game.run;
  if (!r || !n) return 0;
  const got = n * (1 + (r.stats ? r.stats.data : 0));
  r.data += got;
  return got;
}

function startFloor(n, { resumed = false } = {}) {
  const r = Game.run;
  r.floorN = n;
  r.floor = generateFloor(r.seed, n);
  r.rng = new Rng(hashInts(r.seed, n, 0xc0de));
  r.oneCoatFloor = 0;
  // the first fight of the first run teaches; the room before each later
  // exit has a black cat in it, twice
  const fights = r.floor.rooms.filter((rm) => rm.kind === 'combat');
  if (n === 1 && !Save.meta.tutorialDone && fights[0]) fights[0].tutorial = true;
  if (n >= 2 && n <= 4) {
    const pre = r.floor.rooms[r.floor.rooms.indexOf(r.floor.exit) - 1];
    if (pre && pre.kind === 'combat') pre.cat = true;
  }
  refreshStats();
  if (r.healFull) { r.hp = r.stats.maxHp; r.healFull = false; }
  if (Save.rank('prefocus')) r.focus = Math.max(r.focus, T.focus.max * 0.5);
  if (n >= 2 && !Save.meta.reached2) { Save.meta.reached2 = true; }
  if (n >= 3 && Save.unlock('ex_worm')) r.newUnlocks.push('Worm.exe joins the drop pool');
  Save.data.records.deepest = Math.max(Save.data.records.deepest, n);
  writeCheckpoint();
  Game.scene = 'run';
  Game.player = makePlayer();
  Game.player.coat = true;
  Game.bt = null; Game.timeScale = 1;
  enterRoom(r.floor.entry, null);
  Sound.music(n === 5 ? 'none' : 'floor' + n);
  UI.onFloorStart(n, resumed);
}

// Puts Neo in a room. `from` is the side he came in by (null on arrival).
function enterRoom(room, from) {
  const r = Game.run;
  r.room = room;
  Game.room = room;
  const firstVisit = !room.visited;
  room.visited = true;
  for (const c of Game.critters) if (c.kind === 'rabbit') revealHidden(c.room, c.dir);
  Game.critters = [];
  Game.enemies = []; Game.shots = []; Game.bullets = []; Game.hazards = [];
  Game.fx = []; Game.floats = []; Game.boss = null;
  room.drops = room.drops || [];
  Game.drops = room.drops;
  const p = Game.player;
  if (from) { const a = room.arrival(from); p.x = a.x; p.y = a.y; }
  else { p.x = room.w * TILE / 2; p.y = (room.h - 2) * TILE; }
  p.vx = 0; p.vy = 0; p.phaseT = 0;
  room.encryptionUsed = false;
  room.coilUsed = false;
  Game.idleT = 0;
  updateCamera(true);
  if (!room.cleared && (room.kind === 'combat' || room.kind === 'exit' || room.kind === 'boss')) beginFight(room);
  else Sound.setTension(0);
  if (firstVisit && room.cat) spawnCat(room);
  if (firstVisit && room.kind === 'cache') UI.hint('decrypt');
  if (firstVisit && room.kind === 'oracle') UI.feed('> terminal found. someone left cookies.');
  UI.onRoomChange();
}

function roomSealed() {
  const room = Game.room;
  return !!(room && room.fight && !room.cleared);
}

// Walking off the edge of the room through an open door.
function checkDoorways() {
  const room = Game.room, p = Game.player;
  if (!room || Game.scene !== 'run' || roomSealed() || Game.transition) return;
  const W = room.w * TILE, H = room.h * TILE;
  let dir = null;
  if (p.y < TILE * 0.55) dir = 'n';
  else if (p.y > H - TILE * 0.55) dir = 's';
  else if (p.x < TILE * 0.55) dir = 'w';
  else if (p.x > W - TILE * 0.55) dir = 'e';
  if (!dir) return;
  const d = room.doors[dir];
  if (!d || d.hidden) return;
  const next = d.to;
  startTransition(0.22, () => enterRoom(next, OPP[dir]));
}

function startTransition(dur, then) {
  Game.transition = { t: 0, dur, then, done: false };
  Sound.play('glitch', { vol: 0.35 });
}

// The room is clear: the doors open and the room may hold a surprise.
function clearRoom(room) {
  room.cleared = true;
  room.fight = null;
  const r = Game.run;
  r.roomsCleared++;
  if (room.tutorial) Save.meta.tutorialDone = true;
  Sound.setTension(0);
  if (room.kind !== 'boss') {
    Sound.play('door_open');
    UI.feed('> ACCESS GRANTED');
    UI.banner('ACCESS GRANTED');
  }
  if (r.stats.powers.cookie) healPlayer(r.stats.maxHp * 0.25, true);
  // the white rabbit: hops in and shows the way to a hidden door
  for (const d of Object.values(room.doors)) {
    if (d.hidden && d.to.kind === 'rabbit') { spawnRabbit(room, d.to); break; }
  }
  if (room.kind === 'exit') { room.phoneRinging = true; UI.hint('phone'); }
  if (room.kind === 'boss') bossDefeated();
  if (Game.drops.some((d) => d.kind === 'item')) UI.hint('loot');
  Save.write();
}

// Answering the payphone: the floor is done.
function answerPhone() {
  const r = Game.run;
  if (Game.flow) return;
  Sound.play('phone_pickup');
  addData(T.data.floor(r.floorN));
  Game.flow = { kind: 'phone', t: 0 };
  Game.glitch = 0.6;
}

function finishPhone() {
  const r = Game.run;
  Game.flow = null;
  // pick up anything left lying in the exit room? No: what you left is gone.
  UI.openPatchPick(r.floorN, (id) => {
    if (id) {
      r.patches.push(id);
      const p = PATCH[id];
      if (p.onTake) p.onTake();
    }
    startFloor(r.floorN + 1);
  });
}

function bossDefeated() {
  const r = Game.run;
  r.victory = true;
  addData(T.data.boss);
  // a new Zero-Day decompiled into the pool, as the prize
  const locked = ZERO_DAYS.filter((z) => !z.start && !Save.unlocked('zd_' + z.id));
  if (locked.length) {
    const z = r.rng.pick(locked);
    Save.unlock('zd_' + z.id);
    r.unlockedZeroDay = z.id;
  }
  if (Save.unlock('ex_logic')) r.newUnlocks.push('Logic Bomb joins the drop pool');
  Game.flow = { kind: 'victory', t: 0 };
  Sound.music('victory');
  Sound.play('victory');
}

// The end of a run, won or lost: tallies go to the records, Data to the bank,
// and the summary takes over.
function endRun(victory) {
  const r = Game.run;
  if (!r || r.ended) return;
  r.ended = true;
  r.victory = victory;
  commitData();
  const rec = Save.data.records;
  rec.kills += r.kills;
  if (victory) {
    rec.wins++;
    if (!rec.bestTime || r.time < rec.bestTime) rec.bestTime = r.time;
    rec.bestDepthWin = Math.max(rec.bestDepthWin, r.depth);
    if (r.depth >= Save.meta.maxDepth && Save.meta.maxDepth < T.depth.max) { Save.meta.maxDepth = r.depth + 1; r.newUnlocks.push(`Depth ${r.depth + 1} unlocked at the terminal`); }
  }
  if (r.daily) {
    const k = todayKey();
    if (rec.daily.key !== k) rec.daily = { key: k, best: 0, deepest: 0 };
    rec.daily.deepest = Math.max(rec.daily.deepest, r.floorN);
    if (victory && (!rec.daily.best || r.time < rec.daily.best)) rec.daily.best = r.time;
  }
  Save.data.checkpoint = null;
  Save.meta.lastWin = victory;
  Save.write();
  Game.enemies = []; Game.bullets = []; Game.hazards = []; Game.shots = [];
  Game.bt = null; Game.timeScale = 1;
  Sound.setBulletTime(false); Sound.heartbeat(false); Sound.setTension(0);
  UI.openSummary(r);
}

// Leaving a run from the pause menu counts as a loss.
function abandonRun() {
  const r = Game.run;
  if (!r) return;
  r.killedBy = 'disconnected';
  endRun(false);
}
