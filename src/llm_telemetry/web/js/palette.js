/**
 * Palette: the colour system (hue hashing, family detection, ΔE
 * distinctness, tool colours) plus the shared formatting/escape helpers every
 * view uses. No DOM, no Chart.js — safe to import from anywhere.
 */
import { bounds, current } from './charts.js';
import { PROV, provIcon, render } from './views.js';
import { presets } from './router.js';
import { DATA, css } from './main.js';

export let AC, MU, BD, FG;
export function readTheme(){ AC=css('--accent'); MU=css('--muted'); BD=css('--border'); FG=css('--fg');
  Chart.defaults.color=MU; Chart.defaults.borderColor=BD; }
export const PAL = ['#6366f1','#22c55e','#f59e0b','#ef4444','#06b6d4','#a855f7','#ec4899','#84cc16','#eab308','#14b8a6'];

// Small line-icon set (Feather-style paths, stroke=currentColor) for KPI/nav
// badges — real vector glyphs read as considerably more "designed" than a
// single unicode character at the same 14-16px size, and they scale/align
// consistently across every font the OS might substitute. One entry per
// concept, reused anywhere a badge needs that meaning (KPI strip today,
// nav/home cards next).
export const ICON_SVG = {
  swap:   '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  zap:    '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  users:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  check:  '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  pulse:  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  play:   '<polygon points="5 3 19 12 5 21 5 3"/>',
  clock:  '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  grid:   '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  scale:  '<path d="M12 3v18M5 8l-3 5a4 4 0 0 0 8 0l-3-5M19 8l-3 5a4 4 0 0 0 8 0l-3-5M3 8h6M15 8h6"/>',
  cog:    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  updown: '<polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/>',
  alert:  '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
};
// icon(name, size): a ready-to-inline <svg> using the badge/link's own
// `color` via currentColor, so one glyph definition works on every accent.
export const icon = (name, size) => `<svg width="${size||16}" height="${size||16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_SVG[name]||''}</svg>`;
// Fade a hex colour to a translucent rgba(), so a filled series can sit under
// another without hiding it.
export const fade = (hex, a) => {
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
};

// One hue per model family, matching that family's provider badge. Every chart
// colours a model from this map, so "orange" always means Claude, "violet"
// always means an OpenCode model, etc. Shades vary within a family (lightness
// steps) so sibling models stay distinguishable without changing meaning.
// Base hues are spaced so that even a crowded family's fan (up to ~92 degrees)
// does not bleed into its neighbour: claude 17, codex 120, local 196,
// deepseek 262, opencode 320.
export const FAMILY = [
  {re:/claude|opus|sonnet|haiku/i,                 key:'claude',   h: 17, s:66},
  {re:/glm|kimi|minimax/i,                         key:'opencode', h:320, s:85},
  {re:/deepseek/i,                                 key:'deepseek', h:262, s:80},
  {re:/qwen|gpt-oss|nemotron|llama|mistral|phi|gemma/i, key:'local', h:196, s:88},
  {re:/gpt-|astra|luna|codex/i,                    key:'codex',    h:120, s:70},
];
// A model outside every known family still deserves its own colour — grouping
// them all under one grey means two unrelated models look identical. Derive a
// stable hue from the name, avoiding the arc already owned by the families
// above (162-250) so an unknown model never impersonates a known one.
export const FAM_OTHER = {key:'other', h:215, s:16};
export function hashHue(s){
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h*31 + s.charCodeAt(i)) | 0;
  // Usable arc: 260-500(=140) wrapping past red, skipping the family band.
  return (260 + (Math.abs(h) % 240)) % 360;
}
export function famOf(model){
  const m = (model||'').toLowerCase();
  const hit = FAMILY.find(f => f.re.test(m));
  if (hit) return hit;
  // One shared "other" family, so unknowns get evenly fanned across the
  // leftover arc by buildColors() instead of landing wherever their hash falls
  // — two hashes can sit 2 degrees apart and look identical.
  return {key:'other', h: 60, s:55};
}
// Deterministic and GLOBAL: the shade for a model is computed from the full
// model list across every profile, not from whatever survives the current
// filter. Otherwise a model's colour would move when the date range or profile
// changes — the same bar would be a different orange on two tabs.
//
// Within a family we spread hue, saturation AND lightness. Lightness alone gave
// eight Claude models ~3.7% steps apart, which is invisible; fanning the hue
// across a band keeps the family readable at a glance while making siblings
// genuinely distinguishable.
export const FAM_HUE_SPREAD = 46;   // total degrees a family fans across
export function buildColors(models){
  const groups = {};
  models.forEach(m => { const f = famOf(m); (groups[f.key] ||= {f, list:[]}).list.push(m); });
  const out = {};
  Object.values(groups).forEach(({f, list}) => {
    const uniq = [...new Set(list)].sort();
    const n = uniq.length;
    uniq.forEach((m, i) => {
      if (n === 1){ out[m] = `hsl(${f.h} ${f.s}% 55%)`; return; }
      // Wider fan when a family is crowded: 6 siblings need more arc than 2.
      const spread = Math.min(FAM_HUE_SPREAD + (n - 2) * 7, 92);
      const t = i / (n - 1);                    // 0..1 across the family
      const hue = f.h - spread/2 + t*spread;
      // Zig-zag lightness so ADJACENT entries differ sharply instead of
      // drifting; alternate saturation for a further cue.
      const alt = i % 2 ? 1 : 0;
      const light = 40 + t*26 + (alt ? 12 : 0);
      const sat = Math.max(35, Math.min(95, f.s - (alt ? 14 : 0)));
      out[m] = `hsl(${((hue%360)+360)%360|0} ${sat|0}% ${Math.min(78, light)|0}%)`;
    });
  });
  return out;
}

