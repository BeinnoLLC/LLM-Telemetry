// LST-181 above-the-fold shots. usage: node lst181shots.cjs <port> <outdir>
const { chromium } = require('/home/hazemhagrass/.hermes/hermes-agent/node_modules/playwright-core');
const fs = require('fs');
const ROOT = '/home/hazemhagrass/worktrees/lst181-wt/';
const port = process.argv[2], OUT = ROOT + (process.argv[3] || 'shots/lst181/') ;
fs.mkdirSync(OUT, { recursive: true });
const base = JSON.parse(fs.readFileSync(ROOT + 'examples/reports/live-data.json', 'utf8'));
let tick = 0;
const AGENTS = [
  { engine: 'claude', session_id: 'c-1', title: 'billing-api', model: 'claude-opus-5', idle_s: 6, phase: 'running Bash', in_tok: 120000, out_tok: 8000, cost_usd: 1.84, uptime_s: 2400 },
  { engine: 'claude', session_id: 'c-2', title: 'web-client', model: 'claude-opus-5', idle_s: 25, phase: 'editing files', uptime_s: 900 },
  { engine: 'codex', session_id: 'x-1', title: 'infra-scripts', model: 'gpt-5', idle_s: 14, phase: 'waiting for approval', in_tok: 5000, out_tok: 900, uptime_s: 300 },
];
function feed() { // cumulative counters grow every poll so the 5-min window has a shape
  tick++;
  const d = JSON.parse(JSON.stringify(base));
  d.agent_live = AGENTS;
  Object.values(d.profiles).forEach(p => (p.live || []).forEach(L => (L.models || []).forEach(m => {
    m.calls += tick * (3 + (tick % 4) * 5); m.in_tok += tick * 40000; m.out_tok += tick * 900;
  })));
  return d;
}
const variants = [['dark', 1440, 900], ['light', 1440, 900], ['dark', 390, 844], ['light', 390, 844],
  ['dark', 1024, 768], ['dark', 900, 800], ['dark', 600, 800], ['dark', 360, 740]];
(async () => {
  const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); let errs = 0;
  for (const alerts of [3, 0]) for (const [theme, w, h] of variants) {
    if (alerts === 0 && !(w === 1440 || w === 390)) continue;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await ctx.addInitScript(t => localStorage.setItem('hermes-dash-theme', t), theme);
    const pg = await ctx.newPage();
    pg.on('console', m => { if (/error|fail/i.test(m.text())) console.log('C', m.text().slice(0,120)); }); pg.on('pageerror', e => { errs++; console.log('ERR', e); });
    await pg.route('**/cdn.jsdelivr.net/**', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('/tmp/lst181-cdn/chart.js') }));
    await pg.route('**/cdn.tailwindcss.com/**', r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('/tmp/lst181-cdn/tw.js') }));
    await pg.route('**/live-data.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(feed()) }));
    await pg.goto(`http://127.0.0.1:${port}/dashboard.html#/home`);
    await pg.waitForSelector('#livelist .liverow', { timeout: 15000 });
    await pg.evaluate(n => { Object.values(DATA.profiles).forEach(p => { p.alerts = (p.alerts || []).slice(0, n); }); render(); renderLive(); }, alerts);
    await pg.waitForTimeout(16000); // 3 polls at 5s
    const o = await pg.evaluate(() => {
      const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
      return { hs: document.documentElement.scrollWidth - document.documentElement.clientWidth, vh: innerHeight,
        kpis: r('#livekpis'), qcard: r('#qcard'), table: r('.lvscroll'), firstRow: r('#livelist .liverow'), agents: r('#agentscard'),
        sparkCanvases: document.querySelectorAll('#livekpis canvas').length };
    });
    const tag = alerts === 0 ? '-allclear' : '';
    console.log(theme, w, h, 'alerts', alerts, JSON.stringify(o));
    await pg.screenshot({ path: OUT + `home-${theme}-${w}x${h}${tag}.png` });
    if (alerts) await pg.screenshot({ path: OUT + `home-${theme}-${w}x${h}-full.png`, fullPage: true });
    await ctx.close();
  }
  console.log('pageerrors', errs); await b.close();
})();
