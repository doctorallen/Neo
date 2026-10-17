'use strict';
// ---------------------------------------------------------------------------
// Controls, twin-stick. On a phone: two floating sticks in the control deck
// (never on the room view). The move stick appears wherever the left thumb
// lands, and a quick flick of it Phases. The aim stick appears under the
// right thumb, and holding it hacks: drag to aim (with aim assist), or just
// hold to fire at the nearest process. Left-handed swaps the sides. FOCUS
// and PHASE are buttons on their own pointers. On a keyboard: WASD to move,
// the arrows or the mouse on the room view to aim and fire, Space to Phase,
// Shift or E for Bullet Time, Esc to pause.
// The test autopilot drives the same interface through Input.bot.
// ---------------------------------------------------------------------------

const STICK_R = 48; // CSS px
const STICK_DEAD = 8;
const FLICK_WINDOW = 80; // ms
const FLICK_SPEED = 0.9; // CSS px per ms
const FLICK_MIN = 24; // CSS px

const Input = {
  move: { x: 0, y: 0 },
  stick: null, // the move stick: { id, bx, by, x, y, samples }
  aimStick: null, // the aim stick: { id, bx, by, x, y }
  mouse: null, // the mouse held on the room view: { id, cx, cy } (client px)
  keys: new Set(),
  phaseReq: null, focusReq: false,
  blockedUntil: 0, staleIds: new Set(),
  bot: null, // { x, y, aim: [dx,dy] | 'auto' | null, phase: [dx,dy] | null, focus: bool } from the tests
  usedTouch: false,

  moving() {
    return Math.hypot(this.move.x, this.move.y) > 0.01;
  },
  // Where Neo is hacking, from his position p: null when nothing is held,
  // { x: 0, y: 0 } to fire at the nearest process, else a unit direction.
  aimVector(p) {
    if (this.bot) {
      const a = this.bot.aim;
      if (!a) return null;
      if (a === 'auto') return { x: 0, y: 0 };
      const m = Math.hypot(a[0], a[1]) || 1;
      return { x: a[0] / m, y: a[1] / m };
    }
    const k = this.keys;
    const kx = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0), ky = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
    if (kx || ky) { const m = Math.hypot(kx, ky); return { x: kx / m, y: ky / m }; }
    const s = this.aimStick;
    if (s) {
      const dx = s.x - s.bx, dy = s.y - s.by, m = Math.hypot(dx, dy);
      return m > STICK_DEAD ? { x: dx / m, y: dy / m } : { x: 0, y: 0 };
    }
    if (this.mouse && p) {
      const w = viewToWorld(this.mouse.cx, this.mouse.cy);
      const dx = w.x - p.x, dy = w.y - (p.y - 7), m = Math.hypot(dx, dy);
      return m > 2 ? { x: dx / m, y: dy / m } : { x: 0, y: 0 };
    }
    return null;
  },
  consumePhase() { const p = this.phaseReq; this.phaseReq = null; if (this.bot && this.bot.phase) { const b = this.bot.phase; this.bot.phase = null; return b; } return p; },
  consumeFocus() { const f = this.focusReq; this.focusReq = false; if (this.bot && this.bot.focus) { this.bot.focus = false; return true; } return f; },

  // While a card opens: drop the thumb that's down, and ignore everything
  // for a moment; that thumb must lift and land again to count.
  block(ms = 400) {
    this.blockedUntil = performance.now() + ms;
    if (this.stick) { this.staleIds.add(this.stick.id); this.endStick(false); }
    if (this.aimStick) { this.staleIds.add(this.aimStick.id); this.endAim(); }
    this.mouse = null;
    this.keys.clear();
    this.phaseReq = null; this.focusReq = false;
    this.update();
  },
  blocked() { return performance.now() < this.blockedUntil; },

  update() {
    if (this.bot) { this.move.x = this.bot.x || 0; this.move.y = this.bot.y || 0; return; }
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyA')) x -= 1;
    if (k.has('KeyD')) x += 1;
    if (k.has('KeyW')) y -= 1;
    if (k.has('KeyS')) y += 1;
    // in the apartment there's nothing to hack, so the arrows walk too
    if (Game.scene !== 'run') {
      if (k.has('ArrowLeft')) x -= 1;
      if (k.has('ArrowRight')) x += 1;
      if (k.has('ArrowUp')) y -= 1;
      if (k.has('ArrowDown')) y += 1;
    }
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

  startAim(ev, deck) {
    const r = deck.getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    this.aimStick = { id: ev.pointerId, bx: x, by: y, x, y };
    try { deck.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
    UI.showAim(this.aimStick);
    UI.hintDone('aim');
  },
  moveAim(ev, deck) {
    const s = this.aimStick;
    const r = deck.getBoundingClientRect();
    s.x = ev.clientX - r.left; s.y = ev.clientY - r.top;
    const dx = s.x - s.bx, dy = s.y - s.by, m = Math.hypot(dx, dy);
    if (m > STICK_R) { s.bx = s.x - (dx / m) * STICK_R; s.by = s.y - (dy / m) * STICK_R; }
    UI.showAim(s);
  },
  endAim() {
    this.aimStick = null;
    UI.showAim(null);
  },
};

// client px on the room view → world px
function viewToWorld(cx, cy) {
  const r = View.canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  return { x: ((cx - r.left) * dpr - View.offX) / View.scale, y: ((cy - r.top) * dpr - View.offY) / View.scale + Game.camY };
}

function setupInput() {
  const deck = $('deck');
  const isButton = (el) => el && el.closest && el.closest('button, .deck-btn');
  // A touch on the aim side of the deck aims, the other side moves; a
  // second thumb on a side already in use takes whichever stick is free.
  // In the apartment there's nothing to hack, so every touch moves.
  deck.addEventListener('pointerdown', (ev) => {
    Sound.unlock();
    Input.usedTouch = Input.usedTouch || ev.pointerType === 'touch';
    if (isButton(ev.target) || Input.blocked() || Game.modal) return;
    const r = deck.getBoundingClientRect();
    const rightSide = ev.clientX - r.left > r.width / 2;
    const canAim = Game.scene === 'run' && !Input.aimStick;
    let aim = Game.scene === 'run' && rightSide !== !!Save.settings.leftHanded;
    if (aim && !canAim) aim = false;
    if (!aim && Input.stick) aim = canAim;
    if (!aim && Input.stick) return;
    ev.preventDefault();
    Input.staleIds.delete(ev.pointerId);
    if (aim) Input.startAim(ev, deck); else Input.startStick(ev, deck);
  });
  deck.addEventListener('pointermove', (ev) => {
    if (Input.stick && ev.pointerId === Input.stick.id) { ev.preventDefault(); Input.moveStick(ev, deck); }
    else if (Input.aimStick && ev.pointerId === Input.aimStick.id) { ev.preventDefault(); Input.moveAim(ev, deck); }
  });
  const up = (flick) => (ev) => {
    if (Input.staleIds.has(ev.pointerId)) { Input.staleIds.delete(ev.pointerId); return; }
    if (Input.stick && ev.pointerId === Input.stick.id) Input.endStick(flick);
    else if (Input.aimStick && ev.pointerId === Input.aimStick.id) Input.endAim();
  };
  deck.addEventListener('pointerup', up(true));
  deck.addEventListener('pointercancel', up(false));
  deck.addEventListener('lostpointercapture', up(false));

  // a mouse held on the room view aims and fires at the cursor (touches on
  // the room view still do nothing, so a thumb never covers the action)
  const stage = $('stage');
  stage.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0 || Game.scene !== 'run' || Game.modal || Input.blocked()) return;
    ev.preventDefault();
    Input.mouse = { id: ev.pointerId, cx: ev.clientX, cy: ev.clientY };
    try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
    UI.hintDone('aim');
  });
  stage.addEventListener('pointermove', (ev) => { if (Input.mouse && ev.pointerId === Input.mouse.id) { Input.mouse.cx = ev.clientX; Input.mouse.cy = ev.clientY; } });
  const mouseUp = (ev) => { if (Input.mouse && ev.pointerId === Input.mouse.id) Input.mouse = null; };
  stage.addEventListener('pointerup', mouseUp);
  stage.addEventListener('pointercancel', mouseUp);
  stage.addEventListener('lostpointercapture', mouseUp);

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
    if (/^Key[WASD]$/.test(ev.code)) { Input.keys.add(ev.code); ev.preventDefault(); UI.hintDone('move'); }
    if (/^Arrow/.test(ev.code)) { Input.keys.add(ev.code); ev.preventDefault(); UI.hintDone(Game.scene === 'run' ? 'aim' : 'move'); }
  });
  window.addEventListener('keyup', (ev) => { Input.keys.delete(ev.code); });
  window.addEventListener('blur', () => { Input.keys.clear(); Input.mouse = null; if (Input.stick) Input.endStick(false); if (Input.aimStick) Input.endAim(); });

  // no pinch zoom, no page drag, no long-press menus on the game
  document.addEventListener('gesturestart', (ev) => ev.preventDefault());
  document.addEventListener('touchmove', (ev) => { if (!ev.target.closest || !ev.target.closest('.scroll')) ev.preventDefault(); }, { passive: false });
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.addEventListener('dblclick', (ev) => ev.preventDefault());
  // every tap may need to wake the audio (iOS suspends it after calls and tab switches)
  window.addEventListener('pointerup', () => Sound.unlock());
  window.addEventListener('click', () => Sound.unlock());
}
