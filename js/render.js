'use strict';
// ---------------------------------------------------------------------------
// Drawing a frame. The world is drawn into a buffer exactly one room wide
// (VIEW_W px) and as tall as the room view allows, then scaled up by a whole
// number of device pixels with smoothing off, so every pixel is a crisp block.
// The room's floor and walls are painted once into a cached canvas; props,
// processes, Neo, loot and effects are drawn over it each frame, sorted by
// their feet so whatever is nearer the bottom stands in front.
// ---------------------------------------------------------------------------

const View = { canvas: null, ctx: null, buf: null, bctx: null, scale: 3, offX: 0, offY: 0, w: 0, h: 0 };
const _tintCache = new Map();
let _tintSerial = 0;

function tintOf(src, col) {
  if (!src) return null;
  if (!src._tid) src._tid = ++_tintSerial;
  const key = src._tid + col;
  let t = _tintCache.get(key);
  if (!t) { t = tinted(src, col); _tintCache.set(key, t); }
  return t;
}
// Colours a light-grey sprite while keeping its shading (loot icons by rarity).
function shadeOf(src, col) {
  if (!src._tid) src._tid = ++_tintSerial;
  const key = 'm' + src._tid + col;
  let t = _tintCache.get(key);
  if (!t) {
    const [c, x] = makeCanvas(src.width, src.height);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(src, 0, 0);
    c.ax = src.ax; c.ay = src.ay;
    _tintCache.set(key, t = c);
  }
  return t;
}
const _flipCache = new WeakMap();
function flipOf(src) {
  let f = _flipCache.get(src);
  if (!f) { f = flipped(src); f.ax = src.width - 1 - (src.ax || 0); f.ay = src.ay; _flipCache.set(src, f); }
  return f;
}

function setupView() {
  View.canvas = $('view');
  View.ctx = View.canvas.getContext('2d');
  [View.buf, View.bctx] = makeCanvas(VIEW_W, 240);
  resizeView();
}

