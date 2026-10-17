'use strict';
// Loot and stats, without a browser: 20,000 items are well formed, the rarity
// mix matches the weights, luck pushes it rarer, every affix and starting
// Zero-Day can drop (and none before sector 2 has been reached), random
// builds never break a stat cap or produce a non-number, and patch offers
// respect their limits.
const { sandbox } = require('./sandbox');
const { finish } = require('./lib-node');

const N = sandbox(['js/util.js', 'js/tuning.js', 'js/save.js', 'js/rooms.js', 'js/dungeon.js', 'js/items.js', 'js/patches.js', 'js/game.js']);
const { T, Rng, rollItem, rollRarity, computeStats, compareVerdict, estimateDps, AFFIXES, ZERO_DAYS, SLOTS, Save, PATCHES, PATCH, patchOffer } = N;
const failures = [];
Save.load();
const rng = new Rng(12345);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

// Zero-Days never drop before sector 2 has been reached
for (let i = 0; i < 3000; i++) if (rollItem(rng, { ilvl: 1, luck: 1 }).rarity === 4) { failures.push('a Zero-Day dropped before sector 2 was reached'); break; }
Save.meta.reached2 = true;

const seenAffix = new Set(), seenZD = new Set(), seenBase = new Set();
const tiers = [0, 0, 0, 0, 0];
const total = 20000;
for (let i = 0; i < total; i++) {
  const ilvl = 1 + (i % 5);
  const it = rollItem(rng, { ilvl, luck: 0 });
  tiers[it.rarity]++;
  const where = `item ${i} (${it.name})`;
  if (typeof it.name !== 'string' || !it.name.trim() || /undefined|null|NaN/.test(it.name)) failures.push(`${where}: bad name`);
  if (!SLOTS.includes(it.slot)) failures.push(`${where}: bad slot ${it.slot}`);
  if (it.slot === 'exploit' && !T.exploits[it.base]) failures.push(`${where}: bad exploit base ${it.base}`);
  if (it.slot === 'exploit') seenBase.add(it.base);
  if ((it.unique !== null) !== (it.rarity === 4)) failures.push(`${where}: unique ${it.unique} with rarity ${it.rarity}`);
  if (it.unique) { seenZD.add(it.unique); if (N.ZD[it.unique].slot !== it.slot) failures.push(`${where}: Zero-Day in the wrong slot`); }
  if (it.affixes.length !== T.rarity.affixes[it.rarity]) failures.push(`${where}: ${it.affixes.length} affixes at rarity ${it.rarity}`);
  const ids = it.affixes.map((a) => a.id).concat(it.implicit.map((a) => a.id));
  if (new Set(ids).size !== ids.length) failures.push(`${where}: an affix twice`);
  for (const a of it.affixes.concat(it.implicit)) {
    if (!AFFIXES[a.id]) failures.push(`${where}: unknown affix ${a.id}`);
    else if (!finite(a.v) || a.v <= 0) failures.push(`${where}: affix ${a.id} = ${a.v}`);
    seenAffix.add(a.id);
  }
  if (it.slot === 'implant' && it.implicit.some((a) => AFFIXES[a.id].kind === 'int')) failures.push(`${where}: an implant implicit can't be a whole +1`);
  if (JSON.stringify(JSON.parse(JSON.stringify(it))) !== JSON.stringify(it)) failures.push(`${where}: doesn't survive JSON`);
  if (failures.length > 40) break;
}
// the mix against the weights (Zero-Days only in the start pool here)
const W = T.rarity.weights, sumW = W.reduce((a, b) => a + b, 0);
for (let t = 0; t < 5; t++) {
  const want = W[t] / sumW, got = tiers[t] / total;
  if (Math.abs(got - want) > Math.max(0.01, want * 0.2)) failures.push(`rarity ${t}: ${(got * 100).toFixed(2)}%, expected about ${(want * 100).toFixed(2)}%`);
}
for (const id of Object.keys(AFFIXES)) if (!seenAffix.has(id)) failures.push(`affix ${id} never rolled`);
for (const z of ZERO_DAYS.filter((z) => z.start)) if (!seenZD.has(z.id)) failures.push(`Zero-Day ${z.id} never dropped`);
for (const z of ZERO_DAYS.filter((z) => !z.start)) if (seenZD.has(z.id)) failures.push(`Zero-Day ${z.id} dropped before it was unlocked`);
for (const b of ['packet', 'fork', 'overflow']) if (!seenBase.has(b)) failures.push(`exploit ${b} never dropped`);
for (const b of ['worm', 'rootkit', 'logic']) if (seenBase.has(b)) failures.push(`exploit ${b} dropped while locked`);

