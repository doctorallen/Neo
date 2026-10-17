'use strict';
// Dungeon generation, without a browser:
//  - every room template, in every mirroring and with every set of doors, is
//    one connected floor with room to spawn in;
//  - 500 seeds × 5 floors: the right rooms, every room reachable from the
//    entry, doors that agree on both sides, the exit reachable without the
//    rabbit's hidden door, props on open floor, and generation that repeats
//    exactly for the same seed;
//  - golden hashes for three seeds pin generation, so a change to it has to
//    be meant (re-record with --update).
const fs = require('fs');
const path = require('path');
const { sandbox } = require('./sandbox');
const { finish } = require('./lib-node');

const N = sandbox(['js/util.js', 'js/tuning.js', 'js/rooms.js', 'js/dungeon.js']);
const failures = [];
const GOLDEN = path.join(__dirname, 'golden.json');
const update = process.argv.includes('--update');

// 1. templates
let combos = 0;
for (const [size, set] of Object.entries(N.ROOM_TEMPLATES)) {
  set.forEach((tpl, ti) => {
    const [w, h] = N.ROOM_SIZE[size];
    if (tpl.length !== h - 2) failures.push(`${size}:${ti} has ${tpl.length} rows, wants ${h - 2}`);
    for (const row of tpl) if (row.length !== w - 2) failures.push(`${size}:${ti} has a row of ${row.length}, wants ${w - 2}`);
    for (let mask = 0; mask < 16; mask++)
      for (const mx of [false, true])
        for (const my of [false, true]) {
          const r = new N.Room(0, 0, 'combat', size);
          ['n', 's', 'e', 'w'].forEach((d, i) => { if (mask & (1 << i)) r.doors[d] = { to: null, hidden: false }; });
          N.fillRoomTiles(r, tpl, mx, my);
          combos++;
          if (!N.roomConnected(r)) failures.push(`template ${size}:${ti}${mx ? 'x' : ''}${my ? 'y' : ''} doors ${mask} is not connected`);
          let open = 0;
          for (const v of r.tiles) if (v === N.FLOOR) open++;
          if (open < 30) failures.push(`template ${size}:${ti} has only ${open} floor tiles`);
        }
  });
}