// Fits the buffer to the room view's size on screen.
function resizeView() {
  const c = View.canvas, rect = c.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, Math.round(rect.width * dpr)), H = Math.max(1, Math.round(rect.height * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  View.scale = Math.max(1, Math.floor(W / VIEW_W));
  const bh = Math.max(120, Math.floor(H / View.scale));
  if (View.buf.height !== bh) { View.buf.height = bh; View.bctx.imageSmoothingEnabled = false; }
  View.offX = Math.floor((W - VIEW_W * View.scale) / 2);
  View.offY = Math.floor((H - bh * View.scale) / 2);
  View.w = W; View.h = H;
  View.ctx.imageSmoothingEnabled = false;
  Game.viewH = bh;
}

// A sprite drawn with its anchor at (x, y), optionally flipped and tinted.
function blit(ctx, img, x, y, { flip = false, alpha = 1, tint = null } = {}) {
  if (!img) return;
  let src = flip ? flipOf(img) : img;
  if (tint) { const t = tintOf(src, tint); t.ax = src.ax; t.ay = src.ay; src = t; }
  const ax = src.ax !== undefined ? src.ax : src.width / 2, ay = src.ay !== undefined ? src.ay : src.height;
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(src, Math.round(x - ax), Math.round(y - ay));
  if (alpha < 1) ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// The room's floor and walls, painted once per room (again after a hidden
// door opens).
// ---------------------------------------------------------------------------
function roomSector(room) {
  return room.sector || (Game.run && Game.run.floor ? Game.run.floor.sector : 'tenement');
}

function roomBackground(room) {
  const key = Object.values(room.doors).map((d) => (d.hidden ? 1 : 0)).join('');
  if (room._bg && room._bgKey === key) return room._bg;
  const sector = roomSector(room), tiles = sectorTiles(sector), pal = SECTOR_PAL[sector];
  const [c, x] = makeCanvas(room.w * TILE, room.h * TILE);
  x.fillStyle = pal.bg; x.fillRect(0, 0, c.width, c.height);
  const hiddenDoor = (tx, ty) => { const d = doorDirAt(room, tx, ty); return d && room.doors[d] && room.doors[d].hidden; };
  const isWall = (tx, ty) => { const v = room.t(tx, ty); return v === WALL || (v === DOOR && hiddenDoor(tx, ty)); };
  for (let ty = 0; ty < room.h; ty++)
    for (let tx = 0; tx < room.w; tx++) {
      const v = room.t(tx, ty), px = tx * TILE, py = ty * TILE;
      const h = hashInts(room.seed, tx, ty);
      if (v === FLOOR || v === BLOCK) x.drawImage(tiles.floor[h % 10 < 7 ? 0 : 1 + (h % 3)], px, py);
      else if (v === PIT) x.drawImage(tiles.pit, px, py);
      else if (v === DOOR && !hiddenDoor(tx, ty)) x.drawImage(tiles.doorOpen, px, py);
      else if (isWall(tx, ty)) {
        const below = ty < room.h - 1 && !isWall(tx, ty + 1) && tx > 0 && tx < room.w - 1;
        x.drawImage(below ? tiles.wallFace[h % 2] : tiles.wallTop, px, py);
      }
    }
  // obstacles stand up off the floor: a lid above, a face below
  for (let ty = 0; ty < room.h; ty++)
    for (let tx = 0; tx < room.w; tx++) {
      if (room.t(tx, ty) !== BLOCK || room.furnished) continue;
      const px = tx * TILE, py = ty * TILE, h = hashInts(room.seed, tx, ty, 3);
      const aboveBlock = room.t(tx, ty - 1) === BLOCK;
      x.drawImage(tiles.wallFace[h % 2], 0, 8, 16, 8, px, py + 8, 16, 8);
      x.drawImage(tiles.wallTop, 0, 0, 16, aboveBlock ? 16 : 14, px, py - (aboveBlock ? 8 : 6), 16, aboveBlock ? 16 : 14);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(px, py + 15, 16, 1);
    }
  // things hung on the north wall
  for (const d of room.wallDecor || []) {
    let img = null;
    if (d.kind === 'sign') img = SPR.props.sign[sector] || SPR.props.sign.tenement;
    else img = SPR.props[d.kind];
    if (!img) continue;
    const cx = d.tx * TILE + TILE / 2;
    x.drawImage(img, Math.round(cx - img.width / 2), Math.max(0, TILE - img.height - 1));
  }
  room._bg = c; room._bgKey = key;
  return c;
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------
function renderFrame() {
  const ctx = View.bctx, W = VIEW_W, H = View.buf.height;
  const room = Game.room;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#010302';
  ctx.fillRect(0, 0, W, H);
  if (room && (Game.scene === 'run' || Game.scene === 'hub')) {
    const sx = Game.shake > 0 ? Math.round((Math.random() - 0.5) * Game.shake) : 0;
    const sy = Game.shake > 0 ? Math.round((Math.random() - 0.5) * Game.shake) : 0;
    ctx.setTransform(1, 0, 0, 1, sx, Math.round(-Game.camY) + sy);
    drawRoom(ctx, room);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawOverlays(ctx, W, H);
  }
  // to the screen
  const v = View.ctx;
  v.setTransform(1, 0, 0, 1, 0, 0);
  v.fillStyle = '#010302';
  v.fillRect(0, 0, View.w, View.h);
  v.imageSmoothingEnabled = false;
  const S = View.scale;
  if (Game.glitch > 0.05 && !Save.settings.reducedFlash) {
    // a tear: horizontal slices knocked sideways
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y0 = Math.floor((i / n) * H), hh = Math.ceil(H / n);
      const off = Math.random() < Game.glitch ? Math.round((Math.random() - 0.5) * 18 * Game.glitch) : 0;
      v.drawImage(View.buf, 0, y0, W, hh, View.offX + off * S, View.offY + y0 * S, W * S, hh * S);
    }
  } else {
    v.drawImage(View.buf, 0, 0, W, H, View.offX, View.offY, W * S, H * S);
  }
}

function drawRoom(ctx, room) {
  ctx.drawImage(roomBackground(room), 0, 0);
  const t = Game.realT;
  // doorways sealed by the firewall
  if (roomSealed()) {
    const tiles = sectorTiles(roomSector(room));
    for (const dir of Object.keys(room.doors)) {
      if (room.doors[dir].hidden) continue;
      for (const [cx, cy] of room.doorCells(dir)) ctx.drawImage(tiles.doorSealed[Math.floor(t * 6) % 2], cx * TILE, cy * TILE);
    }
  }
  // the doorway Neo came in by on the first floor, collapsing into code
  if (Game.arrivalCollapse > 0 && room.kind === 'entry' && Game.run && Game.run.floorN === 1) drawCollapse(ctx, room);
  if (room.harvester) drawHarvester(ctx, room);
  drawHazardsUnder(ctx);
  // everything that stands, sorted by its feet
  const list = [];
  for (const pr of room.props || []) list.push({ y: (pr.ty + 0.5) * TILE + 4, f: () => drawProp(ctx, pr) });
  if (Game.scene === 'hub') hubDrawables(ctx, list);
  for (const d of Game.drops) list.push({ y: d.y, f: () => drawDrop(ctx, d) });
  for (const e of Game.enemies) list.push({ y: e.y, f: () => drawEnemy(ctx, e) });
  for (const c of Game.critters) list.push({ y: c.y, f: () => drawCritter(ctx, c) });
  const p = Game.player;
  if (p && !p.hidden) list.push({ y: p.y, f: () => drawPlayer(ctx, p) });
  const dc = Game.decoy;
  if (dc) list.push({ y: dc.y, f: () => blit(ctx, SPR.neo.coat.phase, dc.x, dc.y, { flip: dc.facing < 0, alpha: 0.35 + 0.25 * Math.min(1, dc.t) }) });
  list.sort((a, b) => a.y - b.y);
  for (const it of list) it.f();
  if (p && !p.hidden && Game.scene === 'run') drawAim(ctx, p);
  drawHazardsOver(ctx);
  drawShots(ctx);
  drawBullets(ctx);
  drawFx(ctx);
  drawFloats(ctx);
}

// Where Neo is hacking: brackets on the process the aim assist picked, or a
// short dotted line along the aim when nothing is in the way.
function drawAim(ctx, p) {
  if (p.aimAng === null) return;
  const e = p.aimTarget;
  if (e && !e.dead) {
    const hw = Math.round(e.hr + 3), cx = Math.round(e.x), cy = Math.round(e.y - e.h / 2);
    const x0 = cx - hw, y0 = cy - hw, x1 = cx + hw, y1 = cy + hw;
    ctx.fillStyle = '#b8ffc8';
    ctx.globalAlpha = 0.85;
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.fillRect(sx > 0 ? x : x - 2, y, 3, 1);
      ctx.fillRect(x, sy > 0 ? y : y - 2, 1, 3);
    }
    ctx.globalAlpha = 1;
    return;
  }
  const ox = p.x, oy = p.y - 7, c = Math.cos(p.aimAng), s = Math.sin(p.aimAng);
  ctx.fillStyle = '#b8ffc8';
  for (let i = 0; i < 4; i++) {
    const d = 12 + i * 7;
    ctx.globalAlpha = 0.6 - i * 0.12;
    ctx.fillRect(Math.round(ox + c * d), Math.round(oy + s * d), 1, 1);
  }
  ctx.globalAlpha = 1;
}

// The Harvester: cracks spreading through the wall, then the machine in it
// with its eyes, vents and scanner, then its wreck.
function drawHarvester(ctx, room) {
  const H = room.harv, S = SPR.harvester, t = Game.realT;
  if (!H) { if (room.cleared) ctx.drawImage(S.wreck, 0, 0); return; }
  if (H.state === 'waking') {
    const k = clamp(H.t / T.harvester.intro, 0, 1), n = Math.floor(S.cracks.length * k);
    for (let i = 0; i < n; i++) {
      const [x, y] = S.cracks[i];
      ctx.fillStyle = i > n - 12 ? '#ffffff' : (i * 7) % 5 ? '#ff4060' : '#ffb0c0';
      ctx.fillRect(x, y, 1, 1);
    }
    return;
  }
  if (H.state === 'dead') {
    ctx.drawImage(S.wreck, 0, 0);
    // sparks from the empty sockets for a while
    if (H.t < 6 && Math.random() < 0.3) for (const ex of HARVESTER_EYES) { ctx.fillStyle = Math.random() < 0.5 ? '#ffb43a' : '#ffffff'; ctx.fillRect(Math.round(ex - 4 + Math.random() * 8), Math.round(44 + Math.random() * 8), 1, 1); }
    return;
  }
  ctx.drawImage(H.hurtT > 0 && Math.floor(t * 30) % 2 ? tintOf(S.body, '#ffffff') : S.body, 0, 0);
  // the scanner sweeping its slot in the brow
  const sx = 71 + Math.round((Math.sin(t * 2.2) * 0.5 + 0.5) * 48);
  ctx.fillStyle = '#ff4060'; ctx.fillRect(sx - 1, 13, 4, 1);
  ctx.fillStyle = '#ffd0d8'; ctx.fillRect(sx, 13, 2, 1);
  // vents glow while they open
  if (H.ventOpenT > 0) for (const vx of HARVESTER_VENTS) { ctx.globalAlpha = H.ventOpenT; ctx.fillStyle = '#ff4060'; ctx.fillRect(vx - 5, 42, 11, 4); ctx.globalAlpha = 1; }
  const p = Game.player;
  for (const e of H.eyes) drawHarvesterEye(ctx, e, p, t);
}

function drawHarvesterEye(ctx, e, p, t) {
  const cx = e.x, cy = 48;
  if (e.dead) {
    ctx.fillStyle = '#000'; ellipseArea(ctx, cx, cy, 7, 6);
    if (Math.random() < 0.25) { ctx.fillStyle = '#ffb43a'; ctx.fillRect(Math.round(cx - 4 + Math.random() * 8), Math.round(cy - 3 + Math.random() * 6), 1, 1); }
    return;
  }
  // lids: shut, or opening in its first second
  const lid = e.state === 'shut' ? 1 : e.graceT > 0 ? clamp(e.graceT / T.spawnGrace, 0, 1) : 0;
  const charging = e.state === 'tell';
  const hot = charging && Math.floor(t * (e.stateT < 0.3 ? 30 : 12)) % 2;
  ctx.fillStyle = '#3a0010'; ellipseArea(ctx, cx, cy, 7, 6);
  ctx.fillStyle = e.flashT > 0 ? '#ffffff' : hot ? '#ff8a9a' : '#a01028'; ellipseArea(ctx, cx, cy, 5, 4);
  ctx.fillStyle = e.flashT > 0 ? '#ffffff' : hot ? '#ffffff' : '#ff2a4a'; ellipseArea(ctx, cx, cy, 3, 2);
  // the pupil follows Neo
  const a = angleTo(cx, cy, p.x, p.y - 6), px = Math.round(cx + Math.cos(a) * 2), py = Math.round(cy + Math.sin(a) * 1.5);
  ctx.fillStyle = charging ? '#ffffff' : '#1a0006'; ctx.fillRect(px - 1, py - 1, 2, 3);
  ctx.fillStyle = '#ffd0d8'; ctx.fillRect(cx - 3, cy - 3, 1, 1);
  if (charging) { ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t * 30); ctx.fillStyle = '#ff4060'; ellipseArea(ctx, cx, cy, 9, 8); ctx.globalAlpha = 1; }
  if (lid > 0) {
    const h = Math.ceil(7 * lid);
    ctx.fillStyle = '#2c3450'; ctx.fillRect(cx - 7, cy - 6, 15, h); ctx.fillRect(cx - 7, cy + 7 - h, 15, h);
    ctx.fillStyle = '#7684b4'; ctx.fillRect(cx - 6, cy - 6, 13, 1);
    if (lid >= 1) { ctx.fillStyle = '#06080e'; ctx.fillRect(cx - 7, cy, 15, 1); }
  }
}

