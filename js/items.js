'use strict';
// ---------------------------------------------------------------------------
// Loot: the four slots, affixes, rarity, names, the Zero-Day uniques, and how
// gear, patches and permanent upgrades add up to the stats the player fights
// with. Items are plain JSON so a checkpoint can store them as they are.
// ---------------------------------------------------------------------------

const SLOTS = ['exploit', 'coat', 'shades', 'implant'];
const SLOT_NAMES = { exploit: 'Exploit', coat: 'Coat', shades: 'Shades', implant: 'Implant' };
const BASE_NAMES = {
  coat: ['Trenchcoat', 'Longcoat', 'Duster', 'Greatcoat'],
  shades: ['Shades', 'Oval Lenses', 'Visor', 'Pince-nez'],
  implant: ['Neural Jack', 'Datachip', 'Spinal Port', 'Wetware Shard'],
};

// value ranges: [low at ilvl 1, high at ilvl 1, low at ilvl 5, high at ilvl 5]
// kind: 'pct' shown as a percentage, 'flat' a number, 'int' a whole +1
const AFFIXES = {
  dmg: { label: 'damage', pre: 'Lethal', suf: 'of Overkill', range: [0.06, 0.10, 0.18, 0.28], kind: 'pct' },
  rate: { label: 'attack speed', pre: 'Rapid', suf: 'of Threads', range: [0.06, 0.10, 0.16, 0.24], kind: 'pct' },
  proj: { label: 'projectile', pre: 'Forked', suf: 'of Multiplicity', range: [1, 1, 1, 1], kind: 'int' },
  pierce: { label: 'pierce', pre: 'Piercing', suf: 'of Penetration', range: [1, 1, 1, 1], kind: 'int' },
  chain: { label: 'chain', pre: 'Chaining', suf: 'of Contagion', range: [1, 1, 1, 1], kind: 'int' },
  crit: { label: 'crit chance', pre: 'Keen', suf: 'of Precision', range: [0.03, 0.05, 0.08, 0.12], kind: 'pct' },
  critdmg: { label: 'crit damage', pre: 'Brutal', suf: 'of the Kill Switch', range: [0.2, 0.4, 0.5, 0.8], kind: 'pct' },
  hp: { label: 'max integrity', pre: 'Hardened', suf: 'of Redundancy', range: [10, 16, 30, 45], kind: 'flat' },
  armor: { label: 'armour', pre: 'Encrypted', suf: 'of the Firewall', range: [0.03, 0.05, 0.08, 0.12], kind: 'pct' },
  speed: { label: 'move speed', pre: 'Swift', suf: 'of Bandwidth', range: [0.05, 0.08, 0.12, 0.16], kind: 'pct' },
  leech: { label: 'leech', pre: 'Leeching', suf: 'of the Parasite', range: [0.01, 0.01, 0.02, 0.03], kind: 'pct' },
  corrupt: { label: 'corrupt', pre: 'Corrupting', suf: 'of Rot', range: [0.2, 0.3, 0.45, 0.6], kind: 'pct' },
  throttle: { label: 'slow chance', pre: 'Throttling', suf: 'of Latency', range: [0.10, 0.15, 0.20, 0.25], kind: 'pct' },
  phasecd: { label: 'phase cooldown', pre: 'Phasing', suf: 'of the Ghost', range: [0.08, 0.12, 0.12, 0.16], kind: 'pct', neg: true },
  focus: { label: 'focus gain', pre: 'Focused', suf: 'of Bullet Time', range: [0.10, 0.15, 0.25, 0.35], kind: 'pct' },
  pickup: { label: 'pickup radius', pre: 'Magnetic', suf: 'of Reach', range: [0.2, 0.3, 0.5, 0.7], kind: 'pct' },
  thorns: { label: 'thorns', pre: 'Spiked', suf: 'of Feedback', range: [10, 15, 30, 45], kind: 'flat' },
  data: { label: 'Data gain', pre: 'Mining', suf: 'of Harvest', range: [0.08, 0.12, 0.18, 0.25], kind: 'pct' },
  luck: { label: 'item rarity', pre: 'Lucky', suf: 'of Fortune', range: [0.05, 0.08, 0.12, 0.18], kind: 'pct' },
};

