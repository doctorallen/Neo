'use strict';
// ---------------------------------------------------------------------------
// Every gameplay number in one place. Distances are world pixels, times are
// seconds, speeds px/s. docs/DESIGN.md explains the systems and
// docs/REVIEWS.md how these numbers were settled; where they disagree, this
// file is the truth. docs/BALANCE.md records what the autopilot measured.
// ---------------------------------------------------------------------------

const T = {
  // The five floors: how many fights stand between the entry and the exit,
  // how often a fight is in a large room, the optional side rooms, and how
  // many processes may be alive at once in a wave.
  floors: [
    { sector: 'tenement', combat: 1, largeChance: 0, cache: true, oracle: 0.4, rabbit: 0.25, alive: 4 },
    { sector: 'server', combat: 2, largeChance: 0.2, cache: true, oracle: 0.4, rabbit: 0.25, alive: 5 },
    { sector: 'subway', combat: 2, largeChance: 0.3, cache: true, oracle: 0.4, rabbit: 0.25, alive: 6 },
    { sector: 'grid', combat: 2, largeChance: 0.35, cache: true, oracle: 0.4, rabbit: 0.25, alive: 6 },
    { sector: 'core', combat: 0, largeChance: 0, cache: false, oracle: 0, rabbit: 0, alive: 6 },
  ],

  player: {
    hp: 100, speed: 64, radius: 4,
    hurtInvuln: 0.6,
    phaseDist: 52, phaseTime: 0.14, phaseInvuln: 0.30, phaseCd: 1.6, phaseCdMin: 0.8, phaseCdMaxCut: 0.5,
    phaseBulletFocus: 6,
    fireDelay: 0.06, // after the stick is released
    movingDamage: 0.65, // with "fire while moving"
    compileAfter: 1.2, compileRate: 0.25, // standing still this long fires faster
  },

  focus: {
    max: 100,
    perDamage: 1 / 3, // divided by the floor's enemy HP multiplier
    duration: 3, worldScale: 0.25, rampOut: 0.3, fireRate: 2,
    gainCap: 1.0, // +100% from all bonuses at most
  },

  caps: { crit: 0.6, armor: 0.5, rate: 1.5, speed: 0.5, slow: 0.5, leech: 0.05, proj: 3, chain: 4, pierce: 4, corrupt: 0.8 },
  extraProjDamage: 0.6,
  chainDamage: 0.7,
  critMult: 2,

  // The six exploits at item level 1. dmg per shot, rate shots/s, speed of the
  // shot; pattern says how it flies. Damage scales by (1 + ilvlScale·(ilvl−1)).
  ilvlScale: 0.35,
  exploits: {
    packet: { name: 'Packet Gun', dmg: 10, rate: 3.0, speed: 200, pattern: 'single', unlock: null },
    fork: { name: 'Fork Bomb', dmg: 8, rate: 2.0, speed: 170, pattern: 'spread', spread: 10, shots: 3, unlock: null },
    overflow: { name: 'Overflow', dmg: 20, rate: 1.4, speed: 260, pattern: 'pierce', pierce: 2, unlock: null },
    worm: { name: 'Worm.exe', dmg: 11, rate: 2.4, speed: 180, pattern: 'chain', chain: 2, chainRange: 60, unlock: 'floor3' },
    rootkit: { name: 'Rootkit', dmg: 10, rate: 2.6, speed: 150, pattern: 'homing', unlock: 'agent' },
    logic: { name: 'Logic Bomb', dmg: 30, rate: 0.9, speed: 130, pattern: 'lob', radius: 22, unlock: 'win' },
  },

  // Enemy scaling by floor (n from 1) and depth (d from 1).
  enemyHp: (n, d) => (1 + 0.35 * (n - 1)) * (1 + T.depth.hp * (d - 1)),
  enemyDmg: (n, d) => 1.1 * (1 + 0.3 * (n - 1)) * (1 + T.depth.dmg * (d - 1)),

  enemyBullet: { radius: 2, maxAlive: 18, maxAliveBoss: 30 },
  spawnTelegraph: 0.6, spawnGrace: 1.0, spawnMinDist: 56,
  maxRanged: 2,
  budget: (n) => 4 + 3 * n,
  secondWave: 0.4, secondWaveAt: 0.75,

  enemies: {
    bug: { hp: 14, speed: 52, dmg: 8, cost: 1, from: 1, r: 4, ranged: false },
    watchdog: { hp: 30, speed: 40, dmg: 12, cost: 2, from: 1, r: 5, ranged: false, tellRange: 70, tell: 0.55, aimLock: 0.15, dashSpeed: 170, dashTime: 0.35, rest: 0.8 },
    firewall: { hp: 40, speed: 0, dmg: 9, cost: 2, from: 1, r: 6, ranged: true, every: 2.2, tell: 0.4, shots: 3, fan: 20, bullet: 70 },
    sentinel: { hp: 44, speed: 46, dmg: 12, cost: 3, from: 2, r: 6, ranged: false, orbit: 60, every: 3, tell: 0.5, aimLock: 0.1, lungeSpeed: 180, lungeTime: 0.3 },
    worm: { hp: 36, speed: 30, dmg: 10, cost: 3, from: 2, r: 5, ranged: false, splitHp: 14 },
    exile: { hp: 50, speed: 0, dmg: 9, cost: 4, from: 3, r: 5, ranged: true, every: 3, flicker: 0.4, minDist: 72, windup: 0.35, shots: 5, fan: 60, bullet: 60 },
  },
  agent: { hp: 220, speed: 50, dmg: 12, r: 6, burst: 3, burstGap: 0.12, burstEvery: 1.6, burstTell: 0.4, bullet: 95, dodgeCd: 1.2, strafe: 2.0 },
  boss: {
    hp: 2200, speed: 54, dmg: 14, r: 7,
    burst: 3, burstGap: 0.12, burstEvery: 1.4, burstTell: 0.4, bullet: 95, dodgeCd: 0.8,
    chargeEvery: 4, chargeTell: 0.7, chargeSpeed: 220, chargeTime: 0.55,
    phase2: 0.66, phase3: 0.33,
    cloneEvery: 9, clonesMax: 2, cloneHp: 60, cloneBullet: 75,
    ringEvery: 3, ringShots: 10, ringTurn: 18, ringBullet: 50,
    stormEvery: 5, stormWarn: 0.9, stormRain: 0.6, stormCols: 3, stormDmg: 14,
  },

  elite: {
    chance: (n) => 0.12 + 0.06 * n, hp: 3.2, dmg: 1.3,
    mods: ['encrypted', 'overclocked', 'replicating', 'volatile'],
    shield: 0.4, fast: 1.45, copyHp: 0.3, blast: 20, blastR: 28, blastDelay: 0.6,
  },

  failsafe: { idle: 20 },

  // Loot. Rarity tiers 0–4: Common, Uncommon, Rare, Epic, Zero-Day.
  rarity: {
    names: ['Common', 'Uncommon', 'Rare', 'Epic', 'Zero-Day'],
    colors: ['#c8d4c8', '#3cff6e', '#4aa8ff', '#c25aff', '#ffb43a'],
    weights: [60, 28, 9, 2.5, 0.5],
    affixes: [0, 1, 2, 3, 2],
    scrap: [1, 3, 6, 15, 40],
  },
  luckCap: 1.0,
  drops: {
    normal: 0.06, orb: 0.04, eliteOrb: 0.5,
    cacheChoices: 2, rabbitData: 30,
    orbHeal: 0.12, orbHealMin: 15,
    agent3: 2, agent4: 3, agent4ZeroDay: 0.3,
  },

  data: { kill: 1, elite: 5, agent: 25, floor: (n) => 5 * n, boss: 150 },

  // The permanent upgrades at the desk terminal: cost of each rank.
  upgrades: [
    { id: 'hp', name: 'Hardened Kernel', desc: '+8 max integrity', costs: [25, 60, 120, 200, 300] },
    { id: 'dmg', name: 'Optimised Code', desc: '+5% damage', costs: [30, 70, 140, 230, 350] },
    { id: 'rate', name: 'Overclocked Bus', desc: '+5% attack speed', costs: [40, 120, 250] },
    { id: 'luck', name: 'Lucky Packets', desc: '+12% item rarity', costs: [35, 100, 200] },
    { id: 'data', name: 'Data Miner', desc: '+15% Data', costs: [30, 80, 160] },
    { id: 'boot', name: 'Bootstrap', desc: 'Start with an Uncommon, then a Rare, exploit', costs: [100, 280] },
    { id: 'prefocus', name: 'Preloaded Focus', desc: 'Start each floor with 50% focus', costs: [150] },
    { id: 'reroll', name: 'Patch Reroll', desc: 'Reroll the patch choices once per pick', costs: [180] },
    { id: 'revive', name: 'Déjà Vu', desc: 'Once a run, come back at 40% integrity', costs: [500] },
  ],

  // each Depth past the first: processes tougher and harder-hitting, loot rarer, more Data
  depth: { max: 5, hp: 0.4, dmg: 0.25, luck: 0.15, data: 0.2 },
};
