// #150: costs.js as a unit — the calculator's grouping, its default choice and
// its arithmetic, no page load. costs.js has no exports and runs on import, so
// it is driven through a fake DOM: the optgroups it builds and the strings it
// puts in #ctot / #cbrk are the observable behaviour.
//
// Expected values are hand-derived from the source rules (KIND, the GROUPS
// order, `(b.u - a.u) || name`, the money() bands, `Math.max(1, round(x)||1)`),
// NOT captured from output, so a change in a rule fails here.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);

// ---- a DOM with just enough shape for costs.js --------------------------
const mkEl = () => ({
  value: '', textContent: '', innerHTML: '', dataset: {}, style: {},
  children: [], label: '', tag: '',
  appendChild(c) { this.children.push(c); },
  addEventListener(type, fn) { (this._on ||= {})[type] = fn; },
  remove() {},
});
const el = id => (registry[id] ||= mkEl());
const registry = {};
const created = [];
globalThis.document = {
  getElementById: el,
  createElement: tag => { const e = mkEl(); e.tag = tag; created.push(e); return e; },
  documentElement: mkEl(), querySelectorAll: () => [], addEventListener() {},
};

// A sheet covering every kind, deliberately out of order, with duplicates to
// sort through and one metered model that has no `u` at all.
const CATALOG = [
  { n: 'zed', s: 'metered', u: 1, i: 3, o: 15 },
  { n: 'alpha', s: 'metered', u: 1, i: 1, o: 1 },
  { n: 'mid', s: 'metered', u: 0, i: 2, o: 4 },
  { n: 'zeta', s: 'metered', u: 0, i: 2, o: 4 },
  { n: 'local-big', s: 'local', u: 1, i: 0, o: 0 },
  { n: 'freebie', s: 'free-tier', u: 1 },
  { n: 'mystery', s: 'unpriced', u: 0 },
  { n: 'oldprice', s: '', u: 0, i: 1, o: 1 },
];

await isolate('costs.js', {}, { __CALCDATA__: CATALOG });

const sel = registry['cm'];
const fire = (id, type = 'input') => registry[id]._on[type]();
const text = () => registry['ctot'].textContent;
const brk = () => registry['cbrk'].innerHTML;

// ---- grouping -----------------------------------------------------------
const groups = sel.children.filter(c => c.tag === 'optgroup');
eq(groups.map(g => g.dataset.kind), ['local', 'metered', 'free', 'unpriced'],
   'optgroups appear in the fixed order: local, metered, free, unpriced');
eq(groups.map(g => g.label),
   ['Local (electricity) · 1', 'Metered (billed per token) · 5',
    'Free tier ($0) · 1', 'Unpriced (no rate) · 1'],
   'each group label carries its member count');
eq(created.filter(c => c.tag === 'option').length, 8,
   'every catalogue entry becomes exactly one option');
eq(groups[0].children.map(o => [o.value, o.textContent]), [[4, 'local-big  • used']],
   'options carry the catalogue index and mark the used ones');
eq(groups[1].children.map(o => o.value), [1, 0, 2, 7, 3],
   'metered: used first by name, then the rest by name');
eq(groups[1].children.map(o => o.textContent),
   ['alpha  • used', 'zed  • used', 'mid', 'oldprice', 'zeta'],
   'only used models carry the marker');
eq(groups[3].children[0].textContent, 'mystery', 'an unused model gets no marker');
eq(groups[2].children[0].value, 5, 'the free tier group holds the free-tier model');

// A sheet with no members of a kind must not create an empty group.
const registry2 = {};
const sel2 = (registry2['cm'] = mkEl());
const el2 = id => (registry2[id] ||= mkEl());
globalThis.document.getElementById = el2;
await isolate('costs.js', {}, { __CALCDATA__: [{ n: 'only', s: 'metered', u: 0, i: 1, o: 1 }] });
eq(sel2.children.filter(c => c.tag === 'optgroup').map(g => g.dataset.kind), ['metered'],
   'a kind with no members produces no optgroup');
eq(sel2.value, '', 'no used metered model leaves the selection alone');
chk(!('ctot' in registry2), 'an empty selection writes nothing at all: calc returns before touching the output');
globalThis.document.getElementById = el;

