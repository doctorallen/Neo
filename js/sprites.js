'use strict';
// ---------------------------------------------------------------------------
// NEO: every piece of pixel art, drawn procedurally at load time.
//
// Characters are built from string templates (layered: legs, body, arms,
// head) so the frames of an animation stay on-model; props, tiles and icons
// are painted with small rectangle helpers. Everything is drawn at one world
// pixel per canvas pixel and cached in offscreen canvases. buildSprites()
// fills SPR once at boot; sectorTiles() and glyphSprite() build lazily and
// memoise.
//
// Anchors: every character and prop canvas carries c.ax / c.ay, the pixel
// that sits on the entity's position: the feet (or base) centre, on the
// bottom row of opaque pixels. Character sprites face right; when the engine
// flips one, the anchor becomes (width - 1 - ax). Character canvases are an
// odd number of pixels wide with the body centred, so a flip keeps the feet
// on the same pixel.
//
// Only SPR, SECTOR_PAL, buildSprites, sectorTiles, glyphSprite and spr_*
// names live at the top level.
// ---------------------------------------------------------------------------

const SECTOR_PAL = {
  tenement: { bg: '#040605', floor: '#1a201b', floor2: '#161b17', line: '#0c100d', wallTop: '#262c25', wallFace: '#3b4237', wallEdge: '#56604f', accent: '#ffb43a', pit: '#000000' },
  server: { bg: '#030607', floor: '#101b1d', floor2: '#0d1618', line: '#060d0f', wallTop: '#20272b', wallFace: '#2e373c', wallEdge: '#4b5960', accent: '#3ae8ff', pit: '#000000' },
  subway: { bg: '#050504', floor: '#1d1c17', floor2: '#181712', line: '#0b0a07', wallTop: '#2a2822', wallFace: '#4a483d', wallEdge: '#6a6656', accent: '#ffd23a', pit: '#000000' },
  grid: { bg: '#020104', floor: '#07050b', floor2: '#0a0710', line: '#3a0f36', wallTop: '#170d22', wallFace: '#211433', wallEdge: '#ff3ad8', accent: '#ff3ad8', pit: '#000000' },
  core: { bg: '#010302', floor: '#050b07', floor2: '#07100a', line: '#0e2416', wallTop: '#1c3024', wallFace: '#2e4a3a', wallEdge: '#8cffb0', accent: '#d8ffe4', pit: '#000000' },
  apartment: { bg: '#040303', floor: '#21170f', floor2: '#1b130c', line: '#0d0906', wallTop: '#24201b', wallFace: '#363029', wallEdge: '#4c443a', accent: '#3cff6e', pit: '#000000' },
};

const SPR = {};

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

// A character grid (array of arrays of single chars) for layering templates.
function spr_grid(w, h) {
  const g = [];
  for (let j = 0; j < h; j++) g.push(new Array(w).fill('.'));
  return g;
}
// Writes a template into the grid at (ox, oy); '.' and ' ' are see-through.
function spr_stamp(g, rows, ox, oy) {
  for (let j = 0; j < rows.length; j++) {
    const y = oy + j;
    if (y < 0 || y >= g.length) continue;
    for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i], x = ox + i;
      if (ch === '.' || ch === ' ' || x < 0 || x >= g[y].length) continue;
      g[y][x] = ch;
    }
  }
  return g;
}
function spr_put(g, x, y, ch) { if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch; }
function spr_rowsOf(g) { return g.map((r) => r.join('')); }
function spr_anchor(c, ax, ay) { c.ax = ax; c.ay = ay; return c; }

// A 1px outline round every opaque pixel, like util's outlined() (the canvas
// grows by a pixel each side), but built from four shifted silhouettes so
// nothing is read back from the GPU: a whole build stays fast.
function spr_outline(src, ink) {
  const sil = tinted(src, ink);
  const [c, x] = makeCanvas(src.width + 2, src.height + 2);
  x.drawImage(sil, 0, 1); x.drawImage(sil, 2, 1); x.drawImage(sil, 1, 0); x.drawImage(sil, 1, 2);
  x.drawImage(src, 1, 1);
  return c;
}

// A grid sprite, outlined, anchored at the bottom row of the given column
// (in un-outlined grid coordinates; the outline's +1 is added here).
function spr_fromGrid(g, pal, ink, axGrid, ayGrid) {
  const rows = spr_rowsOf(g);
  const c = spr_outline(spriteFrom(rows, pal), ink);
  let bottom = 0;
  for (let j = 0; j < rows.length; j++) if (/[^. ]/.test(rows[j])) bottom = j;
  if (ayGrid !== undefined) bottom = ayGrid;
  return spr_anchor(c, (axGrid === undefined ? Math.floor(rows[0].length / 2) : axGrid) + 1, bottom + 1);
}

// Duplicates a row or a column of a grid (used to build the larger boss).
function spr_dupRow(g, j) { const r = g[j].slice(); g.splice(j, 0, r); return g; }
function spr_dupCol(g, i) { for (const r of g) r.splice(i, 0, r[i]); return g; }

// A painter over a fresh canvas.
function spr_paint(w, h) {
  const [c, x] = makeCanvas(w, h);
  const P = {
    c, x, w, h,
    r(col, X, Y, W = 1, H = 1) { x.fillStyle = col; x.fillRect(X, Y, W, H); return P; },
    clear(X, Y, W = 1, H = 1) { x.clearRect(X, Y, W, H); return P; },
    ln(col, x0, y0, x1, y1) {
      x.fillStyle = col;
      let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, e = dx + dy;
      for (let n = 0; n < 200; n++) {
        x.fillRect(x0, y0, 1, 1);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * e;
        if (e2 >= dy) { e += dy; x0 += sx; }
        if (e2 <= dx) { e += dx; y0 += sy; }
      }
      return P;
    },
    // A shaded ellipse lit from the top left; ramp runs dark to light.
    disc(cx, cy, rx, ry, ramp, bias = 0) {
      for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++)
        for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
          const nx = (i + 0.5 - cx) / rx, ny = (j + 0.5 - cy) / ry, d = nx * nx + ny * ny;
          if (d > 1) continue;
          const l = 0.5 - 0.42 * (nx * 0.62 + ny * 0.78) + (1 - d) * 0.18 + bias;
          P.r(ramp[clamp(Math.floor(l * ramp.length), 0, ramp.length - 1)], i, j);
        }
      return P;
    },
    // Draws a string template in place (same palette rules as spriteFrom).
    tpl(rows, pal, ox = 0, oy = 0) {
      for (let j = 0; j < rows.length; j++)
        for (let i = 0; i < rows[j].length; i++) {
          const ch = rows[j][i];
          if (ch === '.' || ch === ' ' || !pal[ch]) continue;
          P.r(pal[ch], ox + i, oy + j);
        }
      return P;
    },
  };
  return P;
}
// A prop canvas: optionally outlined, anchored at the base centre.
function spr_prop(c, ink) {
  const o = ink ? spr_outline(c, ink) : c;
  return spr_anchor(o, Math.floor(o.width / 2), o.height - (ink ? 2 : 1));
}

// Tiny 3x5 digits for plates and signs.
const spr_DIGITS = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#', '##', '.#', '.#', '.#'],
  '3': ['###', '..#', '.##', '..#', '###'],
};

// ---------------------------------------------------------------------------
// Neo
// ---------------------------------------------------------------------------
const spr_NEO_PAL = {
  h: '#060807', H: '#1c2826', s: '#d9b093', S: '#9e7159', e: '#4a2c22',
  g: '#000000', G: '#5dff8a',
  k: '#030504', c: '#0f1513', C: '#1d2824', L: '#34463e',
  p: '#0a0e0c', b: '#000000', B: '#2c3430',
  t: '#30353a', T: '#474e54', u: '#202428',
  j: '#1d2633', J: '#2e3b4d', f: '#4a4640',
};

const spr_NEO_HEAD_COAT = [
  '.hhhh.',
  'hHHHhh',
  'hhhhhs',
  'hhsgGg',
  '.hhSss',
  '...Ss.',
];
const spr_NEO_HEAD_SHIRT = [
  'h.hHh.',
  'hHHhhh',
  'hhhhss',
  'hhsses',
  '.hhSss',
  '...Ss.',
];
// The trench coat, from the collar (row 0, beside the neck) to the hem
// (rows 9-10); the hem rows change with the stride.
const spr_NEO_COAT = [
  '....LC...k...',
  '..LCCCccckk..',
  '..LCCcccckk..',
  '..LCccccckk..',
  '...LCcccckk..',
  '...LCccccck..',
  '...LCccccck..',
  '..LCCccccck..',
  '..LCcccccckk.',
];
const spr_NEO_HEM = {
  idle: ['..LCccccckck.', '.LCcckk.kcck.'],
  a: ['..LCccccckck.', 'LCcck....kcck'],
  b: ['..LCcccckcck.', '.LCck....kcck'],
  pass: ['..LCcccckcck.', '..LCcckkcck..'],
};
const spr_NEO_SHIRT = [
  '....TTtt.....',
  '...TTtttu....',
  '...Tttttu....',
  '...Tttttuu...',
  '...Tttttuu...',
  '...Ttttttu...',
  '...uuuuuuu...',
];
// Legs under the coat (rows 15..17) and under the shirt (rows 13..17).
const spr_NEO_LEGS_COAT = {
  idle: ['.....pp.p....', '....pp.pp....', '....bB.bbB...'],
  a: ['....pp..pp...', '...pp....pp..', '..bbB....bbB.'],
  pass: ['.....ppp.....', '.....ppp.....', '.....bbbB....'],
};
const spr_NEO_LEGS_SHIRT = {
  idle: ['...jjjjjj....', '....Jj.Jj....', '....Jj.Jj....', '....Jj.Jj....', '....ff.fff...'],
  a: ['...jjjjjj....', '...Jj...Jj...', '...Jj....Jj..', '..Jj.....Jj..', '..ff.....fff.'],
  b: ['...jjjjjj....', '...jJ...jJ...', '..jJ.....jJ..', '..jJ.....jJ..', '.ff......fff.'],
  pass: ['...jjjjjj....', '.....Jjj.....', '.....Jjj.....', '.....Jjj.....', '.....ffff....'],
};

// One Neo frame. kind: 'coat' | 'shirt'; pose: 'idle' | 'walk' | 'type'.
function spr_neoFrame(kind, pose, f) {
  const coat = kind === 'coat';
  const g = spr_grid(13, 18);
  let by = 1, headDy = 0, swing = 0, hem = 'idle', legs = 'idle';
  if (pose === 'idle') { headDy = f === 1 ? 1 : 0; }
  if (pose === 'walk') {
    by = f % 2 === 1 ? 0 : 1;
    hem = f === 0 ? 'a' : f === 2 ? 'b' : 'pass';
    legs = f === 0 ? 'a' : f === 2 ? (coat ? 'a' : 'b') : 'pass';
    swing = f === 0 ? 1 : f === 2 ? -1 : 0;
  }
  // legs first (the coat hangs over them)
  if (coat) spr_stamp(g, spr_NEO_LEGS_COAT[legs], 0, 15);
  else spr_stamp(g, spr_NEO_LEGS_SHIRT[legs], 0, 13);
  // body
  if (coat) {
    spr_stamp(g, spr_NEO_COAT, 0, by + 5);
    spr_stamp(g, spr_NEO_HEM[hem], 0, by + 14);
  } else {
    spr_stamp(g, spr_NEO_SHIRT, 0, by + 6);
  }
  // arms
  if (pose === 'type') {
    const up = f === 0;
    if (coat) {
      spr_stamp(g, ['LCC', '.Ccck'], 6, by + 8);
    } else {
      spr_stamp(g, ['TTt', '.ssss'], 6, by + 8);
    }
    // near hand and far hand, alternating as he types
    spr_put(g, 10, by + 9, 's'); spr_put(g, 11, by + (up ? 8 : 9), 's');
    spr_put(g, 11, by + (up ? 9 : 10), 'S'); spr_put(g, 10, by + 10, up ? '.' : 'S');
    spr_put(g, 12, by + (up ? 10 : 9), 'G');
  } else {
    const ax = 6 + (swing > 0 ? 1 : 0);
    if (coat) {
      spr_stamp(g, ['LC', 'LC', 'Lc'], 6, by + 7);
      spr_stamp(g, ['Lc', 'Ck'], ax + (swing < 0 ? -1 : 0), by + 10);
      spr_put(g, ax + swing + (swing < 0 ? 0 : 0), by + 12, 's');
    } else {
      spr_stamp(g, ['Tt', 'Tu'], 6, by + 7);
      spr_stamp(g, ['sS', 'sS', 'sS'], ax + (swing < 0 ? -1 : 0), by + 9);
      spr_put(g, ax + swing, by + 12, 's');
    }
  }
  // head
  spr_stamp(g, coat ? spr_NEO_HEAD_COAT : spr_NEO_HEAD_SHIRT, 4, by + headDy);
  return g;
}

