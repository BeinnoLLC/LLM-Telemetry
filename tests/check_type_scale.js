// #20: responsive type scale. Every flowing UI text-size utility on the page
// must use a fluid token (--fs-xs/sm/md/lg/xl), not a literal Tailwind
// text-[Npx] size — those cannot react to breakpoints/viewport width and the
// smallest ones (9-10.5px) were unreadable on a phone. SVG-internal
// font-size (tick labels, gauge readouts) is intentionally out of scope: each
// diagram already scales as one unit via its own container variable
// (e.g. --gauge-size) and is never the smallest text a user has to actually
// read on the page.
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'src', 'llm_telemetry', 'build_dashboard.py');
const src = fs.readFileSync(srcPath, 'utf8');
// P2-01 (#26): the --fs-* clamp() tokens live in the extracted CSS file, not
// inline in build_dashboard.py anymore -- check those two assertions against
// cssSrc, everything else (literal text-[Npx] utilities, which are Tailwind
// classes in markup, not CSS custom properties) stays against the .py source.
const cssPath = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css');
const cssSrc = fs.readFileSync(cssPath, 'utf8');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// The literal Tailwind text-size utility this ticket is about.
const literalTextSize = /text-\[[0-9.]+px\]/g;

const srcMatches = src.match(literalTextSize) || [];
chk(srcMatches.length === 0, 'no literal text-[Npx] Tailwind utility remains in the source', srcMatches.join(','));

const htmlMatches = html.match(literalTextSize) || [];
chk(htmlMatches.length === 0, 'no literal text-[Npx] utility survives into the built dashboard.html', htmlMatches.join(','));

// The fluid tokens exist and are genuinely clamp()-based (scale with the
// viewport), not just a renamed constant.
['--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl'].forEach(tok => {
  const re = new RegExp(tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*clamp\\(');
  chk(re.test(cssSrc), `${tok} is defined as a clamp() (scales with viewport)`);
});

// The floor: --fs-xs's minimum must be >= 11px (the ticket's explicit
// "minimum label text 11px" requirement).
const xsMatch = cssSrc.match(/--fs-xs:clamp\((\d+)px/);
chk(!!xsMatch && +xsMatch[1] >= 11, '--fs-xs floor is >= 11px', xsMatch && xsMatch[1]);

// Tokens are actually USED (not just declared and ignored) — every text-size
// utility class in the emitted markup should reference one of them.
const tokenUsages = (html.match(/text-\[length:var\(--fs-(xs|sm|md|lg|xl)\)\]/g) || []).length;
chk(tokenUsages > 50, 'the fluid tokens are used broadly across the built page', tokenUsages);

console.log(`\ncheck_type_scale.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
