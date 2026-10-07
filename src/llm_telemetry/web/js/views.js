/**
 * Views: the analytics renderers (Home, Projects, Delegation, Health,
 * Ollama, Latency, Bandwidth, Unpriced, Re-send, Transfer). Each paints into its
 * own container and reads the profile payload.
 */
import {
  $, AC, BD, MU, PAL, ago, colorOf, costCell, emptyHTML, esc, escA, fade, fmt, fmtB, ic, icon, money, short,
} from './palette.js';
import {
  PROJ_WEIGHT, PROJ_WEIGHT_LABELS, agg, charts, ctxSpark, current, mk, noLeg, olBar, projDistNormalized, projTrendStacked, radialRing, sparkSvg, weightValue,
} from './charts.js';
import { flowControls, renderFlow } from './flow.js';
import { renderLive } from './live.js';
import { renderRouterView, routerStat } from './routerview.js';
import { renderQuotaView, qvStat } from './quotaview.js';
import {
  HOUR_RANGE, MODEL_FILTER, POWER, PROJECT_FILTER, PROVIDER_FILTER, clearCrossFilters, hourRowsFor,
  pickView, setCrossFilter, setHash, view,
} from './router.js';
import { DATA, LOCAL_HOSTS, SCHEMA_VERSION, css } from './main.js';

