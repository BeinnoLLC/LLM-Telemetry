// LLMTELEMET-344: closing the session timeline modal (#lnmodal) must not throw.
// lnCloseModal calls lnTipHide, which was missing from order.json and so absent
// from the built page: the close threw before lnTrap.release(), leaving the focus
// trap active and focus off the opener. Run against the BUILT page.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports'), 'dashboard.html'), 'utf8');
const timeline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'reports', 'sessions', 'work', 'sess_sample_slow1.json'), 'utf8'));

let pass = 0, fail = 0;
const chk = (ok, name, got) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`); };

function boot() {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://127.0.0.1:8477/dashboard.html', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
      const b = new Map();
      Object.defineProperty(w, 'localStorage', { configurable: true, writable: true, value: {
        getItem: k => b.get(k) ?? null, setItem: (k, v) => b.set(k, String(v)), removeItem: k => b.delete(k),
        clear: () => b.clear(), key: i => [...b.keys()][i] ?? null, get length() { return b.size; } } });
      w.fetch = async u => String(u).includes('sess_sample_slow1.json')
        ? { ok: true, status: 200, json: async () => timeline } : { ok: false, status: 404, json: async () => ({}) };
      w.addEventListener('error', e => errors.push(e.message || String(e.error)));
    },
  });
  return { dom, errors };
}

async function scenario(label, closer) {
  const { dom, errors } = boot();
  await new Promise(r => setTimeout(r, 1500));
  const w = dom.window, d = w.document;
  const base = errors.length;
  const opener = d.createElement('button');
  opener.id = 'lnopener'; opener.textContent = 'Timeline';
  d.body.appendChild(opener); opener.focus();
  await w.eval("lnOpenModal('sess_sample_slow1', 'work', 'Migrate billing')");
  await new Promise(r => setTimeout(r, 50));
  chk(d.getElementById('lnmodal').classList.contains('open'), `${label}: modal opens`);
  chk(w.eval('lnTrap') !== null, `${label}: focus trap is active while open`);
  try { closer(w, d); } catch (e) { errors.push(e.message); }
  await new Promise(r => setTimeout(r, 20));
  chk(errors.length === base, `${label}: no page error on close`, errors.slice(base).join(' | '));
  chk(!d.getElementById('lnmodal').classList.contains('open'), `${label}: modal is closed`);
  chk(w.eval('lnTrap') === null, `${label}: focus trap released`);
  chk(d.getElementById('lnmodal').getAttribute('aria-hidden') === 'true', `${label}: aria-hidden restored`);
  chk(d.activeElement === opener, `${label}: focus returned to the opener`, d.activeElement && d.activeElement.id);
  dom.window.close();
}

(async () => {
  chk(/function lnTipHide\b/.test(html), 'the built page defines lnTipHide');
  await scenario('lnCloseModal()', w => w.eval('lnCloseModal()'));
  await scenario('Esc', (w, d) => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  console.log(`\ncheck_lnmodal_close.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
