'use strict';
// Loot and stats, without a browser: 20,000 items are well formed, the rarity
// mix matches the weights, luck pushes it rarer, every affix and starting
// Zero-Day can drop (and none before sector 2 has been reached), random
// builds never break a stat cap or produce a non-number, and patch offers
// respect their limits. Protocols count and pay out as described, offers
// lean towards them, Unstable items carry a real drawback, and the
// Backdoor's price and the countermeasures' Data show up in the stats.
const { sandbox } = require('./sandbox');
const { finish } = require('./lib-node');

const N = sandbox(['js/util.js', 'js/tuning.js', 'js/save.js', 'js/rooms.js', 'js/dungeon.js', 'js/items.js', 'js/patches.js', 'js/game.js']);
const { T, Rng, rollItem, rollRarity, computeStats, compareVerdict, estimateDps, AFFIXES, ZERO_DAYS, SLOTS, Save, PATCHES, PATCH, patchOffer, PROTOCOLS, PROTO_IDS, protocolCounts, Game, fmtAffix } = N;
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

// protocols: everything is tagged; pieces count once each; the bonus at 2
// and the power at 3
for (const p of PATCHES) if (!PROTOCOLS[p.proto]) failures.push(`patch ${p.id} has no protocol`);
for (const z of ZERO_DAYS) if (!PROTOCOLS[z.proto]) failures.push(`Zero-Day ${z.id} has no protocol`);
const empty = { exploit: null, coat: null, shades: null, implant: null };
if (protocolCounts(empty, ['sudo', 'sudo', 'sudo']).kernel !== 1) failures.push('stacks of one patch counted as several protocol pieces');
{
  const base = computeStats(empty, ['sudo'], 1), two = computeStats(empty, ['sudo', 'root'], 1), three = computeStats(empty, ['sudo', 'root', 'leak'], 1);
  if (!(two.weapon.dmg > base.weapon.dmg * 1.05)) failures.push('KERNEL 2 gave no damage');
  if (base.powers.rootshell || two.powers.rootshell || !three.powers.rootshell) failures.push('Root Shell not exactly at KERNEL 3');
  const zd = { ...empty, implant: { slot: 'implant', rarity: 4, ilvl: 1, implicit: [], affixes: [], unique: 'cookie' } };
  if (protocolCounts(zd, ['gc', 'firewall']).crypto !== 3 || !computeStats(zd, ['gc', 'firewall'], 1).powers.zerotrust) failures.push("an equipped Zero-Day doesn't count towards its protocol");
  const gh = computeStats(empty, ['hotswap', 'ballet', 'glitchstep'], 1);
  if (!gh.powers.decoy) failures.push('GHOST 3 gave no decoy');
  if (!computeStats(empty, ['multithread', 'daisy', 'echo'], 1).powers.botnet) failures.push('NETWORK 3 gave no Botnet');
}
// offers lean towards the protocols a build runs
{
  const kernelShare = (taken) => { let k = 0, n = 0; for (let i = 0; i < 3000; i++) for (const id of patchOffer(new Rng(50000 + i), taken, 1, 3)) { n++; if (PATCH[id].proto === 'kernel') k++; } return k / n; };
  const plain = kernelShare(['firewall']), leaning = kernelShare(['firewall', 'sudo', 'root']);
  if (!(leaning > plain * 1.15)) failures.push(`offers don't lean towards a protocol: ${plain.toFixed(3)} → ${leaning.toFixed(3)}`);
}
// Unstable items: only Rares and Epics, about the planned share, named, and the drawback bites
{
  const ur = new Rng(4242);
  let rares = 0, unstable = 0;
  for (let i = 0; i < 20000; i++) {
    const it = rollItem(ur, { ilvl: 1 + (i % 5) });
    if (it.unstable && (it.rarity < 2 || it.rarity > 3 || it.unique)) failures.push(`an Unstable ${it.rarity} item`);
    if (it.rarity === 2 || it.rarity === 3) { rares++; if (it.unstable) unstable++; }
    if (it.unstable && !/^Unstable /.test(it.name)) failures.push(`an Unstable item named ${it.name}`);
    if (it.unstable && /undefined|NaN/.test(fmtAffix(it.unstable.down.id, it.unstable.down.v))) failures.push('a drawback that reads badly');
  }
  const share = unstable / rares;
  if (Math.abs(share - T.unstable.chance) > 0.03) failures.push(`Unstable share ${share.toFixed(3)}, wants about ${T.unstable.chance}`);
  const frag = { slot: 'coat', rarity: 2, ilvl: 1, implicit: [], affixes: [], unique: null, unstable: { up: { id: 'dmg', v: 0.35 }, down: { id: 'fragile', v: 0.15 } } };
  const sf = computeStats({ ...empty, coat: frag }, [], 1);
  if (Math.abs(sf.dmgTaken - 0.15) > 1e-9 || !(sf.weapon.dmg > computeStats(empty, [], 1).weapon.dmg)) failures.push('an Unstable item\'s upside or drawback did nothing');
  const bloat = { ...frag, unstable: { up: { id: 'rate', v: 0.35 }, down: { id: 'bloat', v: 20 } } };
  if (computeStats({ ...empty, coat: bloat }, [], 1).maxHp !== T.player.hp - 20) failures.push('bloat did not cut max integrity');
}
// the Backdoor's price and the countermeasures' Data, through the run
{
  Game.run = { hpCut: 0.3, counter: ['strictgc', 'encrypted'], depth: 1 };
  const s = computeStats(empty, [], 1);
  if (s.maxHp !== Math.round(T.player.hp * 0.7)) failures.push(`the Backdoor's cut gave max integrity ${s.maxHp}`);
  if (Math.abs(s.data - 0.4) > 1e-9) failures.push(`countermeasures gave ${s.data} Data, want 0.4`);
  Game.run = null;
}

// each exploit's single-target damage per second at item level 1, for the record
const dps = Object.keys(T.exploits).map((b) => {
  const s = computeStats({ exploit: { base: b, ilvl: 1, rarity: 0, implicit: [], affixes: [], unique: null }, coat: null, shades: null, implant: null }, [], 1);
  return `${b} ${estimateDps(s).toFixed(1)}`;
});
console.log(`loot: ${total} items, rarity mix ${tiers.map((t) => (t / total * 100).toFixed(1) + '%').join(' / ')}; rare+ share at luck 0/0.5/1: ${r0.toFixed(3)}/${r5.toFixed(3)}/${r10.toFixed(3)}`);
console.log(`loot: exploit DPS at ilvl 1: ${dps.join(', ')}`);
finish('loot', failures);
