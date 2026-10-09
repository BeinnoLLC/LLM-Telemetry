// #148: "Export CSV" on the Analytics per-model table. The table could be
// ranged and filtered, but the only way to get the numbers out was a
// screenshot. The export reads the rendered table back, so the file can never
// contain a row the user cannot see, or miss one they can.
//
// Expectations are hand-derived from RFC 4180 (quote when a value holds a
// comma, a quote or a newline; double the quotes; CRLF between records; a header
// row always) and from the reading rules in tableToRows (thead/tbody, or a flat
// table whose first row is the header; whitespace collapsed). Nothing here is
// captured from output.
import { isolate } from './lib/isolate.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);
const has = (hay, needle, name) => chk(String(hay).includes(needle), name, String(hay).slice(0, 200));

// ---- the sheet under test ----------------------------------------------
const cell = text => ({ textContent: text });
const row = texts => ({ querySelectorAll: () => texts.map(cell) });
// A flat table like #tbl: row 0 is the header, and a "cell" may be a td.
const flat = (rows, thFirst = true) => ({
  querySelectorAll: sel => {
    if (sel === 'thead tr:first-child th, thead tr:first-child td') return [];
    if (sel === 'tbody tr') return [];
    if (sel === 'tr') return rows.map(r => ({
      querySelectorAll: () => r.map(t => cell(t)),
    }));
    return [];
  },
});
const grouped = (head, body) => ({
  querySelectorAll: sel => {
    if (sel.startsWith('thead')) return head.map(cell);      // real DOM hands back the cells
    if (sel === 'tbody tr') return body.map(row);
    return [];
  },
});

// ---- a document that records the download ------------------------------
const listeners = {};
const downloads = [];
let blobs = [];
globalThis.document = {
  addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
  createElement: tag => {
    const el = { tag, href: '', download: '', clicks: 0,
      click() { this.clicks++; downloads.push({ download: this.download, href: this.href }); },
      remove() {} };
    return el;
  },
  body: { appendChild() {}, children: [] },
  head: { appendChild() {} },
  getElementById: () => null,
};
globalThis.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; blobs.push(this); } };
// The real URL constructor is still needed below to resolve this file's own
// paths, so keep a handle before the download stub replaces it.
const RealURL = globalThis.URL;
globalThis.URL = { createObjectURL: b => 'blob:fake/' + blobs.indexOf(b), revokeObjectURL() {} };
let fetched = 0;
globalThis.fetch = () => { fetched++; return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); };

// The real palette gives esc/ago/costCell their real behaviour; the rest of
// views.js's siblings are stubbed, because the CSV code does not touch them.
const P = await isolate('palette.js', {
  'charts.js': { bounds: () => [0, 1], current: null },
  'views.js': { PROV: {}, provIcon: () => '', render: () => {} },
  'router.js': { presets: () => {} },
  'main.js': { DATA: {}, css: () => {} },
});
const DOM = new Map();
globalThis.__dom = DOM;
const V = await isolate('views.js', {
  'palette.js': {
    $: id => DOM.get(id) || null,
    AC: '#AC', BD: '#BD', MU: '#MU', PAL: P.PAL, ago: P.ago, colorOf: m => 'col:' + m,
    costCell: P.costCell, emptyHTML: P.emptyHTML, esc: P.esc, escA: P.escA, fade: P.fade,
    fmt: P.fmt, fmtB: P.fmtB, ic: () => '', icon: P.icon, money: P.money, short: P.short,
    stampFreshness: P.stampFreshness,
  },
  'charts.js': { PROJ_WEIGHT: {}, PROJ_WEIGHT_LABELS: {}, agg: () => [], charts: {}, ctxSpark: () => '',
    current: 'p1', mk: () => ({}), noLeg: () => '', olBar: () => '', projDistNormalized: () => [],
    projTrendStacked: () => '', radialRing: () => '', sparkSvg: () => '', weightValue: () => 0 },
  'flow.js': { flowControls: () => '', renderFlow: () => {} },
  'live.js': { renderLive: () => {} },
  'routerview.js': { renderRouterView: () => {}, routerStat: () => '' },
  'quotaview.js': { renderQuotaView: () => {}, qvStat: () => '' },
  'router.js': { HOUR_RANGE: null, MODEL_FILTER: '', POWER: '', PROJECT_FILTER: '', PROVIDER_FILTER: '',
    clearCrossFilters: () => {}, hourRowsFor: () => [], pickView: () => {}, setCrossFilter: () => {},
    setHash: () => {}, view: 'Detail' },
  'main.js': { DATA: { schema_version: 1, profiles: { p1: {} } }, SCHEMA_VERSION: 1, LOCAL_HOSTS: [], css: () => '#888' },
});

