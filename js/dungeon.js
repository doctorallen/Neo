'use strict';
// ---------------------------------------------------------------------------
// Floor generation. A floor is a handful of rooms on a 7×7 grid: a main path
// that walks from the entry room through the fights to the exit, never
// doubling back, with one-room side branches for the cache, the Oracle's
// terminal and the white rabbit's hidden room. Everything is drawn from
// Rng(hashInts(seed, floor)), so a run's seed always rebuilds the same floor
// (the checkpoint relies on it, and test/gen.js pins it with golden hashes).
//
// Tiles: WALL, FLOOR, BLOCK (an obstacle: stops movement and shots), PIT
// (stops movement only), DOOR (a gap in the wall; sealed while a fight is on).
// ---------------------------------------------------------------------------

const WALL = 0, FLOOR = 1, BLOCK = 2, PIT = 3, DOOR = 4;
const GRID = 7;
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };

// The rooms each floor is made of, after the entry room: how many fights
// stand between you and the exit, and which optional rooms may hang off them.
function floorRecipe(n) {
  return T.floors[n - 1];
}

class Room {
  constructor(gx, gy, kind, size) {
    this.gx = gx; this.gy = gy; this.kind = kind; this.size = size;
    [this.w, this.h] = ROOM_SIZE[size];
    this.tiles = new Uint8Array(this.w * this.h);
    this.doors = {}; // dir → { to: Room, hidden: bool }
    this.props = []; // { kind, tx, ty } things standing in the room
    this.wallDecor = []; // { kind, tx } things hung on the north wall
    this.visited = false;
    this.cleared = kind !== 'combat' && kind !== 'exit' && kind !== 'boss';
    this.seed = 0;
    this.template = '';
  }
  get key() { return this.gx + ',' + this.gy; }
  t(tx, ty) { return tx < 0 || ty < 0 || tx >= this.w || ty >= this.h ? WALL : this.tiles[ty * this.w + tx]; }
  set(tx, ty, v) { if (tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.tiles[ty * this.w + tx] = v; }
  // the two tiles of the doorway on one side
  doorCells(dir) {
    const { w, h } = this, dy = Math.floor((h - 2) / 2);
    if (dir === 'n') return [[5, 0], [6, 0]];
    if (dir === 's') return [[5, h - 1], [6, h - 1]];
    if (dir === 'w') return [[0, dy], [0, dy + 1]];
    return [[w - 1, dy], [w - 1, dy + 1]];
  }
  // where you stand on arriving through a door: just inside it, in pixels
  arrival(dir) {
    const c = this.doorCells(dir), [dx, dy] = DIRS[dir];
    const tx = (c[0][0] + c[1][0]) / 2 - dx * 1.6, ty = (c[0][1] + c[1][1]) / 2 - dy * 1.6;
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }
  centre() { return { x: this.w * TILE / 2, y: this.h * TILE / 2 }; }
}

// Builds a room's tiles from a template, mirrored at random, with its doors
// carved and the ground just inside each door cleared.
function buildRoomTiles(room, rng) {
  const set = ROOM_TEMPLATES[room.size];
  const ti = rng.i(0, set.length - 1);
  const mx = rng.chance(0.5), my = rng.chance(0.5);
  room.template = `${room.size}:${ti}${mx ? 'x' : ''}${my ? 'y' : ''}`;
  fillRoomTiles(room, set[ti], mx, my);
}

function fillRoomTiles(room, tpl, mx, my) {
  let rows = tpl.slice();
  if (my) rows.reverse();
  if (mx) rows = rows.map((r) => r.split('').reverse().join(''));
  const { w, h } = room;
  for (let ty = 0; ty < h; ty++)
    for (let tx = 0; tx < w; tx++) {
      let v = WALL;
      if (tx > 0 && ty > 0 && tx < w - 1 && ty < h - 1) {
        const ch = rows[ty - 1][tx - 1];
        v = ch === 'o' ? BLOCK : ch === 'p' ? PIT : FLOOR;
      }
      room.set(tx, ty, v);
    }
  for (const dir of Object.keys(room.doors)) carveDoor(room, dir);
}

function carveDoor(room, dir) {
  const [dx, dy] = DIRS[dir];
  for (const [cx, cy] of room.doorCells(dir)) {
    room.set(cx, cy, DOOR);
    // two tiles of clear ground inside the doorway, and either side of it
    for (let k = 1; k <= 2; k++) room.set(cx - dx * k, cy - dy * k, FLOOR);
  }
}

// Every floor tile reachable from every door (and from the middle), walking
// over FLOOR and DOOR only. Used by the tests and as a guard at generation.
function roomConnected(room) {
  const { w, h } = room, seen = new Uint8Array(w * h);
  const walk = (v) => v === FLOOR || v === DOOR;
  let start = -1, total = 0;
  for (let i = 0; i < w * h; i++) if (walk(room.tiles[i])) { total++; if (start < 0) start = i; }
  if (start < 0) return false;
  const q = [start]; seen[start] = 1; let n = 0;
  while (q.length) {
    const i = q.pop(); n++;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of Object.values(DIRS)) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!seen[j] && walk(room.tiles[j])) { seen[j] = 1; q.push(j); }
    }
  }
  return n === total;
}

