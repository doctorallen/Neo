# Balance, as measured

There's been no human playtest. Every number here comes from the autopilot in `test/botlib.js` playing whole runs headlessly on a 390×844 phone page. **The game is not tuned by feel yet; expect to adjust `js/tuning.js` after you play.**

## The autopilot

- **What it does:**
  - fights by holding the aim stick on the nearest process, and steps to the most open side (still firing) when a process gets within about 30 px
  - phases across packets about to hit it
  - uses Bullet Time in busy fights
  - decrypts every cache, visits side rooms, equips whatever the compare card calls better, and takes the first patch offered
- **The "human" setting** gives it a 0.25 s reaction time to new packets, and it notices only 70% of them. Its aim wobbles up to 25° either side, re-rolled every 0.3 s, so some shots fall outside the 20° aim assist. It still moves with machine precision, never panics, and needs no time to read cards. So it's probably better than a first-time player and worse than a practised one.
- **Run length:** bot times exclude reading cards and menus. A person adds roughly 20–40 s a run (patch picks, compare cards, the apartment).

## Run length

Invulnerable bot, three seeds (seconds of game time per floor, 1/2/3/4/5):

| Seed | Floors | Total |
|---|---|---|
| 3 | 34 / 46 / 84 / 50 / 18 | 231 s |
| 7 | 43 / 50 / 49 / 70 / 26 | 239 s |
| 11 | 54 / 55 / 83 / 44 / 10 | 245 s |

A winning run takes about 3:00–4:45 of game time, or **about 3.5–5 minutes** with menus, inside the 5-minute target. Losing runs end between about 50 s and 5 min.

- **Floor 3** (subway, with the agent guarding the phone) is the longest at 50–95 s.
- **Floor 1** is the shortest at about 30 s.

## Difficulty

"Human" bot, mortal, 12–16 seeds each:

| Setup | Wins | Notes |
|---|---|---|
| Fresh: no upgrades, Depth 1 | 5/12 – 7/16 (≈ 40–45%) | Deaths spread over every floor: firewalls and exiles on floors 1–3, the agent on 3, the code storm on 5 |
| A quarter of the upgrades (≈ 2–3 runs of Data) | 9/12 | |
| Half the upgrades | 12/12 | |
| All upgrades, Depth 3 | 9/12 | |
| All upgrades, Depth 5 | 3/12 | The long-term challenge |

### After the switch to twin-stick (decision 36)

Same 16 seeds, fresh, "human" bot: **9/16 won** (was 7/16 standing still to fire). Winning runs took 3:05–5:40 of game time. God-mode runs: 197 s, 231 s, 217 s. Enemy numbers were left alone, because the bot doesn't pay the cost of steering and aiming with two thumbs.

### After the roguelike enhancements (decisions 40–46)

The autopilot takes every Backdoor (honeypot or open port) and the first patch offered, which now leans towards protocols. 32 seeds, fresh, "human" bot:

| Tuning | Wins | Notes |
|---|---|---|
| Unchanged | 23/32 (72%) | The new rewards add real power: protocol bonuses and powers, Backdoor patches, Epic prizes, Unstable items |
| Enemy damage ×1.25 (was ×1.1) | 23/32 | Only moved deaths earlier (7 of 9 on sector 2), so it was reverted |
| **Kept:** per-sector growth of enemy integrity +45% (was +35%) and damage +40% (was +30%) | **16/32 (50%)** | Deaths spread over all five sectors; winning runs average 4:18 of game time |

The new power mostly pays off in later sectors, so steeper scaling per sector answers it without making sector 1 harder. Depth 3–5 with every upgrade hasn't been re-measured since. **Expect the Backdoor and the protocol powers to need tuning once a person plays:** a person won't take every Backdoor.

## What changed because of these numbers

1. **Fights were too long.**
   - Enemy HP growth went from +40% to +35% a floor, and the room budget from 5+3n to 4+3n.
   - Enemy damage went to 1.1×(1 + 0.3 per floor) to keep the danger.
2. **Depth was too gentle** (Depth 5 with all upgrades won 7/12). Each Depth now adds +40% enemy integrity and +25% damage, instead of +25% and +15%.
3. **Upgrades were steep.**
   - Each rank was trimmed: +8 integrity (was +10), +5% damage and attack speed (was +6%).
   - Bootstrap costs 100/280.
   - Déjà Vu revives at 40% (was 50%).
   - Progress is still quick: a competent player should win within a few runs. Depth is where the challenge lives.

## Exploit damage per second at item level 1 (one target)

| Exploit | DPS |
|---|---|
| Packet Gun | 31.5 |
| Overflow | 29.4 |
| Logic Bomb | 28.4 |
| Worm.exe | 27.7 |
| Rootkit | 27.3 |
| Fork Bomb | 25.2 |

Fork Bomb, Overflow and Worm.exe win against groups (spread, pierce, chain), and Rootkit never misses.

## Loot

20,000 rolls at luck 0:

| Common | Uncommon | Rare | Epic | Zero-Day |
|---|---|---|---|---|
| 59.9% | 27.8% | 9.4% | 2.4% | 0.4% |

Luck at +50% / +100% raises the share of Rare-or-better from 11.8% to 23.3% / 35.7%.

## Rerunning

```sh
node test/bot.js --mortal 20     # god runs plus 20 "human" runs; results in test/out/balance.json
```
