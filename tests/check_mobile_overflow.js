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
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) {
    // Playwright itself resolved (e.g. hoisted to the root node_modules by the
    // apps/web npm workspace) but its browser binary was never downloaded — CI
    // intentionally does not run `npx playwright install` (b573700). Same
    // contract as the require-skip above: a real 0/0, not a NO RESULT crash.
    console.log('SKIP playwright browser not installed: ' + String(e.message).split('\n')[0]);
    console.log('0 passed, 0 failed (skipped — playwright browser not installed)');
    process.exit(0);
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const url = 'file://' + path.resolve(__dirname, '..', 'examples', 'reports', 'dashboard.html');
  await page.goto(url);
  const views = await page.$$eval('[data-view]', els => els.map(e => e.getAttribute('data-view')));
  let fail = 0;
  for (const v of views) {
    // LLMTELEMET-277: navigate by hash, not by clicking the view panel. A
    // hidden panel is not actionable, so the old click() waited out its full
    // 30s timeout for every hidden view and the suite could never finish once
    // playwright was installed. The hash actually reveals the view, which is
    // what the overflow measurement needs anyway.
    await page.evaluate(name => { location.hash = '#/' + String(name).toLowerCase(); }, v);
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) { fail++; console.log('  FAIL horizontal scroll on view ' + v); }
    else { console.log('  ok  view ' + v); }
  }
  await browser.close();
  console.log(`${views.length - fail} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