export function schemaProblem(payload, name){
  if (!payload || typeof payload !== 'object') return `${name}: not a JSON object`;
  if (!('schema_version' in payload))
    return `${name} is a stale payload (no schema_version) — re-run \`llm-telemetry dashboard\``;
  if (payload.schema_version !== SCHEMA_VERSION)
    return `${name} has schema_version ${JSON.stringify(payload.schema_version)}, this page expects ${SCHEMA_VERSION} — re-run \`llm-telemetry dashboard\``;
  return '';
}
export function showSchemaError(msg){
  let el = document.getElementById('schemaerr');
  if (!el) {
    el = document.createElement('div');
    el.id = 'schemaerr';
    el.setAttribute('role', 'alert');
    el.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;'
      + 'justify-content:center;background:var(--bg);padding:24px';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div class="card" style="max-width:640px;padding:24px;border-color:#ef4444">'
    + '<div style="color:#ef4444;font-weight:600;font-size:var(--fs-lg);margin-bottom:8px">Payload version mismatch</div>'
    + '<div class="schemamsg" style="font-size:var(--fs-md);line-height:1.5"></div>'
    + '<div class="muted" style="font-size:var(--fs-xs);margin-top:12px">The dashboard refused to render rather than show '
    + 'numbers it cannot interpret.</div></div>';
  el.querySelector('.schemamsg').textContent = msg;
}
{
  const bad = schemaProblem(DATA, 'analytics-data.json');
  if (bad) {
    const go = () => { showSchemaError(bad); const b = document.getElementById('boot'); if (b) b.remove(); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    throw new Error('schema mismatch: ' + bad);   // stop this script: nothing below may render
  }
}
// ---- Profile resolution (P5-04, #53) -------------------------------------
// Zero profiles is an actionable state, not a blank page: say which agent
// home was searched and how to point the tool elsewhere.
// flash(): one-line transient notice for guarded actions (#119 uses it when
// the last visible profile is protected from being switched off).
export function flash(msg){
  let f = document.getElementById('flash');
  if (!f){
    f = document.createElement('div');
    f.id = 'flash';
    f.setAttribute('role', 'status');
    f.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);'
      + 'z-index:80;padding:8px 14px;border-radius:8px;border:1px solid var(--border);'
      + 'background:var(--card);color:var(--fg);font-size:var(--fs-sm);box-shadow:0 4px 14px rgba(0,0,0,.25);'
      + 'opacity:0;transition:opacity .2s';
    document.body.appendChild(f);
  }
  f.textContent = msg;
  requestAnimationFrame(() => { f.style.opacity = '1'; });
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { f.style.opacity = '0'; }, 2600);
}
{
  const res = DATA.resolution || {};
  if (!DATA.profiles || !Object.keys(DATA.profiles).length) {
    const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const why = res.mode === 'explicit-empty'
      ? `The config file${res.config_file ? ` (${esc(res.config_file)})` : ''} sets <code>"profiles": []</code>, which means read no profiles.`
      : `No profile with a state.db was found under <code>${esc(res.agent_home || '~/.hermes')}</code>.`;
    const failed = (res.failed || []).map(f =>
      `<li><b>${esc(f.name)}</b>: ${esc(f.reason)}</li>`).join('');
    const go = () => {
      const el = document.createElement('div');
      el.id = 'noprofiles';
      el.className = 'card';
      el.style.cssText = 'max-width:640px;margin:15vh auto;padding:24px;line-height:1.55';
      el.innerHTML = `<div style="font-size:var(--fs-lg);font-weight:650;margin-bottom:8px">No profiles to show</div>
        <div class="muted" style="font-size:var(--fs-md)">${why}</div>
        ${failed ? `<div style="margin-top:10px;font-size:var(--fs-md)">Unreadable:<ul style="margin:4px 0 0 18px;list-style:disc">${failed}</ul></div>` : ''}
        <div class="muted" style="font-size:var(--fs-sm);margin-top:12px">Point the tool at your agent with
        <code>LLM_TELEMETRY_AGENT_HOME=/path</code> or <code>"agent_home"</code> in the config, then re-run
        <code>llm-telemetry dashboard</code>.</div>`;
      document.body.appendChild(el);
      const b = document.getElementById('boot'); if (b) b.remove();
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    throw new Error('no profiles');   // nothing below can render without one
  }
}
// Header summary: "3 profiles · 1 excluded · 1 unreadable", detail on click.
export function renderResolution(){
  const el = $('resinfo'); if (!el) return;
  const res = DATA.resolution || {};
  const n = Object.keys(DATA.profiles).filter(k => k !== 'All').length;
  const ex = res.excluded || [], bad = res.failed || [];
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
  const bits = [`${n} profile${n === 1 ? '' : 's'}`];
  if (ex.length) bits.push(`${ex.length} excluded`);
  if (bad.length) bits.push(`<span class="resbad">${bad.length} unreadable</span>`);
  el.innerHTML = `<button type="button" id="resbtn" class="resbtn${bad.length ? ' warn' : ''}"
      aria-expanded="false" title="How the profile list was built">${bad.length ? '&#9888; ' : ''}${bits.join(' · ')}</button>
    <div id="respop" class="respop card" hidden>
      <div class="lbl mb-1">Profiles</div>
      <div class="muted text-[length:var(--fs-xs)] mb-2">Agent home <code>${esc(res.agent_home || '—')}</code>${res.mode ? ` · ${esc(res.mode)}` : ''}</div>
      ${(res.discovered || []).length ? `<div class="text-[length:var(--fs-sm)]"><b>Discovered:</b> ${res.discovered.map(esc).join(', ')}</div>` : ''}
      ${(res.configured || []).length ? `<div class="text-[length:var(--fs-sm)]"><b>From config:</b> ${res.configured.map(esc).join(', ')}</div>` : ''}
      ${ex.length ? `<div class="text-[length:var(--fs-sm)]"><b>Excluded:</b> ${ex.map(e => `${esc(e.name)} <span class="muted">(${esc(e.reason)})</span>`).join(', ')}</div>` : ''}
      ${bad.length ? `<div class="text-[length:var(--fs-sm)] resbad mt-1"><b>Unreadable:</b><ul style="margin:2px 0 0 16px;list-style:disc">${bad.map(f => `<li>${esc(f.name)}: ${esc(f.reason)}</li>`).join('')}</ul></div>` : ''}
    </div>`;
  const btn = $('resbtn'), pop = $('respop');
  btn.onclick = e => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); };
  document.addEventListener('click', e => { if (!el.contains(e.target)) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
}
export const PROV = {
  'anthropic':   {icon:'✳', bg:'hsl(17 66% 55% / .16)',  fg:'hsl(17 66% 55%)'},
  'opencode-go': {icon:'◈', bg:'hsl(250 85% 62% / .16)', fg:'hsl(250 85% 68%)'},
  'fireworks':   {icon:'✦', bg:'rgba(255,102,61,.16)',   fg:'#ff663d'},
  'openai-codex':{icon:'◉', bg:'hsl(162 82% 38% / .16)', fg:'hsl(162 82% 40%)'},
  'local':       {icon:'▣', bg:'hsl(213 90% 60% / .14)', fg:'hsl(213 90% 62%)'},
  'moa':         {icon:'⬡', bg:'rgba(244,114,182,.16)',  fg:'#f472b6'},
  'cloud':       {icon:'☁', bg:'hsl(205 80% 55% / .16)', fg:'hsl(205 80% 58%)'},
  'ollama-cloud':{icon:'☁', bg:'hsl(199 90% 52% / .16)', fg:'hsl(199 90% 55%)'},
  'nous':        {icon:'◆', bg:'rgba(234,179,8,.16)',    fg:'#eab308'}
};
// Provider resolution order, strongest evidence first:
//   1. billing_base_url — the endpoint the call actually hit. Authoritative.
//   2. billing_provider — the config slot name ("custom" just means
//      OpenAI-compatible, so it is only trustworthy once the URL says nothing).
//   3. model-name shape — last resort for old rows with neither recorded.
// Guessing from the model name alone mislabelled Fireworks kimi-k3 as local,
// because it was routed through a custom-named slot.
export const LOCAL_RE = /^(qwen|gpt-oss|deepseek-r1|nemotron|llama|mistral|phi|gemma)/i;
// Ollama Cloud tags carry an explicit cloud marker ("kimi-k3:cloud",
// "qwen3-coder:480b-cloud", "gpt-oss:120b-cloud"). The marker is authoritative
// and must be tested BEFORE LOCAL_RE, because those same names match local hints
// and were rendering a LOCAL badge on hosted traffic.
export const CLOUD_SUFFIX = /(:|-|\.)cloud$/i;
export function provOf(p, model, url){
  const u=(url||'').toLowerCase();
  if(u){
    if(u.includes('fireworks.ai'))      return 'fireworks';
    if(u.includes('opencode.ai'))       return 'opencode-go';
    if(u.includes('api.anthropic.com')) return 'anthropic';
    if(u.includes('openai.com')||u.includes('chatgpt.com')) return 'openai-codex';
    if(u.includes('openrouter.ai'))     return 'openrouter';
    if(u.includes('nousresearch'))      return 'nous';
    // Ollama Cloud (https://ollama.com/v1) is hosted, not LAN: match it before
    // the local patterns so it can never be mistaken for a self-hosted host.
    if(u.includes('ollama.com'))        return 'ollama-cloud';
    // LOCAL_HOSTS is injected from config.local_host_patterns, so self-hosted
    // URLs are recognised on any LAN instead of only the author's.
    if(LOCAL_HOSTS.some(h => u.includes(h))) return 'local';
  }
  const key=(p||'').toLowerCase().trim();
  if(key && key!=='custom') return key;
  const m=(model||'').toLowerCase();
  if(m.includes('fireworks')) return 'fireworks';
  if(CLOUD_SUFFIX.test(m)) return 'ollama-cloud';
  const isSlug = m.includes('/');
  if(!isSlug && LOCAL_RE.test(m)) return 'local';
  if(m.includes('claude')) return 'anthropic';
  if(m.includes('glm')||m.includes('kimi')||m.includes('minimax')) return 'opencode-go';
  // Nous portal model families (Hermes, stepfun/step-*) — old rows recorded
  // neither provider nor base_url, so match the model name as a last resort.
  if(m.startsWith('stepfun/')||m.startsWith('step-')||m.includes('hermes-')) return 'nous';
  if(m.startsWith('gpt-')) return 'openai-codex';
  if(key==='custom') return 'local';
  // Nothing identified it, so it is remote — not local hardware. Defaulting to
  // 'local' here is what put a LOCAL badge on every unrecognised hosted model.
  return 'cloud';
}
export function provBadge(p){
  const key=(p||'').toLowerCase().trim();
  const s=PROV[key]||{icon:'○',bg:'rgba(148,163,184,.14)',fg:MU};
  return `<span class="text-[length:var(--fs-xs)] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
    style="background:${s.bg};color:${s.fg};border:1px solid ${s.fg}33">
    <span style="font-size:var(--fs-xs)">${s.icon}</span>${key}</span>`;
}
// Chart-axis labels are plain strings, so a provider is shown as its unicode
// glyph prefixed to the model name: "◆ step-3.7-flash". rowsForModel lets a
// short model name resolve back to the provider that served it.
export let MODEL_PROV = {};
export function buildModelProv(rows){
  MODEL_PROV = {};
  (rows||[]).forEach(r=>{
    const sm = short(r.model);
    if(!MODEL_PROV[sm]) MODEL_PROV[sm] = provOf(r.provider, r.model, r.base_url);
  });
}
export function provIcon(sm){
  const key = MODEL_PROV[sm] || provOf('', sm, '');
  return (PROV[key]||{icon:'○'}).icon;
}
// Prefix a provider glyph to a model label for chart axes/legends.
export function resendOf(r){
  const fresh = (+r.input_tokens||0) + (+r.cache_write_tokens||0);
  const sent  = fresh + (+r.cache_read_tokens||0);
  return {fresh, sent, x: fresh ? sent / fresh : null};
}
export function renderBandwidthPanel(p, inR){
  const card = $('bwpanel'); if (!card) return;
  const all = (p.bandwidth_daily || []);
  const S = all.filter(r => inR(r.date));
  if (!S.length){
    card.hidden = !all.length ? true : false;
    if (!all.length) return;
    $('bwpkpi').innerHTML = '<span class="muted text-[length:var(--fs-sm)]">No bandwidth recorded in this range.</span>';
    $('bwresend').innerHTML = ''; $('bwpsub').textContent = ''; $('bwpnote').textContent = '';
    return;
  }
  card.hidden = false;
  const days = [...new Set(S.map(r => r.date))].sort();
  const sum = (k, rs=S) => rs.reduce((a, r) => a + (+r[k]||0), 0);
  const up = sum('up_bytes'), down = sum('down_bytes');
  const lan = sum('lan_up_bytes') + sum('lan_down_bytes');
  const tot = resendOf({input_tokens:sum('input_tokens'), cache_read_tokens:sum('cache_read_tokens'),
                        cache_write_tokens:sum('cache_write_tokens')});
  const ratio = down ? up / down : null;
  const frozen = S.filter(r => r.frozen).length;
  const bpts = [...new Set(S.map(r => r.bytes_per_token))].sort();

  $('bwpsub').textContent = `${days.length} day${days.length===1?'':'s'} · estimated, not measured`;
  const tile = (v, l, sub) => `<div class="bwpt"><div class="bwpv">${v}</div><div class="bwpl">${l}</div>${sub?`<div class="muted bwps">${sub}</div>`:''}</div>`;
  $('bwpkpi').innerHTML = [
    tile(tot.x == null ? '—' : `${tot.x.toFixed(1)}&times;`, 'context re-send',
         'each fresh prompt token is sent this many times'),
    tile(ratio == null ? '—' : `${Math.round(ratio).toLocaleString()}:1`, 'upload : download',
         'a whole conversation goes up to get a reply back'),
    tile(`&uarr; ${fmtB(up)}`, 'internet upload', `&darr; ${fmtB(down)} download`),
    tile(fmtB(lan), 'LAN', 'local models · not metered'),
  ].join('');

  // Daily trend: internet up/down on the left axis, LAN as its own line so a
  // local-heavy day cannot inflate the metered picture.
  const by = d => S.filter(r => r.date === d);
  // Upload dwarfs download ~190:1, so on one axis download is an invisible
  // sliver. Upload gets the bars and the left axis; download and LAN get lines
  // on their own right axis, so each is legible and none is misread as zero.
  mk('cBwTrend', 'bar', days.map(d => d.slice(5)), [
    {label:'upload', data:days.map(d => sum('up_bytes', by(d))), backgroundColor:'#f59e0b',
     borderRadius:2, yAxisID:'y', order:2},
    {label:'download', type:'line', data:days.map(d => sum('down_bytes', by(d))),
     borderColor:'#38bdf8', backgroundColor:'#38bdf8', pointRadius:3, tension:.3, yAxisID:'y1', order:1},
    {label:'LAN', type:'line', data:days.map(d => sum('lan_up_bytes', by(d)) + sum('lan_down_bytes', by(d))),
     borderColor:MU, backgroundColor:MU, borderDash:[4,3], pointRadius:2, tension:.3, yAxisID:'y1', order:1},
  ], {plugins:{legend:{labels:{boxWidth:8}},
       tooltip:{callbacks:{title:c => days[c[0].dataIndex],
                           label:c => `${c.dataset.label}: ${fmtB(c.parsed.y)}`}}},
      scales:{x:{grid:{display:false}},
              y:{position:'left', grid:{color:BD}, title:{display:true, text:'upload', color:'#f59e0b', font:{size:10}},
                 ticks:{maxTicksLimit:5, callback:v => fmtB(v)}},
              y1:{position:'right', grid:{display:false}, title:{display:true, text:'download · LAN', color:'#38bdf8', font:{size:10}},
                  ticks:{maxTicksLimit:5, callback:v => fmtB(v)}}}});

  // Re-send per model, worst first. Flag anything well above the fleet median:
  // those are the candidates for shorter contexts or earlier compaction.
  const M = {};
  S.forEach(r => {
    const o = M[r.model] || (M[r.model] = {model:r.model, input_tokens:0, cache_read_tokens:0,
                                          cache_write_tokens:0, up:0, calls:0});
    o.input_tokens += +r.input_tokens||0; o.cache_read_tokens += +r.cache_read_tokens||0;
    o.cache_write_tokens += +r.cache_write_tokens||0; o.up += +r.up_bytes||0; o.calls += +r.calls||0;
  });
  const rows = Object.values(M).map(o => ({...o, ...resendOf(o)}))
    .filter(o => o.x != null && o.sent > 0).sort((a, b) => b.x - a.x);
  const xs = rows.map(o => o.x).sort((a, b) => a - b);
  const med = xs.length ? (xs.length % 2 ? xs[(xs.length-1)/2] : (xs[xs.length/2-1] + xs[xs.length/2]) / 2) : 0;
  const max = rows.length ? rows[0].x : 1;
  const TOP = 12;
  $('bwresend').innerHTML = !rows.length
    ? '<div class="muted text-[length:var(--fs-sm)]">No prompt tokens in range.</div>'
    : rows.slice(0, TOP).map(o => {
        const hot = med && o.x >= 2 * med;
        return `<div class="bwrrow${hot ? ' hot' : ''}" data-model="${short(o.model)}" data-x="${o.x.toFixed(2)}"
                  title="${o.sent.toLocaleString()} prompt tokens sent · ${o.fresh.toLocaleString()} fresh · ${o.calls.toLocaleString()} calls">
          <span class="bwrm truncate" style="color:${colorOf(short(o.model))}">${short(o.model)}</span>
          <span class="bwrbar"><i style="width:${Math.max(2, 100 * o.x / max).toFixed(1)}%"></i></span>
          <span class="bwrx">${o.x.toFixed(1)}&times;</span>
          ${hot ? '<span class="bwrflag" title="At least 2x the fleet median">&#9650; high</span>' : '<span class="bwrflag"></span>'}
        </div>`;
      }).join('')
      + `<div class="muted text-[length:var(--fs-xs)] mt-1">fleet median ${med.toFixed(1)}&times;${rows.length > TOP ? ` · top ${TOP} of ${rows.length} models` : ''}</div>`;

  $('bwpnote').textContent =
    `Estimated from token counts × ${bpts.map(b => (+b).toFixed(2)).join(' / ')} bytes/token, ` +
    `not measured on the wire. ${frozen} of ${S.length} rows are frozen history: each keeps the ` +
    `constant it was computed with, so recalibrating never restates past days. ` +
    `Re-send = (input + cache read + cache write) ÷ (input + cache write).`;
}

// Local rows are electricity, not billing (P7-04, #68): a real figure with a
// visible "elec" marker, never "$0" or "free". Cents matter here — a local run
// is often a fraction of a dollar — so small values keep enough digits to be
// non-zero.
// Three states used to render identically as "$0.00" (P9-05, #82):
//   unpriced  -> no rate found, the real cost is unknown and NOT counted
//   local     -> electricity at your tariff, marked "elec" (P7)
//   free tier -> a published $0 SKU (OpenRouter ":free", OpenCode Zen free)
export function unpricedModels(rows){
  const by = {};
  rows.forEach(r => {
    const k = short(r.model);
    const o = by[k] || (by[k] = {calls: 0, priced: false});
    o.calls += r.calls || 0;
    if (r.priced || r.cost_class === 'local' || r.cost_class === 'free' || r.cost_class === 'preset') o.priced = true;
  });
  return Object.entries(by).filter(([, o]) => !o.priced && o.calls > 0)
    .sort((a, b) => b[1].calls - a[1].calls);
}
export function renderUnpriced(rows){
  const el = document.getElementById('unpricedbanner');
  if (!el) return;
  const un = unpricedModels(rows);
  if (!un.length){ el.hidden = true; el.innerHTML = ''; return; }
  const calls = un.reduce((s, [, o]) => s + o.calls, 0);
  el.hidden = false;
  el.innerHTML = `<b>${un.length} model${un.length === 1 ? '' : 's'} with traffic ${un.length === 1 ? 'has' : 'have'} no price</b>`
    + ` (${un.map(([m]) => '<span class="mono">' + esc(m) + '</span>').join(', ')}; ${calls.toLocaleString()} calls).`
    + ` Est. cost excludes that traffic, so it is understated.`
    + ` <a href="costs.html">Price sheet</a> shows the fix.`;
}
// ---- Context re-send per session (P9-03, #80) ------------------------------
// Rows come from the collector (p.resend): calls, average prompt context per
// call, cache-read share, and re-sent cost priced by the same price_row() as
// the Cost view. Filtered by the date range on the session's last activity.
export const RESEND_MIN = 10;   // mirrors RESEND_MIN_CALLS in collect_analytics.py
export function renderResend(p, inR){
  const tbl = $('resendtbl'); if (!tbl) return;
  $('resendmin').textContent = RESEND_MIN;
  const day = ts => { const d = new Date(ts * 1000);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
  const rows = (p.resend || []).filter(r => r.calls >= RESEND_MIN && (!r.last || inR(day(r.last))));
  if (!rows.length){
    tbl.innerHTML = '<tr><td class="muted py-2">No session in this range has enough calls to average.</td></tr>';
    $('resendsub').textContent = '';
    return;
  }
  const total = rows.reduce((s, r) => s + (r.resend_usd || 0), 0);
  $('resendsub').textContent = `${rows.length} sessions · $${total.toFixed(2)} of re-sent context`;
  const mx = Math.max(...rows.map(r => r.resend_usd || 0), 0.01);
  const head = `<tr class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">
    <th class="text-left py-1">Session</th><th class="text-left rsx">Model</th>
    <th class="text-right">Calls</th><th class="text-right rsx" title="Average prompt tokens per call: fresh input + cache write + cache read">Avg context</th>
    <th class="text-right" title="Share of prompt tokens served from cache">Cached</th>
    <th class="text-right">Re-sent cost</th><th class="rsx"></th></tr>`;
  tbl.innerHTML = head + rows.slice(0, 15).map(r => {
    const cost = r.cost_class === 'local' ? costCell(r.resend_usd, true) : '$' + (r.resend_usd || 0).toFixed(2);
    const name = esc(r.title || r.id);
    return `<tr class="resendrow" data-sid="${escA(r.id)}" style="border-top:1px solid var(--border)">
      <td class="py-1 pr-2 resendname" title="${escA(r.id)}">${name}</td>
      <td class="pr-2 rsx" style="white-space:nowrap">${esc(short(r.model))}</td>
      <td class="text-right">${r.calls.toLocaleString()}</td>
      <td class="text-right rsx">${fmt(r.ctx_per_call)}</td>
      <td class="text-right">${r.cread_pct.toFixed(1)}%</td>
      <td class="text-right font-semibold">${cost}</td>
      <td class="pl-3 rsx" style="width:18%"><div style="height:4px;border-radius:2px;background:var(--accent);width:${Math.max(2, (r.resend_usd||0) / mx * 100)}%"></div></td>
    </tr>`;
  }).join('');
}

export const ALERT_ICON = { critical: '&#9888;', warning: '&#9679;', info: '&#8505;' };
export const ALERT_COLOR = { critical: '#ef4444', warning: '#eab308', info: 'var(--accent)' };

// P10-10 (#98): renders exactly what the collector's alerts.build_alerts()
// already evaluated -- never recomputes a threshold client-side, so the
// card can't drift from the Python rule table.
export function renderAlerts(alerts){
  const card = $('alertscard');
  if (!alerts || !alerts.length){ card.hidden = true; return; }
  card.hidden = false;
  $('alertscount').textContent = `${alerts.length} item${alerts.length===1?'':'s'} need attention`;
  $('alertslist').innerHTML = alerts.map(a => `
    <div class="flex items-start gap-2 text-[length:var(--fs-sm)] py-1.5" style="border-bottom:1px solid var(--border)">
      <span style="color:${ALERT_COLOR[a.severity]||'var(--fg)'};flex:none" title="${esc(a.severity)}">${ALERT_ICON[a.severity]||'&#8226;'}</span>
      <span class="flex-1" title="${esc(a.why||'')}">${esc(a.message)}</span>
      ${a.target_view ? `<button class="chip" style="flex:none" onclick="pickView('${a.target_view}')">${esc(a.target_view)} &rarr;</button>` : ''}
    </div>`).join('');
}

// P10-12 (#100): Session finder. Pure matching logic (testable without a
// DOM), then a thin command-palette UI on top. Reads `session_index`
// exactly as the collector shipped it -- no client-side re-query, no
// full-text over message content (explicitly out of scope; see the
// modal's own footer note).
export function render(){
  const p = DATA.profiles[current];
  renderAlerts(p.alerts);
  populateProjFilterSelect();
  populateRowFilterSelects();
  syncProjFilterUI();
  const from = $('from').value, to = $('to').value;
  const inR = d => d && (!from || d>=from) && (!to || d<=to);
  // #129: an hour preset (1h/6h/12h) takes over row selection entirely —
  // real hour-grain data from p.hour_rows, filtered by wall-clock cutoff
  // rather than the date-string range the day presets use. The project
  // filter still composes on top, same as the day-range path below.
  const dateRows = HOUR_RANGE ? hourRowsFor(p, HOUR_RANGE) : p.rows.filter(r=>inR(r.date));
  // Cross-filters compose, in a fixed order (project -> provider -> model), so
  // the same three choices always select the same rows whichever order they
  // were picked in.
  const rows = dateRows.filter(r =>
    (!PROJECT_FILTER || (r.project || 'Unattributed') === PROJECT_FILTER) &&
    (!PROVIDER_FILTER || (r.provider || '') === PROVIDER_FILTER) &&
    (!MODEL_FILTER || r.model === MODEL_FILTER));
  // p.hours/p.sessions have no hour grain (day-only, like p.rows normally
  // is) — under an hour preset they're approximated by whichever CALENDAR
  // DAYS the cutoff touches, so the KPI cards (which read `rows` directly)
  // stay hour-precise while these secondary widgets stay close rather than
  // going blank.
  const hourTouchedDates = HOUR_RANGE ? new Set(dateRows.map(r=>r.date)) : null;
  const hours = HOUR_RANGE ? p.hours.filter(h=>hourTouchedDates.has(h.date)) : p.hours.filter(h=>inR(h.date));
  const sess  = HOUR_RANGE ? p.sessions.filter(s=>hourTouchedDates.has(s.date)) : p.sessions.filter(s=>inR(s.date));
  charts.forEach(c=>c.destroy()); charts=[];
  // Profile chip styling (size, hue) is owned entirely by tabs() (#121) — it
  // sets the on/off style inline per-profile. Re-styling [data-tab] here with
  // a flat tabon/taboff class used to stomp that on every render() call,
  // which fires on every tab click via pick() — the chip would flash from its
  // real 16px/hue treatment to a generic 12px on/off pair and back. #126.

  const calls=rows.reduce((s,r)=>s+r.calls,0), tok=rows.reduce((s,r)=>s+r.inp+r.outp,0);
  const cache=rows.reduce((s,r)=>s+r.cread,0);
  const market=rows.reduce((s,r)=>s+(r.market_value_usd||0),0);
  const elec=rows.reduce((s,r)=>s+(r.cost_class==='local'?(r.energy_usd||0):0),0);
  renderUnpriced(rows);
  const nsess=sess.reduce((s,r)=>s+r.sessions,0);
  const nd=new Set(rows.map(r=>r.date)).size;
  $('meta').textContent=`generated ${DATA.generated.replace('T',' ')} · auto-refresh every 1 min`;
  $('rangeinfo').textContent = HOUR_RANGE
    ? `last ${HOUR_RANGE}h · ${rows.length} rows`
    : `${nd} day${nd===1?'':'s'} · ${rows.length} rows`;
  // `active` is a live count from the DB, deliberately NOT filtered by the date
  // range — "in progress" means right now, whatever window you are looking at.
  const live = DATA.profiles[current].active || 0;
  const liveDot = live
    ? `<span style="color:#22c55e">●</span> ${live}`
    : `<span class="muted">●</span> 0`;
  // Success rate: successes + failures come from p.health (DB successes,
  // errors.log failures). One number over every model in this profile.
  const H = DATA.profiles[current].health || [];
  let okN=0, failN=0;
  H.forEach(h=>{ okN+=(h.ok||0); failN+=(h.fail||0); });
  const totCalls = okN+failN;
  const srate = totCalls ? (okN/totCalls*100) : null;

  // #11: cache hit rate — real data (cache_read vs. total prompt tokens
  // actually sent), a genuinely bounded 0-100% metric, so it earns a ring
  // like success rate.
  const promptIn = rows.reduce((s,r)=>s+r.inp,0);
  const cacheDenom = promptIn + cache;
  const cacheRate = cacheDenom ? (cache/cacheDenom*100) : null;

  // #11: 7-day trend for the unbounded counters, computed from the same
  // rows already loaded for this range (last 7 distinct dates present).
  const kdays=[...new Set(rows.map(r=>r.date))].sort().slice(-7);
  const callsSeries = kdays.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.calls,0));
  const tokSeries = kdays.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.inp+r.outp,0));
  // Sessions and Est. cost get the same real 7-day trend treatment as
  // calls/tokens: both are unbounded counters over the same date grain, so
  // they earn a sparkline for the same reason (a ring would fake a bound).
  const sessSeries = kdays.map(d=>sess.filter(r=>r.date===d).reduce((s,r)=>s+r.sessions,0));
  const costSeries = kdays.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+(r.market_value_usd||0),0));

  // One glyph + accent colour per KPI card so the strip reads at a glance,
  // same idea as the provider badges (PROV) elsewhere on the page. Colours
  // reuse the same series colours the card's own sparkline is drawn in
  // (AC/PAL[n] below), so the badge is never an arbitrary extra hue — it is
  // "this card's colour", just also used to tint its icon chip.
  const KPI_META = {
    'API calls':      {icon:icon('swap'),   color:AC},
    'Tokens':         {icon:icon('layers'), color:PAL[1]},
    'Cache hit rate': {icon:icon('zap'),    color:PAL[5]},
    'Sessions':       {icon:icon('users'),  color:PAL[2]},
    'Success rate':   {icon:icon('check'),  color:PAL[6]},
    'In progress':    {icon:icon('pulse'),  color:PAL[3]},
    'Est. cost':      {icon:icon('dollar'), color:PAL[4]},
  };

  $('kpis').innerHTML=[
    ['API calls',calls.toLocaleString(),sparkSvg(callsSeries,AC)],
    ['Tokens',fmt(tok),sparkSvg(tokSeries,PAL[1])],
    ['Cache hit rate',null,null,radialRing(cacheRate,{label:'Cache hit rate',warnAt:60,badAt:30})],
    ['Sessions',nsess.toLocaleString(),sparkSvg(sessSeries,PAL[2])],
    ['Success rate',null,null,radialRing(srate,{label:'Success rate',warnAt:95,badAt:80})],
    ['In progress',liveDot],
    ['Est. cost','<span class="costpulse">$'+market.toFixed(2)+'</span>'+(elec>0?'<div class="kpisub" title="Local models: electricity at your tariff, included in Est. cost">incl. '+costCell(elec,true)+'</div>':''),sparkSvg(costSeries,PAL[4])]]
    .map(([l,v,spark,ring])=>{
      const meta = KPI_META[l] || {icon:'', color:MU};
      const iconEl = meta.icon ? `<span class="kpi-icon" aria-hidden="true">${meta.icon}</span>` : '';
      const badge = `<div class="kpi-badge" style="background:color-mix(in srgb,${meta.color} 14%,var(--card));color:${meta.color};box-shadow:inset 0 0 0 1px color-mix(in srgb,${meta.color} 30%,transparent)">${iconEl}</div>`;
      const trend = spark ? `<div class="kpi-trend">${spark}</div>` : '';
      if (ring) return `<div class="card kpi-card kpi-ring">
        <div class="kpi-head">${badge}<div class="kpi-name">${l}</div></div>
        <div class="kpi-ring-body"><div class="kringwrap">${ring}</div></div></div>`;
      return `<div class="card kpi-card">
        <div class="kpi-head">${badge}<div class="kpi-name">${l}</div></div>
        <div class="kpi-num"><div class="kpi-big font-semibold${l==='In progress'?' kpi-live':''}">${v}</div></div>
        ${trend}</div>`;
    }).join('');

  // Live data is independent of the date filter — render it before the early
  // return, so an empty range never blanks the Live tab.
  renderLive();
  renderHealth(rows);
  renderDeleg();
  renderHome(inR);
  renderXfer(rows);
  renderHeatmap(p.heatmap);
  renderSessionsTree(p.sessions_tree);
  renderContext(p.context);
  // Flow graph before the empty-rows early return below, so switching to an
  // empty date range clears the graph instead of leaving a stale one on screen.
  flowControls();
  if (view === 'Flow') renderFlow(rows);
  // Router tab (#130) reads DATA.router, not the ledger rows, so it renders
  // before the empty-range return too.
  if (view === 'Router') renderRouterView();
  // Quota tab (#115) also reads its own payload (DATA.quota), not the ledger.
  if (view === 'Quota') renderQuotaView();

  // Before the empty-range return: a range with no ledger rows must say so,
  // not keep showing the previous range's numbers.
  renderBandwidthPanel(p, inR);
  renderResend(p, inR);
  renderConcurrency(p.concurrency, from, to);
  renderLatency(p.latency);
  renderAttribution(p.attribution);
  renderProjects(dateRows, null, null);
  renderRepoBranch(p.repo_branch);
  renderProjectMatrix(dateRows);
  renderProjectDistribution(dateRows);
  renderProjectTrend(dateRows);
  if ($('projweightnote')){
    const wl = PROJ_WEIGHT_LABELS[PROJ_WEIGHT];
    $('projweightnote').textContent = `Showing ${wl.axis.toLowerCase()}. `
      + (PROJ_WEIGHT === 'sessions'
        ? 'Sessions weighting is the mode most likely to show a large Unattributed share — that is expected and not hidden.'
        : '');
  }

  if(!rows.length){
    // P4-09 (#46): an explicit empty state when a filter is why there are no
    // rows — not the generic "no data" a truly empty date range shows, so it is
    // obvious which of the three (or the range) to relax. Naming only the
    // project filter here meant a provider or model filter that matched nothing
    // blamed the date range instead (#130).
    const active = [
      PROJECT_FILTER && `project "${PROJECT_FILTER}"`,
      PROVIDER_FILTER && `provider "${PROVIDER_FILTER}"`,
      MODEL_FILTER && `model "${MODEL_FILTER}"`,
    ].filter(Boolean);
    $('tbl').innerHTML = active.length
      ? `<tr><td class="muted py-3">No data for ${esc(active.join(' + '))} in this range.</td></tr>`
      : '<tr><td class="muted py-3">No data in this range.</td></tr>';
    return;
  }

  buildModelProv(rows);

  const byM=agg(rows,r=>short(r.model),r=>r.calls).slice(0,10);
  mk('cModels','bar',byM.map(x=>ic(x[0])),[{data:byM.map(x=>x[1]),backgroundColor:byM.map(x=>colorOf(x[0])),borderRadius:3}],
    {indexAxis:'y',...noLeg,scales:{x:{grid:{color:BD}},y:{grid:{display:false}}}});

  const byT=agg(rows,r=>short(r.model),r=>r.inp+r.outp).slice(0,8);
  mk('cShare','doughnut',byT.map(x=>ic(x[0])),[{data:byT.map(x=>x[1]),backgroundColor:byT.map(x=>colorOf(x[0])),borderWidth:0}],
    {plugins:{legend:{position:'right',labels:{boxWidth:8,padding:6}}},cutout:'55%'});

  const days=[...new Set(rows.map(r=>r.date))].sort();
  mk('cDaily','line',days,[
    {label:'calls',data:days.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.calls,0)),
     borderColor:AC,backgroundColor:AC+'22',fill:true,tension:.3,yAxisID:'y'},
    {label:'tokens',data:days.map(d=>rows.filter(r=>r.date===d).reduce((s,r)=>s+r.inp+r.outp,0)),
     borderColor:PAL[1],tension:.3,yAxisID:'y1'}],
    {plugins:{legend:{labels:{boxWidth:8}}},scales:{y:{position:'left',grid:{color:BD}},
     y1:{position:'right',grid:{display:false},ticks:{callback:v=>fmt(v)}}}});

  const bt=agg(rows,r=>r.task,r=>r.calls);
  mk('cTasks','bar',bt.map(x=>x[0]),[{data:bt.map(x=>x[1]),backgroundColor:PAL[2],borderRadius:3}],
    {...noLeg,indexAxis:'y',scales:{x:{grid:{color:BD}},y:{grid:{display:false}}}});

  // Cost by model — horizontal so long model names stay readable.
  const mc=agg(rows,r=>short(r.model),r=>r.market_value_usd||0).slice(0,8);
  mk('cModelCost','bar',mc.map(x=>ic(x[0])),[{data:mc.map(x=>+x[1].toFixed(4)),backgroundColor:mc.map(x=>colorOf(x[0])),borderRadius:3}],
    {...noLeg,indexAxis:'y',
     plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>' $'+(+c.raw).toFixed(2)}}},
     scales:{x:{grid:{color:BD},ticks:{callback:v=>'$'+v}},y:{grid:{display:false}}}});

  // Cost per category. `main` dwarfs the rest, so cost uses a log scale while
  // calls stay linear on the right axis — cheap-but-frequent work stays visible.
  const tcost=agg(rows,r=>r.task,r=>r.market_value_usd||0);
  const tcalls=Object.fromEntries(agg(rows,r=>r.task,r=>r.calls));
  const tl=tcost.map(x=>x[0]);
  mk('cTaskCost','bar',tl,[
     // Bars are translucent and explicitly ordered BEHIND the line: Chart.js
     // paints higher `order` first, so without this the opaque bars bury the
     // calls series wherever the two overlap.
     {label:'Est. cost',data:tcost.map(x=>+x[1].toFixed(4)),
      backgroundColor:fade(PAL[1],.42),
      borderColor:fade(PAL[1],.85),borderWidth:1,borderRadius:3,yAxisID:'y',order:2},
     {label:'Calls',type:'line',data:tl.map(t=>tcalls[t]||0),borderColor:PAL[4],backgroundColor:'transparent',
      borderWidth:2.5,pointRadius:3,pointBackgroundColor:PAL[4],
      pointBorderColor:css('--card'),pointBorderWidth:1.5,tension:.3,yAxisID:'y1',order:1}],
    {plugins:{legend:{labels:{boxWidth:8,padding:6}},
      tooltip:{callbacks:{label:c=>c.datasetIndex===0
        ? ' $'+(+c.raw).toFixed(2) : ' '+(+c.raw).toLocaleString()+' calls'}}},
     scales:{x:{grid:{display:false}},
       y:{type:'logarithmic',position:'left',grid:{color:BD},
          ticks:{callback:v=>'$'+(v>=1?v:(+v).toFixed(2))}},
       y1:{position:'right',grid:{display:false},ticks:{callback:v=>fmt(v)}}}});

  const hv=Array.from({length:24},(_,h)=>hours.filter(x=>x.hour===h).reduce((s,x)=>s+x.calls,0));
  mk('cHours','bar',Array.from({length:24},(_,h)=>String(h).padStart(2,'0')),
    [{data:hv,backgroundColor:PAL[4],borderRadius:2}],
    {...noLeg,scales:{x:{grid:{display:false}},y:{grid:{color:BD}}}});
  const bp=agg(rows,r=>provOf(r.provider,r.model,r.base_url),r=>r.calls);
  mk('cProv','doughnut',bp.map(x=>x[0]),[{data:bp.map(x=>x[1]),
      backgroundColor:bp.map(x=>(PROV[x[0]]||{fg:MU}).fg),borderWidth:0}],
    {plugins:{legend:{position:'right',labels:{boxWidth:8,padding:6}}},cutout:'55%'});

  // Provider distribution full-width chart (Usage tab top row)
  const bpd=agg(rows,r=>provOf(r.provider,r.model,r.base_url),r=>r.calls);
  mk('cProvDist','bar',bpd.map(x=>{const s=PROV[x[0]]||{icon:'○'};return s.icon+' '+x[0];}),[{
    data:bpd.map(x=>x[1]),
    backgroundColor:bpd.map(x=>(PROV[x[0]]||{fg:MU}).fg),
    borderRadius:4}],
    {...noLeg,indexAxis:'y',scales:{x:{grid:{color:BD},ticks:{callback:v=>v.toLocaleString()}},y:{grid:{display:false}}}});

  // Provider cost table (Cost tab)
  const ptbl=$('tblProv'); if(ptbl){
    const pCost={};
    rows.forEach(r=>{
      const k=provOf(r.provider,r.model,r.base_url);
      const o=pCost[k]||(pCost[k]={calls:0,tok:0,inp:0,outp:0,mkt:0,up:0,down:0,models:new Set()});
      o.calls+=r.calls;o.tok+=r.inp+r.outp;o.inp+=r.inp;o.outp+=r.outp;
      o.mkt+=(r.market_value_usd||0);o.models.add(short(r.model));
      // LAN and metered bytes are summed together here: this column answers
      // 'how much did this provider move', not 'what did it cost'.
      o.up+=(r.up_bytes||0)+(r.lan_up_bytes||0);
      o.down+=(r.down_bytes||0)+(r.lan_down_bytes||0);
    });
    const pmx=Math.max(...Object.values(pCost).map(v=>v.mkt),0.01);
    ptbl.innerHTML=`<tr class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">
      <th class="text-left py-1.5">Provider</th><th class="text-right">Calls</th>
      <th class="text-right">Tokens</th>
      <th class="text-right" title="Estimated bytes sent to this provider. Derived from tokens, not measured.">&#8593; Up (est)</th>
      <th class="text-right" title="Estimated bytes received from this provider. Derived from tokens, not measured.">&#8595; Down (est)</th>
      <th class="text-right">Est. cost</th>
      <th class="text-right">Models</th><th class="text-left pl-3">Breakdown</th></tr>`+
    Object.entries(pCost).sort((a,b)=>b[1].mkt-a[1].mkt).map(([pr,v])=>{
      const s=PROV[pr]||{icon:'○',fg:MU};
      const barW=Math.max(2,v.mkt/pmx*100);
      return `<tr style="border-top:1px solid ${BD}">
        <td class="py-1.5">${provBadge(pr)}</td>
        <td class="text-right text-[length:var(--fs-xs)]">${v.calls.toLocaleString()}</td>
        <td class="text-right text-[length:var(--fs-xs)]">${fmt(v.tok)}</td>
        <td class="text-right text-[length:var(--fs-xs)] bwup">${fmtB(v.up)}</td>
        <td class="text-right text-[length:var(--fs-xs)] bwdown">${fmtB(v.down)}</td>
        <td class="text-right text-[length:var(--fs-xs)] font-semibold" style="color:${s.fg}">$${v.mkt.toFixed(2)}</td>
        <td class="text-right text-[length:var(--fs-xs)]">${v.models.size}</td>
        <td class="pl-3"><div style="height:5px;border-radius:2px;background:${s.fg};width:${barW}%;opacity:.7"></div></td>
      </tr>`;}).join('');
  }

  const t={};
  rows.forEach(r=>{const k=short(r.model)+'|'+provOf(r.provider,r.model,r.base_url);
    const o=t[k]||(t[k]={calls:0,tok:0,inp:0,outp:0,cache:0,cost:0,mkt:0,elec:0,up:0,down:0,local:false,priced:false,freetier:false,tasks:new Set()});
    o.calls+=r.calls;o.tok+=r.inp+r.outp;o.inp+=r.inp;o.outp+=r.outp;o.cache+=r.cread;o.cost+=(r.billed_usd||0);o.mkt+=(r.market_value_usd||0);o.up+=(r.up_bytes||0)+(r.lan_up_bytes||0);o.down+=(r.down_bytes||0)+(r.lan_down_bytes||0);if(r.cost_class==='local'){o.local=true;o.elec+=(r.energy_usd||0);}if(r.priced||r.cost_class==='local'||r.cost_class==='preset')o.priced=true;if(r.cost_class==='free')o.freetier=true;o.tasks.add(r.task);});
  const mx=Math.max(...Object.values(t).map(r=>r.calls),1);
  $('tbl').innerHTML=`<tr class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">
    <th class="text-left py-1.5">Model</th><th class="text-left">Provider</th>
    <th class="text-right">Calls</th><th class="text-right">In</th><th class="text-right">Out</th>
    <th class="text-right">Cache</th>
    <th class="text-right" title="Estimated bytes uploaded. Tokens x 4.68, not measured. Includes cache reads: prefix caching re-sends the prompt.">&#8593; Up (est)</th>
    <th class="text-right" title="Estimated bytes downloaded. Tokens x 4.68, not measured.">&#8595; Down (est)</th>
    <th class="text-right">Est. cost</th>
    <th class="text-left pl-3">Tasks</th></tr>`+
    Object.entries(t).sort((a,b)=>b[1].calls-a[1].calls).map(([k,v])=>{const [m,pr]=k.split('|');
      return `<tr data-model="${esc(m)}" data-cost="${v.local?'local':'other'}" style="border-top:1px solid ${BD}"><td class="py-1.5"><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${colorOf(m)};margin-right:6px"></span><span class="text-[length:var(--fs-md)] font-semibold" style="color:${colorOf(m)}">${m}</span></td>
        <td>${provBadge(pr)}</td>
        <td class="text-right">${v.calls.toLocaleString()}</td><td class="text-right">${fmt(v.inp)}</td><td class="text-right">${fmt(v.outp)}</td>
        <td class="text-right">${fmt(v.cache)}</td>
        <td class="text-right bwup">${fmtB(v.up)}</td>
        <td class="text-right bwdown">${fmtB(v.down)}</td>
        <td class="text-right">${costCell(v.mkt, v.local, v.freetier ? 'freetier' : (!v.priced && !v.local) ? 'unpriced' : '')}</td>
        <td class="pl-3"><div style="height:4px;border-radius:2px;background:${colorOf(m)};width:${Math.max(3,v.calls/mx*100)}%"></div>
        <span class="text-[length:var(--fs-xs)] muted">${[...v.tasks].join(', ')}</span></td></tr>`;}).join('');
}

