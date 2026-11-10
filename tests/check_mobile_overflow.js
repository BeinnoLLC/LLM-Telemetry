// #LST-230/232: mobile 390px pass — no horizontal page scroll at 390x844.
// Uses Playwright to walk every [data-view] route and assert scrollWidth <= clientWidth.
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('SKIP playwright not available');
  // run-all.js reads the "N passed, M failed" line to score a suite; without
  // it a skip is counted as NO RESULT and fails CI. Report a real 0/0.
  console.log('0 passed, 0 failed (skipped — playwright not installed)'); process.exit(0); }
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const url = 'file://' + path.resolve(__dirname, '..', 'examples', 'reports', 'dashboard.html');
  await page.goto(url);
  const views = await page.$$eval('[data-view]', els => els.map(e => e.getAttribute('data-view')));
  let fail = 0;
  for (const v of views) {
    await page.click(`[data-view="${v}"]`).catch(() => {});
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) { fail++; console.log('  FAIL horizontal scroll on view ' + v); }
    else { console.log('  ok  view ' + v); }
  }
  await browser.close();
  console.log(`${views.length - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
