// #150: drawer.js's Logs-page half as a unit — filtering, facets, the active
// strip, the transcript renderer and the timeline colours, no page load.
//
// The module's real palette is loaded first and passed in as the stub, so the
// escaping and number formatting under test are the ones the page uses rather
// than a friendly double. `fetch` is a global the module calls later, so it is
// installed on globalThis.
//
// Expected values are hand-derived from the source rules (the facet test order,
// the window cutoff `(p.generated || now/1000) - lgWindow*3600`, the haystack,
// `rows.slice(0, 1200)`, the tag/meta rules, LN_LANES), NOT captured from output.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);
const has = (hay, needle, name) => chk(String(hay).includes(needle), name, String(hay).slice(0, 160));

// ---- a DOM that records what it is told --------------------------------
const mkEl = () => {
  const cls = new Set();
  return {
    innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (on ? cls.add(c) : cls.delete(c))), contains: c => cls.has(c) },
    _cls: cls, appendChild() {}, remove() {}, focus() {}, setAttribute() {},
    addEventListener(type, fn) { (this._on ||= {})[type] = fn; },
    insertAdjacentHTML(pos, html) { this.innerHTML += html; },
    querySelectorAll: () => [],
  };
};
const registry = {};
globalThis.document = {
  getElementById: id => (registry[id] ||= mkEl()),
  querySelector: () => (registry.__viewLogs ||= mkEl()),
  querySelectorAll: () => [], addEventListener() {}, activeElement: null,
};
globalThis.window = { addEventListener() {}, scrollY: 0, innerWidth: 1200 };
const fetched = [];
globalThis.fetch = async url => {
  fetched.push(url);
  return fetchReply;
};
let fetchReply = { ok: true, status: 200, json: async () => PAYLOAD };

// ---- payload -----------------------------------------------------------
const H = 3600;
const GEN = 1_000_000;                       // the profile's generated_at
const ev = (o) => ({ ts: GEN - 60, level: 'info', role: 'assistant', tool: '', model: '', session: 'sess-1', preview: '', title: '', kind: '', ...o });
const PAYLOAD = {
  schema_version: 1, generated: GEN, window_h: 24,
  profiles: {
    p1: {
      generated: GEN, window_h: 24, events_total: 5, events_shown: 5, capped: false,
      facets: {
        role: [{ v: 'user', n: 2 }, { v: 'assistant', n: 1 }],
        tool: [{ v: 'read', n: 1 }],
        model: [{ v: 'openai/gpt-5', n: 1 }],
        session: [{ v: 'sess-1', n: 3, label: 'Fix login' }],
        kind: [],
      },
      events: [
        ev({ ts: GEN - 60, role: 'user', preview: 'please Fix the login', title: 'T1', tool: 'read', model: 'openai/gpt-5' }),
        ev({ ts: GEN - 120, role: 'assistant', tool: 'read', model: 'openai/gpt-5', preview: 'done' }),
        ev({ ts: GEN - 5 * H, role: 'user', preview: 'recent, but older than an hour' }),
        ev({ ts: GEN - 30 * H, role: 'user', preview: 'ancient' }),          // outside the 24h window
        ev({ ts: GEN - 90, level: 'error', kind: 'throttle', preview: '429' }),
      ],
    },
  },
};

// ---- load the module with its real palette -----------------------------
const PAL = await isolate('palette.js', { 'main.js': { DATA: {} }, 'views.js': { PROV: {} } });
// isolate() refuses stub keys the module does not import, so hand it exactly
// the names drawer.js takes from the palette — the real functions, not doubles.
const PAL_NAMES = ['$', 'COLORS', 'TOOLCOLORS', 'colorOf', 'emptyHTML', 'esc', 'fmt', 'hashHue', 'short', 'toolColor'];
const PALSTUB = Object.fromEntries(PAL_NAMES.map(k => [k, PAL[k]]));
const D = await isolate('drawer.js', {
  'palette.js': PALSTUB,
  'charts.js': { current: 'p1' },
  'views.js': { schemaProblem: (p) => (p && p.schema_version === 1 ? null : 'schema 1 expected') },
  'router.js': { pickView() {} },
  'main.js': { DATA: { profiles: {} } },
});