export let XF_SEEN = false;
export function renderXfer(rows){
  const card = $('xfercard'); if (!card) return;
  const R = rows || [];
  let up = 0, down = 0, lanUp = 0, lanDown = 0;
  R.forEach(r => {
    up += +r.up_bytes || 0;
    down += +r.down_bytes || 0;
    lanUp += +r.lan_up_bytes || 0;
    lanDown += +r.lan_down_bytes || 0;
  });
  // #114 (same class as the host card): a refresh that momentarily carries no
  // byte rows must not blank this card — the numbers from the previous round
  // are still true. Only hide it while nothing has EVER been seen; keep the
  // totals on screen through a transient empty payload.
  if (!(up + down + lanUp + lanDown)){
    if (!XF_SEEN){ card.hidden = true; }
    return;
  }
  XF_SEEN = true;
  card.hidden = false;

  // Ratio is the headline finding: upload dwarfs download because prompts are
  // re-sent in full on every call while completions are small.
  const ratio = down > 0 ? (up / down) : null;
  $('xfertot').innerHTML =
    `<span class="bwleg"><span class="bwarrow bwup">&uarr;</span>
       <span class="text-[length:var(--fs-lg)] font-semibold">${fmtB(up)}</span>
       <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">up</span></span>
     <span class="bwleg"><span class="bwarrow bwdown">&darr;</span>
       <span class="text-[length:var(--fs-lg)] font-semibold">${fmtB(down)}</span>
       <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">down</span></span>`
    + (ratio ? `<span class="muted text-[length:var(--fs-xs)]">${ratio.toFixed(0)}:1</span>` : '');

  // LAN disclosed separately and never folded into the metered total: bytes to
  // a box on your own network cost nothing, so mixing them would overstate
  // what you actually paid to move.
  const bits = [];
  if (lanUp || lanDown) bits.push(`LAN ${fmtB(lanUp + lanDown)} (not metered)`);
  bits.push(`${R.length} row${R.length === 1 ? '' : 's'}`);
  $('xfernote').textContent = bits.join(' \u00b7 ');
}

// Home cards. Each stat is DERIVED from the loaded payload — a hardcoded
// number on a landing page is a lie with a long shelf life. Cards are anchors
// so middle-click and keyboard both work; the click handler routes in-page.
export function renderHome(inR){
  const box = $('homecards'); if (!box) return;
  const p = DATA.profiles[current] || {};
  // inR is render()'s date-range predicate, passed in rather than reached for:
  // it is a local of render(), so calling it from here failed with a
  // ReferenceError and silently left the card grid empty.
  const pass = typeof inR === 'function' ? inR : () => true;
  const rows = (p.rows || []).filter(r => pass(r.date));
  const live = p.live || [];

  const sum = (f) => rows.reduce((a, r) => a + (+f(r) || 0), 0);
  const models = new Set(rows.map(r => short(r.model)));
  const cost = sum(r => r.market_value_usd);
  const calls = sum(r => r.calls);
  const upB = sum(r => (+r.up_bytes || 0) + (+r.lan_up_bytes || 0));
  const downB = sum(r => (+r.down_bytes || 0) + (+r.lan_down_bytes || 0));

  // Health: the payload carries a list of per-day entries, so derive the rate
  // rather than assuming a precomputed field exists.
  const hl = Array.isArray(p.health) ? p.health : [];
  const hOk = hl.reduce((a, h) => a + (+h.ok || 0), 0);
  const hTot = hl.reduce((a, h) => a + (+h.ok || 0) + (+h.fail || 0), 0);
  const okPct = hTot ? (hOk / hTot * 100).toFixed(1) + '%' : '\u2014';
  const fails = (p.failures_recent || []).length;

  // P4-11 (#48): top project by spend + unattributed share, both derived
  // from the SAME date-scoped rows every other home card uses — no
  // hardcoded project name.
  const projSpend = new Map();
  rows.forEach(r => {
    const proj = r.project || 'Unattributed';
    projSpend.set(proj, (projSpend.get(proj) || 0) + (+r.act || +r.est || 0));
  });
  const totalSpend = [...projSpend.values()].reduce((a, b) => a + b, 0);
  const unattrSpend = projSpend.get('Unattributed') || 0;
  const topProject = [...projSpend.entries()]
    .filter(([k]) => k !== 'Unattributed')
    .sort((a, b) => b[1] - a[1])[0];
  const unattrPct = totalSpend > 0 ? (100 * unattrSpend / totalSpend).toFixed(0) + '%' : '\u2014';
  const projStat = topProject
    ? `${esc(topProject[0])} \u00b7 ${unattrPct} unattributed`
    : (totalSpend > 0 ? `${unattrPct} unattributed` : 'No data');

  const cards = [
    ['Live', icon('play'), PAL[3], 'Sessions in flight right now',
      live.length ? live.length + (live.length === 1 ? ' session' : ' sessions') : 'idle'],
    ['Flow', icon('swap'), AC, 'Provider \u2192 model \u2192 task routing',
      models.size + (models.size === 1 ? ' model' : ' models')],
    ['Router', icon('target'), PAL[5], 'Which model handles which kind of work, and why',
      routerStat()],
    ['Quota', icon('scale'), PAL[4], 'How much headroom is left on each provider',
      qvStat()],
    ['Usage', icon('layers'), PAL[1], 'Calls and tokens over time', fmt(calls) + ' calls'],
    ['Projects', icon('folder'), PAL[5], 'Spend and calls broken down by project',
      projStat],
    ['Cost', icon('dollar'), PAL[4], 'What the traffic is worth at public rates',
      '$' + cost.toFixed(2)],
    ['Health', icon('check'), PAL[6], 'Success rate and recent failures',
      okPct + (fails ? ' \u00b7 ' + fails + ' recent' : '')],
    ['Detail', icon('grid'), PAL[2], 'Per-model table and the activity calendar',
      rows.length + ' rows'],
    ['Settings', icon('cog'), MU, 'Electricity tariff and hardware behind local cost',
      '$' + (+POWER.tariff.electricity_rate_kwh) + ' / kWh'],
  ];

  let html = cards.map(([view, ico, color, desc, stat]) => `
    <a class="card p-4 homecard" href="#/${view.toLowerCase()}" data-gohome="${view}">
      <div class="flex items-center justify-between mb-2">
        <div class="kpi-badge" style="background:color-mix(in srgb,${color} 14%,var(--card));color:${color};box-shadow:inset 0 0 0 1px color-mix(in srgb,${color} 30%,transparent)">
          <span class="hc-ico" aria-hidden="true">${ico}</span></div>
        <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">${view}</span>
      </div>
      <div class="hc-stat">${stat}</div>
      <div class="muted text-[length:var(--fs-xs)] mt-1">${desc}</div>
    </a>`).join('');

  // Bandwidth card: both directions together, because the ratio is the point.
  // Labelled "est." on the card itself — a derived number that looks measured
  // is the failure this project keeps guarding against.
  html += `
    <a class="card p-4 homecard" href="#/usage" data-gohome="Usage">
      <div class="flex items-center justify-between mb-2">
        <div class="kpi-badge" style="background:color-mix(in srgb,${PAL[0]} 14%,var(--card));color:${PAL[0]};box-shadow:inset 0 0 0 1px color-mix(in srgb,${PAL[0]} 30%,transparent)">
          <span class="hc-ico" aria-hidden="true">${icon('updown')}</span></div>
        <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">Bandwidth (est.)</span>
      </div>
      <div class="hc-stat"><span class="bwup">\u2191 ${fmtB(upB)}</span>
        <span class="muted" style="font-weight:400"> / </span>
        <span class="bwdown">\u2193 ${fmtB(downB)}</span></div>
      <div class="muted text-[length:var(--fs-xs)] mt-1">Estimated from tokens, not measured</div>
    </a>`;

  // Rates is a separate page, so it stays a real external link.
  html += `
    <a class="card p-4 homecard" href="costs.html">
      <div class="flex items-center justify-between mb-2">
        <div class="kpi-badge" style="background:color-mix(in srgb,${PAL[8]} 14%,var(--card));color:${PAL[8]};box-shadow:inset 0 0 0 1px color-mix(in srgb,${PAL[8]} 30%,transparent)">
          <span class="hc-ico" aria-hidden="true">${icon('scale')}</span></div>
        <span class="muted text-[length:var(--fs-xs)] uppercase tracking-wide">Rates</span>
      </div>
      <div class="hc-stat">Price sheet</div>
      <div class="muted text-[length:var(--fs-xs)] mt-1">Current per-million-token rates</div>
    </a>`;

  box.innerHTML = html;
  // Route in-page instead of relying on the hash alone, so a card works even
  // before the router has attached.
  box.querySelectorAll('[data-gohome]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      pickView(a.dataset.gohome);
    });
  });
}