// Facing the camera (walking down) and facing away (walking up). The same
// 13×18 grid and feet as the side frames, so the anchor doesn't move.
const spr_NEO_HEAD_V = {
  coatdown: ['..hhh..', '.hHHHh.', 'hhssshh', 'hgGsgGh', '.sssss.', '..SsS..'],
  shirtdown: ['..hhh..', '.hHHHh.', 'hhssshh', 'hsesesh', '.sssss.', '..SsS..'],
  up: ['..hhh..', '.hHHHh.', 'hhHHhhh', 'hhhhhhh', '.hhhhh.', '..sSs..'],
};
const spr_NEO_COAT_V = {
  // open down the front over the black shirt
  down: ['....LCkCL....', '..LCCckcCCL..', '..LCcckccCL..', '..LCcckccCL..', '..LCcckccCL..', '..LCcckccCL..', '..LCcckccCL..', '..LCcckccCL..', '..LCcckccCL..'],
  // the back, with the vent
  up: ['....LCCCL....', '..LCCccccCL..', '..LCcccccCL..', '..LCcccccCL..', '..LCcccccCL..', '..LCcccccCL..', '..LCcccccCL..', '..LCcckccCL..', '..LCcckccCL..'],
};
const spr_NEO_HEM_V = {
  idle: ['..LCcckccCL..', '..LCck.kcCL..'],
  a: ['..LCcckccCL..', '..LCck.kcCLk.'],
  b: ['..LCcckccCL..', '.kLCck.kcCL..'],
};
// one foot lifted a row on each stride
const spr_NEO_LEGS_COAT_V = {
  idle: ['....pp.pp....', '....pp.pp....', '...bBB.BBb...'],
  a: ['....pp.pp....', '....pp.BBb...', '...bBB.......'],
  b: ['....pp.pp....', '...bBB.pp....', '.......BBb...'],
};
const spr_NEO_SHIRT_V = ['....TtttT....', '...TTtttTu...', '...TttttTu...', '...TttttTu...', '...TttttTu...', '...TttttTu...', '...uuuuuuu...'];
const spr_NEO_LEGS_SHIRT_V = {
  idle: ['...jjjjjjj...', '....Jj.jJ....', '....Jj.jJ....', '....Jj.jJ....', '...ff...ff...'],
  a: ['...jjjjjjj...', '....Jj.jJ....', '....Jj.jJ....', '....Jj.ff....', '...ff........'],
  b: ['...jjjjjjj...', '....Jj.jJ....', '....Jj.jJ....', '....ff.jJ....', '........ff...'],
};

// One Neo frame seen from the front or the back. view: 'down' | 'up'.
function spr_neoFrameV(kind, view, pose, f) {
  const coat = kind === 'coat';
  const g = spr_grid(13, 18);
  let by = 1, headDy = 0, stride = 'idle', swing = 0;
  if (pose === 'idle') headDy = f === 1 ? 1 : 0;
  if (pose === 'walk') {
    by = f % 2 === 1 ? 0 : 1;
    stride = f === 0 ? 'a' : f === 2 ? 'b' : 'idle';
    swing = f === 0 ? 1 : f === 2 ? -1 : 0;
  }
  if (coat) spr_stamp(g, spr_NEO_LEGS_COAT_V[stride], 0, 15);
  else spr_stamp(g, spr_NEO_LEGS_SHIRT_V[stride], 0, 13);
  // arms hang at his sides; the one on the side of the lifted foot swings back (shorter)
  const armL = by + 10 - (swing < 0 ? 1 : 0), armR = by + 10 - (swing > 0 ? 1 : 0);
  if (coat) {
    for (let y = by + 6; y <= armL; y++) spr_put(g, 1, y, y < by + 8 ? 'L' : 'C');
    for (let y = by + 6; y <= armR; y++) spr_put(g, 11, y, y < by + 8 ? 'C' : 'c');
  } else {
    for (let y = by + 6; y <= armL; y++) spr_put(g, 2, y, y < by + 8 ? 'T' : 's');
    for (let y = by + 6; y <= armR; y++) spr_put(g, 10, y, y < by + 8 ? 'u' : 'S');
  }
  const hand = view === 'up' ? 'S' : 's';
  spr_put(g, coat ? 1 : 2, armL + 1, hand); spr_put(g, coat ? 11 : 10, armR + 1, hand);
  if (coat) {
    spr_stamp(g, spr_NEO_COAT_V[view], 0, by + 5);
    spr_stamp(g, spr_NEO_HEM_V[stride], 0, by + 14);
    // the lifted foot shows in front of the hem
    if (stride === 'a') spr_stamp(g, ['BBb'], 7, 16);
    if (stride === 'b') spr_stamp(g, ['bBB'], 3, 16);
  } else {
    spr_stamp(g, spr_NEO_SHIRT_V, 0, by + 6);
  }
  const head = view === 'up' ? spr_NEO_HEAD_V.up : coat ? spr_NEO_HEAD_V.coatdown : spr_NEO_HEAD_V.shirtdown;
  spr_stamp(g, head, 3, by + headDy);
  return g;
}

function spr_neo() {
  const ink = '#8cffb0';
  const mk = (kind, pose, f) => spr_fromGrid(spr_neoFrame(kind, pose, f), spr_NEO_PAL, ink, 6);
  const coat = {
    idle: [mk('coat', 'idle', 0), mk('coat', 'idle', 1)],
    walk: [0, 1, 2, 3].map((f) => mk('coat', 'walk', f)),
    type: [mk('coat', 'type', 0), mk('coat', 'type', 1)],
  };
  coat.phase = spr_anchor(tinted(coat.idle[0], '#8cffb0'), coat.idle[0].ax, coat.idle[0].ay);
  const shirt = {
    idle: [mk('shirt', 'idle', 0), mk('shirt', 'idle', 1)],
    walk: [0, 1, 2, 3].map((f) => mk('shirt', 'walk', f)),
  };
  // walking down (towards the camera) and up (away)
  const mkV = (kind, view, pose, f) => spr_fromGrid(spr_neoFrameV(kind, view, pose, f), spr_NEO_PAL, ink, 6);
  for (const [set, kind] of [[coat, 'coat'], [shirt, 'shirt']]) {
    for (const view of ['down', 'up']) {
      set[view] = { idle: [0, 1].map((f) => mkV(kind, view, 'idle', f)), walk: [0, 1, 2, 3].map((f) => mkV(kind, view, 'walk', f)) };
    }
  }
  return { coat, shirt, asleep: spr_neoAsleep() };
}

// ---------------------------------------------------------------------------
// The desk and Neo asleep on it (same canvas size and anchor)
// ---------------------------------------------------------------------------
const spr_DESK_W = 32, spr_DESK_H = 22;
const spr_CHAIR = ['#08090b', '#15171b', '#23272d', '#343a42'];

// The office chair seen from behind; `backOnly` draws just the lower
// backrest (to sit in front of Neo when he's asleep in it).
function spr_chair(P, backOnly) {
  const ch = spr_CHAIR;
  const top = backOnly ? 18 : 13;
  // backrest with rounded top corners
  P.r(ch[1], 12, top, 9, 19 - top); P.r(ch[0], 12, 19, 9, 0);
  if (!backOnly) { P.clear(12, 13, 1, 1); P.clear(20, 13, 1, 1); P.r(ch[3], 13, 13, 7, 1); P.r(ch[2], 12, 14, 1, 4); P.r(ch[2], 13, 14, 1, 1); }
  else { P.r(ch[3], 12, 18, 9, 1); }
  P.r(ch[0], 20, Math.max(top, 14), 1, 19 - Math.max(top, 14));
  P.r(ch[2], 16, top + 1, 1, 18 - top - 1);
  // seat edge, stem and the five-star base
  P.r(ch[2], 11, 18, 11, 1); P.r(ch[1], 11, 19, 11, 1); P.r(ch[3], 11, 18, 1, 1);
  if (backOnly) return;
  P.r(ch[0], 16, 20, 1, 1);
  P.r(ch[2], 12, 21, 9, 1);
  P.r(ch[3], 12, 21, 1, 1); P.r(ch[3], 16, 21, 1, 1); P.r(ch[3], 20, 21, 1, 1);
}

function spr_desk() {
  const P = spr_paint(spr_DESK_W, spr_DESK_H);
  const wood = ['#1a110a', '#2a1d13', '#3a2a1c', '#4a3626', '#5a4430'];
  // desk top surface (3/4 view: the top, then the front edge)
  P.r(wood[3], 0, 11, 32, 5);
  P.r(wood[4], 0, 11, 32, 1);
  for (const [gx, gy, gw] of [[2, 13, 3], [24, 12, 4], [28, 14, 2], [6, 14, 2], [20, 15, 3]]) P.r(wood[2], gx, gy, gw, 1);
  P.r(wood[1], 0, 16, 32, 2);
  P.r(wood[2], 0, 16, 32, 1);
  // drawer unit (left) and a leg (right)
  P.r(wood[1], 1, 18, 8, 4); P.r(wood[0], 1, 21, 8, 1); P.r(wood[0], 8, 18, 1, 4);
  P.r(wood[2], 2, 19, 5, 1); P.r('#8a7a5a', 4, 19, 2, 1);
  P.r(wood[1], 28, 18, 3, 4); P.r(wood[0], 30, 18, 1, 4);
  // green monitor spill on the desk top
  P.r('#3e4a2c', 8, 11, 16, 1); P.r('#46562e', 11, 11, 10, 1);
  // a mug (left) and a stack of floppies (right)
  P.r('#4a524a', 2, 9, 3, 3); P.r('#6a7468', 2, 9, 3, 1); P.r('#141612', 3, 9, 1, 1); P.r('#4a524a', 5, 10, 1, 1);
  P.r('#22304a', 26, 11, 4, 2); P.r('#34466a', 26, 11, 4, 1); P.r('#b8bcb0', 27, 12, 2, 1); P.r('#2e3a5c', 27, 10, 3, 1);
  // CRT monitor: chunky case, top face then front face
  const cs = ['#151812', '#262b22', '#3a4134', '#525a48', '#6a7460'];
  P.r(cs[2], 9, 0, 14, 1); P.r(cs[3], 10, 0, 12, 1);
  P.r(cs[3], 8, 1, 16, 11); P.r(cs[4], 8, 1, 16, 1); P.r(cs[4], 8, 1, 1, 10);
  P.r(cs[2], 23, 2, 1, 10); P.r(cs[1], 8, 11, 16, 1);
  // bezel and screen face
  P.r(cs[1], 9, 2, 14, 8);
  P.r('#0a2c12', 10, 3, 12, 6);
  for (let j = 3; j < 9; j += 2) P.r('#0c3416', 10, j, 12, 1);
  P.r('#3cff6e', 11, 4, 5, 1); P.r('#2ad65a', 11, 6, 3, 1); P.r('#8cffb0', 15, 6, 1, 1);
  P.r('#1f6a34', 10, 3, 1, 1); P.r('#1f6a34', 21, 3, 1, 1);
  // power LED
  P.r('#3cff6e', 22, 10, 1, 1);
  // keyboard and mouse on the desk top
  P.r('#41463a', 10, 12, 12, 2); P.r('#5c6452', 10, 12, 12, 1);
  for (let i = 11; i < 21; i += 2) P.r('#2c3028', i, 13, 1, 1);
  P.r('#5c6452', 24, 13, 2, 1); P.r('#41463a', 24, 14, 2, 1);
  // cables: monitor to mouse, and down the back of the desk to the floor
  P.r('#0c0c0a', 24, 9, 1, 1); P.r('#0c0c0a', 25, 10, 1, 3);
  P.ln('#0a0a08', 8, 10, 6, 15); P.r('#0a0a08', 9, 18, 1, 4); P.r('#0a0a08', 10, 21, 1, 1);
  spr_chair(P, false);
  return spr_prop(P.c, '#000000');
}
// The CRT screen face in desk-canvas pixels (after the outline).
function spr_deskScreen() { return { x: 10 + 1, y: 3 + 1, w: 12, h: 6 }; }

