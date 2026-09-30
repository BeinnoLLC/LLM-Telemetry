/**
 * Live: the live session list, host cards, gauges and the polling loop
 * (including the completion sound).
 */
import {
  $, ago, bwPrev, catOf, colorOf, emptyHTML, esc, fmtB, short, toolColor,
} from './palette.js';
import { agg, bwRow, loeIcon, mk } from './charts.js';
import {
  REPO_EXPANDED, installProjFilter, installProjWeight, installProjectDrilldown, installSesstree, modelsBadge, modelsPanel, provBadge, provOf, renderOllama, renderRepoBranch,
} from './views.js';
import { renderAgents, renderQueue } from './flow.js';
import {
  installDrawer, installSessionFinder, installTimelineModal, installTranscriptModal,
} from './drawer.js';
import { POWER, intervalsInstall, profileHue, settingsInstall, view } from './router.js';
import { DATA } from './main.js';

export function renderLive(){
  const p = DATA.profiles[current] || {};
  renderOllama(DATA.ollama);
  renderQueue();
  renderAgents(p.agents);
  // Deduplicate live sessions by ID — the All tab can merge the same session from
  // two profiles, and the 5s poll can occasionally return duplicates mid-refresh.
  const seen = new Set();
  const live = (p.live || []).filter(L => { if(seen.has(L.id)) return false; seen.add(L.id); return true; });
  const box = $('livelist');
  if(!box) return;

  // P10-01 (#89): "a fan-out is visibly a fan-out" — a collapsed strip above
  // the live list naming any parent with 2+ children currently in flight,
  // so a burst of subagents reads as ONE event, not N unrelated rows.
  const fanoutEl = $('livefanout');
  if (fanoutEl) {
    const byParent = new Map();
    live.forEach(L => { if (L.parent) byParent.set(L.parent, (byParent.get(L.parent) || 0) + 1); });
    const fanouts = [...byParent.entries()].filter(([, n]) => n >= 2);
    fanoutEl.innerHTML = fanouts.length
      ? fanouts.map(([pid, n]) => {
          const parentTitle = live.find(L => L.id === pid)?.title
            || p.recent_sessions?.find(s => s.id === pid)?.title || pid;
          return `<button type="button" class="chip livefanout-chip ttitlebtn" data-tsession="${esc(pid)}" data-tprofile="${esc(current)}">${esc(parentTitle)} \u2192 ${n} running</button>`;
        }).join(' ')
      : '';
    fanoutEl.hidden = fanouts.length === 0;
  }

  if(!live.length){
    box.innerHTML = emptyHTML('○', 'Nothing running right now.', 'Start an agent run and it will appear here within a few seconds.');
  } else {
    box.innerHTML = live.map(L=>{
      const c = catOf(L.category);
      const mcol = colorOf(short(L.model));
      const tools = (L.tools||[]).slice(0,5).map(t=>
        `<span class="text-[length:var(--fs-xs)] px-1 py-0.5 rounded" style="background:${BD};color:${MU}">${t}</span>`).join(' ');
      return `<div class="liverow flex items-center gap-2.5 p-2 rounded" style="border:1px solid ${BD}">
        <div style="color:${c.c};font-size:var(--fs-lg);line-height:1.1" title="${esc(L.category)}">${c.i}</div>
        <div class="flex-1 min-w-0 self-center">
          <div class="flex items-center gap-2 flex-wrap">
            <button type="button" class="ttitlebtn text-[length:var(--fs-md)] font-semibold truncate" data-tsession="${esc(L.id)}" data-tprofile="${esc(L.profile||'')}" title="${esc(L.title)} — open transcript">${esc(L.title)}</button>
            <button type="button" class="chip lntimelinebtn text-[length:var(--fs-xs)]" data-tsession="${esc(L.id)}" data-tprofile="${esc(L.profile||'')}" data-title="${esc(L.title)}" title="${esc(L.title)} — view timeline">Timeline</button>
            <span class="text-[length:var(--fs-xs)] font-medium" style="color:${c.c}">${L.category}</span>
            ${provBadge(provOf('', L.model, L.base_url))}
            ${L.profile ? `<span class="text-[length:var(--fs-xs)] px-1 rounded" style="background:hsl(${profileHue(L.profile)} 62% 30%);color:hsl(${profileHue(L.profile)} 80% 78%);border:1px solid hsl(${profileHue(L.profile)} 55% 42%)">${L.profile}</span>` : ''}
            ${L.kind==='subagent'?'<span class="text-[length:var(--fs-xs)] muted">↳ subagent</span>':''}
          </div>
          <div class="muted text-[length:var(--fs-xs)] truncate">${L.phase||'—'}</div>
          <div class="flex items-center gap-1 mt-1 flex-wrap">${tools}</div>
        </div>
        <div class="metacol shrink-0">
          <div class="text-[length:var(--fs-sm)] muted truncate leading-tight" style="color:${mcol}" title="${short(L.model)}">${short(L.model)}</div>
          ${L.switched ? `<div class="text-[length:var(--fs-xs)] truncate" style="color:#f59e0b" title="router fell back from ${short(L.init_model)}">↯ from ${short(L.init_model)}</div>` : ''}
          ${modelsBadge(L)}
          <div class="muted text-[length:var(--fs-xs)]">${ago(L.idle_s)} ago</div>
        </div>
        <div class="loecol">${loeIcon(L, {id:L.id, label:(L.title&&L.title!=='(untitled)')?L.title:'session load'})}${bwRow(L)}</div>
      </div>${modelsPanel(L)}`;
    }).join('');
  }

  // Open-session bandwidth total on the "In progress now" heading (#109).
  // Only sessions in `live` are summed, so it goes to zero when nothing runs.
  const lbw = $('livebw');
  if (lbw) {
    const tu = live.reduce((a,L)=>a+(+L.up_bytes||0)+(+L.lan_up_bytes||0),0);
    const td = live.reduce((a,L)=>a+(+L.down_bytes||0)+(+L.lan_down_bytes||0),0);
    lbw.innerHTML = (tu||td)
      ? `<span><span class="bwarrow bwup">&uarr;</span> ${fmtB(tu)}</span><span><span class="bwarrow bwdown">&darr;</span> ${fmtB(td)}</span>`
      : '';
  }

  // Snapshot byte totals so the NEXT poll can derive a rate. Done after the
  // rows are rendered, so this render compares against the previous poll.
  bwPrev = {}; live.forEach(L => { bwPrev[L.id] = {
    up:(+L.up_bytes||0)+(+L.lan_up_bytes||0),
    down:(+L.down_bytes||0)+(+L.lan_down_bytes||0)}; });
  bwPrevAt = Date.now();

  const cats = agg(live, L=>L.category, ()=>1);
  mk('cLiveCat','doughnut',cats.map(x=>x[0]),
     [{data:cats.map(x=>x[1]),backgroundColor:cats.map(x=>catOf(x[0]).c),borderWidth:0}],
     {plugins:{legend:{position:'right',labels:{boxWidth:8,padding:5,font:{size:9}}}},cutout:'52%'});

  const tr = (p.tools_recent||[]).slice(0,8);
  // Per-tool colour, not one flat accent: the same tool keeps its colour in the
  // chart, its axis label and the drawer, so it is traceable across the session.
  mk('cTools','bar',tr.map(x=>x.tool),
     [{data:tr.map(x=>x.calls),backgroundColor:tr.map(x=>toolColor(x.tool)),borderRadius:2}],
     {...noLeg,indexAxis:'y',scales:{x:{grid:{color:BD}},y:{grid:{display:false},ticks:{font:{size:9}}}}});


}