// Which models a live session used (#107). The row used to say "4 models used"
// with no names, and that count ignored helper tasks (compression, approval,
// title generation) that also spend tokens. L.models comes from collect_live.
export const liveModelsOpen = new Set();   // survives the 5s re-render
export function modelsOf(L){ return Array.isArray(L.models) ? L.models : []; }
export function modelsBadge(L){
  const ms = modelsOf(L);
  if (ms.length < 2) return (L.nmodels||0) > 1
    ? `<div class="muted text-[length:var(--fs-xs)]">${L.nmodels} models used</div>` : '';
  const main = ms.filter(m => m.main).length;
  const tip = ms.map(m => `${short(m.model)} (${m.tasks.join(', ')})`).join('\n');
  const open = liveModelsOpen.has(L.id);
  return `<button type="button" class="lmbtn muted text-[length:var(--fs-xs)]" data-lm="${esc(L.id)}"
     aria-expanded="${open}" title="${esc(tip)}">${ms.length} models used`
    + (main < ms.length ? ` (${main} main, ${ms.length - main} helper)` : '')
    + ` ${open ? '\u25B4' : '\u25BE'}</button>`;
}
// Which metric the share bar divides up. Tokens is the default because one
// call is not one unit of work: in a real session claude-opus-5 had 1,003 calls
// but 150M tokens, while a helper had 26 calls and 341k. Calls alone would make
// those look comparable.
export let lmMetric = 'tokens';
export const LM_METRIC = {
  tokens: {label: 'tokens', of: m => (+m.in_tok||0) + (+m.out_tok||0), fmt: v => fmt(v)},
  calls:  {label: 'calls',  of: m => (+m.calls||0),                     fmt: v => fmt(v)},
};

// Proportional share of the session, one segment per model, coloured with the
// same palette as the model name so the bar and the row read as one thing.
export function modelsShare(ms, cur){
  const M = LM_METRIC[lmMetric] || LM_METRIC.tokens;
  const vals = ms.map(M.of);
  const tot = vals.reduce((a, b) => a + b, 0);
  if (!tot) return '';
  const segs = ms.map((m, i) => {
    const pct = vals[i] / tot * 100;
    if (pct <= 0) return '';
    const nm = short(m.model);
    // A model with real usage must stay visible even at 0.2%: min-width keeps
    // a sliver on screen rather than silently dropping it from the picture.
    return `<span class="lmseg" style="width:${pct.toFixed(3)}%;background:${colorOf(nm)}"
       title="${esc(nm)} — ${M.fmt(vals[i])} ${M.label} (${pct.toFixed(1)}%)"></span>`;
  }).join('');
  const legend = ms.map((m, i) => {
    const nm = short(m.model), pct = vals[i] / tot * 100;
    return `<span class="lmkey${nm === cur ? ' cur' : ''}">`
      + `<span class="lmdot" style="background:${colorOf(nm)}"></span>${esc(nm)}`
      + `<span class="muted"> ${pct < 0.1 && pct > 0 ? '<0.1' : pct.toFixed(1)}%</span></span>`;
  }).join('');
  return `<div class="lmbar" role="img"
      aria-label="share of ${M.label} per model">${segs}</div>
    <div class="lmlegend">${legend}</div>`;
}

