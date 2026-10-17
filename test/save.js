'use strict';
// Saving: settings and permanent progress survive a reload; Continue
// restores the floor a run was on, with the same gear and the same rooms;
// a corrupt save, a save with nonsense in it, and storage that refuses to
// write all fall back to defaults without a single page error.
const { launch, openGame, finish } = require('./lib');
const { installBot } = require('./botlib');

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = (page) => page.waitForFunction(() => typeof Game !== 'undefined' && Game.ready, { timeout: 30000 });

(async () => {
  const browser = await launch();

  // settings and progress across a reload
  {
    const { page, errors } = await openGame(browser, {});
    await page.evaluate(() => { Save.settings.music = 0.2; Save.settings.leftHanded = true; Save.settings.autoScrap = 2; Save.meta.data = 321; Save.meta.upgrades.dmg = 2; Save.unlock('zd_kernel'); Save.write(); });
    await page.reload(); await ready(page);
    const s = await page.evaluate(() => ({ music: Save.settings.music, lefty: Save.settings.leftHanded, scrap: Save.settings.autoScrap, data: Save.meta.data, dmg: Save.rank('dmg'), zd: Save.unlocked('zd_kernel'), cls: document.getElementById('app').classList.contains('lefty') }));
    check(s.music === 0.2 && s.lefty && s.scrap === 2, `settings lost on reload: ${JSON.stringify(s)}`);
    check(s.data === 321 && s.dmg === 2 && s.zd, `progress lost on reload: ${JSON.stringify(s)}`);
    check(s.cls, 'the left-handed layout was not applied on load');
    for (const e of errors) failures.push('settings: page error: ' + e);
    await page.close();
  }

  // a checkpoint: play into floor 2, reload, Continue
  {
    const { page, errors } = await openGame(browser, {});
    await page.evaluate(installBot);
    const before = await page.evaluate(() => {
      UI.hide(); stopRain(); Save.meta.introSeen = true;
      startRun({ seed: 4242 }); Game.debug.god = true;
      for (let i = 0; i < 60 * 240 && Game.run.floorN < 2; i++) { Bot.tick(); Game.step(1 / 60); }
      return { floor: Game.run.floorN, gear: JSON.stringify(Game.run.gear), patches: Game.run.patches.join(), hash: floorHash(Game.run.floor), banked: Save.meta.data, runData: Math.floor(Game.run.data) };
    });
    check(before.floor === 2, `the autopilot never reached floor 2 (on ${before.floor})`);
    check(before.banked >= before.runData - 1 && before.banked > 0, `Data earned on floor 1 was not banked at the checkpoint (${before.banked} vs ${before.runData})`);
    await page.reload(); await ready(page);
    await sleep(500);
    const hasContinue = await page.evaluate(() => [...document.querySelectorAll('#title-menu .btn')].some((b) => /CONTINUE/.test(b.textContent)));
    check(hasContinue, 'no Continue on the title after a reload mid-run');
    await page.evaluate(() => [...document.querySelectorAll('#title-menu .btn')].find((b) => /CONTINUE/.test(b.textContent)).click());
    const after = await page.evaluate(() => ({ scene: Game.scene, floor: Game.run && Game.run.floorN, gear: Game.run && JSON.stringify(Game.run.gear), patches: Game.run && Game.run.patches.join(), hash: Game.run && floorHash(Game.run.floor) }));
    check(after.scene === 'run' && after.floor === 2, `Continue did not restore floor 2: ${JSON.stringify(after)}`);
    check(after.gear === before.gear, 'Continue changed the gear');
    check(after.patches === before.patches, 'Continue changed the patches');
    check(after.hash === before.hash, 'Continue rebuilt a different floor');
    // the Data isn't counted twice
    const banked2 = await page.evaluate(() => { const b = Save.meta.data; writeCheckpoint(); return [b, Save.meta.data]; });
    check(banked2[0] === banked2[1], `Data banked twice on resume: ${banked2}`);
    for (const e of errors) failures.push('checkpoint: page error: ' + e);
    await page.close();
  }

  // the checkpoint is a snapshot: gear equipped later in the floor stays out
  // of it, the Oracle's pill stays in, and Data banked when the page closed
  // mid-floor isn't banked again on the replay
  {
    const { page, errors } = await openGame(browser, {});
    const r = await page.evaluate(() => {
      UI.hide(); stopRain(); Save.meta.introSeen = true;
      startRun({ seed: 777 });
      const startGear = JSON.stringify(Game.run.gear);
      Game.run.pill = 'blue'; Game.run.hpCut = 0.15; Game.run.counter = ['strictgc']; Game.run.rareSeen = true; writeCheckpoint();
      equipItem(rollItem(Game.run.rng, { slot: 'coat', ilvl: 1, rarity: 2 }));
      Game.run.patches.push('sudo');
      Save.write();
      const leaked = JSON.stringify(Save.data.checkpoint.gear) !== startGear || Save.data.checkpoint.patches.length !== 0;
      addData(50); const bank0 = Save.meta.data;
      saveOnExit(); // the tab closes
      const bank1 = Save.meta.data;
      return { leaked, bank0, bank1 };
    });
    check(!r.leaked, 'gear or patches taken mid-floor leaked into the checkpoint');
    check(r.bank1 >= r.bank0 + 49, `closing the page didn't bank the floor's Data (${r.bank0} → ${r.bank1})`);
    await page.reload(); await ready(page);
    const r2 = await page.evaluate(() => {
      const bank = Save.meta.data;
      continueRun();
      const s = { coat: Game.run.gear.coat, patches: Game.run.patches.length, maxHp: Game.run.stats.maxHp, hpCut: Game.run.hpCut, counter: Game.run.counter.join(), rareSeen: Game.run.rareSeen };
      addData(50); commitData();
      return { ...s, gained: Save.meta.data - bank };
    });
    check(r2.coat === null && r2.patches === 0, 'Continue brought back gear taken after the checkpoint');
    check(r2.maxHp === Math.round(120 * 0.85), `the blue pill or the Backdoor's cut was lost on Continue (max integrity ${r2.maxHp})`);
    check(r2.hpCut === 0.15 && r2.counter === 'strictgc' && r2.rareSeen, `the Backdoor's cut, the countermeasures or bad-luck protection were lost on Continue: ${JSON.stringify(r2)}`);
    check(r2.gained <= 1, `the floor's Data was banked twice after a reload (${r2.gained} more)`);
    for (const e of errors) failures.push('snapshot: page error: ' + e);
    await page.close();
  }

  // broken saves
  for (const [label, raw] of [['garbage', '{not json'], ['wrong types', JSON.stringify({ settings: { music: 'loud', leftHanded: 'yes', autoScrap: null }, meta: { data: 'lots', upgrades: 5 }, records: { runs: -1 }, checkpoint: { seed: 'x' } })], ['empty object', '{}'], ['null', 'null']]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html'));
    await page.evaluate((raw) => { localStorage.clear(); localStorage.setItem('neo.save.v1', raw); }, raw);
    await page.reload(); await ready(page);
    const s = await page.evaluate(() => ({ music: Save.settings.music, data: Save.meta.data, cp: Save.data.checkpoint, scene: Game.scene }));
    check(typeof s.music === 'number' && Number.isFinite(s.data) && s.scene === 'title', `${label}: didn't fall back to defaults: ${JSON.stringify(s)}`);
    check(s.cp === null, `${label}: an invalid checkpoint was kept`);
    const meta = await page.evaluate(() => ({ tx: Save.meta.tx, txRead: Save.meta.txRead, counter: typeof Save.meta.counter }));
    check(meta.tx === 0 && meta.txRead === 0 && meta.counter === 'object', `${label}: the new progress fields have no defaults: ${JSON.stringify(meta)}`);
    // and the game still plays
    await page.evaluate(() => { UI.hide(); stopRain(); startRun({ seed: 5 }); for (let i = 0; i < 120; i++) Game.step(1 / 60); Game.render(); });
    for (const e of errors) failures.push(`${label}: page error: ${e}`);
    await page.close();
  }

  // storage that throws (private browsing on some phones)
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      const bad = () => { throw new Error('QuotaExceededError'); };
      Object.defineProperty(window, 'localStorage', { get: () => ({ getItem: bad, setItem: bad, removeItem: bad, clear: bad }) });
    });
    await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html'));
    await ready(page);
    await page.evaluate(() => { UI.hide(); stopRain(); startRun({ seed: 6 }); for (let i = 0; i < 120; i++) Game.step(1 / 60); writeCheckpoint(); endRun(false); });
    check(await page.evaluate(() => Save.ok === false), 'throwing storage was not noticed');
    for (const e of errors) failures.push('no storage: page error: ' + e);
    await page.close();
  }

  await browser.close();
  finish('save', failures);
})().catch((e) => { console.error(e); process.exit(1); });
