'use strict';
// ---------------------------------------------------------------------------
// A 3×5 pixel font for text drawn inside the world buffer: damage numbers,
// name tags, the payphone's RING, ACCESS GRANTED. Menus use the DOM and the
// VT323 font instead. Lower case is drawn as upper case. Each glyph is five
// rows of three bits; glyphs are cached per colour as small canvases.
// ---------------------------------------------------------------------------

const FONT3 = {
  'A': '010101111101101', 'B': '110101110101110', 'C': '011100100100011', 'D': '110101101101110',
  'E': '111100110100111', 'F': '111100110100100', 'G': '011100101101011', 'H': '101101111101101',
  'I': '111010010010111', 'J': '001001001101010', 'K': '101101110101101', 'L': '100100100100111',
  'M': '101111111101101', 'N': '110101101101101', 'O': '010101101101010', 'P': '110101110100100',
  'Q': '010101101110011', 'R': '110101110101101', 'S': '011100010001110', 'T': '111010010010010',
  'U': '101101101101111', 'V': '101101101101010', 'W': '101101111111101', 'X': '101101010101101',
  'Y': '101101010010010', 'Z': '111001010100111',
  '0': '111101101101111', '1': '010110010010111', '2': '110001010100111', '3': '110001010001110',
  '4': '101101111001001', '5': '111100110001110', '6': '011100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001110',
  '.': '000000000000010', ',': '000000000010100', ':': '000010000010000', '!': '010010010000010',
  '?': '110001010000010', '-': '000000111000000', '+': '000010111010000', '/': '001001010100100',
  '%': '101001010100101', '(': '010100100100010', ')': '010001001001010', '_': '000000000000111',
  "'": '010010000000000', '>': '100010001010100', '<': '001010100010001', '#': '101111101111101',
  '=': '000111000111000', '*': '000101010101000', '[': '110100100100110', ']': '011001001001011',
  '|': '010010010010010', '"': '101101000000000', '…': '000000000000101', ' ': '000000000000000',
};
const FONT3_W = 3, FONT3_H = 5;

const _glyphCache = new Map();
function glyph3(ch, col) {
  const key = ch + col;
  let g = _glyphCache.get(key);
  if (g) return g;
  const bits = FONT3[ch] || FONT3['?'];
  const [c, x] = makeCanvas(FONT3_W, FONT3_H);
  x.fillStyle = col;
  for (let j = 0; j < FONT3_H; j++) for (let i = 0; i < FONT3_W; i++) if (bits[j * 3 + i] === '1') x.fillRect(i, j, 1, 1);
  _glyphCache.set(key, c);
  return c;
}

function textWidth3(s, scale = 1) { return s.length ? (s.length * (FONT3_W + 1) - 1) * scale : 0; }

// Draws text with its top-left at x, y. `align` 'center' centres on x.
// `shadow` draws a 1px dark copy below-right first, for legibility.
function drawText3(ctx, s, x, y, col = '#d8ffd8', { align = 'left', scale = 1, shadow = '#000000' } = {}) {
  s = String(s).toUpperCase();
  if (align === 'center') x -= textWidth3(s, scale) / 2;
  else if (align === 'right') x -= textWidth3(s, scale);
  x = Math.round(x); y = Math.round(y);
  const step = (FONT3_W + 1) * scale;
  for (let pass = shadow ? 0 : 1; pass < 2; pass++) {
    const c = pass === 0 ? shadow : col, o = pass === 0 ? scale : 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === ' ') continue;
      ctx.drawImage(glyph3(s[i], c), x + i * step + o, y + o, FONT3_W * scale, FONT3_H * scale);
    }
  }
}
