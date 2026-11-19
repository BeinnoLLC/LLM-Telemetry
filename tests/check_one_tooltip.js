// LLMTELEMET-312: ONE tooltip component. `.qtip` (web/css/dashboard.css) is the
// only tooltip shell; `#lntip` and the Hive `.hv-tip` are themed instances of it
// (theme/sizing overrides only) and all three place through the one shared
// helper (views.js tipPlace).
//
// Why this exists: the dashboard grew three tooltip implementations — .qtip,
// #lntip and .hv-tip — each with its own shell CSS and its own inline
// positioning code path (docs/design-audit.md section 10 item 7). Consolidating
// them is worthless if the next hover card quietly re-implements the shell
// again, and no other gate looks at selector chrome at all. This fails the
// build when a second tooltip shell class/ID reappears anywhere in the CSS or a
// tooltip element stops being a .qtip instance.
//
// What counts as a shell: box chrome — position, pointer-events, background,
// border, border-radius, box-shadow. Theming (z-index, max-width, padding,
// font-size, colour from tokens, visibility/transition) is fine on instances.
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const DASH_HTML = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'dashboard.html');

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

// Box chrome that only the ONE shell may declare.
const CHROME = /^(position|inset|inset-[\w-]+|top|right|bottom|left|pointer-events|background|background-[\w-]+|border|border-[\w-]+|border-radius|box-shadow)$/;

// The shell itself, and the Flow graph's own in-graph label base (positioned in
// SVG space by renderFlow, not a viewport tooltip; out of this ticket's scope).
const SHELL_OK = /^\.qtip($|[^-])/;
const LEGACY_OK = /^\.flowtip($|[^-])/;

/** flat rules of one stylesheet: [{sel, body}] with comments stripped */
function rulesOf(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return (clean.match(/[^{}]+\{[^{}]*\}/g) || []).map(rule => {
    const at = rule.indexOf('{');
    return { sel: rule.slice(0, at).trim(), body: rule.slice(at + 1, -1) };
  });
}

/** the class/ID-ish tokens of a selector segment */
const tokensOf = sel => sel.split(/[^A-Za-z0-9_-]+/).filter(Boolean);

/** does this selector name a tooltip (token ending in "tip", e.g. qtip, lntip, hv-tip)? */
const namesTip = sel => tokensOf(sel).some(t => /tip$/i.test(t));

/** declarations of a rule body: [[prop, value]] */
function declsOf(body) {
  return body.split(';').map(d => d.split(':')).filter(p => p.length >= 2)
    .map(p => [p[0].trim().toLowerCase(), p.slice(1).join(':').trim()]);
}

const files = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css'));
chk(files.length > 0, 'found stylesheets to check', files.join(','));

// The detector, also used for the negative control below.
function violations(css) {
  const out = [];
  for (const { sel, body } of rulesOf(css)) {
    const decls = declsOf(body);
    const props = decls.map(([p]) => p);
    const fixedTip = props.includes('position')
      && decls.some(([p, v]) => p === 'position' && /^fixed$/.test(v))
      && props.includes('pointer-events')
      && decls.some(([p, v]) => p === 'pointer-events' && /^none$/.test(v))
      && props.includes('max-width');
    if (fixedTip && !SHELL_OK.test(sel)) out.push(`second fixed tooltip shell: ${sel}`);
    for (const seg of sel.split(',')) {
      const s = seg.trim();
      if (!namesTip(s) || SHELL_OK.test(s) || LEGACY_OK.test(s)) continue;
      const chrome = props.filter(p => CHROME.test(p));
      if (chrome.length) out.push(`tooltip rule declares shell chrome (${chrome.join(', ')}): ${s}`);
    }
  }
  return out;
}

for (const f of files) {
  const v = violations(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  chk(v.length === 0, `${f}: tooltip chrome lives in .qtip alone`, v.join(' | '));
}

// ---- the tooltip elements are .qtip instances ------------------------------
const html = fs.readFileSync(DASH_HTML, 'utf8');
const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
const tipTags = tags.filter(t => /role="tooltip"/.test(t) || /\bid="[^"]*tip"/i.test(t));
chk(tipTags.length > 0, 'found the tooltip elements in dashboard.html',
  tipTags.map(t => (t.match(/\bid="([^"]+)"/) || [])[1]).join(','));
for (const t of tipTags) {
  const id = (t.match(/\bid="([^"]+)"/) || [])[1] || t;
  const cls = (t.match(/\bclass="([^"]+)"/) || [])[1] || '';
  // #flowtip is the Flow graph's in-graph label (SVG-space, see above).
  const ok = id === 'flowtip' || /\bqtip\b/.test(cls);
  chk(ok, `#${id} is a .qtip instance`, `class="${cls}"`);
}

// ---- one shared positioning helper ----------------------------------------
const JS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'js');
const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
// Comments are not code: strip them before scanning (the migration note in
// flow.js legitimately names the old qtPlace).
const code = f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const defs = jsFiles.filter(f => /export function tipPlace\b/.test(code(f)));
chk(defs.length === 1 && defs[0] === 'views.js', 'tipPlace is defined exactly once (views.js)', defs.join(','));
const users = ['flow.js', 'drawer.js', 'hive.js'].filter(f => /\btipPlace\(/.test(code(f)));
chk(users.length === 3, 'flow/drawer/hive all place through tipPlace', users.join(','));
chk(!jsFiles.some(f => /\bqtPlace\b/.test(code(f))),
  'the old per-view placement code (qtPlace) is gone');

// ---- negative control -----------------------------------------------------
// The detector must actually detect: a second shell class sneaking back in has
// to be reported. Without this the check could pass vacuously forever.
const fake = '.mytip{position:fixed;pointer-events:none;max-width:200px;background:var(--card)}\n'
  + '#othertip{position:fixed;z-index:70;border:1px solid var(--border)}';
const caught = violations(fake);
chk(caught.some(v => /mytip/.test(v)), 'control: a new fixed tooltip shell is caught', caught.join(' | '));
chk(caught.some(v => /othertip/.test(v)), 'control: a tip-named rule with shell chrome is caught', caught.join(' | '));
chk(violations('.qtip{position:fixed;pointer-events:none;max-width:300px}\n#lntip{z-index:90;max-width:320px}').length === 0,
  'control: the real shell and a themed instance pass');

console.log(`\ncheck_one_tooltip.js  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