// ---- the default selection is the dearest used metered model -----------
eq(sel.value, '0', 'the default is the dearest used metered model (zed, output 15)');
eq([text(), registry['ctot'].style.color], ['$0.00 billed', 'inherit'],
   'an empty load costs $0.00 billed');
eq(brk(), 'in $0.00 + out $0.00', 'a single run has no ×N in the breakdown');

// ---- arithmetic --------------------------------------------------------
registry['ci'].value = '1m';
registry['co'].value = '1m';
fire('ci');
// zed: in 1e6/1e6*3 = $3.00, out 15 → (3+15) = 18
eq(text(), '$18.00 billed', 'the total is in-cost + out-cost at the model rate');
eq(brk(), 'in $3.00 + out $15.00', 'the breakdown shows both sides');

registry['cr'].value = '2';
fire('cr');
eq(text(), '$36.00 billed', 'runs multiply the total');
eq(brk(), 'in $3.00 + out $15.00 &times; 2 runs', 'a multi-run breakdown says ×2 runs');

registry['cr'].value = '2.4';
fire('cr');
eq(text(), '$36.00 billed', 'runs round to the nearest whole run');
registry['cr'].value = '0';
fire('cr');
eq(text(), '$18.00 billed', 'a zero run count falls back to one run');
registry['cr'].value = '';
fire('cr');
eq(text(), '$18.00 billed', 'an empty run count falls back to one run');

// ---- token parsing ----------------------------------------------------
sel.value = '2';                       // mid: in 2, out 4
registry['ci'].value = '1,000,000';
registry['co'].value = '';
fire('ci', 'change');                  // the change listener drives the same calc
eq(text(), '$2.00 billed', 'commas are stripped from token counts');
registry['ci'].value = '1_000';
fire('ci');
eq(text(), '$0.00200 billed', 'underscores are stripped and small money keeps 5dp');
registry['ci'].value = '10000';
fire('ci');
eq(text(), '$0.020 billed', 'money at 0.01 keeps 3dp');
registry['ci'].value = '1';
fire('ci');
eq(text(), '$0.00000 billed', 'a positive sub-cent amount keeps 5dp, never $0');
registry['ci'].value = 'nonsense';
fire('ci');
eq(text(), '$0.00 billed', 'an unparseable token count is zero, not NaN');
registry['ci'].value = '-5';
fire('ci');
eq(text(), '$0.00 billed', 'a negative token count is rejected');

// ---- local: electricity, not a bill -----------------------------------
sel.value = '4';
registry['ci'].value = '1m';
registry['co'].value = '1m';
fire('ci');
eq(text(), '≈ $0.00 electricity', 'a local model is costed as electricity');
eq(registry['ctot'].style.color, '#fbbf24', 'the local total is amber');
chk(brk().includes('your power cost, not billed by anyone'), 'the local breakdown says whose cost it is', brk());

// ---- free tier --------------------------------------------------------
sel.value = '5';
fire('ci');
chk(text().endsWith(' free tier'), 'a free-tier model is labelled free tier', text());
chk(!text().includes('NaN'), 'a free-tier model with no rates does not print NaN', text());
chk(brk().includes('OpenRouter free tier: $0 per token'), 'the free-tier breakdown explains the $0', brk());
eq(registry['ctot'].style.color, 'inherit', 'the free-tier total is not amber');

// ---- unpriced: never a silent $0 --------------------------------------
sel.value = '6';
fire('ci');
eq(text(), 'no rate available', 'an unpriced model says so instead of $0.00');
eq(registry['ctot'].style.color, '#f87171', 'the unpriced total is red');
eq(registry['ctot'].dataset.kind, 'unpriced', 'the kind is exposed on the total for the CSS');
chk(brk().includes('no price in the catalogue'), 'the unpriced breakdown explains why', brk());

// ---- out-of-range selection -------------------------------------------
registry['ctot'].textContent = 'sentinel';
sel.value = '99';
fire('ci');
eq(text(), 'sentinel', 'an index past the end of the sheet is ignored, not rendered as NaN');

// ---- every control is wired to the same calc --------------------------
chk(['cm', 'ci', 'co', 'cr'].every(id => registry[id]._on.input && registry[id]._on.change),
    'all four controls listen on input and change');
eq(registry['cm']._on.input === registry['cm']._on.change, true,
   'one handler serves both events, so keyboard and paste agree');
eq(registry['ci']._on.input === registry['co']._on.input, true,
   'each control shares the single calc function');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
