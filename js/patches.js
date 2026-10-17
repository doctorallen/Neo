'use strict';
// ---------------------------------------------------------------------------
// Patches: the run-only perks, one picked from three each time you answer the
// payphone. A run's patches are a list of ids; a stackable patch may appear
// more than once, up to its `max`. Rare patches join the offer from floor 3.
//
// Every patch and Zero-Day belongs to a protocol. Two different pieces of one
// protocol give a small bonus; three give its power, which changes how a run
// plays. Offers lean towards the protocols you already run.
// ---------------------------------------------------------------------------

const PROTOCOLS = {
  kernel: { name: 'KERNEL', color: '#ff9a3c', two: '+10% damage', power: 'Root Shell', three: 'Critical hits burst, hurting processes around the target for 50%' },
  network: { name: 'NETWORK', color: '#4ad8ff', two: '+10% attack speed', power: 'Botnet', three: 'A terminated process fires a packet at the nearest other one (60% damage)' },
  crypto: { name: 'CRYPTO', color: '#e8e070', two: '+20 max integrity', power: 'Zero Trust', three: 'After 6 s without a hit, a shield forms that blocks the next one' },
  ghost: { name: 'GHOST', color: '#d08cff', two: '−15% phase cooldown', power: 'Ghost in the Shell', three: 'Phasing leaves a decoy that processes shoot at for 1.5 s' },
};
const PROTO_IDS = Object.keys(PROTOCOLS);

// How many different pieces of each protocol a build runs: patches (each id
// once, however many stacks) and equipped Zero-Days.
function protocolCounts(gear, patches) {
  const out = { kernel: 0, network: 0, crypto: 0, ghost: 0 };
  for (const id of new Set(patches)) { const p = PATCH[id]; if (p && p.proto) out[p.proto]++; }
  for (const slot of SLOTS) { const it = gear[slot]; if (it && it.unique && ZD[it.unique] && ZD[it.unique].proto) out[ZD[it.unique].proto]++; }
  return out;
}

// The protocol bonuses, into a stats object (before the caps).
function applyProtocols(s, counts) {
  s.protocols = counts;
  if (counts.kernel >= 2) s.dmg += 0.10;
  if (counts.network >= 2) s.rate += 0.10;
  if (counts.crypto >= 2) s.maxHp += 20;
  if (counts.ghost >= 2) s.phasecd.push(0.15);
  if (counts.kernel >= 3) s.powers.rootshell = true;
  if (counts.network >= 3) s.powers.botnet = true;
  if (counts.crypto >= 3) s.powers.zerotrust = true;
  if (counts.ghost >= 3) s.powers.decoy = true;
}

const PATCHES = [
  { id: 'multithread', proto: 'network', name: 'Multithread', desc: '+1 projectile (each extra shot deals 60%)', max: 2, apply: (s) => { s.proj += 1; } },
  { id: 'overclock', proto: 'kernel', name: 'Overclock', desc: '+20% attack speed', max: 3, apply: (s) => { s.rate += 0.2; } },
  { id: 'sudo', proto: 'kernel', name: 'Sudo', desc: '+25% damage', max: 3, apply: (s) => { s.dmg += 0.25; } },
  { id: 'overrun', proto: 'network', name: 'Buffer Overrun', desc: 'Shots pierce 1 more process', max: 3, apply: (s) => { s.pierce += 1; } },
  { id: 'daisy', proto: 'network', name: 'Daisy Chain', desc: 'Shots chain to 1 more process (70% damage)', max: 3, apply: (s) => { s.chain += 1; } },
  { id: 'root', proto: 'kernel', name: 'Root Access', desc: '+10% crit chance', max: 3, apply: (s) => { s.crit += 0.10; } },
  { id: 'gc', proto: 'crypto', name: 'Garbage Collector', desc: 'Each kill restores 2 integrity', max: 1, apply: (s) => { s.powers.gc = true; } },
  { id: 'hotswap', proto: 'ghost', name: 'Hot Swap', desc: '−25% phase cooldown', max: 1, apply: (s) => { s.phasecd.push(0.25); } },
  { id: 'firewall', proto: 'crypto', name: 'Firewall', desc: '+25 max integrity, and heal to full', max: 3, apply: (s) => { s.maxHp += 25; }, onTake: () => { Game.run.healFull = true; } },
  { id: 'encryption', proto: 'crypto', name: 'Encryption', desc: 'The first hit in each room is ignored', max: 1, apply: (s) => { s.powers.encryption = true; } },
  { id: 'ballet', proto: 'ghost', name: 'Bullet Ballet', desc: '+40% focus gain', max: 1, apply: (s) => { s.focus += 0.4; } },
  { id: 'packetloss', proto: 'ghost', name: 'Packet Loss', desc: 'Processes move 15% slower', max: 1, apply: (s) => { s.powers.packetloss = true; } },
  { id: 'leak', proto: 'kernel', name: 'Memory Leak', desc: 'Hits corrupt for 40% more over 2 s', max: 1, apply: (s) => { s.corrupt += 0.4; } },
  { id: 'echo', proto: 'network', name: 'Echo', desc: '20% chance a shot fires twice', max: 1, apply: (s) => { s.powers.echo = true; } },
  { id: 'kill9', proto: 'kernel', name: 'kill -9', desc: '+50% damage to elites and agents', max: 1, apply: (s) => { s.powers.kill9 = true; } },
  { id: 'scavenger', proto: 'crypto', name: 'Scavenger', desc: 'Caches offer 1 more item; +25% Data', max: 1, apply: (s) => { s.powers.scavenger = true; s.data += 0.25; } },
  { id: 'daemon', proto: 'network', name: 'Daemon', desc: 'A drone orbits you and fires at processes', max: 1, rare: true, apply: (s) => { s.powers.daemon = true; } },
  { id: 'glitchstep', proto: 'ghost', name: 'Glitch Step', desc: 'Phasing through a process hurts it badly', max: 1, rare: true, apply: (s) => { s.powers.glitchstep = true; } },
  { id: 'okernel', proto: 'kernel', name: 'Overclocked Kernel', desc: '+1 projectile and +15% attack speed', max: 1, rare: true, apply: (s) => { s.proj += 1; s.rate += 0.15; } },
];
const PATCH = Object.fromEntries(PATCHES.map((p) => [p.id, p]));

function applyPatch(s, id) { const p = PATCH[id]; if (p) p.apply(s); }

// Three different patches the run may still take. Rare patches appear only
// from floor 3 on (they're the floor-2 pick and later). A patch whose
// protocol the build already runs is likelier, the more so the closer it is
// to its power. `rareBoost` multiplies the weight of rare patches.
function patchOffer(rng, taken, floorDone, n = 3, rareBoost = 1) {
  const count = (id) => taken.filter((t) => t === id).length;
  const open = PATCHES.filter((p) => count(p.id) < p.max && (!p.rare || floorDone >= 2));
  const run = typeof Game !== 'undefined' && Game.run;
  const have = protocolCounts(run ? run.gear : {}, taken);
  const lean = (p) => (count(p.id) === 0 && have[p.proto] > 0 ? 1 + 0.7 * Math.min(2, have[p.proto]) : 1);
  const list = open.map((p) => [(p.rare ? 0.6 * rareBoost : 1) * lean(p), p.id]);
  const out = [];
  while (out.length < n && list.length) {
    const id = rng.weighted(list);
    out.push(id);
    list.splice(list.findIndex((e) => e[1] === id), 1);
  }
  return out;
}
