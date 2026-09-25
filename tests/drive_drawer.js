// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Drive the real dashboard.html in jsdom: verify the logs drawer works.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const HTML = REPORTS+'/dashboard.html';
let html = fs.readFileSync(HTML, 'utf8');

// Strip CDN <script src> tags: no network in this harness. Chart.js is stubbed.
html = html.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    const live = JSON.parse(
      fs.readFileSync(REPORTS+'/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve(live),
    });
  },
});

const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};

setTimeout(() => {
  console.log('== drawer elements ==');
  const drawer = d.getElementById('drawer');
  const btn = d.getElementById('logbtn');
  const scrim = d.getElementById('scrim');
  const body = d.getElementById('dbody');
  chk(!!drawer, 'drawer exists');
  chk(!!btn, 'log button exists');
  chk(!!scrim, 'scrim exists');
  chk(!!body, 'log body exists');

  console.log('\n== drawer opens ==');
  chk(!drawer.classList.contains('open'), 'starts closed');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(drawer.classList.contains('open'), 'opens on button click');
  chk(scrim.classList.contains('open'), 'scrim shows');

  console.log('\n== drawer content ==');
  const rows = body.querySelectorAll('.ev');
  chk(rows.length > 0, 'events rendered', `(${rows.length})`);
  const errs = body.querySelectorAll('.ev.err');
  chk(errs.length > 0, 'failures present', `(${errs.length})`);
  const times = [...body.querySelectorAll('.ev .t')].map(e => e.textContent.trim());
  chk(times.length > 0 && times.every(t => t && t !== 'Invalid Date'),
      'timestamps valid');

  console.log('\n== filters ==');
  const tabs = [...d.querySelectorAll('.dtab')];
  chk(tabs.length === 3, 'three filter tabs', `(${tabs.length})`);
  const all = body.querySelectorAll('.ev').length;
  tabs.find(t => t.dataset.f === 'error')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const onlyErr = body.querySelectorAll('.ev').length;
  const nonErr = [...body.querySelectorAll('.ev')]
    .filter(e => !e.classList.contains('err')).length;
  chk(onlyErr < all, 'failures filter narrows', `${all} -> ${onlyErr}`);
  chk(nonErr === 0, 'failures filter excludes tools');
  tabs.find(t => t.dataset.f === 'tool')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const errLeft = body.querySelectorAll('.ev.err').length;
  chk(errLeft === 0, 'tools filter excludes failures');
  tabs.find(t => t.dataset.f === 'all')
      .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(body.querySelectorAll('.ev').length === all, 'all filter restores');

  console.log('\n== closing ==');
  d.getElementById('dclose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(!drawer.classList.contains('open'), 'closes on X');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  scrim.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  chk(!drawer.classList.contains('open'), 'closes on scrim');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  chk(!drawer.classList.contains('open'), 'closes on Escape');
  d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  chk(drawer.classList.contains('open'), 'L key opens');

  console.log('\n== reachable from every tab ==');
  const views = [...d.querySelectorAll('#views button')].map(b => b.textContent.trim());
  chk(views.length >= 4, 'view tabs found', `(${views.join(', ')})`);
  let okEverywhere = true;
  for (const v of views) {
    const b = [...d.querySelectorAll('#views button')]
      .find(x => x.textContent.trim() === v);
    b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    if (w.getComputedStyle(btn).display === 'none') {
      okEverywhere = false;
      console.log(`     hidden on ${v}`);
    }
  }
  chk(okEverywhere, 'log button visible on all tabs');

  console.log('\n== live card columns ==');
  const cards = [...d.querySelectorAll('#livelist > div')];
  chk(cards.length > 0, 'live cards rendered', `(${cards.length})`);
  if (cards.length) {
    const lastIsGauge = cards.every(c => {
      const kids = [...c.children];
      return kids.length && kids[kids.length - 1].classList.contains('loecol');
    });
    chk(lastIsGauge, 'gauge is the last column on every card');
    const svgs = cards.map(c => c.querySelector('.loe svg')).filter(Boolean);
    chk(svgs.length === cards.length, 'every gauge drew an svg');
    const needles = cards.map(c => c.querySelector('.needle')).filter(Boolean);
    chk(needles.length === cards.length, 'every gauge has a needle');
    const varsOk = needles.every(n => {
      const s = n.getAttribute('style') || '';
      return s.includes('--d:') && s.includes('--amp:') && s.includes('--spd:');
    });
    chk(varsOk, 'needles carry animation vars');
    const angles = needles.map(n =>
      parseFloat((n.getAttribute('style').match(/--d:(-?[\d.]+)deg/) || [])[1]));
    chk(angles.every(a => a >= -90 && a <= 90), 'needle angles in range',
        `[${Math.min(...angles).toFixed(0)}, ${Math.max(...angles).toFixed(0)}]`);
    chk(cards.every(c => c.className.includes('items-center')),
        'card contents vertically centred');
    const meta = cards.map(c => c.querySelector('.metacol')).filter(Boolean);
    chk(meta.length === cards.length, 'every card has a fixed meta column');
    chk(meta.every(m => (m.firstElementChild.className || '').includes('text-[15px]')),
        'model name uses the larger size');
  }

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}, 1200);
