// UI pass A: structure, navigation, accessibility. One h1 and unskipped heading
// levels on every route, a <main> landmark with a skip link, no duplicate nav
// destinations (and no floating Logs tab), a collapsed Router list at scale, a
// sectioned Settings page, a green/amber freshness dot and humanised errors.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'examples', 'reports', 'dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${x !== undefined ? '  ' + x : ''}`); ok ? pass++ : fail++; };

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html#/home',
  beforeParse(w) {
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.Element.prototype.scrollIntoView = () => {};
  },
});
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const views = [...d.querySelectorAll('.view')].map(v => v.dataset.view);
    chk(views.length === 16, '16 routes', String(views.length));
    for (const v of views) {
      w.eval(`pickView(${JSON.stringify(v)})`);
      const hs = [...d.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(h => !h.closest('[hidden]') && !h.closest('[aria-hidden="true"]') && !h.closest('dialog,#fbdialog,#pdrawer,#sfmodal,#helpwrap,#drawer,#lnpanel'));
      const lv = hs.map(h => +h.tagName[1]);
      const skips = lv.filter((n, i) => n > (i ? lv[i - 1] : 0) + 1);
      chk(d.querySelectorAll('h1').length === 1 && lv[0] === 1 && !skips.length, `${v}: one h1, no skipped levels`, lv.join(''));
      chk(d.getElementById('h1view').textContent.includes(v), `${v}: h1 names the view`);
    }

    // ---- landmarks -------------------------------------------------------
    const main = d.querySelector('main#main');
    chk(!!main && main.contains(d.querySelector('.view')), '<main id="main"> wraps the views');
    chk(d.querySelectorAll('main').length === 1, 'exactly one <main>');
    const skip = d.querySelector('a.skip');
    chk(!!skip && skip.getAttribute('href') === '#main' && /skip/i.test(skip.textContent), 'skip link targets #main');
    chk(d.querySelector('body > a.skip, body > svg + a.skip') === skip, 'skip link is the first focusable element');

    // ---- navigation duplicates ------------------------------------------
    chk(!d.getElementById('logbtn') && !d.getElementById('logbtn2'), 'no floating Logs tab');
    chk(!/--logtab|#logbtn/.test(css), 'no logtab CSS left');
    const rail = [...d.querySelectorAll('#navlist a.navitem')].map(a => a.getAttribute('href'));
    chk(new Set(rail).size === rail.length && rail.every(h => h === h.toLowerCase()), 'rail destinations unique and lowercase', String(rail.length));
    chk(!d.querySelector('a[href="#/Prices"]') && !/#\/Prices/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no capitalised #/Prices link in markup');
    w.eval(`pickView('Home')`);
    const cards = [...d.querySelectorAll('#homecards a.xcard')];
    const hrefs = cards.map(a => a.getAttribute('href'));
    chk(new Set(hrefs).size === hrefs.length && hrefs.every(h => h === h.toLowerCase()), 'Explore destinations unique and lowercase', hrefs.join(' '));
    chk(!/Price sheet/.test(d.getElementById('homecards').textContent), 'Explore says Prices, not "Price sheet"');
    const bwc = cards.find(a => /bandwidth/i.test(a.textContent));
    chk(bwc && bwc.dataset.sec === 'bwpanel' && !!d.getElementById('bwpanel'), 'Bandwidth card deep-links to the Usage bandwidth panel');
    chk(!!d.getElementById('navlogn') && !!d.getElementById('navdrawerbtn'), 'unread logs badge lives on the rail item');

    // ---- status dot ------------------------------------------------------
    const dot = (css.match(/\n \.dot\{[^}]*\}/) || [''])[0];
    chk(/var\(--z-ok\)/.test(dot) && !/accent2/.test(dot), 'freshness dot is green by default');
    chk(/\.stamp\.old,> \.stamp\.stale\) > \.dot,[^{]*\.dot\{background:var\(--z-warn\)\}/.test(css), 'dot turns amber when the stamp is old or stale');

    // ---- humanised errors -----------------------------------------------
    const hum = m => w.eval(`failMsgHuman(${JSON.stringify(m)})`);
    const a = hum('error_type=RateLimitError status_code=429 base_url=https://api.example.com/v1 request_id=abc');
    chk(/Rate limited \(HTTP 429\)/.test(a) && /Rate limit error/.test(a) && /via api\.example\.com/.test(a) && !/=/.test(a), 'key=value error becomes one readable line', a);
    chk(hum('{"error":{"message":"context length exceeded","code":400}}') === 'context length exceeded', 'JSON payload reduced to its message');
    chk(hum('plain message') === 'plain message', 'plain text untouched');

    // ---- Router at scale -------------------------------------------------
    const prof = JSON.stringify(w.eval('DATA.router.work'));
    w.eval(`(() => { const p = ${prof}; DATA.router = {}; for (let i = 0; i < 50; i++) DATA.router['agent' + String(i).padStart(2, '0')] = p; current = 'All'; })(); pickView('Router');`);
    const rows = [...d.querySelectorAll('#routerview .rt-profile')];
    chk(rows.length === 50 && rows.every(r => r.classList.contains('rt-compact') && !r.open), '50 profiles render as collapsed rows');
    chk(!!d.querySelector('#routerview .rt-find') && !d.querySelector('#routerview .rt-phead .rt-ok'), 'filter box present; no per-row "router on" chip');
    const find = d.querySelector('#routerview .rt-find');
    find.value = 'agent07'; find.dispatchEvent(new w.Event('input', { bubbles: true }));
    chk(rows.filter(r => !r.hidden).length === 1, 'filter narrows the list');
    d.querySelector('[data-rtprof="open"]').click();
    chk(rows.filter(r => r.open).length === 1, 'Expand all only opens the visible rows');

    // ---- Settings --------------------------------------------------------
    w.eval(`pickView('Settings')`);
    const goes = [...d.querySelectorAll('#setnav [data-setgo]')];
    chk(goes.length === 5 && goes.every(b => d.getElementById(b.dataset.setgo)), 'in-page nav jumps to five existing sections');
    chk(!/Default \(from name\)/.test(d.getElementById('setcolorgrid').textContent), 'colour rows no longer repeat the default boilerplate');
    chk(/hue \d+°/.test(d.getElementById('setcolorgrid').textContent), 'hue readout is labelled');
    chk(!!d.querySelector('#setlogogrid label.setup input[type=file][data-slfile]'), 'logo upload is a styled label, not the native file input');
  } catch (e) { chk(false, 'threw', e.stack); }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