// Every model name Hermes has ever recorded, across all profiles. Computed once
// at load so the palette is a fixed property of the data set, not of the view.
export function allModelNames(){
  const out = [];
  Object.values(DATA.profiles || {}).forEach(p => {
    (p.rows || []).forEach(r => out.push(short(r.model)));
    (p.live || []).forEach(L => {
      if (L.model) out.push(short(L.model));
      if (L.init_model) out.push(short(L.init_model));
    });
    // health is an ARRAY of {model,...}; Object.keys() on it would yield the
    // indices "0","1",... and register them as phantom models.
    (p.health || []).forEach(h => h && h.model && out.push(short(h.model)));
    (p.failures_recent || []).forEach(f => f && f.model && out.push(short(f.model)));
  });
  (DATA.errors || []).forEach(e => e && e.model && out.push(short(e.model)));
  return out;
}
export let COLORS = {};
// Fall back through famOf(), not to a flat grey: a model that appears only in
// an error log (never in usage rows, so absent from COLORS) still gets its own
// stable, distinguishable colour instead of sharing one grey with every other
// unknown.
export const colorOf = m => {
  if (COLORS[m]) return COLORS[m];
  const f = famOf(m);
  return `hsl(${f.h} ${f.s}% 55%)`;
};
export const fmt = n => { n=+n||0; for (const [u,d] of [['B',1e9],['M',1e6],['K',1e3]]) if (n>=d) return (n/d).toFixed(1)+u; return String(Math.round(n)); };
// Bytes with binary units. Separate from fmt() on purpose: fmt's 'B' means
// billions, which beside a byte count would read as "bytes" and be off by 1e9.
export const fmtB = n => { n=+n||0;
  for (const [u,d] of [['TB',1099511627776],['GB',1073741824],['MB',1048576],['KB',1024]])
    if (n>=d) return (n/d).toFixed(n/d<10?2:1)+' '+u;
  return Math.round(n)+' B'; };
// Per-second rate, from the delta between two polls.
export const fmtRate = bps => (bps==null||!isFinite(bps)||bps<=0) ? '' : fmtB(bps)+'/s';
// Previous poll's byte totals, keyed by session id, so a rate can be derived
// without the collector having to persist state between runs.
export let bwPrev = {}, bwPrevAt = 0;
export const money = v => v ? '$'+(+v).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
// null/undefined -> '' (falsy), so callers' `|| fallback` still fires.
export const short = m => m == null ? '' : String(m).split('/').pop();
export const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export const $ = id => document.getElementById(id);
// #22: one shared empty-state builder — icon + one-line explanation + an
// optional hint for the action that would produce data — so every "there
// is nothing here" moment reads the same way instead of each view growing
// its own bare muted-text sentence.
export const emptyHTML = (icon, msg, hint) =>
  `<div class="empty"><div class="e-ico">${icon}</div>` +
  `<div class="e-msg">${esc(msg)}</div>` +
  (hint ? `<div class="e-hint">${esc(hint)}</div>` : '') + `</div>`;