function spr_neoAsleep() {
  const P = spr_paint(spr_DESK_W, spr_DESK_H);
  const hair = ['#050606', '#141a19', '#26302d'];
  const t = ['#1c2024', '#2a2f34', '#3a4046', '#4c535a'];
  const skin = ['#7a5644', '#a87a62', '#d0a68a'];
  // hunched back and shoulders in the chair
  P.r(t[1], 11, 14, 10, 5); P.r(t[2], 12, 14, 8, 1); P.r(t[2], 11, 15, 1, 3); P.r(t[0], 20, 15, 1, 3);
  P.r(t[0], 16, 16, 1, 2); P.clear(11, 14, 1, 1); P.clear(20, 14, 1, 1);
  // elbows out on the desk, forearms folded under his head
  P.r(t[2], 9, 13, 3, 2); P.r(t[3], 9, 13, 2, 1); P.r(t[1], 20, 13, 3, 2); P.r(t[2], 20, 13, 2, 1);
  P.r(skin[1], 11, 13, 3, 1); P.r(skin[2], 11, 13, 2, 1); P.r(skin[1], 18, 13, 3, 1); P.r(skin[2], 19, 13, 1, 1);
  // the back of his neck
  P.r(skin[1], 15, 14, 2, 1); P.r(skin[0], 16, 14, 1, 1);
  // head down on the arms, turned a little to the right
  P.r(hair[0], 13, 11, 6, 3); P.r(hair[0], 14, 10, 4, 1); P.r(hair[1], 14, 11, 3, 1); P.r(hair[2], 15, 11, 1, 1);
  P.r(hair[1], 13, 12, 1, 1);
  P.r(skin[1], 18, 13, 1, 1); P.r(skin[0], 17, 13, 1, 1);
  // headphones: a band over the crown, a cup on each ear (green LED on the near one)
  P.r('#4a504c', 14, 9, 4, 1); P.r('#6a726c', 15, 9, 2, 1); P.r('#3a3e3c', 13, 10, 1, 1); P.r('#3a3e3c', 18, 10, 1, 1);
  P.r('#1e2220', 12, 11, 1, 2); P.r('#1e2220', 18, 11, 2, 2); P.r('#4a504c', 18, 11, 1, 1); P.r('#3cff6e', 19, 12, 1, 1);
  // the chair's backrest in front of him
  spr_chair(P, true);
  return spr_prop(P.c, '#000000');
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------
function spr_bug() {
  const pal = { Y: '#ffe08a', O: '#ffa53a', o: '#d06e1c', d: '#7a3a10', h: '#3a1c0a', e: '#fff6c8', g: '#3ae8ff', l: '#c87a2a' };
  // a glitch beetle seen from above: split shell, dark head, pale eyes,
  // snapping mandibles
  const body = [
    '..........',
    '..YYOOo...',
    '.YOgOOohe.',
    '.ddddddhh.',
    '.Ooooooohe',
    '..oooo....',
    '..........',
  ];
  const frames = [];
  for (let f = 0; f < 2; f++) {
    const g = spr_grid(10, 7);
    spr_stamp(g, body, 0, 0);
    spr_put(g, 8, 2, '.'); spr_put(g, 8, 4, '.'); spr_put(g, 8, 2, 'e'); spr_put(g, 9, 4, '.'); spr_put(g, 8, 4, 'e');
    // tripod gait: the legs on each side alternate
    const top = f ? [2, 5] : [1, 4, 6], bot = f ? [1, 4, 6] : [2, 5];
    for (const x of top) spr_put(g, x, 0, 'l');
    for (const x of bot) spr_put(g, x, 6, 'l');
    // mandibles open and close
    if (f) { spr_put(g, 9, 2, 'l'); spr_put(g, 9, 4, 'l'); } else { spr_put(g, 9, 3, 'l'); }
    frames.push(spr_fromGrid(g, pal, '#000000', 4));
  }
  return { move: frames };
}

function spr_watchdog() {
  const pal = { d: '#121a26', m: '#2b3c54', M: '#46648a', H: '#7c9ec4', c: '#2fd8f2', C: '#b8fbff', W: '#ffffff', t: '#2b3c54' };
  const body = [
    '.........Hm..',
    '........HMMMm',
    't......HMMcCM',
    'tt.HMMMMMMMmm',
    '.tHMMMMMMMmd.',
    '..mdcccccdmd.',
  ];
  const legsAt = (g, list, y0, len) => {
    for (const [x, dir, near] of list) {
      const col = near ? 'M' : 'd';
      for (let k = 0; k < len; k++) spr_put(g, x + (k >= 1 ? dir : 0), y0 + k, col);
      spr_put(g, x + dir + 1, y0 + len - 1, col);
    }
  };
  const frame = (f) => {
    const g = spr_grid(13, 9);
    spr_stamp(g, body, 0, 0);
    if (f === 0) legsAt(g, [[3, -1, 0], [5, 1, 1], [9, -1, 0], [11, 0, 1]], 6, 3);
    else legsAt(g, [[3, 1, 0], [4, -1, 1], [9, 1, 0], [10, -1, 1]], 6, 3);
    return spr_fromGrid(g, pal, '#000000', 6);
  };
  const tell = (() => {
    const g = spr_grid(13, 9);
    spr_stamp(g, body.map((r) => r.replace('cC', 'WW').replace(/c/g, 'C')), 0, 1);
    legsAt(g, [[3, -1, 0], [5, -1, 1], [9, 0, 0], [11, 0, 1]], 7, 2);
    spr_put(g, 12, 3, 'C'); spr_put(g, 9, 0, 'C'); spr_put(g, 6, 3, 'C'); spr_put(g, 4, 3, 'C');
    return spr_fromGrid(g, pal, '#000000', 6);
  })();
  const dash = (() => {
    const g = spr_grid(15, 9);
    const b = body.map((r) => r.slice(0, 5) + r.slice(3, 5) + r.slice(5));
    spr_stamp(g, b.slice(1), 0, 2);
    spr_put(g, 11, 2, '.'); spr_put(g, 10, 2, 'H');
    // legs flung fore and aft
    for (const [x, y, c] of [[2, 7, 'd'], [1, 8, 'd'], [4, 7, 'M'], [3, 8, 'M'], [12, 7, 'd'], [13, 8, 'd'], [11, 7, 'M'], [12, 8, 'M'], [14, 8, 'M'], [0, 8, 'd']]) spr_put(g, x, y, c);
    spr_put(g, 0, 5, 'c'); spr_put(g, 0, 6, 'C');
    return spr_fromGrid(g, pal, '#000000', 7);
  })();
  return { move: [frame(0), frame(1)], tell, dash };
}

function spr_firewall() {
  const mk = (hot) => {
    const P = spr_paint(12, 12);
    const m = ['#1c120c', '#2e1f14', '#45301f', '#5e442c', '#7a5a3a'];
    // a block of bricks with glowing mortar
    const a = hot ? '#ffe680' : '#ffb43a', a2 = hot ? '#ffb43a' : '#a8501a';
    P.r(a2, 1, 5, 10, 7);
    const bricks = [[1, 5, 4], [6, 5, 5], [1, 7, 2], [4, 7, 4], [9, 7, 2], [1, 9, 3], [5, 9, 3], [9, 9, 2]];
    for (const [bx, by, bw] of bricks) { P.r(m[2], bx, by, bw, 1); P.r(m[3], bx, by, bw - 1, 1); }
    for (const [bx, by, bw] of bricks) P.r(m[1], bx, by + 1, bw, 0);
    P.r(m[3], 1, 5, 1, 6); P.r(m[0], 1, 11, 10, 1); P.r(m[1], 10, 6, 1, 5);
    // a glyph burning in one brick
    P.r(m[0], 4, 7, 4, 1); P.r(a, 5, 7, 1, 1); P.r(a, 7, 7, 1, 1); if (hot) P.r('#ffffff', 6, 7, 1, 1);
    // brazier bowl
    P.r(m[3], 2, 3, 8, 2); P.r(m[4], 2, 3, 8, 1); P.r(m[1], 3, 4, 6, 1);
    // emitter
    if (hot) {
      P.r('#ff8a2a', 3, 2, 6, 1); P.r('#ffd27a', 4, 1, 4, 2); P.r('#fffbe0', 5, 0, 2, 3); P.r('#ffffff', 5, 1, 2, 1);
      P.r('#ffd27a', 3, 3, 6, 1);
    } else {
      P.r('#c8541a', 3, 2, 6, 1); P.r('#ff8a2a', 4, 1, 4, 2); P.r('#ffc060', 5, 1, 2, 2); P.r('#ff8a2a', 5, 0, 1, 1);
    }
    return spr_prop(P.c, '#000000');
  };
  return { idle: mk(false), tell: mk(true) };
}

function spr_sentinel() {
  const metal = ['#141824', '#262c40', '#3a4260', '#566088', '#8494c0'];
  const mk = (f, tell) => {
    const P = spr_paint(15, 12);
    // five segmented tentacles trailing to the left, waving
    const ph = f * Math.PI;
    const roots = [3, 4.5, 6, 7.5, 9], tips = [0.5, 3, 5.5, 8.5, 11];
    for (let t = 0; t < 5; t++) {
      const sx = 7, ex = t === 2 ? 0 : t % 2 ? 1 : 2;
      for (let x = sx; x >= ex; x--) {
        const d = (sx - x) / (sx - ex);
        const y = Math.round(lerp(roots[t], tips[t], d) + Math.sin(d * 4 + ph + t * 1.7) * d * 1.2);
        P.r(x === ex ? metal[4] : (sx - x) % 2 ? metal[3] : metal[1], x, clamp(y, 0, 11));
      }
    }
    // the squid head, with a darker brow and the eye cluster
    P.disc(10.5, 5.5, 4.5, 4.4, metal);
    P.r(metal[1], 9, 2, 1, 1); P.r(metal[0], 7, 8, 5, 1);
    const e1 = tell ? '#ffffff' : '#ff4adf', e2 = tell ? '#ffd0f6' : '#c25aff', e3 = tell ? '#ff7ae8' : '#4a1a6a';
    P.r(e3, 11, 3, 3, 5);
    P.r(e1, 12, 4, 2, 1); P.r(e1, 13, 6, 1, 1); P.r(e2, 11, 5, 2, 1); P.r(e2, 12, 7, 1, 1); P.r(e2, 14, 5, 1, 1);
    if (tell) { P.r('#ffffff', 11, 5, 3, 1); P.r(e2, 14, 4, 1, 3); P.r(e2, 10, 4, 1, 1); }
    return spr_prop(P.c, '#000000');
  };
  return { move: [mk(0, false), mk(1, false)], tell: mk(0, true) };
}

function spr_worm() {
  const ramp = ['#4a0c40', '#8a1c74', '#c8309e', '#ff5ad0', '#ffb0ec'];
  const head = (() => {
    const P = spr_paint(7, 7);
    P.disc(3.5, 3.5, 3.5, 3.5, ramp);
    P.r('#2a0626', 5, 2, 2, 1); P.r('#2a0626', 5, 4, 2, 1); P.r('#ffffff', 4, 2, 1, 1); P.r('#ffffff', 4, 4, 1, 1);
    P.r('#2a0626', 6, 3, 1, 1);
    return spr_prop(P.c, '#000000');
  })();
  const body = (() => {
    const P = spr_paint(6, 6);
    P.disc(3, 3, 3, 3, ramp, -0.06);
    P.r(ramp[1], 2, 1, 1, 4); P.r(ramp[4], 1, 2, 1, 1);
    return spr_prop(P.c, '#000000');
  })();
  const small = (() => {
    const P = spr_paint(5, 5);
    P.disc(2.5, 2.5, 2.5, 2.5, ramp);
    P.r('#ffffff', 3, 1, 1, 1); P.r('#ffffff', 3, 3, 1, 1); P.r('#2a0626', 4, 2, 1, 1);
    return spr_prop(P.c, '#000000');
  })();
  return { head, body, small };
}

function spr_exile() {
  const pal = { v: '#22143a', V: '#3e2768', U: '#6040a0', X: '#9070d8', f: '#06030c', y: '#3ae8ff', Y: '#e0ffff' };
  const robe = [
    '....XV.....',
    '...XUVv....',
    '..XUVVVv...',
    '..XUVfffv..',
    '.XUVffyYv..',
    '.XUVVfffv..',
    '.XUVVVVvv..',
    '.XUUVVVVv..',
    '.XUVVVyyvv.',
    'XUUVVVVVvv.',
    'XUVVVvVVVv.',
    'XUVVVvVVVvv',
    'XUVVvVVVVvv',
    'UVVVvVVVVvv',
    'UVVvVVVvVv.',
  ];
  const hems = ['V.v.V.v.V..', '.V.v.V.v.V.'];
  const idle = [0, 1].map((f) => {
    const g = spr_grid(11, 17);
    spr_stamp(g, robe, 0, f);
    spr_stamp(g, [hems[f]], 0, 15 + f);
    return spr_fromGrid(g, pal, '#000000', 5, 16);
  });
  const cast = (() => {
    const g = spr_grid(11, 17);
    spr_stamp(g, robe.map((r, j) => (j === 8 ? r.replace('yy', 'VV') : r)), 0, 1);
    spr_stamp(g, [hems[0]], 0, 16);
    // raised sleeves either side of the hood, hands crackling cyan
    spr_stamp(g, ['y', 'X', 'U', 'U', 'X'], 0, 1); spr_stamp(g, ['y', 'V', 'v', 'v', 'V'], 9, 1);
    spr_put(g, 0, 0, 'Y'); spr_put(g, 10, 0, 'Y'); spr_put(g, 1, 0, 'y'); spr_put(g, 9, 0, 'y'); spr_put(g, 10, 1, 'y');
    return spr_fromGrid(g, pal, '#000000', 5, 16);
  })();
  return { idle, cast };
}

// ---------------------------------------------------------------------------
// Agents (the mini-boss and, enlarged, the boss)
// ---------------------------------------------------------------------------
function spr_agentPal() {
  return {
    h: '#16120e', H: '#3a2e24', s: '#ecd4c4', S: '#b89888', g: '#000000', G: '#6a8cae', e: '#c8d2dc',
    k: '#07080b', c: '#161a22', C: '#262c38', L: '#3e4658', w: '#eef2f4', W: '#aab4bc', n: '#0b0c10',
    b: '#000000', B: '#3a3e48', P: '#1c1e24', Q: '#6a7080',
  };
}
const spr_AGENT_HEAD = [
  '.hhhh.',
  'hHHhhh',
  'hhhsss',
  'hhegGg',
  '.hSsss',
  '..eSs.',
];
const spr_AGENT_TORSO = [
  '....LCCwW....',
  '...LCCcwnw...',
  '...LCccwnk...',
  '...LCcccnk...',
  '...LCccccck..',
  '...LCccccck..',
  '...kccccckk..',
];
const spr_AGENT_LEGS = {
  idle: ['...cccccc....', '....Cc.Cc....', '....Cc.Cc....', '....Cc.Cc....', '....bb.bbB...'],
  a: ['...cccccc....', '...Cc...Cc...', '...Cc....Cc..', '..Cc.....Cc..', '..bbB....bbB.'],
  b: ['...cccccc....', '...cC...cC...', '..cC.....cC..', '..cC.....cC..', '.bbB.....bbB.'],
  pass: ['...cccccc....', '.....Ccc.....', '.....Ccc.....', '.....Ccc.....', '.....bbbB....'],
};
function spr_agentFrame(pose, f, big) {
  const g = spr_grid(15, 18);
  const ox = 1;
  let by = 1, swing = 0, legs = 'idle';
  if (pose === 'walk') {
    by = f % 2 === 1 ? 0 : 1;
    legs = f === 0 ? 'a' : f === 2 ? 'b' : 'pass';
    swing = f === 0 ? 1 : f === 2 ? -1 : 0;
  }
  spr_stamp(g, spr_AGENT_LEGS[legs], ox, 13);
  spr_stamp(g, spr_AGENT_TORSO, ox, by + 6);
  if (pose === 'aim') {
    // arm straight out at shoulder height, pistol pointing right
    spr_stamp(g, ['LCCCCw', 'CccccWs'], ox + 6, by + 7);
    spr_stamp(g, ['QPP', 'P..'], ox + 12, by + 7);
    spr_put(g, ox + 12, by + 8, 'P'); spr_put(g, ox + 13, by + 8, 'P');
  } else {
    const ax = ox + 5 + (swing > 0 ? 1 : 0) + (swing < 0 ? -1 : 0);
    spr_stamp(g, ['LC', 'LC', 'Lc'], ox + 5, by + 7);
    spr_stamp(g, ['Lc', 'ww'], ax, by + 10);
    spr_put(g, ax + (swing > 0 ? 1 : 0), by + 12, 's');
  }
  if (big) {
    // the boss: a longer torso and legs, broader shoulders, then the head
    spr_dupRow(g, 15); spr_dupRow(g, by + 9); spr_dupCol(g, 7);
    for (const r of g) r.push('.');
    g.unshift(new Array(g[0].length).fill('.'));
    // a faint green rim where the suit meets the dark
    const suit = 'kcCL';
    const h = g.length, w = g[0].length;
    const rim = [];
    for (let j = 0; j < h - 6; j++) for (let i = 0; i < w; i++) {
      if (!suit.includes(g[j][i])) continue;
      const open = (x, y) => x < 0 || y < 0 || x >= w || y >= h || g[y][x] === '.';
      if (open(i - 1, j) || open(i, j - 1) || open(i + 1, j)) rim.push([i, j]);
    }
    for (const [i, j] of rim) g[j][i] = 'R';
    spr_stamp(g, spr_AGENT_HEAD, ox + 5, by + 1);
  } else {
    spr_stamp(g, spr_AGENT_HEAD, ox + 4, by);
  }
  return g;
}
function spr_agentSet(big) {
  const pal = spr_agentPal();
  pal.R = '#2c6648';
  const mk = (pose, f) => spr_fromGrid(spr_agentFrame(pose, f, big), pal, '#000000', big ? 8 : 7);
  return { walk: [0, 1, 2, 3].map((f) => mk('walk', f)), aim: mk('aim', 0), idle: mk('idle', 0) };
}

// ---------------------------------------------------------------------------
// Creatures: the white rabbit and the black cat
// ---------------------------------------------------------------------------
function spr_rabbit() {
  const pal = { w: '#ffffff', W: '#e2e8e4', s: '#aab6b0', p: '#ff9ab8', n: '#ffc8d8' };
  const f0 = [
    '....ww...',
    '.....ww..',
    '.....wwww',
    '..wwwwwpw',
    '.wwwwwwwn',
    'wWwwwwWw.',
    '.sWWssWs.',
  ];
  const f1 = [
    '.....ww..',
    '......ww.',
    '..wwwwwww',
    '.wWwwwwpw',
    'wWwwwwwwn',
    's.sWwWs..',
    'ss....ss.',
  ];
  const mk = (rows) => { const g = spr_grid(9, 7); spr_stamp(g, rows, 0, 0); return spr_fromGrid(g, pal, '#000000', 4); };
  const frames = [mk(f0), mk(f1)];
  const tail = spr_fromGrid(spr_stamp(spr_grid(4, 3), ['.ww.', 'wwWw', '.Ws.'], 0, 0), pal, '#000000', 1);
  return { frames, tail };
}

function spr_cat() {
  const pal = { k: '#08080a', K: '#18191d', L: '#2e3238', y: '#c8ff5a' };
  const body = [
    'L........K.K',
    'K........KKK',
    '.K..LLLLLKyK',
    '.KKKKKKKKKKk',
    '..KKKKKKKKk.',
  ];
  const legs = [
    ['..k..K..k.K.', '..k..K..k.K.'],
    ['...kK....kK.', '..k..K.k...K'],
  ];
  const tails = [['L.........', 'K.........'], ['.L........', 'K.........']];
  const frames = [0, 1].map((f) => {
    const g = spr_grid(12, 7);
    spr_stamp(g, body, 0, 0);
    spr_stamp(g, tails[f], 0, 0);
    spr_stamp(g, legs[f], 0, 5);
    return spr_fromGrid(g, pal, '#5a6a60', 6);
  });
  return frames;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
function spr_bed() {
  const P = spr_paint(16, 28);
  const wood = ['#1a120c', '#2a1e14', '#3c2c1e', '#4e3a28'];
  // frame: headboard, sides, footboard front
  P.r(wood[2], 0, 0, 16, 4); P.r(wood[3], 0, 0, 16, 1); P.r(wood[1], 1, 2, 14, 2);
  P.r(wood[1], 0, 4, 1, 21); P.r(wood[1], 15, 4, 1, 21);
  P.r(wood[2], 0, 24, 16, 2); P.r(wood[3], 0, 24, 16, 1); P.r(wood[0], 0, 26, 16, 2); P.r(wood[1], 1, 26, 1, 2); P.r(wood[1], 14, 26, 1, 2);
  // mattress and sheet
  P.r('#4a4e52', 1, 4, 14, 20);
  // pillow (dented)
  P.r('#7a8084', 2, 4, 9, 5); P.r('#9aa0a2', 2, 4, 9, 1); P.r('#5e6468', 2, 8, 9, 1); P.r('#666c70', 5, 6, 3, 1);
  // rumpled blanket, thrown back
  const bl = ['#1a2028', '#232b36', '#2e3846', '#3c4858'];
  P.r(bl[2], 1, 10, 14, 14);
  P.r(bl[3], 1, 10, 14, 1);
  P.ln(bl[1], 3, 12, 8, 16); P.ln(bl[1], 10, 11, 13, 15); P.ln(bl[3], 4, 12, 9, 16); P.ln(bl[1], 2, 19, 7, 22); P.ln(bl[3], 9, 18, 13, 21);
  P.r(bl[0], 1, 23, 14, 1);
  // a corner folded back showing the sheet, and a fold hanging over the side
  P.r('#4a4e52', 11, 10, 4, 2); P.r('#5a5e62', 12, 10, 3, 1);
  P.r(bl[1], 15, 14, 1, 8); P.r(bl[0], 15, 21, 1, 2);
  return spr_prop(P.c, '#000000');
}

function spr_door(open) {
  const P = spr_paint(32, 24);
  const fr = ['#140d08', '#24180f', '#3a2818', '#4e3822'];
  // frame
  P.r(fr[2], 8, 0, 16, 24); P.r(fr[3], 8, 0, 16, 1); P.r(fr[3], 8, 0, 1, 24); P.r(fr[1], 23, 0, 1, 24);
  if (!open) {
    const lf = ['#20160e', '#2e2014', '#3e2c1c', '#4c3824'];
    P.r(lf[2], 10, 2, 12, 22); P.r(lf[3], 10, 2, 12, 1); P.r(lf[3], 10, 2, 1, 22); P.r(lf[1], 21, 2, 1, 22);
    // panels
    P.r(lf[1], 12, 4, 8, 7); P.r(lf[3], 12, 10, 8, 1); P.r(lf[1], 12, 13, 8, 9); P.r(lf[3], 12, 21, 8, 1);
    P.r(lf[2], 13, 5, 6, 5); P.r(lf[2], 13, 14, 6, 7);
    // number plate, peephole, knob
    P.r('#8a6a2a', 15, 6, 3, 2); P.r('#c8a04a', 15, 6, 3, 1);
    P.r('#05050a', 16, 9, 1, 1);
    P.r('#b89a54', 19, 13, 2, 2); P.r('#f0d080', 19, 13, 1, 1); P.r('#5a4420', 20, 14, 1, 1);
    // light leaking under the door
    P.r('#3a3a20', 11, 23, 10, 1);
  } else {
    // dark gap with a sliver of the dim corridor beyond
    P.r('#020302', 10, 2, 12, 22);
    P.r('#0a0e0b', 12, 14, 9, 10); P.r('#101611', 13, 17, 7, 7); P.r('#141b15', 14, 20, 5, 4);
    P.r('#0c120d', 12, 6, 1, 8); P.r('#1a1e14', 16, 4, 1, 1); P.r('#3a3420', 16, 5, 1, 1); P.r('#2a2618', 15, 6, 3, 1);
    // the door leaf swung in, seen edge-on
    P.r('#3e2c1c', 10, 2, 2, 22); P.r('#4c3824', 10, 2, 1, 22); P.r('#b89a54', 11, 13, 1, 1);
    P.r('#06080a', 21, 2, 1, 22);
  }
  return spr_anchor(P.c, 16, 23);
}

function spr_clock() {
  const P = spr_paint(11, 11);
  P.disc(5.5, 5.5, 5.5, 5.5, ['#0e0e0c', '#1e1e1a', '#2e2e28']);
  P.disc(5.5, 5.5, 4.5, 4.5, ['#6e766a', '#80887a', '#8e9688', '#9ca496'], 0.25);
  // ticks at 12, 3, 6, 9
  P.r('#5a5e56', 5, 1, 1, 1); P.r('#5a5e56', 5, 9, 1, 1); P.r('#5a5e56', 1, 5, 1, 1);
  // 3:14 - the long minute hand a hair above three, the short hour hand just past it
  P.r('#101010', 5, 5, 1, 1);
  P.r('#101010', 6, 5, 2, 1); P.r('#101010', 8, 4, 2, 1);
  P.r('#3a3a34', 6, 6, 2, 1);
  return spr_anchor(P.c, 5, 10);
}

function spr_lamp() {
  const P = spr_paint(8, 16);
  // shade, lit from inside
  P.r('#7a4e24', 2, 0, 4, 1); P.r('#9a6630', 1, 1, 6, 2); P.r('#b87e3c', 1, 1, 2, 2); P.r('#9a6630', 0, 3, 8, 2); P.r('#c8904a', 0, 3, 2, 2);
  P.r('#ffd890', 0, 5, 8, 1); P.r('#fff2c8', 3, 6, 2, 1);
  // pole and base
  P.r('#2a2620', 3, 6, 2, 8); P.r('#3e3a32', 3, 7, 1, 7);
  P.r('#1e1a16', 1, 14, 6, 2); P.r('#3a342c', 1, 14, 6, 1);
  return spr_prop(P.c, '#000000');
}

function spr_poster() {
  const P = spr_paint(12, 14);
  P.r('#2a3236', 0, 0, 12, 14); P.r('#3a4448', 1, 1, 10, 12);
  P.disc(6, 5, 3.4, 3.4, ['#4e5a5a', '#5e6a68', '#6e7a76']);
  // a faded figure in a long coat against the moon
  P.r('#262c2e', 5, 4, 2, 1); P.r('#262c2e', 4, 5, 4, 4); P.r('#262c2e', 3, 8, 6, 2);
  // title bars
  P.r('#5a6664', 2, 11, 8, 1); P.r('#4a5454', 3, 12, 6, 1);
  // torn corner and tape
  P.clear(10, 12, 2, 2); P.clear(11, 11, 1, 1);
  P.r('#7a7a64', 0, 0, 2, 1); P.r('#7a7a64', 10, 0, 2, 1); P.r('#7a7a64', 0, 13, 2, 1);
  return spr_anchor(P.c, 6, 13);
}

function spr_cache(open) {
  const P = spr_paint(14, 14);
  const m = ['#0a120d', '#15211a', '#22342a', '#33493b', '#4a6654'];
  if (open) {
    // lid raised behind, light pouring out
    P.r(m[2], 1, 1, 12, 5); P.r(m[3], 1, 1, 12, 1); P.r(m[1], 2, 2, 10, 4);
    P.r('#1f6a34', 3, 3, 8, 3);
    P.r('#3cff6e', 4, 0, 1, 1); P.r('#8cffb0', 7, 0, 1, 2); P.r('#3cff6e', 10, 1, 1, 1);
    P.r('#8cffb0', 1, 6, 12, 2); P.r('#e0ffe8', 3, 6, 8, 1); P.r('#3cff6e', 1, 7, 12, 1);
  } else {
    // lid top surface
    P.r(m[3], 1, 4, 12, 3); P.r(m[4], 1, 4, 12, 1); P.r(m[2], 1, 7, 12, 1);
    P.r('#1f6a34', 3, 5, 8, 1);
  }
  // body front
  P.r(m[2], 0, 8, 14, 6); P.r(m[3], 0, 8, 14, 1); P.r(m[3], 0, 8, 1, 5); P.r(m[1], 13, 9, 1, 5); P.r(m[0], 0, 13, 14, 1);
  // corner brackets
  P.r(m[4], 0, 8, 2, 1); P.r(m[4], 12, 8, 2, 1); P.r(m[0], 1, 12, 2, 1); P.r(m[0], 11, 12, 2, 1);
  // padlock glyph (open: unlatched)
  const g = open ? '#8cffb0' : '#3cff6e';
  if (open) { P.r(g, 6, 8, 1, 2); P.r(g, 7, 8, 1, 1); } else { P.r(g, 6, 8, 2, 1); P.r(g, 5, 9, 1, 1); P.r(g, 8, 9, 1, 1); }
  P.r(g, 5, 10, 4, 3); P.r('#0a2a14', 6, 11, 2, 1);
  return spr_prop(P.c, '#000000');
}

function spr_phone(ring, f) {
  const P = spr_paint(12, 18);
  const dx = ring ? (f === 0 ? -1 : 1) : 0;
  const m = ['#0e1214', '#1c2428', '#2e3a40', '#46565e', '#64767e'];
  // post
  P.r(m[1], 5, 12, 2, 5); P.r(m[2], 5, 12, 1, 5); P.r(m[0], 3, 17, 6, 1); P.r(m[2], 4, 16, 4, 1);
  const x0 = 2 + dx;
  // housing with a hood
  P.r(m[3], x0, 0, 8, 2); P.r(m[4], x0, 0, 8, 1);
  P.r(m[2], x0, 2, 8, 10); P.r(m[3], x0, 2, 1, 10); P.r(m[1], x0 + 7, 2, 1, 10); P.r(m[0], x0, 11, 8, 1);
  // little screen, coin slot, keypad
  P.r('#0c3a1a', x0 + 3, 3, 4, 2); P.r('#3cff6e', x0 + 4, 3, 2, 1);
  P.r(m[0], x0 + 6, 6, 1, 1);
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) P.r(j === 1 && i === 0 ? '#8cffb0' : '#5a7a64', x0 + 3 + i * 2, 6 + j * 2, 1, 1);
  // handset on the hook (lifts a little when ringing)
  const hy = ring ? (f === 0 ? 1 : 2) : 2;
  P.r('#05080a', x0 - 1, hy, 2, 8); P.r('#2a3438', x0 - 1, hy, 1, 7); P.r('#05080a', x0, hy - 1, 1, 1); P.r('#05080a', x0, hy + 8, 1, 1);
  // coiled cord
  P.r('#0a0e10', x0, 11, 1, 1); P.r('#0a0e10', x0 + 1, 12, 1, 1); P.r('#0a0e10', x0, 13, 1, 1);
  if (ring) {
    const s = '#d8ffe0', s2 = '#3cff6e';
    if (f === 0) { P.r(s, 0, 0, 1, 1); P.r(s2, 1, 1, 1, 1); P.r(s, 11, 2, 1, 1); P.r(s2, 11, 4, 1, 1); }
    else { P.r(s2, 0, 1, 1, 1); P.r(s, 0, 3, 1, 1); P.r(s, 11, 0, 1, 1); P.r(s2, 10, 1, 1, 1); }
  }
  return spr_prop(P.c, '#000000');
}

function spr_oracle() {
  const P = spr_paint(14, 16);
  const cs = ['#151812', '#262b22', '#3a4134', '#525a48', '#6a7460'];
  const wood = ['#1c130c', '#2e2016', '#45301f', '#5a4028'];
  // a little table
  P.r(wood[2], 0, 10, 14, 2); P.r(wood[3], 0, 10, 14, 1); P.r(wood[1], 0, 12, 14, 1);
  P.r(wood[1], 1, 13, 2, 3); P.r(wood[1], 11, 13, 2, 3); P.r(wood[0], 2, 13, 1, 3);
  // old terminal
  P.r(cs[2], 1, 0, 8, 2); P.r(cs[3], 2, 0, 6, 1);
  P.r(cs[3], 0, 2, 10, 8); P.r(cs[4], 0, 2, 10, 1); P.r(cs[4], 0, 2, 1, 7); P.r(cs[1], 9, 3, 1, 7); P.r(cs[1], 0, 9, 10, 1);
  P.r(cs[1], 2, 3, 6, 5); P.r('#0c3416', 3, 4, 4, 3);
  P.r('#3cff6e', 3, 4, 3, 1); P.r('#2ad65a', 3, 6, 2, 1); P.r('#8cffb0', 6, 6, 1, 1);
  P.r('#3cff6e', 8, 8, 1, 1);
  // keyboard
  P.r('#41463a', 1, 10, 7, 1); P.r('#2c3028', 2, 11, 5, 1);
  // a plate of cookies
  P.r('#b8bcb0', 9, 9, 5, 2); P.r('#d8dcd0', 10, 9, 3, 1);
  P.r('#a8743a', 10, 8, 2, 2); P.r('#c8904a', 10, 8, 1, 1); P.r('#4a2a14', 11, 9, 1, 1);
  P.r('#a8743a', 12, 8, 2, 1); P.r('#c8904a', 12, 8, 1, 1); P.r('#4a2a14', 13, 8, 1, 1);
  P.r('#8a5a2a', 11, 7, 2, 1);
  return spr_prop(P.c, '#000000');
}

// The backdoor: a tall rack with an amber screen showing an open padlock.
function spr_backdoor() {
  const P = spr_paint(12, 18);
  const m = ['#14110e', '#24201a', '#38322a', '#4c453a'];
  P.r(m[2], 0, 0, 12, 18); P.r(m[3], 0, 0, 12, 1); P.r(m[3], 0, 0, 1, 17); P.r(m[0], 11, 1, 1, 17); P.r(m[0], 0, 17, 12, 1);
  // the screen
  P.r('#1a0c04', 2, 2, 8, 7); P.r('#3a1a06', 3, 3, 6, 5);
  P.r('#ff9a3c', 4, 3, 3, 1); P.r('#ff9a3c', 4, 4, 1, 1); P.r('#ff9a3c', 7, 3, 1, 2); // the shackle, open
  P.r('#ffb43a', 4, 5, 4, 3); P.r('#3a1a06', 5, 6, 2, 1); P.r('#ffd890', 4, 5, 1, 1);
  // drive bays and blinking lights
  for (let y = 10; y <= 15; y += 2) { P.r(m[1], 2, y, 8, 1); P.r('#ff9a3c', 9, y, 1, 1); }
  P.r('#3cff6e', 3, 11, 1, 1); P.r('#3cff6e', 5, 13, 1, 1);
  return spr_prop(P.c, '#000000');
}

function spr_mirror() {
  const P = spr_paint(12, 14);
  // frame
  P.r('#2a2620', 0, 0, 12, 14); P.r('#4a4438', 0, 0, 12, 1); P.r('#4a4438', 0, 0, 1, 14); P.r('#14120e', 11, 0, 1, 14); P.r('#14120e', 0, 13, 12, 1);
  // glass
  P.r('#1a2428', 1, 1, 10, 12); P.r('#22303a', 1, 1, 10, 4);
  // the reflection: Neo's face, no shades, eyes closed
  P.r('#08090a', 3, 3, 6, 3); P.r('#08090a', 4, 2, 4, 1); P.r('#1e2624', 4, 3, 3, 1);
  P.r('#a8826c', 4, 5, 4, 5); P.r('#c49a80', 4, 5, 2, 2); P.r('#7a5a4a', 7, 6, 1, 4); P.r('#08090a', 3, 5, 1, 2); P.r('#08090a', 8, 5, 1, 2);
  P.r('#3a2620', 4, 7, 1, 1); P.r('#3a2620', 6, 7, 2, 1); // closed lids
  P.r('#7a5a4a', 5, 9, 2, 1); P.r('#5a4a42', 5, 10, 2, 1);
  P.r('#2c343a', 3, 10, 6, 3); P.r('#1a2026', 4, 11, 4, 2);
  // cracks
  P.ln('#9ab0b4', 9, 2, 7, 5); P.ln('#9ab0b4', 9, 2, 10, 6); P.ln('#7a9094', 8, 3, 5, 3); P.ln('#7a9094', 7, 5, 7, 8);
  P.r('#cce0e4', 9, 2, 1, 1);
  P.r('#3a4a54', 2, 2, 1, 1); P.r('#3a4a54', 1, 3, 1, 1);
  return spr_anchor(P.c, 6, 13);
}

function spr_window() {
  const P = spr_paint(20, 14);
  // frame and sill
  P.r('#1e1c1a', 0, 0, 20, 14); P.r('#2e2c28', 0, 0, 20, 1); P.r('#3e3a34', 0, 12, 20, 2); P.r('#524c44', 0, 12, 20, 1);
  // night interior
  P.r('#05090a', 1, 1, 18, 11);
  P.r('#081210', 5, 3, 11, 9);
  // the tiny desk with a green CRT glow and Neo slumped at it
  P.r('#0c2a16', 6, 4, 8, 5);
  P.r('#262b22', 8, 5, 4, 4); P.r('#2ad65a', 9, 6, 2, 2); P.r('#8cffb0', 9, 6, 1, 1);
  P.r('#1a120c', 6, 9, 9, 1); P.r('#120c08', 7, 10, 1, 2); P.r('#120c08', 13, 10, 1, 2);
  P.r('#000000', 12, 7, 2, 2); P.r('#3a4a40', 12, 7, 1, 1);
  P.r('#4a5a52', 11, 9, 4, 2); P.r('#5e7066', 11, 9, 2, 1); P.r('#2a3430', 12, 11, 3, 1);
  P.r('#8a7060', 11, 8, 1, 1);
  // sash bar and a faint reflection on the glass
  P.r('#1e1c1a', 1, 4, 18, 1); P.r('#2e2c28', 1, 4, 18, 0);
  P.r('#1a2426', 2, 2, 1, 1); P.r('#1a2426', 3, 1, 1, 1); P.r('#141c1e', 16, 6, 1, 1); P.r('#141c1e', 17, 5, 1, 1);
  return spr_anchor(P.c, 10, 13);
}

function spr_signs() {
  const out = {};
  // tenement: brass room plate 101
  {
    const P = spr_paint(12, 8);
    P.r('#3a2a10', 0, 0, 12, 8); P.r('#8a6a2a', 1, 1, 10, 6); P.r('#b8903a', 1, 1, 10, 1); P.r('#5a4418', 1, 6, 10, 1);
    P.tpl(spr_DIGITS['1'], { '#': '#2a1c08' }, 2, 1);
    P.tpl(spr_DIGITS['0'], { '#': '#2a1c08' }, 5, 1);
    P.tpl(spr_DIGITS['1'], { '#': '#2a1c08' }, 9, 1);
    P.r('#e0c070', 0, 0, 1, 1); P.r('#e0c070', 11, 0, 1, 1);
    out.tenement = spr_anchor(P.c, 6, 7);
  }
  // server: a rack label over a hazard stripe
  {
    const P = spr_paint(12, 8);
    P.r('#14181a', 0, 0, 12, 8);
    for (let i = -8; i < 12; i += 4) for (let k = 0; k < 2; k++) P.ln('#d8b020', i + k, 7, i + k + 2, 5);
    P.r('#14181a', 0, 4, 12, 1);
    P.r('#2a3438', 1, 1, 10, 3); P.r('#3ae8ff', 2, 2, 3, 1); P.r('#8af4ff', 6, 2, 1, 1); P.r('#3ae8ff', 8, 2, 2, 1);
    out.server = spr_anchor(P.c, 6, 7);
  }
  // subway: a station sign, line roundel and a white name band
  {
    const P = spr_paint(12, 8);
    P.r('#0e1a1c', 0, 0, 12, 8); P.r('#1e3034', 0, 0, 12, 1);
    P.disc(2.5, 4, 2, 2, ['#c89a1a', '#ffd23a']); P.r('#0e1a1c', 2, 4, 1, 1);
    P.r('#c8ccc0', 5, 2, 6, 1); P.r('#c8ccc0', 5, 4, 2, 1); P.r('#c8ccc0', 8, 4, 3, 1); P.r('#8a8e84', 5, 6, 5, 1);
    out.subway = spr_anchor(P.c, 6, 7);
  }
  // grid: a neon kanji-ish sign in magenta
  {
    const P = spr_paint(12, 8);
    P.r('#0a040e', 0, 0, 12, 8); P.r('#2a0a2a', 0, 0, 12, 1); P.r('#2a0a2a', 0, 7, 12, 1);
    const halo = '#5a1456', neon = '#ff3ad8', core = '#ffc8f4';
    const strokes = [[1, 2, 4, 1], [2, 1, 1, 6], [1, 5, 4, 1], [6, 1, 1, 6], [6, 1, 4, 1], [9, 1, 1, 3], [7, 4, 3, 1], [8, 5, 1, 2]];
    for (const [x, y, w, h] of strokes) P.r(halo, x - 0, y, w + 1, h + 1);
    for (const [x, y, w, h] of strokes) P.r(neon, x, y, w, h);
    P.r(core, 2, 2, 1, 1); P.r(core, 6, 1, 1, 1);
    out.grid = spr_anchor(P.c, 6, 7);
  }
  // core: a glowing glyph panel
  {
    const P = spr_paint(12, 8);
    P.r('#0c1e14', 0, 0, 12, 8); P.r('#2e5a40', 0, 0, 12, 1); P.r('#06100a', 0, 7, 12, 1);
    P.r('#1e4a2e', 1, 1, 10, 6);
    for (let k = 0; k < 3; k++) P.tpl(spr_GLYPHS[(k * 5 + 3) % 16], { '#': k === 1 ? '#ffffff' : '#8cffb0' }, 1 + k * 4 - (k === 2 ? 1 : 0), 1);
    out.core = spr_anchor(P.c, 6, 7);
  }
  return out;
}

function spr_bulb() {
  const P = spr_paint(6, 6);
  P.r('#14120e', 2, 0, 2, 1); P.r('#3a352c', 2, 1, 2, 1);
  P.r('#ffd890', 1, 2, 4, 3); P.r('#fff4d0', 2, 2, 2, 3); P.r('#ffffff', 2, 3, 1, 1); P.r('#ffd890', 2, 5, 2, 1);
  P.r('#c89a50', 1, 4, 1, 1); P.r('#c89a50', 4, 4, 1, 1);
  return spr_anchor(P.c, 3, 5);
}

// ---------------------------------------------------------------------------
// Item icons (greys, so the engine can tint them) and the patch orb
// ---------------------------------------------------------------------------
function spr_icons() {
  const W = '#ffffff', L = '#c8c8c8', M = '#8c8c8c', D = '#4a4a4a', K = '#1e1e1e';
  const exploit = (() => {
    const P = spr_paint(12, 12);
    P.r(M, 1, 1, 10, 10); P.r(L, 1, 1, 10, 1); P.r(L, 1, 1, 1, 10); P.r(D, 10, 2, 1, 9); P.r(D, 2, 10, 9, 1);
    P.r(L, 3, 1, 6, 3); P.r(W, 3, 1, 5, 1); P.r(D, 6, 2, 1, 2);
    // label with a skull
    P.r(W, 3, 5, 6, 5);
    P.r(K, 4, 6, 4, 2); P.r(W, 5, 7, 1, 1); P.r(W, 7, 7, 0, 0); P.r(K, 5, 8, 2, 1); P.r(W, 4, 6, 1, 1); P.r(W, 7, 6, 1, 1);
    P.r(W, 5, 6, 0, 0); P.r(K, 4, 9, 1, 1); P.r(K, 7, 9, 1, 1);
    return P.c;
  })();
  const coat = (() => {
    const P = spr_paint(12, 12);
    P.tpl([
      '...WLKKLW...',
      '.LLMWKKWMDD.',
      'LLMMLWKWMMDD',
      'LMMMMLKLMMMD',
      'LMMMMMKMMMMD',
      'LMKKKKKKKKMD',
      'LMMMMMKMMMMD',
      'WL.MMMKMMM.D',
      '..LMMMKMMMD.',
      '..LMMMKMMMD.',
      '.LMMMMKMMMMD',
      '.LMMMMKMMMMD',
    ], { W, L, M, D, K: D });
    return P.c;
  })();
  const shades = (() => {
    const P = spr_paint(12, 12);
    P.r(L, 0, 4, 12, 1);
    P.r(M, 0, 5, 5, 3); P.r(M, 7, 5, 5, 3); P.r(M, 1, 8, 3, 1); P.r(M, 8, 8, 3, 1);
    P.r(W, 1, 5, 2, 1); P.r(W, 8, 5, 2, 1); P.r(L, 1, 6, 1, 1); P.r(L, 8, 6, 1, 1);
    P.r(D, 4, 7, 1, 1); P.r(D, 11, 7, 1, 1); P.r(L, 5, 5, 2, 1);
    P.r(D, 0, 3, 1, 1); P.r(D, 11, 3, 1, 1);
    return P.c;
  })();
  const implant = (() => {
    const P = spr_paint(12, 12);
    for (let k = 0; k < 4; k++) { P.r(L, 3 + k * 2, 0, 1, 2); P.r(L, 3 + k * 2, 10, 1, 2); P.r(L, 0, 3 + k * 2, 2, 1); P.r(L, 10, 3 + k * 2, 2, 1); }
    P.r(D, 2, 2, 8, 8); P.r(M, 2, 2, 8, 1); P.r(M, 2, 2, 1, 8); P.r(K, 9, 3, 1, 7); P.r(K, 3, 9, 7, 1);
    P.r(M, 4, 4, 4, 4); P.r(W, 4, 4, 3, 1); P.r(W, 4, 4, 1, 3); P.r(L, 5, 5, 2, 2);
    P.r(W, 3, 3, 1, 1);
    return P.c;
  })();
  for (const c of [exploit, coat, shades, implant]) spr_anchor(c, 6, 11);
  return { exploit, coat, shades, implant };
}

function spr_orb() {
  const mk = (big) => {
    const P = spr_paint(7, 7);
    if (big) P.disc(3.5, 3.5, 3.5, 3.5, ['#0a6a2a', '#1fc04a', '#3cff6e', '#8cffb0', '#e0ffe8']);
    else P.disc(3.5, 3.5, 2.7, 2.7, ['#0a6a2a', '#1fa040', '#3cff6e', '#8cffb0']);
    P.r(big ? '#ffffff' : '#e0ffe8', 3, 2, 1, 3); P.r(big ? '#ffffff' : '#e0ffe8', 2, 3, 3, 1);
    return spr_prop(P.c, '#03140a');
  };
  return { orb: [mk(false), mk(true)] };
}

// ---------------------------------------------------------------------------
// Glyphs: the player's projectiles (4x5, white, tinted by the engine)
// ---------------------------------------------------------------------------
const spr_GLYPHS = [
  ['.##.', '#..#', '#..#', '#..#', '.##.'], // 0
  ['.#..', '##..', '.#..', '.#..', '###.'], // 1
  ['####', '...#', '.##.', '.#..', '#...'], // a
  ['...#', '..#.', '.##.', '#.#.', '..#.'], // i
  ['..#.', '####', '#..#', '..#.', '.#..'], // u
  ['..#.', '####', '.##.', '#.#.', '..#.'], // o
  ['.#..', '####', '.#.#', '#..#', '#.#.'], // ka
  ['.#..', '####', '.#..', '####', '.#..'], // ki
  ['.#..', '.###', '#..#', '..#.', '.#..'], // ku
  ['####', '...#', '...#', '...#', '####'], // ko
  ['#..#', '####', '#..#', '...#', '..#.'], // sa
  ['#...', '..#.', '#..#', '..#.', '##..'], // shi
  ['####', '#...', '###.', '#...', '#...'], // F
  ['####', '...#', '..#.', '.#..', '.#..'], // 7
  ['###.', '....', '.##.', '....', '####'], // mi
  ['####', '..#.', '#.#.', '.#..', '#.##'], // nu
];
const spr_glyphCache = [];
function glyphSprite(i) {
  i = ((i | 0) % 16 + 16) % 16;
  if (!spr_glyphCache[i]) spr_glyphCache[i] = spriteFrom(spr_GLYPHS[i], { '#': '#ffffff' });
  return spr_glyphCache[i];
}

// ---------------------------------------------------------------------------
// Sector tiles (16x16), built on first use and memoised
// ---------------------------------------------------------------------------
const spr_tileCache = {};
const spr_SECTORS = ['tenement', 'server', 'subway', 'grid', 'core', 'apartment'];

function spr_floorTile(sector, pal, v, rnd) {
  const P = spr_paint(16, 16);
  P.r(pal.floor, 0, 0, 16, 16);
  const dark = shade(pal.floor, -0.3), lite = shade(pal.floor, 0.035);
  const speck = (n, col) => { for (let k = 0; k < n; k++) P.r(col, Math.floor(rnd() * 16), Math.floor(rnd() * 16)); };
  if (sector === 'tenement') {
    // worn linoleum squares
    P.r(pal.floor2, 0, 0, 8, 8); P.r(pal.floor2, 8, 8, 8, 8);
    P.r(pal.line, 0, 15, 16, 1); P.r(pal.line, 15, 0, 1, 16);
    speck(14, dark); speck(6, lite);
    if (v === 2) { let x = 2, y = 3; for (let k = 0; k < 12; k++) { P.r(dark, x, y); P.r(pal.line, x, y + 1); x += 1; y += rnd() < 0.5 ? 1 : 0; } }
    if (v === 3) { P.disc(9, 9, 4, 3, [mix(pal.floor, '#2a2a10', 0.35), mix(pal.floor, '#2a2a10', 0.25)]); }
  } else if (sector === 'server') {
    // floor plates with rivets
    P.r(lite, 0, 0, 16, 1); P.r(lite, 0, 0, 1, 16); P.r(pal.line, 0, 15, 16, 1); P.r(pal.line, 15, 0, 1, 16);
    for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) { P.r(shade(pal.floor, 0.1), x, y); P.r(dark, x + 1, y + 1); }
    speck(5, pal.floor2);
    if (v === 2) { for (let j = 5; j < 11; j += 2) P.r(pal.line, 4, j, 8, 1); P.r(shade(pal.floor, 0.06), 4, 4, 8, 1); }
    if (v === 3) { P.r(pal.floor2, 0, 7, 16, 3); P.r(pal.line, 0, 10, 16, 1); P.r(mix(pal.floor, pal.accent, 0.35), 11, 8, 1, 1); }
  } else if (sector === 'subway') {
    // small dirty tiles
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (rnd() < 0.4) P.r(pal.floor2, i * 4, j * 4, 4, 4);
    const grout = mix(pal.floor, pal.line, 0.55);
    for (let k = 0; k < 16; k += 4) { P.r(grout, k + 3, 0, 1, 16); P.r(grout, 0, k + 3, 16, 1); }
    speck(10, dark);
    if (v === 2) { P.ln(pal.line, 5, 4, 9, 9); P.ln(pal.line, 9, 9, 12, 10); }
    if (v === 3) { P.disc(6, 10, 3, 2, [mix(pal.floor, '#000000', 0.35)]); P.r(mix(pal.floor, '#3a3a3a', 0.3), 12, 4, 1, 1); }
  } else if (sector === 'grid') {
    const ln = mix(pal.floor, pal.accent, 0.13), hot = mix(pal.floor, pal.accent, 0.32), cy = mix(pal.floor, '#3ae8ff', 0.1);
    P.r(ln, 0, 0, 16, 1); P.r(ln, 0, 0, 1, 16); P.r(hot, 0, 0, 1, 1);
    speck(3, pal.floor2);
    if (v === 2) { P.r(cy, 8, 1, 1, 15); P.r(cy, 1, 8, 15, 1); }
    if (v === 3) { P.r(mix(pal.floor, '#3ae8ff', 0.3), 5, 6, 4, 1); P.r(mix(pal.floor, pal.accent, 0.3), 7, 7, 4, 1); }
  } else if (sector === 'core') {
    const c1 = mix(pal.floor, '#3cff6e', 0.1), c2 = mix(pal.floor, '#3cff6e', 0.2);
    for (let k = 0; k < 3; k++) {
      const x = 1 + Math.floor(rnd() * 14), y0 = Math.floor(rnd() * 10), n = 2 + Math.floor(rnd() * 5);
      for (let j = 0; j < n; j++) if (rnd() < 0.7) P.r(j === n - 1 && v === 3 ? c2 : c1, x, y0 + j);
    }
    P.r(pal.line, 0, 15, 16, 1); P.r(pal.line, 15, 0, 1, 16);
    if (v === 2) { P.r(c2, 4, 4, 1, 1); P.r(c1, 9, 11, 2, 1); }
  } else {
    // apartment floorboards
    for (let b = 0; b < 4; b++) {
      const y = b * 4, base = rnd() < 0.5 ? pal.floor : pal.floor2;
      const seam = mix(pal.floor, pal.line, 0.6);
      P.r(base, 0, y, 16, 3); P.r(seam, 0, y + 3, 16, 1);
      const jx = Math.floor(rnd() * 14) + 1; P.r(seam, jx, y, 1, 3);
      for (let k = 0; k < 2; k++) P.r(shade(base, rnd() < 0.5 ? -0.12 : 0.04), Math.floor(rnd() * 14), y + Math.floor(rnd() * 3), 2, 1);
    }
    if (v === 2) { P.r(shade(pal.floor, -0.35), 6, 5, 2, 1); P.r(shade(pal.floor, 0.06), 6, 4, 1, 1); }
    if (v === 3) { P.r(shade(pal.floor, 0.05), 3, 9, 7, 1); P.r(shade(pal.floor, 0.05), 9, 10, 4, 1); }
  }
  return P.c;
}