// Drawbacks, only ever on Unstable items, paired with a strong upside.
const DRAWBACKS = {
  fragile: { label: 'damage taken', kind: 'pct' },
  traced: { label: 'enemy packet speed', kind: 'pct' },
  lag: { label: 'phase cooldown', kind: 'pct' },
  bloat: { label: 'max integrity', kind: 'flat', minus: true },
};
const UNSTABLE = [
  { up: ['dmg', 0.35], down: ['fragile', 0.15] },
  { up: ['rate', 0.35], down: ['bloat', 20] },
  { up: ['crit', 0.15], down: ['lag', 0.30] },
  { up: ['critdmg', 0.8], down: ['traced', 0.15] },
  { up: ['speed', 0.2], down: ['fragile', 0.10] },
];

const AFFIX_WEIGHTS = {
  exploit: { dmg: 10, rate: 10, proj: 2, pierce: 4, chain: 3, crit: 6, critdmg: 6, corrupt: 5, throttle: 4, leech: 3, focus: 3 },
  coat: { hp: 10, armor: 10, speed: 5, thorns: 5, leech: 3, phasecd: 4, pickup: 1, data: 1, luck: 1 },
  shades: { crit: 8, critdmg: 8, focus: 8, dmg: 4, rate: 4, luck: 1.5, data: 1.5, pickup: 1, throttle: 3 },
  implant: { dmg: 3, rate: 3, proj: 1, pierce: 2, chain: 2, crit: 3, critdmg: 3, hp: 3, armor: 3, speed: 3, leech: 3, corrupt: 3, throttle: 3, phasecd: 3, focus: 3, pickup: 1.5, thorns: 3, data: 1.5, luck: 1.5 },
};

// The Zero-Days. `start` ones are in the drop pool from the first run; the
// rest are decompiled at the terminal for `cost` Data, or unlocked by beating
// the Agent.
const ZERO_DAYS = [
  { id: 'onecoat', proto: 'ghost', name: "The One's Coat", slot: 'coat', start: true, power: 'The first lethal hit each floor leaves you at 1 integrity and starts Bullet Time' },
  { id: 'morpheus', proto: 'ghost', name: "Morpheus' Shades", slot: 'shades', start: true, power: 'Bullet Time lasts twice as long' },
  { id: 'spoon', proto: 'network', name: 'There Is No Spoon', slot: 'implant', start: true, power: 'All your shots bend gently towards their target' },
  { id: 'redpill', proto: 'kernel', name: 'Red Pill', slot: 'implant', start: true, power: '+40% damage, −25% max integrity' },
  { id: 'bluepill', proto: 'crypto', name: 'Blue Pill', slot: 'implant', start: true, power: 'Regenerate 1 integrity a second, −15% damage' },
  { id: 'cookie', proto: 'crypto', name: "Oracle's Cookie", slot: 'implant', start: true, power: 'Heal 25% when a room is cleared' },
  { id: 'kernel', proto: 'kernel', name: 'Kernel Panic', slot: 'exploit', base: 'logic', cost: 300, power: 'Each blast sets off 3 smaller blasts (40% damage)' },
  { id: 'loader', proto: 'network', name: 'Construct Loader', slot: 'exploit', base: 'packet', cost: 250, power: 'Every 4th shot is a 5-shot cone' },
  { id: 'trinity', proto: 'ghost', name: "Trinity's Wake", slot: 'implant', cost: 350, power: 'Phasing leaves a trail of glitch that hurts processes' },
  { id: 'keymaker', proto: 'crypto', name: "Keymaker's Ring", slot: 'implant', cost: 400, power: 'Caches offer one more item and decrypt twice as fast' },
  { id: 'coil', proto: 'crypto', name: 'Nebuchadnezzar Coil', slot: 'coat', cost: 450, power: 'Below 30% integrity, an EMP hits everything in the room (once per room)' },
  { id: 'earpiece', proto: 'kernel', name: "Smith's Earpiece", slot: 'shades', cost: 500, power: '+30% crit damage for each elite terminated this run (up to 5)' },
];
const ZD = Object.fromEntries(ZERO_DAYS.map((z) => [z.id, z]));

function zeroDayPool() {
  return ZERO_DAYS.filter((z) => z.start || Save.unlocked('zd_' + z.id)).map((z) => z.id);
}

function exploitPool() {
  return Object.keys(T.exploits).filter((k) => {
    const u = T.exploits[k].unlock;
    return !u || Save.unlocked('ex_' + k);
  });
}