export function labelColor(raw){
  const s = String(raw).replace(/^\s*\S\s+/, '').trim();   // drop the glyph
  if (COLORS[s]) return COLORS[s];
  if (PROV[s]) return PROV[s].fg;
  // Tools resolve last: a tool name can never collide with a model name, and
  // checking TOOLCOLORS directly (not toolColor()) avoids tinting every
  // unrelated category label with a hash colour.
  if (TOOLCOLORS[s]) return TOOLCOLORS[s];
  return null;
}

// Applied to every chart: bigger, model-coloured category labels and legend
// text. Chart.js has no per-tick colour callback for legends, so the legend
// gets generateLabels() and the axis gets a tick colour function.
export const LABEL_FONT = {size:13, weight:'600'};
export function ic(sm){ return provIcon(sm) + ' ' + sm; }

// ---- Bandwidth panel (P8-05, #72) ------------------------------------------
// Source: p.bandwidth_daily, the frozen per-day ledger (P8-04). Deliberately
// not p.rows: rows are recomputed with today's bytes_per_token on every build,
// the ledger is not, and this panel is the one that claims to show history.
//
// Re-send factor = prompt tokens sent / fresh prompt tokens
//                = (input + cache_read + cache_write) / (input + cache_write).
// cache_write is fresh text too: Anthropic reports it OUTSIDE input_tokens, so
// the naive cache_read/input form gives 64,000x for claude-opus-5 where the
// honest figure is ~15x. Hand-checked against state.db for #72.
export function costCell(v, local, state){
  v = +v || 0;
  if (state === 'unpriced') return `<span class="unpriced" title="No price found for this model: its traffic is counted at $0, so Est. cost is understated. Fix: add it to WEB_RATES or ALIASES in pricing.py.">unpriced</span>`;
  if (state === 'freetier') return `<span class="freetier" title="Published $0 tier (OpenRouter :free or an OpenCode Zen free SKU): genuinely $0 per token.">$0 <span class="ftmark">free tier</span></span>`;
  if (!local) return '$' + v.toFixed(2);
  const s = v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v > 0 ? v.toFixed(4) : '0';
  return `<span class="eleccost" title="Electricity at your tariff (electricity_rate_kwh). Not billed by any provider.">~$${s} <span class="elecmark">elec</span></span>`;
}