function spr_wallFace(sector, pal, v, rnd) {
  const P = spr_paint(16, 16);
  const face = pal.wallFace, dk = shade(face, -0.25), dk2 = shade(face, -0.55), lt = shade(face, 0.08);
  P.r(face, 0, 0, 16, 16);
  if (sector === 'tenement') {
    for (let k = 0; k < 18; k++) P.r(rnd() < 0.5 ? dk : lt, Math.floor(rnd() * 16), 1 + Math.floor(rnd() * 11));
    // peeling paint patches
    const px = Math.floor(rnd() * 10) + 2;
    P.r(dk, px, 4, 3, 2); P.r(lt, px - 1, 3, 4, 1);
    if (v === 1) { P.r('#4a3628', 4, 3, 6, 5); P.r('#3a2a20', 4, 5, 6, 1); P.r('#3a2a20', 7, 3, 1, 2); P.r('#3a2a20', 6, 6, 1, 2); P.r(lt, 3, 2, 8, 1); P.r(dk, 11, 6, 1, 6); }
    P.r(pal.wallEdge, 0, 0, 16, 1);
    P.r(dk2, 0, 12, 16, 4); P.r(shade(face, -0.15), 0, 12, 16, 1); P.r(shade(face, -0.7), 0, 15, 16, 1);
  } else if (sector === 'server') {
    for (let r = 0; r < 2; r++) {
      const x0 = r * 8;
      P.r(dk, x0, 0, 8, 13); P.r(lt, x0, 0, 1, 13); P.r(dk2, x0 + 7, 0, 1, 13);
      for (let j = 2; j < 12; j += 3) {
        P.r(shade(face, -0.45), x0 + 2, j, 4, 1); P.r(face, x0 + 2, j + 1, 4, 1);
        const on = rnd() < 0.6 + v * 0.2;
        P.r(on ? pal.accent : '#1a4a2a', x0 + 6, j, 1, 1);
        if (rnd() < 0.4) P.r('#3cff6e', x0 + 1, j + 1, 1, 1);
      }
    }
    if (v === 1) { P.r('#0a0c0e', 10, 0, 1, 12); P.r('#0a0c0e', 11, 4, 1, 9); P.r('#12161a', 12, 7, 1, 6); }
    P.r(pal.wallEdge, 0, 0, 16, 1);
    P.r(dk2, 0, 13, 16, 3); P.r(shade(face, -0.7), 0, 15, 16, 1);
  } else if (sector === 'subway') {
    for (let j = 0; j < 12; j += 4) for (let i = 0; i < 16; i += 4) {
      P.r(rnd() < 0.3 ? shade(face, -0.06) : face, i, j, 4, 4);
      P.r(lt, i, j, 3, 1);
      P.r(dk, i + 3, j, 1, 4); P.r(dk, i, j + 3, 4, 1);
    }
    // the accent stripe
    P.r(mix(pal.accent, face, 0.45), 0, 8, 16, 2); P.r(mix(pal.accent, face, 0.2), 0, 8, 16, 1);
    if (v === 1) { P.r(dk2, 5, 1, 3, 2); P.r(dk, 4, 4, 1, 3); P.ln(dk, 9, 1, 11, 6); P.r(shade(face, -0.4), 12, 10, 2, 2); }
    P.r(pal.wallEdge, 0, 0, 16, 1);
    P.r(dk2, 0, 12, 16, 4); P.r(shade(face, -0.35), 0, 12, 16, 1); P.r(shade(face, -0.75), 0, 15, 16, 1);
  } else if (sector === 'grid') {
    P.r(mix(face, '#3ae8ff', 0.15), 0, 1, 1, 11); P.r(mix(face, '#3ae8ff', 0.12), 8, 1, 1, 11);
    // a neon line with its halo
    const brk = v === 1 ? 6 : -1;
    for (let i = 0; i < 16; i++) {
      if (i >= brk && i < brk + 3) continue;
      P.r(mix(face, pal.accent, 0.35), i, 4, 1, 1); P.r(pal.accent, i, 5, 1, 1); P.r(mix(face, pal.accent, 0.35), i, 6, 1, 1);
    }
    if (v === 1) { P.r('#ffc8f4', 9, 5, 1, 1); P.r(mix(face, '#3ae8ff', 0.6), 12, 9, 2, 1); }
    P.r(mix(face, pal.accent, 0.5), 0, 0, 16, 1);
    P.r(dk2, 0, 12, 16, 4); P.r(mix(dk2, pal.accent, 0.25), 0, 12, 16, 1); P.r(shade(face, -0.75), 0, 15, 16, 1);
  } else if (sector === 'core') {
    P.r(lt, 0, 1, 16, 1);
    P.r(dk, 7, 1, 1, 11); P.r(lt, 8, 1, 1, 11);
    const g1 = mix(face, '#8cffb0', 0.35), g2 = mix(face, '#d8ffe4', 0.6);
    for (let k = 0; k < 3 + v * 2; k++) {
      const x = Math.floor(rnd() * 16), y0 = 2 + Math.floor(rnd() * 5), n = 2 + Math.floor(rnd() * 4);
      if (x === 7 || x === 8) continue;
      for (let j = 0; j < n; j++) P.r(j === n - 1 ? g2 : g1, x, y0 + j);
    }
    P.r(pal.wallEdge, 0, 0, 16, 1);
    P.r(dk2, 0, 12, 16, 4); P.r(mix(dk2, '#3cff6e', 0.25), 0, 12, 16, 1); P.r(shade(face, -0.75), 0, 15, 16, 1);
  } else {
    // dingy wallpaper, a baseboard
    for (let i = 1; i < 16; i += 4) P.r(shade(face, -0.08), i, 1, 1, 11);
    for (let k = 0; k < 10; k++) P.r(rnd() < 0.5 ? dk : lt, Math.floor(rnd() * 16), 1 + Math.floor(rnd() * 11));
    if (v === 1) { P.r(shade(face, -0.12), 9, 2, 4, 9); P.r(shade(face, -0.18), 10, 8, 2, 3); P.r('#c8c4b4', 3, 8, 3, 3); P.r('#6a665a', 4, 9, 1, 1); P.r('#9a968a', 3, 10, 3, 1); }
    P.r(pal.wallEdge, 0, 0, 16, 1);
    P.r('#1a120c', 0, 12, 16, 4); P.r('#2e2216', 0, 12, 16, 1); P.r('#0e0a06', 0, 15, 16, 1);
  }
  return P.c;
}

