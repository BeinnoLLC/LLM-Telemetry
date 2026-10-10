/**
 * Main: the payload contract and boot wiring — the only module that runs
 * anything at load time.
 */
import { $, pick, readTheme } from './palette.js';
import { CHART_ANIM_DONE, current } from './charts.js';
import { render } from './views.js';
import { mergeDelegations } from './live.js';
import { pickView, setFiltersFromHash, view, viewFromHash } from './router.js';

export let DATA = __DATA__;
// Prices view feed (was standalone costs.html): build_dashboard replaces this
// token with the JSON build_costs.write_costs_data emits — one source of truth.
export const COSTS_DATA = __COSTS_DATA__;
// Rankings view feed (was standalone rankings.html): same pattern as the
// Prices feed — build_dashboard injects the payload build_rankings collects.
export const RANKINGS_DATA = __RANKINGS_DATA__;
// views.js is a separate bundle in the standalone page but the same scope here;
// guarded so plain-node test harnesses (isolate) can import main.js without a DOM.
if (typeof window !== 'undefined') window.COSTS_DATA = COSTS_DATA;
if (typeof window !== 'undefined') window.RANKINGS_DATA = RANKINGS_DATA;
// Injected from config.local_host_patterns so provOf() classifies self-hosted
// endpoints correctly on any network, not just the author's LAN.
export const LOCAL_HOSTS = __LOCAL_HOSTS__;
// ---- Payload contract (P1-01, #23) ---------------------------------------
// Every payload carries schema_version. A missing or different version means
// the page and the collector disagree about the shape; rendering anyway is how
// "wrong data" used to show up as a silently empty dashboard. Refuse, loudly.
export const SCHEMA_VERSION = __SCHEMA_VERSION__;
export const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || '#888';
export function buildAll(profiles){
  // Only merge real profiles — skip any already-merged 'All' key to prevent
  // the cost/call totals from doubling every time installAll is re-called.
  const names = Object.keys(profiles).filter(n => n !== 'All');
  if (names.length < 2) return null;
  const rows = [], hours = [], sess = [], live = [], tools = {};
  const H = {}, fails = [], ER = {};
  const hour_rows = [];
  let active = 0;
  names.forEach(n => {
    const p = profiles[n];
    // tag each row with its origin so the merged view can still attribute work
    (p.rows||[]).forEach(r => rows.push({...r, profile:n}));
    (p.hour_rows||[]).forEach(r => hour_rows.push({...r, profile:n}));
    (p.hours||[]).forEach(h => hours.push(h));
    (p.sessions||[]).forEach(s => sess.push(s));
    (p.live||[]).forEach(L => live.push({...L, profile:n}));
    (p.tools_recent||[]).forEach(t => tools[t.tool] = (tools[t.tool]||0) + t.calls);
    (p.failures_recent||[]).forEach(f => fails.push({...f, profile:n}));
    // merge reliability per model: the same model can run in both profiles
    (p.health||[]).forEach(h => {
      const o = H[h.model] || (H[h.model] = {model:h.model, ok:0, fail:0, total:0,
                                             kinds:{}, last:'', last_kind:'', last_msg:''});
      o.ok += h.ok; o.fail += h.fail; o.total += h.total;
      Object.entries(h.kinds||{}).forEach(([k,v]) => o.kinds[k] = (o.kinds[k]||0) + v);
      if ((h.last||'') > o.last) { o.last = h.last; o.last_kind = h.last_kind; o.last_msg = h.last_msg; }
    });
    active += (p.active||0);
  });
  // end_reason counts add up across profiles (a count is a count); the
  // compression-pressure LIST concatenates and re-ranks, matching how
  // resend/recent_sessions already merge — a straight sum would lose which
  // session the pressure belongs to.
  names.forEach(n => (profiles[n].end_reasons||[]).forEach(r => {
    ER[r.reason] = (ER[r.reason]||0) + r.n;
  }));
  const end_reasons = Object.entries(ER).map(([reason,n])=>({reason,n})).sort((a,b)=>b.n-a.n);
  const compression_pressure = names.flatMap(n =>
    (profiles[n].compression_pressure||[]).map(r=>({...r,profile:n})))
    .sort((a,b)=>(b.ineffective_count-a.ineffective_count)||(b.fallback_streak-a.fallback_streak))
    .slice(0,40);
  const health = Object.values(H).map(h => ({
    ...h, rate: h.total ? Math.round(1000*h.ok/h.total)/10 : null
  })).sort((a,b) => (b.fail-a.fail) || (b.total-a.total));
  fails.sort((a,b) => (b.when||'').localeCompare(a.when||''));
  const dates = rows.map(r=>r.date).filter(Boolean).sort();
  const recent_sessions = names.flatMap(n=>(profiles[n].recent_sessions||[]).map(r=>({...r,profile:n})))
    .sort((a,b)=>(b.last_ts||0)-(a.last_ts||0)).slice(0,40);
  // Context re-send (#80): session ids are unique per profile, so the merged
  // list is a concatenation re-ranked by cost, never a sum.
  const resend = names.flatMap(n=>(profiles[n].resend||[]).map(r=>({...r,profile:n})))
    .sort((a,b)=>(b.resend_usd||0)-(a.resend_usd||0)).slice(0,60);
  // Heatmap: sum the per-day call counts across profiles so the merged tab
  // shows total activity per day, not one profile's.
  const HM = {};
  // Merge on (day, provider-identity) so the per-provider split survives the
  // All-profiles view. Collapsing on the day alone would sum both profiles into
  // one number and the cells would lose their provider bands.
  names.forEach(n => (profiles[n].heatmap||[]).forEach(x => {
    const k = `${x.d}\u0000${x.p||''}\u0000${x.url||''}\u0000${x.m||''}`;
    if (!HM[k]) HM[k] = {d:x.d, p:x.p, url:x.url, m:x.m, v:0};
    HM[k].v += (x.v||0);
  }));
  const heatmap = Object.values(HM).sort((a,b)=>a.d.localeCompare(b.d));
  // Merge per-node session lists across profiles, then re-cap: the same model
  // can serve chats in both profiles, and concatenating without re-sorting
  // would show profile order rather than the busiest chats.
  const NS = {};
  names.forEach(n => Object.entries(profiles[n].node_sessions||{}).forEach(([k,v])=>{
    (NS[k] ||= []).push(...v);
  }));
  Object.keys(NS).forEach(k => {
    NS[k].sort((a,b)=>b.calls-a.calls); NS[k] = NS[k].slice(0,5);
  });
  return {rows, hours, sessions:sess, live, active, health, recent_sessions, resend, heatmap,
          hour_rows,
          node_sessions: NS,
          end_reasons, compression_pressure,
          // Delegation outcomes merge like health does: per-child counters add
          // up across profiles. Omitting this left the DEFAULT tab with an
          // empty panel while each real profile had data — the panel looked
          // broken rather than empty.
          delegations: mergeDelegations(names.map(n => profiles[n].delegations)),
          // Ledger rows concatenate: each is already keyed by provider/model/day,
          // and the panel aggregates. Summing them into new rows would lose the
          // per-row bytes_per_token the panel reports.
          bandwidth_daily: names.flatMap(n => profiles[n].bandwidth_daily || []),
          // Match the per-profile cap: 14 would silently re-collapse the
          // failure list that the Health panel now pages through.
          failures_recent: fails.slice(0,60),
          tools_recent: Object.entries(tools).map(([tool,calls])=>({tool,calls}))
                              .sort((a,b)=>b.calls-a.calls),
          min_date: dates[0]||null, max_date: dates[dates.length-1]||null};
}

