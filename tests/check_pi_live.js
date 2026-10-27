// LST-245: PI workers must be visible on the Live tab, badged distinctly from
// Hermes sessions, with agent name / title / model / phase / idle time shown.
// Same real-handler-against-built-page pattern as check_bandwidth.js: mock
// fetch to serve the committed fixtures, run the page's own live poll, then
// assert on the DOM it produced.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

chk(Array.isArray(live.pi_live) && live.pi_live.length > 0,
    'fixture live-data.json carries pi_live sessions', JSON.stringify(live.pi_live || []).slice(0, 80));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics),
    });
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    // ---- PI sessions render merged into the Hermes live list (LST-245) ------
    const rows = [...d.querySelectorAll('#livelist [data-pisession]')];
    chk(rows.length === live.pi_live.length,
        'one row per live PI session', `${rows.length}/${live.pi_live.length}`);

    // ---- every PI row carries the required info -----------------------------
    const first = live.pi_live[0];
    const firstRow = rows.find(r => r.dataset.pisession === first.session_id);
    chk(!!firstRow, 'a row exists for the first fixture session');
    if (firstRow) {
      chk(firstRow.textContent.includes(first.agent), 'row shows the agent name', first.agent);
      chk(firstRow.textContent.includes(first.title) || firstRow.textContent.includes(first.cwd),
          'row shows a title or cwd');
      chk(firstRow.textContent.includes(first.model), 'row shows the model', first.model);
      chk(firstRow.textContent.includes(first.phase), 'row shows the phase', first.phase);
      // idle_s renders via ago(); just assert it is not blank/dash.
      const act = firstRow.querySelector('.lvago');
      chk(!!act && !act.textContent.includes('—') && /ago$/.test(act.textContent.trim()),
          'row shows a real idle time, not the empty dash', act && act.textContent);
    }

    // ---- LST-251: PI rows get the same gauge + detail level as Hermes rows --
    chk(rows.every(r => !!r.querySelector('.loecol .loe')),
        'every PI row renders the loeIcon load gauge (not an empty .loecol)');

    const switched = live.pi_live.find(s => s.switched);
    if (switched) {
      const row = rows.find(r => r.dataset.pisession === switched.session_id);
      chk(!!row && row.textContent.includes(switched.init_model),
          'a switched-model PI session shows its init_model, same as the Hermes \u21af-from note');
    }

    const withTools = live.pi_live.find(s => (s.tools || []).length > 0);
    if (withTools) {
      const row = rows.find(r => r.dataset.pisession === withTools.session_id);
      chk(!!row && withTools.tools.every(t => row.textContent.includes(t)),
          'a PI session with recent tool calls shows them as chips, like a Hermes row');
    }

    const withUsage = live.pi_live.find(s => (s.in_tok || 0) + (s.out_tok || 0) > 0);
    if (withUsage) {
      const row = rows.find(r => r.dataset.pisession === withUsage.session_id);
      chk(!!row && !row.textContent.includes('undefined') && !row.textContent.includes('NaN'),
          'a PI session with token usage renders it without undefined/NaN');
    }

    const withUptime = live.pi_live.find(s => Number.isFinite(s.uptime_s));
    if (withUptime) {
      const row = rows.find(r => r.dataset.pisession === withUptime.session_id);
      const el = row && row.querySelector('[title^="running since"]');
      chk(!!el && /^\d/.test(el.textContent.trim()) && !/NaN|undefined/.test(el.textContent),
          'a PI session with a known start time shows its elapsed time', el && el.textContent);
    }

    // ---- PI rows are badged distinctly from Hermes rows ---------------------
    chk(rows.every(r => !!r.querySelector('[data-kindbadge="pi"]')),
        'every PI row carries a PI badge');
    chk(rows.every(r => !r.querySelector('[data-kindbadge="hermes"]')),
        'no PI row carries a Hermes badge');

    const hermesRows = [...d.querySelectorAll('#livelist .liverow:not([data-pisession])')];
    chk(hermesRows.length > 0, 'the Hermes live list still renders its own rows (sanity)');
    chk(hermesRows.every(r => !!r.querySelector('[data-kindbadge="hermes"]')),
        'every Hermes row carries a Hermes badge');
    chk(hermesRows.every(r => !r.querySelector('[data-kindbadge="pi"]')),
        'no Hermes row carries a PI badge');

    // ---- the two badges are visually distinguishable -------------------------
    const piBadge = d.querySelector('#livelist [data-pisession] [data-kindbadge="pi"]');
    const hermesBadge = d.querySelector('#livelist [data-kindbadge="hermes"]');
    chk(!!piBadge && !!hermesBadge, 'both badge kinds are present to compare');
    if (piBadge && hermesBadge) {
      chk(piBadge.textContent.trim() !== hermesBadge.textContent.trim(),
          'PI and Hermes badges render different text',
          `${piBadge.textContent.trim()} vs ${hermesBadge.textContent.trim()}`);
      const piColor = w.getComputedStyle(piBadge).color;
      const hermesColor = w.getComputedStyle(hermesBadge).color;
      chk(!!piColor && !!hermesColor && piColor !== hermesColor,
          'PI and Hermes badges are different colours', `${piColor} vs ${hermesColor}`);
      chk(piBadge.classList.contains('pv-badge') && hermesBadge.classList.contains('pv-badge'),
          'both badges reuse the existing .pv-badge class rather than a new one');
    }

    // ---- empty pi_live renders no PI rows (merged list, no separate box) ----
    w.eval('DATA.pi_live = []; renderLive();');
    chk(d.querySelectorAll('#livelist [data-pisession]').length === 0,
        'an empty pi_live list leaves no PI rows in the live list');
    w.eval(`DATA.pi_live = ${JSON.stringify(live.pi_live)}; renderLive();`);
    chk(d.querySelectorAll('#livelist [data-pisession]').length === live.pi_live.length,
        'rendering it again with sessions shows the PI rows again');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_pi_live.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
