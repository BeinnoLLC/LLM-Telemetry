// #114: the "Local inference hosts" card and the bandwidth card must not blink.
// A refresh that momentarily carries no ollama payload / no byte rows used to
// hide the card; the next poll brought it back — the user saw the panel flash.
// Contract now: hidden until first sighting, then STICKY through empty
// refreshes, and the content is not clobbered by an empty round.
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
      const ls = {
        getItem: k => backing.has(k) ? backing.get(k) : null,
        setItem: (k, v) => { backing.set(k, String(v)); },
        removeItem: k => backing.delete(k),
        clear: () => backing.clear(),
        key: i => [...backing.keys()][i] ?? null,
        get length(){ return backing.size; },
      };
      Object.defineProperty(w, 'localStorage', { value: ls, configurable: true, writable: true });
    },
  });
}

const dom = bootDOM();
setTimeout(() => {
  const w = dom.window, d = w.document;
  const card = d.getElementById('olcard');
  const xfer = d.getElementById('xfercard');
  chk(!!card, 'olcard exists on the built page');
  chk(!!xfer, 'xfercard exists on the built page');

  // The sample page carries no ollama section at all, so 'hidden until first
  // sighting' is the correct starting state — assert that, then DRIVE the
  // seen -> sticky sequence explicitly instead of assuming sample hosts.
  chk(card && card.hidden === true, 'card starts hidden when payload has no hosts');
  chk(xfer && !xfer.hidden, 'bandwidth card visible (sample rows carry bytes)');
  const xferBefore = xfer ? xfer.innerHTML : '';

  // 1) first REAL payload -> visible
  w.eval(`renderOllama({hosts: [{label: 'box-a', up: true, loaded: [], urls: []}]})`);
  chk(card && !card.hidden, 'first host sighting makes the card visible');
  const htmlSeen = card ? card.innerHTML : '';

  // 2) THE BLINK: a refresh with an empty ollama payload must keep it visible,
  //    keep the content, and not clobber anything.
  w.eval('renderOllama({hosts: []})');
  chk(card && !card.hidden, 'host card STAYS through empty refresh', String(card && card.hidden));
  chk(card.innerHTML === htmlSeen, 'host content not clobbered by empty round');

  w.eval('renderXfer([])');
  chk(xfer && !xfer.hidden, 'bandwidth card STAYS through empty refresh', String(xfer && xfer.hidden));
  chk(xfer.innerHTML === xferBefore, 'bandwidth totals not clobbered by empty round');

  // 3) a NEW real payload still re-renders (sticky never freezes content)
  w.eval(`renderOllama({hosts: [{label: 'box-b', up: true, loaded: [], urls: []}]})`);
  chk(card && !card.hidden && card.innerHTML !== htmlSeen, 'real payload still re-renders');

  // Fresh boot, still no hosts: card hidden again (per-boot latch, not sticky
  // across reloads — an empty fleet IS the truth on a machine with none).
  const dom2 = bootDOM();
  setTimeout(() => {
    const c2 = dom2.window.document.getElementById('olcard');
    chk(c2 && c2.hidden === true, 'fresh boot without hosts: card starts hidden');
    console.log(`\ncheck_no_blink.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }, 1200);
}, 1500);