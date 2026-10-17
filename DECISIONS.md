# Decision log

Gameplay and project decisions made while building NEO overnight without being able to ask. Each entry says what was chosen, the alternatives, and why, so you can review and overturn any of them. Newest at the bottom.

| # | Decision | Alternatives considered | Why |
|---|---|---|---|
| 1 | **Plain JavaScript, no build step, no runtime dependencies**, classic `<script>` files sharing one global scope, as merryfolk does | ES modules, a bundler (Vite), TypeScript, a game engine (Phaser) | Matches merryfolk so the same CI shape works; runs from `file://`; nothing to install to play; tests only need `puppeteer-core` |
| 2 | **Room-based dungeon** (Isaac-style grid of rooms, doors seal until the room is cleared) | One continuous Diablo-style cave with a scrolling camera | Rooms suit a portrait screen, pace a 5-minute run in fixed chunks, and make "cleared, move on" readable at a glance |
| 3 | **Stand still to attack** (auto-fire at the nearest enemy when not moving, as in Archero), with a setting to fire while moving at reduced damage | Twin-stick (two joysticks), tap-to-shoot, always auto-fire | The only scheme that's truly one-thumb and still has skill: positioning versus shooting. Twin-stick needs two thumbs in portrait |
| 4 | **5 floors, the 5th is a boss** (about 50 s a floor) | 3 longer floors; 10 tiny floors | Hits the 5-minute target with room for a patch choice between floors |
| 5 | **No XP and levels.** Power comes from loot plus one perk ("patch") pick per floor | Diablo-style XP and level-ups | Loot is the Diablo half and patches are the roguelite half; level-up pop-ups every 20 s would crowd a 5-minute run |
| 6 | **Four item slots: Exploit (weapon), Coat, Shades, Implant** | Diablo's ten slots | Small enough to compare on a phone in a second, and they match Neo's iconic look |
| 7 | **The game pauses while a loot compare card is open** | Auto-equip; a non-blocking toast | Lets you make the Diablo "is this better?" decision without dying; an auto-scrap setting removes the friction for common drops |
| 8 | **The dream twist is never stated.** Death and victory both end with Neo jolting awake at the desk, and the screen types "Wake up, Neo…" again | An explicit reveal ending | You asked that the player not know; the loop is the hint, plus small tells (the clock is always 3:14, the Oracle's line, déjà-vu cats) |
| 9 | **The apartment is the hub.** The desk terminal is the permanent-upgrade shop and the door starts a run | A separate menu screen for upgrades | Keeps the "wake up at the desk" scene meaningful on every run instead of a one-off intro |
| 10 | **Uses Matrix names directly** ("Wake up, Neo", the Agent, the Oracle, the white rabbit) as you asked | Renamed knock-offs | You asked for it, and it's a personal fan project. **Worth reviewing:** the GitHub Pages site is public, and the names and lines belong to Warner Bros. If you ever share it widely, consider renaming |