function affixValue(id, ilvl, rng) {
  const a = AFFIXES[id], [l1, h1, l5, h5] = a.range, t = clamp((ilvl - 1) / 4, 0, 1);
  const lo = lerp(l1, l5, t), hi = lerp(h1, h5, t);
  if (a.kind === 'int') return 1;
  const v = rng.f(lo, hi);
  return a.kind === 'flat' ? Math.round(v) : Math.round(v * 100) / 100;
}

// Rarity with luck: each tier's weight × (1 + L)^tier, so luck pushes
// towards the rarest tiers hardest.
function rollRarity(rng, luck, min = 0, allowZeroDay = true) {
  const L = clamp(luck, 0, T.luckCap);
  const list = [];
  for (let t = min; t < 5; t++) {
    if (t === 4 && !allowZeroDay) continue;
    list.push([T.rarity.weights[t] * Math.pow(1 + L, t), t]);
  }
  return rng.weighted(list);
}

let _itemSerial = 1;
// Rolls a whole item. opts: ilvl, luck, min (rarity floor), slot, base
// (exploit type), rarity (forced), zeroDay (forced id).
function rollItem(rng, opts = {}) {
  const ilvl = clamp(opts.ilvl || 1, 1, 5);
  const pool = zeroDayPool();
  const allowZD = opts.allowZeroDay !== false && pool.length > 0 && !!(Save.meta.reached2 || opts.zeroDay);
  let rarity = opts.zeroDay ? 4 : opts.rarity !== undefined ? opts.rarity : rollRarity(rng, opts.luck || 0, opts.min || 0, allowZD);
  let zd = null;
  if (rarity === 4) {
    const fits = pool.filter((id) => !opts.slot || ZD[id].slot === opts.slot);
    zd = opts.zeroDay ? ZD[opts.zeroDay] : fits.length ? ZD[rng.pick(fits)] : null;
    if (!zd) rarity = 3;
  }
  const slot = zd ? zd.slot : opts.slot || rng.weighted([[3, 'exploit'], [2.5, 'coat'], [2, 'shades'], [2, 'implant']]);
  const item = { id: _itemSerial++, slot, rarity, ilvl, base: null, baseName: '', implicit: [], affixes: [], unique: zd ? zd.id : null, name: '' };

  if (slot === 'exploit') {
    const exs = exploitPool();
    item.base = zd && zd.base ? zd.base : opts.base && exs.includes(opts.base) ? opts.base : rng.pick(exs);
    item.baseName = T.exploits[item.base].name;
  } else {
    item.baseName = rng.pick(BASE_NAMES[slot]);
    if (slot === 'coat') item.implicit = [{ id: 'hp', v: 10 + 8 * ilvl }, { id: 'armor', v: (2 + ilvl) / 100 }];
    if (slot === 'shades') item.implicit = [{ id: 'crit', v: (3 + ilvl) / 100 }, { id: 'focus', v: 0.10 }];
    if (slot === 'implant') {
      const ids = Object.keys(AFFIX_WEIGHTS.implant).filter((k) => AFFIXES[k].kind !== 'int');
      const id = rng.pick(ids);
      let v = affixValue(id, ilvl, rng) / 2;
      v = AFFIXES[id].kind === 'flat' ? Math.max(1, Math.round(v)) : Math.max(0.01, Math.round(v * 100) / 100);
      item.implicit = [{ id, v }];
    }
  }

  const n = T.rarity.affixes[rarity];
  const weights = { ...AFFIX_WEIGHTS[slot] };
  for (const imp of item.implicit) delete weights[imp.id];
  for (let i = 0; i < n; i++) {
    const list = Object.entries(weights).map(([k, w]) => [w, k]);
    if (!list.length) break;
    const id = rng.weighted(list);
    delete weights[id];
    item.affixes.push({ id, v: affixValue(id, ilvl, rng) });
  }
  // now and then a Rare or Epic is Unstable: much stronger, with a catch
  if (!zd && (rarity === 2 || rarity === 3) && opts.unstable !== false && rng.chance(T.unstable.chance)) {
    const u = rng.pick(UNSTABLE), k = 1 + T.unstable.ilvlScale * (ilvl - 1);
    const val = (id, v) => ((AFFIXES[id] || DRAWBACKS[id]).kind === 'flat' ? Math.round(v * k) : Math.round(v * k * 100) / 100);
    item.unstable = { up: { id: u.up[0], v: val(u.up[0], u.up[1]) }, down: { id: u.down[0], v: val(u.down[0], u.down[1]) } };
  }
  item.name = itemName(item);
  return item;
}

