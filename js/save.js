'use strict';
// ---------------------------------------------------------------------------
// Persistence in localStorage under one key: settings, the permanent progress
// (Data, upgrade ranks, unlocks, Zero-Days found), records, and the run
// checkpoint written at the start of each floor. A missing, corrupt or
// unreadable save falls back to defaults without an error; every field is
// merged over its default, so a save from an older build gains new fields.
// ---------------------------------------------------------------------------

const SAVE_KEY = 'neo.save.v1';

function reducedMotionPreferred() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

function defaultSave() {
  const calm = reducedMotionPreferred();
  return {
    version: 1,
    settings: {
      music: 0.5, sfx: 0.8, haptics: true, shake: !calm, scanlines: true, reducedFlash: calm,
      damageNumbers: true, aimAssist: true, leftHanded: false, flickPhase: true,
      autoScrap: 1, // scrap drops below this rarity on sight: 0 off, 1 Commons, 2 Commons and Uncommons
      fullIntro: false, // play the whole cold open every time, not only the first
    },
    meta: {
      data: 0, upgrades: {}, unlocks: {}, zeroDays: {}, depth: 1, maxDepth: 1, introSeen: false, tutorialDone: false,
      reached2: false, hints: {}, lastWin: false,
      tx: 0, txRead: 0, // transmissions unlocked, and read
      counter: {}, // countermeasures switched on at the terminal
    },
    records: {
      runs: 0, wins: 0, kills: 0, bestTime: 0, deepest: 0, legendaries: 0, bestDepthWin: 0,
      daily: { key: '', best: 0, deepest: 0 },
    },
    checkpoint: null,
  };
}

// Deep-merges plain objects: values from `over` win where they have the same
// kind as the default; anything else keeps the default.
function mergeOver(def, over) {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return def;
  const out = Array.isArray(def) ? def.slice() : { ...def };
  for (const k of Object.keys(over)) {
    const d = def[k], o = over[k];
    if (d === undefined) out[k] = o; // open-ended maps (upgrades, unlocks) and the checkpoint
    else if (d === null) out[k] = o;
    else if (typeof d === 'object' && !Array.isArray(d)) out[k] = mergeOver(d, o);
    else if (typeof o === typeof d && (typeof o !== 'number' || Number.isFinite(o))) out[k] = o;
  }
  return out;
}

const Save = {
  data: defaultSave(),
  ok: true, // false when storage is unavailable (private mode and so on)

  load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { this.ok = false; }
    if (!raw) { this.data = defaultSave(); return; }
    try {
      this.data = mergeOver(defaultSave(), JSON.parse(raw));
      if (this.data.checkpoint && !validCheckpoint(this.data.checkpoint)) this.data.checkpoint = null;
    } catch (e) {
      this.data = defaultSave();
    }
  },

  write() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); this.ok = true; } catch (e) { this.ok = false; }
  },

  reset() {
    const keepSettings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = keepSettings;
    this.write();
  },

  get settings() { return this.data.settings; },
  get meta() { return this.data.meta; },
  rank(id) { return this.data.meta.upgrades[id] || 0; },
  unlocked(id) { return !!this.data.meta.unlocks[id]; },
  unlock(id) { if (!this.data.meta.unlocks[id]) { this.data.meta.unlocks[id] = true; this.write(); return true; } return false; },
};

function validCheckpoint(c) {
  return c && typeof c === 'object' && Number.isFinite(c.seed) && Number.isInteger(c.floor) && c.floor >= 1 && c.floor <= 5 &&
    c.gear && typeof c.gear === 'object' && Array.isArray(c.patches) && Number.isFinite(c.hp);
}
