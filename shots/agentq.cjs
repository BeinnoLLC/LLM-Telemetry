const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/agentq-wt/';
const OUT = ROOT + 'shots/';
const port = process.argv[2];
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
live.agent_live = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash' },
  { engine: 'claude', session_id: 'c-2', title: 'web-client', model: 'claude-opus-5', idle_s: 25, phase: 'editing files' },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5', idle_s: 14, phase: 'thinking' },
];
(async () => {
  const b = await chromium.launch(); let errs = 0;
  for (const w of [1280, 900, 600, 360]) {
    const pg = await b.newPage({ viewport: { width: w, height: 900 } });
    pg.on('pageerror', e => { errs++; console.log('ERR', e); });
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
    await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/`);
    await pg.waitForSelector('#qt-running', { timeout: 15000 });
    await pg.waitForTimeout(7000);
    const o = await pg.evaluate(() => ({
      cars: [...document.querySelectorAll('#qt-running .qt-car')].map(c => c.dataset.key + ':' + c.dataset.kind),
      kpi: document.querySelector('#kpis .kpi-live').textContent.trim(),
      hs: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    console.log(w, JSON.stringify(o));
    await pg.locator('#qtrain').scrollIntoViewIfNeeded();
    await pg.evaluate(() => window.scrollBy(0, -260));
    await pg.screenshot({ path: OUT + `agentq-${w}.png` });
    await pg.close();
  }
  console.log('pageerrors', errs); await b.close();
})();
