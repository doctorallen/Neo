'use strict';
// ---------------------------------------------------------------------------
// The apartment: where every run begins and where every run ends. It always
// opens on the same shot (Neo asleep at his desk, the monitor glowing, the
// clock at 3:14), then the monitor types to him, there's a knock, and he gets
// up. The desk's terminal sells the permanent upgrades; the door leads out.
// Nobody is ever at the door.
//
// The first time (or every time, with the setting) the whole scene plays, cut
// to the film's beats; afterwards a short version.
// ---------------------------------------------------------------------------

const HUB_DESK = { tx: 2, ty: 1 }; // the desk's tiles: 2 wide, along the north wall
const HUB_TERMINAL = { x: 2.5 * TILE, y: 2.9 * TILE }; // where you stand to use it
const HUB_WAKE = { x: 4.1 * TILE, y: 3.3 * TILE }; // where he stands up, a step from the desk

function buildApartment() {
  const room = new Room(0, 0, 'apartment', 'small');
  room.sector = 'apartment';
  room.doors = { n: { to: null, hidden: false, apartment: true } };
  fillRoomTiles(room, ROOM_TEMPLATES.small[0], false, false);
  // the desk and the bed are solid
  for (const [tx, ty] of [[1, 1], [2, 1], [3, 1], [9, 7], [9, 8]]) room.set(tx, ty, BLOCK);
  room.furnished = true; // solid tiles under furniture are drawn as floor
  room.cleared = true;
  room.props = [];
  room.wallDecor = [{ kind: 'clock', tx: 8 }, { kind: 'poster', tx: 10 }];
  room.seed = 1;
  return room;
}

// Transmissions: after every run, won or lost, the next one is waiting on
// the monitor. Read in order they hint, never say, where Neo really is. They
// can be read again in Records. (No line may say "dream".)
const TRANSMISSIONS = [
  { from: 'MORPHEUS', lines: ['You made it out.', 'Most never open the door.'] },
  { from: 'TRINITY', lines: ["They're watching the door.", "Don't stop moving."] },
  { from: 'MORPHEUS', lines: ['Every sector you crack,', 'they rebuild behind you.'] },
  { from: 'UNKNOWN', lines: ['What time is it, Neo?', 'Look at the clock.'] },
  { from: 'TRINITY', lines: ['I walked past your building.', 'Your light was on. 3:14.'] },
  { from: 'AGENT', lines: ['Mr. Anderson.', 'You keep coming back.'] },
  { from: 'MORPHEUS', lines: ['Have you noticed', 'the rain never lands?'] },
  { from: 'THE ORACLE', lines: ["Don't worry about the vase.", "You'll fix it in the morning."] },
  { from: 'TRINITY', lines: ['When did you last eat?', 'When did you last go out?'] },
  { from: 'MORPHEUS', lines: ['The door was never locked.', 'So who is knocking?'] },
  { from: 'AGENT', lines: ['We have your file.', 'Every attempt. Every one.'] },
  { from: 'UNKNOWN', lines: ['> ps -o state anderson', '> S (interruptible)'] },
  { from: 'THE ORACLE', lines: ['You already know', 'where you really are.'] },
  { from: 'TRINITY', lines: ['Neo. Your hands.', 'Look at your hands.'] },
  { from: 'MORPHEUS', lines: ['What is real?', 'How do you define real?'] },
  { from: '???', lines: ['Wake up, Neo.', 'Wake up.', 'WAKE UP.'] },
];

// The beats of the opening. `full` is the whole scene; otherwise the short
// version. `won` holds the sleeping shot longer, with ROOT ACCESS on the
// screen for a second (the run happened there). `tx`, a transmission, is
// typed out before the knock.
function hubScript(full, won, tx = null) {
  const S = [];
  const transmission = () => {
    if (!tx) return;
    S.push({ k: 'type', text: `incoming: ${tx.from}`, hold: 0.6 });
    for (const line of tx.lines) S.push({ k: 'type', text: line, hold: 1.3 });
  };
  S.push({ k: 'sleep', d: won ? 3.0 : full ? 2.0 : 1.2, rootAccess: won });
  if (full) {
    S.push({ k: 'type', text: 'Wake up, Neo...', hold: 1.2 });
    S.push({ k: 'stir', d: 1.0 });
    S.push({ k: 'type', text: 'The Matrix has you...', hold: 1.2 });
    S.push({ k: 'type', text: 'Follow the white rabbit.', hold: 1.0 });
    transmission();
    S.push({ k: 'type', text: 'Knock, knock, Neo.', hold: 0.5 });
  } else {
    S.push({ k: 'type', text: 'Wake up, Neo.', hold: 0.5 });
    transmission();
  }
  S.push({ k: 'knock' });
  return S;
}