// The nearest FLOOR tile to (tx, ty), searching outwards. Props and spawns
// use it so nothing lands on an obstacle.
function nearestFloor(room, tx, ty, avoid = null) {
  let best = null, bd = Infinity;
  for (let y = 1; y < room.h - 1; y++)
    for (let x = 1; x < room.w - 1; x++) {
      if (room.t(x, y) !== FLOOR) continue;
      if (avoid && avoid(x, y)) continue;
      const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
      if (d < bd) { bd = d; best = [x, y]; }
    }
  return best;
}

function generateFloor(seed, n) {
  const rng = new Rng(hashInts(seed, n, 0x5eed));
  const recipe = floorRecipe(n);
  const floor = { seed, n, sector: recipe.sector, rooms: [], grid: new Map(), entry: null, exit: null };
  const add = (gx, gy, kind, size) => {
    const r = new Room(gx, gy, kind, size);
    floor.rooms.push(r); floor.grid.set(r.key, r);
    return r;
  };
  const link = (a, dir, b, hidden = false) => {
    a.doors[dir] = { to: b, hidden };
    b.doors[OPP[dir]] = { to: a, hidden };
  };
  const free = (gx, gy) => gx >= 0 && gy >= 0 && gx < GRID && gy < GRID && !floor.grid.has(gx + ',' + gy);

  // the main path, by random walk; a walk that traps itself starts again
  const length = recipe.combat + 2; // entry, fights, exit
  let path = null;
  for (let attempt = 0; attempt < 200 && !path; attempt++) {
    const cells = [[3, 4]];
    const used = new Set(['3,4']);
    let ok = true;
    for (let i = 1; i < length && ok; i++) {
      const [cx, cy] = cells[cells.length - 1];
      // never south from the entry: you arrived from the south
      const opts = ['n', 'e', 'w', 's'].filter((d) => {
        if (i === 1 && d === 's') return false;
        const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
        return nx >= 0 && ny >= 0 && nx < GRID && ny < GRID && !used.has(nx + ',' + ny);
      });
      if (!opts.length) { ok = false; break; }
      // lean forwards (north) so floors read as a journey
      const d = rng.weighted(opts.map((o) => [o === 'n' ? 3 : o === 's' ? 0.6 : 1.4, o]));
      const nx = cx + DIRS[d][0], ny = cy + DIRS[d][1];
      cells.push([nx, ny]); used.add(nx + ',' + ny);
    }
    if (ok) path = cells;
  }
  if (!path) throw new Error('floor generation failed for seed ' + seed);

  const boss = n === T.floors.length;
  for (let i = 0; i < path.length; i++) {
    const [gx, gy] = path[i];
    let kind, size;
    if (i === 0) { kind = 'entry'; size = 'small'; }
    else if (i === path.length - 1) { kind = boss ? 'boss' : 'exit'; size = boss ? 'arena' : 'large'; }
    else { kind = 'combat'; size = rng.chance(recipe.largeChance) ? 'large' : 'std'; }
    const r = add(gx, gy, kind, size);
    if (i > 0) {
      const [px, py] = path[i - 1];
      const dir = Object.keys(DIRS).find((d) => px + DIRS[d][0] === gx && py + DIRS[d][1] === gy);
      link(floor.grid.get(px + ',' + py), dir, r);
    }
  }
  floor.entry = floor.rooms[0];
  floor.exit = floor.rooms[floor.rooms.length - 1];

  // side rooms hang off the main path (never off the exit)
  const hosts = (kinds) => floor.rooms.filter((r) => kinds.includes(r.kind));
  const attach = (kind, candidates, hidden = false) => {
    const spots = [];
    for (const h of candidates)
      for (const d of ['n', 'e', 'w', 's']) {
        if (h === floor.entry && d === 's') continue;
        const nx = h.gx + DIRS[d][0], ny = h.gy + DIRS[d][1];
        if (free(nx, ny)) spots.push([h, d, nx, ny]);
      }
    if (!spots.length) return null;
    const [h, d, nx, ny] = rng.pick(spots);
    const r = add(nx, ny, kind, 'small');
    link(h, d, r, hidden);
    return r;
  };
  if (recipe.cache) {
    const fights = hosts(['combat']);
    attach('cache', fights.length ? fights : [floor.entry]) || attach('cache', [floor.entry, ...fights]);
  }
  if (recipe.oracle && rng.chance(recipe.oracle)) attach('oracle', hosts(['combat', 'entry']));
  if (recipe.rabbit && rng.chance(recipe.rabbit)) {
    const r = attach('rabbit', hosts(['combat']), true);
    if (r) r.host = r.doors[Object.keys(r.doors)[0]].to;
  }

  // tiles, props and wall decor for every room
  for (const r of floor.rooms) {
    r.seed = rng.fork();
    const rr = new Rng(r.seed);
    buildRoomTiles(r, rr);
    furnish(r, rr, floor);
    if (!roomConnected(r)) throw new Error(`room ${r.template} on floor ${n} of seed ${seed} is not connected`);
  }
  return floor;
}

