const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/agentq-wt/';
const port = process.argv[2];
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
live.agent_live = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash' },
  { engine: 'claude', session_id: 'c-2', title: 'web-client', model: 'claude-opus-5', idle_s: 25, phase: 'editing files' },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5', idle_s: 14, phase: 'thinking' },
];
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
  await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/`);
  await pg.waitForSelector('#qt-running', { timeout: 15000 });
  await pg.waitForTimeout(7000);
  const kpi = pg.locator('#kpis .kpi-live').first();
  const card = kpi.locator('xpath=ancestor::*[contains(@class,"card")][1]');
  await (await card.count() ? card : kpi).screenshot({ path: ROOT + 'shots/agentq-logo-kpi.png' });
  await pg.locator('#qt-running').screenshot({ path: ROOT + 'shots/agentq-logo-train.png' });
  console.log(await pg.evaluate(() => [...document.querySelectorAll('svg[data-kindlogo]')].map(s => s.getBoundingClientRect().width)));
  await b.close();
})();
