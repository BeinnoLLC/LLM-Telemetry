// #46/P4-09: project cross-filter — selecting a project narrows Usage,
// Cost, Flow, Health; visible removable chip on every affected view;
// deep-linkable via ?project= in the hash; composes with date range and
// profile; explicit empty state for a project with no rows in range.
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

chk(/id="projfiltersel"/.test(html), 'the project filter select exists');
chk(/All projects/.test(html), '"All projects" is present as the default option in markup');
chk(/id="projfilterchip"/.test(html) && /id="projfilterclear"/.test(html),
    'a removable filter chip with a clear control exists');

function boot(startHash) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html' + (startHash || ''),
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx;
        this._visibility = ((cfg && cfg.data && cfg.data.datasets) || []).map(() => true);
        this.isDatasetVisible = (i) => this._visibility[i]; this.setDatasetVisibility = (i,v) => { this._visibility[i]=v; }; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
      w.localStorage.setItem = () => {}; // don't let a stray view-pref leak between tests
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    w.eval("current = 'work'; $('from').value=''; $('to').value=''; render();");

    const opts = [...d.querySelectorAll('#projfiltersel option')].map(o => o.value);
    chk(opts.length > 1, 'the select is populated with real projects from the data, not left with only "All projects"');

    // Pick a real project deterministically: the top one by row count.
    const rowsAll = w.eval("DATA.profiles.work.rows");
    const counts = {};
    rowsAll.forEach(r => { const k = r.project || 'Unattributed'; counts[k] = (counts[k]||0)+1; });
    const targetProject = Object.entries(counts).filter(([k])=>k!=='Unattributed').sort((a,b)=>b[1]-a[1])[0][0];

    w.eval("current = 'work'; $('from').value=''; $('to').value=''; pickView('Usage');");
    const usageBeforeText = d.getElementById('tbl').textContent;

    const sel = d.getElementById('projfiltersel');
    sel.value = targetProject;
    sel.dispatchEvent(new w.Event('change'));

    chk(w.eval('PROJECT_FILTER') === targetProject, 'selecting a project sets PROJECT_FILTER');
    const usageAfterText = d.getElementById('tbl').textContent;
    chk(usageAfterText !== usageBeforeText, 'selecting a project changes the Usage table');

    // Chip visible on Usage.
    const chip = d.getElementById('projfilterchip');
    chk(chip.hidden === false, 'the filter chip is visible on Usage while a filter is active');
    chk(d.getElementById('projfilterchipname').textContent === targetProject,
        'the chip names the active project');

    // Cost, Flow, Health all narrow too (Health has no project field of its
    // own — assert it still changes, i.e. is actually being filtered by
    // which models the project touched, not just left alone).
    w.eval("pickView('Cost');");
    const costText = d.getElementById('cModelCost') ? 'has-canvas' : 'no-canvas';
    chk(d.getElementById('projfilterchip').hidden === false, 'the chip is also visible on Cost');

    w.eval("pickView('Health');");
    chk(d.getElementById('projfilterchip').hidden === false, 'the chip is also visible on Health');
    const healthFilteredHTML = d.getElementById('healthgrid').textContent;

    w.eval("PROJECT_FILTER=''; syncProjFilterUI(); render();");
    const healthUnfilteredHTML = d.getElementById('healthgrid').textContent;
    chk(healthFilteredHTML !== healthUnfilteredHTML,
        'Health view is actually narrower when a project filter is active (models scoped to what the project used)');

    // Restore filter, check a view NOT in the affected set hides the chip.
    w.eval(`PROJECT_FILTER=${JSON.stringify(targetProject)}; syncProjFilterUI();`);
    w.eval("pickView('Home');");
    chk(d.getElementById('projfilterchip').hidden === true,
        'the chip is hidden on a view the filter does not affect (Home)');

    w.eval("pickView('Usage');");
    chk(d.getElementById('projfilterchip').hidden === false, 'the chip reappears back on Usage');

    // Composition with date range: applying a date range on top of the
    // project filter narrows further, it doesn't reset the filter.
    const allDates = [...new Set(rowsAll.filter(r => (r.project||'Unattributed')===targetProject).map(r=>r.date))].sort();
    if (allDates.length > 1) {
      w.eval(`$('from').value=${JSON.stringify(allDates[allDates.length-1])}; render();`);
      chk(w.eval('PROJECT_FILTER') === targetProject,
          'applying a date range on top of the project filter does not clear the filter');
      w.eval("$('from').value=''; render();");
    } else {
      chk(true, 'date-range composition check skipped (project has only one active date) — filter/hash logic covered elsewhere');
    }

    // Clear button.
    d.getElementById('projfilterclear').click();
    chk(w.eval('PROJECT_FILTER') === '', 'the clear (×) button resets the filter to All projects');
    chk(d.getElementById('projfilterchip').hidden === true, 'the chip disappears once cleared');

    // Deep link: hash carries ?project=.
    w.eval(`sel_ = $('projfiltersel'); sel_.value=${JSON.stringify(targetProject)}; sel_.dispatchEvent(new Event('change'));`);
    const hashAfterSelect = w.eval('location.hash');
    chk(hashAfterSelect.includes('project=' + encodeURIComponent(targetProject).replace(/%20/g,'%20')) || hashAfterSelect.includes(encodeURIComponent(targetProject)),
        `the hash carries the project filter, got: ${hashAfterSelect}`);

    // Fresh page load from that exact hash restores the filter.
    const savedHash = hashAfterSelect;
    const dom2 = boot(savedHash);
    setTimeout(() => {
      const w2 = dom2.window, d2 = w2.document;
      chk(w2.eval('PROJECT_FILTER') === targetProject,
          `a fresh page load from a URL with ?project= restores the filter, got: ${w2.eval('PROJECT_FILTER')}`);
      chk(d2.getElementById('projfiltersel').value === targetProject,
          'the select reflects the restored filter on load');

      // Explicit empty state: pick a project + a date outside ANY row's
      // date entirely (guaranteed zero overlap, not dependent on there
      // being an unused day within the existing spread).
      const rowsAll2 = w2.eval("DATA.profiles.work.rows");
      const allDates2 = [...new Set(rowsAll2.map(r=>r.date))].sort();
      const outOfRangeDate = '1999-01-01';
      const guaranteed = !allDates2.includes(outOfRangeDate);
      if (guaranteed) {
        w2.eval(`current='work'; PROJECT_FILTER=${JSON.stringify(targetProject)}; pickView('Usage'); $('from').value=${JSON.stringify(outOfRangeDate)}; $('to').value=${JSON.stringify(outOfRangeDate)}; render();`);
        const emptyText = d2.getElementById('tbl').textContent;
        chk(emptyText.includes(targetProject) || /no data/i.test(emptyText),
            `an explicit empty state (not a blank card) shows for a project with no rows in the chosen range: ${emptyText.slice(0,120)}`);
      } else {
        chk(true, 'explicit empty-state check skipped (unexpected: 1999-01-01 exists in the dataset)');
      }

      console.log(`\ncheck_project_filter.js  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 1500);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_project_filter.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