// The next unread transmission, marked read; null when there's none.
function takeTransmission() {
  const m = Save.meta;
  if (m.txRead >= m.tx || m.tx < 1) return null;
  m.txRead = m.tx;
  Save.write();
  return TRANSMISSIONS[Math.min(m.tx, TRANSMISSIONS.length) - 1];
}

function enterHub({ won = false } = {}) {
  const full = !Save.meta.introSeen || Save.settings.fullIntro;
  Game.scene = 'hub';
  Game.run = null;
  const room = buildApartment();
  Game.room = room;
  Game.enemies = []; Game.shots = []; Game.bullets = []; Game.hazards = []; Game.drops = []; Game.fx = []; Game.floats = []; Game.critters = [];
  Game.boss = null; Game.transition = null; Game.decoy = null; endBulletTime();
  Game.player = makePlayer();
  Game.player.coat = false;
  Game.player.x = HUB_WAKE.x; Game.player.y = HUB_WAKE.y;
  Game.player.hidden = true; // he's asleep at the desk until the knock
  const tx = takeTransmission();
  Game.hub = { room, full, won, tx, script: hubScript(full, won, tx), i: 0, t: 0, typed: '', asleep: true, stir: false, doorOpen: 0, doorShake: 0, knockIdle: 0, knocked: false, leaving: false, crt: false, nearTerminal: false, bulbT: 0, tailT: -1, skip: false };
  Game.flow = null;
  updateCamera(true);
  Sound.music('hub');
  Sound.setTension(0);
  UI.onHub(Game.hub);
}

// Tapping during the scene: hurries the typing, then skips ahead.
function hubTap() {
  const h = Game.hub;
  if (!h || h.i >= h.script.length) return;
  const step = h.script[h.i];
  if (step.k === 'type' && h.typed.length < step.text.length) { h.typed = step.text; UI.crt(h.typed, true); h.t = step.text.length / 14; return; }
  if (!h.full || Save.meta.introSeen || h.realT > 3) h.skip = true;
}

function updateHub(dt) {
  const h = Game.hub;
  if (!h) return;
  h.realT = (h.realT || 0) + dt;
  h.bulbT += dt;
  // the opening scene
  while (h.i < h.script.length) {
    const step = h.script[h.i];
    if (h.skip && step.k !== 'knock') { h.i++; h.t = 0; h.typed = ''; continue; }
    h.t += dt;
    if (step.k === 'sleep') {
      if (h.t >= step.d) { h.i++; h.t = 0; }
      break;
    }
    if (step.k === 'stir') {
      h.crt = false; UI.crt(null);
      Game.player.hidden = true;
      h.stir = true;
      if (h.t >= step.d) { h.stir = false; h.i++; h.t = 0; }
      break;
    }
    if (step.k === 'type') {
      h.crt = true;
      const n = Math.min(step.text.length, Math.floor(h.t * 14));
      if (n > h.typed.length) { h.typed = step.text.slice(0, n); Sound.play('key', { vol: 0.5 }); }
      UI.crt(h.typed, n >= step.text.length);
      if (n >= step.text.length && h.t >= step.text.length / 14 + step.hold) { h.i++; h.t = 0; h.typed = ''; }
      break;
    }
    if (step.k === 'knock') {
      h.crt = false; UI.crt(null);
      knock(h);
      h.asleep = false;
      Game.player.hidden = false;
      h.skip = false;
      h.i++; h.t = 0;
      UI.hint('door');
      break;
    }
  }
  if (h.i < h.script.length) return;

  // awake: walking about the apartment
  const p = Game.player;
  updatePlayer(dt);
  h.doorShake = Math.max(0, h.doorShake - dt);
  // knocks again if he dawdles before opening the door
  if (!h.doorOpen && !Game.modal) {
    h.knockIdle += Input.moving() ? -dt : dt;
    h.knockIdle = Math.max(0, h.knockIdle);
    if (h.knockIdle > 4) { h.knockIdle = 0; knock(h); }
  }
  // the terminal
  const nearT = dist(p.x, p.y, HUB_TERMINAL.x, HUB_TERMINAL.y) < 18 && (Save.meta.data > 0 || Object.keys(Save.meta.upgrades).length > 0);
  if (nearT !== h.nearTerminal) { h.nearTerminal = nearT; UI.hubAction(nearT ? 'terminal' : null); }
  // the door opens as he reaches it, onto an empty corridor
  const doorX = 6 * TILE, nearDoor = Math.abs(p.x - doorX) < 20 && p.y < 2.6 * TILE;
  if (nearDoor && !h.doorOpen) {
    h.doorOpen = 0.001;
    Sound.play('door_creak');
    UI.feed('> ...');
    if (!Save.meta.introSeen) h.tailT = 0.5; // a white tail, whisking round the corner
    Save.meta.introSeen = true; Save.write();
  }
  if (h.doorOpen) h.doorOpen = Math.min(1, h.doorOpen + dt * 2.5);
  if (h.tailT >= 0) h.tailT += dt;
  // and through it, into the code
  if (h.doorOpen >= 1 && p.y < TILE * 0.7 && Math.abs(p.x - doorX) < 12 && !h.leaving) {
    h.leaving = true;
    Game.glitch = 0.8;
    Sound.play('glitch');
    startTransition(0.5, () => {
      const daily = !!Game.pendingDaily;
      Game.pendingDaily = false;
      const opts = daily ? { seed: hashString('trace-' + todayKey()), depth: 1, daily: true } : { depth: Save.meta.depth || 1 };
      Game.hub = null;
      startRun(opts);
      Game.arrivalCollapse = 0.8;
    });
  }
}

