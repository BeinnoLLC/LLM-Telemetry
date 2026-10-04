/**
 * Router: section switching, hash routing and persistence — plus the
 * Settings page, the nav drawer and the per-profile colour/logo controls.
 */
import {
  $, COLORS, TOOLCOLORS, allModelNames, allToolNames, buildColors, buildToolColors, esc, escA, hashHue, pick, slugOf,
} from './palette.js';
import {
  bounds, charts, current, outPer1M, projDistNormalized, projTrendStacked, usdPerSec,
} from './charts.js';
import { flash, render, renderResolution, syncProjFilterUI } from './views.js';
import { renderFlow } from './flow.js';
import { loadLogs, logsInstall } from './drawer.js';
import { LIVE_MS, REBUILD_MS, renderLive } from './live.js';
import { DATA, buildAll, installAll } from './main.js';

export let view = localStorage.getItem('hermes-dash-view') || 'Home';
// #129: sub-day range presets (1h/6h/12h). null = the from/to DATE range
// applies as before (day grain, p.rows). A number = "last N hours from
// now", read from p.hour_rows (real hour-grain data, HOUR_WINDOW_S-bounded
// server-side — see collect_analytics.py). Exclusive with the date pickers:
// picking a day preset or editing From/To clears this back to null.
export let HOUR_RANGE = null;
// Chart.js plays a draw-in animation (bars growing, pie slices sweeping) on
// every (re)creation. That is the right first impression on page load, but
// mk() destroys and recreates every chart on EVERY render() call — including
// the 60s auto-refresh poll and the 5s live tick touching cLiveCat — so
// without this flag the whole page would replay its entrance animation once
// a minute forever. CHART_ANIM_DONE flips true once, right after the first
// paint (bootDone()), and mk() then forces animation:false on every chart it
// builds from that point on: the data still updates, it just snaps instead
// of re-animating from zero.
export function setRange(from,to){ HOUR_RANGE=null; $('from').value=from; $('to').value=to; render(); updateRangeToggleLabel(); }
// #129: pick a sub-day preset (hours = 1/6/12). Clears the date pickers'
// influence for this render — hourRowsFor() below is what render() actually
// reads while HOUR_RANGE is set.
export function setHourRange(hours){ HOUR_RANGE=hours; render(); updateRangeToggleLabel(); }
// Real "last N hours from now" filter over p.hour_rows (server-bounded to
// HOUR_WINDOW_S = 72h — see collect_analytics.py). Falls back to an empty
// slice rather than silently widening to the day range: a 1h preset that
// quietly showed a whole day of data would be worse than showing nothing.
export function hourRowsFor(p, hours){
  const cutoff = Date.now() - hours*3600*1000;
  return (p.hour_rows || []).filter(r => {
    if (!r.date) return false;
    // r.date/r.hour are LOCAL-time bucket boundaries (see HOUR_ROWS SQL:
    // date()/strftime('%H',...,'localtime')) — reconstruct as a local Date,
    // not UTC, or every host west of UTC would drop its most recent hour.
    // Compare against the bucket's END (start + 1h), not its start: a row
    // bucketed "14:00" holds calls anywhere from 14:00 to 14:59, and
    // comparing the bucket START against the cutoff would incorrectly drop
    // a call from 14:55 under a 1h preset requested at 14:58 (bucket start
    // 14:00 is already >1h old even though the actual call is 3 minutes
    // old). Hour grain cannot know the exact within-hour timestamp, so this
    // errs toward inclusion at the edge rather than dropping real recent data.
    const d = new Date(r.date + 'T00:00:00');
    d.setHours((r.hour || 0) + 1);
    return d.getTime() >= cutoff;
  });
}

