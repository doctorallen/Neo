'use strict';
// ---------------------------------------------------------------------------
// Patches: the run-only perks, one picked from three each time you answer the
// payphone. A run's patches are a list of ids; a stackable patch may appear
// more than once, up to its `max`. Rare patches join the offer from floor 3.
// ---------------------------------------------------------------------------

const PATCHES = [
  { id: 'multithread', name: 'Multithread', desc: '+1 projectile (each extra shot deals 60%)', max: 2, apply: (s) => { s.proj += 1; } },
  { id: 'overclock', name: 'Overclock', desc: '+20% attack speed', max: 3, apply: (s) => { s.rate += 0.2; } },
  { id: 'sudo', name: 'Sudo', desc: '+25% damage', max: 3, apply: (s) => { s.dmg += 0.25; } },
  { id: 'overrun', name: 'Buffer Overrun', desc: 'Shots pierce 1 more process', max: 3, apply: (s) => { s.pierce += 1; } },
  { id: 'daisy', name: 'Daisy Chain', desc: 'Shots chain to 1 more process (70% damage)', max: 3, apply: (s) => { s.chain += 1; } },
  { id: 'root', name: 'Root Access', desc: '+10% crit chance', max: 3, apply: (s) => { s.crit += 0.10; } },
  { id: 'gc', name: 'Garbage Collector', desc: 'Each kill restores 2 integrity', max: 1, apply: (s) => { s.powers.gc = true; } },
  { id: 'hotswap', name: 'Hot Swap', desc: '−25% phase cooldown', max: 1, apply: (s) => { s.phasecd.push(0.25); } },
  { id: 'firewall', name: 'Firewall', desc: '+25 max integrity, and heal to full', max: 3, apply: (s) => { s.maxHp += 25; }, onTake: () => { Game.run.healFull = true; } },
  { id: 'encryption', name: 'Encryption', desc: 'The first hit in each room is ignored', max: 1, apply: (s) => { s.powers.encryption = true; } },
  { id: 'ballet', name: 'Bullet Ballet', desc: '+40% focus gain', max: 1, apply: (s) => { s.focus += 0.4; } },
  { id: 'packetloss', name: 'Packet Loss', desc: 'Processes move 15% slower', max: 1, apply: (s) => { s.powers.packetloss = true; } },
  { id: 'leak', name: 'Memory Leak', desc: 'Hits corrupt for 40% more over 2 s', max: 1, apply: (s) => { s.corrupt += 0.4; } },
  { id: 'echo', name: 'Echo', desc: '20% chance a shot fires twice', max: 1, apply: (s) => { s.powers.echo = true; } },
  { id: 'kill9', name: 'kill -9', desc: '+50% damage to elites and agents', max: 1, apply: (s) => { s.powers.kill9 = true; } },
  { id: 'scavenger', name: 'Scavenger', desc: 'Caches offer 1 more item; +25% Data', max: 1, apply: (s) => { s.powers.scavenger = true; s.data += 0.25; } },
  { id: 'daemon', name: 'Daemon', desc: 'A drone orbits you and fires at processes', max: 1, rare: true, apply: (s) => { s.powers.daemon = true; } },
  { id: 'glitchstep', name: 'Glitch Step', desc: 'Phasing through a process hurts it badly', max: 1, rare: true, apply: (s) => { s.powers.glitchstep = true; } },
  { id: 'okernel', name: 'Overclocked Kernel', desc: '+1 projectile and +15% attack speed', max: 1, rare: true, apply: (s) => { s.proj += 1; s.rate += 0.15; } },
];
const PATCH = Object.fromEntries(PATCHES.map((p) => [p.id, p]));

function applyPatch(s, id) { const p = PATCH[id]; if (p) p.apply(s); }

// Three different patches the run may still take. Rare patches appear only
// from floor 3 on (they're the floor-2 pick and later).
function patchOffer(rng, taken, floorDone, n = 3) {
  const count = (id) => taken.filter((t) => t === id).length;
  const open = PATCHES.filter((p) => count(p.id) < p.max && (!p.rare || floorDone >= 2));
  const list = open.map((p) => [p.rare ? 0.6 : 1, p.id]);
  const out = [];
  while (out.length < n && list.length) {
    const id = rng.weighted(list);
    out.push(id);
    list.splice(list.findIndex((e) => e[1] === id), 1);
  }
  return out;
}
