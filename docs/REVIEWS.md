# Design reviews

Four agents reviewed the plan before any game code was written. This file records what each found and what changed as a result. `DESIGN.md` is the original spec; where it disagrees with this file or with `js/tuning.js`, those win.

## 1. Vision review (against your original ask)

**Found:**
- The first draft showed Neo jolting awake after a death, which breaks "the player doesn't know, but Neo is still asleep".
- 6–8 rooms a floor would make runs 8–12 minutes, not 5.
- A PHASE button can't be pressed while your thumb steers.
- A joystick on the room view hides the action under your thumb.
- A Google-hosted font would break offline play.
- The plan was missing the mobile basics, a soft-lock failsafe and a goal after the first win.

**Changed:**
- Every run now ends on the identical opening shot of Neo asleep.
- Floors are 4–5 small rooms.
- Phase is a flick gesture, and the joystick only works in the bottom deck.
- The font is embedded.
- Added the mobile basics, the failsafe and Depth tiers.

## 2. Mobile UX and controls review

**Adopted:**
- **Layout:**
  - Rooms are short enough to fit Safari's visible height: 12×13 standard, 12×15 for exit rooms and the arena, and nothing taller.
  - The deck is `clamp(196px, 27%, 250px)`.
  - Enemies out of view never attack, and edge pips point to them.
- **Flick to phase:** detected from the last 80 ms of finger travel on release (at least 0.9 CSS px/ms over at least 24 px), never on `pointercancel`, never queued during cooldown. It has its own setting.
- **Joystick:** 48 CSS px radius and an 8 px dead zone. The base trails the thumb, the pointer is captured, and the joystick owns one pointer.
- **Buttons:** act on `pointerdown` with their own pointer, with an 8 px dead border round each. All targets are at least 48 px.
- **Modals:**
  - Opening one cancels the joystick and ignores input for 400 ms; you then need a fresh touch.
  - **Loot cards never open during a fight.** Loot only shows its name until the room is clear.
- **Hints:** shown at the top of the room view, one at a time, triggered by context, and remembered separately.
- **Phone browser setup:**
  - `viewport-fit=cover` and `maximum-scale=1`, with `gesturestart` and `touchmove` prevented
  - no callouts or selection
  - a `visualViewport` fallback, and the safe-area bottom padding
  - the back gesture is caught by a `history` entry, so it pauses instead of leaving
- **Audio and tabs:** audio unlocks on `pointerup`/click and resumes on later taps. Returning to the tab shows the pause menu.
- **Readability:**
  - Enemy bullets have one reserved colour (red) that nothing else uses.
  - The player has a light outline, and the floors stay dark.
- **Title and intro:** Continue comes first, and starting a new run over a saved one asks first. The intro is marked as seen at the apartment door.
- **Cards:**
  - The compare card has a verdict line and the rarity word, and lists only the stats that change.
  - Patch picks are stacked full-width rows.
- **Skipping:** tapping fast-forwards typing and skips the summary count-up.
- **On the playfield:**
  - an HP bar over Neo
  - merged damage numbers (12 at most)
  - rarity beams over good loot
  - FOCUS dimmed until it's charged
- **Platform touches:**
  - Android goes fullscreen on the first tap.
  - Flash safety: no full-screen flash more than 3 times a second.
  - Haptics are hidden where they're unsupported.
  - *Show hints again* in Settings.

## 3. Combat, encounter and narrative review

**Adopted:**
- **Enemy bullets:**
  - 5 px, red, round, outlined
  - speeds between 50 and 95 px/s (player 64)
- **Telegraphs:** at least 0.4 s, never shortened.
- **Caps:**
  - 4 / 5 / 6 / 6 enemies alive per wave on floors 1–4
  - at most 2 ranged enemies
  - at most 18 enemy bullets (30 in the boss fight)
  - no attack within 1 s of spawning
- **The agent:**
  - It dodges one shot, then has a 1.2 s cooldown: deterministic and baitable, never during Bullet Time.
  - Mini-boss base HP is 220.
- **Boss fairness:**
  - a 0.7 s lane telegraph for charges
  - at most 2 clones
  - a 10-bullet ring that rotates
  - code storms that light at most 3 of 10 columns, with 2 adjacent safe columns always
  - no bursts during a storm
  - an arena that never scrolls
- **Bullet Time:**
  - You fire while moving, at full damage.
  - A 0.3 s ramp out.
  - Focus gain is scaled by the floor's enemy HP.
