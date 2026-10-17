'use strict';
// ---------------------------------------------------------------------------
// Boot and the loop. The simulation steps at a fixed 60 Hz (at most five
// steps a frame, so a slow phone slows down rather than falling through
// walls), and a frame is drawn on every animation frame. Game.step(dt) runs
// one step on its own, which is how the tests play the game quickly.
// ---------------------------------------------------------------------------

const STEP = 1 / 60;
let _acc = 0, _last = 0, _resizeT = 0;

function step(dtReal) {
  Game.realT += dtReal;
  Input.update();
  if (Game.transition && !Game.modal && !Game.paused) {
    const tr = Game.transition;
    tr.t += dtReal;
    if (!tr.done && tr.t >= tr.dur / 2) { tr.done = true; tr.then(); }
    if (tr.t >= tr.dur) Game.transition = null;
  }
  updateFx(dtReal, Game.modal ? 0 : dtReal * Game.timeScale);
  UI.frame(dtReal);
  if (Game.modal || Game.paused) return;
  if (Game.scene === 'hub') { updateHub(dtReal); updateCamera(); return; }
  if (Game.scene !== 'run' || !Game.run || Game.run.ended) return;
  const run = Game.run;
  if (Game.flow) { updateRunFlow(dtReal); return; }
  if (Game.transition) return;
  updateBulletTime(dtReal);
  const dt = dtReal * Game.timeScale;
  Game.t += dt;
  run.time += dtReal;
  updatePlayer(dtReal);
  updateShots(dtReal);
  updateFight(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updateHazards(dt, dtReal);
  updateDrops(dtReal);
  updateProps(dtReal);
  updateCritters(dt);
  if (Game.arrivalCollapse > 0) Game.arrivalCollapse -= dtReal;
  if (!Game.flow) checkDoorways();
  updateCamera();
  Sound.heartbeat(run.hp > 0 && run.hp < run.stats.maxHp * 0.25);
}

// The scripted moments of a run: answering the phone, dying, and winning.
function updateRunFlow(dt) {
  const f = Game.flow;
  f.t += dt;
  if (f.kind === 'phone' && f.t >= 1.1) finishPhone();
  else if (f.kind === 'death' && f.t >= 1.6) { Game.flow = null; endRun(false); }
  else if (f.kind === 'victory') {
    // time stops while he comes apart, then the white-out
    if (f.t < 1.2) updateFx(dt, dt * 0.4);
    if (f.t >= 2.8) { Game.flow = null; endRun(true); }
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - _last) / 1000 || 0);
  _last = now;
  try {
    _acc += dt;
    let n = 0;
    while (_acc >= STEP && n < 5) { step(STEP); _acc -= STEP; n++; }
    if (n === 5) _acc = 0;
    _resizeT -= dt;
    if (_resizeT <= 0) {
      _resizeT = 0.5; fitDeck(); resizeView();
    }
    renderFrame();
  } catch (e) {
    noteError(e);
  }
  requestAnimationFrame(frame);
}

const Errors = [];
function noteError(e) {
  Errors.push(String(e && e.stack || e));
  if (Errors.length > 20) Errors.shift();
  console.error(e);
}

// Upright, the control deck takes whatever height is left once a whole room
// fits above it (a large room if possible, else a standard one), between 160
// and 250 CSS px, so on a phone in Safari, toolbars and all, the room doesn't
// scroll. Sideways (the screen more than 5:4 wide), the layout turns: the
// room stands in the middle at the largest whole scale that fits a large
// room top to bottom, with at least 150 CSS px either side for a thumb, and
// the deck fills the sides (css: #app.wide).
const DECK_MIN = 160, DECK_MAX = 250, WIDE_RATIO = 1.25, WIDE_SIDE = 150;
function fitDeck() {
  const app = $('app'), stage = $('stage');
  const dpr = window.devicePixelRatio || 1;
  const wide = window.innerWidth > window.innerHeight * WIDE_RATIO;
  if (app.classList.contains('wide') !== wide) app.classList.toggle('wide', wide);
  if (wide) {
    const r = app.getBoundingClientRect();
    let k = Math.max(1, Math.floor((r.height * dpr) / (ROOM_SIZE.large[1] * TILE)));
    while (k > 1 && (r.width - (VIEW_W * k) / dpr) / 2 < WIDE_SIDE) k--;
    // a device pixel spare, so rounding never drops the view to the scale below
    const w = (VIEW_W * k + 1) / dpr + 'px';
    if (document.documentElement.style.getPropertyValue('--stage-w') !== w) document.documentElement.style.setProperty('--stage-w', w);
    return;
  }
  const k = Math.max(1, Math.floor((stage.getBoundingClientRect().width * dpr) / VIEW_W)) / dpr; // CSS px per game px
  const safeB = parseFloat(getComputedStyle($('deck')).paddingBottom) || 0;
  const avail = app.getBoundingClientRect().height - $('topbar').getBoundingClientRect().height - safeB;
  let deck = DECK_MIN;
  for (const size of ['large', 'std']) {
    const d = Math.floor(avail - ROOM_SIZE[size][1] * TILE * k - 2);
    if (d >= DECK_MIN) { deck = Math.min(DECK_MAX, d); break; }
  }
  const v = deck + 'px';
  if (document.documentElement.style.getPropertyValue('--deck-h') !== v) document.documentElement.style.setProperty('--deck-h', v);
}

function fitAppHeight() {
  // older browsers without dvh: size to the visible viewport instead
  if (window.CSS && CSS.supports && CSS.supports('height', '100dvh')) return;
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
}

function boot() {
  Save.load();
  buildSprites();
  setupView();
  setupInput();
  UI.init();
  fitAppHeight();
  fitDeck();
  resizeView();
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { fitAppHeight(); fitDeck(); resizeView(); if (Rain.on && Rain.fit) Rain.fit(); }, 100); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  // leaving the tab pauses the game and the sound; coming back shows the pause menu
  document.addEventListener('visibilitychange', () => {
    Sound.setHidden(document.hidden);
    if (document.hidden && !Game.modal && (Game.scene === 'run' || Game.scene === 'hub') && !Game.flow) UI.openPause();
  });
  window.addEventListener('pagehide', saveOnExit);
  // the back gesture pauses instead of leaving
  try {
    history.pushState({ neo: 1 }, '');
    window.addEventListener('popstate', () => {
      history.pushState({ neo: 1 }, '');
      if (Game.scene === 'run' || Game.scene === 'hub') UI.openPause();
    });
  } catch (e) { /* no history API (file:// in some browsers) */ }
  Game.step = step;
  Game.render = renderFrame;
  Game.ready = true;
  UI.openTitle();
  requestAnimationFrame((t) => { _last = t; frame(t); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
