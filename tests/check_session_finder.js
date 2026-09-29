// #100/P10-12: Session finder — `/` opens a command palette.
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
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
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
    chk(/id="sfmodal"/.test(html), 'the Session finder palette markup exists');

    w.eval("current = 'work'; view = 'Home'; render();");

    // ---- pure matching logic, per the ticket's own verification wording ----
    // "query model:opus tool:patch matches the fixture sessions that have
    // both and none that have one"
    const idx = w.eval("DATA.profiles.work.session_index");
    chk(idx.length === 3, 'the sample fixture carries 3 sessions', idx.length);

    const both = w.eval("sfSearch(DATA.profiles.work.session_index, 'model:opus tool:patch')");
    chk(both.length === 1 && both[0].id === 'sess_finder1',
        'model:opus tool:patch matches ONLY the session with both (sess_finder1)', both.map(s=>s.id));

    const onlyModel = w.eval("sfSearch(DATA.profiles.work.session_index, 'model:opus')");
    chk(onlyModel.length === 2, 'model:opus alone matches both opus sessions (finder1 + finder3)', onlyModel.map(s=>s.id));

    const onlyTool = w.eval("sfSearch(DATA.profiles.work.session_index, 'tool:patch')");
    chk(onlyTool.length === 2 && onlyTool.every(s => s.tools.includes('patch')),
        'tool:patch alone matches both sessions that used patch, none that didn\'t', onlyTool.map(s=>s.id));

    const noneMatch = w.eval("sfSearch(DATA.profiles.work.session_index, 'model:opus tool:nonexistent')");
    chk(noneMatch.length === 0, 'a combined filter with no matching session returns EMPTY, not a crash');

    // Structured filters: source:, end:, cost>N, dur>Nh
    const bySource = w.eval("sfSearch(DATA.profiles.work.session_index, 'source:subagent')");
    chk(bySource.length === 1 && bySource[0].id === 'sess_finder2', 'source:subagent matches the real subagent session');

    const byEnd = w.eval("sfSearch(DATA.profiles.work.session_index, 'end:reap')");
    chk(byEnd.length === 1 && byEnd[0].id === 'sess_finder2', 'end:reap matches on a substring of the real end_reason');

    const byCost = w.eval("sfSearch(DATA.profiles.work.session_index, 'cost>1')");
    chk(byCost.length === 1 && byCost[0].id === 'sess_finder1', 'cost>1 matches only the $2.45 session');

    const byDurHours = w.eval("sfSearch(DATA.profiles.work.session_index, 'dur>1h')");
    chk(byDurHours.length === 1 && byDurHours[0].id === 'sess_finder1',
        'dur>1h correctly converts hours to seconds against the real dur field (5400s > 3600s)');

    const freeText = w.eval("sfSearch(DATA.profiles.work.session_index, 'checkout')");
    chk(freeText.length === 1 && freeText[0].id === 'sess_finder2', 'free text matches on the real session title');

    // ---- UI: opening the palette with `/`, arrow-key selection, aria ----
    w.eval("sfOpenPalette();");
    chk(d.getElementById('sfmodal').classList.contains('open'), 'sfOpenPalette() actually opens the modal');
    w.eval("$('sfinput').value = 'model:opus'; sfRender();");
    const rows = d.querySelectorAll('.sfrow');
    chk(rows.length === 2, 'the palette renders exactly the matching rows for the typed query', rows.length);

    chk(d.getElementById('sfinput').getAttribute('aria-activedescendant') === 'sfrow-0',
        'aria-activedescendant starts on the first result');
    w.eval("sfActiveIdx = 1; window.sfRender2();");
    chk(d.getElementById('sfinput').getAttribute('aria-activedescendant') === 'sfrow-1',
        'arrow-key selection (simulated) updates aria-activedescendant to the new index (the ticket\'s own named check)');
    chk(d.querySelector('#sfrow-1').classList.contains('sfactive'),
        'the visually-active row matches the new aria-activedescendant target');

    w.eval("sfClosePalette();");
    chk(!d.getElementById('sfmodal').classList.contains('open'), 'sfClosePalette() actually closes the modal (Esc path)');

    // ---- the ticket's own negative control: empty index -> no crash ----
    w.eval(`
      DATA.profiles.work.session_index = [];
      sfOpenPalette();
    `);
    const emptyText = d.getElementById('sflist').textContent;
    chk(emptyText.includes('No sessions in range'),
        'an empty session_index opens the palette with "no sessions in range", never a crash (the ticket\'s own negative control)');

    console.log(`\ncheck_session_finder.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_session_finder.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
