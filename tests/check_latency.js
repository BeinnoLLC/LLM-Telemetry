// #93/P10-05: Latency panel (Usage view) — p50/p90/p99 per model and per
// endpoint, idle excluded, slowest turns list.
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
    chk(/id="latcard" hidden>/.test(html), 'the latency card starts hidden');

    w.eval("current = 'work'; view = 'Usage'; render();");
    const card = d.getElementById('latcard');
    chk(card && card.hidden === false, 'the card is shown for the sample profile with latency data');

    const byModelText = d.getElementById('latbymodel').textContent;
    chk(byModelText.includes('claude-opus'), 'the by-model section names claude-opus');
    chk(byModelText.includes('n=4210'), 'the sample size n is rendered next to the percentiles (not hidden)');
    chk(byModelText.includes('1.8s'), 'the p50 value renders with a seconds unit');

    // n=3 tiny sample renders its own honest n, not hidden or averaged away.
    chk(byModelText.includes('n=3'), 'a tiny sample (deepseek-v4.1-flash, n=3) still renders its own n, not silently merged');

    // tok_s: null renders as nothing, not "null" or "NaN tok/s".
    const byModelHTML = d.getElementById('latbymodel').innerHTML;
    chk(!/null tok\/s|NaN tok\/s/.test(byModelHTML),
        'a null tok_s never renders as the literal string "null tok/s" or "NaN tok/s"');

    const byEndpointText = d.getElementById('latbyendpoint').textContent;
    chk(byEndpointText.includes('anthropic'), 'the by-endpoint section shows the anthropic endpoint');
    chk(byEndpointText.includes('gpu-01'), 'the by-endpoint section shows the LAN endpoint (comparable to the cloud one)');

    // Sort order: both sections sorted by p90 descending.
    const modelOrder = [...d.querySelectorAll('#latbymodel > div > span.font-semibold')].map(s => s.textContent);
    chk(modelOrder[0] === 'qwen3-coder:30b',
        'the by-model list is sorted by p90 descending (the slowest model first)', modelOrder);

    const slowestText = d.getElementById('latslowest').textContent;
    chk(slowestText.includes('187.4'), 'the slowest-turns list shows the actual slowest duration');
    const slowBtn = d.querySelector('#latslowest button[data-tsession]');
    chk(!!slowBtn && slowBtn.tagName === 'BUTTON' && slowBtn.getAttribute('type') === 'button',
        'each slowest-turn entry is a real <button type="button"> (reuses the transcript-modal click wiring, not a new listener)');
    chk(slowBtn.getAttribute('data-tsession') === 'sess_sample_slow1',
        'the slowest-turn button carries the real session id for the transcript modal');

    // Hide condition: empty by_model hides the card entirely.
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.latency = {by_model:{}, by_endpoint:{}, slowest:[]};
      render();
    `);
    chk(d.getElementById('latcard').hidden === true, 'the card hides entirely when by_model is empty');

    console.log(`\ncheck_latency.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_latency.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
