'use strict';
// Loads some of the game's classic scripts into a Node VM context with just
// enough of a browser stubbed in (window, localStorage, a few no-ops) to run
// the pure parts: floor generation, loot, stats. Much faster than Chrome, so
// the tests that sweep hundreds of seeds use it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');

function sandbox(files) {
  const store = new Map();
  const ctx = {
    console, Math, JSON, Date, Map, Set, WeakMap, Uint8Array, Int16Array, Float32Array, Array, Object, Number, String, Boolean, Error, Symbol, Promise,
    performance: { now: () => Date.now() },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() },
    navigator: { userAgent: 'node' },
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    document: { readyState: 'complete', getElementById: () => null, createElement: () => ({ getContext: () => null }), addEventListener() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  // classic scripts share one global scope: concatenate them so top-level
  // const/let declarations are visible to each other, then expose what the
  // tests need
  const src = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');
  const expose = '\n;globalThis.__neo = { T, Rng, hashInts, hashString, mulberry32, generateFloor, floorHash, roomConnected, fillRoomTiles, Room, ROOM_TEMPLATES, ROOM_SIZE, DIRS, OPP, WALL, FLOOR, BLOCK, PIT, DOOR, TILE,'
    + (files.some((f) => f.endsWith('items.js')) ? ' rollItem, rollRarity, computeStats, compareVerdict, estimateDps, AFFIXES, AFFIX_WEIGHTS, ZERO_DAYS, ZD, SLOTS, zeroDayPool, exploitPool, Save, PATCHES, PATCH, patchOffer, fmtAffix, itemName, PROTOCOLS, PROTO_IDS, protocolCounts, UNSTABLE, DRAWBACKS,' : '')
    + (files.some((f) => f.endsWith('game.js')) ? ' Game,' : '')
    + ' };';
  vm.runInContext(src + expose, ctx, { filename: 'neo-sandbox.js' });
  return ctx.__neo;
}

module.exports = { sandbox, ROOT };
