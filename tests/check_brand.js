// Branding: the logo must render before the title, survive both themes, and
// stay inline (no network request) so the file still opens from file://.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS || 'examples/reports';
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
let p = 0, f = 0;
const chk = (c, m, x) => { c ? (p++, console.log('  OK   ' + m + (x ? '  ' + x : '')))
                             : (f++, console.log('  FAIL ' + m + (x ? '  ' + x : ''))); };

// The rename the owner asked for: verify the OLD name is gone everywhere.
chk(!/Model Router Analytics/.test(html), 'old product name absent from output');
chk(/<title>LLM Telemetry<\/title>/.test(html), 'tab title is LLM Telemetry');

const dom = new JSDOM(html, { runScripts: 'outside-only' });
const d = dom.window.document;

const mark = d.querySelector('.brandmark');
chk(!!mark, 'brand mark present in header');
chk(mark && mark.tagName.toLowerCase() === 'svg', 'brand mark is inline SVG');

// Inline, not fetched: an external logo breaks the single-artifact promise.
chk(mark && !mark.querySelector('image'), 'brand mark has no external <image>');
chk(!/<img[^>]+logo/i.test(html), 'no <img> logo anywhere');

// Order matters: the request was logo BEFORE the title.
const title = d.querySelector('.page-title');
chk(!!title, 'page title present');
if (mark && title) {
  const pos = mark.compareDocumentPosition(title);
  chk(!!(pos & dom.window.Node.DOCUMENT_POSITION_FOLLOWING),
      'logo comes BEFORE the title in document order');
  chk(title.textContent.trim() === 'LLM Telemetry',
      'visible title text', `(${title.textContent.trim()})`);
}

// Theme safety: a hardcoded hex would disappear on one of the two themes.
chk(mark && mark.getAttribute('stroke') === 'currentColor',
    'mark strokes with currentColor, not a fixed hex');
chk(/\.brandmark\{[^}]*color:var\(--accent\)/.test(html),
    'mark colour comes from a theme variable');

// Decorative: the title beside it already names the page.
chk(mark && mark.getAttribute('aria-hidden') === 'true',
    'mark is aria-hidden (decorative, title carries the name)');

chk(/<link rel="icon"/.test(html), 'favicon declared');

// The price sheet must carry the same lockup, or the pages look unrelated.
const cp = path.join(REPORTS, 'costs.html');
if (fs.existsSync(cp)) {
  const c = fs.readFileSync(cp, 'utf8');
  chk(/<h1><svg/.test(c), 'price sheet h1 carries the same mark');
  chk(/<link rel="icon"/.test(c), 'price sheet has a favicon');
} else {
  console.log('  --   costs.html not built, skipping price-sheet checks');
}

console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
process.exit(f === 0 ? 0 : 1);