function drawCollapse(ctx, room) {
  const k = clamp(Game.arrivalCollapse / 0.8, 0, 1);
  const x0 = 5 * TILE, y0 = (room.h - 1) * TILE;
  for (let i = 0; i < 32; i += 2) {
    const hgt = Math.round(16 * k * (0.5 + 0.5 * Math.sin(i * 1.7 + Game.realT * 20)));
    ctx.fillStyle = i % 4 ? '#3cff6e' : '#b8ffc8';
    ctx.globalAlpha = k;
    ctx.fillRect(x0 + i, y0 + 16 - hgt, 1, hgt);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Neo
// ---------------------------------------------------------------------------
function drawPlayer(ctx, p) {
  const set = p.coat ? SPR.neo.coat : SPR.neo.shirt;
  // which way he's seen from: the aim while hacking, else the way he walks,
  // else the way he last faced
  const mv = Input.move, moving = Input.moving() && Game.scene !== 'title';
  if (p.firing && p.aimAng !== null) { const ax = Math.cos(p.aimAng), ay = Math.sin(p.aimAng); p.view = Math.abs(ay) > Math.abs(ax) * 1.2 ? (ay > 0 ? 'down' : 'up') : 'side'; }
  else if (moving) p.view = Math.abs(mv.y) > Math.abs(mv.x) * 1.2 ? (mv.y > 0 ? 'down' : 'up') : 'side';
  const vset = p.view === 'down' || p.view === 'up' ? set[p.view] : null;
  const flip = p.facing < 0;
  for (const a of p.afterimages) blit(ctx, SPR.neo.coat.phase || set.idle[0], a.x, a.y, { flip: a.f < 0, alpha: (a.t / 0.25) * 0.5 });
  if (p.invulnT > 0 && p.phaseT <= 0 && Math.floor(Game.realT * 16) % 2 === 0) return;
  let img;
  if (p.phaseT > 0) img = SPR.neo.coat.phase || set.idle[0];
  else if (moving) img = (vset || set).walk[Math.floor(p.walkT * 8) % 4];
  else if (p.firing && set.type && !vset) img = set.type[Math.floor(p.anim * 10) % set.type.length];
  else img = (vset || set).idle[Math.floor(p.anim * 1.6) % 2];
  blit(ctx, img, p.x, p.y, { flip, tint: p.hurtT > 0.15 ? '#ff6070' : null, alpha: p.phaseT > 0 ? 0.7 : 1 });
  // compiling: holding fire long enough to fire faster throws off sparks of code
  if (p.firing && p.fireHeldT >= T.player.compileAfter && !Game.bt) {
    ctx.fillStyle = Math.random() < 0.5 ? '#3cff6e' : '#b8ffc8';
    ctx.fillRect(Math.round(p.x + p.facing * (5 + Math.random() * 3)), Math.round(p.y - 8 - Math.random() * 6), 1, 1);
  }
  // Zero Trust's shield
  if (p.shield) {
    ctx.fillStyle = PROTOCOLS.crypto.color;
    for (let i = 0; i < 16; i++) {
      if ((i + Math.floor(Game.realT * 8)) % 4 === 0) continue;
      const a = (i / 16) * Math.PI * 2;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(Math.round(p.x + Math.cos(a) * 9), Math.round(p.y - 8 + Math.sin(a) * 11), 1, 1);
    }
    ctx.globalAlpha = 1;
  }
  if (p.daemon) { ctx.fillStyle = '#8cffb0'; ctx.fillRect(Math.round(p.daemon.x) - 1, Math.round(p.daemon.y) - 1, 3, 3); ctx.fillStyle = '#0a2a14'; ctx.fillRect(Math.round(p.daemon.x), Math.round(p.daemon.y), 1, 1); }
  // integrity over his head once he's been hurt
  const run = Game.run;
  if (run && run.stats && run.hp < run.stats.maxHp) {
    const w = 12, k = clamp(run.hp / run.stats.maxHp, 0, 1);
    const bx = Math.round(p.x - w / 2), by = Math.round(p.y - 22);
    ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, by - 1, w + 2, 4);
    ctx.fillStyle = '#2a0a10'; ctx.fillRect(bx, by, w, 2);
    ctx.fillStyle = k < 0.3 ? '#ff5a6a' : '#3cff6e'; ctx.fillRect(bx, by, Math.max(1, Math.round(w * k)), 2);
  }
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------
function enemyImage(e) {
  const S = SPR.enemies, f2 = Math.floor(e.anim * 6) % 2, f4 = Math.floor(e.anim * 8) % 4;
  switch (e.type) {
    case 'bug': return S.bug.move[f2];
    case 'watchdog': return e.state === 'tell' ? S.watchdog.tell : e.state === 'dash' ? S.watchdog.dash : S.watchdog.move[f2];
    case 'firewall': return e.state === 'tell' ? S.firewall.tell : S.firewall.idle;
    case 'sentinel': return e.state === 'tell' ? S.sentinel.tell : S.sentinel.move[Math.floor(e.anim * 4) % 2];
    case 'worm': return e.small ? S.worm.small : S.worm.head;
    case 'exile': return e.state === 'windup' || e.state === 'flicker' ? S.exile.cast : S.exile.idle[Math.floor(e.anim * 2) % 2];
    case 'agent': case 'clone': return e.state === 'tell' || e.state === 'burst' ? S.agent.aim : e.state === 'move' ? S.agent.walk[f4] : S.agent.idle;
    case 'boss': return e.state === 'tell' || e.state === 'burst' ? SPR.boss.aim : e.state === 'chargeTell' ? SPR.boss.idle : SPR.boss.walk[f4];
  }
  return null;
}

function drawEnemy(ctx, e) {
  const flip = e.facing < 0;
  if (e.dead) return; // the dissolve takes over
  if (e.type === 'eye') return; // drawn with the Harvester
  if (e.spawnT > 0) { drawSpawnGlitch(ctx, e); return; }
  // the worm's body first
  if (e.type === 'worm') {
    const body = e.small ? SPR.enemies.worm.small : SPR.enemies.worm.body;
    for (let i = e.seg.length - 1; i >= 2; i -= 2) blit(ctx, body, e.seg[i].x, e.seg[i].y, { tint: e.flashT > 0 ? '#ffffff' : null });
  }
  const img = enemyImage(e);
  if (e.afterimage && e.afterimage.t > 0) { blit(ctx, img, e.afterimage.x, e.afterimage.y, { flip, alpha: 0.35, tint: '#8cffb0' }); e.afterimage.t -= 1 / 60; }
  // an exile's destination flickers before it blinks there
  if (e.type === 'exile' && e.state === 'flicker' && e.dest && Math.floor(Game.realT * 20) % 2 === 0) blit(ctx, img, e.dest.x, e.dest.y, { flip, alpha: 0.5, tint: '#b48cff' });
  if (e.elite) {
    // a gold rim
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) blit(ctx, img, e.x + ox, e.y + oy, { flip, tint: '#ffb43a' });
  }
  blit(ctx, img, e.x, e.y, { flip, tint: e.flashT > 0 ? '#ffffff' : e.slowT > 0 ? null : null });
  if (e.rot > 1 && Math.floor(Game.realT * 8) % 2) { ctx.fillStyle = '#9dff3a'; ctx.fillRect(Math.round(e.x + (Math.random() - 0.5) * e.r * 2), Math.round(e.y - Math.random() * e.h), 1, 1); }
  // aim lines: an agent about to fire, a watchdog about to dash
  if ((e.type === 'agent' || e.type === 'clone' || e.type === 'boss') && e.state === 'tell') {
    const p = Game.player, a = angleTo(e.x, e.y - 9, p.x, p.y - 4);
    ctx.globalAlpha = 0.35 + 0.35 * Math.sin(Game.realT * 30);
    ctx.strokeStyle = ENEMY_BULLET; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(e.x) + 0.5, Math.round(e.y - 9) + 0.5); ctx.lineTo(Math.round(e.x + Math.cos(a) * 60) + 0.5, Math.round(e.y - 9 + Math.sin(a) * 60) + 0.5); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // bars and names: elites and agents always, others once hurt
  const hurt = e.hp < e.maxHp || e.shield < e.shieldMax;
  if ((e.elite || e.type === 'agent') && !e.isBoss) {
    drawText3(ctx, e.name, e.x, e.y - e.h - 13, e.elite ? '#ffb43a' : '#e8ffe8', { align: 'center' });
  }
  if (!e.isBoss && (hurt || e.elite || e.type === 'agent')) {
    const w = e.elite || e.type === 'agent' ? 16 : 10, bx = Math.round(e.x - w / 2), by = Math.round(e.y - e.h - 6);
    ctx.fillStyle = '#000'; ctx.fillRect(bx - 1, by - 1, w + 2, 3 + (e.shieldMax ? 2 : 0));
    ctx.fillStyle = '#3a0c14'; ctx.fillRect(bx, by, w, 1);
    ctx.fillStyle = e.elite ? '#ffb43a' : '#ff8a5a'; ctx.fillRect(bx, by, Math.max(0, Math.round(w * e.hp / e.maxHp)), 1);
    if (e.shieldMax) { ctx.fillStyle = '#4aa8ff'; ctx.fillRect(bx, by + 2, Math.max(0, Math.round(w * e.shield / e.shieldMax)), 1); }
  }
}

function drawSpawnGlitch(ctx, e) {
  const k = 1 - e.spawnT / T.spawnTelegraph;
  const w = e.r * 2 + 6, h = e.h + 4;
  const x0 = Math.round(e.x - w / 2), y0 = Math.round(e.y - h);
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#3cff6e' : '#0f3a1c';
    ctx.fillRect(x0 + ((Math.random() * w) | 0), y0 + ((Math.random() * h) | 0), 1 + (Math.random() < 0.2 ? 1 : 0), 1);
  }
  ctx.fillStyle = '#b8ffc8';
  ctx.fillRect(x0, Math.round(y0 + h * (1 - k)), w, 1);
}

