// #30: charts.js as a unit — aggregation, weighting and the SVG primitives,
// called directly with Chart.js and localStorage faked for the module's load
// only. Expected geometry is hand-derived from the layout constants.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);
const near = (got, want, name) => chk(Math.abs(got - want) < 1e-12 * Math.max(1, Math.abs(want)), name, got);

// Real formatters from palette, so bwRow is checked against the real units.
const P = await isolate('palette.js', { 'main.js': { DATA: {} }, 'views.js': { PROV: {} } });
const NOW = 1_800_000_000_000;
const bwPrev = { s1: { up: 1000, down: 0 } };

async function charts(weight, { bwPrevAt = NOW - 10_000, DATA = {} } = {}) {
  return isolate('charts.js', {
    'palette.js': {
      $: () => null, BD: '#333', MU: '#888', LABEL_FONT: P.LABEL_FONT, bwPrev, bwPrevAt,
      escA: P.escA, fmtB: P.fmtB, fmtRate: P.fmtRate, labelColor: () => null, readTheme: () => {},
    },
    'main.js': { DATA },
  }, {
    Chart: { defaults: { font: {} } },
    localStorage: { getItem: k => (k === 'hermes-dash-projweight' ? weight : null) },
  });
}
const C = await charts(null);

// ---- bounds / agg --------------------------------------------------------
eq(C.bounds({ rows: [{ date: '2026-10-02' }, { date: '2026-09-30' }, {}, { date: '2026-10-02' }] }),
  ['2026-09-30', '2026-10-02'], 'bounds returns min/max date and skips undated rows');
eq(C.bounds({ rows: [] }), ['', ''], 'bounds of no rows is empty strings');
eq(C.agg([{ k: 'a', v: 1 }, { k: 'b', v: 3 }, { k: 'a', v: '4' }, { k: 'c', v: 'x' }], r => r.k, r => r.v),
  [['a', 5], ['b', 3], ['c', 0]], 'agg sums per key, coerces strings, zeroes NaN, sorts descending');
eq(C.agg([], r => r, r => r), [], 'agg of nothing is empty');

// ---- weightValue: mode comes from localStorage at module load ------------
const rows = [
  { session_id: 's1', calls: 2, inp: 10, outp: 5, cread: 1, cwrite: 0, act: 0.5 },
  { session_id: 's1', calls: 3, cwrite: 4, est: 2 },
  { calls: '1', est: 1 },
];
eq(C.PROJ_WEIGHT, 'cost', 'PROJ_WEIGHT defaults to cost');
eq(C.weightValue(rows), 3.5, 'cost weight: act, else est, summed');
eq((await charts('calls')).weightValue(rows), 6, 'calls weight sums calls (string-coerced)');
eq((await charts('tokens')).weightValue(rows), 20, 'tokens weight sums inp+outp+cread+cwrite');
eq((await charts('sessions')).weightValue(rows), 2, 'sessions weight: distinct ids + one per anonymous row');
eq((await charts('bogus')).PROJ_WEIGHT, 'cost', 'an unknown stored weight falls back to cost');
eq(typeof globalThis.Chart, 'undefined', 'fake Chart does not leak past module load');

