// #95/P10-07: Cost attribution panel (Cost view) — by source/root/cron/tool.
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
    chk(/id="attribcard"/.test(html), 'the attribution card markup exists');

    w.eval("current = 'work'; view = 'Cost'; render();");
    const card = d.getElementById('attribcard');
    chk(card && card.hidden === false, 'the card is shown for the sample profile with attribution data');

    const sourceText = d.getElementById('attribsource').textContent;
    chk(sourceText.includes('desktop') && sourceText.includes('tui') && sourceText.includes('cron'),
        'by-source lists desktop/tui/cron from the sample');
    chk(sourceText.includes('409.2000'), 'the desktop cost figure renders with real precision, not rounded to whole dollars');

    const rootText = d.getElementById('attribroot').textContent;
    chk(rootText.includes('Migrate billing'), 'by-root shows the real session title, not the raw session id');
    const rootBtn = d.querySelector('#attribroot button[data-tsession]');
    chk(!!rootBtn && rootBtn.classList.contains('lntimelinebtn'),
        'each by-root row is a real Timeline opener (reuses the session-timeline modal wiring, not a new listener)');
    chk(rootBtn.getAttribute('data-tsession') === 'sess_parent01',
        'the by-root opener carries the real root session id');

    const cronText = d.getElementById('attribcron').textContent;
    chk(cronText.includes('nightly-backup') && cronText.includes('30 runs'),
        'by-cron groups the 30 nightly-backup runs under one job name');
    chk(!d.getElementById('attribcronwrap').hidden, 'the cron section is visible when cron data exists');

    const toolText = d.getElementById('attribtool').textContent;
    chk(toolText.includes('read_file'), 'by-tool lists read_file');

    // Sort order: by_source sorted by cost descending in the fixture (tui > desktop > subagent > cron).
    const sourceOrder = [...d.querySelectorAll('#attribsource > div > span.font-semibold')].map(s => s.textContent);
    chk(sourceOrder[0] === 'tui', 'by-source preserves the collector\'s own cost-descending sort order (tui highest)', sourceOrder);

    // Footer states the honest cost_status caveat.
    chk(/own.*pricing/i.test(d.getElementById('attribfooter').textContent),
        'the footer plainly states the numbers come from this dashboard\'s own pricing');

    // Negative control for "no cron sessions": hide the cron section entirely.
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.attribution = {
        by_source: [{source:'desktop', cost:1.0, tokens:100, sessions:1}],
        by_root: [], by_cron: [], by_tool: []
      };
      render();
    `);
    chk(d.getElementById('attribcronwrap').hidden === true,
        'a fixture with zero cron sessions hides the cron section entirely (the ticket\'s own negative control)');
    chk(d.getElementById('attribcard').hidden === false,
        'the card itself stays visible when only by_source has data');

    // Hide condition: empty by_source hides the whole card.
    w.eval(`
      DATA.profiles.personal.attribution = {by_source:[], by_root:[], by_cron:[], by_tool:[]};
      render();
    `);
    chk(d.getElementById('attribcard').hidden === true, 'the card hides entirely when by_source is empty');

    console.log(`\ncheck_cost_attribution.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_cost_attribution.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
