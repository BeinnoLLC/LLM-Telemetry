const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/g0-wt/';
const [pA, pB] = [process.argv[2], process.argv[3]];   // A = after (worktree), B = before (/tmp/g0/rep)
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
live.agent_live = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash' },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5', idle_s: 14, phase: 'thinking' }];
let errs = 0;
async function page(b, port, theme, w) {
  const pg = await b.newPage({ viewport: { width: w, height: 900 } });
  pg.on('pageerror', e => { errs++; console.log('PAGEERROR', e.message); });
  if (theme) await pg.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
  await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
  await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/`);
  await pg.waitForSelector('#qt-running', { timeout: 15000 });
  await pg.waitForTimeout(3000);
  return pg;
}
(async () => {
  const b = await chromium.launch();
  // ---- 0b: dark reload
  for (const [tag, port] of [['after', pA], ['before', pB]]) {
    const pg = await page(b, port, 'dark', 1280);
    await pg.reload(); await pg.waitForSelector('#qt-running'); await pg.waitForTimeout(3000);
    const o = await pg.evaluate(() => {
      const row = document.querySelector('.liverow');
      return { theme: document.documentElement.dataset.theme,
        liverows: document.querySelectorAll('.liverow').length,
        rowBorder: row && getComputedStyle(row).borderTopColor,
        cardBg: getComputedStyle(document.querySelector('.card')).backgroundColor,
        chartGrid: window.Chart && Chart.defaults.borderColor, chartTick: window.Chart && Chart.defaults.color };
    });
    console.log('dark-reload', tag, JSON.stringify(o));
    if (tag === 'after') {
      await pg.evaluate(() => document.querySelector('.liverow')?.scrollIntoView({ block: 'center' }));
      await pg.screenshot({ path: ROOT + 'shots/g0-dark-reload-1280.png' });
    } else await pg.screenshot({ path: ROOT + 'shots/g0-dark-reload-1280-BEFORE.png' });
    await pg.close();
  }
  // ---- 0a: light, computed styles of every element + pixel diff
  const dump = async port => {
    const pg = await page(b, port, null, 1280);
    await pg.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await pg.waitForTimeout(500);
    const d = await pg.evaluate(() => [...document.body.querySelectorAll('*')].map(el => {
      const cs = getComputedStyle(el); const o = {};
      for (const p of cs) o[p] = cs.getPropertyValue(p);
      return [el.tagName + '#' + el.id + '.' + (el.getAttribute('class') || ''), o];
    }));
    const png = await pg.screenshot({ fullPage: true });
    await pg.close(); return { d, png };
  };
  const A = await dump(pA), B = await dump(pB);
  let diffs = 0, props = 0, n = Math.min(A.d.length, B.d.length);
  const dl = [];
  for (let i = 0; i < n; i++) for (const k in A.d[i][1]) { props++;
    if (A.d[i][1][k] !== B.d[i][1][k]) { diffs++; if (dl.length < 8) dl.push([A.d[i][0], k, B.d[i][1][k], A.d[i][1][k]]); } }
  console.log('light elements', A.d.length, B.d.length, 'props compared', props, 'differences', diffs, JSON.stringify(dl));
  fs.writeFileSync(ROOT + 'shots/g0-light-after.png', A.png); fs.writeFileSync(ROOT + 'shots/g0-light-before.png', B.png);
  console.log('png bytes equal:', Buffer.compare(A.png, B.png) === 0);
  console.log('pageerrors', errs); await b.close();
})();
