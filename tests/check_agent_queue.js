// Claude / Codex (agent-worker) and Pi sessions ride the "In progress" KPI and
// the queue train as cars, next to Hermes. Real built page, DATA injected.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(REPORTS, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

const AGENTS = [
  { engine: 'claude', session_id: 'c-1', title: 'alpha', model: 'claude-opus-4-5', idle_s: 12, phase: 'running Bash' },
  { engine: 'claude', session_id: 'c-1', title: 'alpha', model: 'claude-opus-4-5', idle_s: 40, phase: 'running Bash' }, // dup, staler
  { engine: 'claude', session_id: 'c-2', title: 'gamma', model: 'claude-opus-4-5', idle_s: 20, phase: 'thinking' },
  { engine: 'codex', session_id: 'x-1', title: 'beta', model: 'gpt-5', idle_s: 30, phase: 'editing' },
  { engine: 'codex', session_id: 'x-idle', title: 'asleep', model: 'gpt-5', idle_s: 300, phase: 'idle' },
];
const PI = [
  { agent: 'a', session_id: 'p-1', title: 'pi-one', model: 'sage', idle_s: 5, phase: 'running bash' },
  { agent: 'a', session_id: 'p-idle', title: 'pi-idle', model: 'sage', idle_s: 500, phase: 'idle' },
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:8477/dashboard.html',
  beforeParse(w) {
    w.Chart = function () { return { destroy() {}, update() {} }; };
    w.Chart.defaults = { color: '', borderColor: '', font: {} };
    w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    w.fetch = (u) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(u).includes('live-data') ? live : analytics),
    });
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const cars = () => [...d.querySelectorAll('#qt-running .qt-consist .qt-car:not(.qt-leaving)')];
    const kcount = k => cars().filter(c => c.dataset.kind === k).length;
    const kpi = () => d.querySelector('#kpis .kpi-live');
    const chip = k => { const e = kpi().querySelector(`.kpi-kind[data-kind="${k}"]`); return e ? parseInt(e.textContent.replace(/\D+/g, ''), 10) : 0; };

    w.eval('DATA.agent_live = []; DATA.pi_live = []; renderQueue();');
    const base = { cars: cars().length, hermes: kcount('hermes') };
    w.eval(`DATA.agent_live = ${JSON.stringify(AGENTS)}; DATA.pi_live = ${JSON.stringify(PI)}; renderQueue();`);

    chk(base.hermes === base.cars && base.cars > 0, 'baseline: only Hermes cars', JSON.stringify(base));
    chk(kcount('claude') === 2, 'one car per Claude session (dup collapsed)', kcount('claude'));
    chk(kcount('codex') === 1, 'one car per non-idle Codex session', kcount('codex'));
    chk(kcount('pi') === 1, 'one car per non-idle Pi session', kcount('pi'));
    chk(kcount('hermes') === base.hermes, 'Hermes cars unchanged', kcount('hermes'));
    chk(cars().length === base.cars + 4, 'train = Hermes + 4 agent cars', cars().length);
    const keys = cars().map(c => c.dataset.key);
    chk(new Set(keys).size === keys.length, 'car keys are unique');
    chk(['claude:c-1', 'claude:c-2', 'codex:x-1', 'pi:p-1'].every(k => keys.includes(k)), 'keys are <kind>:<session id>', keys.join(','));
    const claudeCar = cars().find(c => c.dataset.key === 'claude:c-1');
    chk(!!claudeCar && claudeCar.querySelector('.qt-kb') && /var\(--kind-claude\)/.test(claudeCar.style.getPropertyValue('--k')), 'car has kind badge and kind tint');
    chk(claudeCar._qt && claudeCar._qt.idle_s === 12, 'duplicate keeps the freshest session', claudeCar._qt && claudeCar._qt.idle_s);
    chk(/Claude/.test(w.eval(`carTip(document.querySelector('[data-key="claude:c-1"]')._qt)`)), 'tooltip names the engine');

    // Same cars survive another poll (no re-create => no re-animation).
    w.eval('renderQueue();');
    chk(cars().find(c => c.dataset.key === 'claude:c-1') === claudeCar, 'car node reused across polls');

    // KPI
    w.eval('renderLive();');
    w.eval(`document.querySelector('#kpis .kpi-live').innerHTML = inProgressHtml(DATA.profiles[current], DATA.pi_live, DATA.agent_live);`);
    const hermesN = base.hermes;
    const total = parseInt([...kpi().childNodes].find(n => n.nodeType === 3).textContent, 10);
    chk(total === hermesN + 4, 'KPI total = Hermes + Pi + Claude + Codex', `${total} vs ${hermesN + 4}`);
    chk(chip('claude') === 2 && chip('codex') === 1 && chip('pi') === 1 && chip('hermes') === hermesN, 'KPI per-kind chips',
      ['claude', 'codex', 'pi', 'hermes'].map(chip).join('/'));
    // Labelled chips: readable label "N Claude" etc., kind-coloured dot, KIND_ORDER, no zero kinds.
    const chipEls = [...kpi().querySelectorAll('.kpi-kind')];
    const chipText = e => e.textContent.replace(/\s+/g, ' ').trim();
    const wantOrder = ['hermes', 'pi', 'claude', 'codex'].filter(k => chip(k));
    chk(chipEls.map(e => e.dataset.kind).join(',') === wantOrder.join(','), 'chips follow KIND_ORDER, zero kinds omitted', chipEls.map(e => e.dataset.kind).join(','));
    chk(/2\s*Claude/.test(kpi().textContent) && /1\s*Codex/.test(kpi().textContent), 'KPI chips have labelled text with counts', kpi().textContent.trim());
    chk(chipText(chipEls[0]).match(/\d+ (Hermes|Pi)/), 'first chip is the lowest KIND_ORDER kind with words', chipText(chipEls[0]));
    chk(chipEls.every(e => e.querySelector('.kpi-dot')), 'every chip has a kind-coloured dot');
    chk(chipEls.every(e => e.querySelector('.kpi-dot').style.background === `var(--kind-${e.dataset.kind})`), 'dot colour follows the --kind-* token');
    const words = /Claude/.test(kpi().textContent) && /Codex/.test(kpi().textContent) && /PI/.test(kpi().textContent) && /Hermes/.test(kpi().textContent);
    chk(words, 'all four kind names readable in the KPI', kpi().textContent.trim());
    // Car badges: same kindMeta glyph, kind still named for a11y; Hermes cars stay plain.
    const badgeCar = k => cars().find(c => c.dataset.kind === k);
    ['claude', 'codex', 'pi'].forEach(k => {
      const car = badgeCar(k);
      const kb = car && car.querySelector('.qt-kb');
      chk(!!kb && kb.textContent.length > 0, `${k} car carries a kind badge`);
      chk(!!car && new RegExp(k === 'codex' ? 'Codex' : k === 'claude' ? 'Claude' : 'PI agent').test(car.getAttribute('aria-label') || ''), `${k} car aria-label names the kind`, car && car.getAttribute('aria-label'));
      chk(!!car && /var\(--kind-/.test(car.style.getPropertyValue('--k') || ''), `${k} car keeps its kind tint`);
    });
    const her = badgeCar('hermes');
    chk(!!her && !her.querySelector('.qt-kb'), 'Hermes car has no kind badge');
    chk(/sessions/i.test(d.querySelector('#livekpis [data-kpi="sessions"]').textContent)
      && Number(d.querySelector('#livekpis [data-kpi="sessions"] .lkpi-num').textContent) === hermesN + 4, 'sessions-in-flight tile agrees');

    // Fleet-wide: independent of the selected profile.
    const other = w.eval(`Object.keys(DATA.profiles).find(n => n !== current)`);
    if (other) {
      w.eval(`current = ${JSON.stringify(other)}; renderQueue();`);
      chk(kcount('claude') === 2 && kcount('codex') === 1 && kcount('pi') === 1, 'agent cars show under another profile', other);
    }
  } catch (e) { fail++; console.log('  FAIL exception — ' + e.stack); }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'}  (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
}, 1500);