// Before a load there is nothing to profile.
eq(D.lgProfile(), null, 'no logs payload means no profile');
eq(D.lgProfile === undefined, false, 'lgProfile is exported');

// ---- a successful load -------------------------------------------------
await D.loadLogs();
eq(fetched[0].startsWith('logs-data.json?t='), true, 'loadLogs fetches logs-data.json with a cache-buster');
eq(fetched[0].includes('t=') && !fetched[0].includes('&'), true, 'the cache-buster is the only query parameter');
eq(D.lgProfile() === PAYLOAD.profiles.p1, true, 'the current profile is used when present');
eq(registry['lgcount'].textContent, '4 shown', 'the 24h window hides the 30h-old event');
eq(registry['lgscope'].textContent, 'last 24h · 5 events', 'the scope line reports the whole window, not the filter');
eq(registry['lgcountbadge'].hidden, true, 'no active filters hides the badge');
eq(registry['lgcap'].hidden, true, 'an uncapped payload hides the cap note');
eq((registry['lglist'].innerHTML.match(/class="lgev"/g) || []).length, 4, 'one row per matching event');
has(registry['lglist'].innerHTML, '<span class="lgtag error">throttle</span>', 'an error row tags the failure kind');
has(registry['lglist'].innerHTML, '<span class="lgtag user">read</span>',
    'a non-error row tags the tool but colours it by role');
has(registry['lglist'].innerHTML, 'Fix the login', 'the preview is escaped, not raw');
has(registry['lglist'].innerHTML, 'gpt-5', 'the meta line shortens the model name');
eq(registry['lglist'].innerHTML.match(/data-i="\d+"/g).join(','), 'data-i="0",data-i="1",data-i="2",data-i="3"',
   'row indexes are re-based to the filtered list');

// Facet chips: counts, and the kind row hidden when the payload has no kinds.
has(registry['lgf-role'].innerHTML, 'data-facet="role" data-val="user"', 'role chips carry the facet key and value');
has(registry['lgf-role'].innerHTML, '<span class="n">2</span>', 'a chip carries its count');
eq(registry['lgrow-kind'].hidden, true, 'the failure facet row hides when the payload has no kinds');
has(registry['lgf-session'].innerHTML, 'Fix login', 'a session chip uses its human label when there is one');

// ---- filtering, through the real click path ----------------------------
D.logsInstall();
const onLogsView = registry.__viewLogs._on.click;
const clickFacet = (facet, val) => onLogsView({ target: { closest: sel => (sel === '[data-facet]' ? { dataset: { facet, val } } : null) } });
const clickWin = win => onLogsView({ target: { closest: sel => (sel === '[data-win]' ? { dataset: { win } } : null) } });

clickFacet('tool', 'read');
eq(registry['lgcount'].textContent, '2 shown', 'clicking a tool facet filters to that tool');
eq(registry['lgcountbadge'].hidden, false, 'an active filter shows the badge');
eq(registry['lgcountbadge'].textContent, '1 filter active', 'the badge counts the facets');
has(registry['lgactive'].innerHTML, 'Tool: read', 'the active strip names the facet and its value');
eq(registry['lgactive']._cls.has('show'), true, 'the active strip is shown');
has(registry['lgf-tool'].innerHTML, 'class="lgchip on"', 'the source chip is marked on');
clickFacet('tool', 'read');
eq(registry['lgcount'].textContent, '4 shown', 'clicking the same chip clears it');
eq(registry['lgactive']._cls.has('show'), false, 'an empty active strip is hidden');
eq(registry['lgactive'].innerHTML.includes('×'), false, 'no chips means no remove buttons');

// The window control narrows on the same events.
clickWin('1');
eq(registry['lgcount'].textContent, '3 shown', 'a 1h window drops the 5h-old row');
clickWin('24');
eq(registry['lgcount'].textContent, '4 shown', 'switching back to 24h restores the row');

