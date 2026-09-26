// Collapsible nav rail, collapsed by default (#102).
//
// Also guards the layout bug that shipped with the rail: `.page` had
// width:100% AND margin-left:232px, so the content box was a rail-width wider
// than the viewport and the right edge was cut off at every size. The fix is
// padding on a border-box element; the test asserts no rule pairs a non-zero
// margin-left with the rail width again.
const fs = require('fs'), { JSDOM } = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || 'examples/reports';
const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

let failed = 0, total = 0;
function chk(cond, label, extra) {
  total++;
  console.log((cond ? '  OK   ' : '  FAIL ') + label + (extra ? `  (${extra})` : ''));
  if (!cond) failed++;
}

function boot(store) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html',
    beforeParse(w) {
      w.Chart = function () { return { destroy() {}, update() {}, resize() {} }; };
      w.Chart.defaults = { font: {}, plugins: { legend: {} } };
      w.Chart.getChart = () => null;
      w.matchMedia = () => ({ matches: false, addEventListener(){}, removeEventListener(){} });
      w.fetch = () => Promise.reject(new Error('no network in test'));
      if (store) for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
    }
  });
}

const dom = boot(null);           // no stored preference -> default path
setTimeout(() => {
  const w = dom.window, d = w.document, body = d.body;

  // --- collapsed by default -----------------------------------------------
  chk(body.classList.contains('navcollapsed'),
      'rail is COLLAPSED by default (no stored preference)');
  const btn = d.getElementById('navcollapse');
  chk(!!btn, 'collapse toggle exists');
  chk(btn && btn.getAttribute('aria-expanded') === 'false',
      'toggle reports collapsed', btn && btn.getAttribute('aria-expanded'));
  chk(btn && /expand/i.test(btn.getAttribute('aria-label') || ''),
      'collapsed toggle offers to expand', btn && btn.getAttribute('aria-label'));
  chk(btn && btn.getAttribute('aria-controls') === 'navdrawer',
      'toggle points at the rail');

  // --- toggling -----------------------------------------------------------
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(!body.classList.contains('navcollapsed'), 'clicking expands the rail');
  chk(btn.getAttribute('aria-expanded') === 'true', 'toggle reports expanded');
  chk(w.localStorage.getItem('hermes-dash-navcollapsed') === '0',
      'expanded choice is persisted');

  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(body.classList.contains('navcollapsed'), 'clicking again collapses it');
  chk(w.localStorage.getItem('hermes-dash-navcollapsed') === '1',
      'collapsed choice is persisted');

  // --- nav still works while collapsed ------------------------------------
  const cost = d.querySelector('[data-nav="Cost"]');
  chk(!!cost, 'rail still lists sections when collapsed');
  chk(cost && cost.getAttribute('data-tip') === 'Cost',
      'collapsed items carry a tooltip label', cost && cost.getAttribute('data-tip'));
  cost.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const vis = [...d.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.dataset.view);
  chk(vis.includes('Cost'), 'a collapsed rail still navigates', `(${vis.join(',')})`);
  chk(body.classList.contains('navcollapsed'), 'navigating does not expand the rail');

  process.stdout.write('');
  stage2();
}, 400);

// --- stored preference wins over the default ------------------------------
function stage2() {
  const d2 = boot({ 'hermes-dash-navcollapsed': '0' });
  setTimeout(() => {
    chk(!d2.window.document.body.classList.contains('navcollapsed'),
        'a stored "expanded" preference survives reload');

    // --- the layout regression --------------------------------------------
    // Extract the stylesheet and prove no rule offsets .page with margin-left
    // while .page is also full width. That pairing is what clipped the page.
    const css = (raw.match(/<style>([\s\S]*?)<\/style>/) || [,''])[1];
    const pageRules = css.split('}').filter(r => /\.page\s*\{|\.page\s*,/.test(r));
    const badMargin = pageRules.filter(r => /margin-left\s*:\s*(?!0)/.test(r));
    chk(badMargin.length === 0,
        '.page is never offset with a non-zero margin-left (overflow bug)',
        badMargin.join(' | ').slice(0, 90));
    chk(/body\.hasnav\s+\.page\{[^}]*padding-left:calc\(var\(--rail-now\)/.test(css),
        '.page reserves rail space with padding on a border-box element');
    chk(/--rail-now/.test(css), 'rail width is a single shared variable');
    const railRule = (css.match(/#navdrawer\{[^}]*\}/) || [''])[0];
    chk(/width:var\(--rail-now\)/.test(railRule),
        'the rail itself reads that variable', railRule.slice(0, 70));
    chk(!/@media \(min-width:1200px\)\{ body\.hasnav \.page\{ margin-left:232px/.test(css),
        'the hard-coded 232px offset is gone');

    // --- canvas reuse guard (the stalled live feed) ------------------------
    const js = (raw.match(/function mk\(id,type[\s\S]{0,700}/) || [''])[0];
    chk(/Chart\.getChart\(el\)/.test(js),
        'mk() releases a canvas already owned by another chart');
    chk(/prev\.destroy\(\)/.test(js), 'and destroys it before rebinding');

    const passed = total - failed;
    console.log();
    console.log(`${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }, 400);
}
