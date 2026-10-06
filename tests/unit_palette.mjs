// #30: palette.js as a unit — colour maths and formatters called directly, no
// page load. Expected values are hand-derived from the documented rules (hue
// bands, fan widths, unit thresholds), NOT captured from current output, so a
// regression in the maths fails here instead of only shifting a chart's shade.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);

const DATA = {};
const P = await isolate('palette.js', { 'main.js': { DATA }, 'views.js': { PROV: {} } });

// ---- fade --------------------------------------------------------------
eq(P.fade('#fff', 0.5), 'rgba(255,255,255,0.5)', 'fade expands 3-digit hex');
eq(P.fade('#6366f1', 1), 'rgba(99,102,241,1)', 'fade splits 6-digit hex into channels');
eq(P.fade('000000', 0), 'rgba(0,0,0,0)', 'fade tolerates a missing #');

// ---- hashHue: stable, and never inside the families' reserved 140-259 arc --
eq(P.hashHue(''), 260, 'hashHue("") is the arc start');
eq(P.hashHue('abc'), P.hashHue('abc'), 'hashHue is deterministic');
{
  const names = Array.from({ length: 2000 }, (_, i) => `model-${i}-${(i * 7919).toString(36)}`);
  const bad = names.map(P.hashHue).filter(h => !Number.isInteger(h) || h < 0 || h >= 360 || (h >= 140 && h < 260));
  eq(bad.length, 0, 'hashHue stays out of the 140-259 family band over 2000 names');
  eq(new Set(names.map(P.hashHue)).size > 200, true, 'hashHue actually spreads (>200 distinct hues)');
}

// ---- famOf: first match wins, in FAMILY order --------------------------
eq(P.famOf('anthropic/Claude-Opus-4').key, 'claude', 'famOf is case-insensitive');
eq(P.famOf('glm-4.6').key, 'opencode', 'famOf glm -> opencode');
eq(P.famOf('deepseek-r1').key, 'deepseek', 'famOf deepseek');
eq(P.famOf('gpt-oss-120b').key, 'local', 'famOf gpt-oss is local, not codex (local precedes codex)');
eq(P.famOf('gpt-5').key, 'codex', 'famOf gpt-5 -> codex');
eq(P.famOf('mystery-1'), { key: 'other', h: 60, s: 55 }, 'famOf unknown -> shared other family');
eq(P.famOf(null).key, 'other', 'famOf(null) does not throw');

// ---- buildColors -------------------------------------------------------
eq(P.buildColors(['claude-opus']), { 'claude-opus': 'hsl(17 66% 55%)' }, 'lone family member gets the base shade');
// n=2: spread 46 -> hues 17-23=-6 (wraps to 354) and 17+23=40; zig-zag light 40 / 40+26+12=78; sat 66 / 66-14=52.
eq(P.buildColors(['claude-opus', 'claude-haiku']),
  { 'claude-haiku': 'hsl(354 66% 40%)', 'claude-opus': 'hsl(40 52% 78%)' },
  'two siblings fan +-23deg, wrap below 0, and zig-zag lightness');
const entries = o => Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1));
eq(entries(P.buildColors(['gpt-5', 'claude-a', 'claude-b'])),
  entries(P.buildColors(['claude-b', 'gpt-5', 'claude-a', 'claude-a'])),
  'buildColors ignores input order and duplicates');
{
  const fam = Array.from({ length: 12 }, (_, i) => `claude-${String.fromCharCode(97 + i)}`);
  const hues = Object.values(P.buildColors(fam)).map(c => +c.match(/hsl\((\d+)/)[1]);
  const off = hues.map(h => ((h - 17 + 540) % 360) - 180);   // signed distance from base
  eq(Math.max(...off.map(Math.abs)) <= 46, true, 'a crowded family fans at most 92deg (+-46)');
  const lights = Object.values(P.buildColors(fam)).map(c => +c.match(/(\d+)%\)$/)[1]);
  eq(Math.max(...lights) <= 78, true, 'lightness is capped at 78%');
}

// ---- colorOf falls back through the family, not to one grey ------------
eq(P.colorOf('claude-new'), 'hsl(17 66% 55%)', 'colorOf unknown claude -> claude base');
eq(P.colorOf('who-knows'), 'hsl(60 55% 55%)', 'colorOf unknown model -> other family');

// ---- allModelNames / allToolNames read the payload, not the filter ------
DATA.profiles = {
  a: { rows: [{ model: 'openrouter/anthropic/claude-x' }], live: [{ model: 'p/m1', init_model: 'm0' }],
       health: [{ model: 'h/hm' }, null], failures_recent: [{ model: 'fm' }, {}],
       tools_recent: [{ tool: 'zz_tool' }], logs: [{ tool: 'terminal' }, {}] },
  b: {},
};
DATA.errors = [{ model: 'em', tool: 'err_tool' }, null];
eq(P.allModelNames().sort(), ['claude-x', 'em', 'fm', 'hm', 'm0', 'm1'],
  'allModelNames short-names every source and never emits health indices');
{
  const t = P.allToolNames();
  eq(['zz_tool', 'err_tool', 'terminal'].every(x => t.includes(x)), true, 'allToolNames merges live, logs and errors');
  eq(P.TOOL_ROSTER.every(x => t.includes(x)), true, 'allToolNames always includes the fixed roster');
  eq(new Set(t).size, t.length, 'allToolNames has no duplicates');
}