function spr_wallTop(sector, pal, rnd) {
  const P = spr_paint(16, 16);
  const t = pal.wallTop;
  P.r(t, 0, 0, 16, 16);
  for (let k = 0; k < 14; k++) P.r(rnd() < 0.5 ? shade(t, -0.12) : shade(t, 0.05), Math.floor(rnd() * 16), Math.floor(rnd() * 16));
  P.r(shade(t, 0.03), 0, 0, 16, 1); P.r(shade(t, 0.03), 0, 0, 1, 16);
  P.r(shade(t, -0.1), 0, 15, 16, 1); P.r(shade(t, -0.1), 15, 0, 1, 16);
  if (sector === 'grid') { P.r(mix(t, pal.accent, 0.12), 0, 0, 16, 1); P.r(mix(t, '#3ae8ff', 0.08), 0, 0, 1, 16); }
  if (sector === 'core') { P.r(mix(t, '#8cffb0', 0.1), 0, 0, 16, 1); }
  if (sector === 'server') { P.r(shade(t, -0.15), 4, 7, 8, 2); P.r(shade(t, 0.04), 4, 7, 8, 1); }
  return P.c;
}

function spr_pitTile(pal, rnd) {
  const P = spr_paint(16, 16);
  P.r(pal.pit, 0, 0, 16, 16);
  P.r(shade(pal.floor, -0.55), 0, 0, 16, 1); P.r(shade(pal.floor, -0.75), 0, 1, 16, 1);
  const cols = [1, 5, 8, 12, 14];
  for (const x of cols) {
    const len = 4 + Math.floor(rnd() * 7), y0 = 3 + Math.floor(rnd() * (13 - len));
    for (let j = 0; j < len; j++) {
      if (rnd() < 0.25) continue;
      const t = j / len;
      P.r(j === len - 1 ? '#1f8a42' : t > 0.6 ? '#0f4a22' : '#082a14', x, y0 + j);
    }
  }
  return P.c;
}

