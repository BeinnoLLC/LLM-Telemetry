// #14: tablet pass (641-1024px) — separate portrait/landscape handling,
// the .livegrid breakpoint no longer force-stacking a 1024px landscape
// tablet, and viewport-height-driven chart heights.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// .livegrid must stack at 834px and below, but NOT be forced to stack between
// 835 and 1024px — that landscape band has the width to keep list+charts
// side by side. The regression this ticket fixes was a max-width:1000px rule
// that swallowed part of that landscape band.
chk(/max-width:834px\)\{\s*\n\s*\.livegrid\{grid-template-columns:minmax\(0,1fr\)/.test(html),
    '.livegrid stacks at <=834px (portrait tablet and down)');
chk(!/max-width:1000px\)\{\s*\n\s*\.livegrid/.test(html),
    'the old max-width:1000px livegrid rule is gone (it force-stacked 835-1000px landscape unnecessarily)');
chk(!/max-width:900px\)\{\s*\n\s*\.livegrid/.test(html) && !/max-width:1024px\)\{\s*\n\s*\.livegrid/.test(html),
    'no OTHER livegrid stacking rule reintroduces a landscape-tablet force-stack');

// Portrait tablet: single-column chart pairs, taller aspect ratio.
chk(/@media\(min-width:641px\) and \(max-width:834px\) and \(orientation:portrait\)\{[\s\S]{0,120}?\.grid-2\{grid-template-columns:1fr\}/.test(html),
    'portrait tablet (<=834px) collapses chart pairs to a single column');
chk(/@media\(min-width:641px\) and \(max-width:834px\) and \(orientation:portrait\)\{[\s\S]{0,250}?canvas\{max-height:min\(/.test(html),
    'portrait tablet charts use a viewport-height-driven clamp() ceiling, not a fixed px height');

// Landscape tablet: charts still get a real height ceiling (not the desktop
// default), driven by viewport height so a short landscape window does not
// force scrolling mid-chart.
chk(/@media\(min-width:835px\) and \(max-width:1024px\) and \(orientation:landscape\)\{[\s\S]{0,120}?canvas\{max-height:min\(/.test(html),
    'landscape tablet (835-1024px) charts use a viewport-height clamp() ceiling');

// Both bands are genuinely disjoint (835 starts exactly where 834 ends) so
// there is no gap or double-match at the boundary.
const portraitMax = (html.match(/max-width:(\d+)px\) and \(orientation:portrait\)/) || [])[1];
const landscapeMin = (html.match(/min-width:(\d+)px\) and \(max-width:1024px\) and \(orientation:landscape\)/) || [])[1];
chk(portraitMax === '834' && landscapeMin === '835', 'portrait/landscape tablet bands are contiguous with no gap or overlap',
    `portrait<=${portraitMax}, landscape>=${landscapeMin}`);

// The icon-rail nav is already collapsed by default (#102) — confirm the
// tablet width range does not force it into the full-label desktop rail,
// which would eat into the portrait tablet's limited width.
chk(/#navdrawer\{[\s\S]{0,80}?width:var\(--rail-now\)/.test(html), 'nav rail width is driven by --rail-now (icon-rail-by-default still applies at tablet widths)');

console.log(`\ncheck_tablet_pass.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
