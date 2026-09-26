// Hash routing (#5) and breadcrumb (#6). A deep link must open the section in
// the URL, back/forward must work, and the header must say where you are.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
const fs = require('fs'), { JSDOM } = require('jsdom');

const raw = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));
const analytics = JSON.parse(fs.readFileSync(REPORTS + '/analytics-data.json', 'utf8'));

// Deep link straight to a non-default section: if routing is broken this opens
// on Home instead, which is exactly the bug worth catching.
function boot(hash) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html' + (hash || ''),
    beforeParse(w) {
      w.Chart = function () { return { destroy() {}, update() {} }; };
      w.Chart.defaults = { color: '', borderColor: '', font: {} };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.fetch = (u) => Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics)
      });
    }
  });
}

let p = 0, f = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? p++ : f++; };
const shown = d => [...d.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.dataset.view);

// 1. Deep link: #/cost must open Cost, not the default or the stored tab.
const deep = boot('#/cost');
setTimeout(() => {
  const d = deep.window.document;
  const vis = shown(d);
  chk(vis.includes('Cost'), 'deep link #/cost opens the Cost view', `(showing ${vis.join(',') || 'none'})`);
  chk(!vis.includes('Home'), 'deep link does not also leave Home showing');

  // 2. Breadcrumb reflects the section.
  const crumb = d.getElementById('crumb');
  chk(!!crumb, 'breadcrumb element exists');
  chk(crumb && crumb.textContent.trim() === 'Cost',
    'breadcrumb names the current section', `(${crumb && crumb.textContent.trim()})`);
  chk(crumb && crumb.getAttribute('aria-live') === 'polite',
    'breadcrumb announces changes to screen readers');

  // 3. Switching views updates both the hash and the crumb.
  deep.window.pickView('Health');
  chk(/#\/health$/.test(deep.window.location.hash),
    'changing view writes the hash', `(${deep.window.location.hash})`);
  chk(crumb.textContent.trim() === 'Health', 'breadcrumb follows the view change');

  // 4. Unknown slug must fall back, never blank the page.
  const bad = boot('#/doesnotexist');
  setTimeout(() => {
    const bd = bad.window.document;
    const bvis = shown(bd);
    chk(bvis.length >= 1, 'unknown hash still renders a view', `(${bvis.join(',')})`);

    // 5. No hash: the stored/default view is used AND the hash gets written,
    //    so the URL is shareable from the first paint.
    const plain = boot('');
    setTimeout(() => {
      const pw = plain.window;
      chk(shown(pw.document).length >= 1, 'no-hash boot renders a view');
      chk(/^#\//.test(pw.location.hash), 'hash is written on boot for sharing',
        `(${pw.location.hash || 'empty'})`);

      console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
      process.exit(f === 0 ? 0 : 1);
    }, 1200);
  }, 1200);
}, 1500);