// LOE indicator — a speedometer in its own column (#7/#8/#9/#10/#12 rebuild).
// A 270° instrument dial: gradient progress arc (green->amber->red across the
// whole sweep) plus a needle that TRAVELS from its previous angle to the new
// one on every refresh (so a refresh is visibly alive, not a permanent idle
// wobble), a small settled tremor, and a real numeric readout — legible
// without a tooltip, and exposed to assistive tech as a proper meter.
// Inline SVG: no canvas, no library, no layout pass. One fixed 100x100
// viewBox scaled purely by CSS width/height (--gauge-size / .sz-sm|md|lg), so
// every stroke/tick/font scales together instead of going spindly at 132px.
export function mergeDelegations(list){
  const parts = (list || []).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];

  const M = {}, T = {}, reasons = {}, exits = {};
  let children = 0, ok = 0, wasted = 0, cost = 0, recent = [];

  parts.forEach(g => {
    children += g.children || 0;
    ok += g.ok || 0;
    wasted += g.wasted_hours || 0;
    cost += g.cost_usd || 0;
    (g.by_model || []).forEach(m => {
      const o = M[m.model] || (M[m.model] = {model:m.model, n:0, ok:0,
        cost_usd:0, tokens:0, hours:0, wasted_hours:0});
      o.n += m.n; o.ok += m.ok; o.cost_usd += m.cost_usd || 0;
      o.tokens += m.tokens || 0; o.hours += m.hours || 0;
      o.wasted_hours += m.wasted_hours || 0;
    });
    (g.tools || []).forEach(t => {
      const o = T[t.tool] || (T[t.tool] = {tool:t.tool, calls:0, fail:0});
      o.calls += t.calls; o.fail += t.fail;
    });
    Object.entries(g.reasons || {}).forEach(([k,v]) => reasons[k] = (reasons[k]||0) + v);
    Object.entries(g.exits || {}).forEach(([k,v]) => exits[k] = (exits[k]||0) + v);
    recent = recent.concat(g.recent || []);
  });

  const by_model = Object.values(M).map(m => ({
    ...m,
    rate: m.n ? Math.round(1000*m.ok/m.n)/10 : 0,
    cost_usd: Math.round(m.cost_usd*1e4)/1e4,
    hours: Math.round(m.hours*100)/100,
    wasted_hours: Math.round(m.wasted_hours*100)/100,
  })).sort((a,b) => (b.n - a.n) || a.model.localeCompare(b.model));

  const tools = Object.values(T).map(t => ({
    ...t, rate: t.calls ? Math.round(1000*(t.calls-t.fail)/t.calls)/10 : 0,
  })).sort((a,b) => b.calls - a.calls);

  recent.sort((a,b) => (b.at||0) - (a.at||0));

  return {
    children, ok, failed: children - ok,
    rate: children ? Math.round(1000*ok/children)/10 : 0,
    wasted_hours: Math.round(wasted*100)/100,
    cost_usd: Math.round(cost*1e4)/1e4,
    by_model,
    reasons: Object.fromEntries(Object.entries(reasons).sort((a,b) => b[1]-a[1])),
    exits: Object.fromEntries(Object.entries(exits).sort((a,b) => b[1]-a[1])),
    tools,
    tools_measured: parts.every(g => g.tools_measured === true),
    recent: recent.slice(0, 40),
  };
}

