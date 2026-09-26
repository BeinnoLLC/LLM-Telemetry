// Full Logs page: every filter, plus the drawer staying a summary (#104).
//
// The page fetches logs-data.json lazily, so jsdom gets a stubbed fetch that
// serves the fixture. That also proves the lazy path: no fetch may happen
// until the view is opened.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = process.env.LLM_TELEMETRY_REPORTS || 'examples/reports';
const html = fs.readFileSync(path.join(R, 'dashboard.html'), 'utf8');
const logsFixture = JSON.parse(fs.readFileSync(path.join(R, 'logs-data.json'), 'utf8'));
// The drawer renders from live-data.json. Without it #dbody stays empty and the
// summary assertions below would pass on nothing.
const liveFixture = JSON.parse(fs.readFileSync(path.join(R, 'live-data.json'), 'utf8'));

let p = 0, f = 0, total = 0;
const chk = (c, m) => { total++; c ? (p++, console.log('  ok  ' + m)) : (f++, console.log('FAIL ' + m)); };

let fetchCount = 0;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/dashboard.html',
  beforeParse(w) {
    w.fetch = (u) => {
      if (String(u).includes('logs-data.json')) {
        fetchCount++;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(logsFixture) });
      }
      if (String(u).includes('live-data.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(liveFixture) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    // jsdom loads no CDN script, so Chart is absent and the boot path throws
    // before renderNav() runs. Every other suite stubs it the same way.
    w.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: {}, options: {} }; };
    w.Chart.register = () => {};
    w.Chart.getChart = () => null;
    w.Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } };
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    // The responsive nav reads matchMedia at boot; jsdom does not implement it.
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {},
                           removeEventListener() {}, addListener() {}, removeListener() {} });
  },
});
const w = dom.window, d = w.document;
const $ = id => d.getElementById(id);

