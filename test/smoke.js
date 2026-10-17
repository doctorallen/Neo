'use strict';
// Every screen, through the real controls. On a phone (touch): the title,
// the whole cold open, walking with the joystick, the terminal and an
// upgrade, the door, a run (pause, loadout, settings, a flick to phase,
// Bullet Time, a compare card), death, the summary, and the short wake-up.
// On a desktop (keyboard): moving with WASD, Esc to pause, a few rooms.
// No page errors anywhere; screenshots of each screen go to test/out/.
const { launch, openGame, shot, finish, PHONE, DESKTOP } = require('./lib');
const { installBot } = require('./botlib');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// fast-forwards the game in the page
async function run(page, seconds) { await page.evaluate((s) => { for (let i = 0; i < s * 60; i++) Game.step(1 / 60); Game.render(); }, seconds); }
async function visible(page, id) { return page.evaluate((id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getBoundingClientRect().height > 0; }, id); }
async function center(page, sel) { return page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; }, sel); }
async function tap(page, sel) { await sleep(450); if (!(await page.$(sel))) throw new Error('nothing to tap at ' + sel); await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), sel); const [x, y] = await center(page, sel); await page.touchscreen.tap(x, y); await sleep(60); }
async function drag(page, x0, y0, dx, dy, holdSteps = 20) {
  await page.touchscreen.touchStart(x0, y0);
  for (let i = 1; i <= 6; i++) { await page.touchscreen.touchMove(x0 + (dx * i) / 6, y0 + (dy * i) / 6); }
  await run(page, holdSteps / 60);
  await page.touchscreen.touchEnd();
}

// in the page: walks Neo to the apartment door and through it
function walkOut() {
  Input.bot = { x: 0, y: 0 };
  for (let i = 0; i < 60 * 8 && Game.scene === 'hub'; i++) {
    const [dx, dy] = Bot.stepToward(6 * TILE, 2);
    Bot.go(dx, dy);
    Game.step(1 / 60);
  }
  Input.bot = null; Input.update();
}