- **Elites:**
  - No *Replicating* bugs or worms.
  - Copies are 30% HP and not elite.
  - *Volatile* shows its true blast ring.
  - No elite in the very first fight.
- **Wording:** the word "dream" never appears to the player. Daily Dream is now **Daily Trace**, and Depth reads as "deeper layers".
- **Cold open** re-cut to the film:
  1. Open on Neo asleep.
  2. Cut to the CRT typing, with a cut to Neo stirring partway.
  3. The knock, and you have control within about 14 s.
  - Details:
    - The door is at most 4 tiles from the desk, and it knocks again if you idle.
    - The corridor beyond is empty under a flickering bulb.
    - A white rabbit's tail whisks round the far corner.
    - The doorway collapses into code behind you.
- **Phase:** phasing through an enemy bullet deletes it, gives focus, and types `> packet dropped`.
- **The deck terminal** narrates the hack: `> scan: 5 processes`, `> kill 4012 watchdog.d`.
- **Shooting is typing:** key-click sounds and a typing pose while still.
- **Encrypted elites:** their shields crumble into hex with `KEY CRACKED`.
- **First fight:** floor 1's first fight is scripted to teach (3 bugs, then a firewall).
- **After a win,** the CRT shows `ROOT ACCESS` for a second before "Wake up, Neo."
- **Compiling:** standing still for 1.2 s gives +25% fire rate until you move.
- **Residual self-image:** Neo wears a shirt in the apartment and the coat and shades only inside.
- **At the door:** the deck types `> …` instead of "no one is there".
- **Dream names:** `hypnos.d` and `rem_cycle` appear only on elite name tags.

## 4. Loot and roguelite systems review

**Adopted:**
- **Bullet Time can't refill itself:**
  - no focus gain during it
  - gain = damage ÷ (3 × the floor's enemy HP multiplier)
  - focus bonuses capped at +100%
  - Bullet Ballet is +40%
- **Phase can't become permanent:** cooldown reductions stack multiplicatively, capped at 50% (at least 0.8 s). Hot Swap is −25%.
- **Projectiles, chains and pierce:**
  - Extra projectiles do 60% damage, at most +3, and Multithread stacks twice at most.
  - Chain hops do 70%, at most 4 hops.
  - Pierce is at most 4.
- **Stat caps:**
  - crit 60%
  - armour 50%
  - attack speed +150%
  - move speed +50%
  - slow 50% (half on bosses)
  - leech 5% in total, 1–3% per affix
- **Flat damage numbers** (thorns, Daemon, Glitch Step, Trinity's Wake, the EMP) scale with the floor. Patch orbs heal 12% of max integrity (at least 15).
- **Luck** works as weight × (1+L)^tier, so it actually pushes toward the rarer tiers.
- **Drops:**
  - The floor-5 boss's reward is Data (+150) plus a new Zero-Day unlocked into the pool, since a drop after the last fight is worthless.
  - The floor-4 agent drops Epic or better (30% Zero-Day), and the floor-3 agent Rare or better.
- **Exploits** rebalanced so none is a downgrade (see `T.exploits`). Implant implicits exclude +projectile, pierce and chain.
- **Scaling:**
  - Enemy damage scales +25% a floor.
  - Coat and Shades implicits scale better.
  - Exploit item-level scaling is 0.35.
  - The floor-2 and floor-4 caches always offer an Exploit.
- **Economy:**
  - Data: floor clears 5·floor, scrap 1/3/6/15/40.
  - Upgrade costs raised to about 3,700 in total (about 15 runs).
  - **A Data sink:** 6 Zero-Days start in the pool, and the other 6 are *decompiled* at the terminal for 250–500 each.
- **Caches are a "pick 1 of 2" card**, which means fewer cards and a real choice.
- **Fights and patches:**
  - Second waves are 40% of the budget.
  - Sudo is +25% and Root Access +10%.
  - Scavenger makes caches offer 3.
  - Smith's Earpiece counts elites over the whole run (at most 5).
- **Loot tweaks:**
  - Pickup, Data and luck affixes are half as common.
  - Thorns hit everything within 20 px.
  - Construct Loader fires a 5-shot cone every 4th shot.
  - Blue Pill regenerates 1/s.
  - Agents dodge only direct shots.
  - Kernel Panic's mini-blasts do 40%.
  - Corrupt pools are capped at 80%.
  - The Oracle's "Déjà vu" event is renamed *Glitch*.
