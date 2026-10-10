// #19: wide tables/lists responsive — health rows + failure list stack at
// mobile width instead of overflowing their old fixed-width flex columns.
// The rates table's sticky first column + fade edge moved into the app's
// Prices view (costs.html was deleted, #113), so the sticky-column contract
// is checked against the app CSS (styles.css) the view renders with.
const fs = require('fs');
const path = require('path');

const dash = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
const css = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// ---- dashboard.html: health rows (.hrow) and failure list (.frow) --------
const mobileBlockMatch = dash.match(/@media\(max-width:640px\)\{([\s\S]*?)\n\s*\}\n @media\(max-width:400px\)/);
chk(!!mobileBlockMatch, 'mobile block found in dashboard.html');
const block = mobileBlockMatch ? mobileBlockMatch[1] : '';

chk(/\.hrow\{flex-wrap:wrap/.test(block), 'health rows (.hrow) wrap onto multiple lines at mobile width instead of a fixed-width single row');
chk(/\.hrow \.hname\{width:auto !important;flex:1 1 100%/.test(block), 'health row model name takes its own full-width line');
chk(/overflow-wrap:anywhere/.test(block) && /\.hrow \.hname/.test(block.match(/\.hrow \.hname\{[^}]*\}/)?.[0] || ''),
    'health row model name can break mid-word (overflow-wrap:anywhere) so a long id never forces horizontal scroll');
chk(/\.frow\{flex-wrap:wrap/.test(block), 'failure rows (.frow) wrap at mobile width');
chk(/\.frow \.fmsg\{flex:1 1 100%/.test(block), 'failure message takes its own full-width line so it is never truncated to a sliver');
chk(/\.frow \.fmodel\{[^}]*overflow-wrap:anywhere/.test(block), 'failure row model name can break mid-word too');

// Desktop (outside the mobile block) must keep the original fixed-width
// single-line layout — this is an ADDITIVE mobile override, not a rewrite.
chk(/\.hname\{width:172px/.test(dash) || /width:172px/.test(dash), 'desktop health-row name column still exists at its original fixed width outside the mobile override');
chk(/\.hrate\{width:52px/.test(dash) || /width:52px/.test(dash), 'desktop health-row rate column still exists at its original width');

// ---- Prices view (in-app rates table): sticky first column + fade edge ----
chk(/\.pv-wrap\{[^}]*position:relative/.test(css), 'rates table wrapper is positioned for the sticky column (.pv-wrap)');
chk(/\.pv-wrap::after\{content:'';position:absolute;top:0;right:0;bottom:0;width:26px;\s*background:linear-gradient\(to right,transparent,var\(--card\)\)/.test(css),
    'fading right edge signalling more columns off-screen');
chk(/\.pv-tbl th:first-child,\.pv-tbl td:first-child\{position:sticky;left:0/.test(css),
    'rates table pins its first column (model identity) while scrolling horizontally');
chk(/pv-wrap/.test(dash), 'the Prices view table renders inside .pv-wrap (class on the wrapper element)');
chk(!/<div style="overflow-x:auto">/.test(dash),
    'the old unstyled overflow-x wrapper div is gone (pv-wrap owns scrolling now)');

console.log(`\ncheck_wide_tables.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);