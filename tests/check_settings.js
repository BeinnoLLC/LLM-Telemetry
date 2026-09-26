// Settings page (P7-03, #67).
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

let p = 0, f = 0;
const chk = (ok, label, extra = '') => {
  if (ok) p++; else f++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
};

// fetch mock: GET returns the "server" config; POST records the body and
// echoes it back as saved, like serve.py does.
function boot(mode, cb){
  const server = {values: {electricity_rate_kwh: 0.047, gpu_draw_watts: 350, host_overhead_watts: 90}};
  const posts = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://127.0.0.1:8477/dashboard.html#/settings',
    beforeParse(w){
      w.fetch = (url, opts = {}) => {
        const u = String(url);
        if (/api\/settings/.test(u)){
          if (mode === 'static') return Promise.reject(new Error('404'));
          if ((opts.method || 'GET') === 'POST'){
            const body = JSON.parse(opts.body);
            posts.push({body, headers: opts.headers});
            Object.assign(server.values, body);
            return Promise.resolve({ok: true, status: 200,
              json: () => Promise.resolve({saved: body, values: {...server.values}, config_file: '~/.config/llm-telemetry/config.json'})});
          }
          return Promise.resolve({ok: true, status: 200,
            json: () => Promise.resolve({values: {...server.values}, writable: mode !== 'lan',
                                         config_file: '~/.config/llm-telemetry/config.json'})});
        }
        return Promise.resolve({ok: false, status: 404, json: () => Promise.resolve({})});
      };
      w.Chart = function () { return {destroy() {}, update() {}}; };
      w.Chart.defaults = {color: '', borderColor: '', font: {}};
      w.Chart.getChart = () => null;
      w.Chart.register = () => {};
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.matchMedia = w.matchMedia || (() => ({matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}}));
    },
  });
  setTimeout(() => cb(dom.window, dom.window.document, posts, server), 700);
}

const typeIn = (w, el, v) => { el.value = String(v); el.dispatchEvent(new w.Event('input', {bubbles: true})); };

boot('local', (w, d, posts, server) => {
  const view = d.querySelector('.view[data-view="Settings"]');
  chk(!!view, 'Settings view exists');
  chk(view && !view.hidden, '#/settings opens it');
  chk(!!d.querySelector('[data-nav="Settings"]'), 'reachable from the nav drawer');
  chk(!!d.querySelector('[data-vtab="Settings"]'), 'reachable from the tab strip');

  const kwh = d.getElementById('set_kwh'), gpu = d.getElementById('set_gpu'), host = d.getElementById('set_host');
  chk(kwh && +kwh.value === 0.047, 'electricity rate defaults to 0.047', kwh && kwh.value);
  chk(gpu && +gpu.value === 350, 'GPU draw defaults to 350 W', gpu && gpu.value);
  chk(host && +host.value === 90, 'host overhead defaults to 90 W', host && host.value);
  chk(/USD/.test(view.textContent) && /Display only/.test(view.textContent), 'currency shown as display-only USD');

  const fields = [...view.querySelectorAll('.setf')];
  chk(fields.length === 4 && fields.every(x => (x.querySelector('.seth') || {}).textContent.trim().length > 10),
    'four fields, each with a one-line explanation', `(${fields.length})`);
  chk(/electricity, not billing/i.test(view.textContent), 'page states local cost is electricity, not billing');

  const deriv = () => d.getElementById('setderiv').textContent.replace(/\s+/g, ' ');
  chk(/\(350 W \+ 90 W\) \/ 1000 × \$0\.047 \/ 3600/.test(deriv()), 'derivation shows the formula with the values', `(${deriv().slice(0, 70)})`);
  const secBefore = d.getElementById('setusdsec').textContent;
  chk(secBefore === '$0.0000057', 'derived $/second matches (350+90)/1000×0.047/3600', secBefore);

  typeIn(w, kwh, 0.094);
  const secAfter = d.getElementById('setusdsec').textContent;
  chk(secAfter === '$0.000011', 'editing the tariff recomputes $/second live', `${secBefore} -> ${secAfter}`);
  chk(/0\.1915/.test(d.getElementById('setfacts').textContent) === false && /0\.3830/.test(d.getElementById('setfacts').textContent),
    'size-band table re-prices live (30b: $0.3830/M at 0.094)');

  const facts = d.getElementById('setfacts').textContent;
  chk(/30b/.test(facts) && /×12/.test(facts) && /×60/.test(facts), 'read-only facts shown: TPS bands, prefill ×12, cache ×60');

  typeIn(w, gpu, 99999);
  chk(/out of range/.test(deriv()), 'out-of-range wattage is flagged, not computed');
  chk(d.getElementById('setsave').disabled, 'save is disabled while a field is invalid');
  typeIn(w, gpu, 350);
  chk(!d.getElementById('setsave').disabled, 'save enables once valid and changed');

  d.getElementById('setsave').click();
  setTimeout(() => {
    chk(posts.length === 1, 'save issues one POST', `(${posts.length})`);
    const b = posts[0] && posts[0].body;
    chk(b && b.electricity_rate_kwh === 0.094 && Object.keys(b).length === 1, 'POST carries only the changed field', JSON.stringify(b));
    chk(posts[0] && posts[0].headers['X-LLM-Telemetry'] === '1', 'POST carries the CSRF header');
    chk(server.values.electricity_rate_kwh === 0.094, 'server config now holds the new tariff');
    chk(/Saved to/.test(d.getElementById('setmsg').textContent), 'user is told where it was saved');
    chk(d.getElementById('setsave').disabled, 'save disables again once nothing differs from saved');

    boot('static', (w2, d2) => {
      const msg = d2.getElementById('setmsg').textContent;
      chk(/llm-telemetry serve/.test(msg), 'static hosting: explains saving needs the serve process', `(${msg.slice(0, 60)})`);
      chk(d2.getElementById('setsave').disabled, 'static hosting: save is disabled');
      chk(/electricity_rate_kwh/.test(msg), 'static hosting: offers the JSON to paste');
      boot('lan', (w3, d3) => {
        chk(/only be changed from the machine/.test(d3.getElementById('setmsg').textContent), 'LAN viewer: told saving is local-only');
        chk(d3.getElementById('setsave').disabled, 'LAN viewer: save is disabled');
        d3.location.hash = '#/home';
        setTimeout(() => {
          const card = d3.querySelector('.homecard[data-gohome="Settings"]');
          chk(!!card && /\/ kWh/.test(card.textContent), 'Home has a Settings card showing the tariff');
          console.log(f ? `FAILED  (${p} passed, ${f} failed)` : `ALL PASS  (${p} passed, ${f} failed)`);
          process.exit(f ? 1 : 0);
        }, 400);
      });
    });
  }, 300);
});
