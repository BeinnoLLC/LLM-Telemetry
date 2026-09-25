// Reports dir: env override so the suite runs on any machine.
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(require('os').homedir(), '.local/share/llm-telemetry/reports');
// Prove a model keeps ONE colour across every profile, tab and date range.
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync(REPORTS+'/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

// Record every (label, colour) pair Chart.js is handed.
const seen = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function (el, cfg) {
      const id = el && el.id;
      const labels = (cfg.data && cfg.data.labels) || [];
      (cfg.data.datasets || []).forEach(ds => {
        const bg = ds.backgroundColor;
        if (Array.isArray(bg)) {
          labels.forEach((L, i) => seen.push({ chart: id, label: String(L), color: bg[i] }));
        }
      });
      return { destroy() {}, update() {} };
    };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    const live = JSON.parse(
      fs.readFileSync(REPORTS+'/live-data.json', 'utf8'));
    w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
  },
});

const w = dom.window, d = w.document;
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};
const strip = s => String(s).replace(/^[^\w]*\s*/, '').trim();

setTimeout(() => {
  const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const profiles = [...d.querySelectorAll('#tabs button')];
  const views = [...d.querySelectorAll('#views button')];

  console.log('== sweeping every profile x view ==');
  for (const p of profiles) {
    click(p);
    for (const v of views) click(v);
  }
  // And a narrowed date range, which is what used to shift the palette.
  const from = d.getElementById('from'), to = d.getElementById('to');
  const lo = from.value;
  from.value = to.value;             // single-day range
  from.dispatchEvent(new w.Event('change'));
  for (const v of views) click(v);
  from.value = lo;
  from.dispatchEvent(new w.Event('change'));

  console.log(`  collected ${seen.length} (label, colour) pairs from ` +
              `${new Set(seen.map(s => s.chart)).size} charts`);

  console.log('\n== one colour per model ==');
  const byModel = {};
  for (const s of seen) {
    if (!s.color || typeof s.color !== 'string') continue;
    if (!s.color.startsWith('hsl')) continue;     // provider charts use PROV, skip
    const m = strip(s.label);
    (byModel[m] ||= new Set()).add(s.color);
  }
  const models = Object.keys(byModel).sort();
  chk(models.length > 0, 'models charted', `(${models.length})`);
  const clashes = models.filter(m => byModel[m].size > 1);
  chk(clashes.length === 0, 'every model has exactly one colour');
  for (const m of clashes) {
    console.log(`     ${m}: ${[...byModel[m]].join('  ')}`);
  }

  console.log('\n== colours are distinct between models ==');
  const rev = {};
  models.forEach(m => { const c = [...byModel[m]][0]; (rev[c] ||= []).push(m); });
  const dupes = Object.entries(rev).filter(([, ms]) => ms.length > 1);
  chk(dupes.length === 0, 'no two models share a colour');
  for (const [c, ms] of dupes) console.log(`     ${c}: ${ms.join(', ')}`);

  console.log('\n== family hues are consistent ==');
  // Families now FAN across a hue band, so assert the band, not one exact hue.
  const fam = { claude:[17,46], glm:[320,46], kimi:[320,46],
                deepseek:[262,60], qwen:[196,53], 'gpt-oss':[196,53] };
  let famOk = true;
  for (const m of models) {
    const key = Object.keys(fam).find(k => m.toLowerCase().includes(k));
    if (!key) continue;
    const hue = parseInt([...byModel[m]][0].match(/hsl\((\d+)/)[1], 10);
    const [base, half] = fam[key];
    const d = Math.min(Math.abs(hue-base), 360-Math.abs(hue-base));
    if (d > half) {
      famOk = false;
      console.log(`     ${m}: hue ${hue}, outside ${base}+-${half} for ${key}`);
    }
  }
  chk(famOk, 'each model sits in its family hue');

  console.log('\n== sample ==');
  models.slice(0, 10).forEach(m =>
    console.log(`  ${m.padEnd(30)} ${[...byModel[m]][0]}`));

  console.log('\n== est. cost pulse ==');
  const cp = d.querySelector('.costpulse');
  chk(!!cp, 'cost value is wrapped for pulsing');
  chk(html.includes('@keyframes cost-pulse'), 'pulse keyframe defined');
  chk(/\.costpulse\{animation:cost-pulse/.test(html), 'pulse applied');

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}, 1500);
