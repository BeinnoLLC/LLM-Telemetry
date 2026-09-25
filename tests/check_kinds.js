// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Failure-kind colours must be consistent across widgets AND distinguishable.
//
// Regression guard for two real bugs:
//  1. The drawer chips (.k-* CSS) and the health bars (FKIND) were maintained
//     separately and disagreed: 'unavailable' was purple in one, grey in the
//     other; 'auth' and 'server_error' were the SAME red in the CSS.
//  2. 'unavailable' grey sat on top of the empty-track grey, so a model that
//     failed 100% of its calls looked identical to one with no data.
const fs = require('fs'), { JSDOM } = require('jsdom');

const html = fs.readFileSync(REPORTS+'/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
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
const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const ok = (c, l, x) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); c ? pass++ : fail++; };

// sRGB -> CIE Lab, then CIE76 distance. Below ~12 reads as "same colour".
function lab(hex) {
  const m = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255);
  const f = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const [r, g, b] = m.map(f);
  const X = (r * .4124 + g * .3576 + b * .1805) / .95047;
  const Y = (r * .2126 + g * .7152 + b * .0722);
  const Z = (r * .0193 + g * .1192 + b * .9505) / 1.08883;
  const k = t => t > .008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * k(Y) - 16, 500 * (k(X) - k(Y)), 200 * (k(Y) - k(Z))];
}
const dE = (a, b) => { const A = lab(a), B = lab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };

setTimeout(() => {
  try {
    const FKIND = w.eval('typeof FKIND!=="undefined"?JSON.parse(JSON.stringify(FKIND)):null');
    ok(!!FKIND, 'FKIND reachable');
    const kinds = Object.keys(FKIND);
    ok(kinds.length >= 6, `failure kinds defined (${kinds.length})`);

    // 1. Generated CSS must exist for EVERY kind and match FKIND exactly.
    const sheets = [...d.querySelectorAll('style')].map(s => s.textContent).join('\n');
    let matched = 0, mism = [];
    kinds.forEach(k => {
      const re = new RegExp(`\\.k-${k}\\{background:([^;]+);color:([^}]+)\\}`);
      const m = sheets.match(re);
      if (!m) { mism.push(`${k}: no rule`); return; }
      if (m[2].trim().toLowerCase() !== FKIND[k].c.toLowerCase()) {
        mism.push(`${k}: css ${m[2]} vs FKIND ${FKIND[k].c}`);
      } else matched++;
    });
    ok(matched === kinds.length, `every kind has generated CSS matching FKIND (${matched}/${kinds.length})`,
       mism.length ? mism.join('; ') : '');

    // 2. No two kinds may share a colour (auth vs server_error regression).
    let worst = [1e9, '', ''];
    for (let i = 0; i < kinds.length; i++)
      for (let j = i + 1; j < kinds.length; j++) {
        const dd = dE(FKIND[kinds[i]].c, FKIND[kinds[j]].c);
        if (dd < worst[0]) worst = [dd, kinds[i], kinds[j]];
      }
    ok(worst[0] > 12, `closest kind pair is distinguishable`,
       `${worst[1]} vs ${worst[2]} dE=${worst[0].toFixed(1)}`);

    // 3. 'unavailable' must stand clear of the empty-track colour.
    const BD = w.eval('typeof BD!=="undefined"?BD:null');
    if (BD && /^#/.test(BD)) {
      ok(dE(FKIND.unavailable.c, BD) > 25,
         `unavailable distinct from empty track`, `dE=${dE(FKIND.unavailable.c, BD).toFixed(1)}`);
    } else ok(true, 'empty-track colour not a hex (skipped)');

    // 4. A 100%-failure row must carry the red fail track.
    w.eval("pickView('Health')");
    const rows = [...d.querySelectorAll('#healthgrid > div')];
    ok(rows.length > 0, `health rows rendered (${rows.length})`);
    const DATA = w.eval('typeof DATA!=="undefined"?DATA:null');
    const cur = w.eval('current');
    const H = (DATA.profiles[cur].health || []).filter(h => h.total > 0).slice(0, 14);
    const deadIdx = H.findIndex(h => h.fail === h.total);
    if (deadIdx >= 0) {
      const track = rows[deadIdx].querySelector('.flex-1');
      const bg = track ? track.getAttribute('style') || '' : '';
      ok(/rgba\(239,68,68/.test(bg),
         `100%-failure row "${H[deadIdx].model}" uses the red fail track`, bg.slice(0, 60));
      const live = H.findIndex(h => h.fail !== h.total);
      if (live >= 0) {
        const t2 = rows[live].querySelector('.flex-1');
        ok(!/rgba\(239,68,68/.test(t2.getAttribute('style') || ''),
           `partially-ok row "${H[live].model}" keeps the normal track`);
      }
    } else ok(true, 'no 100%-failure row in range (skipped)');

    // 5. Drawer chips actually pick up the generated colours.
    const chip = d.querySelector('#dbody .k');
    if (chip) {
      const c = w.getComputedStyle(chip).color;
      ok(!!c && c !== 'rgba(0, 0, 0, 0)', `drawer chip is coloured`, c);
    } else ok(true, 'no drawer events right now (skipped)');

  } catch (e) { ok(false, 'threw: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1400);