export function modelsPanel(L){
  const ms = modelsOf(L);
  if (ms.length < 2 || !liveModelsOpen.has(L.id)) return '';
  const cur = short(L.model);
  const M = LM_METRIC[lmMetric] || LM_METRIC.tokens;
  const vals = ms.map(M.of);
  const max = Math.max(...vals, 1);
  const rows = ms.map((m, i) => {
    const nm = short(m.model);
    // Per-row bar scaled to the BIGGEST model, not to the total: it answers
    // "how does this one compare with the heaviest", which is what the eye is
    // doing when it scans a column of numbers.
    const w = vals[i] / max * 100;
    return `<tr><td><span style="color:${colorOf(nm)}">\u25CF</span> ${esc(nm)}`
      + (nm === cur ? ' <span class="muted">(now)</span>' : '') + `</td>`
      + `<td>${provBadge(provOf('', m.model, m.base_url))}</td>`
      + `<td class="muted">${m.tasks.map(esc).join(', ')}</td>`
      + `<td class="lmcell"><span class="lmrowbar" style="width:${w.toFixed(2)}%;`
      + `background:${colorOf(nm)}"></span></td>`
      + `<td class="num">${fmt(m.calls)}</td>`
      + `<td class="num">${fmt(m.in_tok)} / ${fmt(m.out_tok)}</td>`
      + `<td class="num muted">${m.last ? ago(Math.max(0, Date.now()/1000 - m.last)) + ' ago' : ''}</td></tr>`;
  }).join('');
  const toggle = Object.keys(LM_METRIC).map(k =>
    `<button type="button" class="lmmet${k === lmMetric ? ' on' : ''}" data-lmmet="${k}">`
    + `${LM_METRIC[k].label}</button>`).join('');
  return `<div class="lmpanel" data-lmp="${esc(L.id)}">
    <div class="lmhead"><span class="muted">share of</span>${toggle}</div>
    ${modelsShare(ms, cur)}
    <table>
    <thead><tr><th>Model</th><th>Provider</th><th>Used for</th><th>Share</th><th class="num">Calls</th>
    <th class="num">Tokens in / out</th><th class="num">Last used</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
document.addEventListener('click', e => {
  const mt = e.target.closest && e.target.closest('[data-lmmet]');
  if (mt) { lmMetric = mt.dataset.lmmet; renderLive(); return; }
  const b = e.target.closest && e.target.closest('[data-lm]');
  if (!b) return;
  const id = b.dataset.lm;
  liveModelsOpen.has(id) ? liveModelsOpen.delete(id) : liveModelsOpen.add(id);
  renderLive();
});

// P9-06 (#83): concurrency band. `hours` here is DATA.profiles[current]'s
// hour-keyed concurrency list, already scoped to the selected date range by
// render() (matching how cDaily/cHours are filtered) — this function does
// no range filtering of its own.
export function renderConcurrency(concurrency, fromDate, toDate){
  const card = $('conccard'), empty = $('concempty'), peakEl = $('concpeak');
  if (!card) return;
  const inR = h => {
    const d = h.hour.slice(0, 10);
    return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
  };
  const rows = (concurrency || []).filter(inR).sort((a, b) => a.hour < b.hour ? -1 : 1);

  if (!rows.length){
    // "Empty range renders an empty state, not a broken axis" — destroy any
    // stale chart bound to the canvas rather than leaving Chart.js holding
    // axes for zero data points.
    const el = $('cConcurrency');
    const prev = el && (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
    if (prev) { try { prev.destroy(); } catch(_){} }
    empty.hidden = false;
    peakEl.textContent = '';
    return;
  }
  empty.hidden = true;

  let peak = {total: -1, hour: null, top: 0, sub: 0};
  rows.forEach(r => {
    const total = r.top + r.sub;
    if (total > peak.total) peak = {total, hour: r.hour, top: r.top, sub: r.sub};
  });
  peakEl.innerHTML = `Peak: <b>${peak.total}</b> concurrent session${peak.total===1?'':'s'} ` +
    `(${peak.top} top-level, ${peak.sub} subagent) at <b>${esc(peak.hour)}</b>`;

  // Queue depth has no stored history (the Ollama poller only ever samples
  // "right now"), so it renders as a single dashed reference line at the
  // CURRENT total across hosts rather than a fabricated series — labelling
  // it "now" makes that scope explicit instead of implying a real trend.
  const hosts = (DATA.ollama && DATA.ollama.hosts) || [];
  const queueNow = hosts.reduce((s, h) => s + Math.max(0, (+h.queue || 0)), 0);

  mk('cConcurrency', 'bar', rows.map(r => r.hour.slice(5)),
    [
      {label: 'top-level', data: rows.map(r => r.top), backgroundColor: AC, stack: 's'},
      {label: 'subagent', data: rows.map(r => r.sub), backgroundColor: PAL[2], stack: 's'},
      {label: 'queue depth (now)', data: rows.map(() => queueNow), type: 'line',
       borderColor: '#ef4444', borderDash: [4, 3], pointRadius: 0, fill: false, yAxisID: 'y'},
    ],
    {plugins: {legend: {labels: {boxWidth: 8}}},
     scales: {x: {grid: {color: BD}}, y: {grid: {color: BD}, beginAtZero: true}}});
}

// P4-04 (#41): a small diagonal-hatch canvas pattern, used as the
// Unattributed bar's fill instead of a plain color. This is the a11y
// requirement from the ticket ("visually distinguishable without relying
// on colour alone") — a colorblind reader or a grayscale printout still
// sees the hatch texture even if the color itself is indistinguishable
// from a real project's bar.
export let _unattrPattern = null;
export function unattrPattern(){
  if (_unattrPattern) return _unattrPattern;
  const c = document.createElement('canvas');
  c.width = 8; c.height = 8;
  const ctx = c.getContext('2d');
  // jsdom's test environment has no real canvas backend — getContext()
  // returns null there. Fall back to a flat muted color so tests exercise
  // the rest of renderProjects() instead of crashing on a null context;
  // check_projects_card.js still asserts the Unattributed bar uses a
  // DIFFERENT fill style than any real project's PAL color.
  if (!ctx) return 'rgba(148,163,184,0.5)';
  ctx.fillStyle = 'rgba(148,163,184,0.35)';
  ctx.fillRect(0, 0, 8, 8);
  ctx.strokeStyle = 'rgba(148,163,184,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 8); ctx.lineTo(8, 0);
  ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
  ctx.moveTo(6, 10); ctx.lineTo(10, 6);
  ctx.stroke();
  _unattrPattern = ctx.createPattern(c, 'repeat');
  return _unattrPattern;
}

export const UNATTR_LABEL = 'Unattributed';

// P10-05 (#93): latency — model-response time as the user experiences it.
// Renders the payload the collector already computed (percentiles are
// computed server-side in latency.py, independently unit-tested there);
// this function is presentation only.
export function renderLatency(lat){
  const card = $('latcard');
  if (!card) return;
  const byModel = (lat && lat.by_model) || {};
  const byEndpoint = (lat && lat.by_endpoint) || {};
  if (!Object.keys(byModel).length){ card.hidden = true; return; }
  card.hidden = false;

  const row = (name, b) => {
    const tokS = b.tok_s != null ? `${b.tok_s.toFixed(1)} tok/s` : '';
    return `<div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
      <span class="font-semibold flex-1 truncate" title="${esc(name)}">${esc(name)}</span>
      <span class="muted" title="sample size">n=${b.n}</span>
      <span title="p50 / p90 / p99 seconds">${b.p50}s / ${b.p90}s / ${b.p99}s</span>
      <span class="muted" style="min-width:5.5rem;text-align:right">${tokS}</span>
    </div>`;
  };

  $('latbymodel').innerHTML = Object.entries(byModel)
    .sort((a, b) => b[1].p90 - a[1].p90)
    .map(([name, b]) => row(name, b)).join('');
  $('latbyendpoint').innerHTML = Object.entries(byEndpoint)
    .sort((a, b) => b[1].p90 - a[1].p90)
    .map(([name, b]) => row(name, b)).join('');

  const slowest = (lat && lat.slowest) || [];
  $('latslowest').innerHTML = slowest.length
    ? `<div class="muted text-[length:var(--fs-xs)] mb-1 mt-1">Slowest turns</div>` +
      slowest.map(s => `<div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-0.5">
        <button type="button" class="chip ttitlebtn" data-tsession="${esc(s.session)}" data-tprofile="${esc(current)}">${esc(s.model || '(unknown)')}</button>
        <span class="muted">${s.s}s</span>
      </div>`).join('')
    : '';
}

// P10-07 (#95): cost attribution — who spent it, not just how much.
// Renders the collector's own already-priced aggregates; never recomputes
// a dollar figure client-side.
export function renderAttribution(attrib){
  const card = $('attribcard');
  if (!card) return;
  const bySource = (attrib && attrib.by_source) || [];
  const byRoot = (attrib && attrib.by_root) || [];
  const byCron = (attrib && attrib.by_cron) || [];
  const byTool = (attrib && attrib.by_tool) || [];
  if (!bySource.length){ card.hidden = true; return; }
  card.hidden = false;

  const money = v => `$${(v || 0).toFixed(4)}`;

  $('attribsource').innerHTML = bySource.map(b => `
    <div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
      <span class="font-semibold flex-1 truncate">${esc(b.source)}</span>
      <span class="muted">${b.sessions} sess</span>
      <span style="min-width:5.5rem;text-align:right">${money(b.cost)}</span>
    </div>`).join('');

  $('attribtool').innerHTML = byTool.length
    ? byTool.map(b => `
      <div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
        <span class="font-semibold flex-1 truncate">${esc(b.tool)}</span>
        <span class="muted">${(b.tokens||0).toLocaleString()} tok</span>
        <span style="min-width:5.5rem;text-align:right">${money(b.cost)}</span>
      </div>`).join('')
    : `<div class="muted text-[length:var(--fs-xs)] py-1">No tool-result tokens in range.</div>`;

  $('attribroot').innerHTML = byRoot.slice(0, 10).map(b => `
    <div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
      <button type="button" class="chip lntimelinebtn truncate flex-1" style="text-align:left"
        data-tsession="${esc(b.id)}" data-tprofile="${esc(current)}" data-title="${esc(b.title)}"
        title="${esc(b.title)} — view timeline">${esc(b.title)}</button>
      <span class="muted" title="own cost, excluding descendants">own ${money(b.own)}</span>
      <span class="muted" title="cost of all descendant sessions">+desc ${money(b.descendants)}</span>
      <span style="min-width:5.5rem;text-align:right">${money(b.total)}</span>
    </div>`).join('');

  const cronWrap = $('attribcronwrap');
  if (cronWrap) cronWrap.hidden = !byCron.length;
  if (byCron.length){
    $('attribcron').innerHTML = byCron.map(b => `
      <div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
        <span class="font-semibold flex-1 truncate">${esc(b.name)}</span>
        <span class="muted">${b.runs} runs</span>
        <span class="muted" title="average cost per run">avg ${money(b.avg)}</span>
        <span style="min-width:5.5rem;text-align:right" title="naive 30-day-window projection, not a schedule-derived forecast">~${money(b.monthly_projection)}/mo</span>
      </div>`).join('');
  }

  $('attribfooter').textContent =
    'Cost here comes from this dashboard\u2019s own OpenRouter-rate pricing, not from Hermes\u2019s own cost_status (which is unknown on a large share of sessions).';
}


// P4-05 (#101), part 2: repo & branch cost card. Expandable rows: click a
// repo row to reveal/hide its own branch rows, indented underneath.
export let REPO_EXPANDED = new Set();

export function renderRepoBranch(data){
  const list = $('repolist'), empty = $('repoempty');
  if (!list) return;
  const repos = (data && data.repos) || [];
  if (!repos.length){
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const fmtN = n => n.toLocaleString();
  const rowHtml = (name, sessions, calls, tokens, cost, indent, isRepo, key) => `
    <div class="flex items-center gap-2 py-1.5${indent?' pl-6':''}${isRepo?' cursor-pointer':''}" style="border-bottom:1px solid var(--border)"
         ${isRepo ? `data-repokey="${esc(key)}"` : ''}>
     ${isRepo ? `<span class="muted" style="width:1em;display:inline-block">${REPO_EXPANDED.has(key)?'&#9662;':'&#9656;'}</span>` : ''}
     <span class="flex-1 truncate${name==='Unattributed'?' muted':''}">${esc(name)}</span>
     <span class="muted text-[length:var(--fs-xs)]" style="width:70px;text-align:right">${fmtN(sessions)} sess</span>
     <span class="muted text-[length:var(--fs-xs)]" style="width:80px;text-align:right">${fmtN(calls)} calls</span>
     <span class="muted text-[length:var(--fs-xs)]" style="width:80px;text-align:right">${fmt(tokens)} tok</span>
     <span class="font-semibold text-[length:var(--fs-sm)]" style="width:80px;text-align:right">$${cost.toFixed(2)}</span>
    </div>`;
  list.innerHTML = repos.map(r => {
    const repoRow = rowHtml(r.repo, r.sessions, r.calls, r.tokens, r.cost, false, true, r.repo);
    const branchRows = REPO_EXPANDED.has(r.repo)
      ? r.branches.map(b => rowHtml(b.branch, b.sessions, b.calls, b.tokens, b.cost, true, false, null)).join('')
      : '';
    return repoRow + branchRows;
  }).join('');
}

export function renderProjects(rows, fromDate, toDate){
  const card = $('projcard'), empty = $('projempty'), hdr = $('projhdr');
  if (!card) return;
  const excludeToggle = $('projexclude');
  const exclude = !!(excludeToggle && excludeToggle.checked);

  const inR = r => {
    const d = r.date;
    return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
  };
  const inRange = (rows || []).filter(inR);

  if (!inRange.length){
    const el = $('cProjects');
    const prev = el && (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
    if (prev) { try { prev.destroy(); } catch(_){} }
    empty.hidden = false;
    hdr.textContent = '';
    return;
  }
  empty.hidden = true;

  // Acceptance: "sum of all buckets including Unattributed equals the
  // ungrouped total" — computed from the SAME inRange array both ways, so
  // there is no way for the two numbers to silently diverge.
  const totalCost = inRange.reduce((s, r) => s + (+r.act || +r.est || 0), 0);

  const byProject = new Map();
  inRange.forEach(r => {
    const key = r.project || UNATTR_LABEL;
    const cost = +r.act || +r.est || 0;
    byProject.set(key, (byProject.get(key) || 0) + cost);
  });

  const unattrCost = byProject.get(UNATTR_LABEL) || 0;
  const unattrPct = totalCost > 0 ? (100 * unattrCost / totalCost) : 0;

  let labels = [...byProject.keys()].sort((a, b) => {
    // Unattributed always sorts last — it's a catch-all bucket, not a
    // project competing for rank.
    if (a === UNATTR_LABEL) return 1;
    if (b === UNATTR_LABEL) return -1;
    return byProject.get(b) - byProject.get(a);
  });

  if (exclude) {
    labels = labels.filter(l => l !== UNATTR_LABEL);
  }

  hdr.textContent = exclude
    ? `${unattrPct.toFixed(0)}% of spend is unattributed (excluded from this chart) — $${unattrCost.toFixed(2)} of $${totalCost.toFixed(2)}`
    : `${unattrPct.toFixed(0)}% of spend unattributed — $${unattrCost.toFixed(2)} of $${totalCost.toFixed(2)}`;

  const colors = labels.map((l, i) => l === UNATTR_LABEL ? unattrPattern() : PAL[i % PAL.length]);

  mk('cProjects', 'bar', labels, [
    {data: labels.map(l => byProject.get(l) || 0), backgroundColor: colors, borderRadius: 2},
  ], {
    plugins: {
      legend: {display: false},
      tooltip: {callbacks: {
        // The ticket's own requirement: a tooltip explaining WHY a session
        // is unattributed, as the reader's cue that naming a session
        // improves the report.
        afterLabel: (ctx) => ctx.label === UNATTR_LABEL
          ? 'No usable session title, no usable working directory, and no parent session that resolves either.'
          : '',
      }},
    },
    scales: {x: {grid: {display: false}}, y: {grid: {color: BD}, beginAtZero: true}},
  });
}

// P4-05 (#42): project × model matrix — reuses the SAME colorOf() every
// other view uses for a model's color, so a model never gets a second,
// disagreeing shade here (an explicit acceptance criterion). Cap on how
// many model columns render before folding the tail into "+N more" — a
// deployment with 15 distinct models would otherwise produce unreadably
// thin columns.
export const PROJ_MATRIX_MAX_COLS = 8;

// P4-08 (#45): ONE shared weighting value drives the matrix, the provider
// bars and (once P4-10 lands) the trend — three charts disagreeing about
// their unit would be worse than no toggle at all. Persisted like theme
// and view choice (localStorage), so it survives a reload.
export function renderProjectMatrix(rows){
  const table = $('projmatrix'), empty = $('projmatrixempty');
  if (!table) return;
  if (!rows || !rows.length){
    table.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const wl = PROJ_WEIGHT_LABELS[PROJ_WEIGHT];

  // project -> model -> [rows in that bucket]. Grouped by RAW ROWS rather
  // than a running sum, because "sessions" weighting needs the distinct
  // session_id count per bucket, not a pre-summed number — no hardcoded
  // project or model list anywhere in this function; both axes come
  // entirely from what's in `rows`.
  const byProject = new Map();
  const modelGroups = new Map();
  rows.forEach(r => {
    const proj = r.project || 'Unattributed';
    if (!byProject.has(proj)) byProject.set(proj, new Map());
    const models = byProject.get(proj);
    if (!models.has(r.model)) models.set(r.model, []);
    models.get(r.model).push(r);
    if (!modelGroups.has(r.model)) modelGroups.set(r.model, []);
    modelGroups.get(r.model).push(r);
  });

  // Row order: by project total descending, Unattributed always last (same
  // convention as the Cost-by-project card, #41) so it never competes for
  // rank against a real project.
  const projectTotal = proj => weightValue([...byProject.get(proj).values()].flat());
  const projects = [...byProject.keys()].sort((a, b) => {
    if (a === 'Unattributed') return 1;
    if (b === 'Unattributed') return -1;
    return projectTotal(b) - projectTotal(a);
  });

  // Column order: by GLOBAL model total descending (in the CURRENT
  // weighting), capped, tail folded.
  const modelTotal = m => weightValue(modelGroups.get(m));
  const allModels = [...modelGroups.keys()].sort((a, b) => modelTotal(b) - modelTotal(a));
  const shownModels = allModels.slice(0, PROJ_MATRIX_MAX_COLS);
  const restModels = allModels.slice(PROJ_MATRIX_MAX_COLS);
  const restTotal = weightValue(restModels.flatMap(m => modelGroups.get(m)));

  const grandTotal = weightValue(rows);

  const headCells = shownModels.map(m =>
    `<th class="text-right px-2 py-1.5" style="color:${colorOf(m)}">${esc(short(m))}</th>`).join('');
  const restHeadCell = restModels.length
    ? `<th class="text-right px-2 py-1.5 muted" title="${esc(restModels.map(short).join(', '))}">+${restModels.length} more</th>`
    : '';

  const bodyRows = projects.map(proj => {
    const models = byProject.get(proj);
    const cells = shownModels.map(m => {
      const grp = models.get(m);
      // Empty cell != zero cell (explicit acceptance criterion): a project
      // that never touched a model renders blank, not a formatted zero.
      if (grp === undefined) return '<td class="text-right px-2 py-1.5 muted">—</td>';
      const v = weightValue(grp);
      return `<td class="text-right px-2 py-1.5 proj-cell" data-project="${esc(proj)}" data-model="${esc(m)}" ` +
        `style="cursor:pointer" title="${esc(proj)} × ${esc(short(m))}: ${wl.fmt(v)} ${wl.unit}">${wl.fmt(v)}</td>`;
    }).join('');
    let restCell = '';
    if (restModels.length){
      const restGrp = restModels.flatMap(m => models.get(m) || []);
      const restV = weightValue(restGrp);
      restCell = restV > 0
        ? `<td class="text-right px-2 py-1.5 muted">${wl.fmt(restV)}</td>`
        : '<td class="text-right px-2 py-1.5 muted">—</td>';
    }
    const rowTotal = projectTotal(proj);
    return `<tr><td class="px-2 py-1.5 font-medium">${esc(proj)}</td>${cells}${restCell}` +
      `<td class="text-right px-2 py-1.5 font-semibold">${wl.fmt(rowTotal)}</td></tr>`;
  }).join('');

  const colTotalCells = shownModels.map(m =>
    `<td class="text-right px-2 py-1.5 font-semibold">${wl.fmt(modelTotal(m))}</td>`).join('');
  const restColTotal = restModels.length
    ? `<td class="text-right px-2 py-1.5 font-semibold muted">${wl.fmt(restTotal)}</td>` : '';

  // Unit is labelled on the header itself (explicit acceptance criterion:
  // "an unlabelled number that silently switches between dollars and call
  // counts is a reporting bug") — not just implied by the toggle state.
  table.innerHTML =
    `<thead><tr><th class="text-left px-2 py-1.5">Project <span class="muted normal-case font-normal">(${esc(wl.axis)})</span></th>${headCells}${restHeadCell}` +
    `<th class="text-right px-2 py-1.5">Total</th></tr></thead>` +
    `<tbody>${bodyRows}</tbody>` +
    `<tfoot><tr class="border-t" style="border-color:var(--border)"><td class="px-2 py-1.5 muted">Total</td>` +
    `${colTotalCells}${restColTotal}<td class="text-right px-2 py-1.5 font-semibold">${wl.fmt(grandTotal)}</td></tr></tfoot>`;

  // Click targets -> P4-07 drill-down panel (#44). Focusable (tabIndex+role)
  // so "focus returns to the trigger" on close has a real trigger to return
  // to — a <td> is not focusable by default.
  table.querySelectorAll('.proj-cell').forEach(td => {
    td.tabIndex = 0;
    td.setAttribute('role', 'button');
    td.onclick = () => pdOpen(td.dataset.project, rows, td.dataset.model);
    td.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pdOpen(td.dataset.project, rows, td.dataset.model); } };
  });
  // Acceptance: "opens from a matrix cell AND from a project row label."
  table.querySelectorAll('tbody tr').forEach(tr => {
    const labelCell = tr.firstElementChild;
    const proj = labelCell.textContent;
    labelCell.style.cursor = 'pointer';
    labelCell.tabIndex = 0;
    labelCell.setAttribute('role', 'button');
    labelCell.onclick = () => pdOpen(proj, rows, null);
    labelCell.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pdOpen(proj, rows, null); } };
  });
}

export let pdFocusReturn = null;
export let pdOpenState = false;

// P4-07 (#44): project drill-down panel. `rows` is the SAME date-filtered
// row set the matrix/distribution charts were built from, so panel numbers
// reconcile with whatever cell opened it by construction — there is no
// second query or recomputation that could silently disagree.
export function pdOpen(project, rows, _highlightModel){
  // _highlightModel: callers pass the model the user clicked, but the drawer
  // renders the whole project. Kept in the signature (named, not silently
  // dropped) so the intent is visible; used once the drawer scrolls to a row.
  const scrim = $('pdscrim'), drawer = $('pdrawer'), body = $('pdbody'), title = $('pdtitle');
  if (!scrim || !drawer || !body) return;
  pdFocusReturn = document.activeElement;

  const projRows = (rows || []).filter(r => (r.project || 'Unattributed') === project);
  title.textContent = project;

  const totalCalls = projRows.reduce((s, r) => s + (+r.calls || 0), 0);
  const totalInp = projRows.reduce((s, r) => s + (+r.inp || 0), 0);
  const totalOutp = projRows.reduce((s, r) => s + (+r.outp || 0), 0);
  const totalCread = projRows.reduce((s, r) => s + (+r.cread || 0), 0);
  const totalCwrite = projRows.reduce((s, r) => s + (+r.cwrite || 0), 0);
  const totalEst = projRows.reduce((s, r) => s + (+r.est || 0), 0);
  const totalAct = projRows.reduce((s, r) => s + (+r.act || 0), 0);
  // Estimated vs actual are NEVER conflated into one number (explicit
  // acceptance criterion — cost_status/cost_source exist precisely
  // because some rows are estimates). Both render, separately labelled.
  const sessionIds = new Set(projRows.map(r => r.session_id).filter(Boolean));
  const dates = projRows.map(r => r.date).filter(Boolean).sort();
  const firstSeen = dates[0] || '\u2014';
  const lastSeen = dates[dates.length - 1] || '\u2014';

  const byModel = new Map();
  const byProvider = new Map();
  const byTask = new Map();
  projRows.forEach(r => {
    const cost = +r.act || +r.est || 0;
    byModel.set(r.model, (byModel.get(r.model) || 0) + cost);
    const prov = provOf(r.provider, r.model, r.base_url);
    byProvider.set(prov, (byProvider.get(prov) || 0) + cost);
    const task = r.task || 'unspecified';
    byTask.set(task, (byTask.get(task) || 0) + cost);
  });
  const topModels = [...byModel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topProviders = [...byProvider.entries()].sort((a, b) => b[1] - a[1]);
  const topTasks = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const statRow = (k, v) => `<div class="pdstat"><span class="k">${esc(k)}</span><span>${v}</span></div>`;
  const bar = (label, icon, cost, total) => {
    const pct = total > 0 ? (100 * cost / total) : 0;
    return `<div class="pdstat"><span class="k">${esc(icon ? icon + ' ' : '')}${esc(label)}</span>` +
      `<span>$${cost.toFixed(2)} <span class="muted">(${pct.toFixed(0)}%)</span></span></div>`;
  };

  body.innerHTML = `
    <div class="pdsection">
      <div class="lbl">Totals</div>
      ${statRow('Sessions', sessionIds.size || '\u2014')}
      ${statRow('Calls', totalCalls.toLocaleString())}
      ${statRow('Tokens in / out', `${totalInp.toLocaleString()} / ${totalOutp.toLocaleString()}`)}
      ${statRow('Cache read / write', `${totalCread.toLocaleString()} / ${totalCwrite.toLocaleString()}`)}
      <div class="pdstat"><span class="k">Cost — actual</span><span class="pdcost-actual">$${totalAct.toFixed(2)}</span></div>
      <div class="pdstat"><span class="k">Cost — estimated</span><span class="pdcost-est">$${totalEst.toFixed(2)} (est.)</span></div>
      ${statRow('First seen', firstSeen)}
      ${statRow('Last seen', lastSeen)}
    </div>
    <div class="pdsection">
      <div class="lbl">Model breakdown</div>
      ${topModels.map(([m, c]) => bar(short(m), provIcon(short(m)), c, totalAct || totalEst)).join('')}
    </div>
    <div class="pdsection">
      <div class="lbl">Provider breakdown</div>
      ${topProviders.map(([p, c]) => bar(p, (PROV[p] || {}).icon || '\u25CB', c, totalAct || totalEst)).join('')}
    </div>
    <div class="pdsection">
      <div class="lbl">Task / tool mix</div>
      ${topTasks.map(([t, c]) => bar(t, '', c, totalAct || totalEst)).join('')}
    </div>
    <div class="pdsection">
      <div class="lbl">Recent sessions</div>
      ${[...sessionIds].slice(0, 12).map(sid => {
        const sr = projRows.find(r => r.session_id === sid);
        return `<div class="pdsessrow">${esc(sid)}${sr && sr.date ? ` <span class="muted">· ${esc(sr.date)}</span>` : ''}</div>`;
      }).join('') || '<div class="muted">No individual session ids in this range.</div>'}
    </div>`;

  scrim.classList.add('open'); drawer.classList.add('open');
  scrim.setAttribute('aria-hidden', 'false'); drawer.setAttribute('aria-hidden', 'false');
  pdOpenState = true;
  document.addEventListener('keydown', pdKeydown, true);
  drawer.focus();
}

export function pdClose(){
  if (!pdOpenState) return;
  pdOpenState = false;
  $('pdscrim')?.classList.remove('open');
  $('pdrawer')?.classList.remove('open');
  $('pdscrim')?.setAttribute('aria-hidden', 'true');
  $('pdrawer')?.setAttribute('aria-hidden', 'true');
  document.removeEventListener('keydown', pdKeydown, true);
  // Focus returns to the trigger — the matrix cell or project row label
  // that opened the panel — not lost to <body> (explicit acceptance
  // criterion, same discipline as the transcript modal).
  pdFocusReturn?.focus?.();
  pdFocusReturn = null;
}

export function pdKeydown(e){
  if (e.key === 'Escape'){ e.preventDefault(); pdClose(); return; }
  if (e.key === 'Tab'){
    const drawer = $('pdrawer');
    if (!drawer) return;
    const focusables = [...drawer.querySelectorAll('a[href],button,[tabindex]')]
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

export function installProjectDrilldown(){
  $('pdclose')?.addEventListener('click', pdClose);
  $('pdscrim')?.addEventListener('click', pdClose);
}

// P4-08 (#45): weighting toggle wiring. A real radiogroup of <button>s
// (native tab order + :focus-visible, same discipline as the P4-06
// legend) rather than a <select>, so the four options are always visible
// at once instead of hidden behind a dropdown.
export function installProjWeight(){
  const group = $('projweight');
  if (!group) return;
  group.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      PROJ_WEIGHT = btn.dataset.w;
      localStorage.setItem('hermes-dash-projweight', PROJ_WEIGHT);
      group.querySelectorAll('button').forEach(b => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      render();
    });
  });
  // Reflect the persisted choice in the UI on load, in case it was
  // restored from localStorage as something other than the HTML default.
  group.querySelectorAll('button').forEach(b => {
    const on = b.dataset.w === PROJ_WEIGHT;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// P4-09 (#46): project cross-filter. Populates the <select> from whatever
// projects actually exist in the CURRENT profile's rows (no hardcoded
// list — same discipline as the matrix's axes), syncs the visible chip on
// every view the filter affects, and drives the hash so the filter is
// deep-linkable and survives reload.
export const PROJ_FILTER_VIEWS = new Set(['Usage', 'Cost', 'Flow', 'Health']);

export function populateProjFilterSelect(){
  const sel = $('projfiltersel');
  if (!sel) return;
  const p = DATA.profiles[current];
  if (!p) return;
  const projects = [...new Set(p.rows.map(r => r.project || 'Unattributed'))]
    .sort((a, b) => a === 'Unattributed' ? 1 : b === 'Unattributed' ? -1 : a.localeCompare(b));
  const prevValue = sel.value;
  sel.innerHTML = '<option value="">All projects</option>' +
    projects.map(pr => `<option value="${esc(pr)}">${esc(pr)}</option>`).join('');
  // Keep the current filter selected across a profile switch when that
  // project also exists in the new profile; otherwise fall back cleanly to
  // "All projects" rather than pointing at an option that no longer exists.
  sel.value = projects.includes(PROJECT_FILTER) ? PROJECT_FILTER : (projects.includes(prevValue) ? prevValue : '');
  if (sel.value !== PROJECT_FILTER) setCrossFilter('project', sel.value);
}

// Provider + model selects (#130): options come from the CURRENT profile's row
// values, so the list can never offer a slot or model that matches nothing —
// the same reason the project list is derived rather than hardcoded.
export function populateRowFilterSelects(){
  const p = DATA.profiles[current];
  if (!p) return;
  const fill = (id, vals, all, keep) => {
    const sel = $(id);
    if (!sel) return '';
    sel.innerHTML = `<option value="">${all}</option>` +
      vals.map(v => `<option value="${escA(v)}">${esc(v)}</option>`).join('');
    // The FILTER STATE decides, never the widget's own previous value. Falling
    // back to the stale select resurrected a filter that had just been cleared:
    // press Back to an unfiltered URL and hashchange resets the state, but the
    // select still held the old value, so the next render put the filter back on
    // while the URL said otherwise. Keeping a choice across a profile switch is
    // the state's job — it survives, and it is what `keep` already is.
    sel.value = vals.includes(keep) ? keep : '';
    return sel.value;
  };
  const rows = p.rows || [];
  // Through the setter: these names are imported bindings, and assigning to one
  // throws outside the inlined page (see router.js setCrossFilter).
  setCrossFilter('provider', fill('provfiltersel',
    [...new Set(rows.map(r => r.provider || ''))].filter(Boolean).sort(), 'All providers', PROVIDER_FILTER));
  setCrossFilter('model', fill('modelfiltersel',
    [...new Set(rows.map(r => r.model).filter(Boolean))].sort(), 'All models', MODEL_FILTER));
}

// Reflects the three cross-filters into their selects + the chip on every view
// they affect, and hides the chip everywhere else — a silent filter is exactly
// the bug this bar exists to prevent.
export function syncProjFilterUI(){
  const sel = $('projfiltersel'), chip = $('projfilterchip'), name = $('projfilterchipname');
  if (sel && sel.value !== PROJECT_FILTER) sel.value = PROJECT_FILTER;
  const psel = $('provfiltersel'), msel = $('modelfiltersel');
  if (psel && psel.value !== PROVIDER_FILTER) psel.value = PROVIDER_FILTER;
  if (msel && msel.value !== MODEL_FILTER) msel.value = MODEL_FILTER;
  if (!chip || !name) return;
  const active = [PROJECT_FILTER, PROVIDER_FILTER, MODEL_FILTER].filter(Boolean);
  const showChip = active.length > 0 && PROJ_FILTER_VIEWS.has(view);
  chip.hidden = !showChip;
  chip.style.display = showChip ? 'inline-flex' : 'none';
  if (showChip) name.textContent = active.join(' \u00b7 ');
}

export function installProjFilter(){
  const sel = $('projfiltersel');
  if (sel) sel.addEventListener('change', () => {
    setCrossFilter('project', sel.value);
    setHash(view);
    syncProjFilterUI();
    render();
  });
  // Provider and model behave identically to project: write the state, push it
  // into the hash so the view stays shareable, re-sync the bar, re-render.
  const prov = $('provfiltersel');
  if (prov) prov.addEventListener('change', () => {
    setCrossFilter('provider', prov.value);
    setHash(view);
    syncProjFilterUI();
    render();
  });
  const mdl = $('modelfiltersel');
  if (mdl) mdl.addEventListener('change', () => {
    setCrossFilter('model', mdl.value);
    setHash(view);
    syncProjFilterUI();
    render();
  });
  $('projfilterclear')?.addEventListener('click', () => {
    clearCrossFilters();
    if (sel) sel.value = '';
    if (prov) prov.value = '';
    if (mdl) mdl.value = '';
    setHash(view);
    syncProjFilterUI();
    render();
  });
}

// P4-06 (#43): project × provider distribution — a stacked horizontal bar
// per project. Reuses PROV/provOf/provIcon exactly as every other view
// does; introduces no second provider palette (explicit acceptance
// criterion).
export function renderProjectDistribution(rows){
  const card = $('projdistcard'), empty = $('projdistempty');
  if (!card) return;
  if (!rows || !rows.length){
    const el = $('cProjDist');
    const prev = el && (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
    if (prev) { try { prev.destroy(); } catch(_){} }
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const wl = PROJ_WEIGHT_LABELS[PROJ_WEIGHT];

  // project -> provider -> [rows]. Grouped by raw rows (not a running sum)
  // for the same reason as the matrix: "sessions" weighting needs the
  // distinct session_id count per bucket. Both axes entirely derived from
  // the row set, same discipline as renderProjectMatrix — no hardcoded
  // project or provider list.
  const byProject = new Map();
  const providersSeen = new Set();
  rows.forEach(r => {
    const proj = r.project || 'Unattributed';
    const prov = provOf(r.provider, r.model, r.base_url);
    if (!byProject.has(proj)) byProject.set(proj, new Map());
    const provs = byProject.get(proj);
    if (!provs.has(prov)) provs.set(prov, []);
    provs.get(prov).push(r);
    providersSeen.add(prov);
  });

  const projectTotal = proj => weightValue([...byProject.get(proj).values()].flat());
  const projects = [...byProject.keys()].sort((a, b) => {
    if (a === 'Unattributed') return 1;
    if (b === 'Unattributed') return -1;
    return projectTotal(b) - projectTotal(a);
  });

  // Provider stacking order: by GLOBAL provider total descending, so the
  // segment order is consistent across every project's bar.
  const provTotal = p => weightValue(projects.flatMap(proj => byProject.get(proj).get(p) || []));
  const providers = [...providersSeen].sort((a, b) => provTotal(b) - provTotal(a));

  const datasets = providers.map(p => {
    const s = PROV[p] || {icon: '\u25CB', bg: 'rgba(148,163,184,.14)', fg: MU};
    return {
      label: `${s.icon} ${p}`,
      data: projects.map(proj => {
        const raw = weightValue(byProject.get(proj).get(p) || []);
        if (!projDistNormalized) return raw;
        const total = projectTotal(proj);
        // Normalised mode: every bar becomes exactly 100 wide — the
        // ticket's own acceptance criterion, asserted by the test as
        // "every bar sums to 100 (within floating-point tolerance)".
        return total > 0 ? (100 * raw / total) : 0;
      }),
      backgroundColor: s.fg,
      stack: 'proj',
    };
  });

  mk('cProjDist', 'bar', projects, datasets, {
    indexAxis: 'y',
    plugins: {
      legend: {
        labels: {boxWidth: 8},
        // Chart.js's default legend markers are canvas-drawn and not
        // individually keyboard-focusable. This dashboard already treats
        // "no keyboard access to a legend" as a defect (see the
        // #focus-visible convention on other interactive controls) — the
        // acceptance criterion here is a REAL <ul> legend the browser's
        // own tab order and :focus-visible ring handle for free, laid out
        // to look like the chart legend. generateLegend() below builds it;
        // this onClick still supports mouse/pointer toggling for parity.
        onClick: (e, item, legend) => {
          const ci = legend.chart;
          const idx = item.datasetIndex;
          ci.setDatasetVisibility(idx, !ci.isDatasetVisible(idx));
          ci.update();
        },
      },
      tooltip: {mode: 'index', intersect: true},
    },
    scales: {
      x: {stacked: true, grid: {color: BD}, beginAtZero: true,
          max: projDistNormalized ? 100 : undefined,
          title: {display: true, text: projDistNormalized ? '% of project total' : wl.axis, color: MU, font: {size: 10}}},
      y: {stacked: true, grid: {display: false}},
    },
  });

  renderProjDistLegend(datasets);
}

// A real, keyboard-reachable <ul> legend (see the comment above). Built as
// actual focusable <button> elements with a visible :focus-visible ring
// from the shared stylesheet, rather than relying on Chart.js's
// canvas-drawn (mouse-only) legend.
export function renderProjDistLegend(datasets){
  const el = $('projdistlegend');
  if (!el) return;
  el.innerHTML = datasets.map((d, i) =>
    `<button type="button" class="proj-legend-item inline-flex items-center gap-1.5 px-2 py-1 rounded text-[length:var(--fs-xs)]"
       data-idx="${i}" style="border:1px solid ${BD}">
      <span style="width:8px;height:8px;border-radius:2px;background:${d.backgroundColor};display:inline-block"></span>
      ${esc(d.label)}
     </button>`).join('');
  el.querySelectorAll('.proj-legend-item').forEach(btn => {
    btn.onclick = () => {
      const chart = Chart.getChart($('cProjDist'));
      if (!chart) return;
      const idx = +btn.dataset.idx;
      chart.setDatasetVisibility(idx, !chart.isDatasetVisible(idx));
      chart.update();
      btn.setAttribute('aria-pressed', String(chart.isDatasetVisible(idx)));
    };
    btn.setAttribute('aria-pressed', 'true');
  });
}

// P4-10 (#47): one line/area series per project over the selected range,
// driven by the SAME weightValue() as the matrix (P4-05) and provider bars
// (P4-06) via PROJ_WEIGHT (P4-08) — the trend can't disagree with the
// other two charts about its unit because it calls the identical function.
export const PROJ_TREND_TOP_N = 6;
export function renderProjectTrend(rows){
  const card = $('projtrendcard'), empty = $('projtrendempty');
  if (!card) return;
  if (!rows || !rows.length){
    const el = $('cProjTrend');
    const prev = el && (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
    if (prev) { try { prev.destroy(); } catch(_){} }
    if ($('projtrendlegend')) $('projtrendlegend').innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const wl = PROJ_WEIGHT_LABELS[PROJ_WEIGHT];

  // date -> project -> [rows]. No hardcoded project/date list; both axes
  // come entirely from the row set, same discipline as the matrix.
  const days = [...new Set(rows.map(r => r.date))].sort();
  const byProjDate = new Map();
  const projTotals = new Map();
  rows.forEach(r => {
    const proj = r.project || 'Unattributed';
    if (!byProjDate.has(proj)) byProjDate.set(proj, new Map());
    const byDate = byProjDate.get(proj);
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  });
  byProjDate.forEach((byDate, proj) => {
    projTotals.set(proj, weightValue([...byDate.values()].flat()));
  });

  // Top-N cap by TOTAL weight over the range, rest folded into an explicit
  // "Other" series rather than silently dropped — 12+ series is an
  // unreadable chart (the ticket's own explicit reasoning), but every
  // project must still be represented somewhere in the total.
  const allProjects = [...byProjDate.keys()].sort((a, b) => {
    if (a === 'Unattributed') return 1;
    if (b === 'Unattributed') return -1;
    return projTotals.get(b) - projTotals.get(a);
  });
  const shown = allProjects.slice(0, PROJ_TREND_TOP_N);
  const rest = allProjects.slice(PROJ_TREND_TOP_N);

  function seriesFor(proj){
    return days.map(d => weightValue(byProjDate.get(proj).get(d) || []));
  }

  // colorOf() is keyed for MODEL names elsewhere in the dashboard; reusing
  // it here for project names still yields a stable, distinct hue per
  // label (it hashes the string), which is all a project-trend legend
  // needs — no second color system invented.
  const colorForProject = proj => proj === 'Unattributed' ? MU : colorOf(proj);

  const rawSeries = shown.map(proj => ({ label: proj, data: seriesFor(proj), color: colorForProject(proj) }));
  if (rest.length){
    const restData = days.map(d => weightValue(rest.flatMap(p => byProjDate.get(p).get(d) || [])));
    rawSeries.push({ label: `Other (+${rest.length})`, data: restData, color: MU });
  }

  // Stacked mode: each day's series becomes a % share of that day's total
  // across ALL shown+Other series (not the global grand total), so a
  // sparse early day still reads as "100% of what happened that day".
  const dayTotals = days.map((_, i) => rawSeries.reduce((s, ser) => s + ser.data[i], 0));
  const datasets = rawSeries.map(ser => ({
    label: ser.label,
    data: projTrendStacked
      ? ser.data.map((v, i) => dayTotals[i] > 0 ? (100 * v / dayTotals[i]) : 0)
      : ser.data,
    borderColor: ser.color,
    backgroundColor: ser.color + (projTrendStacked ? '' : '33'),
    fill: projTrendStacked ? true : 'origin',
    stack: projTrendStacked ? 'proj' : undefined,
    tension: 0.25,
    pointRadius: 0,
    borderWidth: 1.5,
  }));

  mk('cProjTrend', 'line', days, datasets, {
    plugins: {
      legend: { display: false }, // custom keyboard-operable legend below, same pattern as P4-06
    },
    scales: {
      x: {stacked: projTrendStacked, grid: {display: false}},
      y: {stacked: projTrendStacked, grid: {color: BD}, beginAtZero: true,
          max: projTrendStacked ? 100 : undefined,
          title: {display: true, text: projTrendStacked ? '% of day total' : wl.axis, color: MU, font: {size: 10}}},
    },
  });

  renderProjTrendLegend(datasets);
}

export function renderProjTrendLegend(datasets){
  const el = $('projtrendlegend');
  if (!el) return;
  el.innerHTML = datasets.map((d, i) =>
    `<button type="button" class="proj-legend-item inline-flex items-center gap-1.5 px-2 py-1 rounded text-[length:var(--fs-xs)]"
       data-idx="${i}" style="border:1px solid ${BD}">
      <span style="width:8px;height:8px;border-radius:2px;background:${d.borderColor};display:inline-block"></span>
      ${esc(d.label)}
     </button>`).join('');
  el.querySelectorAll('.proj-legend-item').forEach(btn => {
    btn.onclick = () => {
      const chart = Chart.getChart($('cProjTrend'));
      if (!chart) return;
      const idx = +btn.dataset.idx;
      chart.setDatasetVisibility(idx, !chart.isDatasetVisible(idx));
      chart.update();
      btn.setAttribute('aria-pressed', String(chart.isDatasetVisible(idx)));
    };
    btn.setAttribute('aria-pressed', 'true');
  });
}

export const FKIND = {
  rate_limit:  {c:'#f59e0b', t:'throttled'},
  overloaded:  {c:'#fb923c', t:'overloaded'},
  timeout:     {c:'#60a5fa', t:'timeout'},
  auth:        {c:'#ef4444', t:'auth'},
  server_error:{c:'#a855f7', t:'5xx'},
  // Slate-blue, NOT grey: grey sat on top of the empty-track colour and made a
  // fully-unavailable model look like a model with no data at all. Also kept
  // clear of server_error's purple.
  unavailable: {c:'#64b5c9', t:'unavailable'},
  tool:        {c:'#818cf8', t:'tool'}
};

// Emit the .k-* chip rules from FKIND so the drawer cannot drift from the
// Health tab again. Runs once at boot, before the first drawer render.
export function installKindCSS(){
  const st = document.createElement('style');
  st.textContent = Object.entries(FKIND).map(([k, v]) =>
    `.k-${k}{background:${v.c}2e;color:${v.c}}`).join('\n');
  document.head.appendChild(st);
}
// Called HERE, not at the top of the script: FKIND is a const, so calling this
// before its declaration would throw a temporal-dead-zone ReferenceError and
// kill the whole page script.
installKindCSS();
export const fk = k => FKIND[k] || {c:MU, t:k||'—'};
// Track colour for a row where EVERY call failed. The segments already paint
// the bar, but 'unavailable' grey sat so close to the empty-track grey that a
// 100%-failure row was indistinguishable from a row with no data. A red wash
// behind it makes total failure read as failure at a glance.
export const FAILTRACK = 'rgba(239,68,68,.22)';
// Green above 95%, amber 80-95, red below: matches how you would triage it.
export const rateColor = r => r===null ? MU : r>=95 ? '#22c55e' : r>=80 ? '#f59e0b' : '#ef4444';

// Delegation outcomes (#90). Two sources of truth live side by side here and
// must never merge: the per-child rates are MEASURED by the runtime, while the
// tool failure rates elsewhere in this dashboard are inferred from message
// text. The panel says "measured" out loud for that reason.
export function renderDeleg(){
  const card = $('delegcard');
  if (!card) return;
  const p = DATA.profiles[current] || {};
  const g = p.delegations || null;
  if (!g || !g.children){ card.hidden = true; return; }
  card.hidden = false;

  // Headline: the three numbers that change a decision — how many children
  // ran, what share came back clean, and how much wall-clock the rest burned.
  const bad = g.children - g.ok;
  $('delegkpi').innerHTML = `
    <div class="dkpi"><span class="dkpi-n">${g.children}</span><span class="lbl">children</span></div>
    <div class="dkpi"><span class="dkpi-n ${g.rate >= 95 ? 'ok' : 'bad'}">${g.rate}%</span><span class="lbl">completed</span></div>
    <div class="dkpi"><span class="dkpi-n ${bad ? 'bad' : ''}">${g.wasted_hours}h</span><span class="lbl">burned on failures</span></div>
    <div class="dkpi"><span class="dkpi-n">${money(g.cost_usd)}</span><span class="lbl">child spend</span></div>`;

  // Per model: this is the routing decision. A model that finishes 56% of the
  // work it is handed is not cheaper than one that finishes 100%, whatever its
  // per-token price says.
  const rows = (g.by_model || []).map(m => {
    const w = Math.max(0, Math.min(100, m.rate));
    return `<div class="drow">
      <div class="dname" title="${esc(m.model)}">${esc(short(m.model))}</div>
      <div class="dbar"><span style="width:${w}%" class="${m.rate >= 95 ? 'ok' : 'bad'}"></span></div>
      <div class="dpct ${m.rate >= 95 ? 'ok' : 'bad'}">${m.rate}%</div>
      <div class="dmeta muted">${m.n} run${m.n === 1 ? '' : 's'}${m.wasted_hours ? ` · ${m.wasted_hours}h lost` : ''}</div>
    </div>`;
  }).join('');
  $('delegmodels').innerHTML = rows || '<div class="muted text-[length:var(--fs-xs)]">No child runs.</div>';

  // Why they failed. Counts only — the reasons come from the runtime's own
  // failure_reason field, so no guessing about what "rate_limit" means.
  const rs = Object.entries(g.reasons || {});
  $('delegreasons').innerHTML = rs.length
    ? rs.map(([k, v]) => `<span class="chip" style="text-transform:none">${esc(k)} <b>${v}</b></span>`).join('')
    : '<span class="muted text-[length:var(--fs-xs)]">No failures in range.</span>';

  // Measured tool outcomes from inside delegated runs.
  const tl = (g.tools || []).slice(0, 8);
  $('delegtools').innerHTML = tl.length
    ? tl.map(t => `<div class="drow">
        <div class="dname">${esc(t.tool)}</div>
        <div class="dbar"><span style="width:${Math.max(0, Math.min(100, t.rate))}%" class="${t.rate >= 95 ? 'ok' : 'bad'}"></span></div>
        <div class="dpct ${t.rate >= 95 ? 'ok' : 'bad'}">${t.rate}%</div>
        <div class="dmeta muted">${t.calls} call${t.calls === 1 ? '' : 's'}${t.fail ? ` · ${t.fail} failed` : ''}</div>
      </div>`).join('')
    : '<div class="muted text-[length:var(--fs-xs)]">No tool calls recorded.</div>';

  // Recent runs, newest first. Goal text is set with textContent by esc() —
  // it is model-authored and must never be interpolated as markup.
  const rec = (g.recent || []).slice(0, 12);
  $('deleglist').innerHTML = rec.map(r => {
    const okc = r.status === 'completed';
    const why = r.failure_reason || r.exit_reason || r.status;
    return `<div class="ditem">
      <span class="ddot ${okc ? 'ok' : 'bad'}"></span>
      <div class="dgoal" title="${esc(r.goal || '')}">${esc(r.goal || '(no goal recorded)')}</div>
      <div class="muted text-[length:var(--fs-xs)]">${esc(short(r.model || ''))} · ${ago(r.seconds)}${okc ? '' : ' · ' + esc(why)}</div>
    </div>`;
  }).join('') || '<div class="muted text-[length:var(--fs-xs)]">Nothing yet.</div>';
}

export function renderHealth(rows){
  const p = DATA.profiles[current] || {};
  let H = (p.health||[]).filter(h => h.total > 0);
  // P4-09 (#46): the project filter narrows Health to the MODELS the
  // filtered project actually used. Per-model success/failure RATES stay
  // global (failures.py's errors.log has no project dimension to slice by
  // — inventing a per-project failure count from data that doesn't carry
  // it would be a worse lie than not filtering at all), but which rows
  // appear is honestly scoped to "models this project touched".
  if (PROJECT_FILTER && rows){
    const modelsUsed = new Set(rows.map(r => r.model));
    H = H.filter(h => modelsUsed.has(h.model));
  }
  renderHealthSummary(H, p.failures_recent || []);
  const box = $('healthgrid');
  if(!box) return;
  if(!H.length){
    box.innerHTML = PROJECT_FILTER
      ? `<div class="muted text-[length:var(--fs-sm)]">No calls recorded for "${esc(PROJECT_FILTER)}" in this range.</div>`
      : '<div class="muted text-[length:var(--fs-sm)]">No calls recorded.</div>';
  }
  else {
    box.innerHTML = H.slice(0,14).map(h=>{
      const r = h.rate;
      const col = rateColor(r);
      // A 0% on one call and a 0% on a thousand are different claims; fade
      // the thin ones so they do not read as outages.
      const thin = h.total < 5;
      // stacked bar: green success, then one segment per failure kind
      const segs = Object.entries(h.kinds||{}).map(([k,v])=>
        `<div title="${fk(k).t}: ${v}" style="width:${(v/h.total*100).toFixed(2)}%;background:${fk(k).c}"></div>`).join('');
      const okPct = (h.ok/h.total*100).toFixed(2);
      const chips = Object.entries(h.kinds||{}).sort((a,b)=>b[1]-a[1]).slice(0,3)
        .map(([k,v])=>`<span class="text-[length:var(--fs-xs)] px-1 rounded" style="background:${fk(k).c}22;color:${fk(k).c}">${fk(k).t} ${v}</span>`).join(' ');
      // "236 ok / 27" read as "236 out of 27". Say what each number is.
      const count = h.fail
        ? `${h.ok.toLocaleString()} of ${h.total.toLocaleString()} · <span style="color:${col}">${h.fail.toLocaleString()} failed</span>`
        : `${h.ok.toLocaleString()} of ${h.total.toLocaleString()}`;
      return `<div class="flex items-center gap-2.5 hrow${thin?' hthin':''}" title="${thin?'Fewer than 5 calls — too few to judge':''}">
        <div class="hname text-[length:var(--fs-md)] font-semibold truncate" style="width:172px;color:${colorOf(short(h.model))}" title="${short(h.model)}">${short(h.model)}</div>
        <div class="hbar flex-1 flex h-[9px] rounded overflow-hidden" style="background:${h.fail===h.total ? FAILTRACK : BD}">
          <div style="width:${okPct}%;background:#22c55e"></div>${segs}
        </div>
        <div class="hrate text-[length:var(--fs-xs)] font-semibold text-right" style="width:52px;color:${col}">${r===null?'—':r+'%'}</div>
        <div class="hcount text-[length:var(--fs-xs)] muted text-right" style="width:150px">${count}</div>
        <div class="hchips flex gap-1 shrink-0 flex-wrap" style="width:170px">${chips}</div>
      </div>`;
    }).join('');
  }

  // Recent failures: individual events, filterable by kind and by model. The
  // filter state lives outside renderHealth so a data refresh does not reset
  // the view the user is currently reading.
  renderFailures(p.failures_recent || []);
  renderLifecycle(p.compression_pressure || []);
  renderOutcomes(p.outcomes);
  renderToolReliability(p.tools, p.terminal_top_fail_commands);
}

// P9-04 (#81): compression-pressure sessions. end_reason breakdown moved to
// renderOutcomes (#91) — kept as a SEPARATE function/card rather than
// merged in, since pressure and outcome are independent axes (a session
// can end cleanly and still have fought its context window the whole
// time, per the comment that already lived here).
export function renderLifecycle(pressure){
  const card = $('lifecard');
  if (!card) return;
  const hasPressure = pressure.length > 0;
  if (!hasPressure){ card.hidden = true; return; }
  card.hidden = false;

  $('lifereasons').innerHTML = '';
  $('lifepressure').innerHTML =
    `<div class="muted text-[length:var(--fs-xs)] mb-1">Compression pressure — ${pressure.length} session(s)</div>` +
    pressure.slice(0,20).map(s => {
      const bits = [];
      if (s.fallback_streak > 0) bits.push(`fallback streak ${s.fallback_streak}`);
      if (s.ineffective_count > 0) bits.push(`${s.ineffective_count} ineffective`);
      return `<div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-0.5">
        <span class="truncate flex-1" title="${esc(s.id)}">${esc(s.title)}</span>
        <span class="muted">${bits.map(esc).join(' · ')}</span>
        ${s.error ? `<span style="color:#ef4444" title="${esc(s.error)}">error</span>` : ''}
      </div>` +
      (s.error ? `<div class="text-[length:var(--fs-xs)] muted pl-1" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${esc(s.error)}</div>` : '');
    }).join('');
}

// P10-03 (#91): session outcomes — end_reason breakdown, source-split,
// orphan reaps as their own KPI, and a "silent" bucket for NULL end_reason
// sessions that is NEVER folded into an "ok"/normal count (the whole point
// of the ticket is to surface the ones that died without saying why).
export const OUTCOME_ABNORMAL = new Set(['(none)', 'startup_orphan_reap', 'ws_orphan_reap']);
export const OUTCOME_LABELS = { '(none)': 'Ended silently', 'startup_orphan_reap': 'Reaped (startup)',
  'ws_orphan_reap': 'Reaped (websocket)' };
export function renderOutcomes(outcomes){
  const card = $('outcard');
  if (!card) return;
  const o = outcomes || {};
  const byReason = o.by_reason || {};
  const total = Object.values(byReason).reduce((a,n)=>a+n,0);
  const reapedN = (o.reaped || []).length;
  const silentN = (o.silent || []).length;
  if (!total){ card.hidden = true; return; }
  card.hidden = false;

  const kpi = (v, l, col) => `<div class="dkpi"><div class="dkv" style="${col?`color:${col}`:''}">${v}</div><div class="dkl">${l}</div></div>`;
  $('outkpis').innerHTML =
    kpi(total.toLocaleString(), 'Sessions ended · 30d', '') +
    kpi(reapedN.toLocaleString(), 'Orphan reaps', reapedN ? '#ef4444' : '#22c55e') +
    kpi(silentN.toLocaleString(), 'Ended silently', silentN ? '#f59e0b' : '#22c55e') +
    kpi(total ? (100*(total-reapedN-silentN)/total).toFixed(1)+'%' : '\u2014', 'Ended cleanly', '');

  // Source-split: a cron session ending as anything other than
  // cron_complete is the alarm this ticket exists to surface, so every
  // source's OWN reason mix is shown, not just a global rollup.
  const bySource = o.by_source_reason || {};
  $('outbysource').innerHTML = Object.entries(bySource).map(([src, reasons]) => {
    const srcTotal = Object.values(reasons).reduce((a,n)=>a+n,0);
    const chips = Object.entries(reasons).sort((a,b)=>b[1]-a[1]).map(([reason,n]) => {
      const abnormal = OUTCOME_ABNORMAL.has(reason);
      const label = OUTCOME_LABELS[reason] || reason;
      return `<span class="text-[length:var(--fs-xs)] px-2 py-1 rounded" style="${
        abnormal
          ? 'background:#ef444422;color:#ef4444;border:1px solid #ef444455'
          : 'background:var(--bg);color:var(--muted);border:1px solid var(--border)'
      }" title="${esc(reason)}: ${n} session(s)">${abnormal ? '&#9888; ' : ''}${esc(label)} <b>${n}</b></span>`;
    }).join(' ');
    return `<div class="flex items-center gap-2 flex-wrap text-[length:var(--fs-xs)]">
      <span class="font-semibold" style="min-width:5rem">${esc(src)} <span class="muted">(${srcTotal})</span></span>
      ${chips}
    </div>`;
  }).join('');

  // Orphan-reap trend line: a text sparkline is enough here (no new canvas
  // chart needed for a card this focused) — a run of days all showing
  // reaps is the signal, and a plain list makes that visible without
  // pulling in Chart.js scale machinery for one line.
  const trend = o.reap_trend || [];
  $('outreaptrend').innerHTML = trend.length
    ? `<div class="muted text-[length:var(--fs-xs)] mb-1">Orphan reaps per day</div>` +
      `<div class="flex flex-wrap gap-1">` + trend.map(t =>
        `<span class="text-[length:var(--fs-xs)] px-1.5 py-0.5 rounded" style="background:#ef444422;color:#ef4444;border:1px solid #ef444455" title="${esc(t.date)}">${esc(t.date.slice(5))}: ${t.n}</span>`
      ).join('') + `</div>`
    : '';

  $('outsilentlist').innerHTML = silentN
    ? `<div class="muted text-[length:var(--fs-xs)] mb-1">Ended silently — ${silentN} session(s)</div>` +
      (o.silent || []).slice(0,20).map(s =>
        `<div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-0.5">
          <button type="button" class="chip lntimelinebtn truncate flex-1" style="text-align:left" data-tsession="${esc(s.id)}" data-tprofile="${esc(current)}" data-title="${esc(s.title)}" title="${esc(s.title)} — view timeline">${esc(s.title)}</button>
          <span class="muted">${esc(s.source)} \u00b7 ${esc(s.model || '')}</span>
        </div>`).join('')
    : '';
}

