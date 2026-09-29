// #101 part 2: Repo & branch cost panel.
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
    },
  });
}

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    chk(/id="repocard"/.test(html), 'the Repo & branch card markup exists');

    w.eval("current = 'work'; view = 'Usage'; render();");

    const rows = d.querySelectorAll('#repolist > div');
    chk(rows.length === 3, 'the 3 fixture repos each render exactly one collapsed row initially', rows.length);

    const names = [...rows].map(r => r.querySelector('.flex-1').textContent.trim());
    chk(names[0] === 'sample-app', 'the highest-cost repo (sample-app, $12.40) renders first', names);
    chk(names[names.length - 1] === 'Unattributed',
        'Unattributed always renders last regardless of its cost rank (the #41 rule, applied here too)', names);

    // ---- click to expand: branch rows appear indented underneath ----
    const firstRepoRow = d.querySelector('#repolist [data-repokey="sample-app"]');
    chk(!!firstRepoRow, 'the sample-app row carries its own repo key for the click handler');
    firstRepoRow.click();
    const afterExpand = d.querySelectorAll('#repolist > div');
    chk(afterExpand.length === 3 + 3,
        'expanding sample-app reveals exactly its 3 real branch rows (main/feature/checkout/Unattributed)',
        afterExpand.length);

    const branchNames = [...afterExpand].slice(1, 4).map(r => r.querySelector('.flex-1').textContent.trim());
    chk(branchNames.includes('main') && branchNames.includes('feature/checkout'),
        'the expanded rows are the REAL branch names from the fixture, not placeholders', branchNames);
    chk(branchNames[branchNames.length - 1] === 'Unattributed',
        'within a repo, Unattributed branch also sorts last (same rule, one level down)', branchNames);

    // Collapse again: click the same row (re-query — innerHTML re-render
    // replaced the earlier node reference).
    d.querySelector('#repolist [data-repokey="sample-app"]').click();
    const afterCollapse = d.querySelectorAll('#repolist > div');
    chk(afterCollapse.length === 3, 'clicking the same repo row again collapses its branches back');

    // ---- the ticket's own negative control: empty data -> no crash ----
    w.eval("renderRepoBranch({repos: []});");
    chk(d.getElementById('repoempty').hidden === false,
        'an empty repos array renders the empty state, never a crash (the ticket\'s own negative control)');
    chk(d.querySelectorAll('#repolist > div').length === 0, 'the list itself is cleared when there is no data');

    console.log(`\ncheck_repo_branch.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_repo_branch.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
