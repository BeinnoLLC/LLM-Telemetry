// LST-278: the Hive look lives in semantic theme tokens (tokens.css) and every
// text/background pair in both themes clears WCAG AA. Prints the contrast table.
const fs = require('fs');
const path = require('path');
const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const tokens = fs.readFileSync(path.join(WEB, 'tokens.css'), 'utf8');
const dash = fs.readFileSync(path.join(WEB, 'dashboard.css'), 'utf8');

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
const GRAD = { dark: ['#66ccff', '#ff66cc', '#77ff99', '#ffcc66'], light: ['#0b6fb3', '#b0287a', '#1a7f3c', '#8a5a00'] };
console.log('  theme  foreground          background        ratio  need');
for (const [name, b] of [['dark', dark], ['light', light]]) {
  const bg = tok(b, 'bg'), card = tok(b, 'card');
  const pairs = [
    ['--fg', tok(b, 'fg'), '--bg', bg, 4.5], ['--fg', tok(b, 'fg'), '--card', card, 4.5],
    ['--muted', tok(b, 'muted'), '--bg', bg, 4.5], ['--muted', tok(b, 'muted'), '--card', card, 4.5],
    ['--accent', tok(b, 'accent'), '--card', card, 4.5], ['--accent-ink', tok(b, 'accent-ink'), '--accent', tok(b, 'accent'), 4.5],
    ['--live-dot', tok(b, 'live-dot'), '--card', card, 3], ['--active-a', tok(b, 'active-a'), '--card', card, 3],
    ['--active-b', tok(b, 'active-b'), '--card', card, 3], ['--border-input', tok(b, 'border-input'), '--card', card, 3],
    ...GRAD[name].map((g, i) => ['title grad ' + (i + 1), g, '--bg', bg, 4.5]),
  ];
  for (const [fn, f, bn, bgc, need] of pairs) {
    const r = f && bgc ? ratio(f, bgc) : 0;
    console.log(`  ${name.padEnd(6)} ${(fn + ' ' + f).padEnd(19)}${(bn + ' ' + bgc).padEnd(18)}${r.toFixed(2).padStart(5)}  ${need}`);
    chk(r >= need, `${name} ${fn} on ${bn} >= ${need}`, r.toFixed(2));
  }
}
const D = { bg: '#05060a', fg: '#f5f5f5', muted: '#8a8f9a', card: '#0f1118', border: '#1d2130', 'border-strong': '#262a36', 'live-dot': '#55ff88', 'active-a': '#88aaff' };
for (const [k, v] of Object.entries(D)) chk((tok(dark, k) || '').toLowerCase() === v, `dark --${k} is the Hive ${v}`, tok(dark, k));
chk(/--radius-ctl:10px/.test(tokens), '--radius-ctl is 10px');
chk(/Inter,/.test(tokens), 'font stack leads with Inter');
chk(/--grad-title:linear-gradient\(90deg,#66ccff,#ff66cc,#77ff99,#ffcc66,#66ccff\)/.test(dark), 'dark title gradient is #6cf,#f6c,#7f9,#fc6, first stop repeated (cyclic)');
chk(/font-variant-numeric:var\(--num\)/.test(dash), 'body uses tabular numbers');
// no hard-coded hex colour inside component rules (comments stripped)
const code = dash.replace(/\/\*[\s\S]*?\*\//g, '');
const hex = code.match(/[:(,]\s*#[0-9a-fA-F]{3,8}(?=[;,)\s}!])/g) || [];
chk(hex.length === 0, 'no hard-coded hex colours in dashboard.css rules', hex.slice(0, 5).join(' '));
// reduced motion
chk(/\.dot\{background:var\(--z-warn\);box-shadow:none\}/.test(dash), 'stale/old dot drops the live glow');
chk(/prefers-reduced-motion:reduce\)\{\s*#appbar \.ab-title[^}]*animation:none/.test(dash), 'reduced motion stops the title gradient animation');
chk(/prefers-reduced-motion:reduce\)\{[\s\S]*?\.dot[^}]*animation:none;box-shadow:none/.test(dash), 'reduced motion stops the live-dot pulse and glow');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
