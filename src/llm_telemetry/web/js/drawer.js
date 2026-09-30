/**
 * Drawer: the logs page and logs drawer (filters, follow mode), the
 * transcript modal, the session finder and the timeline modal.
 */
import {
  $, COLORS, TOOLCOLORS, colorOf, emptyHTML, esc, fmt, hashHue, short, toolColor,
} from './palette.js';
import { schemaProblem } from './views.js';
import { checkCompletions, liveBusy, renderLive, soundBaseline } from './live.js';
import { PV_ALL, navSync, pickView, pvFilter, tabs, view } from './router.js';
import { DATA } from './main.js';

export const SF_FILTER_KEYS = { model: 'model', source: 'source', tool: 'tools', end: 'end' };

export function sfParseQuery(q){
  // Splits `model:opus tool:patch cost>1 dur>1h free text` into
  // {filters: {model:'opus', tool:'patch'}, numeric: [{key:'cost',op:'>',val:1}, ...], text: 'free text'}
  const filters = {}, numeric = [], words = [];
  (q || '').trim().split(/\s+/).filter(Boolean).forEach(tok => {
    let m = tok.match(/^(\w+)([<>])(\d+(?:\.\d+)?)([a-z]*)$/i);
    if (m){
      let [, key, op, val, unit] = m;
      val = parseFloat(val);
      if (unit === 'h') val *= 3600;  // dur>1h -> seconds, matching session_index's own `dur` unit
      numeric.push({ key: key.toLowerCase(), op, val });
      return;
    }
    m = tok.match(/^(\w+):(.+)$/);
    if (m && SF_FILTER_KEYS[m[1].toLowerCase()]){
      filters[SF_FILTER_KEYS[m[1].toLowerCase()]] = m[2].toLowerCase();
      return;
    }
    words.push(tok);
  });
  return { filters, numeric, text: words.join(' ').toLowerCase() };
}

export function sfMatch(session, parsed){
  for (const [field, needle] of Object.entries(parsed.filters)){
    const hay = field === 'tools' ? (session.tools || []) : [session[field] || ''];
    const ok = hay.some(v => String(v).toLowerCase().includes(needle));
    if (!ok) return false;
  }
  for (const { key, op, val } of parsed.numeric){
    const field = key === 'dur' ? 'dur' : key === 'cost' ? 'cost' : null;
    if (!field) continue;  // an unknown numeric key matches nothing rather than crashing
    const actual = session[field];
    if (actual === undefined || actual === null) return false;
    if (op === '>' && !(actual > val)) return false;
    if (op === '<' && !(actual < val)) return false;
  }
  if (parsed.text){
    const hay = [session.title, session.model, session.source, session.branch, session.cwd_tail,
                 ...(session.tools || [])].join(' ').toLowerCase();
    if (!hay.includes(parsed.text)) return false;
  }
  return true;
}

export function sfSearch(index, query){
  const parsed = sfParseQuery(query);
  return (index || []).filter(s => sfMatch(s, parsed));
}

export let LOGS = null, logsLoading = false, logsErr = '';
export const lgSel = {level:new Set(), role:new Set(), tool:new Set(), model:new Set(),
               session:new Set(), kind:new Set()};
export let lgWindow = 24, lgQ = '';

