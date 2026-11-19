// LST-310: --accent2 is used as text in light theme (.olbadge on the
// accent-wash badge, .costpulse, .rt-hits), so its light value must clear
// WCAG 2.1 body-text AA (4.5:1) against --bg and --card — computed here from
// tokens.css, not asserted from a hard-coded hex. Chart/bar strokes only need
// the 3:1 graphic floor. Dark theme must clear AA too and keeps its own value.
const fs = require('fs');
const path = require('path');
const tokens = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'tokens.css'), 'utf8');

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

const block = sel => {
  const i = tokens.indexOf(sel);
  return i < 0 ? '' : tokens.slice(i, tokens.indexOf('\n}', i));
};
const hex = (b, n) => (new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})\\b').exec(b) || [])[1];
const rgba = (b, n) => {
  const m = new RegExp('--' + n + ':\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)').exec(b);
  return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
};
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
const over = ([r, g, b, a], bg) => [0, 1, 2].map(i => a * [r, g, b][i] + (1 - a) * bg[i]);
const hue = ([r, g, b]) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

const light = block(':root,\n[data-theme="light"]{'), dark = block('[data-theme="dark"]{');
for (const [name, b] of [['light', light], ['dark', dark]]) {
  chk(!!hex(b, 'accent2') && !!hex(b, 'bg') && !!hex(b, 'card'), `${name} block declares --accent2/--bg/--card as hex`);
}
const lA2 = rgbOf(hex(light, 'accent2')), lBg = rgbOf(hex(light, 'bg')), lCard = rgbOf(hex(light, 'card'));
const wash = rgba(light, 'accent-wash');
chk(!!wash, 'light block declares --accent-wash as rgba (the .olbadge text surface)');
const badgeBg = over(wash, lCard);

// Body-text AA for every light text use of --accent2.
for (const [surface, rgb] of [['--bg', lBg], ['--card', lCard], ['accent-wash badge', badgeBg]]) {
  const r = +ratio(lA2, rgb).toFixed(2);
  chk(r >= 4.5, `light --accent2 text on ${surface} >= 4.5:1`, r);
}
// Chart/bar strokes: the graphic floor. Same token, on the white card.
const g = +ratio(lA2, lCard).toFixed(2);
chk(g >= 3, 'light --accent2 chart/bar strokes >= 3:1 on --card', g);
// Hue family guard: the muted blue-grey band (original #7793a2 is hue ~201).
const h = Math.round(hue(lA2));
chk(h >= 180 && h <= 220, 'light --accent2 keeps its blue-grey hue family', h + 'deg');
// Dark keeps its own value and its own AA (unchanged by LST-310).
const dA2 = rgbOf(hex(dark, 'accent2')), dBg = rgbOf(hex(dark, 'bg')), dCard = rgbOf(hex(dark, 'card'));
for (const [surface, rgb] of [['--bg', dBg], ['--card', dCard]]) {
  const r = +ratio(dA2, rgb).toFixed(2);
  chk(r >= 4.5, `dark --accent2 text on ${surface} >= 4.5:1`, r);
}

const log = (a, b, r) => console.log(`  contrast ${a} vs ${b}: ${r}:1`);
log('light --accent2 ' + hex(light, 'accent2'), '--bg', +ratio(lA2, lBg).toFixed(2));
log('light --accent2 ' + hex(light, 'accent2'), '--card', +ratio(lA2, lCard).toFixed(2));
log('light --accent2 ' + hex(light, 'accent2'), 'accent-wash badge', +ratio(lA2, badgeBg).toFixed(2));
log('dark  --accent2 ' + hex(dark, 'accent2'), '--card', +ratio(dA2, dCard).toFixed(2));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