function itemName(item) {
  if (item.unique) return ZD[item.unique].name;
  if (item.unstable) return 'Unstable ' + itemName({ ...item, unstable: null });
  const a = item.affixes;
  if (!a.length) return item.baseName;
  if (a.length === 1) return item.id % 2 ? `${AFFIXES[a[0].id].pre} ${item.baseName}` : `${item.baseName} ${AFFIXES[a[0].id].suf}`;
  return `${AFFIXES[a[0].id].pre} ${item.baseName} ${AFFIXES[a[1].id].suf}`;
}

function fmtAffix(id, v) {
  const b = DRAWBACKS[id];
  if (b) return b.kind === 'flat' ? `−${v} ${b.label}` : `+${Math.round(v * 100)}% ${b.label}`;
  const a = AFFIXES[id];
  if (a.kind === 'int') return `+${v} ${a.label}`;
  if (a.kind === 'flat') return `+${v} ${a.label}`;
  return `${a.neg ? '−' : '+'}${Math.round(v * 100)}% ${a.label}`;
}

function exploitDamage(base, ilvl) { return T.exploits[base].dmg * (1 + T.ilvlScale * (ilvl - 1)); }

// The starting kit: a Common Packet Gun, or better with Bootstrap.
function starterExploit(rng) {
  const boot = Save.rank('boot');
  return rollItem(rng, { slot: 'exploit', base: 'packet', ilvl: 1, rarity: boot, allowZeroDay: false });
}

// ---------------------------------------------------------------------------
// Stats: everything that changes how Neo fights, summed from gear, patches,
// the permanent upgrades and the depth, then capped.
// ---------------------------------------------------------------------------
function baseStats() {
  return {
    maxHp: T.player.hp, armor: 0, speed: 0, dmg: 0, rate: 0, proj: 0, pierce: 0, chain: 0,
    crit: 0.05, critdmg: 0, leech: 0, corrupt: 0, throttle: 0, phasecd: [], focus: 0, pickup: 0,
    thorns: 0, data: 0, luck: 0, hpMult: 1, dmgTaken: 0, packetSpeed: 0,
    powers: {}, // Zero-Day and patch powers by id
    weapon: null,
  };
}

function addAffix(s, id, v) {
  if (id === 'hp') s.maxHp += v;
  else if (id === 'fragile') s.dmgTaken += v;
  else if (id === 'traced') s.packetSpeed += v;
  else if (id === 'lag') s.phasecd.push(-v);
  else if (id === 'bloat') s.maxHp -= v;
  else if (id === 'phasecd') s.phasecd.push(v);
  else s[id] += v;
}

