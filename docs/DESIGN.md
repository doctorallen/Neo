# NEO — Design specification

This expands `VISION.md` into concrete features, numbers and screens. Units: world pixels (px), seconds (s). Tunable numbers live in `js/tuning.js`.

## 1. Screen and layout (portrait first)

- **Logical resolution:**
  - The game world is drawn into a buffer **192 px wide** (12 tiles of 16 px).
  - The buffer's height follows the space available, and it's scaled by a whole number of device pixels with smoothing off.
  - On a 390×844 phone (DPR 3) that's 6 device px per game pixel.
- **Layout, top to bottom:**
  1. **Top bar** (DOM, about 44 CSS px, respects the safe-area inset):
     - integrity bar with its number
     - sector label `SECTOR 2/5`
     - run timer
     - Data counter
     - pause button `II` (44×44)
  2. **Room view** (canvas): the room is 12 tiles wide, so it fills the width exactly. Rooms are 15 or 19 tiles tall, and the camera scrolls vertically when a room is taller than the view.
  3. **Control deck** (DOM, about 34% of the height, at least 230 CSS px):
     - the **minimap** at the top left
     - context hints in a terminal line along its top (`> drag to move`)
     - the **FOCUS** button (80 CSS px) and the smaller **PHASE** button (64 CSS px) on the right, with radial charge and cooldown fills
     - Left-handed mode mirrors the deck.
- **Desktop / landscape:** the same portrait column is centred, at most 480 CSS px wide, on a code-rain backdrop.
- **Floating joystick:**
  - Touch down anywhere in the deck (except the buttons), then drag. Touches on the room view do nothing, so a thumb never covers the action.
  - The base appears under the thumb with a 36 px radius and a dead zone of 6 px.
  - Speed is proportional up to full deflection.

## 2. Controls

| Action | Phone | Keyboard |
|---|---|---|
| Move | Drag the floating joystick | WASD / arrows |
| Attack | Automatic while standing still (release the thumb) | Automatic while standing still |
| Phase (dash) | A flick: a swipe of at least 28 CSS px, released within 0.22 s; or the PHASE button | Space |
| Bullet Time | FOCUS button (when charged) | Shift / E |
| Interact (decrypt, terminal, phone, door) | Walk onto it; decrypt progresses while you stand in range | Same |
| Pause | `II` | Esc / P |
| Menus | Tap | Mouse, or Enter / Esc |

