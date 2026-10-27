// The project filter <select> sized itself to its longest <option>, and a long
// real project path made it ~780px wide, so the page scrolled sideways at
// 481-870px (the max-width cap lived only inside @media(max-width:480px)).
// jsdom does no layout, so this asserts on the BUILT page's CSS: the cap must
// be a TOP-LEVEL rule (applies at every width), with ellipsis truncation.
// The real-browser measurement is shots/projfilter_overflow.py (browser-only).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// Keep only top-level CSS (drop every @media/@supports block, any nesting).
const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/g) || []).join('\n')
  .replace(/<\/?style[^>]*>/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
let top = '', depth = 0;
const inAt = [];
for (let i = 0; i < css.length; i++) {
  const c = css[i];
  if (c === '{') {
    inAt.push(/^\s*@(media|supports)/.test(css.slice(0, i).split(/[{}]/).pop()));
  }
  if (!inAt.some(Boolean)) top += c;
  if (c === '}') inAt.pop();
}
function rule(selRe) {
  const out = [];
  for (const r of top.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selRe.test(r[1].trim())) out.push(r[2]);
  }
  return out.join(';');
}
const sel = rule(/^select\.chip$/);
const wrap = rule(/^\.selwrap$/);
chk(/max-width\s*:\s*100%/.test(sel), 'select.chip max-width:100% at top level (all widths)', sel);
chk(/min-width\s*:\s*0/.test(sel), 'select.chip min-width:0 at top level', sel);
chk(/text-overflow\s*:\s*ellipsis/.test(sel), 'select.chip truncates with ellipsis', sel);
chk(/max-width\s*:\s*100%/.test(wrap), '.selwrap max-width:100% at top level', wrap);
chk(/min-width\s*:\s*0/.test(wrap), '.selwrap min-width:0 at top level', wrap);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