// #13: mobile-only collapsed range chip. Desktop never toggles .rangeopen
// (the toggle button stays display:none outside the mobile media query), so
// this is a no-op cost on every other viewport.
export function updateRangeToggleLabel(){
  const rt = $('rangetoggle'); if (!rt) return;
  if (HOUR_RANGE){ rt.textContent = `${HOUR_RANGE}h`; return; }
  const from = $('from').value, to = $('to').value;
  rt.textContent = from && to ? (from === to ? from : `${from} → ${to}`) : 'Range';
}
(function initRangeToggle(){
  const rt = $('rangetoggle'), rb = $('rangebar'); if (!rt || !rb) return;
  rt.onclick = () => {
    const open = rb.classList.toggle('rangeopen');
    rt.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
})();

export function presets(p){
  const [lo,hi] = bounds(p);
  const days = n => { const d=new Date(hi); d.setDate(d.getDate()-(n-1));
    const s=d.toISOString().slice(0,10); return s<lo?lo:s; };
  // #129: hour presets are separate chips (own data-h attribute) from the
  // day presets — they set HOUR_RANGE instead of From/To, and read
  // p.hour_rows (real per-hour data) rather than collapsing to "today" like
  // reusing the 24h day-preset would.
  const hourDefs = [1, 6, 12];
  const defs = [['24h',()=>[hi,hi]],['7d',()=>[days(7),hi]],['30d',()=>[days(30),hi]],['All',()=>[lo,hi]]];
  $('presets').innerHTML =
    hourDefs.map(h=>`<span class="chip" data-h="${h}" title="Last ${h} hour${h===1?'':'s'}, real hourly data">${h}h</span>`).join('') +
    defs.map(([l],i)=>`<span class="chip" data-p="${i}">${l}</span>`).join('');
  $('presets').querySelectorAll('[data-h]').forEach(el =>
    el.onclick = () => setHourRange(+el.dataset.h));
  $('presets').querySelectorAll('[data-p]').forEach((el,i)=>
    el.onclick = () => { const [a,b]=defs[i][1](); setRange(a,b); });
  updateRangeToggleLabel();
}

// Shared chart factory: used by render() and renderLive(), so it must live at
// module scope rather than inside render().
// Resolve a chart label back to its colour. Labels carry a provider glyph
// prefix (ic()/PROV.icon), so strip that before looking the name up. Models
// resolve through COLORS, providers through PROV — meaning a label is tinted
// the same as the bar, slice or line it names, in EVERY chart.
export let PROJECT_FILTER = '';
// Provider and model cross-filters, alongside project (#130). Same discipline:
// ONE piece of state each, applied as a row-filter step that COMPOSES with the
// range and the profile tabs, carried in the hash so a filtered view is one
// shareable URL. Provider is a slot name ("anthropic", "nous", "ollama-12");
// model is the id exactly as the row records it, since that is what the
// collector prices and the charts label.
export let PROVIDER_FILTER = '';
export let MODEL_FILTER = '';

// Written by pickView. No timing flag: compare the hash to the view that is
// already showing. A timer-based guard raced with jsdom's async hashchange and
// let a redundant re-render wipe the live list mid-update.
export function setHash(v){
  const p = [];
  if (PROJECT_FILTER) p.push('project=' + encodeURIComponent(PROJECT_FILTER));
  if (PROVIDER_FILTER) p.push('provider=' + encodeURIComponent(PROVIDER_FILTER));
  if (MODEL_FILTER) p.push('model=' + encodeURIComponent(MODEL_FILTER));
  const want = '#/' + slugOf(v) + (p.length ? '?' + p.join('&') : '');
  if (location.hash !== want) location.hash = want;
}

// Resolve a hash to a real view name, case-insensitively, falling back to the
// stored view then Home. An unknown slug must not blank the page.
export function viewFromHash(){
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
  if (!raw) return null;
  const names = [...document.querySelectorAll('.view')].map(el => el.dataset.view);
  return names.find(nm => slugOf(nm) === slugOf(raw)) || null;
}

// P4-09 (#46): pulls ?project=… out of the hash's query part. Deep-linking
// a filter is the whole point — a URL someone pastes into chat should
// restore exactly the view they were looking at, filter included.
export function projectFromHash(){
  return filterFromHash('project');
}

// Setters, because an ES import is a read-only binding: a caller in another
// module assigning to PROJECT_FILTER throws the moment the module is loaded
// directly (a test, a bundler, a worker) — the inlined page hides it by erasing
// the import. State stays here; everyone else goes through these.
export function setCrossFilter(key, value){
  if (key === 'project') PROJECT_FILTER = value || '';
  else if (key === 'provider') PROVIDER_FILTER = value || '';
  else if (key === 'model') MODEL_FILTER = value || '';
}
export function clearCrossFilters(){ PROJECT_FILTER = PROVIDER_FILTER = MODEL_FILTER = ''; }
// Boot and hashchange: read all three out of the one query string.
export function setFiltersFromHash(){
  PROJECT_FILTER = projectFromHash();
  PROVIDER_FILTER = filterFromHash('provider');
  MODEL_FILTER = filterFromHash('model');
}

// One reader for all three cross-filters: they live in the same query string and
// differ only by key. A malformed hash must degrade to "no filter", never throw
// and blank the page.
export function filterFromHash(key){
  const raw = location.hash || '';
  const qIdx = raw.indexOf('?');
  if (qIdx === -1) return '';
  try {
    return new URLSearchParams(raw.slice(qIdx + 1)).get(key) || '';
  } catch (e) { return ''; }
}

window.addEventListener('hashchange', () => {
  const v = viewFromHash();
  setFiltersFromHash();
  syncProjFilterUI();
  // Back/forward land here, and so does pickView's own hash write. Comparing
  // against the visible view makes the self-write a no-op, so a view change
  // renders exactly once.
  if (v && v !== view) pickView(v);
  else render();
});

// ---- Settings (P7-03, #67) -------------------------------------------------
// POWER is embedded at build time from energy.py (tariff as configured when
// the page was built, plus the read-only measured facts). The live values
// come from GET /api/settings when the serve process is present, so the page
// shows what is in effect *now*, not what it was built with.
export const POWER = __POWER__;
export const SET_DEFAULTS = POWER.defaults;
export let setState = {values: {...POWER.tariff}, writable: false, api: false, file: POWER.config_file || ''};

export function setRead(){
  const v = {};
  document.querySelectorAll('#setcard input[data-key]').forEach(i => { v[i.dataset.key] = +i.value; });
  return v;
}
export function setWrite(v){
  document.querySelectorAll('#setcard input[data-key]').forEach(i => {
    if (v[i.dataset.key] != null) i.value = v[i.dataset.key];
  });
}
export function setInvalid(){
  return [...document.querySelectorAll('#setcard input[data-key]')]
    .filter(i => i.value === '' || !i.checkValidity()).map(i => i.dataset.key);
}

export function renderSetDeriv(){
  const box = document.getElementById('setderiv'); if (!box) return;
  const v = setRead(), bad = setInvalid();
  if (bad.length){
    box.innerHTML = `<span class="setbad">Check ${bad.map(esc).join(', ')}: out of range or empty.</span>`;
  } else {
    const w = (+v.gpu_draw_watts) + (+v.host_overhead_watts);
    const s = usdPerSec(v);
    const o30 = outPer1M(v, 30);
    box.innerHTML =
      `<code>(${+v.gpu_draw_watts} W + ${+v.host_overhead_watts} W) / 1000 \u00d7 $${+v.electricity_rate_kwh} / 3600</code>` +
      ` = <b id="setusdsec">$${s.toPrecision(2)}</b> per second of inference` +
      `<div class="muted text-[length:var(--fs-xs)] mt-1">A 30B model at 30 tok/s \u2192 <b>$${o30.toFixed(4)}</b> per 1M output tokens,` +
      ` $${(o30 / POWER.prefill).toFixed(4)} per 1M input, $${(o30 / POWER.cachex).toFixed(4)} per 1M cached.` +
      ` Total draw ${w} W.</div>`;
  }
  const changed = Object.keys(SET_DEFAULTS).some(k => +v[k] !== +setState.values[k]);
  const save = document.getElementById('setsave');
  if (save) save.disabled = !setState.writable || !changed || bad.length > 0;
}

export function renderSetFacts(){
  const box = document.getElementById('setfacts'); if (!box) return;
  const v = setRead();
  const rows = POWER.tps.map(([band, tps]) =>
    `<tr><td>${esc(band)}</td><td class="text-right">${tps}</td>` +
    `<td class="text-right">$${outPer1M(v, tps).toFixed(4)}</td></tr>`).join('');
  box.innerHTML =
    `<div class="setfacts2"><table class="w-full text-[length:var(--fs-xs)]"><thead><tr class="muted text-left">` +
    `<th>Size band</th><th class="text-right">tok/s</th><th class="text-right">$/1M out</th></tr></thead>` +
    `<tbody>${rows}<tr><td class="muted">unknown size</td><td class="text-right">${POWER.tps_default}</td>` +
    `<td class="text-right">$${outPer1M(v, POWER.tps_default).toFixed(4)}</td></tr></tbody></table>` +
    `<ul class="text-[length:var(--fs-xs)] setlist">` +
    `<li><b>Prefill \u00d7${POWER.prefill}</b> cheaper than generating: the prompt is one batched forward pass.</li>` +
    `<li><b>Cache read \u00d7${POWER.cachex}</b> cheaper: no matmuls, but KV tensors still stream out of VRAM with the GPU powered.</li>` +
    `<li>Throughput is measured per model size on the local inference box; a model is matched to the first band in its name.</li>` +
    `</ul></div>`;
}

export function setMsg(text, kind){
  const m = document.getElementById('setmsg'); if (!m) return;
  m.textContent = text || '';
  m.className = 'text-[length:var(--fs-xs)] ' + (kind === 'err' ? 'setbad' : kind === 'ok' ? 'setok' : 'muted');
}

export function renderSettings(){
  const src = document.getElementById('setsrc');
  if (src){
    src.textContent = setState.api
      ? (setState.file ? 'config: ' + setState.file : '')
      : 'read-only: values as built' + (setState.file ? ' from ' + setState.file : '');
  }
  if (!setState.api){
    setMsg('Saving needs the dashboard served by `llm-telemetry serve`. Edit the config file directly, or paste: '
      + JSON.stringify(setRead()), 'info');
  } else if (!setState.writable){
    setMsg('Settings can only be changed from the machine running the dashboard.', 'info');
  }
  renderSetDeriv();
  renderSetFacts();
  renderSetColors();
  renderSetLogos();
}

// ---- #126: per-profile colour picker on the Settings page -----------------
// One swatch+slider row per profile that has ever been seen (PV_ALL, not just
// the currently-on set, so a toggled-off profile's colour is still editable).
// The row reflects the CURRENT effective hue (override if set, else the
// hashHue default) so opening Settings never shows a value that disagrees
// with what the tab strip is actually drawing right now.
export function setColorSwatch(n){
  const h = profileHue(n);
  const overridden = pvHueOverride(n) !== null;
  return `<div class="setf" data-scname="${escA(n)}">
    <span class="setl">${esc(n)}</span>
    <span class="setin">
      <span style="width:16px;height:16px;border-radius:999px;flex:none;background:hsl(${h} 62% 45%);border:1px solid var(--border)"></span>
      <input type="range" min="0" max="359" step="1" value="${h}" data-schue="${escA(n)}" style="flex:1;min-width:0">
      <span class="muted text-[length:var(--fs-xs)]" style="min-width:2.6em;text-align:right" data-schuen="${escA(n)}">${h}°</span>
    </span>
    <span class="seth">${overridden ? 'Custom — ' : 'Default (from name) — '}used for its tab, badges and live dots.</span>
  </div>`;
}
export function renderSetColors(){
  const box = document.getElementById('setcolorgrid');
  if (!box || !PV_ALL) return;
  // Rebuild only when the profile SET changed; a slider drag re-renders via
  // direct DOM writes below so mid-drag input events don't fight a rebuild.
  const names = Object.keys(PV_ALL);
  const have = [...box.querySelectorAll('[data-scname]')].map(el => el.dataset.scname);
  if (have.length === names.length && have.every(n => names.includes(n))) return;
  box.innerHTML = names.map(setColorSwatch).join('') || '<div class="muted text-[length:var(--fs-sm)]">No profiles yet.</div>';
}
export function setColorsInstall(){
  const box = document.getElementById('setcolorgrid');
  if (!box) return;
  box.addEventListener('input', e => {
    const inp = e.target.closest && e.target.closest('[data-schue]');
    if (!inp) return;
    const n = inp.dataset.schue;
    const deg = Number(inp.value);
    pvHueSet(n, deg);
    // live-update the swatch and readout without a full rebuild, so dragging
    // the slider stays smooth instead of re-rendering the whole grid per tick
    const row = inp.closest('[data-scname]');
    if (row){
      const dot = row.querySelector('.setin > span[style*="border-radius:999px"]');
      if (dot) dot.style.background = `hsl(${deg} 62% 45%)`;
      const readout = row.querySelector(`[data-schuen="${CSS.escape(n)}"]`);
      if (readout) readout.textContent = deg + '°';
      const hint = row.querySelector('.seth');
      if (hint) hint.textContent = 'Custom — used for its tab, badges and live dots.';
    }
    // Everywhere else that draws this profile's colour must pick it up
    // immediately, not just on the next poll — a settings change with no
    // visible effect elsewhere reads as broken.
    tabs(); renderLive();
  });
  document.getElementById('setcolorreset')?.addEventListener('click', () => {
    Object.keys(PV_ALL || {}).forEach(n => pvHueSet(n, null));
    const box2 = document.getElementById('setcolorgrid');
    if (box2) box2.innerHTML = '';   // force renderSetColors() to rebuild every row
    renderSetColors();
    tabs(); renderLive();
    const m = document.getElementById('setcolormsg');
    if (m) { m.textContent = 'Reset to name-derived defaults.'; m.className = 'text-[length:var(--fs-xs)] ok'; }
  });
}

// ---- #128: per-profile logo uploader on the Settings page -----------------
// One row per profile that has ever been seen (PV_ALL) — a file picker plus
// a live preview using the exact same profileIconHtml() the tabs render, so
// the preview can never drift from what actually shows up in the strip.
export function setLogoRow(n){
  const logo = profileLogo(n);
  return `<div class="setf" data-slname="${escA(n)}">
    <span class="setl">${esc(n)}</span>
    <span class="setin" style="gap:8px">
      ${profileIconHtml(n, 28)}
      <input type="file" accept="image/*" data-slfile="${escA(n)}" style="flex:1;min-width:0;font-size:var(--fs-xs)">
      ${logo ? `<button type="button" data-slclear="${escA(n)}" class="chip" style="padding:2px 8px">Clear</button>` : ''}
    </span>
    <span class="seth" data-slmsg="${escA(n)}">${logo ? 'Custom logo set.' : 'No logo — showing the name-derived initial.'}</span>
  </div>`;
}
export function renderSetLogos(){
  const box = document.getElementById('setlogogrid');
  if (!box || !PV_ALL) return;
  const names = Object.keys(PV_ALL);
  // Logos change via file picker (not a live-dragging slider), so this can
  // safely rebuild every time — no drag-smoothness concern like colours.
  box.innerHTML = names.map(setLogoRow).join('') || '<div class="muted text-[length:var(--fs-sm)]">No profiles yet.</div>';
}
export function setLogosInstall(){
  const box = document.getElementById('setlogogrid');
  if (!box) return;
  const setRowMsg = (n, text, kind) => {
    const row = box.querySelector(`[data-slname="${CSS.escape(n)}"]`);
    if (!row) return;
    const msg = row.querySelector('.seth');
    if (msg) { msg.textContent = text; msg.className = 'seth' + (kind ? ' ' + kind : ''); }
  };
  box.addEventListener('change', e => {
    const inp = e.target.closest && e.target.closest('[data-slfile]');
    if (!inp) return;
    const n = inp.dataset.slfile;
    const file = inp.files && inp.files[0];
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      setRowMsg(n, 'Not an image file — ignored.', 'setbad'); inp.value = ''; return;
    }
    if (file.size > PROFILE_LOGO_MAX_BYTES) {
      setRowMsg(n, `Too large (${(file.size/1024).toFixed(0)}KB) — max ${PROFILE_LOGO_MAX_BYTES/1024}KB.`, 'setbad');
      inp.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      profileLogoSet(n, reader.result);
      renderSetLogos();  // rebuilds this row's preview + every other row untouched
      tabs();            // the tab strip must pick it up immediately, same as colours (#126)
      setRowMsg(n, 'Custom logo set.', 'setok');
    };
    reader.onerror = () => setRowMsg(n, 'Could not read that file.', 'setbad');
    reader.readAsDataURL(file);
  });
  box.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('[data-slclear]');
    if (!btn) return;
    const n = btn.dataset.slclear;
    profileLogoSet(n, null);
    renderSetLogos();
    tabs();
  });
}

