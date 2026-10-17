'use strict';
// ---------------------------------------------------------------------------
// The things in a room you walk up to: loot on the floor, the data cache you
// decrypt by standing in its ring, the Oracle's terminal, the payphone, and
// two small visitors (the white rabbit, who shows you a hidden door, and the
// black cat you see twice). Loot can only be inspected once the room is
// clear; integrity orbs are picked up any time.
// ---------------------------------------------------------------------------

Game.critters = [];

function pickupRadius() {
  const s = Game.run && Game.run.stats;
  return 9 * (1 + (s ? s.pickup : 0));
}

function updateDrops(dt) {
  const p = Game.player, run = Game.run;
  const clear = !roomSealed();
  for (const d of Game.drops) {
    if (d.gone) continue;
    d.t += dt;
    if (d.t < 0.35) { const k = d.t / 0.35; d.x = lerp(d.x, d.tx, 0.25); d.y = lerp(d.y, d.ty, 0.25); d.z = Math.sin(k * Math.PI) * 6; continue; }
    d.z = 0;
    const dd = dist(d.x, d.y, p.x, p.y);
    if (d.kind === 'orb') {
      const R = pickupRadius();
      if (dd < R * 2.6 && run.hp < run.stats.maxHp) { const a = angleTo(d.x, d.y, p.x, p.y); d.x += Math.cos(a) * 70 * dt; d.y += Math.sin(a) * 70 * dt; }
      if (dd < R && run.hp < run.stats.maxHp) {
        d.gone = true;
        healPlayer(Math.max(T.drops.orbHealMin, run.stats.maxHp * T.drops.orbHeal));
        Sound.play('pickup_orb');
        buzz(8);
      }
    } else if (d.kind === 'item') {
      if (!clear || Game.modal || Game.flow) { d.near = dd < 14; continue; }
      if (dd < pickupRadius() && !d.blocked) pickupDrop(d);
      if (dd > 14) d.blocked = false;
    }
  }
  room_prune();
}

function room_prune() {
  const room = Game.room;
  if (!room || !room.drops) return;
  room.drops = room.drops.filter((d) => !d.gone);
  Game.drops = room.drops;
}

function pickupDrop(d) {
  const it = d.item;
  d.gone = true;
  receiveItem(it, () => { /* resolved */ }, d);
}

// An item reaching Neo: straight on if the slot is empty, scrapped if it's
// below the auto-scrap line, otherwise the compare card decides.
function receiveItem(it, done = () => {}, drop = null) {
  const run = Game.run;
  if (it.unique) discoverZeroDay(it.unique);
  Sound.play('pickup_' + it.rarity);
  buzz(8);
  if (!run.gear[it.slot]) { equipItem(it); UI.toast(`EQUIPPED ${it.name}`, it.rarity); done(); return; }
  const line = Save.settings.autoScrap; // 0 off, 1 Common, 2 Uncommon
  if (!it.unique && it.rarity < line) { scrapItem(it); done(); return; }
  UI.openCompare(it, (choice) => {
    if (choice === 'equip') equipItem(it);
    else if (choice === 'scrap') scrapItem(it);
    else if (choice === 'leave' && drop) { drop.gone = false; drop.blocked = true; Game.drops.push(drop); Game.room.drops = Game.drops; }
    done();
  });
}

function equipItem(it) {
  const run = Game.run;
  const old = run.gear[it.slot];
  run.gear[it.slot] = it;
  if (old) scrapItem(old, true);
  noteBest(it);
  refreshStats();
  Sound.play('equip');
  UI.hintDone('loot');
}

function scrapItem(it, quiet = false) {
  const got = addData(T.rarity.scrap[it.rarity]);
  Sound.play('scrap', { vol: quiet ? 0.4 : 0.7 });
  if (!quiet) UI.toast(`SCRAPPED ${it.name} +${Math.round(got)} DATA`, it.rarity);
}

