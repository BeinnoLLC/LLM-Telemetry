// #92/P10-04: Tool reliability panel — per-tool fail rate, trend, wasted
// tokens, and top failing terminal commands.
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
    chk(/id="toolcard" hidden>/.test(html), 'the tool-reliability card starts hidden');

    w.eval("current = 'work'; renderHealth();");
    const card = d.getElementById('toolcard');
    chk(card && card.hidden === false, 'the card is shown for the sample profile with tool data');

    const rowsText = d.getElementById('toolrows').textContent;
    chk(rowsText.includes('terminal'), 'the terminal tool row is rendered');
    chk(rowsText.includes('9.2%'), 'terminal fail rate renders as a percentage (9.2%)');

    const rowsHTML = d.getElementById('toolrows').innerHTML;
    chk(rowsHTML.includes('no confident calls'),
        'the memory tool (fail_rate=null, all-unknown) renders "no confident calls" instead of 0%');
    chk(!/memory[^<]*0\.0%/.test(rowsHTML.replace(/\s+/g,' ')),
        'the memory row never reads literally "0.0%" (that would misreport zero-confidence as verified-clean)');

    // Trend arrow: terminal's fail_rate 0.0922 > prev_fail_rate 0.061 -> up/red.
    // patch's fail_rate 0.0577 < prev_fail_rate 0.0812 -> down/green.
    chk(/\u2191/.test(rowsHTML), 'an up-trend arrow renders for a tool whose fail rate increased');
    chk(/\u2193/.test(rowsHTML), 'a down-trend arrow renders for a tool whose fail rate decreased');

    // Sort order is by tok_wasted in the fixture: terminal(91500) > patch(12400)
    // > read_file(900) > write_file(300) > memory(0).
    const order = [...d.querySelectorAll('#toolrows > div > span.font-semibold')].map(s => s.textContent);
    chk(order[0] === 'terminal' && order[order.length - 1] === 'memory',
        'rows render in the same cost-of-failures order the payload already carries', order);

    const cmdsText = d.getElementById('toolcmds').textContent;
    chk(cmdsText.includes('pnpm') && cmdsText.includes('14'), 'the top failing command (pnpm, 14) renders');
    chk(cmdsText.includes('(unknown)'), 'the (unknown)-command bucket renders rather than being dropped');

    // Hide condition: empty tools list hides the card entirely.
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.tools = [];
      DATA.profiles.personal.terminal_top_fail_commands = [];
      renderHealth();
    `);
    chk(d.getElementById('toolcard').hidden === true, 'the card hides entirely when the tools list is empty');

    // Untrusted content is escaped, not injected raw — tool names come
    // straight from a DB column an agent's own tool call populated.
    w.eval(`
      DATA.profiles.personal.tools = [{name:'<img src=x onerror=alert(1)>', calls:5, fails:1, fail_rate:0.2, prev_fail_rate:null, tok_wasted:10}];
      DATA.profiles.personal.terminal_top_fail_commands = [];
      renderHealth();
    `);
    chk(d.querySelectorAll('#toolrows img').length === 0,
        'a tool name containing an img/onerror payload is HTML-escaped, not rendered as a live element');
    chk(d.getElementById('toolrows').textContent.includes('<img'),
        'the escaped tool name still shows its literal text so the anomaly is visible, not silently dropped');

    console.log(`\ncheck_tool_reliability.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_tool_reliability.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
