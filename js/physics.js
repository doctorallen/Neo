'use strict';
// ---------------------------------------------------------------------------
// Movement against the room's tiles, line of sight, and the flow field that
// lets processes find their way round obstacles to Neo. Positions are room
// pixels; every mover is a circle of radius r.
// ---------------------------------------------------------------------------

// What stops whom. Neo may walk through an open, unhidden doorway; nothing
// else ever leaves the room. Flyers (sentinels) cross pits.
function tileBlocks(room, tx, ty, who) {
  const v = room.t(tx, ty);
  if (v === FLOOR) return false;
  if (v === PIT) return !who.flies;
  if (v === DOOR) {
    if (!who.isPlayer) return true;
    if (room.kind === 'apartment') return !apartmentDoorOpen();
    if (roomSealed()) return true;
    const dir = doorDirAt(room, tx, ty);
    return !dir || !room.doors[dir] || room.doors[dir].hidden;
  }
  return true; // WALL, BLOCK
}

function doorDirAt(room, tx, ty) {
  if (ty === 0) return 'n';
  if (ty === room.h - 1) return 's';
  if (tx === 0) return 'w';
  if (tx === room.w - 1) return 'e';
  return null;
}

// Does a circle at (x, y) overlap anything solid?
function circleBlocked(room, x, y, r, who) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r - 0.001) / TILE);
  const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (tileBlocks(room, tx, ty, who)) return true;
  return false;
}

// Moves an entity by (dx, dy), one axis at a time so it slides along walls.
// Long moves are split so nothing tunnels through a tile. Returns true if it
// bumped into something.
function moveEntity(e, dx, dy, room = Game.room) {
  let bumped = false;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 3));
  const sx = dx / steps, sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (sx) { if (!circleBlocked(room, e.x + sx, e.y, e.r, e)) e.x += sx; else bumped = true; }
    if (sy) { if (!circleBlocked(room, e.x, e.y + sy, e.r, e)) e.y += sy; else bumped = true; }
  }
  return bumped;
}

// Shots are stopped by walls, obstacles and doorways (pits let them by).
function shotBlocked(room, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  const v = room.t(tx, ty);
  if (v === FLOOR || v === PIT) return false;
  if (v === DOOR) return roomSealed() || tx <= 0 || ty <= 0 || tx >= room.w - 1 || ty >= room.h - 1;
  return true;
}

// Clear line between two points, for shots (pits don't block it).
function lineOfSight(room, ax, ay, bx, by) {
  const d = dist(ax, ay, bx, by), n = Math.ceil(d / 4);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (shotBlocked(room, lerp(ax, bx, t), lerp(ay, by, t))) return false;
  }
  return true;
}

// Breadth-first distances (in tiles) from Neo's tile over walkable ground,
// rebuilt a few times a second. Processes step to the neighbouring tile that
// is nearer; with a clear line they just go straight.
const Flow = { room: null, dist: null, walkDist: null, at: -1, tx: -1, ty: -1 };
function updateFlow(force = false) {
  const room = Game.room, p = Game.player;
  if (!room || !p) return;
  const tx = clamp(Math.floor(p.x / TILE), 0, room.w - 1), ty = clamp(Math.floor(p.y / TILE), 0, room.h - 1);
  if (!force && Flow.room === room && Flow.tx === tx && Flow.ty === ty && Game.t - Flow.at < 0.5) return;
  Flow.room = room; Flow.tx = tx; Flow.ty = ty; Flow.at = Game.t;
  const { w, h } = room, n = w * h;
  if (!Flow.dist || Flow.dist.length !== n) Flow.dist = new Int16Array(n);
  const D = Flow.dist;
  D.fill(-1);
  const q = new Int16Array(n);
  let head = 0, tail = 0;
  const start = ty * w + tx;
  D[start] = 0; q[tail++] = start;
  while (head < tail) {
    const i = q[head++], x = i % w, y = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (D[j] >= 0) continue;
      const v = room.tiles[j];
      if (v !== FLOOR && v !== DOOR) continue;
      D[j] = D[i] + 1; q[tail++] = j;
    }
  }
}

// The direction (unit vector) an enemy at (x, y) should walk to reach Neo.
function flowDir(e) {
  const room = Game.room, p = Game.player;
  // straight there when nothing is in the way of a body this size
  if (pathClear(room, e, p.x, p.y)) { const a = angleTo(e.x, e.y, p.x, p.y); return [Math.cos(a), Math.sin(a)]; }
  updateFlow();
  const D = Flow.dist, w = room.w;
  const tx = Math.floor(e.x / TILE), ty = Math.floor(e.y / TILE);
  const here = D[ty * w + tx];
  let best = null, bd = here >= 0 ? here : 9999;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = tx + dx, ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= room.w || ny >= room.h) continue;
    const d = D[ny * w + nx];
    if (d < 0) continue;
    // no cutting corners diagonally past an obstacle
    if (dx && dy && (D[ty * w + nx] < 0 || D[ny * w + tx] < 0)) continue;
    if (d < bd) { bd = d; best = [nx, ny]; }
  }
  if (!best) { const a = angleTo(e.x, e.y, p.x, p.y); return [Math.cos(a), Math.sin(a)]; }
  const a = angleTo(e.x, e.y, (best[0] + 0.5) * TILE, (best[1] + 0.5) * TILE);
  return [Math.cos(a), Math.sin(a)];
}

// Can a walker of radius r go straight from e to (bx, by)?
function pathClear(room, e, bx, by) {
  const d = dist(e.x, e.y, bx, by);
  // stop a body's width short: the target may stand closer to a wall than this body fits
  const reach = Math.max(0, d - e.r - 2), n = Math.ceil(reach / 4);
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * (reach / Math.max(d, 0.001));
    if (circleBlocked(room, lerp(e.x, bx, t), lerp(e.y, by, t), e.r, e)) return false;
  }
  return true;
}

// A random floor point in the room, for teleports and spawns, meeting `ok`.
function randomFloorPoint(room, rng, ok = () => true, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const tx = rng.i(1, room.w - 2), ty = rng.i(1, room.h - 2);
    if (room.t(tx, ty) !== FLOOR) continue;
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (ok(x, y, tx, ty)) return { x, y };
  }
  return null;
}

// The camera only moves vertically: rooms are exactly the view's width. A
// room shorter than the view sits in the middle of it.
function updateCamera(snap = false) {
  const room = Game.room, p = Game.player;
  if (!room || !p) return;
  const H = room.h * TILE, vh = Game.viewH;
  let target;
  if (H <= vh) target = -Math.floor((vh - H) / 2);
  else target = clamp(p.y - vh / 2, 0, H - vh);
  Game.camY = snap ? target : lerp(Game.camY, target, 0.18);
  if (Math.abs(Game.camY - target) < 0.3) Game.camY = target;
}

function onScreen(x, y, margin = 0) {
  return y >= Game.camY - margin && y <= Game.camY + Game.viewH + margin;
}
