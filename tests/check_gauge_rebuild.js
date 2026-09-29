// #7/#8/#9/#10/#12: gauge rebuild acceptance checks.
//   #7  270° dial, gradient track, ticks, numeric readout, needle+hub.
//   #8  zone bands / danger pulse / configurable thresholds.
//   #9  needle travels from its previous angle on refresh (not just tremor).
//   #10 --gauge-size presets (sm/md/lg), same component at every size.
//   #12 role=meter + aria-value*/aria-label + real text + <title>.
// Loads the BUILT dashboard from examples/reports/dashboard.html.
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
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const lightSession = { id:'g_light', model:'m', title:'Light task', tools:[] };
    const heavySession = { id:'g_heavy', model:'m', title:'Heavy task',
      tools:['delegate_task','execute_code','terminal','mcp__browser_exec','delegate_task','execute_code'] };

    // ---- #7: instrument dial shape --------------------------------------
    const lightHtml = w.eval(`loeIcon(${JSON.stringify(lightSession)}, {id:'g_light', label:'Light task'})`);
    chk(/role="meter"/.test(lightHtml), '#7/#12: gauge has role="meter"');
    chk(/viewBox="0 0 100 116"/.test(lightHtml), '#7: fixed 100x100-ish viewBox');
    chk(/linearGradient/.test(lightHtml), '#7: value arc uses a gradient');
    chk(/stop-color="var\(--z-ok\)"/.test(lightHtml) && /stop-color="var\(--z-bad\)"/.test(lightHtml),
        '#7: gradient runs from the ok colour to the bad colour');
    chk((lightHtml.match(/<line/g) || []).length >= 11, '#7: 11+ tick marks drawn (every 10%)',
        (lightHtml.match(/<line/g) || []).length);
    chk(/>0<\/text>/.test(lightHtml) && />50<\/text>/.test(lightHtml) && />100<\/text>/.test(lightHtml),
        '#7: major ticks are labelled 0/50/100');
    chk(/class="needle"/.test(lightHtml), '#7: needle element present');
    chk(/font-weight:700/.test(lightHtml) && /%<\/text>/.test(lightHtml),
        '#7: a big numeric percentage readout exists');

    // ---- #8: zone bands + danger pulse -----------------------------------
    const heavyHtml = w.eval(`loeIcon(${JSON.stringify(heavySession)}, {id:'g_heavy', label:'Heavy task'})`);
    chk(/gdanger/.test(heavyHtml), '#8: a high-load gauge gets the danger-pulse class');
    chk(!/gdanger/.test(lightHtml), '#8: a low-load gauge does NOT get the danger-pulse class');
    // configurable thresholds: the same score reads differently against a
    // caller-supplied warnAt/badAt (e.g. a metric where 0% is already bad).
    const strictHtml = w.eval(`loeIcon(${JSON.stringify(lightSession)}, {id:'g_light2', label:'x', warnAt:0, badAt:0})`);
    chk(/gdanger/.test(strictHtml), '#8: thresholds are configurable per-metric via opts');

    // ---- #9: needle travels from its previous angle on refresh ------------
    const first = w.eval(`loeIcon(${JSON.stringify(lightSession)}, {id:'g_travel', label:'x'})`);
    const firstFrom = (first.match(/--from:(-?[\d.]+)deg/) || [])[1];
    const firstD = (first.match(/--d:(-?[\d.]+)deg/) || [])[1];
    chk(firstFrom === firstD, '#9: on first paint, travel starts AT the value (no fake sweep from 0)');
    const second = w.eval(`loeIcon(${JSON.stringify(heavySession)}, {id:'g_travel', label:'x'})`); // same id, different load
    const secondFrom = (second.match(/--from:(-?[\d.]+)deg/) || [])[1];
    const secondD = (second.match(/--d:(-?[\d.]+)deg/) || [])[1];
    chk(secondFrom === firstD, '#9: the NEXT render travels FROM the previous angle', `${secondFrom} vs prior ${firstD}`);
    chk(secondD !== secondFrom, '#9: the new angle differs from where it started (a real sweep happens)');
    chk(/needle-travel/.test(html), '#9: needle-travel keyframe is emitted');
    chk(/needle-travel .6s/.test(html), '#9: travel runs over ~600ms as specified');

    // ---- #10: size presets --------------------------------------------------
    const smHtml = w.eval(`loeIcon(${JSON.stringify(lightSession)}, {id:'g_sm', label:'x', size:'sm'})`);
    const lgHtml = w.eval(`loeIcon(${JSON.stringify(lightSession)}, {id:'g_lg', label:'x', size:'lg'})`);
    chk(/loe sz-sm/.test(smHtml), '#10: sm preset applies the sz-sm class');
    chk(/loe sz-lg/.test(lgHtml), '#10: lg preset applies the sz-lg class');
    chk(/loe sz-md/.test(lightHtml), '#10: default preset is md');
    chk(/--gauge-size:56px/.test(html) && /--gauge-size:84px/.test(html) && /--gauge-size:132px/.test(html),
        '#10: all three size presets (56/84/132px) are defined in CSS');
    // same viewBox at every size — scaling is pure CSS, not different markup
    chk(smHtml.match(/viewBox="[^"]*"/)[0] === lgHtml.match(/viewBox="[^"]*"/)[0],
        '#10: viewBox is identical across sizes (CSS-only scaling)');

    // ---- #12: accessibility -----------------------------------------------
    chk(/aria-valuenow="\d+"/.test(lightHtml), '#12: aria-valuenow present');
    chk(/aria-valuemin="0"/.test(lightHtml) && /aria-valuemax="100"/.test(lightHtml),
        '#12: aria-valuemin/aria-valuemax present');
    chk(/aria-valuetext="[^"]*percent/.test(lightHtml), '#12: aria-valuetext is human-readable ("N percent, ...")');
    chk(/aria-label="Light task"/.test(lightHtml), '#12: aria-label names the specific thing being measured');
    chk(/<title>/.test(lightHtml), '#12: an SVG <title> exists for hover tooltips');
    // real text, not a path: the readout renders inside a jsdom-visible <text>
    // element with actual textContent, so it is selectable/translatable.
    const wrap = d.createElement('div'); wrap.innerHTML = `<svg>${lightHtml.match(/<svg[^>]*>([\s\S]*)<\/svg>/)[1]}</svg>`;
    const texts = [...wrap.querySelectorAll('text')].map(t => t.textContent);
    chk(texts.some(t => /%$/.test(t)), '#12: the percentage readout is real DOM text, not a drawn path', texts.join(','));
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 6).join('\n'));
  }
  console.log(`\ncheck_gauge_rebuild.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