// P10-04 (#92): tool reliability — fail rate per tool, trend vs the prior
// 30-day window, cost of failures in wasted tokens, and the actual failing
// terminal commands. Classification of ok/fail/unknown happens server-side
// (tool_outcomes.py) from structured signals only; this function only
// renders the aggregate the collector already computed — it does not
// re-derive pass/fail from result text.
export function renderToolReliability(tools, cmds){
  const card = $('toolcard');
  if (!card) return;
  const list = tools || [];
  if (!list.length){ card.hidden = true; return; }
  card.hidden = false;

  const trendArrow = (t) => {
    if (t.prev_fail_rate == null || t.fail_rate == null) return '';
    const delta = t.fail_rate - t.prev_fail_rate;
    if (Math.abs(delta) < 0.01) return '<span class="muted">\u2192</span>';
    const up = delta > 0;
    return `<span style="color:${up ? '#ef4444' : '#22c55e'}" title="was ${(t.prev_fail_rate*100).toFixed(1)}% in the prior 30 days">${up ? '\u2191' : '\u2193'}</span>`;
  };

  $('toolrows').innerHTML = list.map(t => {
    const rateText = t.fail_rate == null ? '<span class="muted">no confident calls</span>' : `${(t.fail_rate*100).toFixed(1)}%`;
    const rateColor = t.fail_rate == null ? '' : (t.fail_rate >= 0.2 ? '#ef4444' : t.fail_rate > 0 ? '#f59e0b' : '#22c55e');
    return `<div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
      <span class="font-semibold flex-1">${esc(t.name)}</span>
      <span class="muted">${t.calls.toLocaleString()} calls</span>
      <span style="${rateColor?`color:${rateColor}`:''};min-width:3.5rem;text-align:right">${rateText}</span>
      ${trendArrow(t)}
      <span class="muted" title="tokens consumed by failing results" style="min-width:5rem;text-align:right">${t.tok_wasted ? t.tok_wasted.toLocaleString()+' tok wasted' : ''}</span>
    </div>`;
  }).join('');

  const cmdList = cmds || [];
  $('toolcmds').innerHTML = cmdList.length
    ? `<div class="muted text-[length:var(--fs-xs)] mb-1">Top failing terminal commands</div>` +
      `<div class="flex flex-wrap gap-1">` + cmdList.map(c =>
        `<span class="text-[length:var(--fs-xs)] px-2 py-1 rounded" style="background:#ef444422;color:#ef4444;border:1px solid #ef444455">${esc(c.cmd)} <b>${c.n}</b></span>`
      ).join('') + `</div>`
    : '';
}


