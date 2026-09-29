// #19: wide tables/lists responsive — health rows + failure list stack at
// mobile width instead of overflowing their old fixed-width flex columns,
// and the costs.html rates table gets a sticky first column + fade edge.
const fs = require('fs');
const path = require('path');

const dash = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
const costs = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'costs.html'), 'utf8');

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

// ---- costs.html: sticky first column + fade edge --------------------------
chk(/\.tblwrap\{position:relative;overflow-x:auto\}/.test(costs), 'costs.html table wrapper is scrollable and positioned for the sticky column');
chk(/\.tblwrap::after\{content:'';position:absolute;top:0;right:0;bottom:0;width:28px;\s*background:linear-gradient\(to right,transparent,var\(--card\)\)/.test(costs),
    'costs.html has a fading right edge signalling more columns off-screen');
chk(/thead th:first-child,tbody td:first-child\{position:sticky;left:0/.test(costs),
    'costs.html rates table pins its first column (model identity) while scrolling horizontally');
chk(/<div class="tblwrap">/.test(costs), 'the rates table is actually wrapped in .tblwrap in the emitted markup');
chk(!/<div style="overflow-x:auto">/.test(costs), 'the old unstyled overflow-x wrapper div is gone (replaced by .tblwrap)');

console.log(`\ncheck_wide_tables.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