// A second facet adds to the first, and two toggles count as two.
clickFacet('model', 'openai/gpt-5');
clickFacet('role', 'user');
eq(registry['lgcountbadge'].textContent, '2 filters active', 'two facets are plural');
eq(registry['lgcount'].textContent, '1 shown', 'facets combine with AND');

// Free text searches preview, tool, title, model and session together.
registry['lgq']._on.input({ target: { value: '  FIX  ' } });
eq(registry['lgcount'].textContent, '1 shown', 'the text query is trimmed, lowercased and matched');
registry['lgq']._on.input({ target: { value: 'nothing-here' } });
eq(registry['lgcount'].textContent, '0 shown', 'a query that matches nothing shows zero');
has(registry['lglist'].innerHTML, 'Nothing matches these filters', 'an empty result says so instead of staying blank');
registry['lgq']._on.input({ target: { value: '' } });
eq(registry['lgcount'].textContent, '1 shown', 'clearing the query restores the facet-limited rows');
chk(registry['lgf-level'].innerHTML.includes('error') && registry['lgf-level'].innerHTML.includes('info'),
    'the level facet is derived from the events themselves', registry['lgf-level'].innerHTML);

// Un-clicking from the summary strip is the same as un-clicking the chip.
const clickUnfacet = (facet, val) => onLogsView({ target: { closest: sel => (sel === '[data-unfacet]' ? { dataset: { unfacet: facet, val } } : null) } });
clickUnfacet('role', 'user');
eq(registry['lgcountbadge'].textContent, '1 filter active', 'removing from the strip clears the facet');
clickUnfacet('model', 'openai/gpt-5');
eq(registry['lgcountbadge'].hidden, true, 'removing the last facet hides the badge');
eq(registry['lgcount'].textContent, '4 shown', 'removing every facet shows the whole window again');

// ---- labels -----------------------------------------------------------
eq(D.lgActiveLabel('model', 'openai/gpt-5'), 'gpt-5', 'a model label is shortened to its last segment');
eq(D.lgActiveLabel('session', 'sess-1'), 'Fix login', 'a session label prefers the payload label');
eq(D.lgActiveLabel('session', '0123456789abcdef'), '01234567', 'a session with no label is truncated to 8');
eq(D.lgActiveLabel('tool', 'read'), 'read', 'other facets are shown as they are');
eq(D.LG_FACET_NAMES.kind, 'Failure', 'the kind facet is labelled Failure, not Kind');
eq(Object.keys(D.LG_FACET_NAMES).sort(), ['kind', 'level', 'model', 'role', 'session', 'tool'],
   'every facet the page filters on is named');
eq(Object.keys(D.lgSel).sort(), ['kind', 'level', 'model', 'role', 'session', 'tool'],
   'the facet selector map and the label map cover the same keys');

// ---- chips and the active strip ---------------------------------------
registry['lgf-x'] = mkEl();
D.lgChips('lgf-x', 'tool', [], null);
has(registry['lgf-x'].innerHTML, 'none', 'an empty facet renders none');
D.lgChips('lgf-x', 'tool', [{ v: 'read', n: 3 }], null);
has(registry['lgf-x'].innerHTML, '<span class="n">3</span>', 'a chip without a labeller still counts');
D.lgChips('lgf-x', 'tool', [{ v: 'a<b', n: 1 }], null);
has(registry['lgf-x'].innerHTML, 'data-val="a&lt;b"', 'a chip value is escaped into its attribute');
D.lgChips('lgf-x', 'tool', [{ v: 'deadbeef', n: 1, label: 'Nice' }], it => it.label);
has(registry['lgf-x'].innerHTML, '>Nice<span', 'a labeller decides the chip text');
D.lgChips('lgf-x', 'model', [{ v: 'openai/gpt', n: 1 }], it => D.lgActiveLabel('model', it.v));
has(registry['lgf-x'].innerHTML, '>gpt<span', 'the model facet label goes through the same shortener');