// ---------------------------------------------------------------------------
// Props, loot, critters
// ---------------------------------------------------------------------------
function drawProp(ctx, pr) {
  const { x, y } = propPos(pr);
  const P = SPR.props;
  if (pr.kind === 'cache' || pr.kind === 'rabbitcache') {
    blit(ctx, pr.open ? P.cache.open : P.cache.closed, x, y);
    if (!pr.open && !roomSealed()) {
      // the decrypt ring
      const k = pr.progress || 0;
      ctx.fillStyle = '#3cff6e';
      const n = 28;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        if (i / n > k && i % 2) continue;
        ctx.globalAlpha = i / n <= k ? 1 : 0.4;
        ctx.fillRect(Math.round(x + Math.cos(a) * 24), Math.round(y - 4 + Math.sin(a) * 18), 1, 1);
      }
      ctx.globalAlpha = 1;
      if (k > 0) drawText3(ctx, `DECRYPTING ${Math.floor(k * 100)}%`, x, y - 26, '#3cff6e', { align: 'center' });
    }
  } else if (pr.kind === 'phone') {
    const ringing = Game.room.cleared && !pr.answered;
    blit(ctx, ringing ? P.phone.ring[Math.floor(Game.realT * 12) % 2] : P.phone.idle, x, y);
    if (ringing) {
      if (Math.floor(Game.realT * 3) % 2 === 0) drawText3(ctx, 'RING', x, y - 26, '#ffe14a', { align: 'center' });
      if (pr.hold) { ctx.fillStyle = '#3cff6e'; ctx.fillRect(Math.round(x - 6), Math.round(y + 3), Math.round(12 * Math.min(1, pr.hold / 0.5)), 1); }
    }
  } else if (pr.kind === 'backdoor') {
    blit(ctx, P.backdoor, x, y, { alpha: pr.spent ? 0.5 : 1 });
    if (!pr.spent && Math.floor(Game.realT * 2) % 2) drawText3(ctx, 'OPEN PORT', x, y - 24, '#ff9a3c', { align: 'center' });
  } else if (pr.kind === 'oracle') {
    blit(ctx, P.oracle, x, y, { alpha: pr.spent ? 0.6 : 1 });
    if (!pr.spent && Math.floor(Game.realT * 2) % 2) drawText3(ctx, '>_', x, y - 22, '#3cff6e', { align: 'center' });
  }
}