// Synthetic "All" profile: every real profile merged, so the first tab answers
// "what is my whole setup doing / costing" without switching back and forth.
// Built client-side from DATA so it always matches what the tabs show.
export const LIVE_MS_DEFAULT = 5000;
// P7-05 (#112): live poll cadence, live-adjustable. A let (not const) so
// changing it in the Advanced settings card takes effect on the very next
// setInterval tick without a page reload.
export let LIVE_MS = (POWER.intervals && POWER.intervals.live_poll_interval_s
  ? Math.round(POWER.intervals.live_poll_interval_s * 1000) : LIVE_MS_DEFAULT);
export let liveBusy = false, liveFails = 0;

// ---- Completion sound (#105) -----------------------------------------------
// Off by default (localStorage remembers the choice), generated with Web
// Audio so there is no audio file to ship (the dashboard is one
// self-contained HTML page, ADR 0001). Browsers block audio until a user
// gesture, so turning it on is itself the gesture -- no separate unlock step
// is needed or possible.
export let soundOn = localStorage.getItem('lt-sound') === '1';
export let audioCtx = null;
export let soundBaseline = true;   // true until the first poll has been diffed once
export let seenEnded = new Set();  // session ids already sounded for, across polls
export let seenDeleg = new Set();  // delegation ids already sounded for
export let soundDebounceUntil = 0;

export function ensureAudioCtx(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// Two short, distinct tones: a rising two-note chime for success, a single
// lower note for failure. Both are quiet (gain 0.06) and under 300ms so a
// burst of completions does not read as an alarm.
export function playTone(kind){
  if (!soundOn) return;
  // Sound is most useful when you are not looking at the tab; still allowed
  // when visible (some users want it either way), but never on a baseline
  // snapshot or a profile switch -- those are not real completions.
  const ctx = ensureAudioCtx();
  const now = ctx.currentTime;
  const notes = kind === 'success' ? [880, 1174.66] : [220];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = freq;
    const t0 = now + i * 0.09;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.06, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(t0); osc.stop(t0 + 0.16);
  });
}

// Debounce: several completions inside one poll, or across polls within 2s,
// play as a single tone rather than a burst. `kind` escalates to 'fail' if
// anything in the batch failed, even if most succeeded. A prior version
// returned early once inside the 2s window WITHOUT scheduling a play, which
// silently dropped a completion that arrived mid-window instead of merging
// it into the next tone -- fixed by always scheduling, timed to fire no
// sooner than the window allows.
export let pendingKind = null;
export let soundTimerPending = false;
export function scheduleTone(kind){
  if (kind === 'fail') pendingKind = 'fail';
  else if (!pendingKind) pendingKind = 'success';
  if (soundTimerPending) return;   // a play is already queued; it will pick up any escalation
  soundTimerPending = true;
  const wait = Math.max(0, soundDebounceUntil - Date.now());
  setTimeout(() => {
    if (pendingKind) playTone(pendingKind);
    pendingKind = null;
    soundTimerPending = false;
    soundDebounceUntil = Date.now() + 2000;
  }, wait);
}