// Headline strip: the three numbers that answer "is anything wrong" before
// any chart is read. Computed from the same rows the grid shows.
export function renderHealthSummary(H, F){
  const el = $('hsummary'); if (!el) return;
  const tot = H.reduce((a,h)=>a+h.total,0), ok = H.reduce((a,h)=>a+h.ok,0);
  const rate = tot ? +(ok/tot*100).toFixed(1) : null;
  const failing = H.filter(h => h.fail > 0);
  // "Worst" needs enough calls to mean something; otherwise one 0/1 wins.
  const judged = failing.filter(h => h.total >= 5).sort((a,b)=>(a.rate??101)-(b.rate??101));
  const worst = judged[0];
  const card = (v, l, col, sub, ico) => `<div class="card hsumc"><div class="kpi-badge" style="background:color-mix(in srgb,${col||MU} 14%,var(--card));color:${col||MU};box-shadow:inset 0 0 0 1px color-mix(in srgb,${col||MU} 30%,transparent)"><span class="kpi-icon" aria-hidden="true">${ico}</span></div>
    <div class="hsumv" style="${col?`color:${col}`:''}">${v}</div>
    <div class="hsuml">${l}</div>${sub?`<div class="muted hsums">${sub}</div>`:''}</div>`;
  el.innerHTML =
    card(rate===null?'—':rate+'%', 'Overall success', rate===null?'':rateColor(rate), `${ok.toLocaleString()} of ${tot.toLocaleString()} calls`, icon('check')) +
    card(F.length.toLocaleString(), 'Failures · last 7 days', F.length?'#ef4444':'#22c55e', F.length?`${groupFailures(F).length} distinct errors`:'none recorded', icon('alert')) +
    card(`${failing.length} <span class="muted" style="font-size:var(--fs-md)">of ${H.length}</span>`, 'Models with failures', PAL[3], '', icon('layers')) +
    card(worst ? short(worst.model) : '—', 'Least reliable (≥5 calls)', worst ? colorOf(short(worst.model)) : MU,
      worst ? `${worst.rate}% · ${worst.fail.toLocaleString()} failed` : 'nothing below 100%', icon('target'));
}

// Same model + kind + message (with run-specific ids stripped) is one
// problem, not N. Raw rows repeated the same 524 seven times.
export function failMsgClean(m){
  m = String(m||'');
  // Cloudflare error pages arrive as a JSON blob; the title is the message.
  const t = m.match(/"title"\s*:\s*"([^"]+)"/);
  const code = m.match(/^HTTP (\d{3})/);
  if (t) return (code ? `HTTP ${code[1]} · ` : '') + t[1];
  return m.replace(/\bthread=\S+/g, '')
          .replace(/\bprompt-turn-[\w:.-]+/g, '')
          .replace(/\s{2,}/g, ' ').trim();
}
export function groupFailures(F){
  const g = new Map();
  F.forEach(f => {
    const msg = failMsgClean(f.msg);
    const key = short(f.model) + '|' + f.kind + '|' + msg;
    const e = g.get(key);
    if (e) { e.n++; if ((f.when||'') > e.last) e.last = f.when||''; if ((f.when||'') < e.first) e.first = f.when||''; }
    else g.set(key, {model:f.model, kind:f.kind, msg, raw:f.msg||'', n:1, first:f.when||'', last:f.when||''});
  });
  return [...g.values()].sort((a,b)=> b.last.localeCompare(a.last));
}

export let failKind = 'all', failModel = 'all';

export function renderFailures(F){
  const fl = $('faillist'), ff = $('failfilters'), fc = $('failcount');
  if (!fl) return;

  // A filter for a kind that never happened is noise — build from the data.
  const kinds = {}, models = {};
  F.forEach(f => {
    kinds[f.kind] = (kinds[f.kind] || 0) + 1;
    models[short(f.model)] = (models[short(f.model)] || 0) + 1;
  });
  // Drop a stale selection when that kind/model vanished from the payload.
  if (failKind !== 'all' && !kinds[failKind]) failKind = 'all';
  if (failModel !== 'all' && !models[failModel]) failModel = 'all';

  if (ff){
    const kc = Object.entries(kinds).sort((a,b)=>b[1]-a[1]);
    const mc = Object.entries(models).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const chip = (act, val, label, col, n) =>
      `<button class="fchip${act?' on':''}" data-${val}="${label}"
        style="${act&&col?`border-color:${col};color:${col}`:''}">${label}${
        n!==undefined?` <span class="muted">${n}</span>`:''}</button>`;
    // Two labelled rows: kind and model were one run-on line of chips with
    // only a hairline between them.
    ff.innerHTML =
      `<div class="ffrow"><span class="fflbl">Kind</span>` +
        chip(failKind==='all','fk','all',AC,F.length) +
        kc.map(([k,n])=>chip(failKind===k,'fk',k,fk(k).c,n)).join('') + `</div>` +
      (mc.length > 1
        ? `<div class="ffrow"><span class="fflbl">Model</span>` +
          chip(failModel==='all','fm','all models') +
          mc.map(([m,n])=>chip(failModel===m,'fm',m,colorOf(m),n)).join('') + `</div>`
        : '');
    ff.querySelectorAll('[data-fk]').forEach(b => b.onclick = () => {
      failKind = b.dataset.fk; renderFailures(F);
    });
    ff.querySelectorAll('[data-fm]').forEach(b => b.onclick = () => {
      failModel = b.dataset.fm === 'all models' ? 'all' : b.dataset.fm;
      renderFailures(F);
    });
  }

  const rows = F.filter(f =>
    (failKind === 'all' || f.kind === failKind) &&
    (failModel === 'all' || short(f.model) === failModel));
  const groups = groupFailures(rows);
  const esc = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');

  fl.innerHTML = !groups.length
    ? emptyHTML('✓', F.length ? 'No failures match this filter.' : 'No failures recorded in the last 7 days.',
        F.length ? 'Clear the kind/model filter above to see everything.' : undefined)
    : groups.map(g=>`<div class="flex items-start gap-2 text-[length:var(--fs-xs)] py-0.5 frow" data-n="${g.n}">
        <span class="text-[length:var(--fs-xs)] px-1 rounded shrink-0 fkind" style="background:${fk(g.kind).c}22;color:${fk(g.kind).c}">${fk(g.kind).t}</span>
        <span class="shrink-0 text-[length:var(--fs-md)] font-semibold truncate fmodel" style="color:${colorOf(short(g.model))}" title="${short(g.model)}">${short(g.model)}</span>
        <span class="muted shrink-0 text-[length:var(--fs-xs)] fwhen">${g.n > 1 && g.first.slice(5,16) !== g.last.slice(5,16) ? `${g.first.slice(5,16)} → ${g.last.slice(11,16)}` : g.last.slice(5,16)}</span>
        <span class="truncate text-[length:var(--fs-xs)] fmsg" title="${esc(g.raw)}">${esc(g.msg)}</span>
        <span class="fcnt shrink-0"${g.n > 1 ? ` title="${g.n} identical failures">&times;${g.n}` : ' style="visibility:hidden">'}</span>
      </div>`).join('');

  if (fc) fc.textContent = rows.length === F.length
    ? `${F.length} failures in ${groups.length} groups · last 7 days`
    : `${rows.length} of ${F.length} failures (${groups.length} groups)`;
}

// ---- Ollama fleet panel -------------------------------------------------
// Three load signals per host, because no single number answers "is this box
// in trouble":
//   queue     — requests waiting. The only true saturation signal.
//   vram      — how full the GPU is. Explains WHY a queue is forming.
//   residency — share of the loaded model actually on GPU. A model at 46%
//               residency is half on CPU and will be ~10x slower; VRAM can
//               look fine while throughput quietly collapses, so this is the
//               signal that catches the failure the other two miss.
export const GB = n => (n/1e9).toFixed(1) + 'G';

// #114: the section is STICKY once discovery has shown it. A refresh that
// momentarily carries no ollama payload (the export timer and the poll are
// not in lockstep) used to hide the card, then the next poll brought it back —
// which read as the whole panel blinking in and out. Once seen, it stays:
// an empty refresh keeps the last known hosts instead of blanking the card.
export let OL_SEEN = false;
// Ollama itself keeps no history once a model unloads (see probe_hosts.py),
// and the payload only ever carries the CURRENT snapshot — so any trend line
// for cpu/gpu/gpu mem/vram/queue has to be built client-side, from whatever
// renderOllama() has actually seen this page session. Keyed by
// "hostLabel\tmetric" so two hosts never share a series. Capped at 20 points
// (~100s of history at the 5s live-poll cadence) — enough to show direction
// without the array growing unbounded over a long-open tab.
export const OL_HIST = new Map();
export const OL_HIST_CAP = 20;
// Idle host body: nothing is resident in VRAM (Ollama unloads after
// keep_alive), but the host is up and has models on disk. Say so, and list
// what is installed, instead of looking like detection failed.
export function olIdle(h){
  const cat = Array.isArray(h.catalog) ? h.catalog : [];
  const n = cat.length || h.installed || 0;
  if (!n) return '<div class="olidle">idle — no models installed</div>';
  const gb = b => (b/1e9).toFixed(1) + ' GB';
  const chips = cat.slice(0, 6).map(m =>
    `<span class="olinst" title="${escA(m.name + ' · ' + (m.par||'?') + ' · ' + (m.quant||'?') + ' · ' + gb(m.size||0) + ' on disk')}">${esc(m.name)}</span>`).join('');
  const more = cat.length > 6 ? `<span class="olinst olmore">+${cat.length - 6}</span>` : '';
  return `<div class="olidle">idle — ${n} installed, none loaded in VRAM (loads on first request)</div>` +
         (chips ? `<div class="olinstl">${chips}${more}</div>` : '');
}

export function olTrack(host, metric, val){
  if (val == null) return null;
  const key = host + '\t' + metric;
  const arr = OL_HIST.get(key) || [];
  arr.push(val);
  if (arr.length > OL_HIST_CAP) arr.shift();
  OL_HIST.set(key, arr);
  return arr;
}

