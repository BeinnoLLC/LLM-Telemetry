/**
 * Unit tests for router.js — section switching, hash routing/serialisation and
 * persistence, plus the Settings/interval controls, the nav drawer and the
 * per-profile colour + logo controls (#30, P2-06).
 *
 * Every expected value below is derived by hand from the source. Where an
 * expectation leans on a dependency's guarantee the dependency itself is
 * asserted (palette.hashHue, palette.slugOf) rather than a value captured from
 * this suite's own output.
 *
 * WHY A SHIM: router.js cannot be `import`ed as a plain ES module. It REASSIGNS
 * bindings that it also imports from its siblings (COLORS/TOOLCOLORS from
 * palette, current/projDistNormalized/projTrendStacked from charts, LIVE_MS/
 * REBUILD_MS from live) — e.g. `COLORS = buildColors(allModelNames())` at
 * router.js:944 and `current = …` at router.js:883. Those writes are legal in
 * the shipped page because the build inlines every module into ONE scope, but
 * an ES import is read-only to the importer, so importing the file verbatim
 * dies at parse/link time. The shim below re-declares exactly the names that
 * are both imported and assigned as local `let` (what the single-scope build
 * effectively does) and drops them from the import clauses. The shim is written
 * to scratch space; router.js itself is never modified, and every line of the
 * hash/URL logic under test is byte-identical to the source.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isolate } from './lib/isolate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.resolve(HERE, '..', 'src', 'llm_telemetry', 'web', 'js');
const SRC_PATH = path.join(JS_DIR, 'router.js');
const src = readFileSync(SRC_PATH, 'utf8');

// ---------------------------------------------------------------- the shim --
const IMPORT_RE = /import\s*\{([\s\S]*?)\}\s*from\s*['"](\.[^'"]+)['"];/g;
// statement-level `name = …` (not `const name =`, not `obj.prop =`, not `a[i] =`)
const ASSIGN_RE = /^[ \t]*([A-Za-z_$][\w$]*)[ \t]*=[^=]/gm;

const namesOf = clause => clause.split(',').map(s => s.trim()).filter(Boolean)
  .map(s => s.split(/\s+as\s+/)[0]);

const imported = new Set();
for (const m of src.matchAll(IMPORT_RE)) namesOf(m[1]).forEach(n => imported.add(n));
const assigned = new Set();
for (const m of src.matchAll(ASSIGN_RE)) assigned.add(m[1]);
// The shared writes: imported by router.js, written by router.js.
const SHARED_WRITES = [...imported].filter(n => assigned.has(n)).sort();

const shimSource = s => {
  const drop = new Set(SHARED_WRITES);
  let out = s.replace(IMPORT_RE, (all, clause, spec) => {
    const kept = namesOf(clause).filter(n => !drop.has(n));
    return `import { ${kept.join(', ')} } from '${spec}';`;
  });
  const decl = `\n// [unit_router.mjs shim] names the single-scope build shares:\nlet ${SHARED_WRITES.join(', ')};\n`;
  const at = out.indexOf(';', out.lastIndexOf('\nimport '));
  return out.slice(0, at + 1) + decl + out.slice(at + 1);
};

const shimSrc = shimSource(src);
const SHIM_DIR = path.join(process.env.TMPDIR || '/tmp', 'unit_router_shim');
mkdirSync(SHIM_DIR, { recursive: true });
const SHIM_PATH = path.join(SHIM_DIR, 'router.unit.mjs');
writeFileSync(SHIM_PATH, shimSrc);
const SHIM_REL = path.relative(JS_DIR, SHIM_PATH);

const stripImportNoise = t => t
  .replace(IMPORT_RE, '')
  .replace(/^\/\/ \[unit_router\.mjs shim\][\s\S]*?\nlet [^\n]*\n/m, '')
  .replace(/^\s*\n/gm, '');

// ------------------------------------------------------------ fake browser --
const mkEl = (tag = 'div') => {
  const el = {
    tagName: tag.toUpperCase(), id: '', value: '', textContent: '', innerHTML: '',
    checked: false, hidden: false, disabled: false, files: [], dataset: {},
    style: {}, children: [], _attrs: {}, _cls: new Set(),
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    removeAttribute(k) { delete el._attrs[k]; },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    focus() { doc.activeElement = el; }, blur() {},
    appendChild(c) { el.children.push(c); return c; }, remove() {}, removeChild() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    checkValidity() { return true; }, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
  };
  el.classList = {
    add: (...c) => c.forEach(x => el._cls.add(x)),
    remove: (...c) => c.forEach(x => el._cls.delete(x)),
    contains: c => el._cls.has(c),
    toggle: (c, force) => {
      const on = force === undefined ? !el._cls.has(c) : !!force;
      if (on) el._cls.add(c); else el._cls.delete(c);
      return on;
    },
  };
  return el;
};

const els = new Map();
const getEl = id => { if (!els.has(id)) { const e = mkEl(); e.id = id; els.set(id, e); } return els.get(id); };

const BASE_VIEWS = ['Home', 'Live', 'Flow', 'Router', 'Quota', 'Usage', 'Sessions', 'Cost', 'Prices', 'Health', 'Detail', 'Logs', 'Settings'];
const EXTRA_VIEWS = ['A B', 'A?B', 'Ünicode Ünïts'];
const viewEls = [...BASE_VIEWS, ...EXTRA_VIEWS].map(n => {
  const e = mkEl('section');
  e.dataset.view = n;
  return e;
});

const qmap = new Map();           // selector(s) the suite controls
const doc = {
  body: mkEl('body'), activeElement: null,
  getElementById: getEl,
  querySelector: sel => qmap.get(sel) || null,
  querySelectorAll: sel => {
    if (qmap.has(sel)) return qmap.get(sel);
    if (sel === '.view') return viewEls.slice();
    return [];
  },
  addEventListener() {}, removeEventListener() {}, createElement: t => mkEl(t),
};

let hashWrites = 0;
let mq = false;
const store = {};
const loc = { _h: '' };
Object.defineProperty(loc, 'hash', {
  get: () => loc._h,
  set: v => { hashWrites++; loc._h = String(v).startsWith('#') ? String(v) : '#' + String(v); },
});
const ls = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  key: i => Object.keys(store)[i] ?? null,
  get length() { return Object.keys(store).length; },
};
const win = {
  matchMedia: () => ({ matches: mq, media: '(max-width:640px)', addEventListener() {}, addListener() {} }),
  addEventListener() {}, removeEventListener() {}, innerWidth: 1280, scrollTo() {},
};
const raf = fn => { fn(); return 0; };

const POWER = {
  defaults: { tariff: { standing_charge: 0.5, unit_rate: 0.28 }, interval_defaults: { live_poll_interval_s: 5 } },
  tariff: { standing_charge: 0.5, unit_rate: 0.28, export_rate: 0.15 },
  interval_defaults: { live_poll_interval_s: 7 },   // only one of the two keys
  config_file: '/etc/llm-telemetry/energy.toml',
};

globalThis.window = win;
globalThis.document = doc;
globalThis.localStorage = ls;
globalThis.location = loc;
globalThis.requestAnimationFrame = raf;
globalThis.__POWER__ = POWER;

// ------------------------------------------------- dependencies under test --
// The real palette is loaded (with its own deps stubbed) so slugOf/esc/escA/
// hashHue/build* are the shipped implementations, exactly as the sibling
// suites do; `pick` is stubbed because it renders a whole view.
const P = await isolate('palette.js', { 'main.js': { DATA: {} }, 'views.js': { PROV: {} } });

const DATA = {
  profiles: {
    'All': { rows: [], hour_rows: [] },
    'anthropic': { rows: [], hour_rows: [] },
    'nous': { rows: [], hour_rows: [] },
  },
};
const buildAll = () => ({ rows: [], hour_rows: [] });

const SUPERSET = {
  'palette.js': {
    $: getEl, allModelNames: () => [], allToolNames: () => [],
    buildColors: P.buildColors, buildToolColors: P.buildToolColors,
    esc: P.esc, escA: P.escA, hashHue: P.hashHue, slugOf: P.slugOf,
    pick: () => {},
    COLORS: {}, TOOLCOLORS: {},              // only stubbed for the no-shim probe below
  },
  'charts.js': {
    bounds: () => ['', ''], charts: [], outPer1M: () => 0, usdPerSec: () => 0,
    current: null, projDistNormalized: null, projTrendStacked: null,
  },
  'views.js': { flash: () => {}, render: () => {}, renderResolution: () => {}, syncProjFilterUI: () => {} },
  'flow.js': { renderFlow: () => {} },
  'drawer.js': { loadLogs: () => {}, logsInstall: () => {} },
  'live.js': { renderLive: () => {}, LIVE_MS: 0, REBUILD_MS: 0 },
  'main.js': { DATA, buildAll, installAll: () => {} },
};

const stubsFor = (source, keepAll = false) => {
  const out = {};
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[2];
    const bare = spec.replace(/^\.\//, '');
    const base = SUPERSET[bare];
    if (!base) throw new Error(`unit_router: no stub module for ${spec}`);
    const o = {};
    for (const n of namesOf(m[1])) {
      if (!keepAll && SHARED_WRITES.includes(n)) continue;
      if (!(n in base)) throw new Error(`unit_router: stub for ${spec} is missing ${n}`);
      o[n] = base[n];
    }
    out[bare] = o;
  }
  return out;
};

const R = await isolate(SHIM_REL, stubsFor(shimSrc), {
  window: win, document: doc, localStorage: ls, location: loc,
  requestAnimationFrame: raf, __POWER__: POWER,
});

// ------------------------------------------------------------- check helpers --
let pass = 0, fail = 0;
const eq = (got, want, name) => {
  try { assert.deepEqual(got, want); pass++; }
  catch (e) {
    fail++;
    console.log(`FAIL ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
  }
};
const ok = (cond, name) => eq(!!cond, true, name);
const noThrow = (fn, name) => { try { fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${name}: threw ${e.message}`); } };

const viewEl = n => `#/${n}`;
const clearAll = () => { hashWrites = 0; loc._h = ''; ls.clear(); };

// =============================================================== shim proof =
ok(SHARED_WRITES.length >= 1,
  'shim: router.js really does reassign bindings it imports from siblings (a plain import cannot work)');
eq(SHARED_WRITES.includes('current'), true, 'shim: `current` (charts.js) is one of the shared writes');
eq(SHARED_WRITES.includes('COLORS'), true, 'shim: `COLORS` (palette.js) is one of the shared writes');
eq(stripImportNoise(shimSrc), stripImportNoise(src),
  'shim: only the import clauses and the shared-write declaration differ — every logic line is byte-identical');
ok(shimSrc.includes('let ' + SHARED_WRITES.join(', ') + ';'),
  'shim: the shared writes are re-declared once, locally');
eq(SHIM_REL.startsWith('..'), true, 'shim: the generated module lives outside src/ (router.js is never written to)');

// ============================================================ module state ==
eq(R.view, 'Home', 'view: defaults to Home when nothing is stored');
ok(R.HOUR_RANGE === null, 'HOUR_RANGE: null (all time) by default');
eq(R.PROJECT_FILTER, '', 'PROJECT_FILTER: empty by default');
eq(R.PROVIDER_FILTER, '', 'PROVIDER_FILTER: empty by default');
eq(R.MODEL_FILTER, '', 'MODEL_FILTER: empty by default');
eq(R.navOpen, false, 'navOpen: drawer closed at boot');
eq(R.POWER, POWER, 'POWER: the build-embedded object, unchanged');
eq(R.SET_DEFAULTS, POWER.defaults, 'SET_DEFAULTS: aliases POWER.defaults');
eq(R.setState, {
  values: { standing_charge: 0.5, unit_rate: 0.28, export_rate: 0.15 },
  writable: false, api: false, file: '/etc/llm-telemetry/energy.toml',
}, 'setState: seeded from POWER.tariff, read-only until GET /api/settings lands');
eq(R.setState.writable, false, 'setState: not writable before the API answers');
eq(R.INTERVAL_DEFAULTS, { live_poll_interval_s: 7, analytics_rebuild_interval_s: 60 },
  'INTERVAL_DEFAULTS: POWER override wins, missing key falls back to 60');
eq(R.NAVKEY, 'hermes-dash-navcollapsed', 'NAVKEY: storage key literal');
eq(R.NAV_FALLBACK_GROUP, 'More', 'NAV_FALLBACK_GROUP: literal');
eq(R.PROFILE_LOGO_MAX_BYTES, 204800, 'PROFILE_LOGO_MAX_BYTES: 200 KiB');
eq(R.NAV_GROUPS.map(g => g.name), ['Overview', 'Analysis', 'System'], 'NAV_GROUPS: group names/order');
eq(R.NAV_GROUPS.map(g => g.views.length), [5, 6, 3], 'NAV_GROUPS: group sizes (Rankings joined Analysis)');
eq(Object.keys(R.NAV_ICONS).length, 14, 'NAV_ICONS: one icon per built-in view (incl. Rankings)');

// ==================================================== slugOf / viewFromHash ==
eq(R.NAV_ICONS.Home, '\u2302', 'NAV_ICONS: Home icon code point');
eq(R.NAV_ICONS.Settings, '\u2699', 'NAV_ICONS: Settings icon code point');

loc._h = '#/home';
eq(R.viewFromHash(), 'Home', 'viewFromHash: #/home -> Home');
loc._h = '#/HOME';
eq(R.viewFromHash(), 'Home', 'viewFromHash: case-insensitive (#/HOME)');
loc._h = '#home';
eq(R.viewFromHash(), 'Home', 'viewFromHash: tolerates a missing slash (#home)');
loc._h = '#HOME';
eq(R.viewFromHash(), 'Home', 'viewFromHash: missing slash + upper case');
loc._h = '#/live';
eq(R.viewFromHash(), 'Live', 'viewFromHash: #/live -> Live');
loc._h = '#/Settings';
eq(R.viewFromHash(), 'Settings', 'viewFromHash: #/Settings -> Settings');
loc._h = '#/a b';
eq(R.viewFromHash(), 'A B', 'viewFromHash: space in a view name resolves');
loc._h = '#/a b   ';
eq(R.viewFromHash(), 'A B', 'viewFromHash: trailing whitespace trimmed');
loc._h = '#/ünicode ünïts';
eq(R.viewFromHash(), 'Ünicode Ünïts', 'viewFromHash: non-ASCII lower-cased for comparison');
loc._h = '#/nope';
eq(R.viewFromHash(), null, 'viewFromHash: unknown slug -> null (must not blank the page)');
loc._h = '#/Home/extra';
eq(R.viewFromHash(), null, 'viewFromHash: extra path segments -> null');
loc._h = '';
eq(R.viewFromHash(), null, 'viewFromHash: empty hash -> null');
loc._h = '#';
eq(R.viewFromHash(), null, 'viewFromHash: bare # -> null');
loc._h = '#/';
eq(R.viewFromHash(), null, 'viewFromHash: bare #/ -> null');
loc._h = '#/   ';
eq(R.viewFromHash(), null, 'viewFromHash: whitespace-only slug -> null');
loc._h = null;
eq(R.viewFromHash(), null, 'viewFromHash: null hash tolerated (the || \'\' guard)');
loc._h = '#/a%20b';
eq(R.viewFromHash(), 'A B', 'viewFromHash: a percent-encoded slug is decoded before matching (#138)');
loc._h = '#/a%3Fb%ZZ';
eq(R.viewFromHash(), null, 'viewFromHash: a malformed escape does not throw (#138)');

// ============================================== setHash serialisation (URL) ==
clearAll(); R.clearCrossFilters();
R.setHash('Home');
eq(loc.hash, '#/home', 'setHash: Home -> #/home (lower-cased slug)');
eq(hashWrites, 1, 'setHash: writes the hash once');
R.setHash('Home');
eq(hashWrites, 1, 'setHash: same target is a no-op (no redundant render)');
R.setHash('Projects');
eq(loc.hash, '#/projects', 'setHash: projects -> #/projects');
eq(hashWrites, 2, 'setHash: a different target does write');
R.setHash('A B');
eq(loc.hash, '#/a%20b', 'setHash: a space in the view is percent-encoded (#138)');

// round-trip: parse(serialise(view)) == view
let bad = [];
for (const v of BASE_VIEWS.concat(['A B', 'Ünicode Ünïts'])) {
  R.clearCrossFilters();
  loc._h = '';
  R.setHash(v);
  if (R.viewFromHash() !== v) bad.push(`${v} -> ${loc.hash} -> ${R.viewFromHash()}`);
}
eq(bad, [], 'round-trip: setHash(v) then viewFromHash() returns v for every real view');

// round-trip with filters, and filters carried in the hash
R.clearCrossFilters();
R.setCrossFilter('project', 'acme');
R.setHash('Usage');
eq(loc.hash, '#/usage?project=acme', 'setHash: serialises ?project=… after the slug');
R.setCrossFilter('provider', 'nous');
R.setHash('Usage');
eq(loc.hash, '#/usage?project=acme&provider=nous', 'setHash: project then provider, in that order');
R.setCrossFilter('model', 'claude-3-opus');
R.setHash('Usage');
eq(loc.hash, '#/usage?project=acme&provider=nous&model=claude-3-opus',
  'setHash: project, provider, model in a fixed order');
eq(R.filterFromHash('project'), 'acme', 'round-trip: project survives the URL');
eq(R.filterFromHash('provider'), 'nous', 'round-trip: provider survives the URL');
eq(R.filterFromHash('model'), 'claude-3-opus', 'round-trip: model survives the URL');
eq(R.viewFromHash(), 'Usage', 'round-trip: the view still resolves with a query string');

// unusual characters are percent-encoded (encodeURIComponent)
R.clearCrossFilters();
R.setCrossFilter('project', 'a b');
R.setHash('Usage');
eq(loc.hash, '#/usage?project=a%20b', 'setHash: space in a filter value is percent-encoded');
eq(R.projectFromHash(), 'a b', 'round-trip: %20 decodes back to the space');
R.clearCrossFilters();
R.setCrossFilter('project', 'r&d=1');
R.setHash('Usage');
eq(loc.hash, '#/usage?project=r%26d%3D1', 'setHash: & and = inside a value are escaped');
eq(R.projectFromHash(), 'r&d=1', 'round-trip: r&d=1 comes back intact (not split on &)');
R.clearCrossFilters();
R.setCrossFilter('project', 'nous/ü ö');
R.setHash('Usage');
eq(R.projectFromHash(), 'nous/ü ö', 'round-trip: unicode + slash filter value survives');

// empty values are omitted from the URL
R.clearCrossFilters();
R.setHash('Home');
eq(loc.hash, '#/home', 'setHash: empty filters add no query string');
R.setCrossFilter('project', 'acme');
R.clearCrossFilters();
R.setHash('Home');
eq(loc.hash, '#/home', 'setHash: clearing the filters drops the query string');

// degenerate / malformed inputs
R.clearCrossFilters();
loc._h = '';
R.setHash(null);
eq(loc.hash, '', 'setHash(null): leaves the hash alone instead of writing #/null (#138)');
eq(R.viewFromHash(), null, 'setHash(null): and #/null does not parse back');
loc._h = '';
R.setHash('');
eq(loc.hash, '', 'setHash(""): leaves the hash alone instead of writing #/ (#138)');
eq(R.viewFromHash(), null, 'setHash(""): #/ resolves to no view');
loc._h = '';
R.setHash('A?B');
eq(loc.hash, '#/a%3Fb', 'setHash("A?B"): ? is percent-encoded in the view slug (#138)');
ok(!loc.hash.slice(2).includes('?'), 'setHash("A?B"): so the slug can no longer be read as a query string (#138)');

// ============================================== filterFromHash / malformed ==
loc._h = '#/usage?project=acme';
eq(R.projectFromHash(), 'acme', 'projectFromHash: reads ?project=…');
eq(R.filterFromHash('provider'), '', 'filterFromHash: absent key -> empty string');
loc._h = '#/usage?project=';
eq(R.filterFromHash('project'), '', 'filterFromHash: empty value -> empty string');
loc._h = '#/usage?project';
eq(R.filterFromHash('project'), '', 'filterFromHash: valueless key -> empty string');
loc._h = '#/usage';
eq(R.filterFromHash('project'), '', 'filterFromHash: no query string -> empty string');
loc._h = '#/usage?other=1';
eq(R.filterFromHash('project'), '', 'filterFromHash: unknown keys ignored');
loc._h = '#/usage?other=1';
eq(R.filterFromHash('other'), '1', 'filterFromHash: still returns a polled unknown key');
loc._h = '#/usage?project=a&project=b';
eq(R.filterFromHash('project'), 'a', 'filterFromHash: repeated key -> first wins');
loc._h = '#/usage?project=%E2%82%AC';
eq(R.filterFromHash('project'), '€', 'filterFromHash: percent-decodes the value');
loc._h = '#/usage?project=a+b';
eq(R.filterFromHash('project'), 'a b', 'filterFromHash: a literal + decodes to a space (URLSearchParams)');
loc._h = '#/usage?project=%';
eq(R.filterFromHash('project'), '%', 'filterFromHash: malformed % does not throw');
loc._h = '#/usage?%';
eq(R.filterFromHash('project'), '', 'filterFromHash: bare % key does not throw');
loc._h = '#';
eq(R.filterFromHash('project'), '', 'filterFromHash: bare # -> empty string');
loc._h = null;
eq(R.filterFromHash('project'), '', 'filterFromHash: null hash tolerated');
loc._h = '?project=x';
eq(R.filterFromHash('project'), 'x', 'filterFromHash: query with no # at all still reads');
loc._h = '#/home?project=acme&provider=nous&model=m1';
eq([R.projectFromHash(), R.filterFromHash('provider'), R.filterFromHash('model')],
  ['acme', 'nous', 'm1'], 'filterFromHash: all three filters read independently');

// ============================= setCrossFilter / clearCrossFilters / sync ====
R.clearCrossFilters();
R.setCrossFilter('project', 'p1');
eq(R.PROJECT_FILTER, 'p1', 'setCrossFilter: project routes to PROJECT_FILTER');
R.setCrossFilter('provider', 'nous');
eq(R.PROVIDER_FILTER, 'nous', 'setCrossFilter: provider routes to PROVIDER_FILTER');
eq(R.PROJECT_FILTER, 'p1', 'setCrossFilter: setting provider leaves project alone');
R.setCrossFilter('model', 'm1');
eq(R.MODEL_FILTER, 'm1', 'setCrossFilter: model routes to MODEL_FILTER');
R.setCrossFilter('bogus', 'zzz');
eq([R.PROJECT_FILTER, R.PROVIDER_FILTER, R.MODEL_FILTER], ['p1', 'nous', 'm1'],
  'setCrossFilter: unknown key is ignored, not stored anywhere');
R.setCrossFilter('project', null);
eq(R.PROJECT_FILTER, '', 'setCrossFilter: null clears the value');
eq(R.PROVIDER_FILTER, 'nous', 'setCrossFilter: null on one key leaves the others');
R.setCrossFilter('provider', 0);
eq(R.PROVIDER_FILTER, '', 'setCrossFilter: 0 is falsy and clears the value');
R.clearCrossFilters();
eq([R.PROJECT_FILTER, R.PROVIDER_FILTER, R.MODEL_FILTER], ['', '', ''],
  'clearCrossFilters: clears all three');

loc._h = '#/usage?project=p1&provider=nous&model=m1';
R.setFiltersFromHash();
eq([R.PROJECT_FILTER, R.PROVIDER_FILTER, R.MODEL_FILTER], ['p1', 'nous', 'm1'],
  'setFiltersFromHash: adopts all three from the URL');
loc._h = '#/usage?project=p2';
R.setFiltersFromHash();
eq([R.PROJECT_FILTER, R.PROVIDER_FILTER, R.MODEL_FILTER], ['p2', '', ''],
  'setFiltersFromHash: keys absent from the URL are cleared');
loc._h = '#/usage';
R.setFiltersFromHash();
eq([R.PROJECT_FILTER, R.PROVIDER_FILTER, R.MODEL_FILTER], ['', '', ''],
  'setFiltersFromHash: query-less hash clears everything');

// ============================== Settings cards: setRead / setWrite / invalid =
const setInputs = [
  { dataset: { key: 'standing_charge' }, value: '0.5', checkValidity: () => true },
  { dataset: { key: 'unit_rate' }, value: '0.28', checkValidity: () => true },
  { dataset: { key: 'export_rate' }, value: '', checkValidity: () => true },
  { dataset: { key: 'bogus' }, value: 'abc', checkValidity: () => false },
];
qmap.set('#setcard input[data-key]', setInputs);
eq(R.setRead(), { standing_charge: 0.5, unit_rate: 0.28, export_rate: 0, bogus: NaN },
  'setRead: numeric-coerces every input; an empty value becomes 0 and junk becomes NaN');
eq(R.setInvalid(), ['export_rate', 'bogus'], 'setInvalid: empty value and failed checkValidity');
setInputs[2].value = '0.15';
eq(R.setInvalid(), ['bogus'], 'setInvalid: filling the empty input clears it from the list');
eq(R.setWrite({ unit_rate: 0.4, bogus: 'x' }), undefined, 'setWrite: returns nothing');
eq(setInputs[1].value, 0.4, 'setWrite: writes a matching key');
eq(setInputs[3].value, 'x', 'setWrite: writes any key present on the map');
eq(setInputs[0].value, '0.5', 'setWrite: leaves untouched keys alone');
R.setWrite({ unit_rate: null, standing_charge: 0.9 });
eq(setInputs[1].value, 0.4, 'setWrite: a null value is skipped (!= null guard)');
eq(setInputs[0].value, 0.9, 'setWrite: 0.9 is written over the old value');
R.setWrite({ unit_rate: 0 });
eq(setInputs[1].value, 0, 'setWrite: 0 is written (0 != null)');
qmap.delete('#setcard input[data-key]');
eq(R.setRead(), {}, 'setRead: no card in the DOM -> empty object (no throw)');
eq(R.setInvalid(), [], 'setInvalid: no card in the DOM -> empty list');

const intInputs = [
  { dataset: { key: 'live_poll_interval_s' }, value: '5', checkValidity: () => true },
  { dataset: { key: 'analytics_rebuild_interval_s' }, value: '', checkValidity: () => true },
];
qmap.set('#setintervalscard input[data-key]', intInputs);
eq(R.intervalsRead(), { live_poll_interval_s: 5, analytics_rebuild_interval_s: 0 },
  'intervalsRead: same contract as setRead');
eq(R.intervalsInvalid(), ['analytics_rebuild_interval_s'], 'intervalsInvalid: names the empty field');
R.intervalsWrite({ analytics_rebuild_interval_s: 60 });
eq(intInputs[1].value, 60, 'intervalsWrite: writes the matching field');
eq(intInputs[0].value, '5', 'intervalsWrite: leaves the other field alone');
qmap.set('#setintervalsmsg', [getEl('setintervalsmsg')]);
R.intervalsMsg('saved', 'ok');
eq(getEl('setintervalsmsg').textContent, 'saved', 'intervalsMsg: writes the text');
eq(getEl('setintervalsmsg').className, 'text-[length:var(--fs-xs)] setok', 'intervalsMsg: ok class');
R.intervalsMsg('bad', 'err');
eq(getEl('setintervalsmsg').className, 'text-[length:var(--fs-xs)] setbad', 'intervalsMsg: err class');
R.intervalsMsg('', undefined);
eq(getEl('setintervalsmsg').className, 'text-[length:var(--fs-xs)] muted', 'intervalsMsg: neutral class');
qmap.delete('#setintervalscard input[data-key]');

// ================================================== hourRowsFor (range math) =
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const localToday = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
eq(R.hourRowsFor({}, 24), [], 'hourRowsFor: profile with no hour_rows -> []');
eq(R.hourRowsFor({ hour_rows: [{ date: '1999-01-01', hour: 0 }] }, null).length, 1,
  'hourRowsFor: no window (null) means no filtering — past rows are kept (#138)');
eq(R.hourRowsFor({ hour_rows: [{ date: '1999-01-01', hour: 0 }] }, undefined).length, 1,
  'hourRowsFor: undefined window keeps past rows too (#138)');
eq(R.hourRowsFor({ hour_rows: [] }, 24), [], 'hourRowsFor: empty hour_rows -> []');
eq(R.hourRowsFor({ hour_rows: [{ date: '1999-01-01', hour: 0 }] }, 24), [],
  'hourRowsFor: a 1999 row is outside a 24h window');
eq(R.hourRowsFor({ hour_rows: [{ date: '2999-01-01', hour: 0 }] }, 24).length, 1,
  'hourRowsFor: a far-future row is inside any past window');
eq(R.hourRowsFor({ hour_rows: [{ date: '2999-01-01', hour: 0 }, { date: '1999-01-01', hour: 0 }] }, 24)
  .map(r => r.date), ['2999-01-01'], 'hourRowsFor: filters out only the old row');
eq(R.hourRowsFor({ hour_rows: [{ hour: 3 }] }, 24), [],
  'hourRowsFor: a row with no date is dropped, not defaulted to today');
eq(R.hourRowsFor({ hour_rows: [{ date: '2999-01-01' }] }, 24).length, 1,
  'hourRowsFor: a missing hour is treated as hour 0');
const relRows = {
  hour_rows: [
    { date: localToday, hour: today.getHours() },       // ends this hour -> inside 1h
    { date: localToday, hour: today.getHours() - 3 },   // ~2h ago -> outside 1h
  ],
};
eq(R.hourRowsFor(relRows, 1).length, 1, 'hourRowsFor: the row ending this hour is inside a 1h window');
eq(R.hourRowsFor(relRows, 1)[0].hour, today.getHours(),
  'hourRowsFor: and it is the current-hour row, not the older one');
eq(R.hourRowsFor(relRows, 24).length, 2, 'hourRowsFor: a 24h window keeps both rows');
eq(R.hourRowsFor(relRows, 0).length, 1,
  'hourRowsFor: hours=0 collapses the window to "this hour or later"');
eq(R.hourRowsFor({ hour_rows: [{ date: '2999-01-01', hour: 99 }] }, 24).length, 1,
  'hourRowsFor: hour past 23 rolls into the next day instead of throwing');
eq(R.hourRowsFor({ hour_rows: [{ date: 'not-a-date', hour: 1 }] }, 24).length, 0,
  'hourRowsFor: an unparseable date yields no row (NaN comparison is false)');

// =============================== updateRangeToggleLabel / setRange / setHour =
R.setRange('2026-01-01', '2026-01-31');
eq(R.HOUR_RANGE, null, 'setRange: clears any hour range');
eq(getEl('from').value, '2026-01-01', 'setRange: writes #from');
eq(getEl('to').value, '2026-01-31', 'setRange: writes #to');
eq(getEl('rangetoggle').textContent, '2026-01-01 → 2026-01-31',
  'updateRangeToggleLabel: shows from -> to');
R.setRange('2026-01-01', '2026-01-01');
eq(getEl('rangetoggle').textContent, '2026-01-01',
  'updateRangeToggleLabel: a single day collapses to one date');
R.setRange('', '');
eq(getEl('rangetoggle').textContent, 'Range',
  'updateRangeToggleLabel: both empty -> the generic label');
R.setRange('2026-01-01', '');
eq(getEl('rangetoggle').textContent, 'Range',
  'updateRangeToggleLabel: half a range -> the generic label');
R.setHourRange(6);
eq(R.HOUR_RANGE, 6, 'setHourRange: stores the hour count');
eq(getEl('rangetoggle').textContent, '6h', 'updateRangeToggleLabel: hour range wins over from/to');
R.setHourRange(1);
eq(getEl('rangetoggle').textContent, '1h', 'updateRangeToggleLabel: 1h');
R.setRange('2026-01-01', '2026-01-31');
eq(getEl('rangetoggle').textContent, '2026-01-01 → 2026-01-31',
  'setRange: switching back from an hour range restores the dates');
R.setHourRange(null);
eq(R.HOUR_RANGE, null, 'setHourRange(null): cleared');
R.setHourRange(12);
getEl('from').value = 'x';
eq(getEl('rangetoggle').textContent, '12h', 'updateRangeToggleLabel: dates ignored while hours set');

// =============================================================== nav drawer =
eq(R.navViews(), BASE_VIEWS.concat(EXTRA_VIEWS), 'navViews: every .view in DOM order');
eq(R.navGroups().map(g => g.name), ['Overview', 'Analysis', 'System', 'More'],
  'navGroups: the three declared groups plus the fallback for unlisted views');
eq(R.navGroups()[3], { name: 'More', views: EXTRA_VIEWS },
  'navGroups: unlisted views land in More, in DOM order');
const flat = R.navGroups().flatMap(g => g.views);
eq(flat.slice().sort(), R.navViews().slice().sort(), 'navGroups: covers every view, none invented');
eq(new Set(flat).size, flat.length, 'navGroups: no view appears twice');
eq(R.navGroups()[0], { name: 'Overview', views: ['Home', 'Live', 'Flow', 'Router', 'Quota'] },
  'navGroups: Overview keeps the declared view list');
const spare = viewEls.splice(0);
viewEls.length = 0;
eq(R.navGroups(), [], 'navGroups: no views -> no groups at all');
const homeOnly = mkEl('section');
homeOnly.dataset.view = 'Home';
viewEls.push(homeOnly);
eq(R.navGroups(), [{ name: 'Overview', views: ['Home'] }],
  'navGroups: an empty group is omitted, not emitted empty');
viewEls.length = 0; viewEls.push(...spare);

eq(R.navCollapsed(), true, 'navCollapsed: collapsed by default (nothing stored)');
R.navSetCollapsed(false);
eq(R.navCollapsed(), false, 'navCollapsed: stays expanded once stored');
eq(ls.getItem(R.NAVKEY), '0', 'navSetCollapsed: stores "0" for expanded');
R.navSetCollapsed(true);
eq(ls.getItem(R.NAVKEY), '1', 'navSetCollapsed: stores "1" for collapsed');
ls.setItem(R.NAVKEY, 'nonsense');
eq(R.navCollapsed(), false, 'navCollapsed: any other stored value means expanded');
ls.clear();

R.navApplyCollapsed(true);
ok(doc.body.classList.contains('navcollapsed'), 'navApplyCollapsed: adds the body class');
R.navApplyCollapsed(false);
ok(!doc.body.classList.contains('navcollapsed'), 'navApplyCollapsed: removes the body class');
R.navApplyCollapsed(true);
eq(getEl('navcollapse').getAttribute('aria-expanded'), 'false',
  'navApplyCollapsed: aria-expanded is the inverse (the button expands)');
eq(getEl('navcollapse').getAttribute('aria-label'), 'Expand navigation', 'navApplyCollapsed: aria-label');
eq(getEl('navcollapse').textContent, '\u00BB', 'navApplyCollapsed: chevron points out');
R.navApplyCollapsed(false);
eq(getEl('navcollapse').textContent, '\u00AB', 'navApplyCollapsed: chevron points in');

eq(R.isOffCanvas(), false, 'isOffCanvas: false on a wide viewport');
mq = true;
eq(R.isOffCanvas(), true, 'isOffCanvas: true under max-width:640px');
R.navSetOpen(true);
eq(R.navOpen, true, 'navSetOpen: opens on an off-canvas viewport');
ok(doc.body.classList.contains('navopen'), 'navSetOpen: body gets the navopen class');
eq(getEl('navtoggle').getAttribute('aria-expanded'), 'true', 'navSetOpen: toggle aria-expanded true');
eq(getEl('navdrawer').getAttribute('aria-hidden'), null, 'navSetOpen: drawer no longer aria-hidden');
R.navSetOpen(false);
eq(R.navOpen, false, 'navSetOpen: closes');
ok(!doc.body.classList.contains('navopen'), 'navSetOpen: body class removed');
eq(getEl('navdrawer').getAttribute('aria-hidden'), 'true', 'navSetOpen: hidden drawer marked aria-hidden');
eq(doc.activeElement, getEl('navtoggle'), 'navSetOpen: focus returns to the toggle on close');
mq = false;
R.navSetOpen(true);
eq(R.navOpen, false, 'navSetOpen: cannot open while the rail is on-screen (not off-canvas)');
ok(!doc.body.classList.contains('navopen'), 'navSetOpen: and leaves the body class off');
eq(R.navFocusables(), [], 'navFocusables: no focusable nodes in a bare drawer');
noThrow(() => R.navTrap({ key: 'Tab' }), 'navTrap: Tab with the drawer closed is a no-op');
noThrow(() => R.navTrap({ key: 'Escape' }), 'navTrap: non-Tab keys are ignored');

// ================================== profile visibility / hue / logo / tabs =
eq(Object.keys(R.PV_ALL), ['anthropic', 'nous'], 'PV_ALL: every profile except the merged key');
eq(Object.keys(DATA.profiles).sort(), ['All', 'anthropic', 'nous'],
  'boot: DATA.profiles carries the merged All key while every profile is on');
eq(R.current, undefined, 'boot: `current` is charts.js state, not a router.js export');
eq(R.PV_OFF, { anthropic: false, nous: false }, 'boot: PV_OFF is populated for every real profile');
eq(R.pvKey('nous'), 'llmtelemetry.profileVisibility.nous', 'pvKey: storage key literal');
eq(R.pvOff('nous'), false, 'pvOff: false by default');
R.pvSet('nous', true);
eq(R.pvOff('nous'), true, 'pvSet: turning a profile off is reflected');
eq(ls.getItem(R.pvKey('nous')), 'off', 'pvSet: stores "off"');
R.pvSet('nous', false);
eq(ls.getItem(R.pvKey('nous')), 'on', 'pvSet: stores "on" when re-enabled');
ls.setItem(R.pvKey('nous'), 'off');
eq(R.pvOff('nous'), false, 'pvOff: the in-memory value wins over a later localStorage write (cache)');
delete R.PV_OFF.nous;
eq(R.pvOff('nous'), true, 'pvOff: dropping the cache re-reads localStorage');
delete R.PV_OFF.nous; ls.clear();
eq(R.pvOnProfiles(), ['anthropic', 'nous'], 'pvOnProfiles: all profiles when none are off');
R.pvSet('nous', true);
eq(R.pvOnProfiles(), ['anthropic'], 'pvOnProfiles: excludes the profile switched off');
R.pvSet('nous', false);

eq(R.pvHueKey('nous'), 'llmtelemetry.profileHue.nous', 'pvHueKey: storage key literal');
eq(R.pvHueOverride('nous'), null, 'pvHueOverride: null when nothing is stored');
R.pvHueSet('nous', 30);
eq(R.pvHueOverride('nous'), 30, 'pvHueSet: stores the hue');
eq(ls.getItem(R.pvHueKey('nous')), '30', 'pvHueSet: persists as a string');
R.pvHueSet('nous', 390);
eq(R.pvHueOverride('nous'), 30, 'pvHueSet: 390 wraps to 30');
R.pvHueSet('nous', -30);
eq(R.pvHueOverride('nous'), 330, 'pvHueSet: -30 wraps to 330');
R.pvHueSet('nous', 30.6);
eq(R.pvHueOverride('nous'), 31, 'pvHueSet: rounds to a whole degree');
R.pvHueSet('nous', null);
eq(R.pvHueOverride('nous'), null, 'pvHueSet(null): clears the override');
eq(ls.getItem(R.pvHueKey('nous')), null, 'pvHueSet(null): removes the stored key');
ls.setItem(R.pvHueKey('nous'), 'abc');
eq(R.pvHueOverride('nous'), null, 'pvHueOverride: a non-numeric stored value is ignored');
delete R.PV_HUE.nous;
eq(R.pvHueOverride('nous'), null, 'pvHueOverride: re-reads a non-numeric value as null');
ls.setItem(R.pvHueKey('nous'), '-30');
delete R.PV_HUE.nous;
eq(R.pvHueOverride('nous'), 330, 'pvHueOverride: normalises a negative stored hue');
ls.clear();
delete R.PV_HUE.nous;
eq(R.profileHue('nous'), P.hashHue('nous'), 'profileHue: falls back to palette.hashHue');
ok(R.hashHue === undefined, 'profileHue: hashHue is not re-exported from router.js');
R.pvHueSet('nous', 200);
eq(R.profileHue('nous'), 200, 'profileHue: the override wins over hashHue');
R.pvHueSet('nous', null);

eq(R.pvLogoKey('nous'), 'llmtelemetry.profileLogo.nous', 'pvLogoKey: storage key literal');
eq(R.PROFILE_LOGO_MAX_BYTES, 200 * 1024, 'PROFILE_LOGO_MAX_BYTES: 200 KiB');
eq(R.profileLogo('nous'), null, 'profileLogo: null when nothing is stored');
const uri = 'data:image/png;base64,AAAA';
R.profileLogoSet('nous', uri);
eq(R.profileLogo('nous'), uri, 'profileLogoSet: stores the data URI');
eq(ls.getItem(R.pvLogoKey('nous')), uri, 'profileLogoSet: persists the data URI');
R.profileLogoSet('nous', '');
eq(R.profileLogo('nous'), null, 'profileLogoSet(""): clears the logo');
eq(ls.getItem(R.pvLogoKey('nous')), null, 'profileLogoSet(""): removes the stored key');
const dot = R.profileIconHtml('nous', 20);
ok(!dot.includes('<img'), 'profileIconHtml: falls back to the initial dot when unset');
ok(dot.includes('width:20px'), 'profileIconHtml: the dot is sized from px');
ok(dot.includes('height:20px'), 'profileIconHtml: and square');
ok(dot.includes(`hsl(${R.profileHue('nous')}`), 'profileIconHtml: the dot uses the profile hue');
ok(dot.includes('>N<'), 'profileIconHtml: the dot carries the initial');
eq(R.profileIconHtml('nous'), R.profileIconHtml('nous', 18),
  'profileIconHtml: px defaults to 18');
R.profileLogoSet('nous', uri);
const img = R.profileIconHtml('nous', 16);
ok(img.startsWith('<img'), 'profileIconHtml: an <img> once a logo is set');
ok(img.includes('width="16"') && img.includes('height="16"'), 'profileIconHtml: the <img> is sized');
eq(R.profileIconHtml('', 16).includes('>?<'), true, 'profileIconHtml: an empty name still renders ?');
R.profileLogoSet('nous', '');

// tabs() reads PV_ALL (never the merged DATA key) and reports the on-count
R.tabs();
ok(getEl('tabs').innerHTML.includes('data-tab="anthropic"'), 'tabs: renders a chip per profile in PV_ALL');
ok(!getEl('tabs').innerHTML.includes('data-tab="All"'), 'tabs: never renders the merged All key as a tab');
eq(getEl('tabsub').textContent, 'all 2 shown', 'tabs: subtitle when all profiles are on');
R.pvSet('nous', true);
R.tabs();
eq(getEl('tabsub').textContent, '1/2 on', 'tabs: subtitle counts the on-profiles');
eq(getEl('tabs').innerHTML.includes('data-off="1"'), true, 'tabs: the off chip is marked data-off');
R.pvSet('nous', false);
R.tabs();

// pvSyncCurrent / pvToggle
eq(R.pvSyncCurrent(), 'All', 'pvSyncCurrent: the merged key while 2+ are on');
const profilesBackup = DATA.profiles;
DATA.profiles = { anthropic: profilesBackup.anthropic, nous: profilesBackup.nous };
eq(R.pvSyncCurrent(), 'anthropic', 'pvSyncCurrent: no merged key -> the first ON profile');
R.pvSet('anthropic', true);
eq(R.pvSyncCurrent(), 'nous', 'pvSyncCurrent: skips a profile that is switched off');
R.pvSet('anthropic', false);
DATA.profiles = profilesBackup;
R.pvSet('nous', true);
const flashes = [];
R.pvToggle('anthropic');
eq(R.pvOff('anthropic'), false, 'pvToggle: refuses to turn off the last visible profile');
eq(DATA.profiles && Object.keys(DATA.profiles).length, 3,
  'pvToggle: and leaves DATA.profiles untouched when it refuses');
R.pvSet('nous', false);
R.pvToggle('nous');
eq(R.pvOff('nous'), true, 'pvToggle: turns a profile off when others stay on');
R.pvToggle('nous');
eq(R.pvOff('nous'), false, 'pvToggle: and turns it back on');
eq(R.pvSyncCurrent(), 'All', 'pvToggle: pvSyncCurrent returns to the merged view');

// ================================================================ setCrumb ===
R.setCrumb('Usage');
eq(getEl('crumb').textContent, 'Usage', 'setCrumb: writes the crumb text');
R.setCrumb('');
eq(getEl('crumb').textContent, '', 'setCrumb: empty string clears it');
R.setCrumb(null);
eq(getEl('crumb').textContent, '', 'setCrumb: null is coerced to empty (the || \'\' guard)');

// ================================================================ pickView ===
R.clearCrossFilters();
loc._h = '';
R.pickView('Sessions');
eq(R.view, 'Sessions', 'pickView: switches the visible view');
ok(loc.hash.startsWith('#/sessions'), 'pickView: and mirrors it into the hash');
eq(R.viewFromHash(), 'Sessions', 'pickView: the hash it writes parses back to the view');
R.pickView('Home');
eq(R.view, 'Home', 'pickView: switches back');
eq(R.navOpen, false, 'pickView: does not open the drawer');
R.clearCrossFilters();
R.setHash('Home');

// ========================= the shim is load-bearing (proved at runtime) ======
// `isolate('router.js')` cannot work, and the reason is not this harness: the
// shared-write assignments are legal only because the shipped build inlines
// every module into one scope. Importing the file verbatim therefore throws.
// This block runs last so the failed evaluation cannot skew any earlier check.
let bareErr = null;
try {
  await isolate('router.js', stubsFor(src, true), {
    window: win, document: doc, localStorage: ls, location: loc,
    requestAnimationFrame: raf, __POWER__: POWER,
  });
} catch (e) { bareErr = e; }
ok(bareErr !== null, 'shim: importing router.js verbatim fails, so the shim is load-bearing');
ok(/constant|assign|initializ/i.test(String(bareErr && bareErr.message)),
  `shim: and it fails on the shared write (${bareErr && bareErr.name}: ${String(bareErr && bareErr.message).split('\n')[0].slice(0, 80)})`);

// ------------------------------------------------------------------ summary --
console.log(`unit_router: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
