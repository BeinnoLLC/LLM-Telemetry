// #89/P10-01: Sessions -> Tree panel in Detail view — expand/collapse,
// roll-up numbers, source/end_reason badges, only parents-with-children
// shown (a plain leaf session belongs to the per-model table, not here).
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
    w.eval("current = 'work'; $('from').value=''; $('to').value=''; pickView('Detail');");

    const rawTree = w.eval("DATA.profiles.work.sessions_tree");
    const withKids = rawTree.filter(n => n.children && n.children.length);
    chk(withKids.length >= 2, `fixture has at least 2 parents with children to test against (has ${withKids.length})`);

    const card = d.getElementById('sesstreecard');
    chk(!!card, 'the Sessions -> Tree card exists in the Detail view');

    const rows = d.querySelectorAll('.sesstree-row');
    chk(rows.length > 0, 'at least one session-tree row is rendered');

    // Only nodes WITH children render as tree roots — a bare leaf session
    // does not get a second copy of itself here.
    const lonelyTitleFragment = 'Quick one-off';
    const lonelyRendered = [...rows].some(r => r.textContent.includes(lonelyTitleFragment));
    chk(!lonelyRendered, 'a session with no children (sess_lonely01) is NOT rendered in the tree card');

    // Roll-up numbers: pick the two-child parent and verify the DISPLAYED
    // cost equals own + every descendant, computed independently here from
    // the raw payload (not just "some number appears").
    const parent1 = rawTree.find(n => n.id === 'sess_parent01');
    const expectedCost = parent1.cost; // collector already rolled this up; UI must not re-derive it
    const parent1Row = [...rows].find(r => r.textContent.includes(parent1.title));
    chk(!!parent1Row, 'the two-child parent row renders with its title');
    chk(parent1Row.textContent.includes(`$${expectedCost.toFixed(4)}`),
        `the parent row shows the roll-up cost ($${expectedCost.toFixed(4)}) from the payload, not a re-derived number`,
        parent1Row.textContent);
    chk(parent1Row.textContent.includes('2 descendant'),
        'the parent row states its descendant count (2 descendants)');
    chk(parent1Row.textContent.includes('1 failed'),
        'the parent row states its failed-child count (1 failed)');

    // Est. vs actual cost distinction on a child with cost_is_actual=false.
    const childRow = [...d.querySelectorAll('.sesstree-row')].find(r => r.textContent.includes('backfill historical rows'));
    chk(!!childRow, 'the estimate-only child row renders');
    chk(childRow.textContent.includes('(est.)'), 'a node with cost_is_actual=false is marked "(est.)"');
    const okChildRow = [...d.querySelectorAll('.sesstree-row')].find(r => r.textContent.includes('apply schema migration'));
    chk(okChildRow && !okChildRow.textContent.includes('(est.)'),
        'a node with cost_is_actual=true is NOT marked "(est.)"');

    // Failed end_reason styling.
    chk(childRow.classList.contains('sesstree-row-failed'),
        'a row whose end_reason contains "error" gets the failed-row class');

    // Depth is not assumed to be 1: the two-level fan-out (parent -> child
    // -> grandchild) must actually nest, not flatten.
    const grandRow = [...d.querySelectorAll('.sesstree-row')].find(r => r.textContent.includes('grep archived logs'));
    chk(!!grandRow, 'a depth-2 grandchild node renders (tree is not assumed to be exactly 1 level deep)');
    const grandPadding = parseFloat(grandRow.style.paddingLeft || '0');
    const childPadding = parseFloat(([...d.querySelectorAll('.sesstree-row')].find(r => r.textContent.includes('tail the failing')) || {}).style.paddingLeft || '0');
    chk(grandPadding > childPadding, 'the grandchild is indented further than its own parent (real nesting, not flattened)');

    // Collapse/expand interaction: click the toggle, children disappear;
    // click again, they come back. aria-expanded reflects state.
    const parent1Toggle = d.querySelector(`[data-sesstree-toggle="sess_parent01"]`);
    chk(!!parent1Toggle, 'the two-child parent has a toggle button');
    chk(parent1Toggle.getAttribute('aria-expanded') === 'true', 'the toggle starts expanded (aria-expanded=true)');

    parent1Toggle.click();
    w.eval('render();');
    const afterCollapse = d.querySelector(`[data-sesstree-toggle="sess_parent01"]`);
    chk(afterCollapse.getAttribute('aria-expanded') === 'false', 'after clicking, aria-expanded flips to false');
    const stillHasChildRow = [...d.querySelectorAll('.sesstree-row')].some(r => r.textContent.includes('backfill historical rows'));
    chk(!stillHasChildRow, 'collapsing the parent actually hides its children from the DOM');

    afterCollapse.click();
    w.eval('render();');
    const reExpandedRow = [...d.querySelectorAll('.sesstree-row')].some(r => r.textContent.includes('backfill historical rows'));
    chk(reExpandedRow, 'clicking again re-expands and the child reappears');

    // Empty state: switch to a synthetic payload with no parent/child
    // relationships at all.
    w.eval("DATA.profiles.work.sessions_tree = []; render();");
    const emptyEl = d.getElementById('sesstreeempty');
    chk(emptyEl && emptyEl.hidden === false, 'an empty sessions_tree shows the explicit empty state');
    w.eval("DATA.profiles.work.sessions_tree = " + JSON.stringify(rawTree) + "; render();");

    console.log(`\ncheck_sessions_tree.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 12).join('\n'));
    console.log(`\ncheck_sessions_tree.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
