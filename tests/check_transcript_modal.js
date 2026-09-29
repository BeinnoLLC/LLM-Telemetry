// #79/P9-02: live-row title -> read-only transcript modal.
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

// ---- source-level checks --------------------------------------------------
chk(/<button type="button" class="ttitlebtn/.test(html),
    'the live-row title is a real <button>, not a clickable <div>/<span>');
chk(/aria-modal="true" aria-label="Session transcript"/.test(html),
    'the modal advertises itself to assistive tech as a real dialog');
chk(/rel="noopener noreferrer"/.test(html),
    'links rendered inside a transcript carry rel="noopener noreferrer"');
chk(/target="_blank"/.test(html),
    'links open in a new tab, never navigating the dashboard itself away');
chk(/function tKeydown\(e\)\{\s*\n\s*if \(e\.key === 'Escape'/.test(html),
    'Escape closes the modal');
chk(/tFocusReturn\?\.focus\?\.\(\)/.test(html),
    'focus returns to the trigger element on close');
chk(/if \(e\.key === 'Tab'\)\{/.test(html),
    'Tab is intercepted for a focus trap while the modal is open');
chk(/onerror=\\?"this\.classList\.add\(\\?'tbroken\\?'\)/.test(html),
    'a broken data:image degrades to a placeholder via onerror, not a thrown JS error');
chk(!/<textarea[^>]*id="t/.test(html) && !/id="tbody"[^>]*contenteditable/.test(html),
    'no textarea/contenteditable exists anywhere in the transcript modal markup');

// ---- behavioural checks via jsdom -----------------------------------------
function boot() {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) {
        this.config = cfg; this.data = (cfg && cfg.data) || {}; this.destroy = () => {};
        this.update = () => {}; this.options = (cfg && cfg.options) || {};
        this.scales = {}; this._metasets = []; this.chartArea = {left:0,top:0,right:0,bottom:0};
        this.width = 300; this.height = 150; this.aspectRatio = 2; this.attached = false;
        this.getDatasetMeta = () => ({ data: [], controller: null });
      }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {};
      Stub.getChart = () => null; Stub.registerables = []; Stub.version = 'stub';
      Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub; w.getChart = () => null;
      const backing = new Map();
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null, get length(){ return backing.size; } },
        configurable: true, writable: true });
      // Stub fetch so tOpenModal's transcripts.json call resolves deterministically
      // with content designed to exercise every security-relevant rendering path.
      w.fetch = (url) => {
        if (String(url).includes('transcripts.json')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              profiles: {
                default: {
                  sess1: [
                    { id: 1, role: 'user', content: 'Look at <script>alert(1)</script> and <img src=x onerror=alert(2)>', ts: 1000 },
                    { id: 2, role: 'assistant', content: 'See https://example.com/report and\n```\nconst x = 1;\n```', ts: 1001 },
                    { id: 3, role: 'tool', content: '', tool_name: 'grep', ts: 1002 },
                  ],
                },
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      };
    },
  });
}

const dom = boot();
setTimeout(async () => {
  const w = dom.window, d = w.document;
  try {
    // Zero inputs/textareas/contenteditable anywhere in the modal, always —
    // not just before open, the ticket's own acceptance criterion.
    const modal = d.getElementById('tmodal');
    chk(!!modal, '#tmodal exists in the DOM');
    chk(modal.querySelectorAll('input,textarea,[contenteditable]').length === 0,
        'zero input/textarea/contenteditable nodes exist inside the modal');

    // Simulate opening via a synthetic title button (mirrors what a real
    // live row renders: data-tsession/data-tprofile attributes + text).
    await w.tOpenModal('sess1', 'default', 'Test session');
    chk(w.document.getElementById('tmodal').classList.contains('open'),
        'tOpenModal() actually opens the modal (adds .open)');

    const body = d.getElementById('tbody');
    chk(body.querySelectorAll('script').length === 0,
        'a message containing a literal <script> tag never becomes a real <script> element');
    chk(body.innerHTML.includes('&lt;script&gt;alert(1)&lt;/script&gt;') || !body.innerHTML.includes('<script>alert(1)</script>'),
        'the <script> text renders as literal escaped text, not live markup', body.innerHTML.slice(0, 200));
    chk(!body.querySelector('img:not(.timg)') && [...body.querySelectorAll('*')].every(el => !el.hasAttribute('onerror') || el.classList.contains('timg')),
        'an onerror= attribute in the source content never becomes a real onerror handler on an untrusted element (only our own trusted timg fallback carries one)');

    const link = body.querySelector('a[href="https://example.com/report"]');
    chk(!!link, 'a bare http(s) link in message content becomes a real, clickable <a>');
    chk(link && link.getAttribute('target') === '_blank' && link.getAttribute('rel') === 'noopener noreferrer',
        'that link opens in a new tab with rel="noopener noreferrer"');

    const pre = body.querySelector('pre');
    chk(!!pre && pre.textContent.includes('const x = 1;'),
        'a fenced code block renders inside a <pre> (monospaced, whitespace-preserving)');

    const toolMsg = [...body.querySelectorAll('.tmsg')].find(m => m.className.includes('role-tool'));
    chk(!!toolMsg && toolMsg.textContent.includes('grep'),
        'a tool message with empty content but a tool_name renders something (not a blank bubble)');

    const roles = [...body.querySelectorAll('.tmsg')].map(m =>
      ['user','assistant','tool'].find(r => m.className.includes('role-' + r)));
    chk(roles.length === 3 && new Set(roles).size === 3,
        'all three roles (user/assistant/tool) get visually distinct classes', roles.join(','));

    // Esc closes and returns focus.
    const btn = d.createElement('button');
    d.body.appendChild(btn); btn.focus();
    w.tFocusReturn = btn;
    w.tOpen = true;
    d.getElementById('tmodal').classList.add('open');
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    chk(!d.getElementById('tmodal').classList.contains('open'), 'Escape closes the modal');
    chk(d.activeElement === btn, 'focus returns to the element that opened the modal');
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }
  console.log(`\ncheck_transcript_modal.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