// ---- RFC 4180 quoting ---------------------------------------------------
eq(V.tblCsv(['a', 'b'], [['1', '2']]), 'a,b\r\n1,2\r\n', 'a plain two-column sheet is written with CRLF and a trailing newline');
eq(V.tblCsv(['h'], []), 'h\r\n', 'an empty range still produces the header line');
eq(V.tblCsv(['h'], undefined), 'h\r\n', 'missing rows are treated as an empty range');
eq(V.tblCsv([], []), '\r\n', 'an empty header is still a record boundary');
eq(V.tblCsv(['a', 'b'], [['1', '2'], ['3', '4']]).split('\r\n').length, 4, 'two rows produce three records plus the trailing empty string');
has(V.tblCsv(['h'], [['x,y']]), '"x,y"', 'a comma inside a value is quoted');
has(V.tblCsv(['h'], [['say "hi"']]), '"say ""hi"""', 'a quote inside a value is doubled and the value quoted');
has(V.tblCsv(['h'], [['one\ntwo']]), '"one\ntwo"', 'a newline inside a value is quoted');
has(V.tblCsv(['h'], [['cr\rlf']]), '"cr\rlf"', 'a carriage return inside a value is quoted');
eq(V.tblCsv(['h'], [['plain']]), 'h\r\nplain\r\n', 'an ordinary value is not quoted');
eq(V.tblCsv(['h'], [[' has spaces ']]), 'h\r\n has spaces \r\n', 'spaces alone do not trigger quoting');
eq(V.tblCsv(['h'], [['']]), 'h\r\n\r\n', 'an empty value is an empty field, not a quoted one');
eq(V.tblCsv(['h'], [[null]]), 'h\r\n\r\n', 'null becomes an empty field');
eq(V.tblCsv(['h'], [[undefined]]), 'h\r\n\r\n', 'undefined becomes an empty field');
eq(V.tblCsv(['h'], [[3]]), 'h\r\n3\r\n', 'a number is written as its decimal text');
has(V.tblCsv(['h'], [['a', 'b,c']]), 'a,"b,c"', 'quoting is per field, not per row');
chk(!V.tblCsv(['h'], [['a']]).includes('"a"'), 'a value without a special character is never quoted');

// ---- reading the rendered table back -----------------------------------
eq(V.tableToRows(flat([['Model', 'Calls'], ['gpt', '4'], ['claude', '2']])),
   { header: ['Model', 'Calls'], rows: [['gpt', '4'], ['claude', '2']] },
   'a flat table takes its header from the first row and the rest as data');
eq(V.tableToRows(grouped(['M', 'N'], [['a', '1']])),
   { header: ['M', 'N'], rows: [['a', '1']] },
   'a table with thead/tbody is read from those sections');
eq(V.tableToRows(flat([['  Model\n  ', 'Calls  '], ['  gpt   4 ', '']])).rows[0],
   ['gpt 4', ''], 'cell text is whitespace-collapsed and trimmed');
eq(V.tableToRows(null), { header: [], rows: [] }, 'a missing table reads as empty, not a crash');
eq(V.tableToRows({}), { header: [], rows: [] }, 'an element without querySelectorAll reads as empty');
eq(V.tableToRows(flat([])), { header: [], rows: [] }, 'an empty table has no header and no rows');
eq(V.tableToRows(flat([['only']])).rows.length, 0, 'a table with only a header has no data rows');

// ---- the filename carries the range ------------------------------------
eq(V.csvFilename('2026-10-01', '2026-10-09'), 'llm-telemetry-models-2026-10-01_2026-10-09.csv',
   'the filename carries both ends of the range');
eq(V.csvFilename('', ''), 'llm-telemetry-models-all_all.csv', 'an empty range says all rather than nothing');
eq(V.csvFilename(null, undefined), 'llm-telemetry-models-all_all.csv', 'a missing range says all');
eq(V.csvFilename('a/b c', 'x'), 'llm-telemetry-models-a-b-c_x.csv',
   'characters that cannot go in a filename are replaced');
