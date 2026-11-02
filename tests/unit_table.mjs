// LST-223/224: table.js as a unit — sorting, aria-sort, numeric-vs-lexical,
// density persistence and keyboard activation, against a real DOM (jsdom).
// Expected orders are derived by hand from the fixture rows below.
import { createRequire } from 'module';
import { isolate } from './lib/isolate.mjs';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log(`  FAIL: ${m}`); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}\n   got ${JSON.stringify(a)}\n   exp ${JSON.stringify(b)}`);

const dom = new JSDOM('<!doctype html><html><body><table id="t"></table></body></html>');
const store = {};
const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
globalThis.document = dom.window.document;
globalThis.localStorage = localStorage;
const T = await isolate('table.js');
const doc = dom.window.document;

eq(T.parseNum('1.5K'), 1500, 'parseNum K');
eq(T.parseNum('2.0M'), 2000000, 'parseNum M');
eq(T.parseNum('$12.50'), 12.5, 'parseNum dollars');
eq(T.parseNum('1,234'), 1234, 'parseNum thousands separator');
eq(T.parseNum('2.00 KB'), 2048, 'parseNum binary bytes');
eq(T.parseNum('~$0.05 elec'), 0.05, 'parseNum local-cost cell');
eq(T.parseNum('↓ 0.4 pp'), -0.4, 'parseNum down arrow is negative');
eq(T.parseNum('gpt-4'), null, 'parseNum rejects names');
eq(T.parseNum('4o-mini'), null, 'parseNum rejects a name that starts with a digit');
eq(T.parseNum('—'), null, 'parseNum dash is empty');

const HTML = `<thead><tr><th>Model</th><th class="text-right">Calls</th><th>Cost</th><th></th></tr></thead><tbody>
 <tr><td>beta</td><td>9</td><td>$2.00</td><td>x</td></tr>
 <tr><td>alpha</td><td>10</td><td>$10.00</td><td>x</td></tr>
 <tr><td>gamma</td><td>100</td><td>$1.00</td><td>x</td></tr>
 <tr data-pin="end"><td>Other</td><td>1</td><td>$0.00</td><td>x</td></tr></tbody>`;
const build = () => { const t = doc.getElementById('t'); t.innerHTML = HTML; T.enhanceTable(t, 't'); return t; };
const order = t => [...t.querySelectorAll('tbody tr')].map(r => r.children[0].textContent);
const btn = (t, label) => [...t.querySelectorAll('th button.dt-sort')].find(b => b.textContent.startsWith(label));
const sortOf = (t, label) => btn(t, label).parentNode.getAttribute('aria-sort');
const key = (k) => new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });

let t = build();
eq(order(t), ['beta', 'alpha', 'gamma', 'Other'], 'untouched table keeps its render order');
eq(sortOf(t, 'Model'), 'none', 'headers start aria-sort=none');
ok(!t.querySelector('th:nth-child(4) button'), 'a blank header gets no sort button');
ok(btn(t, 'Model').tagName === 'BUTTON' && btn(t, 'Model').type === 'button', 'header control is a real button');
ok(btn(t, 'Model').tabIndex === 0, 'header button is in the tab order');
ok(t.classList.contains('dt'), 'table carries the dt class');

btn(t, 'Model').click();
eq(order(t), ['alpha', 'beta', 'gamma', 'Other'], 'first click sorts text ascending, pinned row stays last');
eq(sortOf(t, 'Model'), 'ascending', 'aria-sort ascending after first click');
btn(t, 'Model').click();
eq(order(t), ['gamma', 'beta', 'alpha', 'Other'], 'second click sorts descending');
eq(sortOf(t, 'Model'), 'descending', 'aria-sort descending after second click');

btn(t, 'Calls').click();
eq(order(t), ['beta', 'alpha', 'gamma', 'Other'], 'Calls sorts numerically (9 < 10 < 100), not lexically ("10" < "100" < "9")');
eq(sortOf(t, 'Calls'), 'ascending', 'new column starts ascending');
eq(sortOf(t, 'Model'), 'none', 'previous column returns to none');
ok(t.querySelectorAll('tbody tr:not([data-pin]) td:nth-child(2)')[0].classList.contains('num'), 'numeric cells get the num class (right aligned, tabular)');
ok(btn(t, 'Calls').parentNode.classList.contains('num'), 'numeric header is right aligned too');

btn(t, 'Cost').click();
btn(t, 'Cost').click();
eq(order(t), ['alpha', 'beta', 'gamma', 'Other'], 'Cost column parses $ and sorts descending 10 > 2 > 1');

t = build();
eq(sortOf(t, 'Cost'), 'descending', 're-render re-applies the chosen sort (aria-sort preserved)');
eq(order(t), ['alpha', 'beta', 'gamma', 'Other'], 're-render keeps the chosen order (auto-refresh does not reset it)');

const b = btn(t, 'Model');
b.dispatchEvent(key('Enter'));
eq(sortOf(t, 'Model'), 'ascending', 'Enter on a header button sorts');
eq(order(t), ['alpha', 'beta', 'gamma', 'Other'], 'Enter result order');
btn(t, 'Model').dispatchEvent(key(' '));
eq(sortOf(t, 'Model'), 'descending', 'Space on a header button sorts');
eq(order(t), ['gamma', 'beta', 'alpha', 'Other'], 'Space result order');

// empty cells always sink, in both directions
doc.getElementById('t').innerHTML = `<thead><tr><th>N</th><th class="num">V</th></tr></thead><tbody>
 <tr><td>a</td><td>—</td></tr><tr><td>b</td><td>5</td></tr><tr><td>c</td><td>7</td></tr></tbody>`;
delete T.TABLE_SORT.t;
T.enhanceTable(doc.getElementById('t'), 't');
btn(doc.getElementById('t'), 'V').click();
eq(order(doc.getElementById('t')), ['b', 'c', 'a'], 'ascending: empty value last');
btn(doc.getElementById('t'), 'V').click();
eq(order(doc.getElementById('t')), ['c', 'b', 'a'], 'descending: empty value still last');

// flat table (no thead): first row is the header
doc.getElementById('t').innerHTML = `<tr><th>Item</th><th>N</th></tr><tr><td>x</td><td>2</td></tr><tr><td>y</td><td>1</td></tr>`;
T.enhanceTable(doc.getElementById('t'), 'flat');
btn(doc.getElementById('t'), 'N').click();
eq([...doc.querySelectorAll('#t tr')].slice(1).map(r => r.children[0].textContent), ['y', 'x'], 'flat table: header row stays first, body sorts');

// density
eq(T.getDensity(), 'comfortable', 'default density is comfortable');
t = build();
eq(doc.documentElement.dataset.density, 'comfortable', 'density applied to the root');
const dbtn = k => t.querySelector(`.dt-dens button[data-dens="${k}"]`);
ok(dbtn('comfortable').getAttribute('aria-pressed') === 'true', 'comfortable pressed by default');
dbtn('compact').click();
eq(store['llmt.density'], 'compact', 'choosing compact persists to localStorage');
eq(doc.documentElement.dataset.density, 'compact', 'compact applied to the root');
eq(T.getDensity(), 'compact', 'getDensity reads the stored value');
t = build();
ok(dbtn('compact').getAttribute('aria-pressed') === 'true', 'a fresh render shows the stored density');
T.setDensity('garbage');
eq(store['llmt.density'], 'comfortable', 'unknown density falls back to comfortable');

// wide matrix (projmatrix shape): tfoot stays put, dashes sort last, 1,200 rows sort fast, wrapper scrolls
{
  const t2 = doc.createElement('table');
  const w = doc.createElement('div'); w.appendChild(t2); doc.body.appendChild(w);
  let rows = '';
  for (let i = 0; i < 1200; i++) rows += `<tr><td>p${i}</td><td class="text-right">${i % 7 === 0 ? '—' : '$' + ((i * 37) % 1000) + '.50'}</td><td class="text-right">${(i * 13) % 500}</td></tr>`;
  t2.innerHTML = `<thead><tr><th>Project</th><th class="text-right">Cost</th><th class="text-right">Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td>Total</td><td>1</td><td>2</td></tr></tfoot>`;
  T.enhanceTable(t2, 'mx');
  ok(w.classList.contains('dt-wrap'), 'helper marks the wrapper dt-wrap (bounded scroll container)');
  ok(t2.querySelector('td.num') && t2.querySelector('th.num'), 'matrix numeric cells and headers are right-aligned');
  const b = [...t2.querySelectorAll('th button.dt-sort')].find(x => x.textContent.startsWith('Total'));
  const t0 = Date.now();
  b.click(); b.click();
  ok(Date.now() - t0 < 1500, 'two sorts of 1,200 rows are fast');
  const col = [...t2.querySelectorAll('tbody tr')].map(r => +r.children[2].textContent);
  ok(col[0] >= col[col.length - 1] && col[0] === Math.max(...col), 'matrix sorts numerically descending');
  eq(b.parentNode.getAttribute('aria-sort'), 'descending', 'matrix header aria-sort descending');
  eq(t2.querySelector('tfoot td').textContent, 'Total', 'tfoot is not sorted');
  [...t2.querySelectorAll('th button.dt-sort')].find(x => x.textContent.startsWith('Cost')).click();
  const c = [...t2.querySelectorAll('tbody tr')].map(r => r.children[1].textContent);
  eq(c[c.length - 1], '—', 'dash cells sort last ascending');
}

console.log(`\nunit_table.mjs  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
