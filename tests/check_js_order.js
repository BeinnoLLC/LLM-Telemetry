// Every name the dashboard needs must be in web/js/order.json, and order.json
// must not name anything a module does not declare.
//
// Why: the build flattens the ES modules into ONE classic-script scope by
// replaying the declarations order.json lists. An export that is missing from
// that list is not "not imported" — it is not in the built page AT ALL, so a
// function the source exports and calls simply does not exist at runtime, as a
// bare ReferenceError that takes down whatever render path touched it. Nothing
// else catches this: the modules resolve fine, ESLint sees valid ES modules, and
// check_js_modules.js confirms the imports and exports line up. Only the built
// page is broken, which is what this checks.
//
// Both directions matter: a missing entry loses code, a stale entry fails the
// build outright with a confusing "does not declare it" from webassets.py.
const fs = require('fs');
const path = require('path');

const JS = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'js');
const manifest = JSON.parse(fs.readFileSync(path.join(JS, 'order.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${x ? '  ' + x : ''}`); ok ? pass++ : fail++; };

// The dashboard's modules. costs.js is the price sheet's own page, inlined by
// build_costs.py against its own list, so it is not part of this manifest.
const DASHBOARD_MODULES = ['palette', 'charts', 'views', 'flow', 'drawer', 'live',
                           'routerview', 'quotaview', 'router', 'main'];

// Top-level declarations a module makes, exported or not: the flattening puts
// every one of them in the shared scope, and webassets refuses a duplicate.
function declarations(mod) {
  const src = fs.readFileSync(path.join(JS, mod + '.js'), 'utf8');
  const out = new Map();
  const re = /^(export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of src.matchAll(re)) out.set(m[2], !!m[1]);
  return out;
}

const listed = manifest.order.map(e => [e.mod, e.name]);
const listedSet = new Set(listed.map(([m, n]) => m + ':' + n));

// ---- 1. nothing the page needs is missing from the order -------------------
let missing = [];
for (const mod of DASHBOARD_MODULES) {
  for (const [name, exported] of declarations(mod)) {
    // A module-local helper that is never exported is still replayed, because
    // the build copies whole declaration blocks. Only exports are guaranteed to
    // be reachable by name from another module, so those are what must be
    // listed; a non-exported name reaches the page through its exporter anyway.
    if (exported && !listedSet.has(mod + ':' + name)) missing.push(`${mod}.js:${name}`);
  }
}
chk(missing.length === 0,
  'every exported declaration is in order.json (an omission silently drops it from the page)',
  missing.join(', '));

// ---- 2. nothing in the order is stale ---------------------------------------
let stale = [];
for (const [mod, name] of listed) {
  if (!DASHBOARD_MODULES.includes(mod)) { stale.push(`${mod}.js (unknown module)`); continue; }
  if (!fs.existsSync(path.join(JS, mod + '.js'))) { stale.push(`${mod}.js (missing file)`); continue; }
  if (!declarations(mod).has(name)) stale.push(`${mod}.js:${name}`);
}
chk(stale.length === 0, 'order.json names only declarations that exist', stale.join(', '));

// ---- 3. no duplicates ------------------------------------------------------
chk(listedSet.size === listed.length, 'no name is listed twice',
  listed.length - listedSet.size + ' duplicate(s)');

// ---- 4. the BUILT page really defines them ----------------------------------
// The checks above compare the manifest to the SOURCE. This one compares it to
// the ARTEFACT, which is what the browser runs: modules are interleaved in the
// manifest (declaration-level order, not module blocks), so the only thing worth
// asserting about the sequence is that its result contains every declaration it
// promised. A build that silently drops one still renders a page — just one that
// throws ReferenceError the moment that code path is reached.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const DASH = path.join(REPORTS, 'dashboard.html');
if (fs.existsSync(DASH)) {
  const page = fs.readFileSync(DASH, 'utf8');
  // A lookahead, not \b: `$` is a valid identifier but not a word character, so
  // a word boundary after it never matches and palette.$ would look missing.
  const esc1 = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const absent = listed.filter(([mod, name]) =>
    !new RegExp(`(?:function|const|let|var|class)\\s+${esc1(name)}(?![\\w$])`).test(page));
  chk(absent.length === 0, 'the built page defines every name order.json lists',
    absent.map(([m, n]) => `${m}:${n}`).join(', '));
} else {
  chk(false, `the built page exists to check (${DASH})`);
}

// ---- negative control ------------------------------------------------------
// Rerun check 1 with one real entry removed from the list: it MUST then report
// that name. Without this the check could be vacuous — passing because it never
// looks at anything — which is how a gate quietly stops protecting anything.
const drop = 'routerview:rtPageSet';
const controlListed = listedSet.has(drop);
const controlMissing = [];
for (const mod of DASHBOARD_MODULES) {
  for (const [name, exported] of declarations(mod)) {
    if (exported && !controlListed) continue;   // pretend the entry was never added
    if (exported && !(listedSet.has(mod + ':' + name) && mod + ':' + name !== drop)) {
      controlMissing.push(`${mod}.js:${name}`);
    }
  }
}
chk(controlListed, 'control: rtPageSet really is in the manifest (so removing it is a real scenario)');
chk(controlMissing.includes('routerview.js:rtPageSet'),
  'control: with rtPageSet dropped from the list, the check reports it', controlMissing.join(', '));

console.log(`\ncheck_js_order.js  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
