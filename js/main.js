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
  if (Game.transition) {
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
    if (_resizeT <= 0) { _resizeT = 0.5; resizeView(); }
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
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { fitAppHeight(); resizeView(); if (Rain.on && Rain.fit) Rain.fit(); }, 100); };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  // leaving the tab pauses the game and the sound; coming back shows the pause menu
  document.addEventListener('visibilitychange', () => {
    Sound.setHidden(document.hidden);
    if (document.hidden && !Game.modal && (Game.scene === 'run' || Game.scene === 'hub') && !Game.flow) UI.openPause();
  });
  window.addEventListener('pagehide', () => { if (Game.run && !Game.run.ended) { commitData(); Save.write(); } });
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