// ---- Unpriced traffic (P9-05, #82) ------------------------------------------
// Computed from the payload: a model is unpriced when none of its rows found
// a rate and it is neither local (electricity) nor a published free tier nor a
// router preset. Its traffic is counted at $0, so Est. cost is understated; the
// banner says so and names the models. Zero unpriced hides it entirely.
export const escA = v => esc(v).replace(/"/g, '&quot;');   // attribute-safe: titles are user text
export function pick(name){
  current=name; const p=DATA.profiles[name]; const [lo,hi]=bounds(p);
  $('from').min=lo; $('from').max=hi; $('to').min=lo; $('to').max=hi;
  if(!$('from').value || $('from').value<lo || $('from').value>hi) $('from').value=lo;
  if(!$('to').value || $('to').value>hi || $('to').value<lo) $('to').value=hi;
  presets(p); render();
}

// Live view: what is running right now, not what the date filter says. The
// category colours are fixed so a glance tells you the shape of the work.
export const CAT = {
  'Running':    {c:'#f59e0b', i:'▶'},
  'Coding':     {c:'#22c55e', i:'✎'},
  'Generating': {c:'#6366f1', i:'✦'},
  'Thinking':   {c:'#a855f7', i:'◐'},
  'Researching':{c:'#06b6d4', i:'⌕'},
  'Reading':    {c:'#60a5fa', i:'▤'},
  'Reviewing':  {c:'#ec4899', i:'✓'},
  'Compressing':{c:'#94a3b8', i:'⇲'},
  'Waiting':    {c:'#eab308', i:'⏸'},
  'Working':    {c:'#84cc16', i:'•'},
  'Idle':       {c:'#6b7280', i:'○'}
};
export const catOf = n => CAT[n] || {c:'#6b7280', i:'•'};
export const ago = s => s<60 ? s+'s' : s<3600 ? Math.round(s/60)+'m' : Math.round(s/3600)+'h';

// ---- per-section freshness (P14, #149) ----------------------------------
// The header used to carry a single "rebuilt Ns ago" derived from the build,
// which made a 5s live panel and an hourly router panel look equally current —
// and made a frozen artifact look live. Each panel now reports the age of the
// payload that feeds *it*, against that artifact's own cadence.
//
// Cadences live here, once, so no view re-guesses them. They must agree with
// systemd/*.timer (probe 5s, build 60s, router/quota/rankings 1h) — the
// `llm-telemetry doctor` command reads the same numbers from the unit files.
export const CADENCE = {
  dashboard: 60, live: 5, logs: 60, costs: 60, transcripts: 60,
  probe: 5, router: 3600, quota: 3600, rankings: 3600,
};
// Past 1x the cadence a section is late; past 2x it is stale and gets greyed
// with a hint rather than quietly showing yesterday's numbers.
export const STALE_FACTOR = 2;

// Timestamps arrive in every shape the payloads use: unix seconds (number or
// numeric string), a millisecond epoch, or an ISO string written without a zone
// (local time). Kept inside `freshness` on purpose: the built page only replays
// the names order.json lists, so a module-private helper would simply be absent
// there (#149 shipped once with exactly that bug).
export function freshness(ts, key, now){
  let t = ts;
  if (t == null || t === '') t = null;
  else if (typeof t === 'string' && /^-?\d+(\.\d+)?$/.test(t.trim())) t = +t;
  if (typeof t === 'number') t = t > 1e12 ? Math.floor(t / 1000) : t;
  else if (typeof t === 'string'){ const ms = Date.parse(t); t = isNaN(ms) ? null : Math.floor(ms / 1000); }
  const cadence = CADENCE[key];
  const at = now == null ? Math.floor(Date.now() / 1000) : now;
  if (t == null || !cadence) return {state:'unknown', key, cadence: cadence || null, age:null, label:'no timestamp'};
  const age = Math.max(0, Math.round(at - t));
  const state = age < cadence ? 'fresh' : age < cadence * STALE_FACTOR ? 'old' : 'stale';
  return {state, key, cadence, age, label: ago(age) + ' old',
          hint: `last update ${ago(age)} ago · expected every ${ago(cadence)}`};
}

// Writes the state onto the element: a class the CSS can grey, and (for a late
// or stale section) a suffix on the existing text. The original text is kept in
// one place, so a section that recovers does not accumulate suffixes.
export function stampFreshness(el, ts, key, now){
  if (!el) return null;
  const r = freshness(ts, key, now);
  if (el.dataset.stampBase === undefined) el.dataset.stampBase = el.dataset.stampBase || el.textContent || '';
  el.dataset.stampState = r.state;
  el.dataset.stampKey = key;
  if (el.classList && el.classList.toggle) {
    el.classList.toggle('old', r.state === 'old');
    el.classList.toggle('stale', r.state === 'stale');
  }
  if (r.state === 'fresh' || r.state === 'unknown') el.textContent = el.dataset.stampBase;
  else {
    const sep = el.dataset.stampBase ? ' · ' : '';
    el.textContent = `${el.dataset.stampBase}${sep}${r.state === 'stale' ? 'stale, ' : ''}${r.label}`;
  }
  if ('title' in el) el.title = r.state === 'fresh' ? '' : (r.hint || r.label);
  return r;
}

// One bandwidth line for a live session: estimated bytes up/down, plus a live
// rate when two polls are far enough apart to divide safely. `bwlive` animates
// the arrows only while the session is genuinely transferring, so a stalled row
// does not look busy.
export const TOOL_FAM = [
  {re:/^(read_file|write_file|patch|search_files|glob)$/,        h:150, s:58},
  {re:/^(terminal|execute_code|process_manage)$/,                h: 34, s:78},
  {re:/^(web_search|web_extract|browser)/,                       h:200, s:70},
  {re:/^(skill_view|skills_list|skill_manage|context_notes)$/,   h:280, s:62},
  {re:/^(delegate_task|todo_list|clarify)$/,                     h:330, s:64},
  {re:/^(vision_analyze|text_to_speech)$/,                       h: 96, s:55},
  // Meta/infra tools: without a family these fell through to hashHue() and two
  // of them landed 3.7 dE apart — indistinguishable.
  {re:/^(tool_search|tool_describe|tool_call)$/,                 h:250, s:60},
  {re:/^(cronjob_manage|computer_use|desktop_preview|chat_history_lookup)$/, h: 15, s:50},
];
export function toolFam(t){
  const hit = TOOL_FAM.find(f => f.re.test(t||''));
  return hit || {h: hashHue(t||''), s:52};
}
export let TOOLCOLORS = {};
// Built ONCE from every tool seen anywhere (live feed + drawer logs across both
// profiles), never per-render: building from a filtered subset is exactly the
// bug that made models shift shade between tabs.
// Known tools, so a tool's colour depends on its FAMILY SLOT, not on how many
// siblings happen to be present. Without this, discovering a new tool mid-
// session reshuffles every other tool in its family — the same instability the
// model palette had when it was built from filtered rows.
export const TOOL_ROSTER = [
  'read_file','write_file','patch','search_files','glob',
  'terminal','execute_code','process_manage',
  'web_search','web_extract','browser_exec',
  'skill_view','skills_list','skill_manage','context_notes','memory',
  'delegate_task','todo_list','clarify',
  'vision_analyze','text_to_speech',
  // Deferred/loadable tools also appear in logs; listing them keeps their
  // family membership fixed instead of hash-scattered.
  'tool_search','tool_describe','tool_call',
  'cronjob_manage','computer_use','desktop_preview','chat_history_lookup',
];
export function allToolNames(){
  const out = new Set();
  Object.values(DATA.profiles||{}).forEach(p => {
    (p.tools_recent||[]).forEach(t => t && t.tool && out.add(t.tool));
    (p.logs||[]).forEach(l => l && l.tool && out.add(l.tool));
  });
  (DATA.errors||[]).forEach(e => e && e.tool && out.add(e.tool));
  TOOL_ROSTER.forEach(t => out.add(t));
  return [...out];
}
export function buildToolColors(list){
  const byFam = {};
  // Sort the INPUT first: allToolNames() returns Set-insertion order, which
  // shifts as the live feed changes. Sorting makes a tool's shade depend only
  // on its family membership, not on when it happened to be discovered.
  [...new Set(list)].sort().forEach(t => { const f = toolFam(t); (byFam[f.h] ||= []).push(t); });
  const out = {};
  Object.values(byFam).forEach(members => {
    members.sort();
    const n = members.length, f = toolFam(members[0]);
    members.forEach((t, i) => {
      if (n === 1){ out[t] = `hsl(${f.h} ${f.s}% 58%)`; return; }
      // Fan hue AND lightness within the family, alternating so neighbours in
      // the sorted list never land on adjacent shades.
      const spread = Math.min(26 + (n - 2) * 5, 54);
      const tt = i / (n - 1);
      // Wrap into 0-360: a family centred near 15 fans below zero and emits
      // hsl(-3 ...). Browsers cope, but it breaks any tooling that parses it.
      const hue = (((f.h - spread/2 + tt*spread) % 360) + 360) % 360;
      const li = 46 + (i % 2 ? 16 : 0) + (tt * 10);
      out[t] = `hsl(${hue.toFixed(1)} ${(f.s - (i%3)*7)}% ${li.toFixed(1)}%)`;
    });
  });
  return out;
}
export const toolColor = t => TOOLCOLORS[t] || `hsl(${hashHue(t||'')} 52% 58%)`;

export function slugOf(v){ return String(v).toLowerCase(); }

// P4-09 (#46): the project filter lives in the SAME hash as the view
// (#/usage?project=Nowinv), not a second piece of state, so a filtered
// view is one shareable/reloadable URL rather than "the right tab plus a
// setting you have to also remember to set".
