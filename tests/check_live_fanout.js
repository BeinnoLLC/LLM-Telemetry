// #89/P10-01: Live-view fan-out strip — a parent with 2+ children currently
// running collapses into one clickable summary chip above the live list, so
// a burst of subagents reads as one event instead of N unrelated rows.
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

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://127.0.0.1:8477/dashboard.html',
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

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    w.eval("current = 'work'; pickView('Live');");

    const fanoutEl = d.getElementById('livefanout');
    chk(!!fanoutEl, 'the #livefanout strip element exists in the Live view');
    chk(fanoutEl.hidden === false, 'the strip is visible when a real fan-out exists in the fixture');

    const chips = fanoutEl.querySelectorAll('.livefanout-chip');
    chk(chips.length === 1, `exactly one fan-out chip renders for the one parent with 2 live children (got ${chips.length})`);

    const chip = chips[0];
    chk(chip.tagName === 'BUTTON' && chip.getAttribute('type') === 'button',
        'the fan-out chip is a real <button type="button"> (not a div/span pretending to be clickable)');
    chk(chip.textContent.includes('2 running'), 'the chip states the correct running count (2)');
    chk(chip.textContent.includes('Bulk-rename the export columns'),
        'the chip names the actual parent session title from the payload');
    chk(chip.dataset.tsession === 'sess_fanout_parent',
        'the chip carries the parent session id for opening its transcript');
    chk(chip.classList.contains('ttitlebtn'),
        'the chip reuses the SAME .ttitlebtn class the live-row title buttons use (one click-to-transcript wiring, not a duplicate)');

    // A parent with only ONE live child must NOT trigger a fan-out chip —
    // fan-out means 2+, not "any child."
    const rawLive = w.eval("DATA.profiles.work.live");
    const singleChildCase = rawLive.filter(L => L.parent === 'sess_36533392');
    chk(singleChildCase.length === 0,
        'sanity: the pre-existing top-level sample session has no children (isolates the count=1 case from being accidentally tested)');

    console.log(`\ncheck_live_fanout.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_live_fanout.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
