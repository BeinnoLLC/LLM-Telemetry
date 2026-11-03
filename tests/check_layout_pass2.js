// LST-261 pass 2: the body-text floor, hidden floating Logs tab, 2-up KPIs on phones,
// one-row filters, even Explore grid, one control scale, empty-card collapse. Loads the BUILT page CSS.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, name) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`); } };
const has = re => re.test(html);

chk(has(/--fs-xs:13px;/) && has(/--fs-sm:14px;/), 'body text floor: --fs-xs 13px, --fs-sm 14px');
chk(!has(/[;{ ]font-size:(?:9|10|11|11\.2|12|12\.5)px(?![^<]*<\/tspan>)/), 'no hard-coded sub-13px font-size left in the stylesheet');
chk(has(/\.lbl\{font-size:13px/), '.lbl is at least 13px');
chk(has(/@media \(max-width:600px\)\{ :root\{--logtab-w:0px;--logtab-gap:0px\} #logbtn\{display:none\} \}/), 'floating Logs tab hidden at <=600px and reserves no gutter');
chk(has(/@media\(max-width:340px\)\{\.grid-kpi\{grid-template-columns:1fr\}\}/) && has(/\.grid-kpi\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/), 'KPI cards are 2 columns on phones (1 only below 340px)');
chk(has(/#projfilterbar\{flex-wrap:nowrap\}/) && has(/#projfilterbar \.selwrap\{flex:1 1 0/), 'the three filter selects share one row');
chk(has(/\.grid-home\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}/), 'Explore tiles use an even 4-column grid (3 equal rows)');
chk(has(/\.xp-blurb\{white-space:normal;display:-webkit-box;[^}]*-webkit-line-clamp:2/), 'Explore blurbs wrap to 2 lines');
chk(has(/--ctl-sm:28px;--ctl-md:32px;--ctl-lg:44px/), 'one control size scale: sm 28 / md 32 / lg 44');
chk(has(/\.csvbtn,\.dt-dens button[^{]*\{min-height:var\(--ctl-sm\)/) && has(/min-height:var\(--ctl-lg\)/), 'chips, density toggle, Export CSV use the scale; touch size on phones');
chk(has(/@media \(max-width:1100px\) and \(min-width:900px\)\{\.qtrain\{gap:12px\}/) && has(/@media \(max-width:899px\)\{\.qtrain\{grid-template-columns:minmax\(0,1fr\)\}\}/), 'three jars stay side by side down to 900px');
chk(has(/\.card:has\(> \[id\$="empty"\]:not\(\[hidden\]\)\) > div\[style\*="height"\]/), 'empty cards collapse to one line');
chk(has(/<details class="olurls"><summary>/) && has(/\+\$\{urls\.length - 1\} more/), 'local inference hosts show the first endpoint plus "+N more"');
chk(has(/\.lgtag\{overflow:visible;text-overflow:clip;min-width:66px\}/), 'Logs role/tool tags are not truncated');
chk(has(/class="lvtool" title="\$\{escA\(t\)\}"/), 'tool names carry a title tooltip');
chk(has(/\.dt-cap\{caption-side:top;text-align:left;/), 'density toggle sits at the left of the table, never scrolled out of view');
console.log(`check_layout_pass2.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
