# NEO — Vision

> *"Have you ever had a dream, Neo, that you were so sure was real?"*

## One line

A five-minute, one-thumb, portrait-mode pixel-art roguelite for the phone browser: you wake at your desk, open the door to nobody, and walk out into a generated digital dungeon where every fight is a hack. Loot drops like Diablo, and every death wakes you at the desk again.

## The original ask, restated

| Ask | How the vision answers it |
|---|---|
| Pixel art, Matrix-inspired dungeon crawler roguelite | Low-res pixel canvas (192 px wide), green-on-black phosphor palette, code-rain, glyph bullets, generated room-based dungeon, permadeath runs |
| Diablo-like random loot | Five rarity tiers, item level by floor, random affixes, legendary uniques, elite packs with modifiers, a side-by-side compare card |
| Roguelite elements | Permadeath runs; perks picked on each floor ("patches"); persistent currency spent on permanent upgrades at the desk terminal; unlocks |
| Plays on a phone in portrait, simple controls | One-thumb floating joystick; you auto-attack the nearest target while standing still (Archero style); two big buttons (Phase dash and Bullet Time) |
| Finish a session in 5 minutes | 4 floors plus a boss floor, about 50 s each; a full winning run takes about 4–5 minutes; dying earlier is shorter |
| Sci-fi / cyberpunk | Dream-version of a hacker's world: server farms, subway, a neon "city grid", sentinels and agents |
| Opens like "Wake up, Neo" | A playable cold open: Neo asleep at a CRT; it types *Wake up, Neo…*, *The Matrix has you…*, *Follow the white rabbit.*, *Knock, knock, Neo.*; there's a knock; you get up and open the door to an empty hallway |
| Walk out into a random dungeon, no going back | Stepping through the door glitches the hallway into floor 1; the door dissolves behind you; floors only go forward (the exit is a ringing payphone) |
| Fighting feels like hacking | Enemies are processes with names (`sentinel.exe`), HP is *integrity*, bullets are code glyphs, kills "terminate" a process into falling code, chests must be *decrypted*, cleared rooms print `ACCESS GRANTED` |
| Neo is still asleep, and the player doesn't know | Never said outright. Hints: the wall clock always reads 3:14; the knock with nobody there; déjà-vu cats; the Oracle's line. Dying or winning both end the same way: Neo jolts awake at the desk and the screen types *Wake up, Neo…* again. The loop itself is the tell |
| JavaScript in the browser; GitHub Pages like merryfolk | Plain JS, no build step, no runtime dependencies, works from `file://`; puppeteer tests; a `pages.yml` that checks, tests, then deploys `main` |

## Pillars

1. **Five minutes, start to finish.** Everything serves a short session: no long menus, no grinding, instant restart. A death costs at most a few minutes.
2. **One thumb.** Every action can be done with the right thumb on the lower half of the screen. The top part shows the room, and the bottom part is where your thumb goes, so your hand never covers the action.
3. **Every fight is a hack.** Combat words, effects and sounds all come from hacking a system, never from swords or guns.
4. **Loot that makes you say "ooh".** Every few rooms something drops that changes how you play: a weapon that splits, chains or pierces, and affixes that stack into a build.
5. **The dream is the twist.** Subtle and never explained. A player who notices feels clever.

## The session

```
Title (code rain)  ─►  The apartment (hub)
                         │  terminal: permanent upgrades
                         │  door: start run
                         ▼
   Floor 1 ─► patch pick ─► Floor 2 ─► … ─► Floor 4 ─► patch pick ─► Floor 5: the Agent
     │ death                                                          │ victory
     ▼                                                                ▼
   "CONNECTION LOST" summary ─► Neo jolts awake at the desk ◄─ "…" summary
```

- **First launch:** the full cold open (about 30 s, skippable after the first time).
- **Later runs:** you wake at the desk in seconds (*Wake up, Neo.*, knock). Walk to the terminal to spend Data, or to the door to dive.

## The dungeon

