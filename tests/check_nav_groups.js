// #122: the nav rail groups its views into labelled sections with separators,
// and — the load-bearing part — a view added later with no explicit group must
// still appear in the rail rather than being silently dropped.
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

function bootDOM() {
  const backing = new Map();
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
      Object.defineProperty(w, 'localStorage', {
        value: { getItem: k => backing.get(k) ?? null,
                 setItem: (k, v) => backing.set(k, String(v)),
                 removeItem: k => backing.delete(k), clear: () => backing.clear(),
                 key: i => [...backing.keys()][i] ?? null,
                 get length(){ return backing.size; } },
        configurable: true, writable: true });
    },
  });
}

const dom = bootDOM();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    const groups = [...d.querySelectorAll('#navlist .navgroup')];
    const names = groups.map(g => g.dataset.navgroup);
    chk(groups.length >= 2, 'nav renders multiple groups', names.join(','));
    chk(names[0] === 'Overview', 'first group is Overview', names[0]);

    // every group carries a heading, and headings come first in the group
    const headed = groups.every(g => {
      const h = g.querySelector('.navgroup-h');
      return h && h.textContent.trim() === g.dataset.navgroup;
    });
    chk(headed, 'every group has its own heading');

    // separators BETWEEN groups, not before the first
    const kids = [...d.getElementById('navlist').children];
    const seps = kids.filter(k => k.classList.contains('navsep'));
    chk(seps.length === groups.length - 1,
        `one separator between groups (${seps.length} for ${groups.length} groups)`);
    chk(kids[0].classList.contains('navgroup'),
        'first child is a group, so nothing separates ahead of it');

    // no view is lost or duplicated by the grouping
    const navViews = [...d.querySelectorAll('#navlist [data-nav]')].map(a => a.dataset.nav);
    const real = w.eval('navViews()');
    chk(navViews.length === real.length, 'every view appears exactly once',
        `${navViews.length} nav vs ${real.length} views`);
    chk(new Set(navViews).size === navViews.length, 'no view is duplicated');
    const missing = real.filter(v => !navViews.includes(v));
    chk(missing.length === 0, 'no view dropped by grouping', missing.join(','));

    // declared membership actually holds
    const inGroup = (g, v) => !!d.querySelector(`#navlist .navgroup[data-navgroup="${g}"] [data-nav="${v}"]`);
    chk(inGroup('Overview', 'Home') && inGroup('Overview', 'Live') && inGroup('Overview', 'Flow'),
        'Overview holds Home/Live/Flow');
    chk(inGroup('Analysis', 'Usage') && inGroup('Analysis', 'Cost') && inGroup('Analysis', 'Health'),
        'Analysis holds Usage/Cost/Health');
    chk(inGroup('System', 'Settings') && inGroup('System', 'Logs'),
        'System holds Logs/Settings');

    // ---- the fallback: a brand-new view with no group entry --------------
    // Inject a view the way a future page would, then re-render the nav; it
    // must land in the trailing "More" group, not vanish.
    const fake = d.createElement('div');
    fake.className = 'view';
    fake.dataset.view = 'Quota';
    fake.hidden = true;
    d.querySelector('.views, body')?.appendChild(fake);
    w.eval('renderNav()');
    const after = [...d.querySelectorAll('#navlist [data-nav]')].map(a => a.dataset.nav);
    chk(after.includes('Quota'), 'an ungrouped new view STILL appears in the nav', after.join(','));
    chk(!!d.querySelector('#navlist .navgroup[data-navgroup="More"] [data-nav="Quota"]'),
        'ungrouped view lands in the trailing More group');
    const moreGroups = d.querySelectorAll('#navlist .navgroup[data-navgroup="More"]').length;
    chk(moreGroups === 1, 'exactly one More group', String(moreGroups));
    // and it is last, so it never displaces the declared sections
    const gAfter = [...d.querySelectorAll('#navlist .navgroup')].map(g => g.dataset.navgroup);
    chk(gAfter[gAfter.length - 1] === 'More', 'More group is last', gAfter.join(','));

    // ---- active state and badges survived the restructure -----------------
    chk(!!d.querySelector('#navlist [data-nav][aria-current="page"]') ||
        w.eval('view') === undefined,
        'active-page marking still applied inside groups');
    chk(!!d.querySelector('#navlist [data-navbadge]'), 'per-item badges still rendered');

    // ---- collapsed rail: labels hidden, grouping still there -------------
    const collapsedRule = /body\.navcollapsed[^{]*\.navgroup-h\s*\{\s*display:none/.test(html);
    chk(collapsedRule, 'collapsed rail hides the group labels');
    const sepRule = /#navdrawer \.navsep\{/.test(html);
    chk(sepRule, 'separator styling still present for collapsed rhythm');
  } catch (e) {
    chk(false, 'nav group checks crashed', e.message);
  }
  console.log(`\ncheck_nav_groups.js  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 1500);
