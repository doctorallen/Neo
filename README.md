# NEO

> Wake up, Neo…

A five-minute, twin-stick, portrait pixel-art roguelite for the phone browser. You wake at your desk at 3:14 in the morning. The monitor types to you. There's a knock at the door, and nobody is there. You walk out into a dungeon of code that builds itself as you go, and there's no way back.

Every fight is a hack. Processes guard each room; you terminate them with exploits that fire glyphs of code. Loot drops as in Diablo: five rarities, random affixes and Zero-Day uniques. Between floors you install patches, and between runs you upgrade your kernel at the desk terminal.

**Play:** https://doctorallen.github.io/Neo/ (best on a phone held upright; add it to your home screen to play full screen).

## How to play

| | Phone | Keyboard |
|---|---|---|
| Move | Left thumb: drag on the left of the bottom deck | WASD |
| Hack (attack) | Right thumb: hold on the right of the deck to fire at the nearest process; drag to aim (aim assist picks the process nearest your aim) | Arrows, or hold the mouse on the room |
| Phase (dash, dodges through packets) | Flick your thumb, or tap PHASE | Space |
| Bullet Time | FOCUS, once its ring is full | Shift / E |
| Pause | II | Esc / P |

- **The run:** four sectors and the core, each a handful of rooms. Doors seal while processes are alive (FIREWALL) and open when the room is clear (ACCESS GRANTED).
- **Caches:** stand in the ring to decrypt one, then choose one of the items inside.
- **Loot:** walk over loot once the room is clear to compare it with what you're wearing, then EQUIP or SCRAP it for Data. Commons are auto-scrapped by default (see Settings).
- **Payphones:** the ringing payphone is the exit. Answer it to choose a patch and go deeper.
- **Protocols:** every patch and Zero-Day belongs to one of four protocols: KERNEL, NETWORK, CRYPTO or GHOST. Two different pieces of one give a small bonus; three give its power (Root Shell, Botnet, Zero Trust, Ghost in the Shell). Patch offers lean towards the protocols you run. LOADOUT shows your progress.
- **Backdoors:** sectors 2–4 usually have an optional orange room off a fight. The terminal feed tells you which kind it is before you go in. A *honeypot* is a fight with two elites for an Epic-or-better prize. An *open port* sells a patch for 15% of your max integrity, for the rest of the run.
- **Unstable items:** some Rares and Epics carry a big upside with a real drawback (damage taken, faster enemy packets, a longer phase cooldown or less integrity). If you haven't seen a Rare by the second sector's cache, that cache guarantees one.
- **Hacking:** you fire while moving, at full damage. Holding fire for a moment fires faster ("compiling") until you let go. Left-handed (Settings) swaps the sides.
- **Bullet Time:** slows the world to a quarter of its speed and doubles your fire rate.
- **Phase:** phasing through a red packet deletes it and charges your focus.
- **After a run:** Data is kept when you die. Spend it at the desk terminal (JACK IN) on permanent upgrades and on decompiling new Zero-Days. Beat the Agent to unlock Depth, a deeper and harder layer, and **Countermeasures**: switches that each make runs harder in their own way for more Data.
- **Dying:** the summary's TRACE shows what did most of the damage, a tip about it, and your last hits.
- **Transmissions:** every run, won or lost, leaves a new message waiting on the monitor at the desk. Reread them in RECORDS.
- **Daily Trace:** one seed for everyone each day, with no countermeasures. SHARE RESULT copies (or shares) a short result with a row of squares, one for each sector.

## The game, in files

Plain JavaScript, with no build step and no runtime dependencies. Classic scripts share one global scope and load in order from `index.html` (`util.js` first, `main.js` last). It runs from `file://`, and the font is embedded.

| File | What it does |
|---|---|
| `js/util.js` | DOM shortcut, error capture, seeded RNG (`Rng`, `mulberry32`, `hashInts`), maths, colours, canvas helpers |
| `js/version.js` | The build stamp, written by the pre-commit hook |
| `js/tuning.js` | **Every gameplay number** (floors, player, exploits, enemies, the Agent, loot, economy, upgrades) |
| `js/save.js` | localStorage: settings, meta progress, records, and the floor checkpoint; corrupt saves fall back to defaults |
| `js/font.js` | A 3×5 pixel font for text inside the world |
| `js/sprites.js` | All pixel art, drawn procedurally from string templates at load time |
| `js/audio.js` | All sound and music, synthesised with Web Audio |
| `js/rooms.js` | Room templates (10 tiles wide inside the walls) |
| `js/dungeon.js` | Floor generation: a main path plus side rooms, all from the run seed |
| `js/items.js` | Slots, affixes, rarity, names, Zero-Days, and stats from gear |
| `js/patches.js` | Run perks and the four protocols (bonuses at 2, powers at 3) |
| `js/game.js` | Game state and the run's lifecycle (floors, rooms, checkpoint, end of run) |
| `js/physics.js` | Tile collision, line of sight, the flow field, the camera |
| `js/player.js` | Neo: moving, auto-firing, Phase, Bullet Time, taking hits |
| `js/shots.js` | Glyph shots, enemy packets, hazards |
| `js/enemies.js` | Wave planning, spawning, every process's AI, elites, damage, drops |
| `js/boss.js` | Agents: the mini-boss and the Agent |
| `js/interact.js` | Loot pickup, caches, the Oracle, the payphone, the white rabbit and the black cat |
| `js/hub.js` | The apartment, the cold open and the transmissions |
| `js/fx.js` | Particles, damage numbers, flashes |
| `js/render.js` | Drawing: a 192-px-wide buffer scaled up by whole pixels |
| `js/input.js` | Floating joystick, flick, buttons, keyboard |
| `js/ui.js` | HUD, deck, hints, and every screen and card |
| `js/main.js` | Boot and the fixed-step loop |

## Developing

```sh
python3 -m http.server 8000      # or just open index.html
npm ci                           # test tools only (puppeteer-core)
npm test                         # everything CI runs
git config core.hooksPath .githooks   # once per clone: stamps js/version.js on commit
```

**Tests** (`test/`) run headlessly against the installed Chrome (set `CHROME` if it isn't in the usual place):

- `check.sh`: syntax, the script list, duplicate globals
- `gen.js`: every room template in every orientation and door set, 2,500 floors, and golden hashes. Re-record with `npm run gen:update` after an intended change to generation.
- `loot.js`: 20,000 items, the rarity mix, luck, caps under random builds
- `save.js`: persistence, Continue, corrupt saves, throwing storage
- `smoke.js`: every screen through real touch input on a phone, plus keyboard on a desktop, with screenshots in `test/out/`
- `bot.js`: an autopilot plays whole runs. Invulnerable runs prove the game can be finished; mortal runs, with human-like reaction times, report balance. `node test/bot.js --mortal 20` plays more.

**Deploying:** pushing to `main` runs `.github/workflows/pages.yml`, which checks, tests, and deploys to GitHub Pages only if everything passes.

## Docs

- `docs/VISION.md`: what the game is and why
- `docs/DESIGN.md`: the full spec
- `docs/REVIEWS.md`: the four design reviews and what they changed
- `docs/BALANCE.md`: what the autopilot measured
- `DECISIONS.md`: every decision made without you, for review

Matrix names and lines belong to Warner Bros.; this is a personal fan project. The VT323 font is under the SIL Open Font License (`fonts/OFL.txt`).
