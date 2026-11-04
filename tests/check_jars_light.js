// Light-theme task-queue jar material: contrast numbers computed from the --jar-* tokens in
// tokens.css (WCAG 2.x relative luminance), plus a guard that every light rule is scoped so
// the dark theme cannot be touched.
const fs = require('fs');
const path = require('path');
const css = n => fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', n), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, name, got) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); } };

const tokens = css('tokens.css');
const lightBlock = tokens.match(/:root,\s*\[data-theme="light"\]\{([\s\S]*?)\n\}/)[1];
const tok = {};
for (const m of lightBlock.matchAll(/--([\w-]+):\s*hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*(?:\/\s*[\d.]+)?\)/g)) tok[m[1]] = [+m[2], +m[3], +m[4]];

const lum = ([h, s, l]) => {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l), k = n => (n + h / 30) % 12;
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(f(0)) + 0.7152 * lin(f(8)) + 0.0722 * lin(f(4));
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const card = [0, 0, 100];
const need = ['jar-glass', 'jar-edge', 'jar-ink', 'jar-label', 'jar-label-soft', 'jar-ring', 'jar-glow', 'jar-hermes', 'jar-pi', 'jar-claude', 'jar-codex', 'jar-wait'];
chk(need.every(k => tok[k]), 'light jar tokens are all hsl() custom properties', need.filter(k => !tok[k]).join(','));

const r = (a, b) => +ratio(tok[a], b === 'card' ? card : tok[b]).toFixed(2);
chk(r('jar-edge', 'card') >= 3, 'jar outline >= 3:1 vs the card', r('jar-edge', 'card'));
chk(r('jar-edge', 'jar-glass') >= 3, 'jar outline >= 3:1 vs the jar glass', r('jar-edge', 'jar-glass'));
for (const k of ['jar-label', 'jar-label-soft']) chk(r(k, 'jar-glass') >= 4.5 && r(k, 'card') >= 4.5, `${k} >= 4.5:1 on glass and card`, `${r(k, 'jar-glass')}/${r(k, 'card')}`);
chk(r('jar-ink', 'jar-glass') >= 4.5, 'count text on the lid >= 4.5:1', r('jar-ink', 'jar-glass'));
for (const k of ['jar-hermes', 'jar-pi', 'jar-claude', 'jar-codex', 'jar-wait']) {
  chk(r(k, 'jar-glass') >= 3, `${k} marble >= 3:1 vs jar glass`, r(k, 'jar-glass'));
  chk(r('jar-ink', k) >= 4.5, `${k} glyph >= 4.5:1 on the marble`, r('jar-ink', k));
}
chk(r('jar-ring', 'jar-glass') >= 3 && r('jar-glow', 'jar-glass') >= 3, 'ring and glow cues >= 3:1 vs jar glass', `${r('jar-ring', 'jar-glass')}/${r('jar-glow', 'jar-glass')}`);

const dash = css('dashboard.css');
const rules = dash.slice(dash.indexOf('task queue, LIGHT theme material')).replace(/^[^]*?\*\/\s*/, '');
const sels = [...rules.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)].map(m => m[1].trim()).filter(s => !s.startsWith('/*'));
chk(sels.length > 20 && sels.every(s => s.split(',').every(p => p.trim().startsWith(':root:not([data-theme="dark"]) #qcard'))), 'every light rule is scoped to :root:not([data-theme="dark"]) #qcard', sels.length);
chk(!/#[0-9a-fA-F]{3,8}\b/.test(rules), 'light rules use no hex literals');
chk(/\.qt-ball\.qt-warn\{outline:2px dashed var\(--jar-ring\)/.test(rules) && /\.qt-sw-ring\{[^}]*dashed/.test(rules) && /\.qt-sw-glow\{[^}]*--jar-glow/.test(rules), 'ring is a 2px dashed outline; glow and ring legend swatches are restyled');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