function drawDrop(ctx, d) {
  const t = Game.realT;
  if (d.kind === 'orb') { blit(ctx, SPR.pickup.orb[Math.floor(t * 4) % 2], d.x, d.y - (d.z || 0)); return; }
  const it = d.item, col = T.rarity.colors[it.rarity];
  const bob = Math.round(Math.sin(t * 3 + d.id) * 1);
  if (it.rarity >= 2) {
    // a beam of the rarity's colour, so good loot is seen from across the room
    for (let i = 0; i < 22; i++) { ctx.globalAlpha = (1 - i / 22) * 0.5; ctx.fillStyle = col; ctx.fillRect(Math.round(d.x), Math.round(d.y - 8 - i), 1, 1); }
    ctx.globalAlpha = 1;
  }
  const icon = SPR.icons[it.slot];
  const x = Math.round(d.x), y = Math.round(d.y - (d.z || 0) + bob);
  ctx.fillStyle = '#000'; ctx.fillRect(x - 5, y + 1, 10, 1);
  blit(ctx, shadeOf(icon, mix(col, '#ffffff', 0.25)), x, y + 1);
  drawDropVerdict(ctx, d, x + 7, y - 6);
  if (d.near || roomSealed()) drawText3(ctx, it.name.length > 22 ? it.name.slice(0, 21) + '…' : it.name, x, y - 18, col, { align: 'center' });
}