export async function loadSettings(){
  setWrite(setState.values);
  try {
    const r = await fetch('api/settings', {cache: 'no-store'});
    if (r.ok){
      const j = await r.json();
      // Only a well-formed settings reply counts: a static host or a stub
      // that answers every URL with some other JSON must leave the page on
      // its embedded, read-only values rather than crash it.
      const ok = j && j.values && Object.keys(SET_DEFAULTS).every(k => Number.isFinite(+j.values[k]));
      if (ok){
        setState = {values: j.values, writable: !!j.writable, api: true, file: j.config_file || setState.file};
        setWrite(setState.values);
      }
    }
  } catch (e) { /* static hosting: stay read-only */ }
  renderSettings();
}

export async function saveSettings(){
  const bad = setInvalid();
  if (bad.length) return setMsg('Fix ' + bad.join(', ') + ' first.', 'err');
  const v = setRead();
  const body = {};
  Object.keys(SET_DEFAULTS).forEach(k => { if (+v[k] !== +setState.values[k]) body[k] = +v[k]; });
  if (!Object.keys(body).length) return setMsg('Nothing changed.', 'info');
  setMsg('Saving\u2026', 'info');
  try {
    const r = await fetch('api/settings', {method: 'POST', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-LLM-Telemetry': '1'}, body: JSON.stringify(body)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setMsg(j.error || ('Save failed (' + r.status + ')'), 'err');
    setState.values = j.values; setState.file = j.config_file || setState.file;
    setWrite(setState.values);
    setMsg('Saved to ' + setState.file + '. Costs update on the next refresh (about a minute).', 'ok');
    renderSetDeriv();
  } catch (e) {
    setMsg('Save failed: ' + e.message, 'err');
  }
}

export const INTERVAL_DEFAULTS = {
  live_poll_interval_s: (POWER.interval_defaults && POWER.interval_defaults.live_poll_interval_s) || 5,
  analytics_rebuild_interval_s: (POWER.interval_defaults && POWER.interval_defaults.analytics_rebuild_interval_s) || 60,
};

export function intervalsRead(){
  const v = {};
  document.querySelectorAll('#setintervalscard input[data-key]').forEach(i => { v[i.dataset.key] = +i.value; });
  return v;
}
export function intervalsWrite(v){
  document.querySelectorAll('#setintervalscard input[data-key]').forEach(i => {
    if (v[i.dataset.key] != null) i.value = v[i.dataset.key];
  });
}
export function intervalsInvalid(){
  return [...document.querySelectorAll('#setintervalscard input[data-key]')]
    .filter(i => i.value === '' || !i.checkValidity()).map(i => i.dataset.key);
}
export function intervalsMsg(text, kind){
  const el = document.getElementById('setintervalsmsg'); if (!el) return;
  el.textContent = text;
  el.className = 'text-[length:var(--fs-xs)] ' + (kind === 'err' ? 'setbad' : kind === 'ok' ? 'setok' : 'muted');
}

export function renderIntervals(){
  intervalsWrite({
    live_poll_interval_s: LIVE_MS / 1000,
    analytics_rebuild_interval_s: REBUILD_MS / 1000,
  });
  const src = document.getElementById('setintervalssrc');
  if (src) src.textContent = 'in effect now';
}

// P7-05 (#112): apply immediately -- the running page's own live-poll and
// rebuild timers pick up the new value on their NEXT tick (see
// scheduleLivePoll/scheduleRebuild's own setTimeout recursion), no reload.
export function applyIntervals(v){
  LIVE_MS = Math.round(v.live_poll_interval_s * 1000);
  REBUILD_MS = Math.round(v.analytics_rebuild_interval_s * 1000);
}

export async function saveIntervals(){
  const bad = intervalsInvalid();
  if (bad.length) return intervalsMsg('Fix ' + bad.join(', ') + ' first.', 'err');
  const v = intervalsRead();
  applyIntervals(v);  // apply to THIS page regardless of whether the save round-trip succeeds
  intervalsMsg('Applied to this page. Saving\u2026', 'info');
  try {
    const r = await fetch('api/settings', {method: 'POST', cache: 'no-store',
      headers: {'Content-Type': 'application/json', 'X-LLM-Telemetry': '1'}, body: JSON.stringify(v)});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return intervalsMsg('Applied here, but not saved: ' + (j.error || r.status), 'err');
    intervalsMsg('Applied and saved -- future page loads start from this too.', 'ok');
  } catch (e) {
    intervalsMsg('Applied here, but not saved: ' + e.message, 'err');
  }
}

export function intervalsInstall(){
  const card = document.getElementById('setintervalscard'); if (!card) return;
  renderIntervals();
  document.getElementById('setintervalssave')?.addEventListener('click', saveIntervals);
  document.getElementById('setintervalsreset')?.addEventListener('click', () => {
    intervalsWrite(INTERVAL_DEFAULTS);
    intervalsMsg('Defaults filled in; not applied or saved yet.', 'info');
  });
}

export function settingsInstall(){
  const card = document.getElementById('setcard'); if (!card) return;
  card.querySelectorAll('input[data-key]').forEach(i => i.addEventListener('input', () => {
    renderSetDeriv(); renderSetFacts();
  }));
  document.getElementById('setsave')?.addEventListener('click', saveSettings);
  document.getElementById('setreset')?.addEventListener('click', () => {
    setWrite(SET_DEFAULTS); renderSetDeriv(); renderSetFacts();
    setMsg('Defaults filled in; not saved yet.', 'info');
  });
  setColorsInstall();
  setLogosInstall();
  loadSettings();
}

// ---- Breadcrumb (#6) ------------------------------------------------------
// Reflects the current section in the header, so the page says where you are
// rather than leaving the active tab chip as the only cue.
export function setCrumb(v){
  const el = document.getElementById('crumb');
  if (el) el.textContent = v || '';
}

// ---- Left nav drawer (#3) -------------------------------------------------
// The rail is the primary section nav on desktop. It renders from the same
// view list as the chip strip, so the two can never disagree about which
// sections exist. Items are <a href="#/slug"> so middle-click and "copy link"
// behave, with a click handler for in-page routing.
export const NAV_ICONS = {
  Home:'\u2302', Live:'\u25C9', Flow:'\u21C4', Router:'\u2442', Quota:'\u25F0', Usage:'\u2211', Projects:'\u25A6',
  Cost:'$', Health:'\u2713', Detail:'\u2261', Logs:'\u2630', Settings:'\u2699'
};

// Grouped sections (#122). The rail is grouped by what a view is FOR, so the
// list stays scannable as it grows. The order here is the display order.
// A view with no entry falls into the trailing "More" group rather than
// disappearing — a new view must never be silently missing from the nav.
export const NAV_GROUPS = [
  {name:'Overview',  views:['Home', 'Live', 'Flow', 'Router', 'Quota']},
  {name:'Analysis',  views:['Usage', 'Projects', 'Cost', 'Health']},
  {name:'System',    views:['Detail', 'Logs', 'Settings']},
];
export const NAV_FALLBACK_GROUP = 'More';

export function navViews(){
  return [...document.querySelectorAll('.view')].map(el => el.dataset.view);
}

// -> [{name, views:[...]}] covering EVERY view exactly once, in NAV_GROUPS
// order, with anything unlisted appended to the fallback group.
export function navGroups(){
  const all = navViews();
  const seen = new Set();
  const out = [];
  NAV_GROUPS.forEach(g => {
    const views = g.views.filter(v => all.includes(v));
    views.forEach(v => seen.add(v));
    if (views.length) out.push({name:g.name, views});
  });
  const rest = all.filter(v => !seen.has(v));
  if (rest.length) out.push({name:NAV_FALLBACK_GROUP, views:rest});
  return out;
}

export function renderNav(){
  const box = document.getElementById('navlist');
  if (!box) return;
  const groups = navGroups();
  const item = v => `
    <a class="navitem" href="#/${slugOf(v)}" data-nav="${v}" data-tip="${v}">
      <span class="nvico" aria-hidden="true">${NAV_ICONS[v] || '\u2022'}</span>
      <span class="nvlabel">${v}</span>
      <span class="nvbadge" data-navbadge="${v}" hidden></span>
    </a>`;
  box.innerHTML = groups.map((g, i) => `
    ${i ? '<div class="navsep"></div>' : ''}
    <div class="navgroup" data-navgroup="${g.name}">
      <div class="navgroup-h">${g.name}</div>
      ${g.views.map(item).join('')}
    </div>`).join('');
  box.querySelectorAll('[data-nav]').forEach(a => {
    a.addEventListener('click', e => {
      // Let modified clicks (new tab, new window) behave natively.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      pickView(a.dataset.nav);
    });
  });
  navSync();
}

// Active state + counts. Called on every view change and every live poll, so
// the rail never disagrees with the page.
export function navSync(){
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === view;
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const p = (typeof DATA !== 'undefined' && DATA.profiles) ? (DATA.profiles[current] || {}) : {};
  const counts = {
    Live: (p.live || []).length,
    // Failures are the number worth surfacing on Health; 0 stays hidden so the
    // rail does not shout when nothing is wrong.
    Health: ((DATA && DATA.errors) || []).length
  };
  Object.entries(counts).forEach(([v, n]) => {
    const b = document.querySelector(`[data-navbadge="${v}"]`);
    if (!b) return;
    b.textContent = n;
    b.hidden = !n;
  });
}
// ---- Off-canvas drawer control (#4) --------------------------------------
// Mobile only. The panel is the same #navdrawer; a body class drives the
// transform, so there is one source of truth for open/closed.
export let navOpen = false;

export function isOffCanvas(){
  return window.matchMedia('(max-width:640px)').matches;
}

// Focus trap. Only while the panel is open on mobile: it is a modal surface
// there, and tabbing out to content the scrim covers would leave the keyboard
// somewhere the eye cannot follow.
export function navFocusables(){
  const rail = document.getElementById('navdrawer');
  if (!rail) return [];
  // No visibility filtering here: offsetParent is null for everything under
  // jsdom and for any element in a transformed container, which emptied the
  // list and silently disabled both the focus move and the trap. The rail only
  // contains nav controls, and it is only focus-managed while open, so every
  // control in it is a legitimate target.
  return [...rail.querySelectorAll('a[href],button:not([disabled])')];
}

export function navTrap(e){
  if (!navOpen || e.key !== 'Tab') return;
  const f = navFocusables();
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
}

export function navSetOpen(on){
  navOpen = !!on && isOffCanvas();
  document.body.classList.toggle('navopen', navOpen);
  const t = document.getElementById('navtoggle');
  if (t) t.setAttribute('aria-expanded', navOpen ? 'true' : 'false');
  const rail = document.getElementById('navdrawer');
  // aria-hidden only in off-canvas mode: on desktop the rail is permanent
  // furniture and must stay in the accessibility tree.
  if (rail){
    if (isOffCanvas() && !navOpen) rail.setAttribute('aria-hidden', 'true');
    else rail.removeAttribute('aria-hidden');
  }
  if (navOpen){
    const f = navFocusables();
    if (f.length) f[0].focus();
  } else if (t && isOffCanvas()){
    // Focus returns to the control that opened it, not to the top of the page.
    t.focus();
  }
}

// Collapse state (#102). Collapsed is the DEFAULT: the rail is navigation, not
// content, and 232px of chrome on every page load is a poor trade when the
// icons carry the same information. The choice persists once the user makes it.
export const NAVKEY = 'hermes-dash-navcollapsed';
export function navCollapsed(){
  const v = localStorage.getItem(NAVKEY);
  return v === null ? true : v === '1';   // default collapsed
}
export function navApplyCollapsed(on){
  document.body.classList.toggle('navcollapsed', on);
  const b = document.getElementById('navcollapse');
  if (b){
    b.setAttribute('aria-expanded', String(!on));
    b.setAttribute('aria-label', on ? 'Expand navigation' : 'Collapse navigation');
    b.textContent = on ? '\u00BB' : '\u00AB';
  }
  // Charts are responsive:true but only react to window resize; the rail
  // changing width resizes their container without one, so they must be told.
  requestAnimationFrame(() => charts.forEach(c => { try { c.resize(); } catch(_){} }));
}
export function navSetCollapsed(on){
  localStorage.setItem(NAVKEY, on ? '1' : '0');
  navApplyCollapsed(on);
}

// ---- Logs page (#104) ---------------------------------------------------
// Fetched lazily: logs-data.json is ~1.3 MB per profile and most visits never
// open this view, so loading it with the dashboard would tax every page view
// for a minority feature. The drawer keeps its own 80-row live feed and is
// untouched by any of this — that answers "what is happening", this answers
// "find the thing that happened".
export function navInstall(){
  document.getElementById('navcollapse')
    ?.addEventListener('click', () => navSetCollapsed(!document.body.classList.contains('navcollapsed')));
  document.getElementById('navtoggle')
    ?.addEventListener('click', () => navSetOpen(!navOpen));
  document.getElementById('navscrim')
    ?.addEventListener('click', () => navSetOpen(false));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && navOpen) navSetOpen(false);
    navTrap(e);
  });
  // Activating a section closes the panel: on mobile the content is what you
  // asked for, and leaving the sheet over it would hide the result.
  document.getElementById('navlist')?.addEventListener('click', e => {
    if (e.target.closest('[data-nav]') && navOpen) navSetOpen(false);
  });
  // Resizing past the breakpoint must not leave a scroll lock or a stuck
  // panel behind — the class is cleared whenever off-canvas stops applying.
  window.addEventListener('resize', () => {
    if (!isOffCanvas() && navOpen) navSetOpen(false);
    else if (!isOffCanvas()) document.body.classList.remove('navopen');
  });
  // Set the initial aria state for the current width.
  navSetOpen(false);
}
export function views(){
  $('views').innerHTML=['Home','Live','Flow','Router','Quota','Usage','Projects','Cost','Health','Detail','Logs','Settings']
    .map(v=>`<button data-vtab="${v}" onclick="pickView('${v}')" class="px-3 py-1 rounded-md border text-[length:var(--fs-sm)] taboff">${v}</button>`).join('');
}
export function pickView(v){
  view=v;
  document.querySelectorAll('.view').forEach(el=>el.hidden = el.dataset.view!==v);
  document.querySelectorAll('[data-vtab]').forEach(b=>{
    const on=b.dataset.vtab===v;
    b.className='px-3 py-1 rounded-md border text-[length:var(--fs-sm)] '+(on?'tabon':'taboff');
  });
  localStorage.setItem('hermes-dash-view', v);
  setHash(v);
  setCrumb(v);
  navSync();
  syncProjFilterUI();
  render();
  // The logs payload is ~1.3 MB and most visits never open this view, so it
  // is fetched on first navigation rather than with the page.
  if (v === 'Logs') loadLogs();
  // Re-render the graph AFTER the view is unhidden: the force layout needs the
  // real wrapper size, and while the tab was hidden it measured 0 — which
  // collapsed every node into a single clump in the corner.
  if (v === 'Flow') requestAnimationFrame(() => {
    const p = DATA.profiles[current];
    const from = $('from').value, to = $('to').value;
    const inR = d => d && (!from || d>=from) && (!to || d<=to);
    let flowRows = p.rows.filter(r=>inR(r.date));
    if (PROJECT_FILTER) flowRows = flowRows.filter(r => (r.project || 'Unattributed') === PROJECT_FILTER);
    renderFlow(flowRows);
  });
}
views();
logsInstall();
renderNav();
navInstall();
document.body.classList.add('hasnav');
navApplyCollapsed(navCollapsed());

