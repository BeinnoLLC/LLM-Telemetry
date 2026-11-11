const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/lst254-wt/', port = process.argv[2];
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
(async () => {
  const b = await chromium.launch();
  for (const [tag, page] of [['before', '_before.html'], ['after', 'dashboard.html']])
  for (const theme of ['dark', 'light']) for (const w of [1440, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
    const pg = await ctx.newPage();
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
    await pg.goto(`http://127.0.0.1:${port}/${page}#/home`); await pg.waitForTimeout(2200);
    await pg.evaluate(() => { const n = document.getElementById('logn'); n.hidden = false; n.textContent = '12'; });
    await pg.screenshot({ path: ROOT + `shots/lst254/${tag}-${theme}-${w}.png`, clip: { x: Math.max(0, w - 360), y: 150, width: Math.min(360, w), height: 520 } });
    await ctx.close();
  }
  await b.close();
})();
