const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/lst254-wt/';
const port = process.argv[2], tag = process.argv[3] || 'after';
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const w of [1920,1440,1024,900,600,390,360]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    const pg = await ctx.newPage();
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
    for (const view of ['home','live']) {
      await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/${view}`);
      await pg.waitForTimeout(2200);
      const o = await pg.evaluate(() => {
        const t = document.getElementById('logbtn').getBoundingClientRect();
        const hit = [], sel = '.card,.panel,table,.kpi,.liverow,.fleetbar';
        for (const e of document.querySelectorAll(sel)) {
          const r = e.getBoundingClientRect(); if (!r.width || !r.height || e.closest('[hidden]')) continue;
          if (getComputedStyle(e).visibility === 'hidden') continue;
          const ix = Math.min(r.right, t.right) - Math.max(r.left, t.left), iy = Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top);
          if (ix > 0.5 && iy > 0.5) hit.push((e.id || e.className.toString().slice(0, 30)) + ':' + ix.toFixed(1) + 'x' + iy.toFixed(1));
        }
        return { tab: [t.left, t.top, t.width, t.height].map(Math.round), hs: document.documentElement.scrollWidth - document.documentElement.clientWidth, hit };
      });
      if (o.hit.length || o.hs > 0) bad++;
      console.log(tag, w, view, JSON.stringify(o));
    }
    await ctx.close();
  }
  console.log('violations', bad); await b.close();
})();
