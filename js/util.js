'use strict';
// ---------------------------------------------------------------------------
// Small helpers shared by every file: the DOM shortcut, error capture, seeded
// random numbers, maths, colours and offscreen canvases. Every file is a
// classic script sharing one global scope; this one loads first.
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);

// Errors that escape (a script that fails as it loads, a promise nobody
// caught), counted from the first script on so the tests can see them.
const ScriptErrors = [];
window.addEventListener('error', (ev) => { ScriptErrors.push({ msg: String(ev.message || ev.error || ev), at: Date.now() }); });
window.addEventListener('unhandledrejection', (ev) => { ScriptErrors.push({ msg: 'unhandled: ' + String(ev.reason && ev.reason.message || ev.reason), at: Date.now() }); });

const TILE = 16;
// The world buffer is always this many pixels wide: one room's width.
const VIEW_W = 192;

// ---------------------------------------------------------------------------
// Seeded randomness. Anything generated from a run's seed (floors, rooms,
// loot, combat rolls) draws from an Rng, never Math.random, so a seed always
// rebuilds the same floor and the tests can pin it.
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Mixes any number of integers into one 32-bit seed.
function hashInts(...xs) {
  let h = 0x811c9dc5 | 0;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  }
  return h >>> 0;
}
function hashString(s) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

class Rng {
  constructor(seed) { this.seed = seed >>> 0; this.next = mulberry32(this.seed); }
  f(a = 1, b) { return b === undefined ? this.next() * a : a + this.next() * (b - a); }
  i(a, b) { return Math.floor(a + this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  // weighted pick from [[weight, value], ...]
  weighted(list) {
    let total = 0;
    for (const [w] of list) total += Math.max(0, w);
    let r = this.next() * total;
    for (const [w, v] of list) { r -= Math.max(0, w); if (r < 0) return v; }
    return list[list.length - 1][1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }
  // a fresh 32-bit seed for a child generator
  fork() { return Math.floor(this.next() * 4294967296) >>> 0; }
}

// For cosmetic randomness that never touches game state (rain, sparks).
const FX_R = {
  f: (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
  i: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
};

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const pct = (x) => Math.round(x * 100) + '%';
const sign = (x) => (x > 0 ? '+' : x < 0 ? '−' : '');

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
function hexToRgb(h) {
  h = h.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}
function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  if (amt < 0) return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
  return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
}
function mix(h1, h2, t) {
  const a = hexToRgb(h1), b = hexToRgb(h2);
  return rgbToHex(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w); c.height = Math.max(1, h);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return [c, x];
}

// Renders a list of strings into a canvas using a palette map. '.' and ' '
// are transparent.
function spriteFrom(rows, pal) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const [c, x] = makeCanvas(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i];
      if (ch === '.' || ch === ' ' || !pal[ch]) continue;
      x.fillStyle = pal[ch];
      x.fillRect(i, j, 1, 1);
    }
  return c;
}

// A 1px outline round every opaque pixel, in one ink colour. The canvas grows
// by a pixel each side so the outline is never clipped.
function outlined(src, ink = '#000000') {
  const w = src.width + 2, h = src.height + 2;
  const [c, x] = makeCanvas(w, h);
  x.drawImage(src, 1, 1);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  const solid = (i, j) => i >= 0 && j >= 0 && i < w && j < h && d[(j * w + i) * 4 + 3] > 100;
  const mark = [];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (!solid(i, j) && (solid(i - 1, j) || solid(i + 1, j) || solid(i, j - 1) || solid(i, j + 1))) mark.push(j * w + i);
  const [r, g, b] = hexToRgb(ink);
  for (const k of mark) { d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255; }
  x.putImageData(img, 0, 0);
  return c;
}

// A copy of a sprite with every opaque pixel one colour (hit flashes,
// silhouettes, elite rims).
function tinted(src, col) {
  const [c, x] = makeCanvas(src.width, src.height);
  x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = col;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

function flipped(src) {
  const [c, x] = makeCanvas(src.width, src.height);
  x.translate(src.width, 0); x.scale(-1, 1);
  x.drawImage(src, 0, 0);
  return c;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Haptics where the browser has them (not iOS Safari); quiet everywhere else.
function buzz(ms) {
  try { if (typeof Save !== 'undefined' && Save.data.settings.haptics && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ }
}

// Today's date as YYYY-MM-DD in the player's own calendar.
function todayKey(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