// luck pushes the mix rarer, hardest at the top
const rareShare = (luck) => { const r = new Rng(9); let n = 0; for (let i = 0; i < 20000; i++) if (rollRarity(r, luck, 0, true) >= 2) n++; return n / 20000; };
const r0 = rareShare(0), r5 = rareShare(0.5), r10 = rareShare(1);
if (!(r0 < r5 && r5 < r10)) failures.push(`luck doesn't push rarer: ${r0} ${r5} ${r10}`);
const minRolls = new Rng(3);
for (let i = 0; i < 2000; i++) if (rollItem(minRolls, { ilvl: 3, min: 2 }).rarity < 2) { failures.push('a minimum rarity was ignored'); break; }

// random builds: everything finite, every cap held
const C = T.caps;
const brng = new Rng(777);
for (let i = 0; i < 3000; i++) {
  const gear = {};
  for (const slot of SLOTS) gear[slot] = brng.chance(0.85) ? rollItem(brng, { slot, ilvl: brng.i(1, 5), luck: brng.f(0, 1) }) : null;
  const patches = [];
  for (let k = 0; k < 6; k++) { const offer = patchOffer(brng, patches, 4, 3); if (offer.length) patches.push(brng.pick(offer)); }
  const s = computeStats(gear, patches, brng.i(1, 5));
  const bad = [];
  for (const k of ['maxHp', 'armor', 'speed', 'dmg', 'rate', 'proj', 'pierce', 'chain', 'crit', 'critdmg', 'leech', 'corrupt', 'throttle', 'focus', 'pickup', 'thorns', 'data', 'luck', 'phaseCd', 'hpMult']) if (!finite(s[k])) bad.push(k);
  for (const k of ['dmg', 'rate', 'speed', 'pierce', 'chain']) if (!finite(s.weapon[k])) bad.push('weapon.' + k);
  if (bad.length) failures.push(`build ${i}: not numbers: ${bad.join(', ')}`);
  if (s.crit > C.crit + 1e-9 || s.armor > C.armor + 1e-9 || s.rate > C.rate + 1e-9 || s.speed > C.speed + 1e-9 || s.leech > C.leech + 1e-9 || s.proj > C.proj || s.chain > C.chain || s.pierce > C.pierce) failures.push(`build ${i}: a cap broken`);
  if (s.phaseCd < T.player.phaseCdMin - 1e-9) failures.push(`build ${i}: phase cooldown ${s.phaseCd}`);
  if (s.focus > T.focus.gainCap + 1e-9) failures.push(`build ${i}: focus gain ${s.focus}`);
  if (s.maxHp < 10) failures.push(`build ${i}: max integrity ${s.maxHp}`);
  for (const id of Object.keys(PATCH)) if (patches.filter((p) => p === id).length > PATCH[id].max) failures.push(`build ${i}: ${id} taken past its limit`);
  const cand = rollItem(brng, { ilvl: 3 });
  const v = compareVerdict(gear, patches, cand, 3);
  if (!finite(v.delta) || typeof v.text !== 'string') failures.push(`build ${i}: compare verdict ${v.delta}`);
  if (failures.length > 60) break;
}
// patch offers: distinct, and no rare patch before the floor-2 pick
for (let i = 0; i < 500; i++) {
  const o = patchOffer(new Rng(i), [], 1, 3);
  if (new Set(o).size !== o.length) failures.push('a patch offered twice in one pick');
  if (o.some((id) => PATCH[id].rare)) failures.push('a rare patch offered after floor 1');
}

// each exploit's single-target damage per second at item level 1, for the record
const dps = Object.keys(T.exploits).map((b) => {
  const s = computeStats({ exploit: { base: b, ilvl: 1, rarity: 0, implicit: [], affixes: [], unique: null }, coat: null, shades: null, implant: null }, [], 1);
  return `${b} ${estimateDps(s).toFixed(1)}`;
});
console.log(`loot: ${total} items, rarity mix ${tiers.map((t) => (t / total * 100).toFixed(1) + '%').join(' / ')}; rare+ share at luck 0/0.5/1: ${r0.toFixed(3)}/${r5.toFixed(3)}/${r10.toFixed(3)}`);
console.log(`loot: exploit DPS at ilvl 1: ${dps.join(', ')}`);
finish('loot', failures);