// Puts each room's fixed things in place: the cache, the terminal, the
// payphone, and the decor that hints at what's really going on.
function furnish(r, rng, floor) {
  const cx = Math.floor(r.w / 2) - 1 + rng.i(0, 1), cy = Math.floor(r.h / 2);
  const place = (kind, tx, ty) => {
    const p = nearestFloor(r, tx, ty, (x, y) => r.props.some((q) => Math.abs(q.tx - x) < 2 && Math.abs(q.ty - y) < 2));
    if (p) r.props.push({ kind, tx: p[0], ty: p[1] });
  };
  if (r.kind === 'cache' || (r.kind === 'entry' && floor.n === T.floors.length)) place('cache', cx, cy);
  if (r.kind === 'oracle') place('oracle', cx, cy - 1);
  if (r.kind === 'exit') place('phone', cx, cy);
  if (r.kind === 'rabbit') { place('rabbitcache', cx, cy + 1); r.wallDecor.push({ kind: 'window', tx: 3 + rng.i(0, 1) * 4 }); }
  // the north wall: a cracked mirror now and then in the tenement, and
  // whatever suits the sector elsewhere, never over a door
  const nDoor = !!r.doors.n;
  const spots = [1, 2, 3, 8, 9, 10].filter((tx) => !(nDoor && (tx === 4 || tx === 5 || tx === 6 || tx === 7)));
  if (r.kind !== 'rabbit' && spots.length) {
    if (floor.sector === 'tenement' && rng.chance(0.22)) r.wallDecor.push({ kind: 'mirror', tx: rng.pick(spots) });
    else if (rng.chance(0.6)) r.wallDecor.push({ kind: 'sign', tx: rng.pick(spots) });
  }
}

// A stable fingerprint of a floor, for the golden tests.
function floorHash(floor) {
  let h = 0x811c9dc5 | 0;
  const mixIn = (x) => { h = Math.imul(h ^ (x | 0), 0x01000193); };
  for (const r of floor.rooms) {
    mixIn(r.gx); mixIn(r.gy); mixIn(hashString(r.kind)); mixIn(hashString(r.template));
    for (const v of r.tiles) mixIn(v);
    for (const p of r.props) { mixIn(hashString(p.kind)); mixIn(p.tx); mixIn(p.ty); }
    for (const d of Object.keys(r.doors).sort()) { mixIn(hashString(d)); mixIn(r.doors[d].hidden ? 1 : 0); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
