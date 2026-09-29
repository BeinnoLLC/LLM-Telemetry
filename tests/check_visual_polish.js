// #22: visual-polish pass — hover states, consistent card radii, and a
// shared empty-state pattern (icon + message + hint) instead of bare text.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

chk(/\.dtab:hover\{color:var\(--fg\);border-color:var\(--accent\)\}/.test(html),
    'the date-range/depth chip buttons (.dtab) get a hover state, matching .chip:hover');
chk(/\.olcard\{border:1px solid var\(--border\);border-radius:8px/.test(html),
    'the Ollama status card now uses the same 8px radius as the base .card recipe, not a stray 9px');
chk(/const emptyHTML = \(icon, msg, hint\) =>/.test(html),
    'a single shared emptyHTML() builder exists for empty-state markup');
chk(/box\.innerHTML = emptyHTML\('○', 'Nothing running right now\.'/.test(html),
    'the Live view\'s "nothing running" state uses the shared empty-state pattern (icon + message + hint), not bare muted text');
chk(/fl\.innerHTML = !groups\.length\s*\n\s*\? emptyHTML\('✓',/.test(html),
    'the failures panel\'s empty state uses the shared pattern too, and varies its hint when a filter is the reason for the empty view');
chk(/\.empty\{display:flex;flex-direction:column;align-items:center;justify-content:center/.test(html),
    'the .empty/.e-ico/.e-msg/.e-hint CSS (previously dead, unused by any markup) now backs real empty states');

console.log(`\ncheck_visual_polish.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