// #34 (decision): "really under pressure" fire icon. GPU >=85% AND queue
// depth >=2, sustained across three consecutive 5s probes (~15s) — a single
// spike lighting the icon trains the operator to ignore it, which is worse
// than no icon. Down hosts never qualify; down is a separate state already
// shown by the dashed border + red dot (per #34's sub-question).
export const OL_PRESSURE = new Map();
export function olPressureTick(host, underPressure){
  const n = underPressure ? (OL_PRESSURE.get(host) || 0) + 1 : 0;
  OL_PRESSURE.set(host, n);
  return n >= 3; // 3 consecutive 5s probes ≈ 15s sustained, per #34
}
export function renderOllama(ol){
  const wrap = $('ollama'), card = $('olcard'), sub = $('olsub');
  if (!wrap || !card) return;
  const hosts = (ol && ol.hosts) || [];
  if (!hosts.length){
    // No data this round. Before the first sighting, stay hidden (nothing to
    // show). After it, keep the existing card and content: a transient gap in
    // the payload is not news, and blanking it is the blink this fixes.
    if (!OL_SEEN){ card.hidden = true; }
    return;
  }
  OL_SEEN = true;
  card.hidden = false;

  wrap.innerHTML = hosts.map(h => {
    const urls = (h.urls||[]).map(u => u.base);
    // Several URLs can front ONE box; say so explicitly rather than listing
    // them as separate hosts and overstating the fleet.
    const alias = urls.length > 1
      ? `<div class="olurls">${urls.length} endpoints → this box: ${urls.join(' · ')}</div>` : '';
    if (!h.up){
      // Down resets the pressure streak — the icon never follows a host
      // back up carrying a stale count from before it dropped.
      OL_PRESSURE.set(h.label, 0);
      return `<div class="olcard down"><div class="olhead">` +
        `<i class="oldot down"></i><span class="olname">${h.label}</span>` +
        `<span class="olbadge">local</span>` +
        `<span class="olver">unreachable</span></div>` +
        `<div class="olidle">${h.err ? String(h.err).slice(0,90) : 'no response'}</div></div>`;
    }
    const loaded = h.loaded || [];
    const vramUsed = loaded.reduce((a,m) => a + (m.vram||0), 0);
    // No VRAM total is exposed by Ollama, so scale against what is loaded and
    // fall back to the largest loaded model rather than inventing a capacity.
    const vramPct = h.vram_total ? (vramUsed / h.vram_total) * 100 : (loaded.length ? 100 : 0);
    const q = h.queue || 0;
    // Queue depth is real now (in-flight requests Hermes dispatched to this
    // host). Scale: 1 request is mild, 4+ saturates the bar.
    const L = h.load || null;
    // CPU/GPU only exist for the box we run on; a remote Ollama exposes no
    // telemetry, so its bars are omitted rather than shown as a fake zero.
    const loadBars = L ? (
      (L.cpu != null ? olBar(L.cpu, 'cpu', L.cpu.toFixed(0) + '%', false, olTrack(h.label,'cpu',L.cpu)) : '') +
      (L.gpu != null ? olBar(L.gpu, 'gpu', L.gpu.toFixed(0) + '%', false, olTrack(h.label,'gpu',L.gpu)) : '') +
      (L.gpu_mem != null ? olBar(L.gpu_mem, 'gpu mem', L.gpu_mem.toFixed(0) + '%', false, olTrack(h.label,'gpu_mem',L.gpu_mem)) : '')
    ) : '';
    const gpuNames = L && L.gpus && L.gpus.length
      ? `<div class="olgpus">${L.gpus.map(g =>
          `<span class="olgpu" title="${g.name}">GPU${g.i} ${g.util.toFixed(0)}% · ${(g.used/1024).toFixed(1)}/${(g.total/1024).toFixed(1)}G · ${g.temp.toFixed(0)}&deg;C</span>`
        ).join('')}</div>`
      : '';
    const models = loaded.length ? loaded.map(m => {
      const caps = (m.caps||[]).filter(c => c !== 'completion')
        .map(c => `<span class="olcap ${c}">${c}</span>`).join('');
      const res = m.res == null ? '' : olBar(m.res, 'on GPU', m.res + '%', true);
      return `<div class="olmod"><span class="olmn" style="color:${colorOf(m.name)}">${m.name}</span>${caps}</div>` +
             `<div class="olrow"><span class="ollbl">ctx</span>` +
             `<span class="olval" style="width:auto">${(m.ctx||0).toLocaleString()} tok · ${GB(m.vram||0)} vram</span></div>` +
             res;
    }).join('') : olIdle(h);

    const w = h.work || {};
    const tasks = Object.entries(w.tasks||{}).sort((a,b)=>b[1]-a[1])
      .map(([k,n]) => `${k} <b>${n}</b>`).join(' · ');

    const instantPressure = (L && L.gpu != null && L.gpu >= 85) && q >= 2;
    const onFire = olPressureTick(h.label, instantPressure);
    const fireIcon = onFire
      ? `<i class="olfire" title="Under sustained pressure: GPU \u226585% and queue \u22652 for ~15s">\ud83d\udd25</i>` : '';

    return `<div class="olcard${onFire ? ' olcard-pressure' : ''}"><div class="olhead">` +
      `<i class="oldot up"></i><span class="olname">${h.label}</span>${fireIcon}` +
      `<span class="olbadge">▣ local</span>` +
      `<span class="olver">v${h.version||'?'} · ${h.ms}ms · ${h.installed} models</span></div>` +
      alias +
      olBar(q ? Math.min(100, q*25) : 0, 'queue', q ? `${q} waiting` : 'clear', false, olTrack(h.label,'queue',Math.min(100, q*25))) +
      olBar(vramPct, 'vram', GB(vramUsed), false, olTrack(h.label,'vram',vramPct)) +
      loadBars + gpuNames +
      models +
      `<div class="olwork"><span>24h: <b>${(w.calls||0).toLocaleString()}</b> calls</span>` +
      `<span><b>${((w.tokens||0)/1e6).toFixed(1)}M</b> tok</span>` +
      (tasks ? `<span>${tasks}</span>` : '') + `</div></div>`;
  }).join('');

  const up = hosts.filter(h => h.up).length;
  const stale = ol.age != null && ol.age > 90;
  if (sub) sub.innerHTML =
    `${up}/${hosts.length} up · ${hosts.reduce((a,h)=>a+(h.loaded||[]).length,0)} models resident` +
    (stale ? ` · <span class="olstale">stale ${Math.round(ol.age/60)}m</span>` : '');
}

// ---- Flow graph: provider -> model -> task ---------------------------------
// A force-directed tree of where work actually goes. Three ring levels:
//   root (all calls) -> provider -> model -> task
//
// Implemented directly rather than with d3-force: the graph is ~100 nodes, and
// the whole simulation below is smaller than the d3 bundle it would replace.
// Colours are NOT new: providers use PROV[], models use colorOf() — the same
// palette as every other widget, so a model is one colour dashboard-wide.
export const SRC_BADGE = { desktop: 'Desktop', subagent: 'Subagent', cron: 'Cron',
  tui: 'TUI', oneshot: 'One-shot', cli: 'CLI', gateway: 'Gateway' };
export let sesstreeCollapsed = new Set(); // node ids explicitly collapsed by the user

export function sesstreeNode(node, depth){
  const hasKids = node.children && node.children.length > 0;
  const collapsed = sesstreeCollapsed.has(node.id);
  const dur = (node.started && node.ended) ? ago(Math.max(0, node.ended - node.started)) : (node.started ? 'running' : '\u2014');
  const srcLabel = SRC_BADGE[node.source] || (node.source ? esc(node.source) : '\u2014');
  const failing = /error|fail/i.test(node.end_reason || '') && node.end_reason !== '(running)';
  const rollup = hasKids
    ? ` <span class="muted" style="font-size:var(--fs-xs)">(own + ${node.child_count} descendant${node.child_count===1?'':'s'}${node.failed_child_count ? `, ${node.failed_child_count} failed` : ''})</span>`
    : '';
  const toggle = hasKids
    ? `<button type="button" class="sesstree-toggle" data-sesstree-toggle="${esc(node.id)}" aria-expanded="${collapsed ? 'false' : 'true'}" aria-label="${collapsed ? 'Expand' : 'Collapse'} children of ${esc(node.title)}">${collapsed ? '\u25B8' : '\u25BE'}</button>`
    : '<span class="sesstree-toggle-spacer"></span>';
  let html = `<div class="sesstree-row${failing ? ' sesstree-row-failed' : ''}" style="padding-left:${depth * 1.25}rem">
    ${toggle}
    <span class="sesstree-title" title="${esc(node.id)}">${esc(node.title)}</span>
    <span class="chip sesstree-chip">${srcLabel}</span>
    <span class="muted sesstree-model">${esc(node.model || '\u2014')}</span>
    <span class="muted sesstree-dur">${dur}</span>
    <span class="muted sesstree-tok">${fmt(node.tok)} tok</span>
    <span class="sesstree-cost">$${(+node.cost || 0).toFixed(4)}${node.cost_is_actual === false ? ' <span class="muted" style="font-size:var(--fs-xs)">(est.)</span>' : ''}${rollup}</span>
    <span class="chip sesstree-endreason${failing ? ' sesstree-endreason-failed' : ''}">${esc(node.end_reason || '(none)')}</span>
    <button type="button" class="chip lntimelinebtn" data-tsession="${esc(node.id)}" data-tprofile="${esc(current)}" data-title="${esc(node.title)}" title="${esc(node.title)} — view timeline">Timeline</button>
  </div>`;
  if (hasKids && !collapsed) {
    html += `<div class="sesstree-children">` + node.children.map(c => sesstreeNode(c, depth + 1)).join('') + `</div>`;
  }
  return html;
}

export function renderSessionsTree(tree){
  const wrap = $('sesstree'), empty = $('sesstreeempty'), sub = $('sesstreesub');
  if (!wrap) return;
  const forest = tree || [];
  // Only roots that actually have children are interesting here — a root
  // with zero children is just an ordinary session and belongs in the
  // per-model table above, not a second copy of the whole session list.
  const withKids = forest.filter(n => n.children && n.children.length > 0);
  if (sub) sub.textContent = withKids.length
    ? `${withKids.length} parent${withKids.length===1?'':'s'} with children`
    : '';
  if (!withKids.length) {
    wrap.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  wrap.innerHTML = withKids
    .sort((a, b) => (b.cost || 0) - (a.cost || 0))
    .map(n => sesstreeNode(n, 0)).join('');
}

// P10-09 (#97): context & compaction. Renders the collector's own
// already-computed series/compactions/reasoning/cooldowns; never
// recomputes a token estimate client-side.
export function renderContext(ctx){
  const card = $('ctxcard');
  if (!card) return;
  const sessions = (ctx && ctx.sessions) || [];
  const reasoning = (ctx && ctx.reasoning_by_model) || [];
  const cooldowns = (ctx && ctx.cooldowns) || [];
  if (!sessions.length && !reasoning.length && !cooldowns.length){ card.hidden = true; return; }
  card.hidden = false;

  $('ctxreasoning').innerHTML = reasoning.length
    ? reasoning.map(r => `
      <div class="flex items-center gap-2 text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
        <span class="font-semibold flex-1 truncate">${esc(r.model)}</span>
        <span class="muted">${(r.reasoning_tokens||0).toLocaleString()} tok</span>
        <span style="min-width:3.5rem;text-align:right">${(r.share*100).toFixed(1)}%</span>
      </div>`).join('')
    : `<div class="muted text-[length:var(--fs-xs)] py-1">No reasoning tokens in range.</div>`;

  $('ctxcooldowns').innerHTML = cooldowns.length
    ? cooldowns.map(c => `
      <div class="text-[length:var(--fs-xs)] py-1" style="border-bottom:1px solid var(--border)">
        <div class="flex items-center gap-2"><span class="font-semibold truncate flex-1">${esc(c.title)}</span></div>
        <div class="muted truncate" title="${esc(c.error_head)}">${esc(c.error_head)}</div>
      </div>`).join('')
    : `<div class="muted text-[length:var(--fs-xs)] py-1">No sessions currently in a compaction-failure cooldown.</div>`;

  $('ctxsessions').innerHTML = sessions.length
    ? sessions.map(s => {
        const ineffCount = (s.compactions||[]).filter(c => c.ineffective).length;
        return `
      <div class="flex items-center gap-3 text-[length:var(--fs-xs)] py-2" style="border-bottom:1px solid var(--border)">
        <span class="font-semibold truncate" style="min-width:8rem;max-width:12rem">${esc(s.id)}</span>
        ${ctxSpark(s.series, s.compactions)}
        <span class="muted" style="min-width:5rem">${(s.compactions||[]).length} compaction${(s.compactions||[]).length===1?'':'s'}</span>
        ${ineffCount ? `<span style="color:#ef4444" title="compactions that recovered under 10% of context">${ineffCount} ineffective</span>` : ''}
      </div>`;
      }).join('')
    : `<div class="muted text-[length:var(--fs-xs)] py-1">No session context data in range.</div>`;
}

export function installSesstree(){
  const wrap = $('sesstree');
  if (!wrap) return;
  wrap.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sesstree-toggle]');
    if (!btn) return;
    const id = btn.dataset.sesstreeToggle;
    if (sesstreeCollapsed.has(id)) sesstreeCollapsed.delete(id);
    else sesstreeCollapsed.add(id);
    render();
  });
}

export function renderHeatmap(hm){
  const wrap = $('heatmap'), sub = $('heatsub'), card = $('heatcard');
  if (!wrap) return;
  const data = (hm||[]).filter(x => x && x.d);
  if (!data.length){ if (card) card.hidden = true; return; }
  if (card) card.hidden = false;

  // Per day: total calls + a per-provider breakdown. Provider identity comes
  // from the shared provOf() so a cell's colours match the provider badges,
  // the provider-distribution chart and the cost table exactly.
  const by = {};
  data.forEach(x => {
    const day = (by[x.d] ||= {v:0, prov:{}});
    const n = x.v || 0;
    day.v += n;
    // Pre-split rows (no provider fields) still work: they fall into '?' and
    // render with the neutral accent, so an old payload degrades rather than
    // throwing.
    const key = (x.p === undefined && x.url === undefined) ? '?' : provOf(x.p, x.m, x.url);
    day.prov[key] = (day.prov[key] || 0) + n;
  });

  const vals = Object.values(by).map(o => o.v).filter(v => v > 0).sort((a,b)=>a-b);
  const q = p => vals.length ? vals[Math.min(vals.length-1, Math.floor(vals.length*p))] : 0;
  const cuts = [q(.25), q(.5), q(.75), q(.92)];
  const level = v => !v ? 0 : v<=cuts[0] ? 1 : v<=cuts[1] ? 2 : v<=cuts[2] ? 3 : v<=cuts[3] ? 4 : 5;

  // A day's cell is a hard-stop linear-gradient: one band per provider, sized
  // by that provider's share of the day. Opacity still encodes volume (the
  // quartile level), so colour answers "who" and brightness answers "how much".
  const OPA = [0, .34, .52, .70, .86, 1];
  function cellStyle(day){
    const lv = level(day.v);
    if (!lv) return '';
    const parts = Object.entries(day.prov).sort((a,b)=>b[1]-a[1]);
    const alpha = OPA[lv];
    const col = k => {
      const c = (PROV[k]||{}).fg || 'var(--accent)';
      return `color-mix(in srgb, ${c} ${Math.round(alpha*100)}%, var(--border))`;
    };
    if (parts.length === 1) return `background:${col(parts[0][0])}`;
    let acc = 0;
    const stops = parts.map(([k, n]) => {
      const from = (acc / day.v) * 100; acc += n;
      return `${col(k)} ${from.toFixed(2)}% ${((acc / day.v) * 100).toFixed(2)}%`;
    });
    return `background:linear-gradient(135deg, ${stops.join(',')})`;
  }
  const provTip = day => Object.entries(day.prov).sort((a,b)=>b[1]-a[1])
    .map(([k,n]) => `${k} ${Math.round(n/day.v*100)}%`).join(' · ');

  // Always end on today and start on a Sunday, so columns are whole weeks.
  const end = new Date(); end.setHours(12,0,0,0);
  // A full year of columns: at full card width 26 weeks would blow each cell up
  // to ~56px, so a year both fills the space and keeps cells a sane size.
  const start = new Date(end); start.setDate(start.getDate() - 7*52);
  start.setDate(start.getDate() - start.getDay());
  const iso = d => d.toISOString().slice(0,10);

  const weeks = []; let col = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate()+1)){
    const k = iso(d);
    col.push({d:k, day: by[k] || null, v: (by[k]||{}).v || 0, dow: d.getDay()});
    if (d.getDay() === 6){ weeks.push(col); col = []; }
  }
  if (col.length) weeks.push(col);

  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMon = -1;
  const heads = weeks.map(w => {
    const m = new Date(w[0].d + 'T12:00:00').getMonth();
    if (m !== lastMon){ lastMon = m; return `<span class="hm-mon">${MON[m]}</span>`; }
    return '<span class="hm-mon"></span>';
  }).join('');

  const cols = weeks.map(w => {
    const cells = [];
    for (let r = 0; r < 7; r++){
      const c = w.find(x => x.dow === r);
      cells.push(c
        ? `<i class="hm-d l${level(c.v)}"${c.day ? ` style="${cellStyle(c.day)}"` : ''}` +
          ` title="${c.d} · ${c.v.toLocaleString()} calls${c.day ? ' · ' + provTip(c.day) : ''}"></i>`
        : '<i class="hm-d hm-pad"></i>');
    }
    return `<div class="hm-w">${cells.join('')}</div>`;
  }).join('');

  // Legend: which providers appear in this range (colour = who), plus the
  // intensity ramp (brightness = how much). The old ramp alone no longer
  // explained the cells once they became multi-coloured.
  const seen = {};
  Object.values(by).forEach(day => Object.entries(day.prov)
    .forEach(([k,n]) => seen[k] = (seen[k]||0) + n));
  const provKeys = Object.entries(seen).sort((a,b)=>b[1]-a[1]).map(e=>e[0]);
  const provLegend = provKeys.map(k =>
    `<span class="hm-lg"><i class="hm-sw" style="background:${(PROV[k]||{}).fg||'var(--accent)'}"></i>` +
    `<span class="muted">${k}</span></span>`).join('');

  wrap.innerHTML =
    `<div class="hm-scroll"><div class="hm-months">${heads}</div>
      <div class="hm-grid">${cols}</div>
      <div class="hm-key">${provLegend}
        <span class="hm-sep"></span>
        <span class="muted">less</span>
        ${[0,1,2,3,4,5].map(l=>`<i class="hm-d l${l}"></i>`).join('')}
        <span class="muted">more</span></div></div>`;

  const total = vals.reduce((a,b)=>a+b,0);
  // by[] values are objects now: sort on .v, not the entry itself.
  const busiest = Object.entries(by).sort((a,b)=>b[1].v-a[1].v)[0];
  if (sub) sub.textContent =
    `${vals.length} active days · ${total.toLocaleString()} calls` +
    (busiest ? ` · busiest ${busiest[0]} (${busiest[1].v.toLocaleString()})` : '');
}

// ---- Hash routing (#5) --------------------------------------------------
// The hash is the single source of truth for which view is showing, so a
// deep link, a refresh, and the back button all agree. Without this the tab
// lived only in localStorage: a shared URL always opened on someone else's
// last-used tab.
