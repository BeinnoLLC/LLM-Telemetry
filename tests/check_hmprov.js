// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Verify the activity heatmap tints cells by PROVIDER.
//   - cells carry an inline background derived from provOf()
//   - a multi-provider day renders proportional gradient bands
//   - band widths match the real call shares
//   - the legend lists the providers present
//   - single-provider days stay flat (no pointless gradient)
const fs = require('fs'), { JSDOM } = require('jsdom');

// Strip the CDN script tags: jsdom does not fetch them, and the resulting
// "Chart is not defined" kills the whole page script (renderHeatmap included).
const html = fs.readFileSync(REPORTS+'/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
// url: opaque origins have no localStorage, and boot() writes to it.
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {},
      plugins: { legend: { labels: { generateLabels: () => [] } } } };
    w.Chart.overrides = { doughnut: { plugins: { legend: { labels: { generateLabels: () => [] } } } } };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    const live = JSON.parse(fs.readFileSync(REPORTS+'/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
  }
});
const w = dom.window;

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  ok   ' : '  FAIL ') + m); };

w.addEventListener('load', () => {
  setTimeout(() => {
    const cells = [...w.document.querySelectorAll('.hm-grid .hm-d:not(.hm-pad)')];
    ok(cells.length > 300, `calendar rendered a year of cells (${cells.length})`);

    const active = cells.filter(c => (c.getAttribute('style') || '').includes('background'));
    ok(active.length > 0, `${active.length} active days carry an inline provider background`);

    // Recompute expected shares straight from the payload and compare.
    const DATA = w.eval('typeof DATA!=="undefined"?DATA:null');
    // Call provOf INSIDE the page (w.eval returns the fn but invoking it from
    // Node re-enters a different scope chain and trips the const TDZ).
    const provOf = (p, m, url) => w.eval(
      `provOf(${JSON.stringify(p||'')},${JSON.stringify(m||'')},${JSON.stringify(url||'')})`);
    ok(!!DATA && typeof provOf('anthropic','claude','') === 'string', 'DATA + provOf reachable');

    const prof = Object.values(DATA.profiles)[0];
    const day = {};
    (prof.heatmap || []).forEach(x => {
      const k = provOf(x.p, x.m, x.url);
      (day[x.d] ||= {})[k] = ((day[x.d] || {})[k] || 0) + x.v;
    });

    // Rows must be the post-split shape, else everything below is vacuous.
    ok((prof.heatmap || []).every(x => 'p' in x && 'm' in x),
       'payload rows carry provider fields (p/url/m)');

    const multi = Object.entries(day).filter(([, p]) => Object.keys(p).length > 1);
    ok(multi.length > 0, `${multi.length} days genuinely mix providers`);

    // Pick the busiest mixed day and check its gradient stops.
    const [mday, mprov] = multi.sort((a, b) =>
      Object.values(b[1]).reduce((x, y) => x + y, 0) -
      Object.values(a[1]).reduce((x, y) => x + y, 0))[0];
    const el = cells.find(c => (c.getAttribute('title') || '').startsWith(mday));
    ok(!!el, `found the cell for mixed day ${mday}`);

    const style = el ? el.getAttribute('style') || '' : '';
    ok(style.includes('linear-gradient'), 'mixed day uses a hard-stop gradient');

    // Parse the band END stops. Careful: each colour is a color-mix(... 86%, ...)
    // whose own percentage would match a naive /([\d.]+)%/ — so match only the
    // two-percentage run that follows a closing paren.
    const total = Object.values(mprov).reduce((a, b) => a + b, 0);
    const top = Object.entries(mprov).sort((a, b) => b[1] - a[1])[0];
    const stops = [...style.matchAll(/\)\s+([\d.]+)%\s+([\d.]+)%/g)].map(m => parseFloat(m[2]));
    const expected = (top[1] / total) * 100;
    ok(stops.length === Object.keys(mprov).length,
       `one band per provider (${stops.length} bands, ${Object.keys(mprov).length} providers)`);
    ok(stops.length && Math.abs(stops[0] - expected) < 0.6,
       `first band ≈ dominant provider ${top[0]} (${expected.toFixed(1)}%, got ${stops[0]}%)`);
    ok(stops.length && Math.abs(stops[stops.length - 1] - 100) < 0.02,
       `bands fill the cell (last stop ${stops[stops.length - 1]}%)`);

    // Every provider in the day must appear in the tooltip.
    const tip = el ? el.getAttribute('title') || '' : '';
    const missing = Object.keys(mprov).filter(k => !tip.includes(k));
    ok(missing.length === 0, `tooltip names every provider (missing: ${missing.join(',') || 'none'})`);

    // Single-provider days must NOT get a gradient.
    const solo = Object.entries(day).find(([, p]) => Object.keys(p).length === 1);
    if (solo) {
      const sel = cells.find(c => (c.getAttribute('title') || '').startsWith(solo[0]));
      const ss = sel ? sel.getAttribute('style') || '' : '';
      ok(ss && !ss.includes('linear-gradient'), `single-provider day ${solo[0]} stays flat`);
    }

    // Legend lists providers actually present.
    const sw = [...w.document.querySelectorAll('.hm-key .hm-lg')];
    const all = new Set(Object.values(day).flatMap(p => Object.keys(p)));
    ok(sw.length === all.size,
       `legend lists ${sw.length} providers, payload has ${all.size}`);

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }, 2600);
});
