// Guards the responsive fixes in #15 (.grid-2) and #16 (dvh) against silent
// regression. Both were re-introduced once after being "fixed" without
// verification, so they get asserted against the built HTML rather than trusted.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');
const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
  }
});
const w = dom.window, d = w.document;
let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };

setTimeout(() => {
  // ---- #15: no inline two-column grid may survive in the output ------------
  // `1fr 1fr` produces two fixed tracks that squash a canvas and overflow
  // sideways on a narrow viewport. .grid-2 is auto-fit and reflows to one column.
  chk(!/grid-template-columns:\s*1fr 1fr/.test(raw),
    'no inline `1fr 1fr` grid remains in the built HTML');

  const g2 = [...d.querySelectorAll('.grid-2')];
  chk(g2.length >= 4, 'chart rows use .grid-2', `(${g2.length})`);

  // The class must actually be auto-fit, not just present.
  const tpl = g2.map(e => w.getComputedStyle(e).gridTemplateColumns).filter(Boolean);
  chk(tpl.length === 0 || tpl.every(t => !/^\s*1fr\s+1fr\s*$/.test(t)),
    '.grid-2 does not resolve to two hardcoded tracks');

  // Children need min-width:0 or a canvas sets the track's min-content width.
  const kids = g2.flatMap(e => [...e.children]);
  chk(kids.length > 0 && kids.every(k => w.getComputedStyle(k).minWidth === '0px'),
    '.grid-2 children carry min-width:0', `(${kids.length} children)`);

  // ---- #16: dynamic viewport units, with a vh fallback --------------------
  // On mobile Safari/Chrome, 100vh counts the collapsing URL bar, so a pane
  // sized to it is taller than the visible area and its bottom is unreachable.
  const dvh = (raw.match(/100dvh/g) || []).length;
  const vh = (raw.match(/100vh/g) || []).length;
  chk(dvh >= 3, 'viewport-sized panes use dvh', `(${dvh} occurrences)`);
  chk(vh >= dvh, 'a vh fallback is kept for browsers without dvh', `(${vh} vh / ${dvh} dvh)`);

  // Every dvh must be paired: a lone dvh declaration would be dropped whole by
  // an old browser, collapsing the element instead of degrading to vh.
  const flow = /#flowwrap\{[^}]*\}/.exec(raw);
  chk(!!flow && /100vh/.test(flow[0]) && /100dvh/.test(flow[0]),
    '#flowwrap declares vh then overrides with dvh');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 1400);
