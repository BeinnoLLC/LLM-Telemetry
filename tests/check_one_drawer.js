// LLMTELEMET-314: one Drawer component. Both side panels carry class "drawer"
// and the id rules declare no shell properties (those live on .drawer).
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

const tag = id => (html.match(new RegExp('<div id="' + id + '"[^>]*>')) || [''])[0];
const cls = id => ((tag(id).match(/class="([^"]*)"/) || [, ''])[1]).split(/\s+/);
chk(cls('drawer').includes('drawer'), '#drawer carries class drawer');
chk(cls('pdrawer').includes('drawer'), '#pdrawer carries class drawer');
chk(cls('pdrawer').includes('drawer-wide'), '#pdrawer is the drawer-wide variant');

const shell = /(^|[;{\s])(position|transform|width|background|border-left|box-shadow|transition|display|flex-direction)\s*:/;
for (const id of ['drawer', 'pdrawer']) {
  const rules = [...html.matchAll(new RegExp('(?:^|[}\\s])#' + id + '\\{([^}]*)\\}', 'g'))];
  chk(rules.length > 0, '#' + id + ' id rule exists');
  chk(rules.every(m => !shell.test(m[1])), '#' + id + ' id rules declare no shell properties');
}
chk(/\.drawer-wide\{width:min\(420px,92vw\)/.test(html), '.drawer-wide stays 420px');
chk(/prefers-reduced-motion:reduce\)\{\.drawer,\.drawer:not\(\.open\)\{transition:none/.test(html),
    'drawer transitions are off under prefers-reduced-motion');
console.log(`check_one_drawer.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