// ---- radialRing: HIGH is good; tier uses the raw value -------------------
eq(C.radialRing(85, { label: 'Hit' }).includes('aria-valuetext="Hit 85 percent, healthy"'), true, 'ring >=80 is healthy');
eq(C.radialRing(70).includes('var(--z-warn)'), true, 'ring 60-79 is watch');
{
  const r = C.radialRing(59.6);
  eq(r.includes('>60%<') && r.includes('var(--z-bad)'), true, 'ring 59.6 shows 60% but stays Low (tier from raw value)');
}
eq(C.radialRing(79.6).includes('var(--z-warn)'), true, 'ring 79.6 shows 80% but stays Watch');
eq(C.radialRing(null, { label: 'X' }).includes('X: no data') && C.radialRing(null).includes('>—<'), true, 'ring null -> no data');
eq(C.radialRing(95, { warnAt: 99, badAt: 90 }).includes('var(--z-warn)'), true, 'ring honours custom bands');
// circumference 2*pi*15.5 = 97.39; full ring -> offset 0, empty -> full circumference, clamped.
eq([100, 150].map(p => C.radialRing(p).match(/stroke-dashoffset="([^"]+)"/)[1]), ['0.00', '0.00'], 'ring full/over-full has zero offset');
eq([0, -5].map(p => C.radialRing(p).match(/stroke-dashoffset="([^"]+)"/)[1]), ['97.39', '97.39'], 'ring empty/negative has full offset');

// ---- sparkSvg / olBar / ctxSpark geometry --------------------------------
eq([C.sparkSvg([1, 1, 1]), C.sparkSvg([5]), C.sparkSvg(null)], ['', '', ''], 'sparkSvg is blank for flat or short series');
{
  const s = C.sparkSvg([0, 10], 'red');   // W64 H20 pad2 -> (2,18) .. (62,2)
  eq(s.includes('points="2.0,18.0 62.0,2.0"'), true, 'sparkSvg maps min->bottom-left, max->top-right', s);
  eq(s.includes('cx="62.0" cy="2.0"'), true, 'sparkSvg dots the last point');
}
eq(C.olBar(85, 'L', 'v').includes('olfill bad'), true, 'olBar load >=85 is bad');
eq(C.olBar(59, 'L', 'v').includes('olfill good'), true, 'olBar load <60 is good');
eq(C.olBar(90, 'L', 'v', true).includes('olfill good inv'), true, 'olBar inverted >=90 is good');
eq(C.olBar(60, 'L', 'v', true).includes('olfill warn inv'), true, 'olBar inverted 60-89 is warn');
eq(C.olBar(150, 'L', 'v').includes('width:100%') && C.olBar(null, 'L', 'v').includes('width:0%'), true, 'olBar clamps 0-100');
eq(C.olBar(10, 'L', 'v', false, [1, 2]).includes('olspwrap'), true, 'olBar embeds a spark when given a series');
eq(C.ctxSpark([]).includes('no data'), true, 'ctxSpark empty -> no data');
{
  const s = C.ctxSpark([[0, 0], [10, 20]], [{ ts: 5, ineffective: true, yield_tok: 1200 }]);   // W260 H40 pad2
  eq(s.includes('points="2.0,38.0 258.0,2.0"'), true, 'ctxSpark scales x across the width and y to the max', s);
  eq(s.includes('x1="130.0"') && s.includes('#c66a6a'), true, 'ctxSpark places an ineffective compaction mid-way in red');
}

// ---- electricity maths ---------------------------------------------------
{
  const v = { gpu_draw_watts: 300, host_overhead_watts: 60, electricity_rate_kwh: 0.36 };
  near(C.usdPerSec(v), 0.36 * 0.36 / 3600, 'usdPerSec = kW * $/kWh / 3600');
  near(C.outPer1M(v, 50), 0.72, 'outPer1M = $/s * 1e6 / tok/s');
  eq(C.usdPerSec({}), 0, 'usdPerSec of nothing is 0');
}

// ---- bwRow: live rate only over a sane poll interval ---------------------
{
  const realNow = Date.now;
  Date.now = () => NOW;
  try {
    eq(C.bwRow({ id: 's1' }), '', 'bwRow with no bytes is blank');
    const L = { id: 's1', up_bytes: 2048, down_bytes: 1048576, lan_up_bytes: 1000 };
    const r = C.bwRow(L);
    // up (2048+1000-1000)/10 + down 1048576/10 = 105062.4 B/s = 102.6 KB/s
    eq(r.includes('102.6 KB/s') && r.includes(' bwlive'), true, 'bwRow derives the rate from the previous poll', r);
    eq(r.includes('2.00 KB') && r.includes('1.00 MB') && r.includes('4.68 bytes/token'), true, 'bwRow shows metered totals and the default bytes/token');
    eq(C.bwRow({ ...L, id: 'unseen' }).includes('bwlive'), false, 'bwRow has no rate without a previous poll');
    eq((await charts(null, { bwPrevAt: NOW - 1000 })).bwRow(L).includes('bwlive'), false, 'bwRow ignores a sub-2s interval');
    eq((await charts(null, { bwPrevAt: NOW - 121_000 })).bwRow(L).includes('bwlive'), false, 'bwRow ignores a >120s interval');
    eq((await charts(null, { DATA: { bytes_per_token: 3.9 } })).bwRow(L).includes('3.9 bytes/token'), true, 'bwRow uses the payload bytes/token');
  } finally { Date.now = realNow; }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