- **Rooms on a grid,** like Isaac: each floor is a branching map of about 6–8 rooms. Doors seal while hostile processes are alive ("FIREWALL ACTIVE") and open when the room is clear.
- **Room kinds:** the entry room, combat rooms, one **cache** (a loot chest to decrypt), sometimes a **terminal** (an Oracle event: a choice with a cost), sometimes a hidden **white rabbit** room, and the **exit room** with the ringing payphone. Answering the phone takes you to the next floor, with no way back.
- **Floors (sectors)** change the palette, the tiles and the enemy mix:
  1. *Tenement* — the dream-version of Neo's building: corridors and flickering lights
  2. *Server Farm* — racks, cable trays, cold blue-green
  3. *Subway* — tiles, rails, a station that loops
  4. *Grid* — neon city wireframe, cyberpunk magenta accents
  5. *Core* — the boss arena: the Agent
- Everything about a floor comes from the run seed and the floor number, so a run can be resumed and tests can pin generation with golden hashes.

## Combat (the hack)

- **Move** with the floating joystick. **Stand still to execute** your equipped exploit at the nearest process in sight, firing automatically. Moving stops firing, so positioning is the skill. A setting allows firing while moving, at reduced damage.
- **Phase** (dash button): a short glitch-dash with invulnerability frames that leaves afterimages, on a short cooldown.
- **Bullet Time** (focus button): charged by dealing damage; slows the world to 25% for 3 s while you move at full speed. It's the "Matrix moment" and the panic button.
- **Integrity** is your HP. It's restored by green *patch* orbs that drop rarely and by some affixes.
- **Enemies (processes):**
  - `bug` — skittering crawler that swarms
  - `watchdog.d` — dashes at you after a tell
  - `firewall.sys` — stationary turret, fires slow code bursts
  - `sentinel` — floating squid drone, orbits and lunges, and leaves sparks
  - `worm` — splits into two smaller worms when terminated
  - `exile` — teleports and fires a spread
  - `agent` — mini-boss on floors 3–4: dodges your bullets in bullet time
  - **The Agent** — floor 5 boss with three phases: duel, replication (clones), and an arena-wide code storm
- **Elites (Diablo champions):** a gold-named enemy with one or two modifiers: *Encrypted* (absorbs the first hits), *Overclocked* (fast), *Replicating* (splits on death), *Mirrored* (reflects some shots), *Volatile* (explodes on death). Elites drop better loot.
- **Hacking dressing:** glyph projectiles, hit sparks of 0s and 1s, damage numbers, enemy name tags on elites and bosses, kills dissolving into falling code, `ACCESS GRANTED` on clear, screen glitch on hits, and CRT scanlines (a setting).

## Loot

- **Four slots, Neo's kit:**
  - **Exploit** (weapon) — sets the attack pattern: *Packet Gun* (single fast shots), *Fork Bomb* (spread), *Overflow* (piercing beam bolts), *Worm.exe* (chains between targets), *Rootkit* (homing), *Logic Bomb* (slow lobbed area damage)
  - **Coat** (armour) — integrity and damage reduction
  - **Shades** (optics) — crit, range and focus charge
  - **Implant** (trinket) — wild affixes: on-kill effects, orbiting shards and so on
- **Rarity:** Common (white), Uncommon (green), Rare (blue), Epic (purple), Legendary "Zero-Day" (gold). A Legendary has one fixed unique power.
- **Affixes:** each item rolls from a pool weighted by slot; the number of affixes scales with rarity, and the values scale with item level (floor). Examples: +damage %, attack speed, +projectiles, pierce, chain, crit chance/damage, max integrity, damage reduction, move speed, leech, *corrupt* (damage over time), *throttle* (slow), phase cooldown, focus charge, pickup radius, thorns ("firewall reflect").
- **Pickup:** walk over a drop to open a compact **compare card** (new against equipped, with green and red differences), then tap **EQUIP** or **SCRAP**. Scrapping gives Data. The game pauses while the card is open. A setting auto-scraps drops below a chosen rarity.
- **Names** are generated in the Diablo style: `[prefix] base [of suffix]`, for example *Overclocked Fork Bomb of Leeching*. Legendaries have proper names (*The One's Coat*, *Oracle's Cookie*, *Kernel Panic*).

