// LST-309 (design-audit mismatch 4): --z-*-fg is text on the light surfaces
// (page bg and card). This guard recomputes every --z-*-fg contrast straight
// from tokens.css (WCAG 2.1 sRGB relative-luminance formula) and fails below
// 4.5:1 in EITHER theme. The dark --z-*-fg values are pinned to their Hive
// values so the light-theme contrast fix can never drift the dark palette
// ("dark theme stays unchanged"). The filled pill (.navbadge.alert light
// override, .qv-astat.qv-bad) pairs its --z-bad fill with --card text; that
// pair is guarded here too.
const fs = require('fs');
const path = require('path');
const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const tokens = fs.readFileSync(path.join(WEB, 'tokens.css'), 'utf8');

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};
const block = sel => { const i = tokens.indexOf(sel); return tokens.slice(i, tokens.indexOf('\n}', i)); };
const tok = (b, n) => (new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})\\b').exec(b) || [])[1];
const lin = c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
const lum = h => [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16))).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };

const dark = block('[data-theme="dark"]{'), light = block(':root,\n[data-theme="light"]{');
console.log('  theme  foreground          surface            ratio  need');
for (const [name, b] of [['dark', dark], ['light', light]]) {
  const bg = tok(b, 'bg'), card = tok(b, 'card');
  const pairs = [];
  for (const z of ['ok', 'warn', 'bad']) {
    pairs.push([`--z-${z}-fg`, tok(b, `z-${z}-fg`), '--bg', bg]);
    pairs.push([`--z-${z}-fg`, tok(b, `z-${z}-fg`), '--card', card]);
  }
  // filled pill: --card text on the solid --z-bad fill
  pairs.push(['--card (pill)', card, '--z-bad fill', tok(b, 'z-bad')]);
  for (const [fn, f, bn, bgc] of pairs) {
    const r = f && bgc ? ratio(f, bgc) : 0;
    console.log(`  ${name.padEnd(6)} ${(fn + ' ' + f).padEnd(19)}${(bn + ' ' + bgc).padEnd(19)}${r.toFixed(2).padStart(5)}  4.5`);
    chk(r >= 4.5, `${name} ${fn} on ${bn} >= 4.5`, r.toFixed(2));
  }
}
// dark theme stays unchanged (LLMTELEMET-309 fixes the light values only)
const D = { 'z-ok-fg': '#dff0e4', 'z-warn-fg': '#f4ecda', 'z-bad-fg': '#f7e3e3' };
for (const [k, v] of Object.entries(D)) {
  chk((tok(dark, k) || '').toLowerCase() === v, `dark --${k} is ${v} (unchanged)`, tok(dark, k));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
