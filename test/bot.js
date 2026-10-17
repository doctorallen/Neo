'use strict';
// The autopilot plays whole runs on a phone-sized page:
//  - invulnerable, on several seeds: every run must reach the Agent and beat
//    him, with no page errors and never stuck in a room, so every floor of
//    those seeds can be finished;
//  - mortal, on more seeds: no errors and never stuck, and the results (how
//    far, how long, what killed it) are printed and written to
//    test/out/balance.json for docs/BALANCE.md.
// `node test/bot.js --mortal 20` plays more mortal runs.
const fs = require('fs');
const path = require('path');
const { launch, openGame, outDir, finish } = require('./lib');
const { installBot } = require('./botlib');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const GOD_SEEDS = [3, 7, 11];
const MORTAL = arg('--mortal', 6);

const HUMAN = { react: 0.25, notice: 0.7, aimErr: 25 };

async function play(browser, seed, god, depth = 1, skill = null) {
  const { page, errors } = await openGame(browser, {});
  await page.evaluate(installBot);
  const r = await page.evaluate((seed, god, depth, skill) => {
    UI.hide(); stopRain(); Save.meta.introSeen = true; Save.meta.tutorialDone = false;
    startRun({ seed, depth });
    return Bot.play({ god, seconds: 900, skill });
  }, seed, god, depth, skill);
  r.pageErrors = errors.slice();
  await page.close();
  return r;
}

(async () => {
  const browser = await launch();
  const failures = [];
  const results = { god: [], mortal: [] };
  for (const seed of GOD_SEEDS) {
    const r = await play(browser, seed, true);
    results.god.push({ seed, ...r.end, floors: r.floors });
    const where = `god seed ${seed}`;
    if (!r.end.victory) failures.push(`${where}: didn't win (floor ${r.end.floor}, ${r.end.time}s)`);
    for (const s of r.stuck) failures.push(`${where}: ${s}`);
    for (const e of r.errors.concat(r.pageErrors)) failures.push(`${where}: ${e}`);
    console.log(`bot: ${where}: ${r.end.victory ? 'won' : 'lost'} in ${r.end.time}s, floors ${r.floors.map((f) => f.time).join('/')}, ${r.end.kills} kills, ${r.modals} decisions`);
  }
  for (let i = 0; i < MORTAL; i++) {
    const seed = 1000 + i * 37;
    const r = await play(browser, seed, false, 1, HUMAN);
    results.mortal.push({ seed, ...r.end, floors: r.floors });
    const where = `mortal seed ${seed}`;
    for (const s of r.stuck) failures.push(`${where}: ${s}`);
    for (const e of r.errors.concat(r.pageErrors)) failures.push(`${where}: ${e}`);
    console.log(`bot: ${where}: ${r.end.victory ? 'WON' : `died on floor ${r.end.floor} to ${r.end.killedBy}`} at ${r.end.time}s; floors ${r.floors.map((f) => f.time).join('/')}; lowest integrity ${Math.round(r.hpLow * 100)}%`);
  }
  await browser.close();
  const m = results.mortal;
  if (m.length) {
    const wins = m.filter((r) => r.victory).length;
    const avgFloor = m.reduce((a, r) => a + r.floor, 0) / m.length;
    console.log(`bot: mortal runs: ${wins}/${m.length} won, average floor reached ${avgFloor.toFixed(1)}`);
  }
  fs.writeFileSync(path.join(outDir(), 'balance.json'), JSON.stringify(results, null, 1));
  finish('bot', failures);
})().catch((e) => { console.error(e); process.exit(1); });