// Prepend the merged "All" view so it is the default tab. Done before `current`
// is chosen so the page opens on the overview.
export const PV_OFF = {};
export function pvKey(n){ return 'llmtelemetry.profileVisibility.' + n; }
export function pvOff(n){
  if (n in PV_OFF) return PV_OFF[n];
  let v = null;
  try { v = localStorage.getItem(pvKey(n)); } catch(e){}
  PV_OFF[n] = (v === 'off');
  return PV_OFF[n];
}
export function pvSet(n, off){
  PV_OFF[n] = !!off;
  try { localStorage.setItem(pvKey(n), off ? 'off' : 'on'); } catch(e){}
}
export function pvOnProfiles(){
  return Object.keys(PV_ALL).filter(n => !pvOff(n));
}
// #126: per-profile colour override, settable from the Settings page. Same
// pattern as pvOff/pvSet above — a per-browser UI preference in localStorage,
// not server data, because the hue is a display choice and every profile is
// still collected regardless of what colour it is drawn in. null/absent means
// "use the deterministic hashHue(name)" (the original, collision-avoiding
// default), so a user who never opens Settings sees exactly the old colours.
export const PV_HUE = {};
export function pvHueKey(n){ return 'llmtelemetry.profileHue.' + n; }
export function pvHueOverride(n){
  if (n in PV_HUE) return PV_HUE[n];
  let v = null;
  try { v = localStorage.getItem(pvHueKey(n)); } catch(e){}
  const num = v === null ? null : Number(v);
  PV_HUE[n] = (num === null || !Number.isFinite(num)) ? null : ((num % 360) + 360) % 360;
  return PV_HUE[n];
}
export function pvHueSet(n, deg){
  const v = (deg === null || deg === undefined) ? null : ((Math.round(deg) % 360) + 360) % 360;
  PV_HUE[n] = v;
  try {
    if (v === null) localStorage.removeItem(pvHueKey(n));
    else localStorage.setItem(pvHueKey(n), String(v));
  } catch(e){}
}
// The one function every profile-colour call site should use instead of
// hashHue(name) directly, so a Settings override actually reaches every chip,
// badge and lane dot that colours itself by profile.
export function profileHue(n){
  const o = pvHueOverride(n);
  return o === null ? hashHue(n) : o;
}
// ---- Per-profile logos (#128) -----------------------------------------
// Same storage pattern as PV_HUE above: a browser-local display preference,
// not server data, stored as a data: URI so the dashboard stays one
// self-contained file with no upload endpoint to build or secure. A cap of
// 200KB raw (BEFORE base64 inflation) keeps a careless PNG from bloating
// localStorage or the JSON blob a data: URI turns into once stored.
export const PROFILE_LOGO_MAX_BYTES = 200 * 1024;
export const PV_LOGO = {};
export function pvLogoKey(n){ return 'llmtelemetry.profileLogo.' + n; }
export function profileLogo(n){
  if (n in PV_LOGO) return PV_LOGO[n];
  let v = null;
  try { v = localStorage.getItem(pvLogoKey(n)); } catch(e){}
  PV_LOGO[n] = v || null;
  return PV_LOGO[n];
}
export function profileLogoSet(n, dataUri){
  PV_LOGO[n] = dataUri || null;
  try {
    if (dataUri) localStorage.setItem(pvLogoKey(n), dataUri);
    else localStorage.removeItem(pvLogoKey(n));
  } catch(e){}
}
// One <img> when a logo is set, else a colour-matched initial dot (the
// "falls back to the default icon when unset" acceptance line) — same hue
// as the profile's tab/badge colour so the fallback still visually ties
// back to that profile everywhere else it appears.
export function profileIconHtml(n, px){
  px = px || 18;
  const uri = profileLogo(n);
  if (uri) return `<img src="${escA(uri)}" alt="" width="${px}" height="${px}" style="border-radius:4px;object-fit:cover;flex:none" onerror="this.remove()">`;
  const h = profileHue(n);
  const initial = esc((n || '?').trim().charAt(0).toUpperCase() || '?');
  return `<span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:${px}px;height:${px}px;border-radius:4px;background:hsl(${h} 55% 30%);color:hsl(${h} 85% 82%);font-size:${Math.round(px*0.6)}px;font-weight:700;flex:none;line-height:1">${initial}</span>`;
}
// Full, unfiltered profile map — captured once at boot so a toggled-off
// profile can come back without refetching (DATA.profiles is the filtered set).
export let PV_ALL = null;
export function pvFilter(){
  // keep: null = everything on (boot). Rebuilds DATA.profiles from PV_ALL.
  // With 2+ profiles on the merged view is materialised as the 'All' DATA KEY
  // (the same merge the old "All" tab showed) and is what `current` points at
  // by default. That key is an implementation detail of the DATA shape — 19
  // call sites read DATA.profiles[current] — and is NOT rendered as a tab:
  // the tab strip shows only real profiles, as on/off chips (#121).
  // With exactly 1 profile on there is nothing to merge, so that profile's
  // own data is the view and no 'All' key exists.
  const on = Object.keys(PV_ALL).filter(n => !pvOff(n));
  const merged = {};
  on.forEach(n => { merged[n] = PV_ALL[n]; });
  if (on.length >= 2){
    const all = buildAll(Object.fromEntries(on.map(n => [n, PV_ALL[n]])));
    if (all) merged['All'] = all;
  }
  return merged;
}
// The view is DERIVED from the on-set, never picked independently (#121):
// 2+ profiles on -> the merged view (what "all on means all" promises);
// exactly 1 on -> that profile. There is no "look at one profile while
// others are on" state, because that is what the toggles are for.
export function pvSyncCurrent(){
  current = ('All' in DATA.profiles) ? 'All'
          : (pvOnProfiles()[0] || Object.keys(DATA.profiles)[0]);
  return current;
}
// Toggle a profile on/off from its chip (left click) or its context menu.
// The last enabled profile cannot be turned off; the view then re-derives.
export function pvToggle(n){
  if (pvOff(n)) { pvSet(n, false); }
  else if (pvOnProfiles().length <= 1){
    flash('At least one profile must stay visible.');
    return;
  } else { pvSet(n, true); }
  DATA.profiles = pvFilter();
  pvSyncCurrent();
  tabs(); pick(current);
}
export function tabs(){
  // #121: toggle chips. Each profile is ALWAYS rendered (you can see every
  // profile and its state), coloured by its stable hashHue — ON is filled,
  // OFF is a dimmed outline of the same hue. No "All" chip: the merge is
  // what you see when everything is on, and the view always shows the
  // on-set's merge, so there is nothing for a separate tab to select.
  $('tabs').innerHTML=Object.keys(PV_ALL)
    .map(n=>{
      const h = profileHue(n);
      const off = pvOff(n);
      const st = off
        ? `style="background:transparent;color:hsl(${h} 45% 62%);border-color:hsl(${h} 40% 34%);opacity:.62"`
        : `style="background-color:hsl(${h} 62% 38%);color:#fff;border-color:hsl(${h} 70% 55%)"`;
      return `<button data-tab="${n}" data-off="${off?1:0}" onclick="pvToggle('${n}')"`
           + ` oncontextmenu="pvMenu(event,'${esc(n)}')" title="${off?'Off — click to turn on':'On — click to turn off'}"`
           + ` class="px-5 py-3 rounded-md border text-[length:var(--fs-lg)] taboff flex items-center gap-2" ${st}>${profileIconHtml(n,16)}<span>${n}</span></button>`;
    }).join('');
  // a compact "N/M on" readout so the merge's extent is stated, not implied
  const on = pvOnProfiles().length, tot = Object.keys(PV_ALL).length;
  const sub = $('tabsub');
  if (sub) sub.textContent = on === tot ? `all ${tot} shown` : `${on}/${tot} on`;
}
// Right-click a profile tab to toggle it (#119). A tiny menu explains what
// will happen and keeps the accidental-disabled-profile footgun Behind a
// deliberate click.
export function pvMenu(ev, n){
  ev.preventDefault();
  const off = pvOff(n);
  const others = pvOnProfiles().length;
  if (!off && others <= 1 && pvOnProfiles()[0] === n){
    flash('At least one profile must stay visible.');
    return;
  }
  pvToggle(n);
}
installAll();
// Visibility filter (#121): PV_ALL captures the full set BEFORE removal, so
// toggling a profile back on restores its data without a refetch. The view is
// always the merge of the ON profiles — with everything on that merge is
// exactly what the old "All" tab used to show, so there is no All tab.
PV_ALL = Object.fromEntries(Object.entries(DATA.profiles).filter(([n]) => n !== 'All'));
DATA.profiles = pvFilter();
// Build the palette ONCE, from every model in every profile. Charts then look
// their colour up rather than deriving it, so a model keeps the same shade on
// every tab, in every date range and on both profiles.
COLORS = buildColors(allModelNames());
TOOLCOLORS = buildToolColors(allToolNames());
// Default to the merged view when it exists (all profiles on): that is the
// overview, and it is what "all on means all" promises. With a single profile
// on at boot there is no merge, so the profile itself is the view.
current = ('All' in DATA.profiles) ? 'All' : Object.keys(DATA.profiles)[0];
tabs();
renderResolution();
// #129: editing either date input exits hour-preset mode (the two are
// mutually exclusive — see HOUR_RANGE's own comment).
export const exitHourRange = () => { HOUR_RANGE = null; render(); };
$('from').onchange=exitHourRange; $('to').onchange=exitHourRange;
// P4-04 (#41): the exclude-Unattributed toggle re-renders just the
// projects card (via a full render() — simplest correct option since
// render() is idempotent and cheap enough to run on a checkbox click).
if ($('projexclude')) $('projexclude').onchange = render;
// P4-06 (#43): the normalise-to-100% toggle re-renders the distribution
// chart via the shared module-scope flag + a full render().
if ($('projdistnorm')) $('projdistnorm').onchange = function(){
  projDistNormalized = this.checked;
  render();
};
if ($('projtrendstack')) $('projtrendstack').onchange = function(){
  projTrendStacked = this.checked;
  render();
};