// Failure kinds get their own colour so the matrix reads at a glance: a wall
// of amber is a throttle, red is auth/config and needs you.
// SINGLE SOURCE OF TRUTH for failure-kind colour. This object drives the health
// bar segments, the health chips, the failure-filter chips AND the drawer's
// .k-* chips — the drawer used to carry its own hand-written CSS palette, so
// the same failure kind rendered one colour in the Health tab and a different
// one in the drawer (unavailable was grey here, purple there).
//
// 'unavailable' must NOT be a near-neutral grey: it is drawn on the empty-bar
// track (--border #232b39), so a model that failed 100% of its calls looked
// like a model with no data at all. It is now a distinct violet.
export function installAll(){
  // #121: there is no synthetic "All" profile any more. The visible set is
  // the merge — pvFilter() builds it directly. Kept as a no-op alias because
  // three call sites (boot, doRefresh, pollLive) already invoke it; the
  // refresh/live paths re-filter through pvFilter() below.
}
// ---- Per-profile toggles (#121) --------------------------------------------
// Every profile tab is an on/off toggle chip. There is NO separate "All"
// tab: when every profile is on, the merge IS what "All" used to show. The
// choice is per-browser UI state (localStorage), not data — the profile is
// still collected regardless of visibility. Kept in one place so the boot
// path, the merge and the tab strip all consult it.
export const saved = localStorage.getItem('hermes-dash-theme');
// Since the light-default flip, :root IS light; dark mounts via the explicit
// [data-theme="dark"] attribute. The saved value is honoured either way.
if(saved==='dark') document.documentElement.setAttribute('data-theme','dark');
$('theme').onclick = () => {
  const dark = document.documentElement.getAttribute('data-theme')==='dark';
  if(dark) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme','dark');
  localStorage.setItem('hermes-dash-theme', dark?'light':'dark');
  readTheme(); render();
};
// All three cross-filters out of one hash, through the owning module's setter
// (an imported binding cannot be assigned here).
setFiltersFromHash();
pickView(viewFromHash() || view);
pick(current);

// Hide the preloader once the first render has actually painted. The rAF pair
// waits for the frame that contains the charts, so there is no flash of an
// empty page. The timeout is a safety net: a render error must never leave the
// user staring at a spinner forever.
export function bootDone(){
  const b = $('boot');
  if (b && !b.classList.contains('gone')) {
    b.classList.add('gone');
    setTimeout(()=>b.remove(), 400);
  }
  // First paint is done — every chart build from here on is a refresh, not
  // an entrance. mk() reads this flag to stop replaying draw-in animations
  // on the 60s auto-refresh and the 5s live tick.
  CHART_ANIM_DONE = true;
}
requestAnimationFrame(()=>requestAnimationFrame(bootDone));
setTimeout(bootDone, 4000);

