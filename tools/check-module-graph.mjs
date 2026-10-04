// Exact module-graph check for web/js, using a real parser (espree, which ships
// with ESLint — no extra tooling).
//
// P2-05 (#29). The modules were split out of one 6,400-line classic script, so
// every top-level name used to share a single scope. After the split, a name
// that a module uses but does not import still works when the page inlines the
// modules back into one script — and breaks the moment anything imports the
// module directly (a test, a bundler, a worker). Hand-rolled regex auditing of
// this got it wrong three separate ways during the split; a parse does not.
//
// Checks per module:
//   1. no reference to a name that is neither declared locally nor imported
//      (a "leaked scope" name) — this is the bug the split can introduce;
//   2. every import is actually used;
//   3. names imported twice, or imported and also declared locally.
//
// Usage: node tools/check-module-graph.mjs [--quiet]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'src', 'llm_telemetry', 'web', 'js');
const MODULES = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();

const quiet = process.argv.includes('--quiet');
let pass = 0, fail = 0;
const chk = (ok, name, detail) => {
  if (ok) { pass++; if (!quiet) console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} — ${detail}`); }
};

/** declared top-level names + referenced names + imports, per file */
function analyse(file) {
  const src = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  const ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', loc: false, range: true });
  const declared = new Set(), referenced = new Map(), imports = new Map();
  const declare = (node) => {};
  for (const stmt of ast.body) {
    if (stmt.type === 'ImportDeclaration') {
      for (const spec of stmt.specifiers) {
        const name = spec.local.name;
        if (!imports.has(name)) imports.set(name, { from: stmt.source.value, used: false });
      }
      continue;
    }
    // exported declarations
    let decl = stmt;
    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration') decl = stmt.declaration;
    if (!decl) continue;
    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) collectPatternNames(d.id, declared);
    } else if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
      if (decl.id) declared.add(decl.id.name);
    }
  }
  // Binding positions: `const M = {}` and `function f(M)` DECLARE M — counting
  // those as references made function-local helpers look like cross-module
  // leaks (`M` "declared in costs.js"), i.e. the check cried wolf.
  const bindingNodes = new Set();
  const collectBindings = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collectBindings); return; }
    if (typeof node.type !== 'string') return;
    const grab = (pattern) => {
      const walkPat = (p) => {
        if (!p || typeof p !== 'object') return;
        if (Array.isArray(p)) { p.forEach(walkPat); return; }
        if (p.type === 'Identifier') { bindingNodes.add(p); return; }
        for (const k of ['left', 'argument', 'param']) if (p[k]) walkPat(p[k]);
        if (p.properties) p.properties.forEach(pr => walkPat(pr.value || pr.argument));
        if (p.elements) p.elements.forEach(walkPat);
        if (p.value && p.type === 'AssignmentPattern') walkPat(p.value);
        if (p.type === 'Property') walkPat(p.value);
      };
      walkPat(pattern);
    };
    if (node.type === 'VariableDeclarator') grab(node.id);
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
         node.type === 'ArrowFunctionExpression') && node.params) node.params.forEach(grab);
    if (node.type === 'CatchClause' && node.param) grab(node.param);
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' ||
         node.type === 'ClassDeclaration' || node.type === 'ClassExpression') && node.id) bindingNodes.add(node.id);
    for (const k of Object.keys(node)) {
      if (k === 'parent' || k === 'range') continue;
      const v = node[k];
      if (v && (Array.isArray(v) || typeof v.type === 'string')) collectBindings(v);
    }
  };
  collectBindings(ast);
  // Names bound anywhere in the file (function locals included). ESLint's
  // no-undef is the scope-aware authority on undefined names; this check is
  // about MISSING IMPORTS, so a name that is local to any function here must
  // not be reported as a cross-module leak.
  const anyBinding = new Set([...declared, ...bindingNodes].map(n => (typeof n === 'string' ? n : n.name)));

  // walk everything, skipping property keys / non-computed member properties
  const seen = new Set();
  const visit = (node, parent) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => visit(n, parent)); return; }
    if (typeof node.type !== 'string') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
      const isMemberProp = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const isKey = parent && (
        (parent.type === 'Property' && parent.key === node && !parent.computed) ||
        (parent.type === 'PropertyDefinition' && parent.key === node && !parent.computed) ||
        (parent.type === 'MethodDefinition' && parent.key === node && !parent.computed));
      const isLabel = parent && parent.type === 'LabeledStatement';
      const isImportSpec = parent && parent.type === 'ImportSpecifier';
      if (!isMemberProp && !isKey && !isLabel && !isImportSpec && !bindingNodes.has(node)) {
        referenced.set(node.name, (referenced.get(node.name) || 0) + 1);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'range') continue;
      const v = node[key];
      if (v && (Array.isArray(v) || typeof v.type === 'string')) visit(v, node);
    }
  };
  visit(ast, null);
  return { src, declared, referenced, imports, anyBinding };
}

function collectPatternNames(pat, out) {
  if (!pat) return;
  switch (pat.type) {
    case 'Identifier': out.add(pat.name); break;
    case 'ObjectPattern': pat.properties.forEach(p => collectPatternNames(p.value || p.argument, out)); break;
    case 'ArrayPattern': pat.elements.forEach(e => collectPatternNames(e, out)); break;
    case 'AssignmentPattern': collectPatternNames(pat.left, out); break;
    case 'RestElement': collectPatternNames(pat.argument, out); break;
    default: break;
  }
}

function parseOnly(src) {
  return espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', range: true });
}

const analyses = new Map(MODULES.map(f => [f, analyse(f)]));
const anyBindingOf = (file) => analyses.get(file).anyBinding;
const exportedBy = new Map();       // name → module that declares it
for (const [file, a] of analyses) for (const n of a.declared) exportedBy.set(n, file);

// globals the page provides (CDN + build-time substitutions) / JS builtins
// Cross-module MUTATION: a module assigning to a name it imported from
// another module. Legal-looking, but an ES module import is a read-only live
// binding — assigning to one throws TypeError the moment the module is loaded
// directly (a test, a bundler, a worker). The inlined page erases imports, so
// this only bites outside the page, which is exactly why it needs a check.
//
// The real fix is one shared state object (or setter functions) for these
// names; until then this list is a RATCHET: the existing sites are tolerated,
// any new one (or a stale entry) fails the check, so the debt cannot grow.
const KNOWN_CROSS_MODULE_WRITES = new Set([
  'live.js:bwPrev', 'live.js:bwPrevAt', 'live.js:DATA', 'live.js:PV_ALL',
  'live.js:COLORS', 'live.js:TOOLCOLORS',
  'main.js:CHART_ANIM_DONE',
  'palette.js:current',
  'router.js:LIVE_MS', 'router.js:REBUILD_MS', 'router.js:current',
  'router.js:COLORS', 'router.js:TOOLCOLORS', 'router.js:projDistNormalized',
  'router.js:projTrendStacked',
  'views.js:charts', 'views.js:PROJ_WEIGHT',
]);

const ALLOWED_GLOBALS = new Set([
  'Chart', '__DATA__', '__POWER__', '__LOCAL_HOSTS__', '__SCHEMA_VERSION__',
  'window', 'document', 'console', 'localStorage', 'sessionStorage', 'navigator', 'location',
  'history', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'CustomEvent', 'Event',
  'Error', 'TypeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Array', 'Object',
  'Number', 'String', 'Boolean', 'Math', 'JSON', 'Date', 'RegExp', 'Symbol', 'BigInt',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent',
  'ResizeObserver', 'MutationObserver', 'IntersectionObserver', 'matchMedia', 'alert', 'confirm',
  'AudioContext', 'webkitAudioContext', 'structuredClone', 'Image', 'Blob', 'URL', 'URLSearchParams',
  'AbortController', 'performance', 'crypto', 'TextDecoder', 'TextEncoder', 'undefined', 'NaN',
  'Infinity', 'globalThis', 'Function', 'eval', 'Intl', 'Node', 'Element', 'HTMLElement',
  'CSS', 'caches', 'clipboard', 'FileReader', 'FormData', 'Headers', 'Request', 'Response',
  'DOMParser', 'XMLHttpRequest', 'WebSocket', 'Worker', 'URLPattern', 'queueMicrotask',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'onerror', 'screen', 'Notification',
  'Audio', 'playSound', 'arguments', 'require', 'module', 'exports', 'process', 'structuredClone',
]);

for (const [file, a] of analyses) {
  // 1. leaked references
  const leaked = [];
  for (const name of a.referenced.keys()) {
    if (a.declared.has(name) || a.imports.has(name) || ALLOWED_GLOBALS.has(name)) continue;
    if (anyBindingOf(file).has(name)) continue;      // local to some function in this module
    const owner = exportedBy.get(name);
    if (owner) leaked.push(`${name} (declared in ${owner})`);
  }
  chk(leaked.length === 0, `${file}: references only what it imports or declares`,
      leaked.length ? `not imported: ${leaked.join(', ')}` : '');

  // 2. unused imports
  const unused = [];
  for (const [name, info] of a.imports) {
    const used = a.referenced.has(name);
    if (!used) unused.push(`${name} (from ${info.from})`);
  }
  chk(unused.length === 0, `${file}: no unused imports`, unused.join(', '));

  // 3. import colliding with a local declaration
  const clash = [...a.imports.keys()].filter(n => a.declared.has(n));
  chk(clash.length === 0, `${file}: no import shadows a local declaration`, clash.join(', '));
}
// cross-module writes: detect and ratchet
const foundWrites = new Set();
for (const [file, a] of analyses) {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node.type !== 'string') return;
    const target =
      (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') ? node.left :
      (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') ? node.argument :
      (node.type === 'ForOfStatement' && node.left.type === 'Identifier') ? node.left : null;
    if (target && a.imports.has(target.name)) foundWrites.add(`${file}:${target.name}`);
    for (const k of Object.keys(node)) {
      if (k === 'range') continue;
      const v = node[k];
      if (v && (Array.isArray(v) || typeof v.type === 'string')) visit(v);
    }
  };
  visit(JSON.parse(JSON.stringify(parseOnly(a.src))));
}
const added = [...foundWrites].filter(k => !KNOWN_CROSS_MODULE_WRITES.has(k));
const gone = [...KNOWN_CROSS_MODULE_WRITES].filter(k => !foundWrites.has(k));
chk(added.length === 0, 'no NEW cross-module writes (a module assigning to an import)',
    added.length ? `new: ${added.join(', ')} — an ES import is read-only; move the state or add a setter` : '');
chk(gone.length === 0, 'cross-module-write list has no stale entries (removed ones deleted)',
    gone.length ? `already fixed, drop from the list: ${gone.join(', ')}` : '');

// Every dashboard module on disk must be in the build's JS_ORDER (and vice
// versa). A count pin ("expected eight") only forced an edit here when a module
// was added; comparing against the build list catches the real failure — a
// module that exists but is never inlined, so its blocks silently vanish.
const jsOrderSrc = fs.readFileSync(path.join(ROOT, 'src', 'llm_telemetry', 'webassets.py'), 'utf8');
const jsOrderM = jsOrderSrc.match(/JS_ORDER\s*=\s*\[([^\]]*)\]/);
const jsOrder = jsOrderM ? [...jsOrderM[1].matchAll(/"([^"]+\.js)"/g)].map(m => m[1]) : [];
const onDisk = MODULES.filter(f => f !== 'costs.js');
const notBuilt = onDisk.filter(f => !jsOrder.includes(f));
const missing = jsOrder.filter(f => !onDisk.includes(f));
chk(jsOrder.length > 0 && !notBuilt.length && !missing.length,
    'every dashboard module is in webassets.JS_ORDER and vice versa',
    `not built: ${notBuilt.join(', ') || '-'}; missing on disk: ${missing.join(', ') || '-'}`);

console.log(`\ncheck-module-graph.mjs  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
