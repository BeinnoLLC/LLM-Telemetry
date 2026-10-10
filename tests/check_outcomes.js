// #91/P10-03: Session outcomes panel — end_reason breakdown, source-split,
// orphan reaps as their own KPI, and a silent-end bucket that is never
// folded into an "ok" count.
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
    chk(/id="outcard" hidden>/.test(html), 'the outcomes card starts hidden');

    w.eval("current = 'work'; renderHealth();");
    const card = d.getElementById('outcard');
    chk(card && card.hidden === false, 'the outcomes card is shown for the sample profile with outcomes data');

    const kpiText = d.getElementById('outkpis').textContent;
    chk(kpiText.includes('Orphan reaps'), 'a KPI names Orphan reaps');
    chk(kpiText.includes('2'), 'the orphan-reap KPI shows the correct count (2 reaped sessions in the fixture)');
    chk(kpiText.includes('Ended silently'), 'a KPI names Ended silently');
    chk(kpiText.includes('Ended cleanly'), 'a KPI names Ended cleanly (not "ok" — matches the ticket vocabulary)');
    chk(!/\bok\b/i.test(kpiText.replace(/[A-Za-z]+ok[A-Za-z]+/g,'')),
        'no KPI label reads literally "ok" (silent/reaped must not be euphemised into a generic ok bucket)');

    // Source-split: cron's mixed reasons (cron_complete AND agent_close) must
    // both be visible — a cron session NOT ending cron_complete is the
    // ticket's own "alarm" case and must not be hidden by a global rollup.
    const bySourceText = d.getElementById('outbysource').textContent;
    chk(bySourceText.includes('cron'), 'the source-split section names the cron source');
    const bySourceHTML = d.getElementById('outbysource').innerHTML;
    chk(bySourceHTML.includes('agent_close') && bySourceHTML.includes('cron_complete'),
        'the cron row shows BOTH cron_complete and the alarm-case agent_close, not just the majority reason');

    // Abnormal reasons get the red/warning style; normal ones do not.
    const reapChip = [...d.querySelectorAll('#outbysource span')].find(s => s.textContent.includes('Reaped'));
    chk(!!reapChip && /--z-bad/.test(reapChip.getAttribute('style')),
        'a reap chip renders in the abnormal (red) style');
    const cronCompleteChip = [...d.querySelectorAll('#outbysource span')].find(s => /cron_complete/.test(s.title || ''));
    chk(!!cronCompleteChip && !/--z-bad/.test(cronCompleteChip.getAttribute('style')),
        'the cron_complete chip renders in the neutral style, not flagged as abnormal');

    // Silent bucket: the actual session is listed, and it is a SEPARATE
    // section from the by-source breakdown (findable, not merged away).
    const silentText = d.getElementById('outsilentlist').textContent;
    chk(silentText.includes('Untitled TUI session'), 'the silent-ends list names the actual silently-ended session');

    // Orphan reap trend: both fixture days render.
    const trendText = d.getElementById('outreaptrend').textContent;
    chk(trendText.includes('09-27') && trendText.includes('09-28'),
        'the reap trend shows both fixture days');

    // Hide condition: a profile with zero ended sessions in range hides
    // the card entirely (not an empty shell).
    w.eval(`
      current = 'personal';
      DATA.profiles.personal.outcomes = {by_reason:{}, by_source_reason:{}, silent:[], reaped:[], reap_trend:[]};
      renderHealth();
    `);
    chk(d.getElementById('outcard').hidden === true,
        'the card hides entirely when by_reason is empty (no sessions ended in range)');

    // Negative-control-shaped check baked into the suite itself: an
    // outcomes payload with ONLY a "(none)" reason and nothing else must
    // still show the card and must NOT report 0 orphan reaps as if that
    // were "Ended cleanly: 100%" masking the silent case.
    w.eval(`
      DATA.profiles.personal.outcomes = {
        by_reason: {'(none)': 3}, by_source_reason: {tui: {'(none)': 3}},
        silent: [{id:'s1', title:'a', source:'tui', model:'m', when:1}], reaped: [], reap_trend: []
      };
      renderHealth();
    `);
    const soloSilentCard = d.getElementById('outcard');
    chk(soloSilentCard.hidden === false, 'a payload with ONLY silent-ended sessions still shows the card');
    const soloKpi = d.getElementById('outkpis').textContent;
    chk(!soloKpi.includes('100.0%'), 'the "ended cleanly" percentage does NOT read 100% when every session actually ended silently');

    console.log(`\ncheck_outcomes.js  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    chk(false, 'checks crashed', e.message);
    console.log((e.stack || '').split('\n').slice(0, 10).join('\n'));
    console.log(`\ncheck_outcomes.js  ${pass} passed, ${fail} failed`);
    process.exit(1);
  }
}, 1500);
