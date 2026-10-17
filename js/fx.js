'use strict';
// ---------------------------------------------------------------------------
// Cosmetic effects: the 0s and 1s a hit knocks loose, rings, a terminated
// process dissolving into falling code, shield hex, floating numbers and the
// screen flash. None of it touches game state, so it may use Math.random.
// ---------------------------------------------------------------------------

const MAX_FLOATS = 12;

function spawnBits(x, y, color, n = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 40;
    Game.fx.push({ kind: 'bit', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, t: 0.35 + Math.random() * 0.2, color, ch: Math.random() < 0.5 ? '0' : '1' });
  }
}

function spawnRing(x, y, color, r = 18) {
  Game.fx.push({ kind: 'ring', x, y, r, t: 0.35, total: 0.35, color });
}

function spawnHex(x, y) {
  const H = '0123456789ABCDEF';
  for (let i = 0; i < 8; i++) Game.fx.push({ kind: 'bit', x: x + (Math.random() - 0.5) * 10, y: y + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 20, vy: 10 + Math.random() * 30, t: 0.7, color: '#4aa8ff', ch: H[(Math.random() * 16) | 0] });
}

// A terminated process falls apart into columns of green code.
function spawnDissolve(e, big = false) {
  const n = big ? 22 : 6 + Math.round(e.h / 2);
  for (let i = 0; i < n; i++) {
    Game.fx.push({ kind: 'code', x: e.x + (Math.random() - 0.5) * (e.r * 2 + 6), y: e.y - Math.random() * e.h, vy: 25 + Math.random() * 40, t: 0.5 + Math.random() * (big ? 0.9 : 0.3), total: 0.8, color: big ? '#ffffff' : '#3cff6e', ch: Math.random() < 0.5 ? '0' : '1' });
  }
  spawnBits(e.x, e.y - e.h / 2, '#8cffb0', 4);
}

function addFloat(x, y, text, color, big = false) {
  if (!Save.settings.damageNumbers && /^[-+]?\d/.test(text)) return;
  Game.floats.push({ x, y, text, color, t: big ? 1.1 : 0.7, total: big ? 1.1 : 0.7, big });
  if (Game.floats.length > MAX_FLOATS) Game.floats.shift();
}

// Damage numbers on the same process within 0.3 s add up into one.
function addDamageNumber(e, d, crit) {
  if (!Save.settings.damageNumbers) return;
  const now = Game.realT;
  const f = e.lastNum;
  if (f && !crit && !f.crit && now - f.at < 0.3 && Game.floats.includes(f)) {
    f.n += d; f.text = String(Math.round(f.n)); f.t = f.total; f.at = now; f.x = e.x; f.y = e.y - e.h - 4;
    return;
  }
  const n = { x: e.x + (Math.random() - 0.5) * 4, y: e.y - e.h - 4, text: Math.round(d) + (crit ? '!' : ''), color: crit ? '#ffe14a' : '#e8ffe8', t: 0.7, total: 0.7, n: d, at: now, crit };
  Game.floats.push(n);
  if (Game.floats.length > MAX_FLOATS) Game.floats.shift();
  e.lastNum = n;
}

// A full-screen flash, never more than three times a second (photosensitive
// safety), and never with reduced flashing on.
function flashScreen(color, strength = 0.3) {
  if (Save.settings.reducedFlash) return;
  if (Game.realT - Game.lastFlashAt < 0.34) return;
  Game.lastFlashAt = Game.realT;
  Game.flash = { color, a: strength, t: 0.12 };
}

function updateFx(dtReal, dt) {
  for (const f of Game.fx) {
    f.t -= f.kind === 'code' ? dt : dtReal;
    if (f.kind === 'bit') { f.x += f.vx * dtReal; f.y += f.vy * dtReal; f.vy += 60 * dtReal; }
    if (f.kind === 'code') f.y += f.vy * dt;
  }
  Game.fx = Game.fx.filter((f) => f.t > 0);
  if (Game.fx.length > 260) Game.fx.splice(0, Game.fx.length - 260);
  for (const f of Game.floats) { f.t -= dtReal; f.y -= (f.big ? 10 : 18) * dtReal; }
  Game.floats = Game.floats.filter((f) => f.t > 0);
  Game.shake = Math.max(0, Game.shake - dtReal * 14);
  Game.glitch = Math.max(0, Game.glitch - dtReal);
  if (Game.flash) { Game.flash.t -= dtReal; if (Game.flash.t <= 0) Game.flash = null; }
}