async function phone(browser) {
  const { page, errors } = await openGame(browser, PHONE);
  await page.evaluate(installBot);
  // the title
  check(await visible(page, 'screen-title'), 'phone: no title screen');
  const sizes = await page.evaluate(() => [...document.querySelectorAll('#title-menu .btn')].map((b) => b.getBoundingClientRect().height));
  check(sizes.every((h) => h >= 48), `phone: title buttons under 48px: ${sizes}`);
  await shot(page, 'smoke-title');
  await tap(page, '#title-menu .btn.primary');
  check(await page.evaluate(() => Game.scene === 'hub'), 'phone: wake up did not reach the apartment');
  // the cold open: asleep, then the monitor types
  await run(page, 2.6);
  check(await visible(page, 'screen-crt'), 'phone: the monitor never typed');
  const typed = await page.evaluate(() => document.getElementById('crt-line').textContent);
  check(/Wake up/.test(typed), `phone: the monitor says "${typed}"`);
  await shot(page, 'smoke-crt');
  await run(page, 14);
  check(await page.evaluate(() => Game.hub && Game.hub.i >= Game.hub.script.length && !Game.player.hidden), 'phone: Neo never woke at the desk');
  check(!(await visible(page, 'screen-crt')), 'phone: the monitor overlay stayed up');
  check(await page.evaluate(() => Game.player.coat === false), 'phone: Neo wears the coat in the apartment');
  await shot(page, 'smoke-apartment');
  // the joystick: a drag in the deck moves him
  const deck = await center(page, '#deck');
  const before = await page.evaluate(() => [Game.player.x, Game.player.y]);
  await drag(page, deck[0] - 60, deck[1], 40, 0, 30);
  const after = await page.evaluate(() => [Game.player.x, Game.player.y]);
  check(after[0] > before[0] + 4, `phone: dragging right didn't move Neo (${before} → ${after})`);
  // a touch on the room view does not move him
  const stage = await center(page, '#stage');
  const b2 = await page.evaluate(() => Game.player.x);
  await drag(page, stage[0], stage[1], -40, 0, 20);
  check(Math.abs((await page.evaluate(() => Game.player.x)) - b2) < 0.5, 'phone: a drag on the room view moved Neo');
  // the terminal: walk back, jack in, buy something
  await page.evaluate(() => { Save.meta.data = 500; Game.player.x = HUB_TERMINAL.x; Game.player.y = HUB_TERMINAL.y; });
  await run(page, 0.2);
  check(await visible(page, 'btn-act'), 'phone: no JACK IN button at the terminal');
  await tap(page, '#btn-act');
  check(await visible(page, 'screen-upgrades'), 'phone: the terminal did not open');
  await shot(page, 'smoke-upgrades');
  await tap(page, '#up-list .buy');
  check(await page.evaluate(() => Save.rank('hp') === 1 && Save.meta.data === 475), 'phone: buying Hardened Kernel failed');
  await tap(page, '#screen-upgrades [data-back]');
  check(!(await visible(page, 'screen-upgrades')), 'phone: the terminal did not close');
  // out of the door, into the code
  await page.evaluate(walkOut);
  await run(page, 1);
  check(await page.evaluate(() => Game.scene === 'run' && Game.run.floorN === 1 && Game.player.coat), 'phone: the door did not lead to floor 1');
  check(await page.evaluate(() => Save.meta.introSeen), 'phone: the intro was not marked seen');
  await shot(page, 'smoke-entry');
  // the HUD
  const hp = await page.evaluate(() => document.getElementById('hp-text').textContent);
  check(hp === '110', `phone: integrity shows ${hp}, expected 110 with one Hardened Kernel`);
  // pause, loadout, settings
  await tap(page, '#btn-pause');
  check(await visible(page, 'screen-pause'), 'phone: pause did not open');
  const t0 = await page.evaluate(() => Game.run.time);
  await run(page, 1);
  check((await page.evaluate(() => Game.run.time)) === t0, 'phone: the run timer ran while paused');
  await page.evaluate(() => [...document.querySelectorAll('#pause-menu .btn')].find((b) => b.textContent === 'LOADOUT').id = 'smoke-loadout');
  await tap(page, '#smoke-loadout');
  check(await visible(page, 'screen-loadout'), 'phone: loadout did not open');
  await shot(page, 'smoke-loadout');
  await tap(page, '#screen-loadout [data-back]');
  await page.evaluate(() => [...document.querySelectorAll('#pause-menu .btn')].find((b) => b.textContent === 'SETTINGS').id = 'smoke-settings');
  await tap(page, '#smoke-settings');
  check(await visible(page, 'screen-settings'), 'phone: settings did not open');
  await shot(page, 'smoke-settings');
  const lefty0 = await page.evaluate(() => Save.settings.leftHanded);
  await page.evaluate(() => [...document.querySelectorAll('#settings-list .setting')].find((b) => /Left-handed/.test(b.textContent)).id = 'smoke-lefty');
  await tap(page, '#smoke-lefty');
  check((await page.evaluate(() => Save.settings.leftHanded)) === !lefty0, 'phone: the left-handed toggle did nothing');
  check(await page.evaluate(() => document.getElementById('app').classList.contains('lefty')), 'phone: left-handed layout not applied');
  await page.evaluate(() => [...document.querySelectorAll('#settings-list .setting')].find((b) => /Left-handed/.test(b.textContent)).id = 'smoke-lefty');
  await tap(page, '#smoke-lefty');
  await tap(page, '#screen-settings [data-back]');
  check(await visible(page, 'screen-pause'), 'phone: settings did not return to pause');
  await tap(page, '#pause-menu .btn.primary');
  check(!(await page.evaluate(() => Game.modal)), 'phone: resume left a modal open');
  // a flick phases
  await run(page, 0.5);
  await page.evaluate(() => { Game.player.phaseCdT = 0; });
  await sleep(450);
  // a flick, dispatched in the page so its timing is exact: 50px in 32ms
  await page.evaluate(([x, y]) => {
    const deck = document.getElementById('deck');
    const wait = (ms) => { const t = performance.now(); while (performance.now() - t < ms) { /* spin */ } };
    const ev = (type, px, py) => deck.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: 'touch', clientX: px, clientY: py, bubbles: true, cancelable: true, isPrimary: true }));
    ev('pointerdown', x - 80, y); wait(16);
    ev('pointermove', x - 55, y - 4); wait(16);
    ev('pointermove', x - 30, y - 8);
    ev('pointerup', x - 30, y - 8);
  }, deck);
  await run(page, 0.05);
  check(await page.evaluate(() => Game.player.phaseCdT > 0), 'phone: a flick did not phase');
  // the PHASE button
  await run(page, 2);
  await tap(page, '#btn-phase');
  await run(page, 0.05);
  check(await page.evaluate(() => Game.player.phaseCdT > 0), 'phone: the PHASE button did not phase');
  // Bullet Time
  await page.evaluate(() => { Game.run.focus = T.focus.max; });
  await tap(page, '#btn-focus');
  await run(page, 0.05);
  check(await page.evaluate(() => !!Game.bt), 'phone: FOCUS did not start Bullet Time');
  await shot(page, 'smoke-bullettime');
  await run(page, 4);
  check(await page.evaluate(() => !Game.bt && Game.timeScale === 1), 'phone: Bullet Time never ended');
  // play on to the first fight and through it
  await page.evaluate(() => { Game.debug.god = true; for (let i = 0; i < 60 * 40 && !(Game.room.kind === 'combat' && roomSealed()); i++) { Bot.tick(); Game.step(1 / 60); } Game.render(); });
  check(await page.evaluate(() => roomSealed()), 'phone: never reached a fight');
  await shot(page, 'smoke-fight');
  await page.evaluate(() => { for (let i = 0; i < 60 * 60 && roomSealed(); i++) { Bot.tick(); Game.step(1 / 60); } Input.bot = null; Input.update(); Game.render(); });
  check(await page.evaluate(() => Game.room.cleared), 'phone: the fight never ended');
  // a compare card: an item dropped at his feet in a cleared room
  await page.evaluate(() => {
    Game.run.gear.coat = rollItem(Game.run.rng, { slot: 'coat', ilvl: 1, rarity: 0 });
    const it = rollItem(Game.run.rng, { slot: 'coat', ilvl: 3, rarity: 2 });
    Game.drops.push({ kind: 'item', item: it, x: Game.player.x, y: Game.player.y, tx: Game.player.x, ty: Game.player.y, t: 1, id: it.id });
    Game.room.drops = Game.drops;
    for (let i = 0; i < 10; i++) Game.step(1 / 60);
  });
  check(await visible(page, 'screen-compare'), 'phone: walking onto loot did not open the compare card');
  await shot(page, 'smoke-compare');
  const btn = await center(page, '#compare-card .row .btn.primary');
  check(btn[3] >= 48, `phone: EQUIP is only ${btn[3]}px tall`);
  await tap(page, '#compare-card .row .btn.primary');
  check(await page.evaluate(() => Game.run.gear.coat.rarity === 2 && !Game.modal), 'phone: EQUIP did not equip');
  // death, the summary, and back to the desk
  await page.evaluate(() => { Game.debug.god = false; Game.player.invulnT = 0; Game.run.hp = 1; damagePlayer(999, 'the smoke test'); });
  await run(page, 2);
  check(await visible(page, 'screen-summary'), 'phone: dying did not show the summary');
  check(await page.evaluate(() => document.getElementById('sum-title').textContent === 'CONNECTION LOST'), 'phone: the summary title is wrong');
  await sleep(1800);
  await shot(page, 'smoke-summary');
  check(await page.evaluate(() => Save.data.checkpoint === null), 'phone: the checkpoint survived death');
  await tap(page, '#sum-wake');
  check(await page.evaluate(() => Game.scene === 'hub' && Game.hub && !Game.hub.full), 'phone: wake up did not give the short wake');
  await run(page, 1);
  check(await page.evaluate(() => Game.hub.asleep), 'phone: Neo was not asleep at the desk after the run');
  await run(page, 5);
  check(await page.evaluate(() => !Game.hub.asleep), 'phone: the short wake never finished');
  for (const e of errors) failures.push('phone: page error: ' + e);
  await page.close();
}

