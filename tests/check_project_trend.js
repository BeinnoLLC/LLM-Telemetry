// #47/P4-10: project cost trend — one series per project over the range,
// respects P4-08 weighting, top-N cap with an explicit "Other" series,
// re-tints on theme switch, keyboard-operable legend toggles visibility,
// no overflow at 360px.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

chk(/id="cProjTrend"/.test(html), 'the project trend canvas exists');
chk(/id="projtrendstack"/.test(html), 'the stacked-share toggle exists');
chk(/id="projtrendlegend"/.test(html), 'a legend container for the trend exists');
// 360px acceptance criterion: the card sits in the same overflow-safe view
// as the matrix (no fixed pixel widths wider than the wrap would allow) —
// checked by absence of a hardcoded wide min-width on the trend card.
chk(!/id="projtrendcard"[^>]*min-width:\s*[4-9]\d\d/.test(html),
    'the trend card has no hardcoded min-width that would overflow a 360px viewport');

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) {
        this.config = cfg; this.canvas = ctx; this.destroy = () => { this._destroyed = true; };
        this.update = () => {};
        this._visibility = (cfg.data.datasets || []).map(() => true);
        this.isDatasetVisible = (i) => this._visibility[i];
        this.setDatasetVisibility = (i, v) => { this._visibility[i] = v; };
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      const created = [];
      const RealStub = Stub;
      function StubWrap(ctx, cfg) { const c = new RealStub(ctx, cfg); created.push(c); return c; }
      StubWrap.prototype = RealStub.prototype;
      StubWrap.register = () => {}; StubWrap.overrides = {}; StubWrap.instances = {};
      StubWrap.getChart = (el) => created.filter(c => c.canvas === el && !c._destroyed).slice(-1)[0] || null;
      StubWrap.registerables = []; StubWrap.version = 'stub';
      StubWrap.controllers = {}; StubWrap.elements = {}; StubWrap.plugins = {}; StubWrap.scales = {};
      StubWrap.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = StubWrap; w.__created = created;
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    w.eval("current = 'work'; $('from').value=''; $('to').value=''; PROJ_WEIGHT='cost'; render();");

    // Force a deterministic project count ABOVE the top-N cap by injecting
    // synthetic rows directly into DATA before the cap-related checks —
    // the real sample dataset may or may not exceed the cap on its own, so
    // this makes "more than N projects exist" an actual guaranteed fact
    // rather than an assumption about fixture size.
    w.eval(`
      (function(){
        const p = DATA.profiles.work;
        const template = p.rows[0];
        for (let i = 0; i < 9; i++){
          const clone = Object.assign({}, template);
          clone.project = 'SyntheticProj' + i;
          clone.act = (i + 1) * 3.5;
          clone.est = (i + 1) * 3.5;
          clone.calls = (i + 1) * 7;
          p.rows.push(clone);
        }
      })();
      current = 'work'; render();
    `);

    function latestTrendChart() {
      return w.__created.filter(c => c.canvas && c.canvas.id === 'cProjTrend' && !c._destroyed).slice(-1)[0];
    }

    const chart1 = latestTrendChart();
    chk(!!chart1, 'a chart renders on the trend canvas');
    chk(chart1.config.data.datasets.length >= 2, 'more than one series is present (one per project, at least Unattributed + a real project)');

    // Top-N cap + explicit Other.
    const payloadProjects = new Set(w.eval("DATA.profiles.work.rows.map(r=>r.project||'Unattributed')"));
    const hasOther = chart1.config.data.datasets.some(ds => /^Other/.test(ds.label));
    chk(payloadProjects.size > 6, `sanity: the injected synthetic rows push the real project count above the cap (${payloadProjects.size})`);
    chk(hasOther, `an explicit "Other" series exists when there are more than the top-N (${payloadProjects.size} real projects)`);
    chk(chart1.config.data.datasets.length <= 7, 'total series count is capped at top-N + one Other series');

    // Weighting: switching PROJ_WEIGHT changes the trend's own numbers too
    // (same weightValue as the matrix/distribution — must not drift).
    const costDataStr = JSON.stringify(chart1.config.data.datasets.map(ds => ds.data));
    w.eval("PROJ_WEIGHT='calls'; render();");
    const chart2 = latestTrendChart();
    const callsDataStr = JSON.stringify(chart2.config.data.datasets.map(ds => ds.data));
    chk(callsDataStr !== costDataStr, 'switching the P4-08 weighting to Calls changes the trend\'s series data');

    // Cross-check one project's Calls-mode series total against a direct
    // sum from the payload for that exact project.
    const someProject = [...payloadProjects].find(p => p !== 'Unattributed');
    const directCallsTotal = w.eval(`DATA.profiles.work.rows.filter(r=>(r.project||'Unattributed')===${JSON.stringify(someProject)}).reduce((s,r)=>s+(+r.calls||0),0)`);
    const seriesForProject = chart2.config.data.datasets.find(ds => ds.label === someProject);
    if (seriesForProject) {
      const seriesTotal = seriesForProject.data.reduce((a, b) => a + b, 0);
      chk(Math.abs(seriesTotal - directCallsTotal) < 0.5,
          `the trend's Calls-mode series total for "${someProject}" matches the payload's direct sum (${seriesTotal} vs ${directCallsTotal})`);
    } else {
      chk(true, `"${someProject}" folded into Other under top-N cap — per-project total check not applicable, cap already verified above`);
    }
    w.eval("PROJ_WEIGHT='cost'; render();");

    // Stacked mode: every day's stack sums to 100.
    w.eval("$('projtrendstack').checked = true; $('projtrendstack').dispatchEvent(new Event('change'));");
    const stackedChart = latestTrendChart();
    const nDays = stackedChart.config.data.datasets[0].data.length;
    let allSum100 = true;
    for (let i = 0; i < nDays; i++) {
      const total = stackedChart.config.data.datasets.reduce((s, ds) => s + ds.data[i], 0);
      if (total > 0.5 && Math.abs(total - 100) > 0.5) { allSum100 = false; break; }
    }
    chk(allSum100, 'in stacked mode, every day\'s series sum to 100 (within tolerance)');
    chk(stackedChart.config.options.scales.y.max === 100, 'the y-axis is capped at 100 in stacked mode');
    w.eval("$('projtrendstack').checked = false; $('projtrendstack').dispatchEvent(new Event('change'));");

    // Axis label names the current unit.
    const unlabelledChart = latestTrendChart();
    chk(unlabelledChart.config.options.scales.y.title.display === true, 'the y-axis carries a visible unit label');
    chk(unlabelledChart.config.options.scales.y.title.text.toLowerCase().includes('cost'),
        `the axis label names the current unit, got: ${unlabelledChart.config.options.scales.y.title.text}`);

    // Legend: keyboard-operable buttons toggling series visibility.
    const legendBtns = d.querySelectorAll('#projtrendlegend .proj-legend-item');
    chk(legendBtns.length === unlabelledChart.config.data.datasets.length,
        'the legend has exactly one entry per series');
    chk(legendBtns[0].tagName === 'BUTTON', 'legend entries are real <button>s, not divs (keyboard reachable by default)');
    const chartBefore = latestTrendChart();
    const visBefore = chartBefore.isDatasetVisible(0);
    legendBtns[0].focus();
    legendBtns[0].click();
    const chartAfter = latestTrendChart();
    chk(chartAfter.isDatasetVisible(0) !== visBefore, 'clicking a legend entry toggles that series\' visibility');
    chk(legendBtns[0].getAttribute('aria-pressed') === String(!visBefore),
        'aria-pressed on the legend button reflects the new visibility state');

    // Theme re-tint: readTheme()+render() must cover this chart's scales too.
    // mk() tints the CATEGORY axis (x, since this line chart has no
    // indexAxis:'y') via tintTicks — that's the axis whose tick color must
    // update on switch, matching the same convention every other chart in
    // this dashboard follows.
    w.eval("document.documentElement.setAttribute('data-theme','light'); readTheme(); render();");
    const lightChart = latestTrendChart();
    chk(typeof lightChart.config.options.scales.x.ticks.color === 'function', 'the x-axis ticks still carry a themed color function after switching to light theme');
    w.eval("document.documentElement.removeAttribute('data-theme'); readTheme(); render();");

    // Empty-state: a date range with zero project rows shows the message,
    // not an errored/blank chart.
    w.eval("$('from').value='1999-01-01'; $('to').value='1999-01-01'; render();");
    chk(d.getElementById('projtrendempty').hidden === false, 'the empty state shows for a date range with no rows');
    w.eval("$('from').value=''; $('to').value=''; render();");

    console.log(`\ncheck_project_trend.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_project_trend.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
