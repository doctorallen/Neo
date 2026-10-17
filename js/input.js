'use strict';
// ---------------------------------------------------------------------------
// Controls. On a phone: a floating joystick that appears wherever the thumb
// lands in the control deck (never on the room view), a quick flick of that
// thumb to Phase, and two buttons, FOCUS and PHASE, that work on their own
// pointers so a second thumb can use them mid-drag. On a keyboard: WASD or
// the arrows, Space to Phase, Shift or E for Bullet Time, Esc to pause.
// The test autopilot drives the same interface through Input.bot.
// ---------------------------------------------------------------------------

const STICK_R = 48; // CSS px
const STICK_DEAD = 8;
const FLICK_WINDOW = 80; // ms
const FLICK_SPEED = 0.9; // CSS px per ms
const FLICK_MIN = 24; // CSS px

const Input = {
  move: { x: 0, y: 0 },
  stick: null, // { id, bx, by, x, y, samples }
  keys: new Set(),
  phaseReq: null, focusReq: false,
  blockedUntil: 0, staleIds: new Set(),
  bot: null, // { x, y, phase: [dx,dy] | null, focus: bool } from the tests
  usedTouch: false,

  moving() {
    return Math.hypot(this.move.x, this.move.y) > 0.01;
  },
  consumePhase() { const p = this.phaseReq; this.phaseReq = null; if (this.bot && this.bot.phase) { const b = this.bot.phase; this.bot.phase = null; return b; } return p; },
  consumeFocus() { const f = this.focusReq; this.focusReq = false; if (this.bot && this.bot.focus) { this.bot.focus = false; return true; } return f; },

  // While a card opens: drop the thumb that's down, and ignore everything
  // for a moment; that thumb must lift and land again to count.
  block(ms = 400) {
    this.blockedUntil = performance.now() + ms;
    if (this.stick) { this.staleIds.add(this.stick.id); this.endStick(false); }
    this.keys.clear();
    this.phaseReq = null; this.focusReq = false;
    this.update();
  },
  blocked() { return performance.now() < this.blockedUntil; },

  update() {
    if (this.bot) { this.move.x = this.bot.x || 0; this.move.y = this.bot.y || 0; return; }
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1;
    if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y -= 1;
    if (k.has('ArrowDown') || k.has('KeyS')) y += 1;
    if (x || y) { const m = Math.hypot(x, y); this.move.x = x / m; this.move.y = y / m; return; }
    const s = this.stick;
    if (s) {
      const dx = s.x - s.bx, dy = s.y - s.by, m = Math.hypot(dx, dy);
      if (m > STICK_DEAD) { const k2 = Math.min(1, (m - STICK_DEAD) / (STICK_R - STICK_DEAD)); this.move.x = (dx / m) * k2; this.move.y = (dy / m) * k2; return; }
    }
    this.move.x = 0; this.move.y = 0;
  },

  startStick(ev, deck) {
    const r = deck.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    this.stick = { id: ev.pointerId, bx: x, by: y, x, y, samples: [[performance.now(), x, y]] };
    try { deck.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
    UI.showStick(this.stick);
    UI.hintDone('move');
  },
  moveStick(ev, deck) {
    const s = this.stick;
    const r = deck.getBoundingClientRect();
    s.x = ev.clientX - r.left; s.y = ev.clientY - r.top;
    // the base trails the thumb, so reversing is instant
    const dx = s.x - s.bx, dy = s.y - s.by, m = Math.hypot(dx, dy);
    if (m > STICK_R) { s.bx = s.x - (dx / m) * STICK_R; s.by = s.y - (dy / m) * STICK_R; }
    const now = performance.now();
    s.samples.push([now, s.x, s.y]);
    while (s.samples.length > 2 && now - s.samples[0][0] > FLICK_WINDOW * 1.5) s.samples.shift();
    UI.showStick(s);
  },
  endStick(flickOk) {
    const s = this.stick;
    this.stick = null;
    UI.showStick(null);
    if (!s || !flickOk || !Save.settings.flickPhase) return;
    // a flick: fast travel in the last few tens of milliseconds
    const now = performance.now();
    const recent = s.samples.filter((q) => now - q[0] <= FLICK_WINDOW);
    if (recent.length < 2) return;
    const a = recent[0], b = recent[recent.length - 1];
    const dx = b[1] - a[1], dy = b[2] - a[2], d = Math.hypot(dx, dy), dt = Math.max(1, b[0] - a[0]);
    if (d >= FLICK_MIN && d / dt >= FLICK_SPEED && Game.player && Game.player.phaseCdT <= 0) this.phaseReq = [dx / d, dy / d];
  },
};

function setupInput() {
  const deck = $('deck');
  const isButton = (el) => el && el.closest && el.closest('button, .deck-btn');
  deck.addEventListener('pointerdown', (ev) => {
    Sound.unlock();
    Input.usedTouch = Input.usedTouch || ev.pointerType === 'touch';
    if (isButton(ev.target) || Input.blocked() || Input.stick || Game.modal) return;
    ev.preventDefault();
    Input.staleIds.delete(ev.pointerId);
    Input.startStick(ev, deck);
  });
  deck.addEventListener('pointermove', (ev) => {
    if (!Input.stick || ev.pointerId !== Input.stick.id) return;
    ev.preventDefault();
    Input.moveStick(ev, deck);
  });
  const up = (flick) => (ev) => {
    if (Input.staleIds.has(ev.pointerId)) { Input.staleIds.delete(ev.pointerId); return; }
    if (!Input.stick || ev.pointerId !== Input.stick.id) return;
    Input.endStick(flick);
  };
  deck.addEventListener('pointerup', up(true));
  deck.addEventListener('pointercancel', up(false));
  deck.addEventListener('lostpointercapture', up(false));

  // the buttons act the moment they're touched, on their own pointers
  const press = (id, fn) => {
    const el = $(id);
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      Sound.unlock();
      if (Input.blocked() || Game.modal) return;
      fn();
    });
  };
  press('btn-focus', () => { Input.focusReq = true; });
  press('btn-phase', () => {
    const p = Game.player;
    if (!p || p.phaseCdT > 0) return;
    Input.phaseReq = Input.moving() ? [Input.move.x, Input.move.y] : [p.facing, 0];
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat && (ev.code === 'Space' || ev.code === 'KeyE' || ev.code.startsWith('Shift'))) return;
    Sound.unlock();
    if (ev.code === 'Escape' || ev.code === 'KeyP') { UI.onEscape(); ev.preventDefault(); return; }
    if (Game.modal) { if (ev.code === 'Enter' || ev.code === 'Space') UI.onEnter(ev); return; }
    if (Input.blocked()) return;
    if (ev.code === 'Space') { const p = Game.player; if (p && p.phaseCdT <= 0) Input.phaseReq = Input.moving() ? [Input.move.x, Input.move.y] : [p.facing, 0]; ev.preventDefault(); return; }
    if (ev.code === 'KeyE' || ev.code === 'ShiftLeft' || ev.code === 'ShiftRight') { Input.focusReq = true; return; }
    if (/^(Arrow|Key[WASD])/.test(ev.code)) { Input.keys.add(ev.code); ev.preventDefault(); UI.hintDone('move'); }
  });
  window.addEventListener('keyup', (ev) => { Input.keys.delete(ev.code); });
  window.addEventListener('blur', () => { Input.keys.clear(); if (Input.stick) Input.endStick(false); });

  // no pinch zoom, no page drag, no long-press menus on the game
  document.addEventListener('gesturestart', (ev) => ev.preventDefault());
  document.addEventListener('touchmove', (ev) => { if (!ev.target.closest || !ev.target.closest('.scroll')) ev.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('dblclick', (ev) => ev.preventDefault());
  // every tap may need to wake the audio (iOS suspends it after calls and tab switches)
  window.addEventListener('pointerup', () => Sound.unlock());
  window.addEventListener('click', () => Sound.unlock());
}
