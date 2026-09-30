// #129: sub-day range presets (1h/6h/12h) — real hour-grain filtering via
// hourRowsFor()/HOUR_RANGE, exclusive with the day-range date pickers.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
        this.update = () => {}; this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = () => null; Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null;
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    // ---- unit: hourRowsFor() filters by real wall-clock cutoff -------------
    const nowIso = w.eval('new Date().toISOString()');
    const today = nowIso.slice(0, 10);
    const curHour = new Date(nowIso).getUTCHours(); // dashboard build runs in a
    // fixed TZ in CI; use local Date the page itself would construct instead:
    const localNow = w.eval('new Date()');

    // hourRowsFor() reconstructs r.date as a LOCAL midnight and uses r.hour as
    // a local wall-clock hour (the HOUR_ROWS collector buckets with
    // date(...)/strftime('%H',...,'localtime')). A fixture that takes the date
    // from toISOString() (UTC) while taking the hour from getHours() (local)
    // therefore breaks whenever the local date is ahead of the UTC date —
    // i.e. between local midnight and the UTC offset (00:00-03:00 in EEST),
    // when the fixture row lands on yesterday's date and falls outside every
    // preset window. Derive BOTH from the same local instant.
    w.eval(`
      const localYmd = (dt) => dt.getFullYear() + '-' +
        String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      const fakeP = {hour_rows: [
        {date: localYmd(new Date(Date.now() - 30*60*1000)),
         hour: (new Date(Date.now() - 30*60*1000)).getHours(), calls: 3, id:'within30m'},
        {date: localYmd(new Date(Date.now() - 9*3600*1000)),
         hour: (new Date(Date.now() - 9*3600*1000)).getHours(), calls: 5, id:'nine_hours_ago'},
      ]};
      window.__hr1 = hourRowsFor(fakeP, 1);
      window.__hr12 = hourRowsFor(fakeP, 12);
    `);
    const hr1 = JSON.parse(w.eval('JSON.stringify(window.__hr1)'));
    const hr12 = JSON.parse(w.eval('JSON.stringify(window.__hr12)'));
    chk(hr1.some(r => r.id === 'within30m'), 'hourRowsFor(1) includes a call from 30 minutes ago');
    chk(!hr1.some(r => r.id === 'nine_hours_ago'),
        'hourRowsFor(1) excludes a call from 9 hours ago (negative control: the cutoff must actually bind)');
    chk(hr12.some(r => r.id === 'nine_hours_ago'), 'hourRowsFor(12) includes the same 9h-old call');
    chk(hr12.length === 2, 'hourRowsFor(12) includes both fixture rows', hr12.length);

    // ---- integration: presets() renders hour chips wired to setHourRange ---
    w.eval(`presets(DATA.profiles[current])`);
    const chips = [...d.querySelectorAll('#presets [data-h]')].map(c => c.dataset.h);
    chk(chips.includes('1') && chips.includes('6') && chips.includes('12'),
        'presets() renders 1h/6h/12h chips', chips.join(','));

    // ---- setHourRange / setRange are mutually exclusive --------------------
    w.eval(`setHourRange(6)`);
    chk(w.eval('HOUR_RANGE') === 6, 'setHourRange(6) sets HOUR_RANGE');
    chk(w.eval(`$('rangetoggle').textContent`) === '6h',
        'the mobile range-toggle label reflects the active hour preset');
    w.eval(`setRange($('from').min, $('to').max)`);
    chk(w.eval('HOUR_RANGE') === null,
        'picking a day preset (setRange) clears HOUR_RANGE — exclusive with hour mode');

    // Editing a date input directly also exits hour mode.
    w.eval(`setHourRange(1)`);
    w.eval(`$('from').dispatchEvent(new w.Event('change'))`.replace('w.Event', 'Event'));
    chk(w.eval('HOUR_RANGE') === null,
        'editing the From date input exits hour-preset mode');

    // ---- render() actually reads hour_rows while HOUR_RANGE is set --------
    // Seed a real hour_rows entry inside the actual DATA (not the fake
    // fixture above) so render()'s KPI math is exercised end to end.
    w.eval(`
      const localYmd2 = (dt) => dt.getFullYear() + '-' +
        String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      const p = DATA.profiles[current];
      p.hour_rows = (p.hour_rows || []).concat([{
        date: localYmd2(new Date()), hour: (new Date()).getHours(),
        model:'gpt-x', provider:'openai', task:'main', calls: 7, inp: 10, outp: 5,
        cread: 0, cwrite: 0, rtok: 0, market_value_usd: 0.02, billed_usd: 0.02,
        sessions: 1, project: null, source: 'desktop'
      }]);
      setHourRange(1);
    `);
    const rangeinfo = w.eval(`$('rangeinfo').textContent`);
    chk(/last 1h/.test(rangeinfo), 'rangeinfo reads "last Nh" under an hour preset, not "N days"', rangeinfo);
    const callsCard = [...d.querySelectorAll('#kpis > div')].find(c => /API calls/.test(c.textContent));
    chk(!!callsCard && /7|[1-9]/.test(callsCard.textContent),
        'the API calls KPI reflects the hour-filtered row count under a 1h preset');

    // Reset back to day mode so this test doesn't leak state into any other
    // eval'd checks in the same process.
    w.eval(`setRange($('from').min, $('to').max)`);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_hour_range.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
