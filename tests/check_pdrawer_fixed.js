// LLMTELEMET-343: #drawer/#pdrawer (and scrims) must be direct children of
// body so position:fixed is not trapped by an ancestor containing block.
const fs = require('fs');
const path = require('path');
const raw = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
const css = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const html = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');

let pass = 0, fail = 0;
function chk(ok, name) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'col', 'area', 'base', 'wbr']);
const stack = [], found = {};
const want = ['drawer', 'pdrawer', 'scrim', 'pdscrim'];
const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
let m;
while ((m = re.exec(html))) {
  const [, close, t0, attrs, self] = m, t = t0.toLowerCase();
  if (close) {
    const i = stack.map(s => s.t).lastIndexOf(t);
    if (i >= 0) stack.length = i;
    continue;
  }
  const id = (attrs.match(/\bid="([^"]*)"/) || [])[1];
  const cl = ((attrs.match(/\bclass="([^"]*)"/) || [, ''])[1]).split(/\s+/);
  if (id && want.includes(id)) found[id] = stack.map(s => ({ ...s }));
  if (!VOID.has(t) && !self) stack.push({ t, id, cl });
}
const bad = /(^|[;{\s])(transform|filter|backdrop-filter|contain|will-change)\s*:\s*(?!none|auto|normal)[^;}]+/;
function ruleFor(sel) {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(r => r[1].split(',').some(s => s.trim() === sel)).map(r => r[2]);
}
for (const id of ['drawer', 'pdrawer', 'pdscrim']) {
  chk(!!found[id], '#' + id + ' present');
  const anc = found[id] || [];
  chk(anc.length === 2 && anc[1].t === 'body', '#' + id + ' is a direct child of body');
  const ok = anc.every(a => {
    const sels = [a.t, a.id && '#' + a.id, ...a.cl.filter(Boolean).map(c => '.' + c)].filter(Boolean);
    return sels.every(s => ruleFor(s).every(r => !bad.test(r)));
  });
  chk(ok, '#' + id + ' has no ancestor with transform/filter/contain/will-change');
}
console.log(`check_pdrawer_fixed.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