// A tiny arrow beside loot on the floor: green ▲ better than what's worn,
// red ▼ worse, a yellow bar for about the same. Worked out again only when
// the gear changes.
function drawDropVerdict(ctx, d, x, y) {
  const run = Game.run;
  if (!run || !run.stats) return;
  const key = SLOTS.map((s) => (run.gear[s] ? run.gear[s].id : '-')).join() + run.patches.length;
  if (d._vKey !== key) { d._vKey = key; d._v = compareVerdict(run.gear, run.patches, d.item, run.floorN).kind; }
  const k = d._v;
  ctx.fillStyle = '#000';
  ctx.fillRect(x - 3, y - 2, 7, 5);
  if (k === 'up' || k === 'new') {
    ctx.fillStyle = '#3cff6e';
    ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x - 2, y + 1, 5, 1);
  } else if (k === 'down') {
    ctx.fillStyle = '#ff6a7a';
    ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y + 1, 1, 1);
  } else {
    ctx.fillStyle = '#e8e070';
    ctx.fillRect(x - 2, y - 1, 5, 1); ctx.fillRect(x - 2, y + 1, 5, 1);
  }
}

function drawCritter(ctx, c) {
  if (c.kind === 'rabbit') {
    const img = SPR.rabbit[c.air ? 1 : 0];
    blit(ctx, img, c.x, c.y - (c.air ? 2 : 0), { flip: c.facing < 0, alpha: c.fade ? 1 - c.fade / 0.4 : 1 });
  } else if (c.kind === 'cat') {
    if (c.t < c.delay) return;
    blit(ctx, SPR.cat[Math.floor(c.t * 6) % 2], c.x, c.y, { flip: c.facing < 0 });
  }
}

// ---------------------------------------------------------------------------
// Shots, packets, hazards, effects
// ---------------------------------------------------------------------------
let _bulletSprite = null;
function bulletSprite() {
  if (_bulletSprite) return _bulletSprite;
  const s = spriteFrom(['.rr.', 'rwrr', 'rrrr', '.rr.'], { r: ENEMY_BULLET, w: '#ffd0d8' });
  _bulletSprite = outlined(s, '#1a0006');
  _bulletSprite.ax = 3; _bulletSprite.ay = 3;
  return _bulletSprite;
}

function drawShots(ctx) {
  for (const s of Game.shots) {
    if (s.lob) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(Math.round(s.tx) - 2, Math.round(s.ty), 5, 1);
      ctx.globalAlpha = 0.5; ctx.fillStyle = s.color;
      const r = s.radius;
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.fillRect(Math.round(s.tx + Math.cos(a) * r), Math.round(s.ty + Math.sin(a) * r * 0.7), 1, 1); }
      ctx.globalAlpha = 1;
    }
    for (let i = 0; i < s.trail.length; i += 2) { ctx.globalAlpha = 0.15 + i * 0.05; ctx.fillStyle = s.color; ctx.fillRect(Math.round(s.trail[i]), Math.round(s.trail[i + 1]), 1, 1); }
    ctx.globalAlpha = 1;
    const g = glyphSprite(s.glyph);
    const img = tintOf(g, s.color);
    if (s.small) ctx.drawImage(img, 0, 0, img.width, img.height, Math.round(s.x - 1), Math.round(s.y - 2), 3, 4);
    else ctx.drawImage(img, Math.round(s.x - img.width / 2), Math.round(s.y - img.height / 2));
  }
}

function drawBullets(ctx) {
  const img = bulletSprite();
  for (const b of Game.bullets) {
    if (!b.big) { ctx.drawImage(img, Math.round(b.x - img.ax), Math.round(b.y - img.ay)); continue; }
    // a big packet, flickering as it's about to burst
    const pop = b.ring && b.life < 0.35 && Math.floor(Game.realT * 24) % 2;
    ctx.fillStyle = '#000'; ellipseArea(ctx, b.x, b.y, b.r + 1, b.r + 1);
    ctx.fillStyle = pop ? '#ffffff' : '#a01028'; ellipseArea(ctx, b.x, b.y, b.r, b.r);
    ctx.fillStyle = pop ? '#ffd0d8' : ENEMY_BULLET; ellipseArea(ctx, b.x, b.y, b.r - 1, b.r - 1);
    ctx.fillStyle = '#ffd0d8'; ellipseArea(ctx, b.x - 1, b.y - 1, 1, 1);
  }
}