function discoverZeroDay(id) {
  if (!Save.meta.zeroDays[id]) { Save.meta.zeroDays[id] = true; Save.data.records.legendaries++; Save.write(); }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
function propPos(p) { return { x: (p.tx + 0.5) * TILE, y: (p.ty + 0.5) * TILE + 4 }; }

function updateProps(dt) {
  const room = Game.room, pl = Game.player, run = Game.run;
  if (!room || !room.props || Game.modal || Game.flow) return;
  for (const pr of room.props) {
    const { x, y } = propPos(pr);
    const d = dist(x, y, pl.x, pl.y);
    if (pr.kind === 'cache' || pr.kind === 'rabbitcache') {
      if (pr.open) continue;
      if (roomSealed()) continue;
      if (d < 24) {
        const speed = run.stats.powers.keymaker ? 2 : 1;
        const before = pr.progress || 0;
        pr.progress = Math.min(1, before + (dt / 1.6) * speed);
        if (Math.floor(pr.progress * 8) > Math.floor(before * 8)) Sound.play('decrypt_tick', { pitch: 1 + pr.progress });
        UI.hintDone('decrypt');
        if (pr.progress >= 1) openCache(pr);
      }
    } else if (pr.kind === 'oracle') {
      if (!pr.spent && d < 14) { pr.spent = true; UI.openOracle(oracleEvent(room)); }
    } else if (pr.kind === 'phone') {
      if (!room.cleared) continue;
      pr.ringT = (pr.ringT || 0) - dt;
      if (pr.ringT <= 0) { pr.ringT = 2.2; Sound.play('phone_ring', { vol: 0.6 }); }
      if (d < 11) { pr.hold = (pr.hold || 0) + dt; if (pr.hold >= 0.5) { pr.answered = true; UI.hintDone('phone'); answerPhone(); } }
      else pr.hold = 0;
    }
  }
}

function openCache(pr) {
  const run = Game.run, n = run.floorN, s = run.stats;
  pr.open = true;
  Sound.play('decrypt_done');
  if (pr.kind === 'rabbitcache') {
    addData(T.drops.rabbitData);
    UI.feed(`> +${T.drops.rabbitData} data`);
    const it = rollItem(run.rng, { ilvl: n, luck: s.luck, min: 2 });
    receiveItem(it);
    return;
  }
  let count = T.drops.cacheChoices + (s.powers.scavenger ? 1 : 0) + (s.powers.keymaker ? 1 : 0);
  const min = n >= 5 ? 2 : 1;
  const items = [];
  for (let i = 0; i < count; i++) {
    const opts = { ilvl: n, luck: s.luck, min };
    if (i === 0 && (n === 2 || n === 4)) opts.slot = 'exploit';
    items.push(rollItem(run.rng, opts));
  }
  UI.openCache(items, (chosen) => {
    for (const it of items) {
      if (it === chosen) continue;
      scrapItem(it, true);
    }
    if (chosen) {
      if (chosen.unique) discoverZeroDay(chosen.unique);
      equipItem(chosen);
      UI.toast(`EQUIPPED ${chosen.name}`, chosen.rarity);
    }
  });
}

// ---------------------------------------------------------------------------
// The Oracle: one of a handful of offers, each with a cost.
// ---------------------------------------------------------------------------
const ORACLE_EVENTS = [
  { id: 'cookie', title: 'Have a cookie.', text: "You'll feel right as rain.", choices: [{ label: 'Take the cookie (heal 40%)', act: () => healPlayer(Game.run.stats.maxHp * 0.4) }] },
  { id: 'blood', title: 'Blood for code.', text: 'Everything has a price.', choices: [{ label: 'Pay 30% integrity for a Rare-or-better item', act: () => { const r = Game.run; r.hp = Math.max(1, Math.round(r.hp * 0.7)); receiveItem(rollItem(r.rng, { ilvl: r.floorN, luck: r.stats.luck, min: 2 })); } }] },
  { id: 'rewrite', title: 'Rewrite.', text: 'What is written can be written again.', choices: [
    { label: 'Reroll your Exploit', when: () => !!Game.run.gear.exploit && !Game.run.gear.exploit.unique, act: () => rewriteItem('exploit') },
    { label: 'Reroll your Coat', when: () => !!Game.run.gear.coat && !Game.run.gear.coat.unique, act: () => rewriteItem('coat') },
  ] },
  { id: 'spoon', title: 'Do not try to bend the spoon.', text: 'Only try to realise the truth.', choices: [{ label: 'Take a random patch (processes +10% integrity this floor)', act: () => { const r = Game.run; const id = patchOffer(r.rng, r.patches, 3, 1)[0]; if (id) { r.patches.push(id); if (PATCH[id].onTake) PATCH[id].onTake(); refreshStats(); UI.toast(`PATCH ${PATCH[id].name}`, 2); } r.spoonFloor = r.floorN; } }] },
  { id: 'glitch', title: 'A glitch.', text: 'It happens when they change something.', choices: [{ label: 'Take 40 Data', act: () => { addData(40); UI.toast('+40 DATA', 1); } }, { label: 'A fourth choice at the next patch pick', act: () => { Game.run.extraPick = true; } }] },
  { id: 'pills', title: 'Red pill, or blue?', text: 'All I am offering is the truth.', noLeave: true, choices: [
    { label: 'Red: +15% damage this run, −15 max integrity', act: () => { Game.run.pill = 'red'; refreshStats(); } },
    { label: 'Blue: heal to full, +20 max integrity', act: () => { Game.run.pill = 'blue'; refreshStats(); Game.run.hp = Game.run.stats.maxHp; } },
  ] },
];

function oracleEvent(room) {
  const rng = new Rng(hashInts(room.seed, 7));
  return rng.pick(ORACLE_EVENTS);
}

function rewriteItem(slot) {
  const r = Game.run, old = r.gear[slot];
  const it = rollItem(r.rng, { slot, ilvl: old.ilvl, rarity: old.rarity, base: old.base, allowZeroDay: false });
  r.gear[slot] = it;
  refreshStats();
  UI.toast(`REWRITTEN ${it.name}`, it.rarity);
}

// ---------------------------------------------------------------------------
// The white rabbit and the black cat
// ---------------------------------------------------------------------------
function spawnRabbit(room, target) {
  const dir = Object.keys(room.doors).find((k) => room.doors[k].to === target);
  const cells = room.doorCells(dir), [dx, dy] = DIRS[dir];
  const gx = ((cells[0][0] + cells[1][0]) / 2 + 0.5 - dx * 1.2) * TILE, gy = ((cells[0][1] + cells[1][1]) / 2 + 0.5 - dy * 1.2) * TILE;
  const start = randomFloorPoint(room, Game.run.rng, (x, y) => dist(x, y, gx, gy) > 60 && onScreen(x, y, -10)) || room.centre();
  Game.critters.push({ kind: 'rabbit', x: start.x, y: start.y, gx, gy, t: 0, dir, room, target, hop: 0, facing: gx > start.x ? 1 : -1, r: 3 });
  UI.feed('> follow the white rabbit.');
}

function updateCritters(dt) {
  for (const c of Game.critters) {
    c.t += dt;
    if (c.kind === 'rabbit') {
      if (c.room !== Game.room) { revealHidden(c.room, c.dir); c.gone = true; continue; }
      if (c.t < 0.8) continue; // sits a moment so you notice it
      c.hop += dt;
      const d = dist(c.x, c.y, c.gx, c.gy);
      if (d < 3) { c.fade = (c.fade || 0) + dt; if (c.fade > 0.4) { revealHidden(c.room, c.dir); c.gone = true; } continue; }
      // hops: quick bursts of movement
      const moving = (c.hop % 0.45) < 0.25;
      if (moving) { const a = angleTo(c.x, c.y, c.gx, c.gy); c.x += Math.cos(a) * 70 * dt; c.y += Math.sin(a) * 70 * dt; c.facing = Math.cos(a) >= 0 ? 1 : -1; }
      c.air = moving;
    } else if (c.kind === 'cat') {
      if (c.room !== Game.room) { c.gone = true; continue; }
      if (c.t < c.delay) continue;
      c.x += c.v * dt;
      if ((c.v > 0 && c.x > c.x1) || (c.v < 0 && c.x < c.x1)) {
        if (c.pass === 0) { c.pass = 1; c.x = c.x0; c.t = c.delay - 0.7; }
        else c.gone = true;
      }
    }
  }
  Game.critters = Game.critters.filter((c) => !c.gone);
}

function revealHidden(room, dir) {
  const d = room.doors[dir];
  if (!d || !d.hidden) return;
  d.hidden = false;
  const back = d.to.doors[OPP[dir]];
  if (back) back.hidden = false;
  Sound.play('door_open', { pitch: 1.3 });
  spawnRing((room.doorCells(dir)[0][0] + 1) * TILE, (room.doorCells(dir)[0][1] + 0.5) * TILE, '#ffffff', 20);
}

// The black cat crosses the room, and then — the same cat, the same way.
function spawnCat(room) {
  const y = randomFloorPoint(room, Game.run.rng, (x, yy) => onScreen(x, yy, -16)) || room.centre();
  const ltr = Game.run.rng.chance(0.5);
  const x0 = ltr ? TILE * 0.5 : room.w * TILE - TILE * 0.5, x1 = ltr ? room.w * TILE : 0;
  Game.critters.push({ kind: 'cat', x: x0, y: y.y, x0, x1, v: ltr ? 26 : -26, t: 0, delay: 1.2, pass: 0, room, facing: ltr ? 1 : -1 });
}