function knock(h) {
  Sound.play('knock');
  h.doorShake = 0.5;
  h.knocked = true;
  buzz(20);
}

// Neo can walk through the apartment door only once it's open.
function apartmentDoorOpen() {
  return Game.hub && Game.hub.doorOpen >= 1;
}

// ---------------------------------------------------------------------------
// Drawing the apartment's furniture into the frame's sorted list.
// ---------------------------------------------------------------------------
function hubDrawables(ctx, list) {
  const h = Game.hub;
  if (!h) return;
  const P = SPR.props, t = Game.realT;
  const deskX = 2.5 * TILE, deskY = 2 * TILE + 4;
  list.push({ y: deskY, f: () => {
    blit(ctx, P.desk, deskX, deskY);
    // the monitor glows and flickers; it says ROOT ACCESS a moment after a win
    const sc = P.deskScreen, dx = Math.round(deskX - P.desk.ax), dy = Math.round(deskY - P.desk.ay);
    if (sc) {
      ctx.globalAlpha = 0.15 + 0.08 * Math.sin(t * 13) + (Math.random() < 0.03 ? 0.15 : 0);
      ctx.fillStyle = '#3cff6e';
      ctx.fillRect(dx + sc.x - 3, dy + sc.y - 3, sc.w + 6, sc.h + 6);
      ctx.globalAlpha = 1;
      const step = h.script[h.i];
      if (step && step.k === 'sleep' && step.rootAccess && h.t < 1.2) { ctx.fillStyle = '#b8ffc8'; ctx.fillRect(dx + sc.x + 1, dy + sc.y + 1, sc.w - 2, 1); ctx.fillRect(dx + sc.x + 1, dy + sc.y + 3, Math.max(1, sc.w - 4), 1); }
      else if (Math.floor(t * 2) % 2) { ctx.fillStyle = '#b8ffc8'; ctx.fillRect(dx + sc.x + 1, dy + sc.y + sc.h - 2, 2, 1); }
    }
    // stirring: he shifts in his sleep, a pixel this way and that
    if (h.asleep) blit(ctx, SPR.neo.asleep, deskX + (h.stir ? (Math.floor(t * 6) % 2 ? 1 : -1) : 0), deskY - (h.stir && Math.floor(t * 3) % 2 ? 1 : 0));
  } });
  list.push({ y: 9 * TILE, f: () => blit(ctx, P.bed, 9.5 * TILE, 9 * TILE - 2) });
  list.push({ y: 2 * TILE, f: () => blit(ctx, P.lamp, 4.6 * TILE, 2 * TILE) });
  // the door, and what's beyond it: nobody
  list.push({ y: TILE, f: () => {
    const shake = h.doorShake > 0 ? (Math.floor(t * 40) % 2 ? 1 : -1) : 0;
    const open = h.doorOpen >= 0.5;
    blit(ctx, open ? P.door.open : P.door.closed, 6 * TILE + shake, TILE + 1);
    if (open) {
      const on = Math.sin(h.bulbT * 23) + Math.sin(h.bulbT * 7.3) > -0.6;
      blit(ctx, P.corridorBulb, 6 * TILE, 2, { alpha: on ? 1 : 0.25 });
      if (h.tailT >= 0 && h.tailT < 0.7) blit(ctx, SPR.rabbitTail, 6 * TILE + 6 - h.tailT * 14, TILE - 4, { alpha: 1 - h.tailT / 0.7 });
    }
  } });
}