function spr_doorSealed(pal, f) {
  const P = spr_paint(16, 16);
  const fire = '#ff7a3a';
  P.r('#140602', 0, 0, 16, 16);
  const mortar = mix(fire, '#000000', 0.62);
  for (let row = -1; row < 5; row++) {
    const y = row * 4 + (f ? 2 : 0);
    P.r(mortar, 0, y + 3, 16, 1);
    const off = (row & 1) ? 4 : 0;
    for (let bx = -4; bx < 16; bx += 8) {
      const x = bx + off;
      P.r(mortar, x + 7, y, 1, 3);
      // a glyph-ish pattern in each brick
      const h = hashInts(row + 10, bx + 10, 77);
      for (let k = 0; k < 6; k++) {
        if (!((h >> k) & 1)) continue;
        const gx = x + 1 + (k % 3) * 2, gy = y + (k < 3 ? 0 : 1) + ((h >> (k + 8)) & 1);
        if (gx < 0 || gx > 15 || gy < 0 || gy > 15) continue;
        P.r(((h >> (k + 12)) & 3) === 0 ? '#ffe0b0' : (f ? fire : '#d85a20'), gx, gy, 1, 1);
      }
    }
  }
  // a hot edge top and bottom
  P.r(fire, 0, 0, 16, 1); P.r(mix(fire, '#ffe0b0', 0.5), 0, 15, 16, 1);
  return P.c;
}