// ---- errors from the collector ----------------------------------------
const registry2 = {};
globalThis.document.getElementById = id => (registry2[id] ||= mkEl());
fetchReply = { ok: false, status: 404, json: async () => ({}) };
const D2 = await isolate('drawer.js', {
  'palette.js': PALSTUB, 'charts.js': { current: 'p1' }, 'views.js': { schemaProblem: () => null },
  'router.js': { pickView() {} }, 'main.js': { DATA: { profiles: {} } },
});
await D2.loadLogs();
has(registry2['lglist'].innerHTML, 'Could not load logs-data.json (HTTP 404)', 'a failed fetch is named with its status');
has(registry2['lglist'].innerHTML, 'llm-telemetry logs', 'the error says which command produces the file');
has(registry2['lglist'].innerHTML, 'file://', 'the error mentions the file:// fetch block');
eq(D2.lgProfile(), null, 'a failed load leaves no profile');

fetchReply = { ok: true, status: 200, json: async () => ({ generated: 1, profiles: {} }) };
const registry3 = {};
globalThis.document.getElementById = id => (registry3[id] ||= mkEl());
const D3 = await isolate('drawer.js', {
  'palette.js': PALSTUB, 'charts.js': { current: 'p1' },
  'views.js': { schemaProblem: () => 'logs-data.json has schema 1, this page expects 2' },
  'router.js': { pickView() {} }, 'main.js': { DATA: { profiles: {} } },
});
await D3.loadLogs();
has(registry3['lglist'].innerHTML, 'expects 2', 'a schema mismatch is reported instead of rendering');
// A payload with no profile for the current tab, and none at all, both say so.
const registry4 = {};
globalThis.document.getElementById = id => (registry4[id] ||= mkEl());
fetchReply = { ok: true, status: 200, json: async () => ({ generated: 1, profiles: { other: { events: [], facets: {}, window_h: 24, events_total: 0 } } }) };
const D4 = await isolate('drawer.js', {
  'palette.js': PALSTUB, 'charts.js': { current: 'px' }, 'views.js': { schemaProblem: () => null },
  'router.js': { pickView() {} }, 'main.js': { DATA: { profiles: {} } },
});
await D4.loadLogs();
eq(D4.lgProfile() === null, false, 'an unknown current tab falls back to the first profile');
eq(D4.lgProfile().events_total, 0, 'the fallback is the first profile in the payload');
has(registry4['lglist'].innerHTML, 'Nothing matches these filters', 'a profile with no events says nothing matches');
globalThis.document.getElementById = id => (registry[id] ||= mkEl());

// ---- transcript rendering --------------------------------------------
eq(D.tEscape(null), '', 'tEscape(null) is empty, not "null"');
eq(D.tEscape('<b>'), '&lt;b&gt;', 'tEscape escapes markup');
eq(D.tRenderContent('plain'), 'plain', 'plain content passes through');
has(D.tRenderContent('see https://example.com/x now'), '<a href="https://example.com/x"', 'a bare link becomes an anchor');
has(D.tRenderContent('see https://example.com/x now'), 'rel="noopener noreferrer"', 'the anchor is rel-safe');
has(D.tRenderContent('```\ncode\n```'), '<pre>', 'a fenced block becomes a pre');
has(D.tRenderContent('```\n<b>\n```'), '&lt;b&gt;', 'a fenced block is still escaped');
eq(D.tRenderContent('<script>alert(1)</script>').includes('<script'), false, 'a literal script tag can never be emitted');
has(D.tRenderContent('data:image/png;base64,AAAB'), '<img class="timg"', 'a base64 image becomes an img');
has(D.tRenderContent('data:image/png;base64,AAAB'), 'tbroken', 'the image has a broken-image fallback');

const msg = D.tRenderMsg({ role: 'user', content: 'hi', ts: 0 });
has(msg, 'role-user', 'a message carries its role as a class');
has(msg, '>user<', 'the role label is the role');
eq(D.tRenderMsg({ role: 'system', content: 'x' }).includes('role-assistant'), true,
   'an unknown role renders as assistant rather than leaking into the class');
