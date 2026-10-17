'use strict';
// Draws the home-screen icons (a pixel "N" in phosphor green over falling
// code) and writes icons/icon-{180,192,512}.png. Run once after changing the
// design: node tools/make-icons.js
const fs = require('fs');
const path = require('path');
const { launch } = require('../test/lib');

(async () => {
  const browser = await launch();
  const page = await browser.newPage();
  await page.setContent('<canvas id="c"></canvas>');
  for (const size of [180, 192, 512]) {
    const data = await page.evaluate((size) => {
      const c = document.getElementById('c'); c.width = c.height = size;
      const x = c.getContext('2d');
      const px = size / 32;
      x.fillStyle = '#010302'; x.fillRect(0, 0, size, size);
      // faint columns of code
      let s = 7;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      for (let col = 0; col < 32; col += 2) {
        const head = Math.floor(rnd() * 40) - 4;
        for (let r = 0; r < 32; r++) {
          const d = head - r;
          if (d < 0 || d > 12 || rnd() < 0.35) continue;
          x.fillStyle = `rgba(60,255,110,${0.05 + 0.25 * (1 - d / 12)})`;
          x.fillRect(col * px, r * px, px, px);
        }
      }
      // the N, eight pixels wide and twelve tall, with a glow
      const N = ['11000011', '11100011', '11110011', '11011011', '11011011', '11001111', '11001111', '11000111', '11000011', '11000011', '11000011', '11000011'];
      const ox = 12, oy = 10;
      x.shadowColor = '#3cff6e'; x.shadowBlur = px * 2;
      for (let j = 0; j < N.length; j++) for (let i = 0; i < 8; i++) if (N[j][i] === '1') { x.fillStyle = j < 2 ? '#eaffef' : '#3cff6e'; x.fillRect((ox + i) * px, (oy + j) * px, px, px); }
      return c.toDataURL('image/png');
    }, size);
    fs.writeFileSync(path.join(__dirname, '..', 'icons', `icon-${size}.png`), Buffer.from(data.split(',')[1], 'base64'));
  }
  await browser.close();
  console.log('icons written');
})();
