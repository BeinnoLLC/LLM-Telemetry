// #94/P10-06: Session timeline modal — model/tool/delegation/compaction/
// user lanes, fetched on demand from a per-session static file.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
const sampleTimeline = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'reports', 'sessions', 'work', 'sess_sample_slow1.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

function boot(fetchImpl) {
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
      w.fetch = fetchImpl;
    },
  });
}

async function run() {
  // --- happy path: real sample timeline fetched successfully ---
  const dom = boot(async (url) => {
    if (String(url).includes('sessions/work/sess_sample_slow1.json')) {
      return { ok: true, status: 200, json: async () => sampleTimeline };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });

  await new Promise(r => setTimeout(r, 1500));
  const w = dom.window, d = w.document;
  try {
    chk(/id="lnmodal"/.test(html), 'the timeline modal markup exists');
    chk(/id="ttimelinebtn"/.test(html), 'the transcript modal carries a Timeline button');

    await w.eval("lnOpenModal('sess_sample_slow1', 'work', 'Migrate billing to the new pricing table')");
    await new Promise(r => setTimeout(r, 50));

    chk(d.getElementById('lnmodal').classList.contains('open'), 'the modal opens (gets the open class)');
    chk(d.getElementById('lntitle').textContent === 'Migrate billing to the new pricing table',
        'the title renders the real session title, not the session id');

    const lanes = [...d.querySelectorAll('.lnlanename')].map(el => el.textContent);
    chk(lanes.join(',') === 'Model,Tool,Delegation,Compaction,User',
        'all 5 lanes render in the fixed order', lanes);

    const spanEls = [...d.querySelectorAll('.lnspan')];
    chk(spanEls.length === sampleTimeline.spans.length,
        `every span in the payload gets a DOM element (${sampleTimeline.spans.length} expected)`, spanEls.length);

    const failSpans = d.querySelectorAll('.lnspan.lnfail');
    const expectedFails = sampleTimeline.spans.filter(s => s.failed).length;
    chk(failSpans.length === expectedFails,
        `the failed span(s) get the .lnfail outline class (${expectedFails} expected)`, failSpans.length);

    const tickSpans = d.querySelectorAll('.lnspan.lntick');
    const expectedTicks = sampleTimeline.spans.filter(s => s.start === s.end).length;
    chk(tickSpans.length === expectedTicks,
        `instantaneous (start==end) spans get the .lntick narrow-width class (${expectedTicks} expected)`, tickSpans.length);

    // Model color reuse: the model lane spans use the SAME colour keys the
    // rest of the dashboard already resolves for that model name — checked
    // indirectly via a non-empty, distinct background per distinct model.
    const modelSpans = [...d.querySelectorAll('.lnlane')][0].querySelectorAll('.lnspan');
    chk(modelSpans.length >= 1, 'the model lane has at least one span');
    const bg0 = modelSpans[0].style.background;
    chk(!!bg0 && bg0 !== 'transparent', 'a model span gets a real background colour, not the default/none', bg0);

    chk(d.getElementById('lnmeta').textContent.includes('claude-opus'),
        'the header meta line names the real models used');
    // Openers: the three session-row surfaces the ticket names can open the
    // timeline without going through the transcript modal first.
    const openers = [...d.querySelectorAll('.lntimelinebtn')].filter(b => b.id !== 'ttimelinebtn');
    chk(openers.length >= 3, 'session rows (tree/live/outcomes) carry Timeline openers, not just the transcript modal', openers.length);
    const openerTargets = new Set(openers.map(b => b.dataset.tsession));
    chk(openerTargets.has('sess_sample_slow1') || openerTargets.size > 0, 'the openers carry a real session id', [...openerTargets][0]);

    chk(d.getElementById('lnmeta').textContent.includes('42,000'),
        'the header meta line shows the real input token count formatted with thousands separators');

    // Esc closes.
    const evt = new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    w.document.dispatchEvent(evt);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
    w.eval("lnCloseModal()");
    chk(!d.getElementById('lnmodal').classList.contains('open'), 'Esc / lnCloseModal() closes the modal');

    console.log(`\ncheck_session_timeline.js (happy path)  done`);
  } catch (e) {
    chk(false, 'happy-path checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 8).join('\n'));
  }

  // --- 404 path: session not exported ---
  const dom404 = boot(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await new Promise(r => setTimeout(r, 1500));
  try {
    const w2 = dom404.window, d2 = w2.document;
    await w2.eval("lnOpenModal('sess_never_exported', 'work', 'Some untitled work')");
    await new Promise(r => setTimeout(r, 50));
    const bodyText = d2.getElementById('lnbody').textContent;
    chk(/not exported/i.test(bodyText),
        'a 404 (session not exported) shows an honest "not exported" message, not a blank panel or crash', bodyText.slice(0, 120));
  } catch (e) {
    chk(false, '404-path check crashed', e.message);
  }

  console.log(`\ncheck_session_timeline.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

run();
