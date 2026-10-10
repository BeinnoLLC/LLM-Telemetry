// ESLint for the dashboard's web/js modules — P2-05 (#29).
//
// The rules are not generic best practice; each one maps to a bug that shipped:
//
//   no-unused-vars  a drag handler was written, never wired to an element, and
//                   nothing failed for an entire session (the ticket that
//                   started this whole extraction). Dead code that looks wired
//                   is exactly what no-unused-vars reports.
//   no-undef        a helper referenced before it exists / a typo'd global.
//
// One deliberate exemption lives below: cross-module MUTATION. A module that
// assigns to a name it imported from another module is a TypeError in real ESM
// (an import is a read-only live binding). The shipped page inlines every module
// into one classic script at build time (webassets.py), which erases the imports
// and makes those assignments work — so they are load-bearing, not mistakes.
// tools/check-module-graph.mjs keeps the authoritative ratchet of which sites are
// allowed and fails on any new or stale one; this exemption only stops ESLint from
// re-reporting the sites that ratchet already accepts.
//
// These modules are real ES modules, so cross-module references go through
// `import` — no-undef is meaningful here rather than noise. The page inlines
// them into one classic script at build time (see webassets.py); that
// flattening is not what ESLint sees, and tests/check_js_modules.js covers it.
import globals from 'globals';

// The names that are assigned after being imported from another module — see
// the note at the top. Keyed `file.js:name`. This list must stay in sync with
// KNOWN_CROSS_MODULE_WRITES in tools/check-module-graph.mjs, which owns the
// authoritative ratchet and fails when the two disagree; the cheap consistency
// check in tests/check_module_graph_sync.js guards that pairing.
const CROSS_MODULE_WRITES = new Set([
  'live.js:bwPrev', 'live.js:bwPrevAt', 'live.js:DATA', 'live.js:PV_ALL',
  'live.js:COLORS', 'live.js:TOOLCOLORS',
  'main.js:PROJECT_FILTER', 'main.js:CHART_ANIM_DONE',
  'palette.js:current',
  'router.js:LIVE_MS', 'router.js:REBUILD_MS', 'router.js:current',
  'router.js:COLORS', 'router.js:TOOLCOLORS',
  'router.js:projDistNormalized', 'router.js:projTrendStacked',
  'views.js:charts', 'views.js:PROJ_WEIGHT', 'views.js:PROJECT_FILTER',
]);

export default [
  {
    files: ['src/llm_telemetry/web/js/**/*.js'],
    ignores: ['src/llm_telemetry/web/js/order.json'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Loaded by the page from a CDN, so it is a global rather than an import.
        Chart: 'readonly',
        // Build-time substitutions: the page is assembled by inject_* in
        // build_dashboard.py, so these only exist in the built artifact; using
        // them in the sources is correct and must not read as an undefined
        // global.
        __DATA__: 'readonly',
        __POWER__: 'readonly',
        __LOCAL_HOSTS__: 'readonly',
        __SCHEMA_VERSION__: 'readonly',
        // Injected payload globals (build_dashboard.py embeds the JSON the
        // views read): the price sheet's model table and the rankings feed,
        // same idea as the four above — they exist only in the built page.
        __COSTS_DATA__: 'readonly',
        __RANKINGS_DATA__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        args: 'after-used',
        // Deliberate placeholders in the fetch/DOM shims are written as `_`.
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        varsIgnorePattern: '^_',
      }],
      'no-undef': 'error',
      // The two that shipped as bugs in this repo historically:
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
    },
  },
  // Exempt the ratcheted cross-module writes, and ONLY those. ESLint has no rule
  // for "assigned after import" — from the writing module's side the binding is
  // never READ, so no-unused-vars reports it. Naming the sites explicitly means a
  // NEW cross-module write still fails both here and in the ratchet, so the debt
  // cannot grow through this config.
  //
  // Grouped by file: ESLint keeps only the LAST matching config block, so one
  // block per site would silently exempt just the final name in each module
  // (this is exactly how five of these kept reporting).
  ...[...Object.entries([...CROSS_MODULE_WRITES].reduce((acc, site) => {
    const [file, name] = site.split(':');
    (acc[file] ??= []).push(name);
    return acc;
  }, {})).map(([file, names]) => ({
    files: [`src/llm_telemetry/web/js/${file}`],
    rules: {
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
        // Only these bindings, and only as variables — a genuinely unused local
        // or parameter in the same file is still reported.
        varsIgnorePattern: `^(${[...names].join('|')}|_)`,
      }],
    },
  }))],
];
