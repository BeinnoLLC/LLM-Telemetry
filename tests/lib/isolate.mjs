// #30: load ONE dashboard module in plain node, with its sibling imports stubbed.
//
// The web/js modules are real ES modules, but they import each other in a ring
// (palette -> charts -> palette, main carries __DATA__ placeholders the build
// fills in), so `import('../src/.../palette.js')` on its own cannot evaluate.
// isolate() resolves every relative import made BY THE MODULE UNDER TEST to a
// generated stub module instead, so the unit's own code runs and nothing else.
//
// Each stub exports exactly the names the unit imports from it. A name's value
// comes from the `stubs` argument ({ 'main.js': { DATA: {...} } }); anything not
// supplied is undefined, so a test that reaches an unstubbed collaborator fails
// loudly instead of silently exercising the real one.
//
// Stubs are bound once, at load: ES module bindings are read-only to the
// importer, so pass mutable objects (e.g. DATA) and mutate them, or call
// isolate() again — every call loads a fresh copy of the unit.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const JS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'src', 'llm_telemetry', 'web', 'js');

const STUB = 'isolate-stub:';
const registry = globalThis.__isolateStubs ||= {};
let seq = 0, hooked = false;

// `import { a, b as c } from './x.js'` -> { './x.js': ['a', 'b'] }
export function importsOf(src) {
  const out = {};
  const re = /import\s*\{([^}]*)\}\s*from\s*['"](\.\/[\w.-]+)['"]/g;
  for (let m; (m = re.exec(src));) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    (out[m[2]] ||= []).push(...names);
  }
  return out;
}

function hook() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(spec, ctx, next) {
      const parent = ctx.parentURL || '';
      const m = parent.match(/[?&]isolate=(\d+)/);
      if (m && spec.startsWith('./')) {
        return { url: `${STUB}${m[1]}/${spec.slice(2)}`, shortCircuit: true };
      }
      return next(spec, ctx);
    },
    load(url, ctx, next) {
      if (!url.startsWith(STUB)) return next(url, ctx);
      const [id, file] = url.slice(STUB.length).split('/');
      const { names, values } = registry[id][file];
      const src = names.map(n =>
        `export const ${n} = globalThis.__isolateStubs[${id}][${JSON.stringify(file)}].values[${JSON.stringify(n)}];`
      ).join('\n');
      return { format: 'module', source: src, shortCircuit: true };
    },
  });
}

// `globals` are installed on globalThis for the duration of the module's
// evaluation only (charts.js touches Chart and localStorage at top level), then
// restored, so one suite's fake browser never leaks into the next isolate().
export async function isolate(file, stubs = {}, globals = {}) {
  const saved = Object.keys(globals).map(k =>
    [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  for (const [k, v] of Object.entries(globals)) {
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  try { return await load(file, stubs); }
  finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
    }
  }
}

async function load(file, stubs) {
  hook();
  const full = path.join(JS_DIR, file);
  const deps = importsOf(readFileSync(full, 'utf8'));
  const id = ++seq;
  registry[id] = {};
  for (const [spec, names] of Object.entries(deps)) {
    const dep = spec.slice(2);
    const values = stubs[dep] || {};
    for (const k of Object.keys(values)) {
      if (!names.includes(k)) throw new Error(`isolate(${file}): stub ${dep}.${k} is not imported by ${file}`);
    }
    registry[id][dep] = { names: [...new Set(names)], values };
  }
  for (const dep of Object.keys(stubs)) {
    if (!registry[id][dep]) throw new Error(`isolate(${file}): ${file} does not import ./${dep}`);
  }
  return import(`${pathToFileURL(full).href}?isolate=${id}`);
}