function computeStats(gear, patches, floorN = 1) {
  const s = baseStats();
  for (const slot of SLOTS) {
    const it = gear[slot];
    if (!it) continue;
    for (const a of it.implicit) addAffix(s, a.id, a.v);
    for (const a of it.affixes) addAffix(s, a.id, a.v);
    if (it.unstable) { addAffix(s, it.unstable.up.id, it.unstable.up.v); addAffix(s, it.unstable.down.id, it.unstable.down.v); }
    if (it.unique) s.powers[it.unique] = true;
  }
  for (const p of patches) applyPatch(s, p);
  applyProtocols(s, protocolCounts(gear, patches));
  // the Oracle's pills
  const pill = Game.run && Game.run.pill;
  if (pill === 'red') { s.dmg += 0.15; s.maxHp -= 15; }
  if (pill === 'blue') s.maxHp += 20;
  // the Backdoor's price
  const cut = (Game.run && Game.run.hpCut) || 0;
  // permanent upgrades and the depth
  s.maxHp += 8 * Save.rank('hp');
  s.dmg += 0.05 * Save.rank('dmg');
  s.rate += 0.05 * Save.rank('rate');
  s.luck += 0.12 * Save.rank('luck');
  s.data += 0.15 * Save.rank('data');
  const depth = (Game.run && Game.run.depth) || 1;
  s.luck += T.depth.luck * (depth - 1);
  s.data += T.depth.data * (depth - 1);
  // countermeasures pay in Data
  for (const id of (Game.run && Game.run.counter) || []) { const c = T.counter.find((x) => x.id === id); if (c) s.data += c.data; }
  // Zero-Day powers that are plain numbers
  if (s.powers.redpill) { s.dmg += 0.4; s.maxHp = Math.round(s.maxHp * 0.75); }
  if (s.powers.bluepill) s.dmg -= 0.15;
  if (cut) s.maxHp = Math.round(s.maxHp * (1 - cut));
  if (s.powers.earpiece) s.critdmg += 0.3 * Math.min(5, (Game.run && Game.run.eliteKills) || 0);
  // caps
  const C = T.caps;
  s.crit = clamp(s.crit, 0, C.crit);
  s.armor = clamp(s.armor, 0, C.armor);
  s.rate = clamp(s.rate, -0.5, C.rate);
  s.speed = clamp(s.speed, -0.5, C.speed);
  s.leech = clamp(s.leech, 0, C.leech);
  s.corrupt = clamp(s.corrupt, 0, C.corrupt);
  s.throttle = clamp(s.throttle, 0, 1);
  s.focus = clamp(s.focus, 0, T.focus.gainCap);
  s.proj = clamp(s.proj, 0, C.proj);
  s.chain = clamp(s.chain, 0, C.chain);
  s.pierce = clamp(s.pierce, 0, C.pierce);
  s.dmg = Math.max(-0.5, s.dmg);
  s.maxHp = Math.max(10, Math.round(s.maxHp));
  // phase cooldown reductions multiply, and never cut more than half
  let keep = 1;
  for (const c of s.phasecd) keep *= 1 - c;
  s.phaseCd = Math.max(T.player.phaseCdMin, T.player.phaseCd * Math.max(1 - T.player.phaseCdMaxCut, keep));
  s.hpMult = T.enemyHp(floorN, depth);
  // the weapon
  const ex = gear.exploit || { base: 'packet', ilvl: 1, unique: null };
  const E = T.exploits[ex.base];
  s.weapon = {
    base: ex.base, pattern: E.pattern, speed: E.speed,
    dmg: exploitDamage(ex.base, ex.ilvl) * (1 + s.dmg),
    rate: E.rate * (1 + s.rate),
    shots: (E.shots || 1), spread: E.spread || 0,
    pierce: Math.min(C.pierce, (E.pierce || 0) + s.pierce), chain: Math.min(C.chain, (E.chain || 0) + s.chain), chainRange: E.chainRange || 60,
    radius: E.radius || 0,
  };
  return s;
}

// A rough damage-per-second for the compare card's verdict line: what this
// exploit would deal to one target with everything else unchanged.
function estimateDps(s) {
  const w = s.weapon;
  let mult = 1 + s.proj * T.extraProjDamage;
  if (w.pattern === 'spread') mult = 1 + 0.5 * (w.shots - 1) * 0.5 + s.proj * T.extraProjDamage * 0.5;
  if (w.pattern === 'lob') mult *= 1;
  const crit = 1 + s.crit * (T.critMult - 1 + s.critdmg);
  return w.dmg * w.rate * mult * crit * (1 + s.corrupt * 0.8);
}

// A one-line verdict comparing a candidate against what's equipped.
function compareVerdict(gear, patches, item, floorN) {
  const now = computeStats(gear, patches, floorN);
  const next = computeStats({ ...gear, [item.slot]: item }, patches, floorN);
  const filled = !!gear[item.slot];
  if (item.slot === 'exploit') {
    const a = estimateDps(now), b = estimateDps(next), d = a > 0 ? (b - a) / a : 1;
    return { text: `DPS ${Math.round(a)} → ${Math.round(b)}`, delta: d, kind: verdictKind(d, filled), parts: [['DPS', a, b]] };
  }
  const ehp = (s) => s.maxHp / (1 - s.armor) / (1 + s.dmgTaken);
  const offence = (s) => estimateDps(s);
  const da = ehp(now), db = ehp(next), oa = offence(now), ob = offence(next);
  const d = ((db - da) / da) * 0.5 + ((ob - oa) / Math.max(1, oa)) * 0.5;
  return { text: `TOUGHNESS ${Math.round(da)} → ${Math.round(db)} · DPS ${Math.round(oa)} → ${Math.round(ob)}`, delta: d, kind: verdictKind(d, filled), parts: [['TOUGHNESS', da, db], ['DPS', oa, ob]] };
}

// Within 3% either way it's a sidegrade: pick on the affixes you like.
function verdictKind(d, filled) {
  if (!filled) return 'new';
  return d >= 0.03 ? 'up' : d <= -0.03 ? 'down' : 'side';
}
