const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/roomy-wt/';
const OUT = ROOT + 'shots/roomy/';
const ports = { before: process.argv[2], after: process.argv[3] };
const live = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
live.agent_live = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash', in_tok: 120000, out_tok: 8000, cost_usd: 1.84, cost_class: 'subscription', uptime_s: 2400 },
  { engine: 'claude', session_id: 'c-2', title: 'web-client', model: 'claude-opus-5', idle_s: 25, phase: 'editing files', uptime_s: 900 },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5-codex', idle_s: 14, phase: 'waiting for approval', in_tok: 5000, out_tok: 900, cost_usd: 0.31, cost_class: 'subscription', uptime_s: 300 },
  { engine: 'claude', session_id: 'c-3', title: 'old-spike', model: 'claude-sonnet-5', idle_s: 400, phase: 'idle', uptime_s: 7200 },
];
live.pi_live = [{ session_id: 'pi-9', agent: 'scout', title: 'Index the repo', model: 'glm-5', idle_s: 9, uptime_s: 600, switched: true, init_model: 'gpt-5',
  phase: 'reading', tools: ['read_file', 'terminal', 'grep', 'edit', 'web'], in_tok: 4000, out_tok: 1000, cost_usd: 0.0123 }];
(async () => {
  const b = await chromium.launch(); let errs = 0; const report = [];
  for (const which of ['before', 'after']) for (const theme of ['dark', 'light']) for (const w of [1440, 1024, 390]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => { errs++; console.log('ERR', which, theme, w, String(e)); });
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(live) }));
    await pg.goto(`http://127.0.0.1:${ports[which]}/dashboard.html#/home`);
    await pg.waitForSelector('#livelist .liverow', { timeout: 15000 });
    await pg.waitForTimeout(2500);
    const o = await pg.evaluate(() => {
      const rows = [...document.querySelectorAll('#livelist .liverow')];
      const sc = document.querySelector('.lvscroll');
      const fs = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontSize : null; };
      const trunc = [...document.querySelectorAll('#livelist .liverow *')].filter(e => e.children.length === 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.textContent.trim()).map(e => e.textContent.trim().slice(0, 30));
      return { rows: rows.length, rowH: rows.map(r => Math.round(r.getBoundingClientRect().height)).join(','),
        font: { title: fs('.lvtitle'), model: fs('.lvmodel'), cell: fs('.lvrow .lvnum'), phase: fs('.lvphase'), head: fs('.lvh') },
        panelScrollW: sc.scrollWidth, panelClientW: sc.clientWidth, truncated: trunc,
        hs: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    console.log(which, theme, w, JSON.stringify(o));
    await pg.locator('.lvscroll').screenshot({ path: OUT + `table-${which}-${theme}-${w}@2x.png` });
    await ctx.close();
  }
  console.log('pageerrors', errs); await b.close();
})();
