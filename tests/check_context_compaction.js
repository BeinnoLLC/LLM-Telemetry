// #97/P10-09: context & compaction — growth, yield, reasoning share (Detail view).
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

function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    chk(/id="ctxcard"/.test(html), 'the context & compaction card markup exists');

    w.eval("current = 'work'; view = 'Detail'; render();");
    const card = d.getElementById('ctxcard');
    chk(card && card.hidden === false, 'the card is shown for the sample profile with context data');

    const sessionsHtml = d.getElementById('ctxsessions').innerHTML;
    chk(sessionsHtml.includes('sess_ctxdemo1'), 'the compacting session appears in the per-session list');
    chk(sessionsHtml.includes('sess_sample_slow1'), 'the non-compacting session appears too');

    // sess_ctxdemo1: 2 compactions, 1 ineffective -> two dashed markers in its sparkline SVG.
    const svgs = [...d.querySelectorAll('#ctxsessions svg')];
    chk(svgs.length === 2, 'two sparklines render, one per session', svgs.length);
    const demoSvg = svgs[0];
    const lines = demoSvg.querySelectorAll('line');
    chk(lines.length === 2, 'the compacting session\'s sparkline has exactly 2 compaction markers (two dashed lines)', lines.length);
    const colors = [...lines].map(l => l.getAttribute('stroke'));
    chk(colors.includes('#22c55e') && colors.includes('#ef4444'),
        'one marker is colored effective (green), the other ineffective (red)', colors);

    chk(sessionsHtml.includes('2 compactions'), 'the compacting session shows its real compaction count');
    chk(sessionsHtml.includes('1 ineffective'), 'the compacting session flags exactly 1 ineffective compaction');
    chk(sessionsHtml.includes('0 compactions'), 'the non-compacting session shows 0 compactions');

    // ---- the ticket's own negative control: no compactions -> markers absent ----
    const slowSvg = svgs[1];
    chk(slowSvg.querySelectorAll('line').length === 0,
        'the non-compacting session\'s sparkline has ZERO compaction markers (the ticket\'s own negative control)');
    const slowRowHtml = sessionsHtml.split('sess_sample_slow1')[1] || '';
    chk(!/ineffective/.test(slowRowHtml.split('</div>')[0] + slowRowHtml.slice(0, 400)) || !slowRowHtml.includes('ineffective</span>'),
        'the non-compacting session shows no ineffective-count chip at all');

    const reasoningText = d.getElementById('ctxreasoning').textContent;
    chk(reasoningText.includes('deepseek-r1') && reasoningText.includes('68.3%'),
        'reasoning-by-model shows the real share percentage (41000/60000 = 68.3%)');

    const cooldownText = d.getElementById('ctxcooldowns').textContent;
    chk(cooldownText.includes('Billing migration retry loop') && cooldownText.includes('RateLimitError'),
        'the live cooldown shows the real session title and truncated error head');

    // ---- negative control: an entirely empty context payload hides the card ----
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.context = {sessions: [], reasoning_by_model: [], cooldowns: []};
      render();
    `);
    chk(d.getElementById('ctxcard').hidden === true,
        'an entirely empty context payload hides the card entirely');

    console.log(`\ncheck_context_compaction.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_context_compaction.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
