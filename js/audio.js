'use strict';
// ---------------------------------------------------------------------------
// NEO: all sound and music, synthesised with the Web Audio API (no files).
//
// Graph:  voices -> sfxIn -> sfxLP -> sfxVol ----\
//         music players -> musicIn -> musicLP -> musicVol -> master -> limiter -> out
//         sends (sfxWet, musicRev) -> generated-impulse reverb ----/
// A shared bit-crusher (crushIn) feeds sfxIn for the "digital" effects.
// Music is a 16th-note look-ahead scheduler; each mode is a "player" with its
// own gain so modes crossfade, and a tension gain for the percussion layer.
// Bullet Time low-passes the music bus and detunes every music oscillator
// through one shared ConstantSource.
//
// Nothing is created until Sound.unlock() runs inside a user gesture, and
// every public method is a silent no-op before that (or if Web Audio is
// missing). Only `Sound` is declared globally.
// ---------------------------------------------------------------------------

const Sound = (function () {
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  const LOOKAHEAD = 0.3, TICK_MS = 50, RATE_MS = 30;
  const MAX_VOICES = 20, MAX_NODES = 80, MAX_SPAM = 8;
  const MUSIC_TRIM = 0.5, SFX_TRIM = 0.9;
  const MODES = ['none', 'title', 'hub', 'floor1', 'floor2', 'floor3', 'floor4', 'boss', 'victory'];

  let E = null;      // the engine being built into (swapped during offline renders)
  let live = null;   // the real-time engine
  let timer = null;
  const st = { music: 0.5, sfx: 0.8, mode: 'none', bullet: false, tension: 0, heart: false, hidden: false, unlocked: false };
  const lastPlay = Object.create(null);
  const stats = { played: 0, dropped: 0, stolen: 0, limited: 0, peakVoices: 0, peakNodes: 0 };

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const num = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
  const quiet = (p) => { try { if (p && typeof p.then === 'function') p.then(null, () => {}); } catch (e) { /* ignore */ } };
  const unplug = (n) => { try { n.disconnect(); } catch (e) { /* already */ } };

  // ---- parameter moves ----
  function hold(param, t) {
    if (param.cancelAndHoldAtTime) { try { param.cancelAndHoldAtTime(t); return; } catch (e) { /* fall through */ } }
    const v = param.value; param.cancelScheduledValues(t); param.setValueAtTime(v, t);
  }
  function glide(param, value, tau) { const t = param._ctx.currentTime; hold(param, t); param.setTargetAtTime(value, t, tau); }
  function ramp(param, value, dur) { const t = param._ctx.currentTime; hold(param, t); param.linearRampToValueAtTime(value, t + dur); }
  const tag = (param, ctx) => { param._ctx = ctx; return param; };

  // ---- generated buffers and curves ----
  function normalise(d, peak) { let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m; }
  function noiseBuf(ctx, secs) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function brownBuf(ctx, secs) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate), d = b.getChannelData(0);
    let x = 0; for (let i = 0; i < d.length; i++) { x = (x + (Math.random() * 2 - 1) * 0.02) * 0.998; d[i] = x; }
    normalise(d, 0.9); return b;
  }
  // a dark, diffuse room: decaying noise, low-passed more as it decays
  function impulse(ctx, secs) {
    const sr = ctx.sampleRate, len = Math.floor(sr * secs), pre = Math.floor(sr * 0.012), b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let y = 0;
      for (let i = pre; i < len; i++) { const u = (i - pre) / (len - pre), a = 0.7 - 0.55 * u; y += a * ((Math.random() * 2 - 1) - y); d[i] = y * Math.pow(1 - u, 3); }
    }
    return b;
  }
  // one mechanical key: a sharp contact click, a plastic "thock", and the bottom-out click
  function keyBuf(ctx) {
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.06), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const f1 = rnd(330, 470), f2 = rnd(2300, 3300), t2 = rnd(0.008, 0.014), TAU = Math.PI * 2;
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, w = Math.random() * 2 - 1, hp = w - prev; prev = w;
      let s = hp * 0.5 * Math.exp(-t / 0.0009) + Math.sin(TAU * f1 * t) * 0.55 * Math.exp(-t / 0.007) * (1 - Math.exp(-t / 0.0005)) + Math.sin(TAU * f2 * t) * 0.22 * Math.exp(-t / 0.0035);
      if (t > t2) { const u = t - t2; s += hp * 0.25 * Math.exp(-u / 0.0007) + Math.sin(TAU * f1 * 1.3 * u) * 0.2 * Math.exp(-u / 0.005); }
      d[i] = s;
    }
    normalise(d, 0.9); return b;
  }
  // a knuckle on a wooden door: the panel's low, inharmonic modes rung by a soft
  // few-millisecond contact, plus the dull thump of the knuckle itself
  function knockBuf(ctx, k) {
    const sr = ctx.sampleRate, len = Math.floor(sr * 0.24), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0), TAU = Math.PI * 2;
    const modes = [[86, 0.085, 1], [139, 0.06, 0.8], [221, 0.045, 0.62], [301, 0.032, 0.42], [446, 0.022, 0.3], [652, 0.014, 0.17], [975, 0.008, 0.08]]
      .map(([f, tau, a]) => [f * k * rnd(0.98, 1.02), tau, a, rnd(0, TAU)]);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr; let s = 0;
      for (const [f, tau, a, ph] of modes) s += a * Math.exp(-t / tau) * Math.sin(TAU * f * t + ph);
      lp += 0.22 * ((Math.random() * 2 - 1) - lp);
      s += lp * 1.6 * Math.exp(-t / 0.004);
      d[i] = s * (1 - Math.exp(-t / 0.0013));
    }
    normalise(d, 0.9); return b;
  }
  function crushCurve(levels) { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.round(x * levels) / levels; } return c; }
  function distCurve(k) { const n = 1024, c = new Float32Array(n), m = Math.tanh(k); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / m; } return c; }

  // ---- engine ----
  function build(ctx) {
    const e = { ctx, voices: [], nodes: 0, players: [], hbNext: 0, tensOff: 0, offline: false };
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; tag(n.gain, ctx); return n; };
    const lp = (f) => { const n = ctx.createBiquadFilter(); n.type = 'lowpass'; n.frequency.value = f; n.Q.value = 0.8; tag(n.frequency, ctx); return n; };
    e.comp = ctx.createDynamicsCompressor();
    try { e.comp.threshold.value = -6; e.comp.knee.value = 6; e.comp.ratio.value = 10; e.comp.attack.value = 0.003; e.comp.release.value = 0.2; } catch (err) { /* defaults */ }
    e.master = g(1); e.master.connect(e.comp); e.comp.connect(ctx.destination);
    e.conv = ctx.createConvolver(); e.conv.buffer = impulse(ctx, 2.2); e.conv.connect(e.master);
    e.musicIn = g(1); e.musicLP = lp(20000); e.musicVol = g(st.music * MUSIC_TRIM); e.musicRev = g(0.22);
    e.musicIn.connect(e.musicLP); e.musicLP.connect(e.musicVol); e.musicVol.connect(e.master); e.musicVol.connect(e.musicRev); e.musicRev.connect(e.conv);
    e.sfxIn = g(1); e.sfxLP = lp(20000); e.sfxVol = g(st.sfx * SFX_TRIM);
    e.sfxIn.connect(e.sfxLP); e.sfxLP.connect(e.sfxVol); e.sfxVol.connect(e.master);
    e.sfxWet = g(1); e.sfxWetVol = g(st.sfx * SFX_TRIM); e.sfxWet.connect(e.sfxWetVol); e.sfxWetVol.connect(e.conv);
    e.crushIn = g(3); e.crush = ctx.createWaveShaper(); e.crush.curve = crushCurve(8); e.crushOut = g(0.33);
    e.crushIn.connect(e.crush); e.crush.connect(e.crushOut); e.crushOut.connect(e.sfxIn);
    e.distCurve = distCurve(3);
    if (ctx.createConstantSource) { e.detune = ctx.createConstantSource(); e.detune.offset.value = 0; tag(e.detune.offset, ctx); e.detune.start(); }
    e.noise = noiseBuf(ctx, 2); e.brown = brownBuf(ctx, 4);
    e.keys = [0, 1, 2, 3].map(() => keyBuf(ctx)); e.knocks = [knockBuf(ctx, 1), knockBuf(ctx, 0.95)];
    try { e.humWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0, 0, 0]), new Float32Array([0, 1, 0.64, 0.32, 0.14])); } catch (err) { e.humWave = null; }
    if (st.bullet) applyBullet(e, true, true);
    return e;
  }
  function applyBullet(e, on, instant) {
    const set = (p, v) => { if (instant) p.value = v; else glide(p, v, 0.1); };
    set(e.musicLP.frequency, on ? 650 : 20000);
    set(e.sfxLP.frequency, on ? 4500 : 20000);
    set(e.musicRev.gain, on ? 0.4 : 0.22);
    if (e.detune) set(e.detune.offset, on ? -130 : 0);
  }

  // ======================= SFX =======================
  // A voice: sources -> per-sound gains -> v.out (vol, steal fade) -> [pan] -> sfx bus
  function voice(prio, vol, pan, crush) {
    const c = E.ctx, v = { e: E, prio, born: c.currentTime, nodes: [], srcs: [], left: 0, done: false, listed: false, cost: 0, vol };
    v.out = c.createGain(); v.out.gain.value = vol; v.nodes.push(v.out);
    let last = v.out;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); v.out.connect(p); v.nodes.push(p); last = p; }
    last.connect(crush ? E.crushIn : E.sfxIn); v.tail = last;
    return v;
  }
  function unlist(v) { if (!v.listed) return; v.listed = false; const i = v.e.voices.indexOf(v); if (i >= 0) v.e.voices.splice(i, 1); v.e.nodes -= v.cost; }
  function endVoice(v) { if (v.done) return; v.done = true; unlist(v); for (const s of v.srcs) unplug(s); for (const n of v.nodes) unplug(n); }
  function src(v, s, t0, t1, off) {
    v.srcs.push(s); v.left++;
    s.onended = () => { if (--v.left <= 0) endVoice(v); };
    if (off) s.start(t0, off); else s.start(t0);
    s.stop(t1);
  }
  function steal(v) {
    const t = v.e.ctx.currentTime;
    try { hold(v.out.gain, t); v.out.gain.linearRampToValueAtTime(0, t + 0.02); } catch (e) { /* ignore */ }
    for (const s of v.srcs) { try { s.stop(t + 0.03); } catch (e) { /* ignore */ } }
    unlist(v); stats.stolen++;
  }
  // Room for a new voice of this priority and (estimated) node cost? Steals the
  // oldest lower-priority voices (or equal, above spam level) until it fits.
  function admit(prio, cost) {
    const vs = E.voices;
    if (prio === 0) { let n = 0; for (const v of vs) if (v.prio === 0) n++; if (n >= MAX_SPAM) return false; }
    const fits = () => vs.length < MAX_VOICES && E.nodes + cost <= MAX_NODES;
    if (fits()) return true;
    const cands = vs.filter((v) => v.prio < prio || (prio > 0 && v.prio === prio)).sort((a, b) => a.prio - b.prio || a.born - b.born);
    let freeV = MAX_VOICES - vs.length, freeN = MAX_NODES - E.nodes, need = 0;
    while (need < cands.length && (freeV < 1 || freeN < cost)) { freeV++; freeN += cands[need].cost; need++; }
    if (freeV < 1 || freeN < cost) return false;
    for (let i = 0; i < need; i++) steal(cands[i]);
    return true;
  }
  function fire(def, P, vol, pan, t) {
    const v = voice(def.p, vol, pan, def.crush);
    try { def.fn(v, t, P); } catch (err) { endVoice(v); return; }
    v.cost = v.nodes.length + v.srcs.length; def.cost = Math.max(def.cost || 0, v.cost); v.listed = true; E.voices.push(v); E.nodes += v.cost;
    stats.played++; stats.peakVoices = Math.max(stats.peakVoices, E.voices.length); stats.peakNodes = Math.max(stats.peakNodes, E.nodes);
    if (v.left === 0) endVoice(v);
  }

  // building blocks (all use E and register their nodes on the voice)
  function env(p, t, a, peak, dur) {
    peak = Math.max(peak, 0.0002); const end = t + Math.max(dur, a + 0.005);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a); p.exponentialRampToValueAtTime(0.0001, end); return end;
  }
  function pts(param, list) {
    list.forEach(([t, val, k], i) => {
      if (i === 0 || k === 's') param.setValueAtTime(val, t);
      else if (k === 'e') param.exponentialRampToValueAtTime(Math.max(val, 0.0001), t);
      else param.linearRampToValueAtTime(val, t);
    });
  }
  function filter(v, type, f, Q, dest) {
    const n = E.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = Q || 1;
    n.connect(dest || v.out); v.nodes.push(n); return n;
  }
  function wet(v, amt) { const w = E.ctx.createGain(); w.gain.value = amt; v.tail.connect(w); w.connect(E.sfxWet); v.nodes.push(w); }
  // a plucked/decaying oscillator: f0 (gliding to f1 if given) over dur
  function tone(v, type, f0, f1, t, dur, peak, a, dest) {
    const c = E.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const end = env(g.gain, t, a || 0.003, peak, dur);
    o.connect(g); g.connect(dest || v.out); v.nodes.push(g); src(v, o, t, end + 0.02); return o;
  }
  // an oscillator with explicit frequency and gain breakpoints [[t, value, 's'|'l'|'e'], ...]
  function shaped(v, type, fList, gList, dest) {
    const c = E.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; pts(o.frequency, fList); pts(g.gain, gList);
    o.connect(g); g.connect(dest || v.out); v.nodes.push(g); src(v, o, gList[0][0], gList[gList.length - 1][0] + 0.02); return { o, g };
  }
  function stepF(param, t, list, dt) { list.forEach((f, i) => param.setValueAtTime(Math.max(1, f), t + i * dt)); }
  // raw noise source -> [filter] -> gain (automate g.gain yourself)
  function noiseRaw(v, t0, t1, type, f, Q, dest, buffer) {
    const c = E.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = buffer || E.noise; s.loop = true;
    let fl = null;
    if (type) { fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = Q || 1; s.connect(fl); fl.connect(g); v.nodes.push(fl); } else s.connect(g);
    g.gain.value = 0; g.connect(dest || v.out); v.nodes.push(g);
    src(v, s, t0, t1, Math.random() * 1.5);
    return { g, f: fl };
  }
  function noise(v, t, dur, peak, type, f0, f1, Q, a, dest) {
    const n = noiseRaw(v, t, t + dur + 0.03, type, f0, Q, dest);
    if (n.f) { n.f.frequency.setValueAtTime(f0, t); if (f1 && f1 !== f0) n.f.frequency.exponentialRampToValueAtTime(f1, t + dur); }
    env(n.g.gain, t, a || 0.002, peak, dur); return n;
  }
  function buf(v, b, t, rate, gainV, dest) {
    const c = E.ctx, s = c.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    let to = dest || v.out;
    if (gainV !== 1) { const g = c.createGain(); g.gain.value = gainV; g.connect(to); v.nodes.push(g); to = g; }
    s.connect(to); src(v, s, t, t + b.duration / rate + 0.02); return s;
  }
  function arp(v, notes, t, dt, type, dur, peak, P) { notes.forEach((n, i) => tone(v, type, midi(n) * P, 0, t + i * dt, dur, peak, 0.003)); }

  const SFX = Object.create(null);
  const def = (name, p, fn, crush) => { SFX[name] = { p, fn, crush: !!crush }; };

  // --- typing and shots (cheap: one source + gain) ---
  def('key', 0, (v, t, P) => { v.out.gain.value = v.vol * 0.34; buf(v, pick(E.keys), t, P * rnd(0.93, 1.08), 1); });
  def('shot_fork', 0, (v, t, P) => { const o = tone(v, 'triangle', 1250 * P, 0, t, 0.06, 0.16); o.frequency.setValueAtTime(1650 * P, t + 0.022); });
  def('shot_overflow', 0, (v, t, P) => { tone(v, 'sawtooth', 320 * P, 1900 * P, t, 0.07, 0.14); });
  def('shot_worm', 0, (v, t, P) => {
    const o = tone(v, 'triangle', 700 * P, 0, t, 0.09, 0.16), f = o.frequency;
    f.linearRampToValueAtTime(980 * P, t + 0.025); f.linearRampToValueAtTime(560 * P, t + 0.05); f.linearRampToValueAtTime(860 * P, t + 0.075); f.linearRampToValueAtTime(620 * P, t + 0.09);
  });
  def('shot_rootkit', 0, (v, t, P) => { tone(v, 'square', 240 * P, 95 * P, t, 0.07, 0.12); });
  def('shot_logic', 0, (v, t, P) => { const o = tone(v, 'sine', 990 * P, 0, t, 0.075, 0.16); o.frequency.setValueAtTime(660 * P, t + 0.035); });

  // --- impacts ---
  def('hit', 0, (v, t, P) => { tone(v, 'sine', 1900 * P, 1300 * P, t, 0.03, 0.08); });
  def('crit', 1, (v, t, P) => { tone(v, 'square', 2600 * P, 1900 * P, t, 0.045, 0.05); tone(v, 'sine', 4200 * P, 3800 * P, t, 0.07, 0.09); });
  def('shield', 0, (v, t, P) => { tone(v, 'sine', 3150 * P, 0, t, 0.12, 0.06); tone(v, 'sine', 4890 * P, 0, t, 0.07, 0.03); wet(v, 0.25); });
  def('shield_break', 2, (v, t, P) => {
    noise(v, t, 0.28, 0.2, 'highpass', 2500, 6000, 0.7);
    for (let i = 0; i < 4; i++) tone(v, 'sine', rnd(3000, 6500) * P, 0, t + rnd(0, 0.08), 0.06, 0.035);
    const o = tone(v, 'square', 1600 * P, 0, t + 0.04, 0.32, 0.05);
    stepF(o.frequency, t + 0.04, [1600, 1200, 900, 700, 520, 390, 290, 220].map((x) => x * P), 0.035);
    wet(v, 0.3);
  });
  def('kill', 1, (v, t, P) => {
    const o = tone(v, 'square', 880 * P, 0, t, 0.13, 0.15);
    stepF(o.frequency, t, [880, 660, 500, 370, 280, 200].map((x) => x * P), 0.021);
    noise(v, t, 0.04, 0.05, 'bandpass', 3000, 0, 1);
  }, true);
  def('kill_elite', 2, (v, t, P) => {
    const seq = [1200, 1000, 820, 680, 560, 460, 380, 310, 250, 200, 160, 125];
    const o = tone(v, 'square', seq[0] * P, 0, t, 0.34, 0.11); stepF(o.frequency, t, seq.map((x) => x * P), 0.026);
    const o2 = tone(v, 'sawtooth', seq[0] * P / 2, 0, t, 0.34, 0.07); stepF(o2.frequency, t, seq.map((x) => x * P / 2), 0.026);
    noise(v, t, 0.22, 0.13, 'lowpass', 3000, 300, 0.7);
    wet(v, 0.25);
  }, true);
  def('explode', 2, (v, t, P) => {
    noise(v, t, 0.6, 0.35, 'lowpass', 2600 * P, 140, 0.8);
    tone(v, 'sine', 150 * P, 38 * P, t, 0.4, 0.5);
    tone(v, 'square', 90 * P, 40 * P, t, 0.2, 0.08);
    wet(v, 0.35);
  }, true);

  // --- the player ---
  def('hurt', 2, (v, t, P) => {
    const lp = filter(v, 'lowpass', 1400, 1);
    tone(v, 'sawtooth', 92 * P, 70 * P, t, 0.22, 0.24, 0.002, lp);
    tone(v, 'square', 97 * P, 66 * P, t, 0.22, 0.13, 0.002, lp);
    noise(v, t, 0.08, 0.1, 'bandpass', 1800, 600, 1.5);
    const g = v.out.gain, a = v.vol;
    pts(g, [[t, a, 's'], [t + 0.035, a * 0.12, 's'], [t + 0.055, a, 's'], [t + 0.09, a * 0.2, 's'], [t + 0.11, a, 's'], [t + 0.15, a * 0.3, 's'], [t + 0.165, a * 0.8, 's']]);
  }, true);
  def('phase', 1, (v, t, P) => {
    noise(v, t, 0.2, 0.45, 'bandpass', 500 * P, 5200 * P, 2.2, 0.03);
    const o = tone(v, 'square', 400 * P, 0, t, 0.09, 0.05);
    stepF(o.frequency, t, [rnd(300, 600), rnd(900, 1600), rnd(200, 500), rnd(1500, 2600)].map((x) => x * P), 0.02);
    wet(v, 0.15);
  });
  def('packet_drop', 0, (v, t, P) => {
    shaped(v, 'square', [[t, 380 * P], [t + 0.06, 3400 * P, 'e']], [[t, 0.0001], [t + 0.058, 0.08, 'e'], [t + 0.064, 0, 'l']]);
  });
  def('focus_on', 2, (v, t, P) => {
    tone(v, 'sine', 190 * P, 36 * P, t, 0.75, 0.38, 0.015);
    const lp = filter(v, 'lowpass', 700, 4); lp.frequency.setValueAtTime(700, t); lp.frequency.exponentialRampToValueAtTime(90, t + 0.6);
    tone(v, 'sawtooth', 95 * P, 32 * P, t, 0.7, 0.22, 0.01, lp);
    noise(v, t, 0.3, 0.06, 'lowpass', 1800, 200, 0.7, 0.01);
    wet(v, 0.45);
  });
  def('focus_off', 1, (v, t, P) => {
    tone(v, 'sine', 45 * P, 210 * P, t, 0.42, 0.32, 0.06);
    const lp = filter(v, 'lowpass', 120, 4); lp.frequency.setValueAtTime(120, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 0.38);
    tone(v, 'sawtooth', 50 * P, 160 * P, t, 0.4, 0.12, 0.08, lp);
    wet(v, 0.3);
  });
  def('focus_ready', 1, (v, t, P) => { tone(v, 'sine', 1568 * P, 0, t, 0.5, 0.06, 0.004); tone(v, 'sine', 2349 * P, 0, t + 0.06, 0.55, 0.045, 0.004); wet(v, 0.35); });

  // --- enemies ---
  def('enemy_shot', 0, (v, t, P) => { tone(v, 'square', 430 * P, 150 * P, t, 0.09, 0.09); });
  def('tell', 1, (v, t, P) => { shaped(v, 'sawtooth', [[t, 260 * P], [t + 0.26, 1100 * P, 'l']], [[t, 0.008], [t + 0.24, 0.09, 'l'], [t + 0.27, 0, 'l']]); });
  def('dash', 1, (v, t, P) => { noise(v, t, 0.2, 0.15, 'bandpass', 900 * P, 280 * P, 1.5, 0.01); tone(v, 'sawtooth', 150 * P, 65 * P, t, 0.16, 0.07); });
  def('teleport', 1, (v, t, P) => {
    const o = tone(v, 'sine', 1900 * P, 0, t, 0.16, 0.1);
    o.frequency.exponentialRampToValueAtTime(160 * P, t + 0.06); o.frequency.exponentialRampToValueAtTime(2600 * P, t + 0.15);
    noise(v, t, 0.1, 0.05, 'highpass', 4000, 0, 0.7);
    wet(v, 0.3);
  });
  def('spawn', 1, (v, t, P) => {
    const { o } = shaped(v, 'square', [[t, 200 * P]], [[t, 0.0001], [t + 0.24, 0.07, 'e'], [t + 0.3, 0, 'l']]);
    stepF(o.frequency, t, Array.from({ length: 16 }, (_, i) => rnd(150, 400) * (1 + i * 0.25) * P), 0.018);
    noise(v, t + 0.2, 0.1, 0.08, 'highpass', 3000, 0, 0.7);
  }, true);
  def('glitch', 1, (v, t, P) => {
    const o = tone(v, 'square', 600 * P, 0, t, 0.16, 0.08);
    stepF(o.frequency, t, Array.from({ length: 11 }, () => rnd(120, 3200) * P), 0.014);
    noise(v, t, 0.14, 0.09, 'bandpass', rnd(800, 3000), 0, 2);
    const g = v.out.gain, list = [[t, v.vol, 's']];
    for (let x = t + 0.02; x < t + 0.16; x += rnd(0.012, 0.03)) list.push([x, Math.random() < 0.4 ? 0 : v.vol, 's']);
    pts(g, list);
  }, true);

  // --- doors, loot, crafting ---
  def('door_seal', 1, (v, t, P) => {
    tone(v, 'sine', 115 * P, 42 * P, t, 0.32, 0.22, 0.003);
    const lp = filter(v, 'lowpass', 420, 2);
    tone(v, 'sawtooth', 56 * P, 50 * P, t, 0.4, 0.2, 0.005, lp);
    tone(v, 'square', 112 * P, 0, t, 0.25, 0.05, 0.005, lp);
    noise(v, t, 0.025, 0.15, 'highpass', 2500, 0, 0.7);
    wet(v, 0.2);
  });
  def('door_open', 2, (v, t, P) => {
    [76, 80, 83].forEach((n, i) => { const f = midi(n) * P, ti = t + i * 0.1; tone(v, 'sine', f, 0, ti, 0.55, 0.15, 0.004); tone(v, 'triangle', f * 2, 0, ti, 0.25, 0.04, 0.004); });
    wet(v, 0.35);
  });
  def('pickup_orb', 1, (v, t, P) => { tone(v, 'sine', 520 * P, 1040 * P, t, 0.3, 0.11, 0.03); tone(v, 'sine', 780 * P, 1560 * P, t + 0.03, 0.3, 0.055, 0.03); wet(v, 0.3); });
  def('pickup_0', 1, (v, t, P) => { tone(v, 'triangle', 1046 * P, 0, t, 0.08, 0.08); });
  def('pickup_1', 1, (v, t, P) => { arp(v, [81, 88], t, 0.06, 'triangle', 0.14, 0.075, P); });
  def('pickup_2', 1, (v, t, P) => { arp(v, [76, 83, 88], t, 0.055, 'triangle', 0.22, 0.09, P); arp(v, [76, 83, 88], t, 0.055, 'square', 0.08, 0.02, P); wet(v, 0.2); });
  def('pickup_3', 2, (v, t, P) => {
    arp(v, [76, 81, 85, 88], t, 0.06, 'triangle', 0.5, 0.07, P);
    tone(v, 'sine', midi(52) * P, 0, t, 0.7, 0.1, 0.08);
    wet(v, 0.4);
  });
  def('pickup_4', 2, (v, t, P) => {
    // Zero-Day: a shimmering arpeggio over a choir-ish "ah" pad (detuned saws through vowel formants)
    arp(v, [69, 72, 76, 81, 83, 84, 88, 93], t, 0.05, 'triangle', 0.6, 0.05, P);
    const c = E.ctx, f1 = filter(v, 'bandpass', 700, 4), f2 = filter(v, 'bandpass', 1150, 5), pg = c.createGain();
    pts(pg.gain, [[t, 0], [t + 0.35, 0.22, 'l'], [t + 0.9, 0.22, 's'], [t + 2.4, 0.0001, 'e']]);
    pg.connect(f1); pg.connect(f2); v.nodes.push(pg);
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 5; lg.gain.value = 12; lfo.connect(lg); v.nodes.push(lg);
    [57, 64, 72].forEach((n) => [-10, 10].forEach((d) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n) * P; o.detune.value = d; lg.connect(o.detune); o.connect(pg); src(v, o, t, t + 2.45);
    }));
    src(v, lfo, t, t + 2.45);
    wet(v, 0.6);
  });
  def('scrap', 1, (v, t, P) => { noise(v, t, 0.05, 0.3, 'bandpass', 1400 * P, 600 * P, 1.2); tone(v, 'square', 2637 * P, 0, t + 0.03, 0.06, 0.1); tone(v, 'square', 3951 * P, 0, t + 0.07, 0.12, 0.08); }, true);
  def('equip', 1, (v, t, P) => {
    noise(v, t, 0.008, 0.25, 'highpass', 3000, 0, 0.7); tone(v, 'sine', 1900 * P, 1200 * P, t, 0.02, 0.07);
    noise(v, t + 0.07, 0.012, 0.22, 'bandpass', 1400, 0, 1.5); tone(v, 'sine', 280 * P, 170 * P, t + 0.07, 0.07, 0.14);
  });
  def('decrypt_tick', 0, (v, t, P) => { tone(v, 'sine', 1000 * P, 1500 * P, t, 0.055, 0.08); tone(v, 'square', 2000 * P, 3000 * P, t, 0.03, 0.015); });
  def('decrypt_done', 2, (v, t, P) => {
    arp(v, [76, 79, 83, 88, 91], t, 0.045, 'triangle', 0.35, 0.1, P);
    tone(v, 'sine', midi(88) * P, 0, t + 0.25, 0.8, 0.09, 0.004); tone(v, 'sine', midi(95) * P, 0, t + 0.25, 0.6, 0.04, 0.004);
    wet(v, 0.4);
  });

  // --- the apartment, the phone, the door ---
  def('phone_ring', 2, (v, t, P) => {
    // two bell gongs struck alternately by a clapper at 20 Hz
    const c = E.ctx, dur = 1.0, per = 0.05;
    const gs = [1180, 1440].map((f) => {
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.connect(v.out); v.nodes.push(g);
      const o1 = c.createOscillator(); o1.frequency.value = f * P; o1.connect(g); src(v, o1, t, t + dur + 0.6);
      const o2 = c.createOscillator(), g2 = c.createGain(); o2.frequency.value = f * 2.71 * P; g2.gain.value = 0.35; o2.connect(g2); g2.connect(g); v.nodes.push(g2); src(v, o2, t, t + dur + 0.6);
      return g;
    });
    for (let k = 0; k * per < dur; k++) { const g = gs[k % 2], ts = t + k * per; g.gain.setValueAtTime(0.13, ts); g.gain.setTargetAtTime(0.02, ts + 0.002, 0.035); }
    gs.forEach((g) => g.gain.setTargetAtTime(0, t + dur + 0.01, 0.1));
    wet(v, 0.2);
  });
  def('phone_pickup', 2, (v, t, P) => {
    noise(v, t, 0.03, 0.35, 'lowpass', 1800, 0, 0.7); tone(v, 'sine', 170 * P, 90 * P, t, 0.07, 0.3);
    noise(v, t + 0.05, 0.012, 0.15, 'highpass', 2500, 0, 0.7);
    const n = noiseRaw(v, t + 0.06, t + 0.8, 'bandpass', 1100, 0.6), g = n.g.gain;
    const list = [[t + 0.06, 0], [t + 0.12, 0.035, 'l']];
    const spikes = Array.from({ length: 6 }, () => rnd(0.13, 0.65)).sort((a, b) => a - b);
    spikes.forEach((x) => { list.push([t + x, 0.11, 's']); list.push([t + x + 0.006, 0.035, 's']); });
    list.push([t + 0.75, 0, 'l']); pts(g, list);
    shaped(v, 'square', [[t + 0.06, 120]], [[t + 0.06, 0], [t + 0.15, 0.006, 'l'], [t + 0.7, 0.006, 's'], [t + 0.78, 0, 'l']], n.f);
  });
  def('knock', 2, (v, t, P) => {
    // two knuckle raps on a wooden door, ~0.24 s apart, in a hallway
    v.out.gain.value = v.vol * 0.8;
    const lp = filter(v, 'lowpass', 2600, 0.7);
    buf(v, E.knocks[0], t, P, 1, lp);
    buf(v, E.knocks[1], t + 0.24, P * 0.98, 0.82, lp);
    wet(v, 0.32);
  });
  def('door_creak', 2, (v, t, P) => {
    noise(v, t, 0.01, 0.25, 'highpass', 2500, 0, 0.7); tone(v, 'square', 950 * P, 700 * P, t, 0.015, 0.04);
    noise(v, t + 0.03, 0.03, 0.12, 'lowpass', 900, 0, 0.7);
    // the hinge: an irregular stick-slip buzz rung through two narrow wood resonances
    const c = E.ctx, t0 = t + 0.15, t1 = t + 1.35, o = c.createOscillator(), gc = c.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(32 * P, t0);
    const gl = [[t0, 0]];
    for (let x = t0 + 0.07; x < t1 - 0.05; x += rnd(0.05, 0.11)) { o.frequency.linearRampToValueAtTime(rnd(26, 80) * P * (1 + (x - t0) * 0.35), x); gl.push([x, rnd(0.4, 1.5), 'l']); }
    gl.push([t1, 0, 'l']); pts(gc.gain, gl);
    const b1 = filter(v, 'bandpass', 820 * P, 9), b2 = filter(v, 'bandpass', 1700 * P, 12);
    b1.frequency.linearRampToValueAtTime(980 * P, t1);
    o.connect(gc); gc.connect(b1); gc.connect(b2); v.nodes.push(gc); src(v, o, t0, t1 + 0.02);
    noise(v, t0, 1.1, 0.04, 'lowpass', 500, 250, 0.7, 0.4);
    wet(v, 0.3);
  });
  def('boot', 1, (v, t, P) => {
    tone(v, 'sine', 90 * P, 40 * P, t, 0.18, 0.35); noise(v, t, 0.02, 0.15, 'lowpass', 2000, 0, 0.7);
    const lp = filter(v, 'lowpass', 260, 1);
    shaped(v, 'sawtooth', [[t, 60 * P]], [[t, 0], [t + 0.4, 0.14, 'l'], [t + 1.1, 0.14, 's'], [t + 1.6, 0, 'l']], lp);
    shaped(v, 'sine', [[t + 0.05, 180 * P], [t + 0.95, 900 * P, 'e']], [[t + 0.05, 0], [t + 0.6, 0.035, 'l'], [t + 1.2, 0, 'l']]);
    shaped(v, 'sine', [[t + 0.15, 15700]], [[t + 0.15, 0], [t + 0.3, 0.008, 'l'], [t + 1.4, 0.008, 's'], [t + 1.6, 0, 'l']]);
  });

  // --- UI ---
  def('ui_tap', 0, (v, t, P) => { tone(v, 'sine', 1500 * P, 1300 * P, t, 0.035, 0.09); });
  def('ui_back', 0, (v, t, P) => { tone(v, 'triangle', 950 * P, 600 * P, t, 0.07, 0.09); });
  def('ui_buy', 1, (v, t, P) => { arp(v, [76, 83, 88], t, 0.06, 'triangle', 0.18, 0.1, P); tone(v, 'sine', 2640 * P, 0, t + 0.18, 0.25, 0.04); wet(v, 0.25); });
  def('ui_deny', 1, (v, t, P) => { const lp = filter(v, 'lowpass', 900, 1); tone(v, 'square', 150 * P, 0, t, 0.08, 0.1, 0.003, lp); tone(v, 'square', 140 * P, 0, t + 0.11, 0.1, 0.1, 0.003, lp); });

  // --- the Agent, the storm, endings ---
  def('boss_voice', 2, (v, t, P) => {
    // a deep, muffled, speech-like murmur: a glottal saw through two moving vowel formants
    const c = E.ctx, dur = 0.8, o = c.createOscillator(), b1 = c.createBiquadFilter(), b2 = c.createBiquadFilter(), g1 = c.createGain(), g2 = c.createGain(), lp = c.createBiquadFilter(), sg = c.createGain();
    o.type = 'sawtooth';
    pts(o.frequency, [[t, 70 * P], [t + 0.2, 80 * P, 'l'], [t + 0.5, 66 * P, 'l'], [t + dur, 55 * P, 'l']]);
    b1.type = b2.type = 'bandpass'; b1.Q.value = 5; b2.Q.value = 6; g1.gain.value = 1.6; g2.gain.value = 0.9;
    lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.7;
    o.connect(b1); o.connect(b2); b1.connect(g1); b2.connect(g2); g1.connect(lp); g2.connect(lp); lp.connect(sg); sg.connect(v.out);
    v.nodes.push(b1, b2, g1, g2, lp, sg);
    const VOW = [[700, 1100], [450, 800], [325, 700], [400, 1500], [600, 1000]];
    sg.gain.setValueAtTime(0, t);
    let x = t;
    while (x < t + dur - 0.08) {
      const d = rnd(0.1, 0.18), [F1, F2] = pick(VOW), pk = rnd(0.6, 1);
      b1.frequency.setTargetAtTime(F1 * 0.85, x, 0.02); b2.frequency.setTargetAtTime(F2 * 0.85, x, 0.02);
      sg.gain.setTargetAtTime(pk, x, 0.015); sg.gain.setTargetAtTime(0.12, x + d * 0.7, 0.03);
      x += d;
    }
    sg.gain.setTargetAtTime(0, x, 0.04);
    src(v, o, t, t + dur + 0.25);
    wet(v, 0.3);
  });
  def('storm_warn', 2, (v, t, P) => {
    noise(v, t, 1.3, 0.2, 'highpass', 2500, 6000, 0.8, 0.7);
    noise(v, t, 1.2, 0.1, 'bandpass', 600, 3000, 3, 0.5);
    const lp = filter(v, 'lowpass', 700, 1);
    tone(v, 'sawtooth', 220 * P, 200 * P, t, 0.18, 0.1, 0.01, lp); tone(v, 'sawtooth', 220 * P, 200 * P, t + 0.3, 0.18, 0.1, 0.01, lp);
    wet(v, 0.3);
  });
  // the Harvester: the wall shaking before it breaks, and its laser
  def('rumble', 2, (v, t, P) => {
    noise(v, t, 1.8, 0.45, 'lowpass', 110 * P, 420 * P, 1, 1.3);
    tone(v, 'sawtooth', 38 * P, 52 * P, t, 1.8, 0.14, 1.3, filter(v, 'lowpass', 220, 1));
    wet(v, 0.3);
  }, true);
  def('laser', 2, (v, t, P) => {
    const lp = filter(v, 'lowpass', 2400, 2);
    tone(v, 'sawtooth', 880 * P, 110 * P, t, 0.55, 0.12, 0.005, lp);
    tone(v, 'square', 1320 * P, 165 * P, t, 0.5, 0.05, 0.005, lp);
    noise(v, t, 0.55, 0.18, 'bandpass', 3000 * P, 800 * P, 2);
    wet(v, 0.3);
  });
  def('victory', 2, (v, t, P) => {
    // a C major swell that resolves onto E major, the filter opening, then bells
    const c = E.ctx, T = t + 0.75, end = t + 4.2, lp = filter(v, 'lowpass', 300, 1.5), pg = c.createGain();
    pts(lp.frequency, [[t, 300], [t + 0.7, 1200, 'e'], [t + 1.6, 4200, 'e']]); lp.frequency.setTargetAtTime(1500, t + 2.2, 0.8);
    pts(pg.gain, [[t, 0], [t + 0.6, 0.05, 'l'], [T + 0.3, 0.075, 'l'], [t + 2.4, 0.075, 's'], [end, 0.0001, 'e']]);
    pg.connect(lp); v.nodes.push(pg);
    const A = [36, 48, 55, 60, 64], B = [40, 47, 56, 59, 64];
    A.forEach((n, i) => [-7, 7].forEach((d) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = d;
      o.frequency.setValueAtTime(midi(n) * P, t); o.frequency.setValueAtTime(midi(n) * P, T); o.frequency.exponentialRampToValueAtTime(midi(B[i]) * P, T + 0.12);
      o.connect(pg); src(v, o, t, end + 0.05);
    }));
    arp(v, [76, 80, 83, 88, 92, 95], T + 0.1, 0.09, 'sine', 0.9, 0.045, P);
    wet(v, 0.55);
  });
  def('death', 2, (v, t, P) => {
    const lp = filter(v, 'lowpass', 3000, 1); lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(200, t + 1.4);
    shaped(v, 'square', [[t, 900 * P], [t + 1.4, 45 * P, 'e']], [[t, 0], [t + 0.01, 0.14, 'l'], [t + 1.5, 0.0001, 'e']], lp);
    const n = noiseRaw(v, t, t + 1.85, 'bandpass', 2200, 0.8), list = [[t, 0.18]];
    for (let x = t + 0.03; x < t + 1.75; x += rnd(0.03, 0.06)) list.push([x, Math.random() < 0.35 ? 0 : 0.18 * (1 - (x - t) / 1.8), 's']);
    list.push([t + 1.8, 0, 's']); pts(n.g.gain, list);
    noise(v, t + 1.5, 0.01, 0.2, 'highpass', 3000, 0, 0.7);
    wet(v, 0.25);
  }, true);

  // heartbeat: "lub-dub" straight onto the sfx bus (not counted as voices)
  function beat(e, t) {
    const c = e.ctx, nodes = [], srcs = [];
    const thump = (t0, k) => {
      [['sine', 62, 40, 0.16, 0.55], ['triangle', 124, 70, 0.1, 0.14]].forEach(([type, f0, f1, d, pk]) => {
        const o = c.createOscillator(), g = c.createGain(); o.type = type;
        o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + d);
        const end = env(g.gain, t0, 0.008, pk * k, d); o.connect(g); g.connect(e.sfxIn); o.start(t0); o.stop(end + 0.02); srcs.push(o); nodes.push(g);
      });
    };
    thump(t, 1); thump(t + 0.2, 0.65);
    group(e, srcs, nodes);
  }

  // ======================= MUSIC =======================
  function group(e, srcs, nodes) {
    let left = srcs.length;
    const done = () => {
      if (--left > 0) return;
      for (const s of srcs) { if (s._dt && e.detune) { try { e.detune.disconnect(s.detune); } catch (err) { /* ignore */ } } unplug(s); }
      for (const n of nodes) unplug(n);
    };
    for (const s of srcs) s.onended = done;
  }
  function mOsc(e, type, f, det) {
    const o = e.ctx.createOscillator(); o.type = type; o.frequency.value = f; if (det) o.detune.value = det;
    if (e.detune) { e.detune.connect(o.detune); o._dt = 1; }
    return o;
  }
  function mEnv(param, t, a, peak, hd, rel) {
    param.setValueAtTime(0, t); param.linearRampToValueAtTime(peak, t + a);
    if (hd > 0) param.setValueAtTime(peak, t + a + hd);
    param.exponentialRampToValueAtTime(0.0001, t + a + hd + rel); return t + a + hd + rel;
  }
  const QUAL = { 0: 'm', 1: 'M', 3: 'M', 5: 'm', 7: 'm', 8: 'M', 10: 'M' };
  const chord = (root, off) => (QUAL[off] === 'M' ? [0, 4, 7] : [0, 3, 7]).map((x) => root + off + x);

  function pnode(p, n) { p.nodes.push(n); return n; }
  function pgain(p, v, to) { const g = pnode(p, p.e.ctx.createGain()); g.gain.value = v; tag(g.gain, p.e.ctx); if (to) g.connect(to); return g; }
  function pfilter(p, type, f, Q, to) { const n = pnode(p, p.e.ctx.createBiquadFilter()); n.type = type; n.frequency.value = f; n.Q.value = Q; if (to) n.connect(to); return n; }
  function hatBus(p, tens) {
    const k = tens ? 'hatT' : 'hat';
    if (!p[k]) p[k] = pfilter(p, 'highpass', 7000, 0.7, tens ? p.tens : p.out);
    return p[k];
  }
  function arpBus(p) {
    if (p.arpIn) return p.arpIn;
    const c = p.e.ctx, sd = 60 / p.song.bpm / 4;
    p.arpIn = pgain(p, 1, p.out);
    const dl = pnode(p, c.createDelay(1.5)); dl.delayTime.value = Math.min(1.4, sd * 3);
    const dlp = pfilter(p, 'lowpass', 1800, 0.7), fb = pgain(p, 0.33), wg = pgain(p, 0.45, p.out);
    p.arpIn.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(wg);
    return p.arpIn;
  }
  function distBus(p) {
    if (p.distIn) return p.distIn;
    const c = p.e.ctx;
    p.distIn = pgain(p, 5);
    const sh = pnode(p, c.createWaveShaper()); sh.curve = p.e.distCurve;
    p.dlp = pfilter(p, 'lowpass', 1200, 3); tag(p.dlp.frequency, c);
    const post = pgain(p, 0.22, p.out);
    p.distIn.connect(sh); sh.connect(p.dlp); p.dlp.connect(post);
    return p.distIn;
  }

  function bassNote(p, f, t, len, peak) {
    const e = p.e, c = e.ctx, o = mOsc(e, 'sawtooth', f), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 5; lp.frequency.setValueAtTime(Math.min(f * 10, 1600), t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 60), t + len);
    const end = mEnv(g.gain, t, 0.004, peak, 0, len);
    o.connect(lp); lp.connect(g); g.connect(p.out); o.start(t); o.stop(end + 0.02); group(e, [o], [lp, g]);
  }
  function bossBass(p, f, t, len, peak) {
    const e = p.e, c = e.ctx, o = mOsc(e, 'sawtooth', f), g = c.createGain();
    const end = mEnv(g.gain, t, 0.003, peak, 0, len);
    o.connect(g); g.connect(distBus(p)); o.start(t); o.stop(end + 0.02); group(e, [o], [g]);
  }
  function hat(p, t, peak, tens) {
    const e = p.e, c = e.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = e.noise; const end = mEnv(g.gain, t, 0.001, peak, 0, 0.035);
    s.connect(g); g.connect(hatBus(p, tens)); s.start(t, Math.random() * 1.8); s.stop(end + 0.01); group(e, [s], [g]);
  }
  function pluck(p, f, t, peak) {
    const e = p.e, c = e.ctx, o = mOsc(e, 'square', f), lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
    const end = mEnv(g.gain, t, 0.003, peak, 0, 0.28);
    o.connect(lp); lp.connect(g); g.connect(arpBus(p)); o.start(t); o.stop(end + 0.02); group(e, [o], [lp, g]);
  }
  function bleep(p, f, t, peak, type) {
    const e = p.e, c = e.ctx, o = mOsc(e, type || 'sine', f), g = c.createGain();
    const end = mEnv(g.gain, t, 0.004, peak, 0, 0.14);
    o.connect(g); g.connect(arpBus(p)); o.start(t); o.stop(end + 0.02); group(e, [o], [g]);
  }
  function pad(p, notes, t, len, peak, o) {
    o = o || {};
    const e = p.e, c = e.ctx, lp = c.createBiquadFilter(), pg = c.createGain(), srcs = [];
    lp.type = 'lowpass'; lp.frequency.value = o.lp || 900; lp.Q.value = 0.7;
    const a = o.a || 1.2, r = o.r || 2, end = mEnv(pg.gain, t, a, peak, Math.max(0, len - a), r);
    lp.connect(pg); pg.connect(o.dest || p.out);
    for (const n of notes) for (const d of [-9, 9]) { const s = mOsc(e, o.type || 'sawtooth', midi(n), d); s.connect(lp); s.start(t); s.stop(end + 0.05); srcs.push(s); }
    group(e, srcs, [lp, pg]);
  }
  function sine(p, f, t, len, peak, a, r) {
    const e = p.e, c = e.ctx, o = mOsc(e, 'sine', f), g = c.createGain();
    const end = mEnv(g.gain, t, a, peak, Math.max(0, len - a), r);
    o.connect(g); g.connect(p.out); o.start(t); o.stop(end + 0.02); group(e, [o], [g]);
  }
  function kick(p, t, peak, dest) {
    const e = p.e, c = e.ctx, o = c.createOscillator(), g = c.createGain(), o2 = c.createOscillator(), g2 = c.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
    const end = mEnv(g.gain, t, 0.002, peak, 0, 0.3);
    o2.type = 'triangle'; o2.frequency.setValueAtTime(340, t); o2.frequency.exponentialRampToValueAtTime(90, t + 0.03);
    const end2 = mEnv(g2.gain, t, 0.001, peak * 0.3, 0, 0.035);
    const to = dest || p.tens;
    o.connect(g); g.connect(to); o2.connect(g2); g2.connect(to);
    o.start(t); o.stop(end + 0.02); o2.start(t); o2.stop(end2 + 0.02); group(e, [o, o2], [g, g2]);
  }
  function noiseHit(p, t, peak, type, f, Q, rel, dest, multi) {
    const e = p.e, c = e.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = e.noise; fl.type = type; fl.frequency.value = f; fl.Q.value = Q;
    let end;
    if (multi) {
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(peak, t + i * 0.011); g.gain.setValueAtTime(peak * 0.25, t + i * 0.011 + 0.007); }
      g.gain.setValueAtTime(peak, t + 0.033); end = t + 0.033 + rel; g.gain.exponentialRampToValueAtTime(0.0001, end);
    } else end = mEnv(g.gain, t, 0.001, peak, 0, rel);
    s.connect(fl); fl.connect(g); g.connect(dest || p.out); s.start(t, Math.random() * 1.7); s.stop(end + 0.02); group(e, [s], [fl, g]);
  }
  const clap = (p, t, peak) => noiseHit(p, t, peak, 'bandpass', 1300, 1.1, 0.13, p.tens, true);
  const rim = (p, t, peak) => noiseHit(p, t, peak, 'bandpass', 2300, 5, 0.04, p.out);
  function zap(p, t, peak) {
    const e = p.e, c = e.ctx, o = c.createOscillator(), g = c.createGain();
    o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    const end = mEnv(g.gain, t, 0.002, peak, 0, 0.08); o.connect(g); g.connect(p.out); o.start(t); o.stop(end + 0.02); group(e, [o], [g]);
  }
  function riser(p, t, len, peak) {
    const e = p.e, c = e.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = e.noise; s.loop = true; fl.type = 'bandpass'; fl.Q.value = 2;
    fl.frequency.setValueAtTime(800, t); fl.frequency.exponentialRampToValueAtTime(8000, t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.05);
    s.connect(fl); fl.connect(g); g.connect(p.tens); s.start(t); s.stop(t + len + 0.08); group(e, [s], [fl, g]);
  }
  const tensOn = (p) => st.tension > 0.001 || p.e.ctx.currentTime < p.e.tensOff;

  // --- songs: tick(p, step, time, stepDur) is called on every 16th note ---
  const FLOOR_KEY = [40, 41, 38, 43];                          // E, F, D, G minor
  const FLOOR_PROG = [[0, 0, 8, 10], [0, 8, 5, 7], [0, 10, 8, 7], [0, 3, 10, 8]];
  function motif(n) { const dens = n >= 4 ? 0.45 : 0.35, span = n >= 3 ? 6 : 4; return Array.from({ length: 16 }, (_, i) => (i === 0 || Math.random() < dens ? (Math.random() * span) | 0 : null)); }
  function floorSong(n) {
    return {
      bpm: 110,
      tick(p, s, t, sd) {
        const root = FLOOR_KEY[n - 1], bar = Math.floor(s / 16), k = s % 16, off = FLOOR_PROG[n - 1][Math.floor(bar / 2) % 4], ch = chord(root, off);
        // pulsing bass in eighths, an octave lift at the end of every other bar
        if (k % 2 === 0) bassNote(p, midi(root + off + (k === 14 && bar % 2 === 1 ? 12 : 0)), t, sd * 1.6, k % 4 === 0 ? 0.22 : 0.15);
        if (n >= 3 && (k === 7 || k === 15) && Math.random() < 0.5) bassNote(p, midi(root + off + 12), t, sd * 0.8, 0.06);
        // hats on the off-beats, ghost 16ths from floor 2
        if (k % 4 === 2) hat(p, t, 0.065); else if (n >= 2 && k % 2 === 1 && Math.random() < 0.3) hat(p, t, 0.018);
        if (n >= 2) {
          if (k === 0 && bar % 8 === 0 && (!p.data.motif || Math.random() < 0.5)) p.data.motif = motif(n);
          const m = p.data.motif && p.data.motif[k];
          if (m != null) pluck(p, midi(ch[m % 3] + 12 * (2 + Math.floor(m / 3))), t, 0.05);
        }
        if (n >= 3 && k === 0 && bar % 2 === 0) pad(p, ch.map((x) => x + 12), t, sd * 30, 0.018, { a: 1.5, r: 2, lp: 850 });
        if (n >= 4) { if (k === 3 || k === 6 || k === 11 || k === 14) rim(p, t, k === 14 ? 0.3 : 0.2); if (k === 13 && bar % 2 === 1) zap(p, t, 0.06); }
        if (tensOn(p)) {
          if (k % 4 === 0) kick(p, t, 0.45);
          if (k === 4 || k === 12) clap(p, t, 0.16);
          if (n >= 3 && k % 2 === 1) hat(p, t, 0.02, true);
          if (bar % 8 === 7 && k === 0) riser(p, t, sd * 16, 0.03);
        }
      },
    };
  }
  const SONGS = {
    title: {
      bpm: 70,
      tick(p, s, t, sd) {
        const root = 45, bar = Math.floor(s / 16), k = s % 16, off = [0, 8, 3, 10][Math.floor(bar / 2) % 4], ch = chord(root, off);
        if (k === 0 && bar % 2 === 0) { pad(p, ch.map((x) => x + 12), t, sd * 26, 0.02, { a: 2.5, r: 3.5, lp: 750 }); sine(p, midi(root + off - 12), t, sd * 28, 0.07, 2, 3); }
        if (k % 2 === 0 && Math.random() < 0.12) bleep(p, midi(root + 36 + pick([0, 3, 5, 7, 10, 12])), t, 0.03);
        if (k === 10 && Math.random() < 0.1) for (let i = 0; i < 3; i++) bleep(p, midi(root + 48 + pick([0, 3, 7, 12])), t + i * sd * 0.33, 0.012, 'square');
      },
    },
    hub: {
      bpm: 60,
      tick(p, s, t, sd) {
        if (s % 32 !== 0) return;
        // 10 s segments overlapping by 2 s: mains hum, the far-off city, now and then a siren or a car
        const e = p.e, c = e.ctx, len = sd * 40, fade = 2, srcs = [], nodes = [];
        const seg = (g, lvl) => { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lvl, t + fade); g.gain.setValueAtTime(lvl, t + len - fade); g.gain.linearRampToValueAtTime(0, t + len); };
        const h = mOsc(e, 'sine', 60), hg = c.createGain();
        if (e.humWave) h.setPeriodicWave(e.humWave);
        seg(hg, 0.035); h.connect(hg); hg.connect(p.out); srcs.push(h); nodes.push(hg);
        const city = c.createBufferSource(), clp = c.createBiquadFilter(), cg = c.createGain();
        city.buffer = e.brown; city.loop = true; clp.type = 'lowpass'; clp.frequency.value = 320; clp.Q.value = 0.5;
        seg(cg, 0.07); city.connect(clp); clp.connect(cg); cg.connect(p.out); srcs.push(city); nodes.push(clp, cg);
        const r = Math.random();
        if (r < 0.12) {
          const o = mOsc(e, 'sine', 700), og = c.createGain(), t0 = t + rnd(2, 4);
          for (let x = t0; x < t0 + 4; x += 0.6) o.frequency.linearRampToValueAtTime(x % 1.2 < 0.6 ? 950 : 700, x);
          og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(0.005, t0 + 1.5); og.gain.linearRampToValueAtTime(0, t0 + 4);
          o.connect(og); og.connect(p.out); o.start(t0); o.stop(t0 + 4.05); srcs.push(o); nodes.push(og);
        } else if (r < 0.3) {
          const n = c.createBufferSource(), bp = c.createBiquadFilter(), ng = c.createGain(), t0 = t + rnd(2, 5);
          n.buffer = e.noise; n.loop = true; bp.type = 'bandpass'; bp.Q.value = 1; bp.frequency.setValueAtTime(520, t0); bp.frequency.linearRampToValueAtTime(330, t0 + 3);
          ng.gain.setValueAtTime(0, t0); ng.gain.linearRampToValueAtTime(0.025, t0 + 1.6); ng.gain.linearRampToValueAtTime(0, t0 + 3);
          n.connect(bp); bp.connect(ng); ng.connect(p.out); n.start(t0); n.stop(t0 + 3.05); srcs.push(n); nodes.push(bp, ng);
        }
        h.start(t); h.stop(t + len + 0.05); city.start(t, Math.random() * 3); city.stop(t + len + 0.05);
        group(e, srcs, nodes);
      },
    },
    boss: {
      bpm: 128,
      tick(p, s, t, sd) {
        const root = 37, bar = Math.floor(s / 16), k = s % 16, off = [0, 1, 0, 10][Math.floor(bar / 2) % 4], ch = chord(root, off);
        distBus(p);
        if (k === 0 && bar % 2 === 0) { p.dlp.frequency.setValueAtTime(600, t); p.dlp.frequency.linearRampToValueAtTime(2400, t + sd * 31); }
        bossBass(p, midi(root + off + (k === 3 || k === 11 ? 12 : k === 14 ? 7 : 0)), t, sd * 0.85, k % 4 === 0 ? 0.14 : 0.09);
        if (k % 4 === 0) kick(p, t, 0.5, p.out);
        if (k % 4 === 2) hat(p, t, 0.05); else hat(p, t, 0.014);
        if ('x.xx.xx.x.xx.xxx'[k] === 'x') pluck(p, midi(ch[k % 3] + 24 + (k >= 8 ? 12 : 0)), t, 0.03);
        if ((k === 0 && bar % 2 === 0) || (k === 10 && bar % 2 === 1)) pad(p, ch.map((x) => x + 12), t, sd * 2, 0.03, { a: 0.01, r: 0.4, lp: 1600 });
        if (tensOn(p)) {
          if (k === 4 || k === 12) clap(p, t, 0.17);
          if (k % 2 === 1) hat(p, t, 0.02, true);
          if (bar % 8 === 7 && k === 0) riser(p, t, sd * 16, 0.04);
        }
      },
    },
    victory: {
      bpm: 60,
      tick(p, s, t, sd) {
        const CH = [[48, 52, 55, 59], [50, 54, 57], [52, 56, 59], [52, 56, 59, 66]];
        const bar = Math.floor(s / 16), k = s % 16, ci = bar % 4, ch = CH[ci];
        if (k === 0) { pad(p, ch.map((x) => x + 12), t, sd * 14, 0.018, { a: 1.2, r: 2.5, lp: 1300 }); sine(p, midi(ch[0] - 12), t, sd * 14, 0.07, 1, 2.5); }
        if (ci >= 2 && k % 3 === 0 && k < 15) bleep(p, midi(ch[(k / 3) % ch.length] + 24), t, 0.025);
      },
    },
  };
  for (let n = 1; n <= 4; n++) SONGS['floor' + n] = floorSong(n);

  function startPlayer(e, mode, fade) {
    const song = SONGS[mode]; if (!song) return null;
    const c = e.ctx, t = c.currentTime;
    const p = { e, mode, song, nodes: [], data: {}, step: 0, next: t + 0.06, dying: false, endAt: 0 };
    p.out = c.createGain(); tag(p.out.gain, c); p.out.connect(e.musicIn);
    p.tens = c.createGain(); tag(p.tens.gain, c); p.tens.gain.value = st.tension; p.tens.connect(p.out);
    if (fade > 0) { p.out.gain.setValueAtTime(0, t); p.out.gain.linearRampToValueAtTime(1, t + fade); } else p.out.gain.value = 1;
    e.players.push(p);
    return p;
  }
  function stopPlayers(e, fade) {
    const t = e.ctx.currentTime;
    for (const p of e.players) if (!p.dying) { p.dying = true; p.endAt = t + fade + 0.1; try { ramp(p.out.gain, 0, fade); } catch (err) { /* ignore */ } }
  }
  function schedule(e, horizon) {
    const now = e.ctx.currentTime;
    for (const p of e.players.slice()) {
      if (p.dying && now > p.endAt) {
        unplug(p.out); unplug(p.tens); for (const n of p.nodes) unplug(n);
        e.players.splice(e.players.indexOf(p), 1); continue;
      }
      const sd = 60 / p.song.bpm / 4;
      if (!e.offline && p.next < now - 0.1) p.next = now + 0.05; // the timer fell behind: skip, don't burst
      while (p.next < horizon && (!p.dying || p.next < p.endAt)) {
        if (e.offline || st.music > 0) { try { p.song.tick(p, p.step, p.next, sd); } catch (err) { /* keep going */ } }
        p.next += sd; p.step++;
      }
    }
  }
  function heartTick(e, now) {
    if (!st.heart) return;
    if (e.hbNext < now - 0.1) e.hbNext = now + 0.05;
    while (e.hbNext < now + LOOKAHEAD) { if (st.sfx > 0) { try { beat(e, e.hbNext); } catch (err) { /* ignore */ } } e.hbNext += 0.95; }
  }
  function tick() {
    try {
      const e = live; if (!e || e.ctx.state !== 'running') return;
      const now = e.ctx.currentTime;
      schedule(e, now + LOOKAHEAD); heartTick(e, now);
    } catch (err) { /* never throw from the timer */ }
  }

  // ---- offline rendering (test hooks) ----
  const OFF_T = 0.3; // offline renders start late: Chrome's compressor needs ~0.3 s to settle
  function analyse(b) {
    let peak = 0, sum = 0, n = 0, bad = false;
    for (let ch = 0; ch < b.numberOfChannels; ch++) { const d = b.getChannelData(ch); for (let i = Math.floor(OFF_T * b.sampleRate); i < d.length; i++) { const x = d[i]; if (!isFinite(x)) bad = true; const a = Math.abs(x); if (a > peak) peak = a; sum += x * x; n++; } }
    return { peak, rms: Math.sqrt(sum / Math.max(1, n)), finite: !bad };
  }
  function offlineCtx(secs) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    return new OAC(2, Math.ceil(44100 * secs), 44100);
  }
  function renderSfx(name, opts, secs) {
    const def = SFX[name]; if (!def) return Promise.resolve(null);
    const off = offlineCtx(OFF_T + (secs || 2)), saved = E;
    try { E = build(off); E.offline = true; opts = opts || {}; fire(def, num(opts.pitch, 1), num(opts.vol, 1), num(opts.pan, 0), OFF_T); } finally { E = saved; }
    return off.startRendering().then(analyse);
  }
  function renderMusic(mode, secs, tension, bullet) {
    secs = secs || 6;
    const off = offlineCtx(OFF_T + secs), saved = E, sT = st.tension, sB = st.bullet;
    try {
      st.tension = num(tension, 0); st.bullet = !!bullet;
      const e = build(off); e.offline = true; E = e;
      const p = startPlayer(e, mode, 0); if (p) { p.next = OFF_T; schedule(e, OFF_T + secs); }
    } finally { E = saved; st.tension = sT; st.bullet = sB; }
    return off.startRendering().then(analyse);
  }

  // ======================= public API =======================
  const api = {
    unlock() {
      try {
        if (!AC) return;
        try { if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (err) { /* ignore */ }
        if (!live) {
          let ctx;
          try { ctx = new AC({ latencyHint: 'interactive' }); } catch (err) { ctx = new AC(); }
          live = E = build(ctx);
          ctx.onstatechange = () => { if (ctx.state === 'running') st.unlocked = true; };
          if (st.mode !== 'none') startPlayer(live, st.mode, 1.0);
          if (st.heart) live.hbNext = ctx.currentTime + 0.05;
          timer = setInterval(tick, TICK_MS);
        }
        st.hidden = false;
        const ctx = live.ctx;
        if (ctx.state !== 'running') {
          // iOS also wants a sound started inside the gesture
          try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.onended = () => unplug(s); s.start(0); } catch (err) { /* ignore */ }
          const pr = ctx.resume();
          if (pr && pr.then) pr.then(() => { if (ctx.state === 'running') st.unlocked = true; }, () => {});
        } else st.unlocked = true;
      } catch (err) { /* never throw */ }
    },

    setVolumes(music, sfx) {
      try {
        st.music = clamp(num(music, st.music), 0, 1); st.sfx = clamp(num(sfx, st.sfx), 0, 1);
        if (!live) return;
        ramp(live.musicVol.gain, st.music * MUSIC_TRIM, 0.15);
        ramp(live.sfxVol.gain, st.sfx * SFX_TRIM, 0.15); ramp(live.sfxWetVol.gain, st.sfx * SFX_TRIM, 0.15);
      } catch (err) { /* ignore */ }
    },

    setHidden(hidden) {
      try {
        st.hidden = !!hidden;
        if (!live) return;
        if (st.hidden) quiet(live.ctx.suspend());
        else if (st.unlocked) quiet(live.ctx.resume());
      } catch (err) { /* ignore */ }
    },

    play(name, opts) {
      try {
        if (!live || !st.unlocked || st.sfx <= 0 || live.ctx.state !== 'running') return;
        const def = SFX[name]; if (!def) return;
        const ms = nowMs();
        if (lastPlay[name] !== undefined && ms - lastPlay[name] < RATE_MS) { stats.limited++; return; }
        E = live;
        if (!admit(def.p, def.cost || 8)) { stats.dropped++; return; }
        lastPlay[name] = ms;
        opts = opts || {};
        fire(def, clamp(num(opts.pitch, 1), 0.25, 4), clamp(num(opts.vol, 1), 0, 2), clamp(num(opts.pan, 0), -1, 1), live.ctx.currentTime + 0.005);
      } catch (err) { /* ignore */ }
    },

    music(mode) {
      try {
        if (MODES.indexOf(mode) < 0 || mode === st.mode) return;
        st.mode = mode;
        if (!live) return;
        stopPlayers(live, 1.0);
        if (mode !== 'none') startPlayer(live, mode, 1.0);
      } catch (err) { /* ignore */ }
    },

    setBulletTime(on) {
      try { st.bullet = !!on; if (live) applyBullet(live, st.bullet, false); } catch (err) { /* ignore */ }
    },

    setTension(x) {
      try {
        st.tension = clamp(num(x, 0), 0, 1);
        if (!live) return;
        if (st.tension === 0) live.tensOff = live.ctx.currentTime + 2.5;
        for (const p of live.players) if (!p.dying) glide(p.tens.gain, st.tension, 0.35);
      } catch (err) { /* ignore */ }
    },

    heartbeat(on) {
      try {
        const was = st.heart; st.heart = !!on;
        if (live && st.heart && !was) live.hbNext = live.ctx.currentTime + 0.05;
      } catch (err) { /* ignore */ }
    },

    get unlocked() { return !!(live && st.unlocked); },

    // diagnostics for the headless tests (not used by the game)
    _debug: {
      names: () => Object.keys(SFX),
      stats: () => ({
        voices: live ? live.voices.length : 0, nodes: live ? live.nodes : 0, players: live ? live.players.length : 0,
        state: live ? live.ctx.state : 'none', mode: st.mode, maxVoices: MAX_VOICES, maxNodes: MAX_NODES, ...stats,
      }),
      renderSfx, renderMusic,
    },
  };
  return api;
})();
