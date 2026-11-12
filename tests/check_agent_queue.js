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
    const cars = () => [...d.querySelectorAll('#qt-running .qt-ball:not(.qt-leaving)')];
    const kcount = k => cars().filter(c => c.dataset.kind === k).length;
    const kpi = () => d.querySelector('#livekpis [data-kpi="sessions"] .stat-sub');
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
    chk(!!claudeCar && /var\(--kind-claude\)/.test(claudeCar.style.getPropertyValue('--k')) && /Claude agent/.test(claudeCar.getAttribute('aria-label')), 'ball has the Claude colour and names the agent in its aria-label');
    chk(claudeCar._qt && claudeCar._qt.idle_s === 12, 'duplicate keeps the freshest session', claudeCar._qt && claudeCar._qt.idle_s);
    chk(/Claude/.test(w.eval(`carTip(document.querySelector('[data-key="claude:c-1"]')._qt)`)), 'tooltip names the engine');

    // Same cars survive another poll (no re-create => no re-animation).
    w.eval('renderQueue();');
    chk(cars().find(c => c.dataset.key === 'claude:c-1') === claudeCar, 'car node reused across polls');

    // KPI
    w.eval('renderLive();');
    const hermesN = base.hermes;
    const total = Number(d.querySelector('#livekpis [data-kpi="sessions"] .stat-value').textContent);
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
    // Claude/Codex lead with their brand mark; PI/Hermes lead with the family
    // marble (LST-262 icons sweep: profileIconHtml's initial-letter icon in the
    // profile hue — the bare .kpi-dot is gone).
    const isLogo = e => e.dataset.kind === 'claude' || e.dataset.kind === 'codex';
    const marble = e => e.querySelector('[data-profile-icon-fallback]');
    chk(chipEls.filter(e => !isLogo(e)).every(marble), 'PI/Hermes chips lead with the family marble');
    chk(chipEls.filter(e => !isLogo(e)).every(e => marble(e).textContent === (e.dataset.kind === 'pi' ? 'P' : 'H')),
        'the marble shows the family initial');
    chk(chipEls.filter(e => !isLogo(e)).every(e => /background:hsl\(/.test(marble(e).getAttribute('style'))),
        'the marble is coloured from the profile hue');
    chk(chipEls.filter(e => !isLogo(e)).every(e => marble(e).getAttribute('aria-hidden') === 'true'),
        'the marble is decorative (aria-hidden)');
    chk(chipEls.filter(isLogo).every(e => !marble(e)), 'Claude/Codex chips swap the dot/marble for the brand mark');
    // Real brand marks: an inline svg with path data, only on claude/codex.
    const logoOf = el => el && el.querySelector('svg[data-kindlogo] path[d]');
    ['claude', 'codex'].forEach(k => {
      const chipEl = chipEls.find(e => e.dataset.kind === k);
      const svg = chipEl && chipEl.querySelector('svg[data-kindlogo]');
      chk(!!logoOf(chipEl) && svg.getAttribute('data-kindlogo') === k, `${k} KPI chip carries its brand logo`);
      chk(!!svg && svg.getAttribute('viewBox') === '0 0 24 24' && svg.getAttribute('fill') === 'currentColor' && svg.getAttribute('aria-hidden') === 'true', `${k} logo markup (viewBox, currentColor, aria-hidden)`);
      chk(!!chipEl && chipEl.getAttribute('title') === (k === 'claude' ? '2 Claude' : '1 Codex'), `${k} chip title unchanged`, chipEl && chipEl.getAttribute('title'));
    });
    chk(['pi', 'hermes'].every(k => { const e = chipEls.find(x => x.dataset.kind === k); return e && !e.querySelector('svg[data-kindlogo]'); }), 'PI/Hermes chips have no brand logo');
    chk(/2\s*Claude/.test(kpi().textContent) && /1\s*Codex/.test(kpi().textContent), 'KPI text still says "N Claude" / "N Codex"');
    const words = /Claude/.test(kpi().textContent) && /Codex/.test(kpi().textContent) && /PI/.test(kpi().textContent) && /Hermes/.test(kpi().textContent);
    chk(words, 'all four kind names readable in the KPI', kpi().textContent.trim());
    // Balls carry no badge: the agent family is the ball colour, named in the aria-label.
    const badgeCar = k => cars().find(c => c.dataset.kind === k);
    ['claude', 'codex', 'pi'].forEach(k => {
      const car = badgeCar(k);
      chk(!!car && new RegExp(k === 'codex' ? 'Codex' : k === 'claude' ? 'Claude' : 'PI agent').test(car.getAttribute('aria-label') || ''), `${k} ball aria-label names the kind`, car && car.getAttribute('aria-label'));
      chk(!!car && car.style.getPropertyValue('--k') === `var(--kind-${k})`, `${k} ball takes its kind colour`);
      chk(!!car && car.classList.contains('qt-run'), `${k} ball is a running clip`);
    });
    const her = badgeCar('hermes');
    chk(!!her && !!her.querySelector('.qt-gl svg') && /^hsl\(/.test(her.style.getPropertyValue('--k')), 'Hermes ball shows a provider svg, in the profile colour', her && her.style.getPropertyValue('--k'));
    // Live rows and the provider badges reuse the same shared logos.
    w.eval('renderLive();');
    const rowBadge = k => d.querySelector(`#livelist [data-kindbadge="${k}"]`);
    chk(!!logoOf(rowBadge('claude')) && !!logoOf(rowBadge('codex')), 'live rows carry claude and codex logos');
    chk(!!rowBadge('pi') && !rowBadge('pi').querySelector('svg'), 'PI live row keeps its glyph');
    chk(new Set([...d.querySelectorAll('svg[data-kindlogo="claude"] path')].map(p => p.getAttribute('d'))).size === 1, 'every Claude logo uses the one shared path');
    // Legibility: 12px logos read as blobs. Chips and live rows must render >= 15px.
    const logoPx = svg => parseFloat(w.getComputedStyle(svg).width);
    const sized = [['KPI chip', chipEls.filter(isLogo).map(e => e.querySelector('svg[data-kindlogo]'))],
      ['live row', ['claude', 'codex'].map(k => rowBadge(k).querySelector('svg[data-kindlogo]'))]];
    sized.forEach(([what, svgs]) => chk(svgs.length === 2 && svgs.every(sv => logoPx(sv) >= 15 && parseFloat(w.getComputedStyle(sv).height) >= 15), `${what} logos render >= 15px`, svgs.map(logoPx).join(',')));
    chk(/sessions/i.test(d.querySelector('#livekpis [data-kpi="sessions"]').textContent)
      && Number(d.querySelector('#livekpis [data-kpi="sessions"] .stat-value').textContent) === hermesN + 4, 'sessions-in-flight tile agrees');

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
