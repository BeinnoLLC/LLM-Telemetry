const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/grafana-g4-wt/';
const OUT = ROOT + 'shots/g4/';
const port = process.argv[2];
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
live.agent_live = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash', in_tok: 120000, out_tok: 8000, cost_usd: 1.84, uptime_s: 2400 },
  { engine: 'claude', session_id: 'c-2', title: 'web-client', model: 'claude-opus-5', idle_s: 25, phase: 'editing files', uptime_s: 900 },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5', idle_s: 14, phase: 'waiting for approval', in_tok: 5000, out_tok: 900, uptime_s: 300 },
  { engine: 'claude', session_id: 'c-3', title: 'old-spike', model: 'claude-sonnet-5', idle_s: 400, phase: 'idle', uptime_s: 7200 },
];
(async () => {
  const b = await chromium.launch(); let errs = 0;
  for (const theme of ['dark', 'light']) for (const w of [1280, 900, 600, 360]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => { errs++; console.log('ERR', e); });
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
    await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/home`);
    await pg.waitForSelector('#livelist .liverow', { timeout: 15000 });
    await pg.waitForTimeout(2500);
    const o = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('#livelist .liverow')];
      const sc = document.querySelector('.lvscroll');
      return { theme: document.documentElement.className || document.body.className, rows: rows.length,
        rowH: rows.map(r => Math.round(r.getBoundingClientRect().height)).join(','),
        panelScrollW: sc.scrollWidth, panelClientW: sc.clientWidth,
        hs: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    console.log(theme, w, JSON.stringify(o));
    await pg.locator('.lvscroll').scrollIntoViewIfNeeded();
    await pg.evaluate(() => window.scrollBy(0, -120));
    await pg.screenshot({ path: OUT + `home-${theme}-${w}.png` });
    if (true) {
      const el = pg.locator('.lvscroll'); 
      const ctx2 = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
      await ctx2.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
      const p2 = await ctx2.newPage();
      p2.on('pageerror', e => { errs++; console.log('ERR', e); });
      await p2.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
      await p2.goto(`http://127.0.0.1:${port}/dashboard.html#/home`);
      await p2.waitForSelector('#livelist .liverow'); await p2.waitForTimeout(2500);
      await p2.locator('.lvscroll').screenshot({ path: OUT + `table-${theme}-${w}@2x.png` });
      if (w === 1280 && theme === 'dark') { // sorted state
        await p2.locator('[data-sort="tokens"]').click(); await p2.locator('[data-sort="tokens"]').click();
        await p2.waitForTimeout(400);
        await p2.locator('.lvscroll').screenshot({ path: OUT + `table-dark-1280-sorted-tokens-desc@2x.png` });
      }
      await ctx2.close();
    }
    await ctx.close();
  }
  console.log('pageerrors', errs); await b.close();
})();