async function desktop(browser) {
  const { page, errors } = await openGame(browser, DESKTOP);
  await page.evaluate(installBot);
  await sleep(450);
  await page.evaluate(() => document.querySelector('#title-menu .btn.primary').click());
  await page.evaluate(() => { Save.meta.introSeen = true; });
  await run(page, 16);
  // WASD
  await sleep(500);
  const x0 = await page.evaluate(() => Game.player.x);
  await page.keyboard.down('KeyD');
  await run(page, 0.5);
  await page.keyboard.up('KeyD');
  check((await page.evaluate(() => Game.player.x)) > x0 + 10, 'desktop: D did not move Neo right');
  await page.keyboard.press('Escape');
  check(await visible(page, 'screen-pause'), 'desktop: Esc did not pause');
  await page.keyboard.press('Escape');
  check(!(await visible(page, 'screen-pause')), 'desktop: Esc did not resume');
  await shot(page, 'smoke-desktop-hub');
  // a few rooms of a run
  await page.evaluate(() => { startRun({ seed: 99 }); Game.debug.god = true; for (let i = 0; i < 60 * 45; i++) { Bot.tick(); Game.step(1 / 60); } Game.render(); });
  check(await page.evaluate(() => Game.run.roomsCleared >= 1), 'desktop: the autopilot cleared nothing');
  await shot(page, 'smoke-desktop-run');
  for (const e of errors) failures.push('desktop: page error: ' + e);
  await page.close();
}

(async () => {
  const browser = await launch();
  try {
    await phone(browser);
    await desktop(browser);
  } catch (e) {
    failures.push('crashed: ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' '));
  }
  await browser.close();
  finish('smoke', failures);
})().catch((e) => { console.error(e); process.exit(1); });
