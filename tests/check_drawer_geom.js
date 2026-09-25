// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Measure the drawer's REAL geometry: is it actually on screen when open?
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync(REPORTS+'/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

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
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
  },
});

const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};

setTimeout(() => {
  const drawer = d.getElementById('drawer');
  const btn = d.getElementById('logbtn');
  const scrim = d.getElementById('scrim');

  console.log('== DOM placement ==');
  console.log(`  drawer parent : <${drawer.parentElement.tagName.toLowerCase()} ` +
              `class="${drawer.parentElement.className}">`);
  console.log(`  button parent : <${btn.parentElement.tagName.toLowerCase()} ` +
              `class="${btn.parentElement.className}">`);
  chk(drawer.parentElement === d.body, 'drawer is a direct child of <body>');
  chk(btn.parentElement === d.body, 'log button is a direct child of <body>');
  chk(scrim.parentElement === d.body, 'scrim is a direct child of <body>');

  console.log('\n== ancestors that would trap position:fixed ==');
  // transform / filter / perspective / contain / will-change on an ancestor
  // makes fixed children resolve against THAT box, not the viewport.
  let bad = [];
  for (const el of [drawer, btn]) {
    let p = el.parentElement;
    while (p && p !== d.documentElement) {
      const s = w.getComputedStyle(p);
      const culprit = ['transform', 'filter', 'perspective', 'contain', 'willChange']
        .find(k => s[k] && s[k] !== 'none' && s[k] !== 'auto' && s[k] !== '');
      if (culprit) bad.push(`${el.id} <- ${p.className || p.tagName}: ${culprit}=${s[culprit]}`);
      p = p.parentElement;
    }
  }
  bad.forEach(b => console.log('   ', b));
  chk(bad.length === 0, 'no containing-block trap on any ancestor');

  console.log('\n== computed style, closed ==');
  let ds = w.getComputedStyle(drawer);
  console.log(`  position=${ds.position}  right=${ds.right}  width=${ds.width}` +
              `  transform=${ds.transform}  z-index=${ds.zIndex}  visibility=${ds.visibility}`);
  chk(ds.position === 'fixed', 'drawer is position:fixed');
  chk(parseInt(ds.zIndex, 10) >= 50, 'drawer z-index is above the page', `(${ds.zIndex})`);

  const bs = w.getComputedStyle(btn);
  console.log(`  button: position=${bs.position}  right=${bs.right}  bottom=${bs.bottom}` +
              `  z-index=${bs.zIndex}  display=${bs.display}`);
  chk(bs.position === 'fixed', 'log button is position:fixed');
  chk(bs.display !== 'none', 'log button is displayed');
  chk(parseInt(bs.zIndex, 10) >= 50, 'button z-index is above the page', `(${bs.zIndex})`);

  console.log('\n== opening ==');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ds = w.getComputedStyle(drawer);
  console.log(`  open: transform=${ds.transform}  class="${drawer.className}"`);
  chk(drawer.classList.contains('open'), 'open class applied');
  // closed should translate off-screen, open should not
  const closedRule = html.match(/#drawer\{[^}]*\}/s);
  const openRule = html.match(/#drawer\.open\{[^}]*\}/s);
  console.log(`  closed rule: ${closedRule ? closedRule[0].replace(/\s+/g, ' ') : 'MISSING'}`);
  console.log(`  open rule  : ${openRule ? openRule[0].replace(/\s+/g, ' ') : 'MISSING'}`);
  chk(!!openRule, '#drawer.open rule exists');
  chk(!!closedRule && /translate/.test(closedRule[0]), 'closed state translates off-screen');
  chk(!!openRule && /translate(X)?\(0/.test(openRule[0]), 'open state translates back to 0');

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}, 1200);