async function loadLogs(){
  if (LOGS || logsLoading) return;
  logsLoading = true; logsErr = '';
  renderLogs();
  try {
    const r = await fetch('logs-data.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    const bad = schemaProblem(fresh, 'logs-data.json');
    if (bad) throw new Error(bad);
    LOGS = fresh;
  } catch (e) {
    // file:// and a missing collector both land here. Say which, rather than
    // showing an empty list that looks like "no logs".
    logsErr = e.message;
  } finally {
    logsLoading = false;
    renderLogs();
  }
}

export function lgProfile(){
  if (!LOGS || !LOGS.profiles) return null;
  // The merged "All" tab has no logs profile of its own; fall back to the
  // first real one rather than rendering nothing.
  return LOGS.profiles[current] || LOGS.profiles[Object.keys(LOGS.profiles)[0]] || null;
}

export function lgMatch(e, p){
  if (lgSel.level.size && !lgSel.level.has(e.level)) return false;
  if (lgSel.role.size  && !lgSel.role.has(e.role))   return false;
  if (lgSel.tool.size  && !lgSel.tool.has(e.tool))   return false;
  if (lgSel.model.size && !lgSel.model.has(e.model)) return false;
  if (lgSel.session.size && !lgSel.session.has(e.session)) return false;
  if (lgSel.kind.size  && !lgSel.kind.has(e.kind))   return false;
  if (lgWindow){
    const cutoff = (p.generated || (Date.now()/1000)) - lgWindow*3600;
    if (e.ts < cutoff) return false;
  }
  if (lgQ){
    const hay = (e.preview + ' ' + e.tool + ' ' + e.title + ' ' + e.model + ' ' + e.session).toLowerCase();
    if (!hay.includes(lgQ)) return false;
  }
  return true;
}

export function lgChips(boxId, key, items, labelOf){
  const box = $(boxId);
  if (!box) return;
  if (!items || !items.length){ box.innerHTML = '<span class="muted text-[length:var(--fs-xs)]">none</span>'; return; }
  box.innerHTML = items.map(it => {
    const v = it.v, on = lgSel[key].has(v) ? ' on' : '';
    return `<button class="lgchip${on}" data-facet="${key}" data-val="${esc(v)}" title="${esc(labelOf ? labelOf(it) : v)}">`
         + `${esc((labelOf ? labelOf(it) : v) || '—')}<span class="n">${fmt(it.n)}</span></button>`;
  }).join('');
}

// Human labels for the active-filter strip. Facet chip labels already apply
// short()/session-label truncation inside lgChips; duplicate the same rule
// here so a removable chip in the summary reads identically to its source.
export function lgActiveLabel(key, v){
  if (key === 'model') return short(v);
  if (key === 'session'){
    const p = lgProfile();
    const hit = p && p.facets.session && p.facets.session.find(s => s.v === v);
    return (hit && hit.label) || v.slice(0, 8);
  }
  return v;
}
export const LG_FACET_NAMES = {level:'Level', role:'Role', tool:'Tool', model:'Model',
                         session:'Session', kind:'Failure'};

export function renderLgActive(){
  const bar = $('lgactive');
  if (!bar) return;
  const chips = [];
  for (const key of Object.keys(lgSel)){
    for (const v of lgSel[key]){
      chips.push(`<button type="button" class="lgactivechip" data-unfacet="${key}" data-val="${esc(v)}">`
        + `${esc(LG_FACET_NAMES[key] || key)}: ${esc(lgActiveLabel(key, v))}<span class="x">×</span></button>`);
    }
  }
  bar.classList.toggle('show', chips.length > 0);
  bar.innerHTML = '<span class="lbl muted text-[length:var(--fs-xs)]">Active</span>' + chips.join('');
}

export function renderLogs(){
  const list = $('lglist');
  if (!list) return;
  if (logsLoading){ list.innerHTML = '<div class="muted text-[length:var(--fs-sm)]">Loading log events…</div>'; return; }
  if (logsErr){
    list.innerHTML = `<div class="muted text-[length:var(--fs-sm)]">Could not load logs-data.json (${esc(logsErr)}).`
      + ` Run <code>llm-telemetry logs</code>, and note that fetch is blocked when the page is opened from file://.</div>`;
    return;
  }
  const p = lgProfile();
  if (!p){ list.innerHTML = '<div class="muted text-[length:var(--fs-sm)]">No log events in this window.</div>'; return; }

  // Level facet is derived: errors come from errors.log, everything else is a
  // message row. Counting them here keeps the chip honest without a second query.
  const lvl = {};
  p.events.forEach(e => lvl[e.level] = (lvl[e.level]||0)+1);
  lgChips('lgf-level', 'level', Object.entries(lvl).map(([v,n])=>({v,n})).sort((a,b)=>b.n-a.n));
  lgChips('lgf-role', 'role', p.facets.role);
  lgChips('lgf-tool', 'tool', p.facets.tool);
  lgChips('lgf-model', 'model', (p.facets.model||[]).map(x=>({...x, v:x.v})), it=>short(it.v));
  lgChips('lgf-session', 'session', p.facets.session, it => it.label || it.v.slice(0,8));
  const kindRow = $('lgrow-kind');
  if (kindRow) kindRow.hidden = !(p.facets.kind && p.facets.kind.length);
  if (p.facets.kind) lgChips('lgf-kind', 'kind', p.facets.kind);
  renderLgActive();

  const rows = p.events.filter(e => lgMatch(e, p));
  $('lgcount').textContent = `${fmt(rows.length)} shown`;
  const badge = $('lgcountbadge');
  if (badge){
    const nActive = Object.values(lgSel).reduce((s, set) => s + set.size, 0);
    badge.hidden = nActive === 0;
    badge.textContent = `${nActive} filter${nActive === 1 ? '' : 's'} active`;
  }
  const cap = $('lgcap');
  if (cap){
    // The cap is disclosed, never hidden: the facet counts are computed over
    // the whole window, so they legitimately exceed the number of rows here.
    cap.hidden = !p.capped;
    cap.textContent = p.capped
      ? `· newest ${fmt(p.events_shown)} of ${fmt(p.events_total)} in the last ${p.window_h}h — filter counts cover the full window`
      : '';
  }
  $('lgscope').textContent = `last ${p.window_h}h · ${fmt(p.events_total)} events`;

  list.innerHTML = rows.slice(0, 1200).map((e,i) => {
    const t = new Date(e.ts*1000).toLocaleTimeString();
    const tag = e.level === 'error' ? (e.kind || 'error') : (e.tool || e.role);
    const cls = e.level === 'error' ? 'error' : e.role;
    const meta = [e.title, short(e.model||'')].filter(Boolean).join(' · ');
    return `<div class="lgev" data-i="${i}">`
      + `<span class="lgts">${t}</span>`
      + `<span class="lgtag ${cls}">${esc(tag)}</span>`
      + `<span class="lgmsg">${esc(e.preview||'')}`
      + (meta ? `<span class="lgmeta">${esc(meta)}</span>` : '') + `</span></div>`;
  }).join('') || '<div class="muted text-[length:var(--fs-sm)]">Nothing matches these filters.</div>';
  if (rows.length > 1200){
    list.insertAdjacentHTML('beforeend',
      `<div class="muted text-[length:var(--fs-xs)]" style="padding-top:6px">Showing the newest 1,200 of ${fmt(rows.length)} matches — narrow the filters to see more.</div>`);
  }
}

export function logsInstall(){
  // Facet clicks toggle; delegated so re-rendered chips keep working.
  document.querySelector('[data-view="Logs"]')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-facet]');
    if (chip){
      const k = chip.dataset.facet, v = chip.dataset.val;
      lgSel[k].has(v) ? lgSel[k].delete(v) : lgSel[k].add(v);
      renderLogs(); return;
    }
    // Removing from the active-filter summary strip does the same thing as
    // un-clicking the source chip, just reachable without scrolling to it.
    const unchip = e.target.closest('[data-unfacet]');
    if (unchip){
      lgSel[unchip.dataset.unfacet].delete(unchip.dataset.val);
      renderLogs(); return;
    }
    const win = e.target.closest('[data-win]');
    if (win){
      lgWindow = +win.dataset.win;
      document.querySelectorAll('[data-win]').forEach(b =>
        b.classList.toggle('on', b === win));
      renderLogs(); return;
    }
    // Clicking a row expands it: previews are one line by default so the list
    // stays scannable, but the full 120 chars must be readable without leaving.
    const row = e.target.closest('.lgev');
    if (row) row.classList.toggle('open');
  });
  $('lgq')?.addEventListener('input', e => { lgQ = e.target.value.trim().toLowerCase(); renderLogs(); });
  $('lgclear')?.addEventListener('click', () => {
    Object.values(lgSel).forEach(s => s.clear());
    lgQ = ''; const q = $('lgq'); if (q) q.value = '';
    renderLogs();
  });
  $('lgcsv')?.addEventListener('click', () => {
    const p = lgProfile(); if (!p) return;
    const rows = p.events.filter(e => lgMatch(e, p));
    // Quote every field: previews contain commas and quotes routinely.
    const q = s => '"' + String(s == null ? '' : s).replace(/"/g,'""') + '"';
    const csv = ['when,level,role,tool,model,session,title,preview']
      .concat(rows.map(e => [new Date(e.ts*1000).toISOString(), e.level, e.role,
        e.tool, e.model, e.session, e.title, e.preview].map(q).join(',')))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    const a = document.createElement('a');
    a.href = url; a.download = 'log-events.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// Wiring. Every close path the ticket names: scrim, Esc, nav activation, and
// crossing the breakpoint.
export let dFilter = 'all', dSeen = 0, dOpen = false, dScrollY = 0, dHistoryPushed = false;

// Log lines are raw provider output — they can contain angle brackets and
// quotes, so they must never be interpolated into innerHTML unescaped.

export function drawerEvents(){
  const ev = [];
  (DATA.errors || []).forEach(e => ev.push({
    ts: e.ts * 1000, level: 'error', kind: e.kind,
    model: e.model || '', profile: e.profile || '',
    text: e.msg || '',
  }));
  Object.entries(DATA.profiles || {}).forEach(([pn, p]) => {
    if (pn === 'All') return;   // already counted under its real profile
    (p.logs || []).forEach(l => {
      if (!l.tool) return;      // plain assistant text is noise here
      ev.push({
        ts: l.ts * 1000, level: 'tool', kind: 'tool',
        model: '', profile: pn,
        // Carry the tool name as its own field so the drawer can colour it;
        // baking it into `text` made it unstylable.
        tool: l.tool,
        text: (l.title || 'untitled').slice(0, 52),
      });
    });
  });
  // Summary only (#104). The drawer answers "anything I should look at right
  // now"; the Logs view answers "find the thing that happened". Routine
  // read-only tool chatter is dropped here so failures cannot be buried by it
  // — read_file/search_files alone are ~48k of the last 24h.
  const NOISE = new Set(['read_file','search_files','skill_view','tool_describe',
                         'tool_search','web_search','web_extract']);
  const notable = ev.filter(e => e.level === 'error' || !NOISE.has(e.tool || ''));
  return notable.sort((a, b) => b.ts - a.ts).slice(0, 120);
}

export function drawerSync(){
  const all = drawerEvents();
  const errs = all.filter(e => e.level === 'error');

  // Unread badge: only failures are worth interrupting for.
  const unread = dOpen ? 0 : Math.max(0, errs.length - dSeen);
  for (const bid of ['logn','logn2']){
    const badge = $(bid);
    if (badge){ badge.textContent = unread; badge.hidden = unread === 0; }
  }

  const body = $('dbody');
  if (!body) return;
  const rows = all.filter(e => dFilter === 'all' || e.level === dFilter);
  const stick = $('dauto')?.checked;
  const atTop = body.scrollTop < 40;

  body.innerHTML = rows.length ? rows.map(e => {
    const t = new Date(e.ts).toLocaleTimeString([], {hour12:false});
    const who = e.model ? `<span class="evm" style="color:${colorOf(short(e.model))}">${short(e.model)}</span> ` : '';
    // Tool events get the tool's own palette colour, same contract as models.
    const twho = e.tool ? `<span class="evt" style="color:${toolColor(e.tool)}">${esc(e.tool)}</span> ` : '';
    const pf = e.profile ? `<span class="muted">[${e.profile}]</span> ` : '';
    return `<div class="ev ${e.level==='error'?'err':''}">
      <span class="t">${t}</span>
      <span class="b"><span class="k k-${e.kind}">${e.kind.replace('_',' ')}</span>${pf}${who}${twho}${esc(e.text)}</span>
    </div>`;
  }).join('') : `<div class="muted" style="padding:18px 15px">No events in the last 2 hours.</div>`;

  const c = $('dcount');
  if (c) c.textContent = `${rows.length} events · ${errs.length} failures`;
  const s = $('dstamp');
  if (s) s.textContent = 'updated ' + new Date().toLocaleTimeString();
  // Newest is at the top, so "follow" means stay pinned to the top.
  if (stick && atTop) body.scrollTop = 0;
}

export function drawerOpen(on){
  dOpen = on;
  $('drawer')?.classList.toggle('open', on);
  $('scrim')?.classList.toggle('open', on);
  $('drawer')?.setAttribute('aria-hidden', String(!on));
  $('logbtn')?.classList.toggle('hidden', on);
  // #17: body scroll locked while the sheet/drawer is open, restored exactly
  // on close (remembers the real scroll position, not just 0).
  if (on){
    dScrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${dScrollY}px`;
    document.body.style.width = '100%';
  } else if (document.body.style.position === 'fixed') {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, dScrollY);
  }
  // #17: push a history state when opening so Android/gesture back closes
  // the sheet instead of leaving the page; pop it (without re-navigating)
  // when closing any other way so back/forward stays in sync.
  if (on && !dHistoryPushed) {
    history.pushState({ llmtDrawer: true }, '');
    dHistoryPushed = true;
  } else if (!on && dHistoryPushed) {
    dHistoryPushed = false;
    if (history.state && history.state.llmtDrawer) history.back();
  }
  if (on){
    dSeen = (DATA.errors || []).length;   // mark failures as read
    drawerSync();
  }
}
window.addEventListener('popstate', () => {
  if (dOpen) drawerOpen(false);
});

// #17: drag-down-to-close on the handle (and the header, so a stray tap
// just below the handle still works) — touch AND mouse via Pointer Events.
export function installDrawerDrag(){
  const sheet = $('drawer'), handle = $('draghandle');
  if (!sheet || !handle) return;
  let startY = null, startTransform = 0, dragging = false;
  const onDown = e => {
    if (window.innerWidth > 640) return; // only a bottom sheet at mobile width
    dragging = true; startY = e.clientY; startTransform = 0;
    sheet.style.transition = 'none';
    handle.setPointerCapture?.(e.pointerId);
  };
  const onMove = e => {
    if (!dragging || startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    startTransform = dy;
    sheet.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    // Past a quarter of the sheet's own height counts as "let go of it".
    if (startTransform > sheet.offsetHeight * 0.25) drawerOpen(false);
    startY = null;
  };
  handle.addEventListener('pointerdown', onDown);
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

export function installDrawer(){
  installDrawerDrag();
  $('logbtn')?.addEventListener('click', () => drawerOpen(!dOpen));
  // The header "Logs" chip was removed (#116): the floating edge tab and the
  // nav drawer button are the entry points. Optional-chained handlers, so the
  // markup stays the single source of truth for which controls exist.
  $('logbtn2')?.addEventListener('click', () => drawerOpen(!dOpen));
  $('navdrawerbtn')?.addEventListener('click', () => drawerOpen(!dOpen));
  // The drawer's "All logs" link hands off to the full view: close the panel,
  // then navigate, so the page you asked for is not sitting behind a sheet.
  $('dfull')?.addEventListener('click', e => {
    e.preventDefault();
    drawerOpen(false);
    pickView('Logs');
  });
  $('dclose')?.addEventListener('click', () => drawerOpen(false));
  $('scrim')?.addEventListener('click', () => drawerOpen(false));
  // The Health tab's failure panel and this drawer are both summaries; the
  // Logs view is the searchable record.
  $('tolog')?.addEventListener('click', () => drawerOpen(true));
  document.querySelectorAll('.dtab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.dtab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    dFilter = b.dataset.f;
    drawerSync();
  }));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dOpen) drawerOpen(false);
    // Plain "l" toggles, but not while typing in the date inputs.
    if (e.key === 'l' && !/input|textarea/i.test(e.target.tagName)) drawerOpen(!dOpen);
  });
}

async function pollLive(){
  // The drawer is reachable from every tab, so the feed must keep running even
  // when Live is not on screen. Only a hidden document stops it.
  if (liveBusy || document.hidden) return;
  liveBusy = true;
  try {
    const r = await fetch('live-data.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    // Version check is NOT a transient miss: say so on the first poll, not the third.
    const bad = schemaProblem(fresh, 'live-data.json');
    if (bad) { liveFails = 2; throw new Error(bad); }
    if (!fresh.profiles) throw new Error('empty payload');
    // Diff for completions BEFORE merging into DATA -- once merged there is
    // no "previous" state left to compare against. First call ever is a
    // baseline (soundBaseline stays true through it): every open session and
    // delegation is "recent" on a page load, and none of that is a real
    // completion the user should hear about.
    checkCompletions(fresh.profiles);
    soundBaseline = false;
    // Merge the live slice into each profile in place, then rebuild the
    // synthetic All profile so its merged live list stays correct.
    Object.keys(fresh.profiles).forEach(n => {
      if (!DATA.profiles[n]) return;
      const f = fresh.profiles[n];
      DATA.profiles[n].live = f.live;
      DATA.profiles[n].active = f.active;
      DATA.profiles[n].tools_recent = f.tools_recent;
      DATA.profiles[n].logs = f.logs;
      DATA.profiles[n].agents = f.agents;
    });
    DATA.errors = fresh.errors || [];
    // Fleet telemetry is global (not per-profile): both profiles share the
    // same two GPU boxes, so it hangs off DATA, not DATA.profiles[n].
    DATA.ollama = fresh.ollama || DATA.ollama;
    // #121: re-apply the ON set. The live slice was merged INTO PV_ALL's
    // profiles above, so re-filtering keeps the toggles honoured while the
    // merge picks up the fresh live rows.
    PV_ALL = Object.fromEntries(
      Object.entries(PV_ALL).map(([n, p]) => [n, DATA.profiles[n] || p]));
    DATA.profiles = pvFilter();
    tabs();
    drawerSync();
    // Repaint unconditionally. This used to be `if (view === 'Live')`, which
    // left the live list and the bandwidth card holding the first payload
    // whenever any other tab was open — the numbers silently went stale, and
    // switching back showed a jump rather than a live feed. renderLive writes
    // into hidden nodes cheaply, so there is no reason to gate it on the view.
    renderLive();
    navSync();
    // Update only the "In progress" KPI in place — the other cards depend on
    // date-filtered aggregates the live feed does not carry, so a full KPI
    // rebuild here would show wrong numbers.
    const p = DATA.profiles[current] || {};
    const card = document.querySelector('#kpis .kpi-live');
    if (card) card.innerHTML = p.active
      ? `<span style="color:#22c55e">●</span> ${p.active}`
      : `<span class="muted">●</span> 0`;
    liveFails = 0;
    const t = $('livestamp');
    if (t) t.textContent = 'live · updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    // Fail quietly: a transient miss must not blank the panel the user is
    // watching. Only a sustained outage is worth reporting.
    if (++liveFails === 3) {
      const t = $('livestamp');
      if (t) t.textContent = 'live feed stalled — ' + e.message;
    }
  } finally {
    liveBusy = false;
  }
}
// #79/P9-02: read-only transcript preview. Content is untrusted DB text —
// everything is escaped first, then specific safe affordances (links, code
// fences, data:image URIs) are opted into on the escaped string. Nothing
// here ever does innerHTML on raw model output.
export let tOpen = false, tFocusReturn = null;
export const TCACHE = {}; // profile -> {sessionId: [messages]}, refetched per open

export function tEscape(s){ return esc(String(s == null ? '' : s)); }

// Fenced code blocks first (so their contents are never re-processed by the
// link/image passes below), then bare http(s) links, then a bare
// data:image URI on its own line becomes an <img> with error->placeholder
// fallback. Everything is operating on ALREADY-ESCAPED text, so a literal
// `<script>` in the source can only ever read as text, never execute.
export function tRenderContent(raw){
  const text = tEscape(raw);
  const parts = text.split(/```([\s\S]*?)```/g);
  let out = '';
  parts.forEach((part, i) => {
    if (i % 2 === 1){
      out += `<pre>${part}</pre>`;
      return;
    }
    let seg = part
      .replace(/(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+)/g,
        '<img class="timg" src="$1" alt="attached image" ' +
        'onerror="this.classList.add(\'tbroken\');this.insertAdjacentHTML(' +
        '\'afterend\',\'&lt;broken image&gt;\')">');
    out += seg;
  });
  return out;
}

export function tRenderMsg(m){
  const role = ['user','assistant','tool'].includes(m.role) ? m.role : 'assistant';
  const when = m.ts ? new Date(m.ts * 1000).toLocaleTimeString() : '';
  let body = tRenderContent(m.content);
  if (m.tool_calls){
    const names = (Array.isArray(m.tool_calls) ? m.tool_calls : [])
      .map(c => c && (c.name || (c.function && c.function.name))).filter(Boolean);
    // tool_calls carries ~550-byte JSON with empty content — without this,
    // that message renders as a blank bubble with nothing in it.
    body += `<div class="ttoolcall">&#8594; ${tEscape(names.length ? names.join(', ') : (m.tool_name || 'tool call'))}</div>`;
  } else if (!m.content && m.tool_name){
    body = `<div class="ttoolcall">&#8594; ${tEscape(m.tool_name)} result</div>`;
  }
  return `<div class="tmsg role-${role}"><span class="trole">${role}${when ? ' · ' + when : ''}</span>${body}</div>`;
}

async function tOpenModal(sessionId, profile, titleText){
  const scrim = $('tscrim'), modal = $('tmodal'), body = $('tbody');
  const ttitle = $('ttitle'), tsub = $('tsub');
  if (!scrim || !modal || !body) return;
  tFocusReturn = document.activeElement;
  ttitle.textContent = titleText || sessionId;
  tsub.textContent = 'loading…';
  body.innerHTML = '';
  const tlBtn = $('ttimelinebtn');
  if (tlBtn){ tlBtn.dataset.tsession = sessionId; tlBtn.dataset.tprofile = profile; tlBtn.dataset.title = titleText || sessionId; }
  scrim.classList.add('open'); modal.classList.add('open');
  scrim.setAttribute('aria-hidden','false'); modal.setAttribute('aria-hidden','false');
  tOpen = true;
  document.addEventListener('keydown', tKeydown, true);
  try {
    if (!TCACHE[profile]) TCACHE[profile] = {};
    // Fetched on demand, once per open — NOT folded into the 5s live poll,
    // so a 200-message render never blocks that poll's own cadence.
    const r = await fetch('transcripts.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    const msgs = (fresh.profiles && fresh.profiles[profile] && fresh.profiles[profile][sessionId]) || [];
    if (!msgs.length){
      body.innerHTML = emptyHTML('○', 'No recent messages captured for this session yet.',
        'The transcript window refreshes with the collector cycle.');
      tsub.textContent = '';
    } else {
      // Render nodes are capped at the collector's own WINDOW (currently
      // 200) — the payload itself is already bounded, so no extra
      // virtualisation is needed to keep this from freezing the page.
      body.innerHTML = msgs.map(tRenderMsg).join('');
      tsub.textContent = `${msgs.length} messages · most recent tail`;
      body.scrollTop = body.scrollHeight;
    }
  } catch (e){
    body.innerHTML = emptyHTML('!', 'Could not load this transcript.', e.message);
    tsub.textContent = '';
  }
  modal.focus();
}

export function tCloseModal(){
  if (!tOpen) return;
  tOpen = false;
  $('tscrim')?.classList.remove('open');
  $('tmodal')?.classList.remove('open');
  $('tscrim')?.setAttribute('aria-hidden','true');
  $('tmodal')?.setAttribute('aria-hidden','true');
  document.removeEventListener('keydown', tKeydown, true);
  // Focus goes back to the title button that opened it, not lost to <body>.
  tFocusReturn?.focus?.();
  tFocusReturn = null;
}

export function tKeydown(e){
  if (e.key === 'Escape'){ e.preventDefault(); tCloseModal(); return; }
  // Trap focus inside the modal while open — Tab/Shift+Tab never escape to
  // the page behind the scrim.
  if (e.key === 'Tab'){
    const modal = $('tmodal');
    if (!modal) return;
    const focusables = [...modal.querySelectorAll('a[href],button')]
      .filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first){
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last){
      e.preventDefault(); first.focus();
    }
  }
}

export function installTranscriptModal(){
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('.ttitlebtn');
    if (btn){
      tOpenModal(btn.dataset.tsession, btn.dataset.tprofile, btn.textContent.trim());
    }
  });
  $('tclose')?.addEventListener('click', tCloseModal);
  $('tscrim')?.addEventListener('click', tCloseModal);
}

// P10-12 (#100): Session finder command palette UI. Pure matching logic
// (sfParseQuery/sfMatch/sfSearch) lives above render(); this is just
// DOM plumbing on top of it.
export let sfOpen = false, sfFocusReturn = null, sfResults = [], sfActiveIdx = -1;

export function sfRowsHtml(results, query){
  if (!results.length){
    const idx = DATA.profiles[current]?.session_index || [];
    return idx.length
      ? emptyHTML('○', 'No sessions match.', 'Try a broader query, or drop a structured filter like model:/tool:/source:/end:.')
      : emptyHTML('○', 'No sessions in range.', 'Nothing has been indexed for this profile yet.');
  }
  const words = query.trim().split(/\s+/).filter(w => w && !/[:<>]/.test(w));
  const hl = s => {
    if (!words.length) return esc(s);
    let out = esc(s);
    words.forEach(w => {
      const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  };
  return results.slice(0, 60).map((s, i) => `
    <div class="sfrow${i===sfActiveIdx?' sfactive':''}" id="sfrow-${i}" role="option"
         aria-selected="${i===sfActiveIdx}" data-idx="${i}">
      <span class="sfrowtitle flex-1 truncate">${hl(s.title || s.id)}</span>
      <span class="sfrowmeta">${esc(s.model||'')}${s.tools&&s.tools.length?' · '+esc(s.tools.slice(0,3).join(', ')):''}</span>
      <span class="sfrowmeta">${s.cost?('$'+s.cost.toFixed(2)):''}</span>
    </div>`).join('');
}

export function sfRender(){
  const query = $('sfinput').value;
  const idx = DATA.profiles[current]?.session_index || [];
  sfResults = sfSearch(idx, query);
  sfActiveIdx = sfResults.length ? Math.min(sfActiveIdx < 0 ? 0 : sfActiveIdx, sfResults.length - 1) : -1;
  $('sflist').innerHTML = sfRowsHtml(sfResults, query);
  $('sfinput').setAttribute('aria-activedescendant', sfActiveIdx >= 0 ? `sfrow-${sfActiveIdx}` : '');
}

export function sfOpenPalette(){
  const scrim = $('sfscrim'), modal = $('sfmodal');
  if (!scrim || !modal) return;
  sfFocusReturn = document.activeElement;
  sfOpen = true;
  scrim.classList.add('open'); modal.classList.add('open');
  scrim.setAttribute('aria-hidden','false'); modal.setAttribute('aria-hidden','false');
  $('sfinput').value = '';
  sfActiveIdx = -1;
  sfRender();
  $('sfinput').focus();
}

export function sfClosePalette(){
  const scrim = $('sfscrim'), modal = $('sfmodal');
  if (!scrim || !modal) return;
  sfOpen = false;
  scrim.classList.remove('open'); modal.classList.remove('open');
  scrim.setAttribute('aria-hidden','true'); modal.setAttribute('aria-hidden','true');
  if (sfFocusReturn && sfFocusReturn.focus) sfFocusReturn.focus();
}

export function sfOpenSelected(){
  if (sfActiveIdx < 0 || !sfResults[sfActiveIdx]) return;
  const s = sfResults[sfActiveIdx];
  sfClosePalette();
  // P10-06 (#94): jump straight to the session timeline, the ticket's own
  // named target -- the transcript modal (#79) is the other jump target
  // it names, reachable from inside the timeline's own title button.
  lnOpenModal(s.id, current, s.title);
}

export function installSessionFinder(){
  if (!$('sfinput')) return;
  document.addEventListener('keydown', e => {
    if (!sfOpen && e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)){
      e.preventDefault(); sfOpenPalette(); return;
    }
    if (!sfOpen) return;
    if (e.key === 'Escape'){ e.preventDefault(); sfClosePalette(); return; }
    if (e.key === 'ArrowDown'){ e.preventDefault(); sfActiveIdx = Math.min(sfActiveIdx + 1, sfResults.length - 1); sfRender2(); return; }
    if (e.key === 'ArrowUp'){ e.preventDefault(); sfActiveIdx = Math.max(sfActiveIdx - 1, 0); sfRender2(); return; }
    if (e.key === 'Enter'){ e.preventDefault(); sfOpenSelected(); return; }
  });
  // Re-render on query change WITHOUT resetting sfActiveIdx to -1 (arrow
  // navigation calls this too, so it must not re-run the search and lose
  // the current selection).
  function sfRender2(){
    $('sflist').innerHTML = sfRowsHtml(sfResults, $('sfinput').value);
    $('sfinput').setAttribute('aria-activedescendant', sfActiveIdx >= 0 ? `sfrow-${sfActiveIdx}` : '');
  }
  window.sfRender2 = sfRender2;
  $('sfinput').addEventListener('input', sfRender);
  $('sfscrim').addEventListener('click', sfClosePalette);
  $('sflist').addEventListener('click', e => {
    const row = e.target.closest?.('.sfrow');
    if (row){ sfActiveIdx = parseInt(row.dataset.idx, 10); sfOpenSelected(); }
  });
}

// P10-06 (#94): session timeline. Fetched on demand from a per-session
// static file (sessions/<profile>/<id>.json — ADR 0001, same decision
// #79's windowed transcripts.json already made: a 589-message session is
// fine to fetch, a 72k-message one would not be, so the collector caps
// exports and a missing file means "not exported", not an error state
// the user has to puzzle over).
export const LN_LANES = ['model', 'tool', 'delegation', 'compaction', 'user'];
export const LN_LANE_LABELS = { model: 'Model', tool: 'Tool', delegation: 'Delegation', compaction: 'Compaction', user: 'User' };
export let lnOpen = false, lnFocusReturn = null, lnSpansFlat = [], lnFocusIdx = -1;
export let lnOpenAt = null;   // {session, profile, title} — what Enter hands to the transcript modal

async function lnOpenModal(sessionId, profile, titleText){
  const scrim = $('lnscrim'), modal = $('lnmodal'), body = $('lnbody');
  if (!scrim || !modal || !body) return;
  lnFocusReturn = document.activeElement;
  $('lntitle').textContent = titleText || sessionId;
  $('lnsub').textContent = 'loading\u2026';
  $('lnmeta').textContent = '';
  body.innerHTML = '';
  scrim.classList.add('open'); modal.classList.add('open');
  scrim.setAttribute('aria-hidden','false'); modal.setAttribute('aria-hidden','false');
  lnOpen = true;
  lnOpenAt = { session: sessionId, profile, title: titleText || sessionId };
  document.addEventListener('keydown', lnKeydown, true);
  try {
    const r = await fetch(`sessions/${encodeURIComponent(profile)}/${encodeURIComponent(sessionId)}.json?t=` + Date.now(), {cache:'no-store'});
    if (r.status === 404){
      body.innerHTML = emptyHTML('○', 'This session was not exported.',
        'Only the most recent sessions in range get a timeline file — older ones say so rather than silently showing nothing.');
      $('lnsub').textContent = '';
      modal.focus();
      return;
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tl = await r.json();
    lnRenderTimeline(tl);
  } catch (e){
    body.innerHTML = emptyHTML('!', 'Could not load this session timeline.', e.message);
    $('lnsub').textContent = '';
  }
  modal.focus();
}

export function lnRenderTimeline(tl){
  const body = $('lnbody');
  $('lntitle').textContent = tl.title || tl.id;
  $('lnsub').textContent = tl.running ? 'running' : (tl.end_reason || '');
  const durS = Math.max(1, (tl.axis_end || 0) - (tl.axis_start || 0));
  $('lnmeta').textContent =
    `${(tl.models||[]).join(', ') || '(unknown model)'} \u00b7 ` +
    `${(tl.input_tokens||0).toLocaleString()} in / ${(tl.output_tokens||0).toLocaleString()} out \u00b7 ` +
    `$${(tl.actual_cost_usd || tl.estimated_cost_usd || 0).toFixed(4)}` +
    (tl.running ? ' \u00b7 still running' : '');

  const spans = tl.spans || [];
  lnSpansFlat = spans;
  lnFocusIdx = -1;

  body.innerHTML = LN_LANES.map(lane => {
    const laneSpans = spans.filter(s => s.lane === lane);
    const pxSpans = laneSpans.map((s, i) => {
      const leftPct = ((s.start - tl.axis_start) / durS) * 100;
      const widthPct = Math.max(0.3, ((s.end - s.start) / durS) * 100);
      const isTick = s.start === s.end;
      const idx = spans.indexOf(s);
      return `<div class="lnspan${s.failed ? ' lnfail' : ''}${isTick ? ' lntick' : ''}"
        style="left:${leftPct}%;width:${widthPct}%;background:${lnColorOf(s.color_key)}"
        data-lnidx="${idx}" data-lnlabel="${esc(s.label)}" data-lnmeta="${esc(JSON.stringify(s.meta||{}))}"
        tabindex="-1"></div>`;
    }).join('');
    return `<div class="lnlane">
      <div class="lnlanename">${esc(LN_LANE_LABELS[lane])}</div>
      <div class="lntrack">${pxSpans}</div>
    </div>`;
  }).join('');
}

export function lnCloseModal(){
  if (!lnOpen) return;
  lnOpen = false;
  $('lnscrim')?.classList.remove('open');
  $('lnmodal')?.classList.remove('open');
  $('lnscrim')?.setAttribute('aria-hidden','true');
  $('lnmodal')?.setAttribute('aria-hidden','true');
  $('lntip').style.display = 'none';
  document.removeEventListener('keydown', lnKeydown, true);
  lnFocusReturn?.focus?.();
  lnFocusReturn = null;
  lnOpenAt = null;
}

export function lnKeydown(e){
  if (e.key === 'Escape'){ e.preventDefault(); lnCloseModal(); return; }
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'){
    if (!lnSpansFlat.length) return;
    e.preventDefault();
    lnFocusIdx = e.key === 'ArrowRight'
      ? Math.min(lnSpansFlat.length - 1, lnFocusIdx + 1)
      : Math.max(0, lnFocusIdx - 1);
    const el = document.querySelector(`#lnbody [data-lnidx="${lnFocusIdx}"]`);
    el?.focus?.();
    el?.scrollIntoView?.({block:'nearest', inline:'nearest'});
  }
  if (e.key === 'Enter'){
    // Ticket: Enter opens the transcript modal for this session (#79 has
    // landed). Opens at the top of that session's transcript — mapping a
    // span to an exact message index is not reliable (spans aggregate
    // message runs), so the transcript's own scroll does the finding.
    if (lnOpenAt && lnOpenAt.session){
      e.preventDefault();
      lnCloseModal();
      tOpenModal(lnOpenAt.session, lnOpenAt.profile || '', lnOpenAt.title || lnOpenAt.session);
    }
  }
}

// Any lane's color_key may be a model name, a tool name, or a delegation
// child id / "compaction" / "user" sentinel — try the model palette, then
// the tool palette, then fall back to a stable hash colour so an unknown
// future value still renders something distinct rather than one flat grey.
export function lnColorOf(key){
  if (COLORS[key]) return COLORS[key];
  if (TOOLCOLORS[key]) return TOOLCOLORS[key];
  if (key === 'compaction') return '#f59e0b';
  if (key === 'user') return '#64748b';
  return `hsl(${hashHue(key||'')} 52% 58%)`;
}

export function installTimelineModal(){
  document.addEventListener('click', e => {
    const btn = e.target.closest?.('.lntimelinebtn');
    if (btn){
      lnOpenModal(btn.dataset.tsession, btn.dataset.tprofile, btn.dataset.title || btn.dataset.tsession);
      return;
    }
    const span = e.target.closest?.('.lnspan');
    if (span){
      $('lntip').style.display = 'none';
      return;
    }
  });
  document.addEventListener('mouseover', e => {
    const span = e.target.closest?.('.lnspan');
    const tip = $('lntip');
    if (!span || !tip) return;
    const label = span.dataset.lnlabel || '';
    tip.textContent = label.slice(0, 80);
    const r = span.getBoundingClientRect();
    tip.style.left = r.left + 'px';
    tip.style.top = (r.top - 32) + 'px';
    tip.style.display = 'block';
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest?.('.lnspan')) $('lntip').style.display = 'none';
  });
  $('lnclose')?.addEventListener('click', lnCloseModal);
  $('lnscrim')?.addEventListener('click', lnCloseModal);
}

// P7-05 (#112): re-schedule from a self-recursing setTimeout rather than a
// fixed setInterval, so changing LIVE_MS/REBUILD_MS_LIVE in the Advanced
// settings card takes effect on the very next tick -- a setInterval's
// delay is fixed at the moment it is created and would ignore a later
// change until a page reload.