## Roguelite layer

- **Per run:** loot, and a **patch** (perk) picked from three after each floor. Patches are run-only build pieces (+1 projectile, a phase that leaves a damaging trail, kills recharge phase, and so on). Rarer patches appear at higher floors.
- **Persistent:** **Data** is earned from kills, scrapping and floors cleared, and is kept even on death. It's spent at the **desk terminal** on permanent upgrades with a few ranks each: max integrity, damage, a starting exploit, a reroll per floor, Data gain, a free revive once per run ("Déjà vu"), a better first cache, and pickup radius.
- **Unlocks:** some exploit types and legendaries join the drop pool only after milestones (first boss kill and so on). This gives early runs a clear goal.
- **Daily seed:** an optional "Daily Dream" with the same seed for everyone that day and a best time.

## Controls

- **Phone (portrait):**
  - The screen is split: the room view at the top and a control deck at the bottom (terminal style, about 35% of the height)
  - Touch anywhere in the deck (or the room) and drag: a floating joystick appears under your thumb
  - Release to stand still and fire
  - Two large round buttons on the right of the deck: **PHASE** and **FOCUS** (swapped to the left in left-handed mode)
  - A small pause button at the top right
- **Desktop:** WASD or arrows to move, Space to phase, Shift or E for focus, Esc to pause. This is mainly for testing, but fully playable.
- Haptics on hit and pickup where the browser supports it.

## Menus and screens

- **Title:** code rain, the NEO logo, and *Wake up*, *Continue* (if a run is saved), *Daily Dream*, *Settings*, *Records*
- **Apartment hub:** in-world. The terminal opens the **Upgrades** screen.
- **HUD:** integrity bar, focus meter, floor and room pips, Data counter, run timer, and a minimap of rooms seen.
- **Pause:** resume, **loadout** (your four items with their stats, and patches taken), settings, abandon run
- **Compare card** (loot), **Patch pick** (three cards), **Oracle event** (two choices)
- **Run summary:** floors, time, kills, best drop, Data earned, cause ("terminated by agent")
- **Records:** best time, wins, runs, kills, legendaries found, and the codex of items discovered
- **Settings:**
  - music and SFX volume
  - haptics
  - screen shake
  - CRT scanlines
  - **reduced flashing** (photosensitivity: removes glitches and screen flashes)
  - damage numbers
  - fire while moving
  - left-handed controls
  - auto-scrap threshold
  - skip intro
  - reset progress

## Look and sound

- **Pixel art** drawn procedurally from string templates and palettes, as merryfolk does: no image files.
  - It's rendered into a 192-px-wide buffer and scaled by whole pixels with smoothing off.
  - Neo has a long black coat and shades; enemies are distinct silhouettes.
- **Palette:** phosphor greens on near-black, with one accent colour per floor (amber in the tenement, cyan in the server farm, sodium yellow in the subway, magenta on the grid, white-hot in the core). Rarity colours stay consistent everywhere.
- **Type:** a terminal font (VT323, with a monospace fallback) for menus, and a tiny built-in pixel font inside the canvas.
- **Sound:** all synthesised with Web Audio: the knock, glyph blips, terminations, decrypt chirps, phone ring, bullet-time *whum*, and a dark pulsing synth score that tightens on the boss.

## Out of scope (for this build)

- Multiplayer, accounts, servers, or a leaderboard beyond this device
- Additional playable characters (Trinity and Morpheus are noted as future ideas)
- Native app wrappers; it's a website that can be added to the home screen (a PWA manifest is in scope)

## Success criteria

- A full winning run takes 4–5 minutes for a competent player; a typical losing run lasts 1.5–3 minutes.
- It's playable one-handed on a 390×844 phone in portrait, with touch targets of at least 48 px.
- It runs at 60 fps on a mid-range phone, with no errors in automated runs across many seeds.
- Every floor of every tested seed is fully connected and completable (verified by a headless bot).
- It's deployed automatically to GitHub Pages from `main` after tests pass.
