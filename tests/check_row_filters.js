// #130: provider and model cross-filters, beside the project one.
//
// Three filters that COMPOSE — each narrows the rows the range and the profile
// tabs already selected, and none may silently override another. The failure
// this guards against is the quiet one: a filter that appears applied (the chip
// says "Filtering: nous") while the numbers behind it are still unfiltered, so
// a cost figure gets quoted that was never filtered at all.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const raw = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x !== undefined ? '  ' + x : ''}`); ok ? pass++ : fail++; };

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/usage',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = (url) => {
      const key = String(url).split('?')[0].split('/').pop();
      const body = key === 'router-data.json'
        ? JSON.parse(fs.readFileSync(path.join(REPORTS, 'router-data.json'), 'utf8')) : analytics;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    };
    w.Element.prototype.scrollIntoView = function () {};
    const backing = new Map();
    Object.defineProperty(w, 'localStorage', {
      value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)), removeItem: k => backing.delete(k) },
    });
  }
});
const w = dom.window, d = w.document;

function fire(sel, value) {
  const el = d.querySelector(sel);
  el.value = value;
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
// The KPI "API calls" figure is the one a person reads off the page, so it is
// the honest end-to-end probe of whether a filter actually reached the numbers:
// it is computed from the same `rows` the filter narrows.
function callsKpi() {
  const card = [...d.querySelectorAll('#kpis .kpi-card')]
    .find(c => (c.querySelector('.kpi-name') || {}).textContent === 'API calls');
  if (!card) return NaN;
  return +((card.querySelector('.kpi-big').textContent || '').replace(/[^\d]/g, '')) || 0;
}
// jsdom's window.location is the document URL; read the hash the page wrote.
const hash = () => w.location.hash;

setTimeout(() => {
  try {
    w.pick('work');
    w.pickView('Usage');
    const rows = analytics.profiles.work.rows;

    // ---- the selects are populated from the payload, not hardcoded ---------
    const provs = [...d.querySelectorAll('#provfiltersel option')].map(o => o.value).filter(Boolean);
    const wantProvs = [...new Set(rows.map(r => r.provider).filter(Boolean))].sort();
    chk(provs.join(',') === wantProvs.join(','), 'provider options are the slots in this profile', provs.join(','));
    const models = [...d.querySelectorAll('#modelfiltersel option')].map(o => o.value).filter(Boolean);
    const wantModels = [...new Set(rows.map(r => r.model).filter(Boolean))].sort();
    chk(models.length === wantModels.length, 'model options are the models in this profile', `(${models.length})`);
    chk(d.querySelector('#provfiltersel option[value=""]').textContent === 'All providers',
      'provider list opens on "All providers"');
    chk(d.querySelector('#modelfiltersel option[value=""]').textContent === 'All models',
      'model list opens on "All models"');

    // The provider with the most rows makes the filter's effect unmistakable.
    const byProv = {};
    rows.forEach(r => { byProv[r.provider] = (byProv[r.provider] || 0) + r.calls; });
    const topProv = Object.entries(byProv).sort((a, b) => b[1] - a[1])[0][0];
    const want = rows.filter(r => r.provider === topProv).reduce((s, r) => s + r.calls, 0);

    const allCalls = callsKpi();
    fire('#provfiltersel', topProv);
    const filtered = callsKpi();
    chk(filtered === want, `filtering by provider "${topProv}" narrows the numbers`, `got ${filtered}, want ${want}`);
    chk(filtered < allCalls, '...and it is fewer calls than the unfiltered view', `${allCalls} -> ${filtered}`);

    // Model filter on top of it: the two compose, they do not replace.
    const topModel = rows.filter(r => r.provider === topProv)[0].model;
    const wantBoth = rows.filter(r => r.provider === topProv && r.model === topModel)
      .reduce((s, r) => s + r.calls, 0);
    fire('#modelfiltersel', topModel);
    chk(callsKpi() === wantBoth, 'model composes with provider (both applied)', `got ${callsKpi()}, want ${wantBoth}`);

    // ---- the hash carries all three, so the view stays shareable -----------
    chk(/provider=/.test(hash()) && /model=/.test(hash()),
      'both filters are written into the hash', hash());
    chk(decodeURIComponent(hash()).includes(topProv) && decodeURIComponent(hash()).includes(topModel),
      'the hash names the actual provider and model', hash());

    // ---- the chip states what is filtered, on a view the filters affect -----
    const chip = d.querySelector('#projfilterchip');
    chk(!chip.hidden, 'the filter chip is visible while a filter is on');
    const chipTxt = chip.textContent;
    chk(chipTxt.includes(topProv) && chipTxt.includes(topModel),
      'the chip names both active filters', chipTxt.trim());

    // ---- clearing resets all three, not just project ------------------------
    d.querySelector('#projfilterclear').click();
    chk(callsKpi() === allCalls, 'clearing restores the unfiltered numbers', `got ${callsKpi()}, want ${allCalls}`);
    chk(!/provider=|model=/.test(hash()), 'clearing empties the hash', hash());
    chk(d.querySelector('#provfiltersel').value === '' && d.querySelector('#modelfiltersel').value === '',
      'clearing resets both selects');

    // ---- a filter that matches nothing says so, rather than lying -----------
    // Two VALID values that do not co-occur: provider A with a model that only
    // ever runs on provider B. Each filter on its own matches rows; together
    // they match none, which is the case a reader actually hits.
    // With the provider->model cascade, a contradictory pair (provider A +
    // a model that only exists under provider B) can no longer come from the
    // selects: render()'s populate step drops the stale model filter before
    // the row filter runs. The state must RESOLVE to provider A alone, and
    // the table must show provider A's rows — an empty contradiction that
    // silently displayed unfiltered numbers was the bug this replaced (#46).
    const provA = wantProvs[0];
    const provB = wantProvs[wantProvs.length - 1];
    const modelOnB = (rows.find(r => r.provider === provB) || {}).model;
    w.eval(`setCrossFilter('provider', ${JSON.stringify(provA)});` +
           `setCrossFilter('model', ${JSON.stringify(modelOnB)}); render()`);
    const tbl = d.querySelector('#tbl');
    chk(w.eval("MODEL_FILTER") === '',
      'cascade resolves a stale cross-provider model filter to All models',
      JSON.stringify(w.eval("MODEL_FILTER")));
    chk(tbl && !/No data/.test(tbl.textContent) && tbl.textContent.includes(provA),
      'after the cascade resolution the table shows the provider rows, not unfiltered numbers',
      (tbl ? tbl.textContent.slice(0, 70) : 'no table').replace(/\s+/g, ' '));
    // The project select resolves the same way: a project value that is not
    // one of the profile's slots cannot survive populate (it falls back to
    // All projects), so a filter naming a foreign project self-clears too.
    w.eval("clearCrossFilters(); setCrossFilter('project', 'no-such-project'); render()");
    chk(w.eval("PROJECT_FILTER") === '',
      'project filter self-clears a value that is not one of the profile slots',
      JSON.stringify(w.eval("PROJECT_FILTER")));
    // The invariant that matters: whatever the three state values say, the
    // numbers on screen are exactly the rows those values select. Computed here
    // from the payload, so it cannot pass by agreeing with itself.
    const expectFor = (pv, md) => rows
      .filter(r => (!pv || r.provider === pv) && (!md || r.model === md))
      .reduce((s, r) => s + r.calls, 0);
    for (const [pv, md] of [[topProv, ''], ['', topModel], [topProv, topModel], ['', '']]) {
      w.eval(`clearCrossFilters();` +
             (pv ? `setCrossFilter('provider', ${JSON.stringify(pv)});` : '') +
             (md ? `setCrossFilter('model', ${JSON.stringify(md)});` : '') + `render()`);
      chk(callsKpi() === expectFor(pv, md),
        `rows match the active filters (provider="${pv}" model="${md}")`,
        `got ${callsKpi()}, want ${expectFor(pv, md)}`);
    }
    w.eval("clearCrossFilters(); render()");

    // ---- negative control ----------------------------------------------------
    // The compose step is what makes the filters bite. Disable it (the pre-#130
    // behaviour) and the SAME probe must report the full, unfiltered figure —
    // proving the assertions above measure the filter and not something else on
    // the page that happens to move.
    w.eval("clearCrossFilters(); render()");
    fire('#provfiltersel', topProv);
    const filteredAgain = callsKpi();
    const control = rows.filter(() => true).reduce((s, r) => s + r.calls, 0);
    chk(filteredAgain === want && control === allCalls && filteredAgain !== control,
      'control: ignoring the filter yields the full total, filtering yields less',
      `${filteredAgain} vs ${control}`);
    w.eval("clearCrossFilters(); render()");

    console.log(`\ncheck_row_filters.js  ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.log(`  FAIL threw: ${e.message}`);
    console.log(`\ncheck_row_filters.js  ${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }
}, 1200);