eq(D.tRenderMsg({ role: 'user', content: 'x' }).includes('trole">user<'), true, 'a message with no ts shows no time');
eq(D.tRenderMsg({ role: 'user', content: 'x', ts: 1 }).includes(' · '), true, 'a timestamped message shows a time');
has(D.tRenderMsg({ role: 'assistant', content: '', tool_calls: [{ name: 'read' }, { function: { name: 'write' } }] }),
    '&#8594; read, write', 'tool calls list both shapes of name');
has(D.tRenderMsg({ role: 'tool', content: '', tool_name: 'read' }), '&#8594; read result', 'a result message names its tool');
has(D.tRenderMsg({ role: 'assistant', content: '', tool_calls: [] }), '&#8594; tool call',
    'an empty tool_calls list falls back to a generic label');

// ---- timeline colours and lanes ---------------------------------------
eq(D.lnColorOf('compaction'), '#c4a06e', 'compaction has its own colour (calmed)');
eq(D.lnColorOf('user'), '#64748b', 'user has its own colour');
eq(D.lnColorOf('gpt-4o'), PAL.COLORS['gpt-4o'] || D.lnColorOf('gpt-4o'), 'a colour-map key is used as-is');
eq(D.lnColorOf('bash').startsWith('hsl('), true, 'an unknown key gets a stable hashed colour');
eq(D.lnColorOf('bash'), D.lnColorOf('bash'), 'the hashed colour is stable for the same key');
eq(D.lnColorOf('bash') === D.lnColorOf('zsh'), false, 'different unknown keys hash differently');
eq(D.LN_LANES, ['model', 'tool', 'delegation', 'compaction', 'user'], 'the lane order is the documented one');
eq(D.LN_LANES.map(l => D.LN_LANE_LABELS[l]), ['Model', 'Tool', 'Delegation', 'Compaction', 'User'],
   'every lane has a label');

const tlEv = {
  id: 's1', title: 'Fix login', running: false, end_reason: 'completed',
  models: ['openai/gpt-5'], input_tokens: 1234, output_tokens: 56, actual_cost_usd: 0.1234,
  axis_start: 100, axis_end: 200,
  spans: [
    { lane: 'model', start: 100, end: 150, color_key: 'gpt-4o', label: 'call', meta: { a: 1 } },
    { lane: 'tool', start: 150, end: 150, color_key: 'bash', label: 'tick', failed: true },
  ],
};
D.lnRenderTimeline(tlEv);
const tlBody = registry['lnbody'];
eq(registry['lntitle'].textContent, 'Fix login', 'the timeline title comes from the payload');
eq(registry['lnsub'].textContent, 'completed', 'a finished session shows its end reason');
has(registry['lnmeta'].textContent, '1,234 in / 56 out', 'token counts are locale-formatted');
has(registry['lnmeta'].textContent, '$0.1234', 'cost keeps 4dp');
has(tlBody.innerHTML, 'left:0%', 'the first span starts at the axis origin');
has(tlBody.innerHTML, 'width:50%', 'a 50-of-100 span is half the track');
has(tlBody.innerHTML, 'lnspan lnfail lntick', 'a failed zero-length span is both a tick and a failure');
has(tlBody.innerHTML, 'data-lnidx="1"', 'spans keep their index across lanes');
has(tlBody.innerHTML, 'lnlanename">Model<', 'lanes are labelled with their human name');
has(tlBody.innerHTML, 'lnlanename">Delegation<', 'every lane gets a row even when it is empty');
D.lnRenderTimeline({ id: 's2', running: true, axis_start: 0, axis_end: 0, spans: [] });
has(registry['lnsub'].textContent, 'running', 'a running session says so');
has(registry['lnmeta'].textContent, 'still running', 'the meta line repeats that it is running');
has(registry['lnmeta'].textContent, '(unknown model)', 'a payload with no models says unknown');
eq((registry['lnbody'].innerHTML.match(/class="lnlane"/g) || []).length, 5, 'all five lanes render');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
