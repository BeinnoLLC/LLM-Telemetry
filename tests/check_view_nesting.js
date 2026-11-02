// Prices and Rankings are top-level views. Nested inside the Cost view they
// sat under a display:none ancestor whenever they were active, so the page
// rendered an empty Prices tab.
const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const d = new JSDOM(html).window.document;
let pass = 0, fail = 0;
const chk = (ok, name) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); };
for (const v of ['Prices', 'Rankings']) {
  const el = d.querySelector(`.view[data-view="${v}"]`);
  chk(!!el, `${v} view exists`);
  chk(!!el && !el.parentElement.closest('.view'), `${v} view is not nested inside another view`);
}
console.log(`\ncheck_view_nesting.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
