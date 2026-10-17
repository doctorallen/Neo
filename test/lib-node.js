'use strict';
// The verdict for the Node-only tests (no Chrome needed).
function finish(name, failures) {
  if (failures.length) { console.error(`${name}: FAIL\n  ` + failures.slice(0, 60).join('\n  ') + (failures.length > 60 ? `\n  …and ${failures.length - 60} more` : '')); process.exit(1); }
  console.log(`${name}: ok`);
}
module.exports = { finish };
