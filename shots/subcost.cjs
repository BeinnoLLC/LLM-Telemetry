const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/subcost-wt/';
const OUT = ROOT + 'shots/subcost/';
const port = process.argv[2];
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
live.agent_live = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash', in_tok: 120000, out_tok: 8000, cost_usd: 1.84, cost_class: 'subscription', uptime_s: 2400 },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5.3-codex', idle_s: 14, phase: 'thinking', in_tok: 5000, out_tok: 900, cost_usd: 0.0182, cost_class: 'subscription', uptime_s: 300 },
  { engine: 'claude', session_id: 'c-2', title: 'web-client', model: 'claude-opus-5', idle_s: 25, phase: 'editing files', uptime_s: 900 },
];
(async () => {
  const b = await chromium.launch(); let errs = 0;
  for (const theme of ['dark', 'light']) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => { errs++; console.log('ERR', e); });
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
    await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/home`);
    await pg.waitForSelector('#livelist .liverow', { timeout: 15000 });
    await pg.waitForTimeout(2500);
    const o = await pg.evaluate(() => ({
      hs: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cov: document.querySelectorAll('#livelist .lvcov').length,
      est: [...document.querySelectorAll('.kpi-card')].filter(c => /Est\. cost/.test(c.textContent)).length }));
    console.log(theme, JSON.stringify(o));
    await pg.locator('.lvscroll').screenshot({ path: OUT + `livetable-${theme}-1280@2x.png` });
    const cost = pg.locator('#livelist [data-agentsession="c-1"]').locator('.lvnum').nth(2);
    await cost.screenshot({ path: OUT + `costcell-${theme}-1280@2x.png` });
    const kpi = pg.locator('.kpi-card', { hasText: 'Est. cost' }).first();
    if (await kpi.count()) { await kpi.scrollIntoViewIfNeeded(); await kpi.screenshot({ path: OUT + `estcost-kpi-${theme}-1280@2x.png` }); }
    else console.log('no Est. cost KPI on home');
    await ctx.close();
  }
  console.log('pageerrors', errs); await b.close();
})();