// 2. floors
const seeds = 500;
let roomsSeen = 0, rabbits = 0, oracles = 0, honeypots = 0, ports = 0;
for (let s = 1; s <= seeds; s++) {
  const seed = N.hashInts(s, 77);
  for (let n = 1; n <= 5; n++) {
    let f;
    try { f = N.generateFloor(seed, n); } catch (e) { failures.push(`seed ${seed} floor ${n}: ${e.message}`); continue; }
    const recipe = N.T.floors[n - 1];
    const where = `seed ${seed} floor ${n}`;
    const kinds = f.rooms.map((r) => r.kind);
    const count = (k) => kinds.filter((x) => x === k).length;
    roomsSeen += f.rooms.length;
    if (count('entry') !== 1) failures.push(`${where}: ${count('entry')} entry rooms`);
    if (n < 5 && count('exit') !== 1) failures.push(`${where}: ${count('exit')} exits`);
    if (n === 5 && count('boss') !== 1) failures.push(`${where}: ${count('boss')} boss rooms`);
    if (count('combat') !== recipe.combat) failures.push(`${where}: ${count('combat')} fights, wants ${recipe.combat}`);
    if (recipe.cache && count('cache') !== 1) failures.push(`${where}: ${count('cache')} caches`);
    if (n === 5 && !f.entry.props.some((p) => p.kind === 'cache')) failures.push(`${where}: no cache before the Agent`);
    if (f.entry.doors.s) failures.push(`${where}: the entry room has a south door`);
    rabbits += count('rabbit'); oracles += count('oracle');
    // the backdoor: at most one, only on sectors 2-4, a known variant, off a fight, its terminal in place
    if (count('backdoor') > (recipe.backdoor ? 1 : 0)) failures.push(`${where}: ${count('backdoor')} backdoors`);
    for (const b of f.rooms.filter((r) => r.kind === 'backdoor')) {
      if (b.variant === 'honeypot') honeypots++; else if (b.variant === 'port') ports++; else failures.push(`${where}: a backdoor of kind ${b.variant}`);
      if (b.variant === 'port' && !b.props.some((p) => p.kind === 'backdoor')) failures.push(`${where}: an open port with no terminal`);
      if (b.cleared !== (b.variant === 'port')) failures.push(`${where}: a ${b.variant} that starts ${b.cleared ? 'cleared' : 'sealed'}`);
      const host = Object.values(b.doors)[0].to;
      if (host.kind !== 'combat' || Object.values(b.doors).length !== 1 || Object.values(b.doors)[0].hidden) failures.push(`${where}: a backdoor that isn't a dead end off a fight`);
    }
    // the Harvester's room: sector 2's exit, never entered from the north,
    // its top two rows wall, the row under them clear for the eyes
    const harv = f.rooms.filter((r) => r.harvester);
    if (harv.length !== (recipe.harvester ? 1 : 0) || (harv[0] && harv[0] !== f.exit)) failures.push(`${where}: ${harv.length} Harvester rooms`);
    for (const r of harv) {
      if (r.doors.n) failures.push(`${where}: the Harvester's room has a north door`);
      for (let tx = 1; tx < r.w - 1; tx++) {
        if (r.t(tx, 1) !== N.WALL || r.t(tx, 2) !== N.WALL) failures.push(`${where}: the Harvester's wall is open at ${tx}`);
        if (r.t(tx, 3) !== N.FLOOR) failures.push(`${where}: the row under the Harvester is blocked at ${tx}`);
      }
      if (!r.props.some((p) => p.kind === 'phone') || r.wallDecor.length) failures.push(`${where}: the Harvester's room is furnished wrong`);
    }
    // doors agree and match the grid
    for (const r of f.rooms) {
      for (const [d, link] of Object.entries(r.doors)) {
        const back = link.to.doors[N.OPP[d]];
        if (!back || back.to !== r) failures.push(`${where}: door ${d} of ${r.key} has no way back`);
        if (link.to.gx !== r.gx + N.DIRS[d][0] || link.to.gy !== r.gy + N.DIRS[d][1]) failures.push(`${where}: door ${d} of ${r.key} leads to a room that isn't next door`);
        if (back && back.hidden !== link.hidden) failures.push(`${where}: a door hidden on one side only`);
        for (const [cx, cy] of r.doorCells(d)) if (r.t(cx, cy) !== N.DOOR) failures.push(`${where}: ${r.key} door ${d} not carved`);
        if (link.hidden && link.to.kind !== 'rabbit' && r.kind !== 'rabbit') failures.push(`${where}: a hidden door that isn't the rabbit's`);
      }
      if (!N.roomConnected(r)) failures.push(`${where}: room ${r.key} (${r.template}) not connected`);
      for (const p of r.props) if (r.t(p.tx, p.ty) !== N.FLOOR) failures.push(`${where}: ${p.kind} placed on tile ${r.t(p.tx, p.ty)}`);
      if (r.kind === 'exit' && !r.props.some((p) => p.kind === 'phone')) failures.push(`${where}: no payphone in the exit`);
    }
    // every room reachable; the exit without hidden doors
    const reach = (allowHidden) => {
      const seen = new Set([f.entry]), q = [f.entry];
      while (q.length) { const r = q.pop(); for (const l of Object.values(r.doors)) if ((allowHidden || !l.hidden) && !seen.has(l.to)) { seen.add(l.to); q.push(l.to); } }
      return seen;
    };
    if (reach(true).size !== f.rooms.length) failures.push(`${where}: some rooms unreachable`);
    if (!reach(false).has(f.exit)) failures.push(`${where}: the exit needs a hidden door`);
    // the same seed, the same floor
    if (N.floorHash(N.generateFloor(seed, n)) !== N.floorHash(f)) failures.push(`${where}: generation isn't repeatable`);
  }
}

// 3. golden hashes
const golden = {};
for (const seed of [1, 42, 31415]) golden[seed] = [1, 2, 3, 4, 5].map((n) => N.floorHash(N.generateFloor(seed, n)));
if (update || !fs.existsSync(GOLDEN)) {
  fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
  console.log('gen: golden hashes recorded');
} else {
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  for (const seed of Object.keys(golden)) if (JSON.stringify(want[seed]) !== JSON.stringify(golden[seed])) failures.push(`golden hashes changed for seed ${seed} (re-record with npm run gen:update if meant)`);
}

console.log(`gen: ${combos} template combinations, ${seeds * 5} floors, ${roomsSeen} rooms (${rabbits} rabbit rooms, ${oracles} oracles, ${honeypots} honeypots, ${ports} open ports)`);
if (honeypots < 100 || ports < 100) failures.push(`too few backdoors: ${honeypots} honeypots, ${ports} open ports`);
finish('gen', failures);