- **Stand-still firing:** firing starts 0.06 s after the stick is released, and stops when the stick is past the dead zone.
- **Fire while moving** (setting): always fires, but at 65% damage while moving.
- **Phase** dashes in the flick direction, the stick direction, or the facing direction if the stick is idle.
- **Mobile basics:**
  - `touch-action: none` and no text selection, callouts or context menu on the game
  - no pull-to-refresh (`overscroll-behavior: none`) and no double-tap zoom
  - the safe-area insets respected, and the layout sized with `100dvh`
  - the game pauses on `visibilitychange`/`blur`
  - in landscape on a phone, a "rotate your phone" card
  - `navigator.vibrate` is used only when it exists (it doesn't on iOS)
- **Haptics:** 12 ms when hit, 8 ms on pickup, and 30 ms on a bullet-time start (`navigator.vibrate`, where supported).

## 3. Run structure and timing

| Floor | Sector | Rooms | Exit room guard |
|---|---|---|---|
| 1 | Tenement | 4 (entry, 1 combat, cache, exit) | elite pack |
| 2 | Server Farm | 5 (entry, 2 combat, cache, exit) | elite pack |
| 3 | Subway | 5 (+ optional rooms) | `agent` mini-boss |
| 4 | Grid | 5 (+ optional rooms) | `agent` mini-boss + escorts |
| 5 | Core | 2 (antechamber with the last cache, then the arena) | **The Agent** |

- **Rooms per floor** always include:
  - an entry room (safe, short: 12×11)
  - combat rooms
  - exactly one cache room
  - an exit room
- **Optional rooms:** an Oracle terminal room (40% on floors 1–4) and a white-rabbit secret room (25% per floor, reached through a hidden door revealed after the rabbit is followed).
- **Target time:** a combat room takes about 10–12 s (3–7 enemies) and a floor about 45 s, so a full win takes about 4–4.5 min. The headless bot measures this. The run timer stops while the game is paused or a card is open.
- **Patch pick** (choose 1 of 3) happens when you answer the payphone, before the next floor loads.
- **Checkpoint:** the run is saved at the start of each floor. **Continue** restarts the current floor with the gear you had when you entered it.

## 4. Dungeon generation

- **Seeding:** each run has a 32-bit seed. Floor *n* uses `mulberry32(hash(seed, n))`. All generation draws from that generator, never from `Math.random`.
- **Floor layout:**
  1. Place the entry room at the centre of a 7×7 room grid.
  2. Walk a main path (entry → combat rooms → exit) that turns at random but never doubles back.
  3. Hang the cache, Oracle and rabbit rooms off the main path as one-room side branches.
- **Room layouts:**
  - Each room comes from a library of hand-written ASCII templates (12×15 and 12×19), randomly mirrored.
  - Characters: `#` wall, `.` floor, `o` obstacle (rack or crate, blocks movement and shots), `s` spawn point, `~` decor.
  - Doors sit at the middle of each edge and are carved only where a neighbour exists.
- **Validation:** every generated room is flood-filled from each of its doors. Spawn points must be reachable and at least 48 px from every door. Any template that fails is rejected at load time by the tests.
- **No going back:**
  - Floor 1's entry room has the apartment door behind the player, which dissolves into code after you step in.
  - Floors are entered only through the phone.
  - Rooms within a floor can be revisited (the doors stay open once cleared), which is needed for the side branches.
- **Soft-lock failsafe:**
  - An enemy that ends up inside a wall or outside the room is moved to the nearest floor tile.
  - If a room has gone 20 s without you damaging anything and its enemies are not in sight, the remaining enemies are moved to spawn points near you.

## 5. Player

| Stat | Base |
|---|---|
| Integrity (HP) | 100 |
| Move speed | 64 px/s |
| Hitbox | 8×8 at the feet |
| Phase | 52 px in 0.14 s, invulnerable 0.30 s, cooldown 1.6 s |
| Bullet Time | 100 charge, +1 per 3 damage dealt, lasts 3 s of real time; the world runs at 25% while you move at 100% and fire at 2× rate |
| After being hit | invulnerable for 0.6 s, blinking |
| Armour cap | 60% damage reduction |

- **Death:** integrity reaches 0 (unless the Déjà vu revive is available).

## 6. Exploits (weapon types)

The damage, rate and projectile speed below are at item level 1. Damage scales with item level ×(1 + 0.3·(ilvl−1)).

| Exploit | Damage | Shots/s | Speed | Pattern | Unlock |
|---|---|---|---|---|---|
| Packet Gun | 10 | 3.0 | 200 | single shot | start |
| Fork Bomb | 7 | 1.7 | 170 | 3-way spread at 14° | start |
| Overflow | 17 | 1.3 | 260 | pierces 2 | start |
| Worm.exe | 8 | 2.2 | 180 | chains to 2 more targets (60 px) | reach floor 3 |
| Rootkit | 8 | 2.5 | 150 | homing | kill an `agent` |
| Logic Bomb | 18 | 0.9 | 130 | lobbed; 22 px area | first win |

- **+Projectiles** adds extra shots to the pattern: they fan out on a single-shot exploit and widen the spread on a Fork Bomb.
- **Targeting:** the nearest enemy that's alive, visible (not behind obstacles) and not spawning. If none is visible, the nearest one at all, and nothing if the room is clear.

## 7. Items

- **Slots:** Exploit, Coat, Shades, Implant. You start a run with a Common Packet Gun and nothing else (unless upgraded).
- **Item level** = the floor it dropped on (1–5).
- **Rarity:**

| Rarity | Colour | Base weight | Affixes | Scrap Data |
|---|---|---|---|---|
| Common | #c8d4c8 | 60 | 0 (implicit only) | 2 |
| Uncommon | #3cff6e | 28 | 1 | 5 |
| Rare | #4aa8ff | 9 | 2 | 12 |
| Epic | #c25aff | 2.5 | 3 | 30 |
| Zero-Day (Legendary) | #ffb43a | 0.5 | 2 + unique | 80 |

- **Luck:** each point of luck % multiplies the uncommon-and-better weights. Elites roll with +1 tier bias (the drop is rolled twice and the better kept). Bosses always drop Epic or better.
- **Implicit stat per slot**, scaled by item level:
  - Exploit: its base damage
  - Coat: +12·ilvl max integrity and +3% armour
  - Shades: +4% crit and +10% focus gain
  - Implant: one random affix at half value
- **Affix pool** (value ranges at ilvl 1 → ilvl 5; slot weights in the code):
  - `dmg` +6–10% → +18–28% damage
  - `rate` +6–10% → +16–24% attack speed
  - `proj` +1 projectile (Exploit and Implant only, rare)
  - `pierce` +1 pierce
  - `chain` +1 chain
  - `crit` +3–5% → +8–12% crit chance (crits do 200%)
  - `critdmg` +20–40% → +50–80% crit damage
  - `hp` +10–16 → +30–45 max integrity
  - `armor` +3–5% → +8–12% armour
  - `speed` +5–8% → +12–16% move speed
  - `leech` 1–2% → 3–5% of damage healed
  - `corrupt` 20–30% → 45–60% of hit damage dealt over 2 s
  - `throttle` 10–15% chance → 20–25% chance to slow by 40% for 1.5 s
  - `phasecd` −8–12% → −18–24% phase cooldown
  - `focus` +10–15% → +25–35% focus gain
  - `pickup` +20–30% → +50–70% pickup radius
  - `thorns` 4–6 → 12–18 damage returned on contact
  - `data` +8–12% → +18–25% Data gain
  - `luck` +5–8% → +12–18% item rarity
- **Names:** an Uncommon item gets a prefix or a suffix from its affix; a Rare or better gets both from its two strongest affixes, as in *Overclocked Fork Bomb of Leeching*. Each affix has one prefix and one suffix word.
- **Zero-Days** (legendary uniques, each with a fixed power plus two random affixes):

| Name | Slot | Power |
|---|---|---|
| The One's Coat | Coat | The first lethal hit each floor leaves you at 1 integrity and triggers Bullet Time |
| Morpheus' Shades | Shades | Bullet Time lasts twice as long |
| There Is No Spoon | Implant | All shots home gently |
| Red Pill | Implant | +40% damage, −25% max integrity |
| Blue Pill | Implant | Regenerate 1.5 integrity/s, −15% damage |
| Kernel Panic | Exploit (Logic Bomb base) | Explosions spawn 3 mini-explosions |
| Construct Loader | Exploit (Packet Gun base) | Every 6th shot is an 8-way burst |
| Trinity's Wake | Implant | Phase leaves a damaging trail (20 damage per touch) |
| Oracle's Cookie | Implant | Heal 25% when a room is cleared |
| Keymaker's Ring | Implant | Caches drop one more item, and decrypt twice as fast |
| Nebuchadnezzar Coil | Coat | Below 30% integrity, an EMP (60 damage to everything in the room), once per room |
| Smith's Earpiece | Shades | +30% crit damage per elite killed this floor (max 3) |

- **Drops:**
  - Normal enemy: 6% item chance, 4% patch orb (heals 15)
  - Elite: one guaranteed item, 50% patch orb
  - Cache: two items, at least Uncommon
  - Rabbit room: one item of Rare or better, plus 30 Data
  - Mini-boss: one item of Rare or better
  - The Agent: one Zero-Day (from the unlocked pool)
  - Zero-Days can drop from anything only once you've reached floor 2 in any run.
- **Pickup:**
  - An item for an empty slot is equipped at once, with a toast.
  - Otherwise, walking over an item opens the **compare card**:
    - the item name in its rarity colour, its slot and item level
    - its implicit stat and affixes
    - each line marked ▲ (green) or ▼ (red) against the equipped item's total
    - buttons **EQUIP** (the old item is scrapped for Data) and **SCRAP (+n Data)**
  - The game is paused while the card is open.
  - Auto-scrap (setting: off / Common / Uncommon; **Common by default**) scraps drops at or below the threshold with a toast instead, except into an empty slot.

## 8. Patches (run perks)

- Picked one from three after each of floors 1–4 (four picks a run).
- No duplicates unless the patch is stackable (marked ×).
- Floor 3 onwards adds the rare patches.

| Patch | Effect |
|---|---|
| Multithread × | +1 projectile |
| Overclock × | +20% attack speed |
| Sudo × | +20% damage |
| Buffer Overrun × | +1 pierce |
| Daisy Chain × | +1 chain |
| Root Access × | +12% crit chance |
| Garbage Collector | Kills heal 2 |
| Hot Swap | −35% phase cooldown |
| Firewall × | +25 max integrity, heal to full |
| Encryption | Ignore the first hit in each room |
| Bullet Ballet | +60% focus gain |
| Packet Loss | Enemies move 15% slower |
| Memory Leak | Hits corrupt for 40% over 2 s |
| Echo | 20% chance a shot fires twice |
| kill -9 | +50% damage to elites and bosses |
| Scavenger | +40% item drop chance, +25% Data |
| **Rare:** Daemon | An orbiting drone fires 8-damage shots at 1.5/s |
| **Rare:** Glitch Step | Phasing through enemies deals 40 damage |
| **Rare:** Overclocked Kernel | +1 projectile and +15% attack speed |

## 9. Enemies

Base values at floor 1. HP ×(1 + 0.4·(floor−1)), damage ×(1 + 0.15·(floor−1)).

| Process | HP | Speed | Behaviour | Damage | Cost | Floors |
|---|---|---|---|---|---|---|
| `bug` | 14 | 52 | Swarms toward you with jitter | 8 contact | 1 | 1+ |
| `watchdog.d` | 30 | 40 | Approaches; at 70 px, a 0.55 s tell (eyes flash), then dashes at 170 for 0.35 s | 12 | 2 | 1+ |
| `firewall.sys` | 40 | 0 | Turret; every 2.2 s fires a 3-bullet fan at you (speed 70) | 9 | 2 | 1+ |
| `sentinel` | 44 | 46 | Orbits at 60 px; every 3 s, a 0.5 s tell then a lunge | 12 | 3 | 2+ |
| `worm` | 36 | 30 | Slithers toward you; splits into 2 small worms (HP 14) | 10 | 3 | 2+ |
| `exile` | 50 | 0 | Blinks to a new spot every 3 s; fires a 5-bullet spread after each blink | 9 | 4 | 3+ |
| `agent` (mini-boss) | 320 | 50 | Strafes; fires 3-round bursts; **dodges 35% of your shots** (sidestep blur), except during Bullet Time | 12 | — | 3–4 |

- **Room budget:** 5 + 3·floor points. Rooms over 15 tiles tall get a second wave of 60% of the budget, which arrives when the first wave is 75% terminated.
- **Spawning:** each enemy appears after a 0.6 s glitch telegraph at a spawn point at least 56 px from the player.
- **Elites:** chance per combat room of 12% + 6%·floor. One enemy is promoted:
  - HP ×3.2 and damage ×1.3, a gold outline, and a name tag such as `ENCRYPTED watchdog.d`
  - one modifier (two on floor 4)
  - Modifiers:
    - *Encrypted* — a 40% shield bar that must break first
    - *Overclocked* — +45% speed and attack rate
    - *Replicating* — splits into 2 copies at 30% HP on death
    - *Mirrored* — 25% of your shots bounce back
    - *Volatile* — explodes for 20 damage (radius 28 px) 0.6 s after death, telegraphed
- **Exit-room guards:**
  - Floors 1–2: an elite pack (one elite plus the normal budget)
  - Floor 3: an `agent`
  - Floor 4: an `agent` plus a budget of 8

## 10. The Agent (floor 5 boss)

- **Stats:** HP 2200 (already floor-scaled) in a 12×19 arena.
- **Phase 1** (100–66%):
  - Fires 3-round bursts every 1.4 s.
  - Every 4 s, a telegraphed charge across the room.
  - Dodges 50% of shots outside Bullet Time.
- **Phase 2** (66–33%):
  - "Replication": spawns 2 clones (HP 60, 1-round bursts) every 9 s, up to 4.
  - Fires an 8-bullet ring every 3 s.
- **Phase 3** (below 33%):
  - "Code storm": 3–4 columns light up for 0.8 s, then rain falling code (14 damage).
  - Charges more often.
  - Stops dodging.
- **Dialogue lines** in the HUD terminal: *"Mr. Anderson."*, *"Me, me, me."*, *"It is inevitable."*
- **On death:** time stops, he dissolves in code, then a white-out and the victory summary.

## 11. Rooms with something in them

- **Cache:**
  - A chest-terminal ringed by a dotted circle (radius 24 px).
  - Standing inside fills `DECRYPTING… 63%` over 1.6 s. Leaving pauses it, and it doesn't reset.
  - When it's done, it opens and drops its items.
- **Oracle terminal:** walk onto it to open an event card with two choices and *Leave*. One per room; it's then spent.
  - **Cookie:** "Have a cookie." Heal 40% / *Leave*
  - **Blood for code:** Lose 30% current integrity, get a Rare-or-better item / *Leave*
  - **Rewrite:** Reroll the affixes of your Exploit / reroll your Coat / *Leave*
  - **Spoon:** "Do not try to bend the spoon." +1 random stackable patch, enemies +10% HP this floor / *Leave*
  - **Déjà vu:** Gain 40 Data now / gain a random patch at the next pick as a fourth option / *Leave*
  - **Choice:** the red pill (+15% damage for the run, −15 max integrity) / the blue pill (heal to full, +20 max integrity) — no Leave
- **White rabbit:**
  - Once a combat room is cleared (25% per floor, in one room), a white rabbit hops in and runs to a wall.
  - Where it vanishes, a hidden door opens to a small room holding a Rare-or-better item and 30 Data.
  - The door stays visible on the minimap.
- **Déjà vu cat:** when a floor rolls an elite exit room, a black cat crosses the next room you enter, twice. Nothing else happens; it's a hint.
- **Payphone (exit):**
  - Rings once the exit room is clear.
  - Stand on it for 0.5 s to answer: the screen glitches, then the patch pick, then the next floor.
  - The phone on floor 5 is replaced by the Agent arena.

## 12. Hacking dressing (feel)

- **Projectiles:** small glyph sprites (katakana-like shapes, 0s and 1s), in the colour of the exploit's rarity, each with a 1-frame trail.
- **On hit:**
  - the enemy flashes white for 2 frames
  - 3–5 tiny `0`/`1` particles
  - a damage number (white, yellow with ! for crits) that rises and fades
- **Kills:** the enemy is replaced by its sprite dissolving into falling green columns (0.5 s), with `TERMINATED` floating up for elites.
- **Room clear:** the deck terminal types `> ACCESS GRANTED`, the doors slide open (wall tiles become code, then floor), and there's a chime.
- **Sealed doors** show `FIREWALL` in scrolling glyph bricks.
- **Player hurt:**
  - a 1-frame chromatic glitch on the canvas
  - 3 px screen shake (setting)
  - a red vignette pulse (skipped with reduced flashing)
- **Low integrity** (below 25%): a slow heartbeat thump and a red frame pulse.
- **Bullet Time:**
  - The world desaturates to green, a deep "whum" plays, and the music low-passes.
  - Bullets leave long trails, and there's a ripple when it starts.
- **Answering the phone:** a ring, a click, then a full-screen glitch tear.
- **Scanlines** (setting) are drawn as a CSS overlay, and a gentle vignette is always on.

## 13. Screens and menus

- **Boot / title:**
  - code rain, with the logo `NEO` built from glyphs
  - a blinking `> wake up_` button
  - *Continue* (only if a checkpoint exists)
  - *Daily Dream*
  - *Settings*
  - *Records*
  - the build stamp in the corner
- **Cold open** (first run, or when skip intro is off):
  1. Black. The terminal types *"Wake up, Neo…"* (0.6 s pause), *"The Matrix has you…"*, *"Follow the white rabbit."*, then *"Knock, knock, Neo."* The text is centred and large, typed letter by letter with key clicks.
  2. A double knock sounds. The screen fades into the apartment.
  3. The apartment: Neo is slumped at the desk with the CRT glowing, and the clock reads `03:14`.
  4. Neo lifts his head. The deck hint reads `> drag to move`.
  5. The door on the right wall shows a knock "shake" twice. Walking to it opens it onto a dark, empty corridor, and the deck types `> no one is there.`
  6. Walking into the doorway causes a glitch tear and floor 1's entry room. The doorway behind you collapses into code.
  - The whole open can be skipped with a `skip ▸` button (from the second time on).
- **Short wake** (every later run): the same shot of Neo asleep at the desk. The screen types *"Wake up, Neo."*, then the knock, and he lifts his head.
  - The **terminal** (glowing) opens the Upgrades screen.
  - The **door** starts the run.
  - **Daily Dream** is started from the title instead.
- **Upgrades ("KERNEL"):**
  - the Data balance
  - a list of upgrades, each with its rank pips, cost and a BUY button
  - flavour text in terminal style
- **HUD:** the top bar (§1), plus the minimap with:
  - visited rooms (bright)
  - known neighbours (dim)
  - room icons (cache, oracle, phone, rabbit)
  - your room (blinking)
- **Pause:**
  - Resume
  - **Loadout:** the four items as tappable cards that show their details, your patches as chips, and a computed stats table
  - Settings
  - Abandon run (with confirmation)
- **Patch pick:** three tall cards with name, effect and rarity, tapped to choose. A reroll button appears if you have the upgrade.
- **Run summary:**
  - the title (`CONNECTION LOST` for a death, `ROOT ACCESS` for a win)
  - the sector reached
  - the time
  - kills
  - Data earned (an itemised count-up)
  - the best item found
  - what killed you
  - a `> wake up` button that cuts to the **identical opening shot**: Neo asleep at the CRT, the clock at 03:14. After a win, the shot holds two seconds longer before the text types. Neo is never shown waking from the dungeon; he only ever "wakes" into it.
- **Records:**
  - best win time, wins, runs, total kills
  - Zero-Days found (codex grid with the undiscovered ones as `???`)
  - deepest sector
  - the daily best for today
- **Settings:**
  - Music volume (50%)
  - SFX volume (80%)
  - Haptics (on)
  - Screen shake (on)
  - CRT scanlines (on)
  - Reduced flashing (off; on by default when the system asks for reduced motion, which also turns shake off)
  - Damage numbers (on)
  - Fire while moving (off)
  - Left-handed (off)
  - Auto-scrap (off / Common / Uncommon)
  - Skip intro (automatic after the first)
  - Reset all progress (confirmation by typing nothing, a hold-to-confirm 1.5 s)
- **Tutorial hints** (first run only), shown in the deck terminal line:
  - `> drag to move`
  - `> let go to hack`
  - `> PHASE dodges through attacks`
  - `> FOCUS slows time — use it`
  - `> stand in the ring to decrypt`
  - `> walk over loot to inspect it`
  - `> answer the phone`

## 14. Persistence

- **Storage:** `localStorage` key `neo.save.v1` holds the settings, meta progress (Data, upgrade ranks, unlocks, discovered Zero-Days), records and the run checkpoint. It's written on every change that matters. A corrupt or missing save falls back to defaults without errors.
- **Checkpoint:**
  - `{ seed, floor, daily, gear, patches, hp, focus, stats, dataRun, time, kills }`, written when a floor starts.
  - Cleared on death or victory.
- **Data handling:** Data earned is added to the persistent balance when the run ends, and also when a checkpoint is written. So quitting mid-run never loses more than the current floor's Data.

## 15. Permanent upgrades (the desk terminal)

| Upgrade | Ranks | Effect per rank | Costs |
|---|---|---|---|
| Hardened Kernel | 5 | +10 max integrity | 25, 50, 90, 140, 200 |
| Optimised Code | 5 | +6% damage | 30, 60, 100, 150, 220 |
| Overclocked Bus | 3 | +6% attack speed | 40, 90, 160 |
| Lucky Packets | 3 | +12% item rarity | 35, 80, 140 |
| Data Miner | 3 | +15% Data | 30, 70, 130 |
| Bootstrap | 2 | Start with an Uncommon / Rare Exploit | 60, 180 |
| Preloaded Focus | 1 | Start each floor with 50% focus | 120 |
| Patch Reroll | 1 | One patch reroll per pick | 150 |
| Déjà Vu | 1 | Once a run, revive at 50% integrity | 400 |
| Depth (after the first win) | 5 | Select at the terminal. Each depth: enemies +25% HP and +15% damage, +15% item rarity, +20% Data | unlocked by winning at the previous depth |

- **Data income:**
  - kills: 1 (elites 5, `agent` 25)
  - floor cleared: 8·floor
  - scrapping: per the rarity table
  - The Agent: 120
- A losing run earns about 50–90 Data and a win about 250–320. The whole tree costs about 2,700 Data, which is about 15–25 runs.

## 16. Sound (all synthesised)

- **Music:** a 110 BPM dark synth loop:
  - a pulsing sub bass, a minor arpeggio and noise hats
  - each floor shifts the key and adds a layer
  - the boss loop is 128 BPM with distortion
  - Bullet Time low-passes everything
- **Effects:**
  - knock
  - keystroke ticks
  - shot blip per exploit
  - hit tick
  - enemy termination (a downward bit-crush)
  - player hurt (a buzz)
  - pickup (an arpeggio by rarity; the Zero-Day gets a choir pad)
  - decrypt (rising chirps)
  - door unlock
  - phone ring
  - Bullet Time whum
  - phase whoosh
  - low-HP heartbeat
- **Audio unlock:** audio starts on the first tap (the title's *wake up*). It's suspended while the tab is hidden, and the game pauses itself when the tab is hidden.

## 17. Technical

- **Code:** classic scripts in `js/`, loaded in order by `index.html`, sharing one global scope (as merryfolk does).
- **Loop:** a fixed 60 Hz simulation step with an accumulator (at most 5 steps a frame), and rendering on `requestAnimationFrame`. `Game.step(dt)` is exposed so the tests can simulate quickly without rendering.
- **Sprites:** built at load time from string templates plus palettes into offscreen canvases (`spriteFrom`, an outline pass), and cached.
- **Text:** a tiny built-in 3×5 / 5×7 pixel font for in-canvas text; DOM for menus.
- **PWA:** a manifest, `theme-color`, and `apple-mobile-web-app-capable`, with generated PNG icons. There's no service worker, to avoid serving a stale game after a deploy.
- **Fonts:** VT323 (SIL Open Font Licence) bundled as `fonts/VT323.woff2` with its licence.
- **Testing** (`npm test`, all headless in Chrome through `puppeteer-core`):
  - `check.sh` — syntax, the script list, duplicate globals
  - `gen.js` — 500 seeds × 5 floors: connected, a reachable exit, valid spawns, and golden hashes for 3 seeds
  - `loot.js` — 20,000 items: finite stats, names, the rarity distribution within tolerance, and every affix and unique reachable
  - `smoke.js` — the phone and desktop viewports: title → intro → run → pause → settings → death → summary → hub, with no page errors and screenshots
  - `bot.js` — an autopilot plays complete runs on several seeds: invulnerable to prove completability, then mortal to report the death floor and run times against the 5-minute target
  - `save.js` — settings and meta persistence, checkpoint resume, and corrupt-save recovery
- **CI:** `.github/workflows/pages.yml`, as in merryfolk: check, test, and deploy `main` to GitHub Pages.

## 18. Dream tells (never explained)

- The apartment clock always reads `03:14`.
- Some process names: `hypnos.d` (the sentinel's full name), `rem_cycle` (a worm), `sleep()` in the boss's death log.
- A cracked mirror in some tenement rooms shows Neo with his eyes closed.
- The white-rabbit room has a window looking into Neo's apartment, where he's asleep at the desk.
- The knock: nobody is ever there.
- Every run ends on the identical opening shot.