function drawHazardsUnder(ctx) {
  for (const h of Game.hazards) {
    if (h.kind === 'lane') {
      const k = 1 - h.t / h.total;
      ctx.save();
      ctx.translate(h.x, h.y); ctx.rotate(h.a);
      ctx.globalAlpha = 0.18 + 0.25 * k;
      ctx.fillStyle = ENEMY_BULLET;
      ctx.fillRect(0, -h.w / 2, h.len, h.w);
      ctx.globalAlpha = 0.8;
      ctx.fillRect(0, -h.w / 2, h.len * k, 1); ctx.fillRect(0, h.w / 2 - 1, h.len * k, 1);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (h.kind === 'beam' && h.t < T.harvester.beam.tell) {
      // the laser's line: flickering, then steady once it has locked on
      const C = T.harvester.beam, locked = h.t >= C.tell - C.lock;
      ctx.save();
      ctx.translate(h.x, h.y); ctx.rotate(h.a);
      ctx.fillStyle = ENEMY_BULLET;
      ctx.globalAlpha = locked ? 0.9 : 0.25 + 0.3 * Math.abs(Math.sin(h.t * 25));
      ctx.fillRect(0, locked ? -1 : 0, h.len, locked ? 2 : 1);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(0, -h.w / 2, h.len, h.w);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (h.kind === 'volatile') {
      const k = 1 - h.t / h.total;
      ctx.fillStyle = ENEMY_BULLET;
      const n = 36;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.globalAlpha = 0.5 + 0.5 * k; ctx.fillRect(Math.round(h.x + Math.cos(a) * h.r), Math.round(h.y + Math.sin(a) * h.r * 0.75), 1, 1); }
      ctx.globalAlpha = 0.12 + 0.2 * k;
      ellipseArea(ctx, h.x, h.y, h.r, h.r * 0.75);
      ctx.globalAlpha = 1;
    } else if (h.kind === 'storm') {
      const room = Game.room, top = TILE, bottom = (room.h - 1) * TILE;
      if (h.t < T.boss.stormWarn) {
        ctx.globalAlpha = 0.12 + 0.18 * Math.abs(Math.sin(h.t * 14));
        ctx.fillStyle = ENEMY_BULLET; ctx.fillRect(h.x0, top, h.x1 - h.x0, bottom - top);
        ctx.globalAlpha = 1;
      }
    } else if (h.kind === 'trail') {
      ctx.globalAlpha = Math.min(1, h.t) * 0.7;
      ctx.fillStyle = '#8cffb0';
      ctx.fillRect(Math.round(h.x) - 2, Math.round(h.y), 4, 1);
      ctx.fillRect(Math.round(h.x) - 1, Math.round(h.y) - 1, 1, 3);
      ctx.globalAlpha = 1;
    }
  }
}

function ellipseArea(ctx, cx, cy, rx, ry) {
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

function drawHazardsOver(ctx) {
  for (const h of Game.hazards) {
    if (h.kind === 'beam' && h.t >= T.harvester.beam.tell) {
      // the laser itself: red, a hot core, and code boiling off it
      const k = 1 - (h.t - T.harvester.beam.tell) / T.harvester.beam.fire, w = Math.max(2, Math.round(h.w * (0.6 + 0.4 * k)));
      ctx.save();
      ctx.translate(h.x, h.y); ctx.rotate(h.a);
      ctx.fillStyle = ENEMY_BULLET; ctx.fillRect(0, -w / 2, h.len, w);
      ctx.fillStyle = '#ffb0c0'; ctx.fillRect(0, -w / 4, h.len, Math.max(1, w / 2));
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, -0.5, h.len, 1);
      ctx.restore();
      const c = Math.cos(h.a), s = Math.sin(h.a);
      for (let i = 0; i < 3; i++) { const d = Math.random() * h.len; ctx.fillStyle = Math.random() < 0.5 ? '#ffffff' : ENEMY_BULLET; ctx.fillRect(Math.round(h.x + c * d + (Math.random() - 0.5) * w * 2), Math.round(h.y + s * d + (Math.random() - 0.5) * w * 2), 1, 1); }
      if (Math.random() < 0.5) spawnBits(h.x + c * h.len, h.y + s * h.len, ENEMY_BULLET, 1);
      continue;
    }
    if (h.kind === 'storm' && h.t >= T.boss.stormWarn) {
      const room = Game.room, top = TILE, bottom = (room.h - 1) * TILE;
      for (let x = h.x0; x < h.x1; x += 4) {
        for (let y = top; y < bottom; y += 6) {
          const g = glyphSprite((x * 7 + y * 3 + Math.floor(Game.realT * 30)) & 15);
          ctx.drawImage(tintOf(g, (y / 6 + Math.floor(Game.realT * 20)) % 5 === 0 ? '#ffffff' : '#3cff6e'), x, y);
        }
      }
    }
  }
}

function drawFx(ctx) {
  for (const f of Game.fx) {
    if (f.kind === 'bit' || f.kind === 'code') {
      ctx.globalAlpha = clamp(f.t / 0.3, 0, 1);
      drawText3(ctx, f.ch, f.x, f.y, f.color, { shadow: null });
    } else if (f.kind === 'ring') {
      const k = 1 - f.t / f.total, r = f.r * (0.4 + 0.6 * k);
      ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color;
      const n = Math.max(12, Math.round(r * 1.5));
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.75), 1, 1); }
    }
  }
  ctx.globalAlpha = 1;
}