// ---- tools -------------------------------------------------------------
eq(P.toolFam('terminal'), P.TOOL_FAM[1], 'toolFam terminal -> exec family');
eq(P.toolFam('weird_tool'), { h: P.hashHue('weird_tool'), s: 52 }, 'toolFam unknown -> hashed hue');
eq(P.buildToolColors(['terminal']), { terminal: 'hsl(34 78% 58%)' }, 'lone tool gets its family base');
// cron family h15: n=2 spread 26 -> 2.0 / 28.0; light 46 / 46+16+10=72; sat 50 / 43.
eq(P.buildToolColors(['cronjob_manage', 'computer_use']),
  { computer_use: 'hsl(2.0 50% 46.0%)', cronjob_manage: 'hsl(28.0 43% 72.0%)' },
  'tool siblings fan hue and alternate lightness');
{
  const fam = ['chat_history_lookup', 'computer_use', 'cronjob_manage', 'desktop_preview'];
  const out = P.buildToolColors(fam);
  // n=4 spread 36: first hue 15-18=-3 must wrap to 357.0, never emit hsl(-3 ...).
  eq(out.chat_history_lookup.startsWith('hsl(357.0 '), true, 'tool hue below 0 wraps into 0-360');
  eq(Object.values(out).every(c => { const h = +c.slice(4).split(' ')[0]; return h >= 0 && h < 360; }), true,
    'every tool hue is inside 0-360');
  eq(entries(P.buildToolColors([...fam].reverse())), entries(out), 'buildToolColors ignores input order');
}
eq(P.toolColor('nope'), `hsl(${P.hashHue('nope')} 52% 58%)`, 'toolColor unknown -> hashed fallback');

// ---- formatters --------------------------------------------------------
eq([P.fmt(999), P.fmt(1500), P.fmt(2e9), P.fmt(null), P.fmt('12.6')], ['999', '1.5K', '2.0B', '0', '13'],
  'fmt picks K/M/B and rounds below 1K');
eq([P.fmtB(1023), P.fmtB(1024), P.fmtB(1536), P.fmtB(10 * 1048576), P.fmtB(undefined)],
  ['1023 B', '1.00 KB', '1.50 KB', '10.0 MB', '0 B'], 'fmtB uses binary units, 2dp under 10');
eq([P.fmtRate(0), P.fmtRate(null), P.fmtRate(Infinity), P.fmtRate(-5), P.fmtRate(2048)],
  ['', '', '', '', '2.00 KB/s'], 'fmtRate blanks non-positive/non-finite rates');
eq(P.money(0), '—', 'money(0) is an em dash, not $0.00');
eq(/^\$1.?234\.50$/.test(P.money(1234.5)), true, 'money keeps 2dp', P.money(1234.5));
eq(P.short('openrouter/anthropic/claude'), 'claude', 'short keeps the last path segment');
eq([P.short(undefined), P.short(null)], ['', ''], 'short of a missing model is empty, so `|| fallback` fires (#138)');
eq(P.esc('<a href="x">&</a>'), '&lt;a href="x"&gt;&amp;&lt;/a&gt;', 'esc escapes & < >');
eq(P.esc(null), '', 'esc(null) is empty');
eq(P.escA('"t"<'), '&quot;t&quot;&lt;', 'escA also escapes quotes');
eq([P.ago(59), P.ago(60), P.ago(90), P.ago(3600), P.ago(7200)], ['59s', '1m', '2m', '1h', '2h'], 'ago picks s/m/h');
eq(P.catOf('Coding').c, '#22c55e', 'catOf known category');
eq(P.catOf('Nope'), { c: '#6b7280', i: '•' }, 'catOf unknown -> neutral');
eq(P.slugOf('NowInv'), 'nowinv', 'slugOf lowercases');

// ---- costCell ----------------------------------------------------------
eq(P.costCell(1.234, false), '$1.23', 'costCell billed -> 2dp');
eq(P.costCell(1.234, true).includes('~$1.23'), true, 'costCell local >=1 -> 2dp electricity');
eq(P.costCell(0.05, true).includes('~$0.050'), true, 'costCell local cents -> 3dp');
eq(P.costCell(0.005, true).includes('~$0.0050'), true, 'costCell local sub-cent -> 4dp');
eq(P.costCell(0, true).includes('~$0 '), true, 'costCell local zero -> 0');
eq(P.costCell(9, false, 'unpriced').includes('class="unpriced"'), true, 'costCell unpriced overrides the value');
eq(P.costCell(9, false, 'freetier').includes('free tier'), true, 'costCell free tier');

// ---- emptyHTML escapes user text ---------------------------------------
eq(P.emptyHTML('i', '<b>', null), '<div class="empty"><div class="e-ico">i</div><div class="e-msg">&lt;b&gt;</div></div>',
  'emptyHTML escapes msg and omits an absent hint');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