function spr_doorOpen(pal) {
  const P = spr_paint(16, 16);
  P.r(mix(pal.floor, '#000000', 0.45), 0, 0, 16, 16);
  P.r(mix(pal.floor, '#000000', 0.7), 0, 0, 1, 16); P.r(mix(pal.floor, '#000000', 0.7), 15, 0, 1, 16);
  P.r(shade(pal.floor, 0.06), 1, 0, 14, 1); P.r(pal.line, 1, 1, 14, 1);
  P.r(shade(pal.floor, 0.06), 1, 14, 14, 1); P.r(pal.line, 1, 15, 14, 1);
  return P.c;
}

function sectorTiles(sector) {
  if (spr_tileCache[sector]) return spr_tileCache[sector];
  const pal = SECTOR_PAL[sector] || SECTOR_PAL.tenement;
  const si = Math.max(0, spr_SECTORS.indexOf(sector));
  const R = (k) => mulberry32(hashInts(si + 1, k, 4012));
  const tiles = {
    floor: [0, 1, 2, 3].map((v) => spr_floorTile(sector, pal, v, R(v + 1))),
    wallTop: spr_wallTop(sector, pal, R(20)),
    wallFace: [0, 1].map((v) => spr_wallFace(sector, pal, v, R(30 + v))),
    pit: spr_pitTile(pal, R(40)),
    doorSealed: [spr_doorSealed(pal, 0), spr_doorSealed(pal, 1)],
    doorOpen: spr_doorOpen(pal),
  };
  spr_tileCache[sector] = tiles;
  return tiles;
}

