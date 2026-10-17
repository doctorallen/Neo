# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

NEO is a five-minute portrait roguelite for the phone browser in plain JavaScript: no build step, no dependencies, no modules. Read `README.md` for the file map and controls, `js/tuning.js` for every number, and `DECISIONS.md` before changing a design decision. Log any new major gameplay decision there.

## Commands

```sh
python3 -m http.server 8000     # play at http://localhost:8000 (or open index.html)
npm ci                          # test tools only
npm test                        # everything CI runs
node test/gen.js --update       # re-record golden hashes after an intended generation change
node test/bot.js --mortal 20    # more balance runs; results in test/out/balance.json
git config core.hooksPath .githooks
```

## Architecture

- **Globals and load order.** Every file is a classic script in one global scope, loaded in order by `index.html` (`util.js` first, `main.js` last). A new file needs its `<script>` tag. `test/check.sh` fails on duplicate top-level names, so give helpers distinctive names.
- **Seeded generation.** Floors come from `generateFloor(seed, n)` using `Rng(hashInts(seed, n, …))`, never `Math.random`, so Continue can rebuild a floor and the golden hashes stay stable. Combat rolls and drops use `Game.run.rng`. Cosmetic effects may use `Math.random`.
- **Time.** `Game.step(dt)` is one fixed 1/60 s step. Neo and his shots run on real time; processes, packets and hazards run on `dt * Game.timeScale` (Bullet Time slows the world, not Neo).
- **Modals.** A screen or card sets `Game.modal`, which stops the simulation. Opening one calls `Input.block()`, so the thumb that was down can't press anything.
- **Rendering.** The world is drawn into a buffer exactly 192 px (one room) wide, then scaled up by whole device pixels. Sprites carry anchors `ax`/`ay` at the feet. The room background is cached per room.
- **The dream.** It is never stated: no player-facing text may say "dream". Every run ends on the same shot of Neo asleep at his desk.

## Testing changes

Drive the game headlessly with `puppeteer-core` through `test/lib.js` (`launch`, `openGame`). Wait 450 ms after a screen opens before tapping, because buttons ignore taps for 400 ms. `test/botlib.js`'s `installBot` adds `Bot.play({ god, skill })`, which plays whole runs. One-off scripts and screenshots go in `test/out/` (gitignored). Look at the screenshots for visual changes.

## Conventions

- Comments and in-game text are plain English. Match the surrounding density.
- Commits go to `main` with short sentence-case subjects. Every push to `main` deploys once the tests pass.