chk(V.csvFilename('2026-10-09', '2026-10-09').endsWith('.csv'), 'the name keeps its extension');

// ---- the exported count is the rendered count --------------------------
DOM.set('tbl', flat([['Model', 'Provider', 'Calls', 'Cost'],
                     ['gpt', 'openai', '4', '1.20'],
                     ['claude', 'anthropic', '2', '3.40'],
                     ['llama', 'local', '9', '~$0.02']]));
DOM.set('from', { value: '2026-10-01' });
DOM.set('to', { value: '2026-10-09' });
const rendered = DOM.get('tbl').querySelectorAll('tr').length - 1;
const out = V.exportTableCsv();
eq(out.rows, rendered, 'the exported row count equals the rendered row count');
eq([out.rows, out.columns], [3, 4], 'three data rows and four columns for this table');
eq(out.filename, 'llm-telemetry-models-2026-10-01_2026-10-09.csv', 'the download is named for the current range');
eq(out.csv.split('\r\n').filter(Boolean).length, 4, 'the file holds a header plus three data records');
eq(out.csv.split('\r\n')[0], 'Model,Provider,Calls,Cost', 'the header row is the rendered header');
eq(fetched, 0, 'exporting performs no fetch: the rows are already in the page');
eq(downloads.length, 1, 'exactly one download was triggered');
eq(downloads[0].download, out.filename, 'the anchor carries the filename');
has(downloads[0].href, 'blob:', 'the anchor points at a blob URL');
eq(blobs.length, 1, 'one blob was created');
eq(blobs[0].type, 'text/csv;charset=utf-8', 'the blob is declared as UTF-8 CSV');
eq(blobs[0].parts[0], out.csv, 'the blob holds exactly the CSV that was returned');

// A range read from the inputs when no range is passed.
DOM.set('from', { value: '2026-09-01' });
DOM.set('to', { value: '2026-09-30' });
eq(V.exportTableCsv(DOM.get('tbl')).filename, 'llm-telemetry-models-2026-09-01_2026-09-30.csv',
   'the range comes from the date inputs when the caller does not give one');
eq(V.exportTableCsv(DOM.get('tbl'), '2026-01-01', '2026-01-02').filename,
   'llm-telemetry-models-2026-01-01_2026-01-02.csv', 'an explicit range wins over the inputs');

// An empty filtered range still downloads a valid, header-only file.
DOM.set('tbl', flat([['Model', 'Calls']]));
const empty = V.exportTableCsv(DOM.get('tbl'), '2026-10-01', '2026-10-09');
eq(empty.rows, 0, 'a filter that matches nothing exports zero rows');
eq(empty.csv, 'Model,Calls\r\n', 'and the file is the header alone, not empty');
chk(empty.csv.length > 0, 'the download is still a valid file');

// ---- the button is wired ------------------------------------------------
const before = downloads.length;
const ev = id => ({ target: { id, closest: () => null, contains: () => false } });
listeners.click.forEach(f => f(ev('csvexport')));
eq(downloads.length, before + 1, 'a click on #csvexport exports the table');
listeners.click.forEach(f => f(ev('somethingelse')));
eq(downloads.length, before + 1, 'a click elsewhere exports nothing');
chk(listeners.click.length > 0, 'views.js installs its click listener at load');

// ---- the shell ships the control ---------------------------------------
const html = readFileSync(new RealURL('../src/llm_telemetry/web/dashboard.html', import.meta.url), 'utf8');
has(html, 'id="csvexport"', 'the template has the export button');
has(html, 'class="csvbtn"', 'the button uses its own class');
const card = html.slice(Math.max(0, html.indexOf('Per-model detail') - 100), html.indexOf('Per-model detail') + 400);
has(card, 'id="csvexport"', 'the button sits with the per-model table it exports');
has(card, 'id="tbl"', 'the table it exports is the one beside it');
const css = readFileSync(new RealURL('../src/llm_telemetry/web/css/dashboard.css', import.meta.url), 'utf8');
has(css, '.csvbtn', 'the button is styled');
has(css, '.csvbtn:focus-visible', 'the button has a visible focus ring');
const built = readFileSync(new RealURL('../examples/reports/dashboard.html', import.meta.url), 'utf8');
has(built, 'id="csvexport"', 'the committed sample page ships the button');
has(built, 'llm-telemetry-models-', 'the committed sample page ships the export code');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
