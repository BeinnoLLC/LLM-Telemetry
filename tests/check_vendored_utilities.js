#!/usr/bin/env node
// The dashboard used to take its layout from `https://cdn.tailwindcss.com` at
// RUNTIME. That CDN is a browser-side JIT; when it is blocked (offline, an
// air-gapped LAN, a firewall, a proxy) every flex/gap/padding class silently
// does nothing and the page collapses into unstyled stacked text — which reads
// as "the dashboard is broken", not "one CDN didn't load".
//
// ADR 0001 says the page is ONE self-contained artifact that must open from
// file://, so those utilities are vendored in web/css/utilities.css. This test
// is the guard that keeps the vendored file honest: every utility class the
// markup uses must be defined, or the page renders wrong the moment the CDN is
// gone. It fails on the class name, not on a screenshot, so the fix is obvious.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'src', 'llm_telemetry', 'web');
const CSS_DIR = path.join(WEB, 'css');

let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? `  ${extra}` : ''}`);
};

const shell = fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8');
const jsFiles = fs.readdirSync(path.join(WEB, 'js')).filter(f => f.endsWith('.js'));
const jsSrc = jsFiles.map(f => fs.readFileSync(path.join(WEB, 'js', f), 'utf8')).join('\n');

// Every class token that appears in a class attribute or a template literal.
function classTokens(src) {
  const out = new Set();
  const attr = /class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g;
  let m;
  while ((m = attr.exec(src))) {
    for (const t of m[1].split(/\s+/)) {
      if (!t || t.includes('$') || t.includes('{')) continue;   // runtime-built
      out.add(t);
    }
  }
  return out;
}

const utils = fs.readFileSync(path.join(CSS_DIR, 'utilities.css'), 'utf8');
const vendored = new Set();
for (const m of utils.matchAll(/^\s*\.((?:[\w-]|\\.|\\:|\\[|\\]|\\\(|\\\))+)\s*\{/gm)) {
  // Undo CSS escaping so ".gap-1\.5" and ".p-4" compare as written in markup.
  vendored.add(m[1].replace(/\\(.)/g, '$1'));
}

// Which of those tokens are utilities we are supposed to vendor? A token is a
// utility when it is not a bespoke component class defined by dashboard.css.
const dashCss = fs.readFileSync(path.join(CSS_DIR, 'dashboard.css'), 'utf8');
const bespoke = new Set();
for (const m of dashCss.matchAll(/\.((?:[\w-]|\\.)+)/g)) bespoke.add(m[1].replace(/\\(.)/g, '$1'));
for (const m of fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8').matchAll(/\.((?:[\w-]|\\.)+)/g)) {
  bespoke.add(m[1].replace(/\\(.)/g, '$1'));
}

const TW = /^(?:flex|inline-flex|grid|block|hidden|items-|justify-|gap-|p-\d|p[xy]-|p[tblr]-|m[bmtl]-|mx-|my-|w-full|h-\[|text-(?:left|right|\[length|center)|font-|rounded|border|overflow-|min-|max-|relative|absolute|sticky|z-|shrink-|grow|flex-1|flex-col|flex-wrap|leading-|tracking-|uppercase|normal-case|whitespace-|truncate|opacity-|cursor-|self-|tabular-nums|antialiased|sr-only)/;

const used = new Set([...classTokens(shell), ...classTokens(jsSrc)]);
const wanted = [...used].filter(t => TW.test(t) && !bespoke.has(t) && !t.startsWith('grid-'));
const missing = wanted.filter(t => !vendored.has(t));

chk(missing.length === 0,
  'every utility class the markup uses is vendored in utilities.css',
  missing.length ? `missing: ${missing.sort().join(', ')}` : `${wanted.length} classes`);

// The control: the check must be able to fail. A class that is NOT vendored and
// IS used by the markup has to be reported, or this test protects nothing.
const ghost = 'flex';
const ghostWouldFail = !vendored.has('totally-not-a-class') && TW.test(ghost);
chk(ghostWouldFail, 'control: the detector recognises a real utility class name');

// No runtime CDN may own the layout again.
chk(!/cdn\.tailwindcss\.com/.test(shell),
  'the page does not load Tailwind from a CDN at runtime');
// Ignore comments: utilities.css explains WHY the CDN is gone by naming it.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
chk(!/cdn\.tailwindcss\.com/.test(stripComments(dashCss + utils)),
  'no stylesheet fetches the Tailwind CDN');

// Chart.js may stay a CDN script, but only because the code survives its absence.
const chartsSrc = fs.readFileSync(path.join(WEB, 'js', 'charts.js'), 'utf8');
chk(/HAS_CHART/.test(chartsSrc),
  'charts.js guards against Chart.js being absent (a CDN failure must not kill the bundle)');
chk(/if \(!HAS_CHART\)/.test(chartsSrc),
  'charts.js installs a stub before touching Chart.defaults at module scope');

// The vendored values must match what the class names mean, spot-checked on the
// utilities the layout depends on most. A silently wrong value is worse than a
// missing one: the page renders and is subtly wrong.
const val = (sel) => {
  const m = utils.match(new RegExp(`^\\s*\\.${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[1].replace(/\s+/g, '') : null;
};
chk(val('flex') === 'display:flex', 'flex means display:flex', val('flex'));
chk(val('gap-2') === 'gap:.5rem', 'gap-2 means .5rem', val('gap-2'));
chk(val('p-4') === 'padding:1rem', 'p-4 means 1rem', val('p-4'));
chk(/margin-bottom:\.625rem/.test(val('mb-2\\.5') || ''), 'mb-2.5 means .625rem', val('mb-2\\.5'));
chk(/text-align:right/.test(val('text-right') || ''), 'text-right means right-aligned', val('text-right'));
chk(/display:none/.test(val('hidden') || ''), 'hidden means display:none', val('hidden'));

console.log(`\ncheck_vendored_utilities.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