function drawFloats(ctx) {
  for (const f of Game.floats) {
    ctx.globalAlpha = clamp(f.t / (f.total * 0.5), 0, 1);
    drawText3(ctx, f.text, f.x, f.y, f.color, { align: 'center' });
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// On top of everything: pips for processes out of view, the boss's bar,
// Bullet Time, low integrity, flashes and the wipe between rooms.
// ---------------------------------------------------------------------------
function drawOverlays(ctx, W, H) {
  // processes above or below the view
  for (const e of Game.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    const y = e.y - e.h / 2 - Game.camY;
    if (y < 0 || y > H) {
      const top = y < 0, px = Math.round(clamp(e.x, 4, W - 4)), py = top ? 2 : H - 3;
      ctx.fillStyle = ENEMY_BULLET;
      ctx.fillRect(px - 2, py, 5, 1); ctx.fillRect(px - 1, top ? py + 1 : py - 1, 3, 1); ctx.fillRect(px, top ? py + 2 : py - 2, 1, 1);
    }
  }
  // the Agent's bar
  const boss = Game.boss;
  if (boss && !boss.dead && boss.spawnT <= 0) {
    const w = W - 40, x = 20, y = 4;
    drawText3(ctx, 'AGENT', W / 2, y, '#e8ffe8', { align: 'center' });
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y + 7, w + 2, 4);
    ctx.fillStyle = '#3a0c14'; ctx.fillRect(x, y + 8, w, 2);
    ctx.fillStyle = '#ff8a5a'; ctx.fillRect(x, y + 8, Math.round(w * boss.hp / boss.maxHp), 2);
    ctx.fillStyle = '#000'; for (const f of [T.boss.phase2, T.boss.phase3]) ctx.fillRect(x + Math.round(w * f), y + 7, 1, 4);
  }
  // the Harvester's bar: one piece for each eye
  const hv = Game.room && Game.room.harv;
  if (hv && hv.state === 'fight') {
    const w = W - 40, x = 20, y = 4, seg = Math.floor((w - 4) / 3);
    drawText3(ctx, 'HARVESTER', W / 2, y, '#e8ffe8', { align: 'center' });
    hv.eyes.forEach((e, i) => {
      const sx = x + i * (seg + 2);
      ctx.fillStyle = '#000'; ctx.fillRect(sx - 1, y + 7, seg + 2, 4);
      ctx.fillStyle = '#3a0c14'; ctx.fillRect(sx, y + 8, seg, 2);
      ctx.fillStyle = e.closed ? '#7684b4' : '#ff8a5a'; ctx.fillRect(sx, y + 8, Math.round(seg * Math.max(0, e.hp) / e.maxHp), 2);
    });
  }
  // Bullet Time: the world drains to green
  if (Game.timeScale < 0.999) {
    const k = clamp((1 - Game.timeScale) / (1 - T.focus.worldScale), 0, 1);
    ctx.globalCompositeOperation = 'color';
    ctx.globalAlpha = 0.55 * k;
    ctx.fillStyle = '#2aff6a';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.25 * k;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 2); ctx.fillRect(0, H - 2, W, 2); ctx.fillRect(0, 0, 2, H); ctx.fillRect(W - 2, 0, 2, H);
    ctx.globalAlpha = 1;
  }
  // low integrity: a red frame that beats (still, with reduced flashing)
  const run = Game.run;
  if (run && run.stats && Game.scene === 'run' && run.hp > 0 && run.hp < run.stats.maxHp * 0.25) {
    const beat = Save.settings.reducedFlash ? 0.5 : 0.5 + 0.5 * Math.sin(Game.realT * 6);
    ctx.globalAlpha = 0.25 + 0.25 * beat;
    ctx.fillStyle = '#ff2040';
    ctx.fillRect(0, 0, W, 2); ctx.fillRect(0, H - 2, W, 2); ctx.fillRect(0, 0, 2, H); ctx.fillRect(W - 2, 0, 2, H);
    ctx.globalAlpha = 1;
  }
  if (Game.flash) { ctx.globalAlpha = Game.flash.a * (Game.flash.t / 0.12); ctx.fillStyle = Game.flash.color; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  // the flows that take over the screen
  const fl = Game.flow;
  if (fl && (fl.kind === 'phone' || fl.kind === 'death' || fl.kind === 'victory')) {
    const k = clamp(fl.t / (fl.kind === 'victory' ? 2.2 : 1.1), 0, 1);
    ctx.globalAlpha = k * (fl.kind === 'victory' ? 1 : 0.85);
    ctx.fillStyle = fl.kind === 'victory' ? (Save.settings.reducedFlash ? '#c8ffd8' : '#ffffff') : '#000000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    if (fl.kind === 'death' && fl.t > 0.3) drawText3(ctx, 'CONNECTION LOST', W / 2, H / 2 - 3, '#ff5a6a', { align: 'center', scale: 2 });
  }
  if (Game.transition) {
    const tr = Game.transition, k = tr.t / tr.dur;
    const a = k < 0.5 ? k * 2 : (1 - k) * 2;
    ctx.fillStyle = '#000';
    for (let y = 0; y < H; y += 4) {
      const off = Math.round(Math.sin(y * 0.7 + Game.realT * 40) * 30 * a);
      ctx.globalAlpha = clamp(a * 1.6, 0, 1);
      ctx.fillRect(off, y, W, 4);
    }
    ctx.globalAlpha = 1;
  }
}
