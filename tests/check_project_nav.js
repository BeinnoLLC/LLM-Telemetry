// #48/P4-11: Sessions view (was Projects) entry in the drawer nav (expanded/rail/off-canvas)
// and a homepage card showing top project + unattributed share, both from
// the payload; #/projects deep-links; active-state styling matches other
// drawer entries.
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

function boot(startHash) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1:8477/dashboard.html' + (startHash || ''),
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub(ctx, cfg) { this.config = cfg; this.destroy = () => {}; this.update = () => {}; this.canvas = ctx;
        this._visibility = ((cfg && cfg.data && cfg.data.datasets) || []).map(() => true);
        this.isDatasetVisible = (i) => this._visibility[i]; this.setDatasetVisibility = (i,v) => { this._visibility[i]=v; }; }
      Stub.register = () => {}; Stub.overrides = {}; Stub.instances = {}; Stub.getChart = () => null;
      Stub.registerables = []; Stub.version = 'stub'; Stub.controllers = {}; Stub.elements = {}; Stub.plugins = {}; Stub.scales = {};
      Stub.defaults = { font: { size: 10, family: '', weight: '' }, color: '' };
      w.Chart = Stub;
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    w.eval("current = 'work'; $('from').value=''; $('to').value=''; pickView('Home');");

    // Drawer nav entry (built dynamically from .view elements — same list
    // as the chip row, so they can never disagree).
    const navItem = d.querySelector('[data-nav="Sessions"]');
    chk(!!navItem, 'a "Sessions" drawer nav entry exists');
    chk(navItem.getAttribute('href') === '#/sessions', 'the nav entry links to #/sessions');
    chk(navItem.querySelector('.nvico') && navItem.querySelector('.nvico').textContent.trim().length > 0,
        'the nav entry has an icon');

    // No 7th chip added to #tabs (explicit "do not" in the ticket — #4
    // deletes the chip row, and the ticket forbids re-adding to it). The
    // real acceptance constraint is that Projects exists in the drawer's
    // dynamic nav list regardless of whatever the legacy chip strip does.
    chk(navGroupsContainsSessions(), 'Sessions appears in navGroups() (drawer\'s own view enumeration)');
    function navGroupsContainsSessions(){
      const groups = w.eval('navGroups()');
      return groups.some(g => g.views.includes('Sessions'));
    }

    // Homepage card.
    const homeCard = d.querySelector('[data-gohome="Sessions"]');
    chk(!!homeCard, 'a homepage card for Sessions exists');
    chk(homeCard.getAttribute('href') === '#/sessions', 'the homepage card links to #/sessions');
    const statText = homeCard.querySelector('.hc-stat').textContent;
    chk(statText.includes('unattributed'), `the homepage card states the unattributed share, got: ${statText}`);

    // Card content derived from the payload, not hardcoded: cross-check
    // against a direct computation from DATA.
    const rowsAll = w.eval("DATA.profiles.work.rows");
    const spend = {};
    rowsAll.forEach(r => { const k = r.project || 'Unattributed'; spend[k] = (spend[k]||0) + (+r.act || +r.est || 0); });
    const total = Object.values(spend).reduce((a,b)=>a+b, 0);
    const unattrPct = total > 0 ? Math.round(100 * (spend['Unattributed']||0) / total) : null;
    const topReal = Object.entries(spend).filter(([k])=>k!=='Unattributed').sort((a,b)=>b[1]-a[1])[0];
    if (topReal) {
      chk(statText.includes(topReal[0]), `the card names the actual top project by spend (${topReal[0]}), got: ${statText}`);
    }
    if (unattrPct !== null) {
      chk(statText.includes(unattrPct + '%'), `the card's unattributed percentage matches a direct computation (${unattrPct}%), got: ${statText}`);
    }

    // Active-state styling matches other drawer entries (same class
    // convention, not a bespoke one for Projects).
    w.eval("pickView('Sessions');");
    const activeClass = navItem.className;
    w.eval("pickView('Usage');");
    const usageNav = d.querySelector('[data-nav="Usage"]');
    const usageActiveClass = usageNav.className;
    w.eval("pickView('Sessions');");
    chk(navItem.className === usageActiveClass || navItem.className.split(' ').sort().join(',') === usageActiveClass.split(' ').sort().join(','),
        `active-state class on the Sessions nav item matches the convention other entries use (got "${navItem.className}" vs reference "${usageActiveClass}")`);

    // Deep link.
    chk(w.eval('location.hash') === '#/sessions', 'navigating to Sessions sets the hash to #/sessions');

    // Fresh load from #/projects lands directly on the view.
    const dom2 = boot('#/sessions');
    setTimeout(() => {
      const w2 = dom2.window, d2 = w2.document;
      chk(w2.eval('view') === 'Sessions', 'a fresh page load from #/sessions opens directly on the Sessions view');
      const projView = d2.querySelector('[data-view="Sessions"]');
      chk(projView && projView.hidden === false, 'the Sessions view element is visible (not hidden) after a #/sessions deep link');

      console.log(`\ncheck_project_nav.js  ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 1500);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_project_nav.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
