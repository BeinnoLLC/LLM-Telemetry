// #130 regression: the Router tab must survive a refresh.
//
// Bug: doRefresh() swapped the page payload wholesale (DATA = fresh), but
// router/ and router_meta/ are merged into dashboard.html at BUILD time only —
// analytics-data.json never carries them. So the ↻ button and the 60s rebuild
// each blanked the Router tab to "No router data", which reads exactly like the
// hourly collection job had never run.
//
// This suite drives the real doRefresh() against a fetch stub that serves the
// two payloads the page actually asks for, and checks the tab is still
// populated afterwards — plus that a failed or wrong-shaped router payload does
// not replace good data with nothing.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const raw = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');
const html = raw.replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const analytics = JSON.parse(fs.readFileSync(path.join(REPORTS, 'analytics-data.json'), 'utf8'));
const router = JSON.parse(fs.readFileSync(path.join(REPORTS, 'router-data.json'), 'utf8'));

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// Serve by URL, the way the server does — NOT one payload for every request.
// A stub that answers everything with the analytics body is what let the bug
// hide: doRefresh's router fetch would "succeed" and hand back analytics.
function boot(routes) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html#/router',
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
        value: { getItem: k => backing.get(k) ?? null, setItem: (k, v) => backing.set(k, String(v)), removeItem: k => backing.delete(k) },
      });
      w.fetch = (url) => {
        const key = String(url).split('?')[0].split('/').pop();
        const body = routes[key];
        if (body === undefined) return Promise.reject(new Error('offline: ' + key));
        if (body === null) return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('no body')) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
      };
      w.Element.prototype.scrollIntoView = function () {};
    },
  });
}

// The tab is "populated" when the built-in payload's profiles made it through:
// a tier card exists for the profile that has a router, and the subtitle still
// reports when the hourly job last ran.
function tabState(d) {
  const el = d.getElementById('routerview');
  return {
    txt: el ? el.textContent : '',
    cards: d.querySelectorAll('.rt-tcard').length,
    sub: d.getElementById('routersub') ? d.getElementById('routersub').textContent : '',
  };
}

setTimeout(() => {
  const good = boot({
    'analytics-data.json': analytics,
    'router-data.json': router,
    'live-data.json': { profiles: {}, schema_version: analytics.schema_version },
    'logs-data.json': { profiles: {}, schema_version: analytics.schema_version },
  });
  const w = good.window, d = w.document;
  try {
    w.eval("pickView('Router')");
    const before = tabState(d);
    chk(before.cards > 0, 'the Router tab renders tier cards on first paint', `cards=${before.cards}`);
    chk(/refreshed hourly/.test(before.sub), 'the tab reports its own freshness', before.sub);

    // The actual bug: one refresh, and the tab was gone.
    return w.eval("doRefresh(true)").then(() => {
      w.eval("pickView('Router')");
      const after = tabState(d);
      chk(after.cards === before.cards,
          'a refresh keeps every tier card on the Router tab', `before=${before.cards} after=${after.cards}`);
      chk(!/No router data/.test(after.txt),
          'the tab never falls back to "No router data" while router data exists',
          after.txt.slice(0, 80).replace(/\n/g, ' '));
      chk(/refreshed hourly/.test(after.sub) && !/last (1[0-9]|[2-9][0-9])h/.test(after.sub),
          'the freshness line is still live after the refresh', after.sub);
      chk('router' in w.eval('DATA') && w.eval('DATA.router_meta') !== undefined,
          'DATA still carries router and router_meta after the swap');

      // A router payload that never arrives must not empty the tab: stale
      // router data beats a blank tab that reads like the job never ran.
      const offline = boot({
        'analytics-data.json': analytics,
        'router-data.json': undefined,   // rejects, like a server that is down
      });
      const w2 = offline.window, d2 = w2.document;
      return w2.eval("doRefresh(true)").then(() => {
        w2.eval("pickView('Router')");
        const s = tabState(d2);
        chk(s.cards > 0, 'an unreachable router-data.json keeps the built-in router data', `cards=${s.cards}`);

        // Wrong shape: a payload of the right version that is not router data
        // must be refused too, or every profile appears with no tiers on it.
        const wrong = boot({
          'analytics-data.json': analytics,
          'router-data.json': { ...analytics, vocab: undefined },
        });
        const w3 = wrong.window, d3 = w3.document;
        return w3.eval("doRefresh(true)").then(() => {
          w3.eval("pickView('Router')");
          const t = tabState(d3);
          chk(t.cards > 0, 'a wrong-shaped router payload is refused, not applied', `cards=${t.cards}`);

          // Negative control: reproduce the exact state the buggy swap left
          // behind — a payload with no router key on it — and confirm the same
          // measurement then reports the reported failure. Without this, the
          // assertions above could pass on a page that ignores DATA entirely.
          w.eval("DATA.router = {}; DATA.router_meta = {}");
          w.eval("pickView('Router')");
          const c = tabState(d);
          chk(c.cards === 0, 'control: the pre-fix swap DOES empty the tab (cards=0)', `cards=${c.cards}`);
          chk(/No router data/.test(c.txt), 'control: the pre-fix swap reproduces the exact reported message',
              c.txt.slice(0, 60).replace(/\n/g, ' '));
          console.log(`\ncheck_router_refresh.js  ${pass} passed, ${fail} failed`);
          process.exit(fail === 0 ? 0 : 1);
        });
      });
    });
  } catch (e) {
    console.log(`  FAIL threw: ${e.message}`);
    console.log(`\ncheck_router_refresh.js  ${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }
}, 1200);