// Diff recent_ended / recent_delegations against what has already sounded.
// Runs on every poll for every profile that was fetched, not just the one
// showing, so a completion in a background profile is never missed.
export function checkCompletions(freshProfiles){
  let any = false;
  Object.values(freshProfiles).forEach(f => {
    (f.recent_ended || []).forEach(s => {
      if (seenEnded.has(s.id)) return;
      seenEnded.add(s.id);
      if (soundBaseline) return;
      any = true;
      const bad = /orphan_reap|error/i.test(s.end_reason || '');
      scheduleTone(bad ? 'fail' : 'success');
    });
    (f.recent_delegations || []).forEach(d => {
      if (seenDeleg.has(d.id)) return;
      seenDeleg.add(d.id);
      if (soundBaseline) return;
      any = true;
      scheduleTone(d.state === 'error' ? 'fail' : 'success');
    });
  });
  return any;
}

export function soundToggleInstall(){
  const btn = $('soundtoggle');
  if (!btn) return;
  // Expose the module-scope `let` bindings on window: they are plain lexical
  // vars (not properties), so a test harness driving pollLive() directly
  // needs a live view of them, not a snapshot taken at install time.
  Object.defineProperty(window, 'soundOn', { get: () => soundOn, set: v => { soundOn = v; } });
  Object.defineProperty(window, 'soundBaseline', { get: () => soundBaseline, set: v => { soundBaseline = v; } });
  Object.defineProperty(window, 'seenEnded', { get: () => seenEnded, set: v => { seenEnded = v; } });
  Object.defineProperty(window, 'seenDeleg', { get: () => seenDeleg, set: v => { seenDeleg = v; } });
  const paint = () => {
    btn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    btn.classList.toggle('on', soundOn);
    btn.innerHTML = soundOn ? '&#128266;' : '&#128263;';
  };
  paint();
  btn.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('lt-sound', soundOn ? '1' : '0');
    if (soundOn) { ensureAudioCtx(); playTone('success'); }
    paint();
  });
}


// ---- Logs drawer ---------------------------------------------------------
// One chronological feed merging two sources: model failures parsed from
// errors.log, and tool events from the live sessions. Kept out of the tab
// system on purpose — a log you can only reach by changing tabs is not a log.
export function scheduleLivePoll(){
  liveTimer = setTimeout(() => { pollLive(); scheduleLivePoll(); }, LIVE_MS);
}
export let liveTimer = null;
scheduleLivePoll();
installDrawer();
installTranscriptModal();
installSessionFinder();
// P4-05 (#101), part 2: click a repo row to expand/collapse its branches.
$('repolist')?.addEventListener('click', e => {
  const row = e.target.closest?.('[data-repokey]');
  if (!row) return;
  const key = row.dataset.repokey;
  if (REPO_EXPANDED.has(key)) REPO_EXPANDED.delete(key); else REPO_EXPANDED.add(key);
  renderRepoBranch(DATA.profiles[current]?.repo_branch);
});
installTimelineModal();
installProjectDrilldown();
installProjWeight();
installProjFilter();
installSesstree();
soundToggleInstall();
settingsInstall();
pollLive();   // populate the drawer before the first 5s tick
document.addEventListener('visibilitychange', () => { if(!document.hidden) pollLive(); });

// Poll in place every 60s. A full location.reload() would throw away the
// selected tab, profile and date range mid-read; this swaps the data only.
export let REBUILD_MS = (POWER.intervals && POWER.intervals.analytics_rebuild_interval_s
  ? Math.round(POWER.intervals.analytics_rebuild_interval_s * 1000) : 60000);
export function scheduleRebuild(){
  rebuildTimer = setTimeout(() => {
    if (!document.hidden) doRefresh(true);
    scheduleRebuild();
  }, REBUILD_MS);
}
export let rebuildTimer = null;
scheduleRebuild();
// intervalsInstall() reads LIVE_MS/REBUILD_MS to seed its inputs -- must run
// after both are declared above, or a page load throws a TDZ ReferenceError.
intervalsInstall();
// catch up immediately when the tab comes back to the foreground
document.addEventListener('visibilitychange', () => { if(!document.hidden) doRefresh(true); });