setTimeout(async () => {
  // --- structure -----------------------------------------------------------
  const view = d.querySelector('[data-view="Logs"]');
  chk(!!view, 'a Logs view exists');
  chk(!!d.querySelector('#navdrawer [data-nav="Logs"]'), 'the left rail links to it');

  // --- lazy: nothing fetched before the view is opened ---------------------
  chk(fetchCount === 0, 'logs-data.json is NOT fetched on page load');

  // --- open it -------------------------------------------------------------
  d.querySelector('#navdrawer [data-nav="Logs"]').click();
  await new Promise(r => setTimeout(r, 60));
  chk(fetchCount === 1, 'opening the view fetches the payload exactly once');
  chk(!view.hidden, 'the view is visible after navigation');

  const rows = () => view.querySelectorAll('#lglist .lgev');
  const n0 = rows().length;
  chk(n0 > 0, `events render (${n0} rows)`);

  // Re-opening must not refetch a 1.3 MB payload.
  d.querySelector('#navdrawer [data-nav="Home"]')?.click();
  d.querySelector('#navdrawer [data-nav="Logs"]').click();
  await new Promise(r => setTimeout(r, 40));
  chk(fetchCount === 1, 're-opening the view does not refetch');

  // --- every facet is present and populated --------------------------------
  for (const [id, label] of [['lgf-level','level'], ['lgf-role','role'],
       ['lgf-tool','tool'], ['lgf-model','model'], ['lgf-session','session'],
       ['lgf-kind','failure kind']]) {
    const chips = $(id) ? $(id).querySelectorAll('.lgchip') : [];
    chk(chips.length > 0, `${label} filter offers ${chips.length} values`);
  }

  // --- facet counts cover the FULL window, not the shipped slice -----------
  const prof = logsFixture.profiles.work;
  const toolTotal = prof.facets.tool.reduce((a, x) => a + x.n, 0);
  chk(prof.events_total > prof.events_shown, 'fixture is a capped slice (precondition)');
  const capNote = $('lgcap');
  chk(capNote && !capNote.hidden, 'the cap is disclosed, not hidden');
  chk(/of\s/.test(capNote.textContent) && capNote.textContent.includes('full window'),
      'the notice explains filter counts span the full window');
  chk(toolTotal > 0, 'tool facet counts are real numbers');

  // --- filtering actually narrows ------------------------------------------
  const chipFor = (box, val) => [...$(box).querySelectorAll('.lgchip')]
    .find(c => c.dataset.val === val);
  const toolName = $('lgf-tool').querySelector('.lgchip').dataset.val;
  chipFor('lgf-tool', toolName).click();
  await new Promise(r => setTimeout(r, 30));
  const n1pre = rows().length;
  chk(n1pre < n0, `selecting tool="${toolName}" narrows ${n0} -> ${n1pre}`);
  chk(chipFor('lgf-tool', toolName).classList.contains('on'),
      'the selected chip is marked active');
  const tags = [...rows()].map(r => r.querySelector('.lgtag').textContent);
  chk(tags.every(t => t === toolName), 'every surviving row matches the chosen tool');

  // --- active-filter summary strip (#108 redesign) --------------------------
  const active = $('lgactive');
  chk(!!active, 'the active-filter summary bar exists');
  chk(active.classList.contains('show'), 'it becomes visible once a filter is applied');
  const activeChips = [...active.querySelectorAll('.lgactivechip')];
  chk(activeChips.length === 1, `it shows exactly one active chip (${activeChips.length})`);
  chk(activeChips[0].textContent.includes(toolName),
      'the active chip names the applied tool filter');
  const badge = $('lgcountbadge');
  chk(!!badge && !badge.hidden, 'the filter-count badge shows while a filter is on');
  chk(/1 filter/.test(badge.textContent), `badge reads the count (${badge.textContent})`);
  // Removing via the summary strip has the same effect as un-clicking the
  // source chip -- the whole point is reaching it without scrolling to Tool.
  activeChips[0].click();
  await new Promise(r => setTimeout(r, 30));
  chk(rows().length === n0, 'clicking the active chip removes that filter');
  chk(!active.classList.contains('show'), 'the strip hides again once empty');
  chk(badge.hidden, 'the badge hides again once no filters are active');

  // Re-select the same filter to prove removal was real, not a re-render
  // that happened to look the same, then leave clean for the next block.
  chipFor('lgf-tool', toolName).click();
  await new Promise(r => setTimeout(r, 30));
  chk(rows().length === n1pre, 're-selecting the tool filter narrows the same way again');
  chipFor('lgf-tool', toolName).click();
  await new Promise(r => setTimeout(r, 30));
  chk(rows().length === n0, 'deselecting restores the full list');

  // --- error level filter --------------------------------------------------
  chk(!!chipFor('lgf-level', 'error'), 'an error level chip exists');
  chipFor('lgf-level', 'error').click();
  await new Promise(r => setTimeout(r, 30));
  const errRows = [...rows()];
  chk(errRows.length > 0 && errRows.length < n0, `error filter isolates ${errRows.length} rows`);
  chk(errRows.every(r => r.querySelector('.lgtag').classList.contains('error')),
      'error rows are styled as errors');
  chipFor('lgf-level', 'error').click();
  await new Promise(r => setTimeout(r, 30));

  // --- text search ---------------------------------------------------------
  const q = $('lgq');
  q.value = 'timeout';
  q.dispatchEvent(new w.Event('input'));
  await new Promise(r => setTimeout(r, 30));
  const n2 = rows().length;
  chk(n2 > 0 && n2 < n0, `text search narrows to ${n2}`);
  chk([...rows()].every(r => r.textContent.toLowerCase().includes('timeout')),
      'every search hit contains the term');

  // --- clear resets everything --------------------------------------------
  $('lgclear').click();
  await new Promise(r => setTimeout(r, 30));
  chk(rows().length === n0, 'Clear resets search and facets');
  chk(q.value === '', 'Clear empties the search box');

  // --- time window ---------------------------------------------------------
  const w1 = view.querySelector('[data-win="1"]');
  w1.click();
  await new Promise(r => setTimeout(r, 30));
  const n3 = rows().length;
  chk(n3 < n0, `1h window narrows ${n0} -> ${n3}`);
  chk(w1.classList.contains('on'), 'the active window chip is marked');
  view.querySelector('[data-win="24"]').click();
  await new Promise(r => setTimeout(r, 30));

  // --- the drawer stays a SUMMARY, not the full record ---------------------
  // The user's requirement: the right drawer shows summary / main events only.
  const drawer = $('drawer');
  chk(!!drawer, 'the right drawer still exists');
  $('navdrawerbtn').click();
  await new Promise(r => setTimeout(r, 40));
  chk(drawer.classList.contains('open'), 'the live-tail rail entry still opens it');

  const dRows = $('dbody').children;
  // Non-empty FIRST: a cap assertion on an empty drawer proves nothing.
  chk(dRows.length > 0, `the drawer renders events (${dRows.length})`);
  chk(dRows.length <= 120, `drawer is capped at a summary (${dRows.length} <= 120)`);
  chk(/summary/i.test($('dfoot') ? $('dfoot').textContent : drawer.textContent),
      'the drawer labels itself a summary');
  chk(!!$('dfull'), 'the drawer offers a link to the full logs page');

  // Routine read-only chatter must not appear in the summary.
  const noisy = [...drawer.querySelectorAll('#dbody *')]
    .some(e => /\bread_file\b|\bsearch_files\b/.test(e.textContent || ''));
  chk(!noisy, 'the drawer drops routine read-only tool noise');

  // The handoff closes the drawer and lands on the page.
  $('dfull').click();
  await new Promise(r => setTimeout(r, 40));
  chk(!drawer.classList.contains('open'), '"All logs" closes the drawer');
  chk(!d.querySelector('[data-view="Logs"]').hidden, '"All logs" lands on the Logs view');

  // --- CSV export ----------------------------------------------------------
  let dl = null;
  const realCreate = d.createElement.bind(d);
  d.createElement = (t) => { const e = realCreate(t); if (t === 'a') dl = e; return e; };
  $('lgcsv').click();
  await new Promise(r => setTimeout(r, 20));
  chk(dl && dl.download === 'log-events.csv', 'Export CSV triggers a download');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
}, 400);