// ---------------------------------------------------------------------------
// Build everything
// ---------------------------------------------------------------------------
// The Harvester: a machine as wide as a room, broken out of the north wall.
// The body is drawn once; its eyes, vents and scanner are drawn live over it
// (render.js), since they open, shut and glow. Also the same body as a dark
// wreck, and the cracks that spread through the wall before it breaks out,
// in the order they appear.
function spr_harvester() {
  const W = 192, H = 60;
  const m = ['#06080e', '#10141e', '#1c2234', '#2c3450', '#46507a', '#7684b4'];
  const rock = ['#161c20', '#2e373c', '#4b5960'];
  const P = spr_paint(W, H);
  const top = (x) => 2 + (hashInts(x >> 2, 77) % 4); // a ragged edge in 4 px steps
  const x0 = 10, x1 = 181;
  for (let x = x0; x <= x1; x++) {
    const t = top(x) + (x < x0 + 4 || x > x1 - 4 ? 3 : 0);
    P.r(m[1], x, t + 2, 1, 46 - t);
    P.r(rock[2], x, t, 1, 1); P.r(rock[1], x, t + 1, 1, 1);
  }
  // ragged sides where it tore through the side walls
  for (let y = 4; y < 48; y++) { const j = hashInts(y >> 2, 91) % 3; P.r(rock[1], x0 - j, y, j + 1, 1); P.r(rock[1], x1, y, j + 1, 1); P.r(rock[2], x0 - j, y, 1, 1); P.r(rock[2], x1 + j, y, 1, 1); }
  // the brow: a heavy plate with rivets, and the scanner's slot
  P.r(m[3], 14, 9, W - 28, 9); P.r(m[4], 14, 9, W - 28, 1); P.r(m[0], 14, 17, W - 28, 1);
  for (let x = 20; x < W - 18; x += 12) { P.r(m[5], x, 11, 1, 1); P.r(m[1], x, 12, 1, 1); }
  P.r(m[0], 70, 12, 52, 3); P.r('#3a0612', 71, 13, 50, 1);
  // ribbed panels down to the jaw
  for (let x = 14; x < W - 14; x += 6) {
    P.r(m[2], x, 19, 5, 21);
    P.r(m[3], x, 19, 1, 21);
    P.r(m[0], x + 5, 19, 1, 21);
    if ((x / 6) % 3 === 1) P.r('#3a0612', x + 2, 22, 1, 2);
  }
  // cables hanging from under the brow
  for (const cx of [30, 62, 128, 162]) for (let y = 18; y < 40; y++) P.r(m[0], cx + Math.round(Math.sin(y * 0.35 + cx) * 1.5), y, 2, 1);
  // the jaw: a lip with a grille
  P.r(m[3], 12, 40, W - 24, 8); P.r(m[4], 12, 40, W - 24, 1); P.r(m[0], 12, 47, W - 24, 1);
  for (let x = 14; x < W - 14; x += 4) P.r(m[1], x, 42, 1, 4);
  // the two vents the bugs come out of
  for (const vx of [74, 118]) { P.r(m[0], vx - 6, 41, 13, 6); for (let x = vx - 5; x <= vx + 5; x += 2) P.r(m[3], x, 42, 1, 4); }
  // the eye housings, hanging below the wall line, each with its dark socket
  for (const ex of [52, 96, 140]) {
    P.disc(ex, 48, 12, 10, [m[1], m[2], m[3], m[4], m[5]]);
    P.disc(ex, 48.5, 8.5, 7, [m[0], m[0], m[1]]);
    P.r(m[0], ex - 12, 48, 1, 1); P.r(m[0], ex + 12, 48, 1, 1);
  }
  const body = P.c;
  const [wreck, wx] = makeCanvas(W, H);
  wx.drawImage(body, 0, 0);
  wx.globalCompositeOperation = 'source-atop';
  wx.fillStyle = 'rgba(0,0,0,0.55)'; wx.fillRect(0, 0, W, H);
  wx.globalCompositeOperation = 'source-over';
  for (const ex of [52, 96, 140]) { wx.fillStyle = '#000'; wx.fillRect(ex - 7, 43, 15, 11); wx.fillRect(ex - 5, 41, 11, 15); }
  // cracks: random walks up from where the eyes will break through
  const rnd = mulberry32(0x4a7e), walks = [];
  for (const sx of [52, 96, 140, 30, 74, 118, 162]) walks.push({ x: sx, y: 46, list: [] });
  for (let step = 0; step < 34; step++)
    for (const w of walks) {
      w.y -= rnd() < 0.6 ? 1 : 0; w.x += rnd() < 0.5 ? -1 : 1;
      if (w.y > 3 && w.x > 12 && w.x < W - 12) w.list.push([w.x, w.y]);
    }
  const cracks = [];
  for (let i = 0; i < 34; i++) for (const w of walks) if (w.list[i]) cracks.push(w.list[i]);
  return { body, wreck, cracks };
}

function buildSprites() {
  const rabbit = spr_rabbit();
  Object.assign(SPR, {
    neo: spr_neo(),
    enemies: {
      bug: spr_bug(),
      watchdog: spr_watchdog(),
      firewall: spr_firewall(),
      sentinel: spr_sentinel(),
      worm: spr_worm(),
      exile: spr_exile(),
      agent: spr_agentSet(false),
    },
    boss: spr_agentSet(true),
    harvester: spr_harvester(),
    rabbit: rabbit.frames,
    rabbitTail: rabbit.tail,
    cat: spr_cat(),
    props: {
      desk: spr_desk(),
      deskScreen: spr_deskScreen(),
      bed: spr_bed(),
      door: { closed: spr_door(false), open: spr_door(true) },
      clock: spr_clock(),
      lamp: spr_lamp(),
      poster: spr_poster(),
      cache: { closed: spr_cache(false), open: spr_cache(true) },
      phone: { idle: spr_phone(false, 0), ring: [spr_phone(true, 0), spr_phone(true, 1)] },
      oracle: spr_oracle(),
      backdoor: spr_backdoor(),
      mirror: spr_mirror(),
      window: spr_window(),
      sign: spr_signs(),
      corridorBulb: spr_bulb(),
    },
    icons: spr_icons(),
    pickup: spr_orb(),
  });
  return SPR;
}
