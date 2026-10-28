/**
 * Charts: the Chart.js factory, axis tinting and the aggregation helpers,
 * including the KPI ring/sparkline primitives.
 */
import {
  $, LABEL_FONT, MU, bwPrev, bwPrevAt, escA, fmt, fmtB, fmtRate, labelColor, readTheme,
} from './palette.js';
import { DATA } from './main.js';

export let charts = [], current = null;
export let CHART_ANIM_DONE = false;
Chart.defaults.font.size = 10; readTheme();
export const noLeg = {plugins:{legend:{display:false}}};

export const bounds = p => {
  const ds = [...new Set(p.rows.map(r=>r.date).filter(Boolean))].sort();
  return [ds[0]||'', ds[ds.length-1]||''];
};
export function tintTicks(axis){
  return {...axis, ticks:{...(axis&&axis.ticks||{}), font:LABEL_FONT,
    color: ctx => labelColor(ctx.tick && ctx.tick.label) || MU}};
}

export function mk(id,type,labels,datasets,opts={}){const el=$(id); if(!el)return;
  // Chart.js refuses to bind a second chart to a canvas that still has one
  // ("Canvas is already in use"). charts[] is emptied on every render, but a
  // chart created outside that cycle — the live poll repaints a chart every
  // few seconds — is not in the array and survives, so the next render throws
  // and the whole live feed stalls. Ask Chart.js itself what owns the canvas.
  const prev = (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
  if (prev) { try { prev.destroy(); } catch(_){} }
  // Don't skip hidden views — Chart.js handles zero-size canvases fine, and
  // skipping them means Cost/Detail charts never get per-model colors.
  // `lgt` is ours, not Chart.js's: per-dataset formatters for the legend table.
  const {lgt, ...copts} = opts;
  const o = {responsive:true,maintainAspectRatio:false,...copts};
  if (lgt) o.plugins = {...(o.plugins||{}), legend:{display:false}};
  // After the first paint, every chart (re)build is a data refresh, not a
  // first impression — snap instead of replaying the entrance animation.
  // An explicit `opts.animation` from a caller still wins (none of the
  // current callers set one, but this keeps mk() from ever overriding a
  // future per-chart choice).
  if (CHART_ANIM_DONE && !('animation' in opts)) o.animation = false;

  // Doughnut/pie/radar have no cartesian axes. Injecting `scales` into them
  // materialises a stray "0" axis next to the ring.
  const RADIAL = /^(doughnut|pie|polarArea|radar)$/.test(type);
  if (!RADIAL){
    // Tint the category axis: x for vertical bars/lines, y for horizontal bars.
    const catAxis = (o.indexAxis === 'y') ? 'y' : 'x';
    o.scales = o.scales || {};
    o.scales[catAxis] = tintTicks(o.scales[catAxis] || {});
  }

  // Tint legend entries to match their dataset, and enlarge them.
  const leg = (o.plugins && o.plugins.legend) || {};
  if (leg.display !== false){
    o.plugins = {...(o.plugins||{}), legend:{...leg,
      labels:{...(leg.labels||{}), font:LABEL_FONT,
        generateLabels(chart){
          // Each chart TYPE supplies its own generator: the doughnut/pie one
          // emits a label per slice, while Chart.defaults' generic version
          // emits one per dataset — using the latter on a doughnut yields a
          // single "undefined" entry.
          const t = chart.config.type;
          const src = (Chart.overrides && Chart.overrides[t] && Chart.overrides[t].plugins
                       && Chart.overrides[t].plugins.legend
                       && Chart.overrides[t].plugins.legend.labels
                       && Chart.overrides[t].plugins.legend.labels.generateLabels)
                    || Chart.defaults.plugins.legend.labels.generateLabels;
          const base = src(chart) || [];
          base.forEach(it => {
            const c = labelColor(it.text);
            if (c) it.fontColor = c;
          });
          return base;
        }}}};
  }
  const ch = new Chart(el,{type,data:{labels,datasets},options:o});
  charts.push(ch);
  if (lgt) legendTable(ch, el, lgt, datasets);
}

// Grafana-style legend table (Name / Max / Mean / Last) for a multi-series
// chart. Stats come from the chart's own dataset arrays, so the table can never
// disagree with the plot; a series with no finite point shows an em dash.
// `fmts` is one formatter, or one per dataset index, so each row keeps its unit.
export function seriesStats(data){
  const v = (data||[]).filter(x => x != null && x !== '').map(Number).filter(Number.isFinite);
  if (!v.length) return null;
  return {max:Math.max(...v), mean:v.reduce((a,b)=>a+b,0)/v.length, last:v[v.length-1]};
}
export function legendTable(chart, canvas, fmts, dss){
  const box = canvas.closest('.lgt-host') || canvas.parentElement;
  let wrap = box.nextElementSibling;
  if (!wrap || !wrap.classList.contains('lgt-wrap')){
    wrap = document.createElement('div'); wrap.className = 'lgt-wrap';
    box.after(wrap);
  }
  const f = i => (Array.isArray(fmts) ? fmts[i] : fmts) || fmt;
  const cell = (i, k, st) => `<td>${st ? escA(f(i)(st[k])) : '\u2014'}</td>`;
  wrap.innerHTML = `<table class="lgt"><thead><tr><th></th><th>Name</th><th>Max</th><th>Mean</th><th>Last</th></tr></thead><tbody>` +
    dss.map((d, i) => {
      const st = seriesStats(d.data);
      const c = Array.isArray(d.borderColor) ? d.borderColor[0] : (d.borderColor || d.backgroundColor);
      const off = typeof chart.isDatasetVisible === 'function' && !chart.isDatasetVisible(i);
      return `<tr data-i="${i}"${off ? ' class="off"' : ''}><td><i style="background:${escA(String(c))}"></i></td>` +
        `<td><button type="button" aria-pressed="${off ? 'false' : 'true'}">${escA(d.label || 'series ' + (i+1))}</button></td>` +
        cell(i,'max',st) + cell(i,'mean',st) + cell(i,'last',st) + `</tr>`;
    }).join('') + `</tbody></table>`;
  const toggle = tr => {
    const i = +tr.dataset.i, on = !chart.isDatasetVisible(i);
    chart.setDatasetVisibility(i, on); chart.update();
    tr.classList.toggle('off', !on);
    tr.querySelector('button').setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  wrap.onclick = e => { const tr = e.target.closest('tr[data-i]'); if (tr) toggle(tr); };
  wrap.onkeydown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const tr = e.target.closest('tr[data-i]'); if (!tr) return;
    e.preventDefault(); toggle(tr);
  };
  // Firefox fires the Space click on keyup; keydown already toggled.
  wrap.onkeyup = e => { if (e.key === ' ') e.preventDefault(); };
}

export function agg(rows, keyFn, valFn){
  const m=new Map(); rows.forEach(r=>{const k=keyFn(r); m.set(k,(m.get(k)||0)+(+valFn(r)||0));});
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}

// Badge colours are the same hues as the chart families above, so a provider's
// badge and its models' bars read as one colour system.
export function bwRow(L){
  const up = +L.up_bytes || 0, down = +L.down_bytes || 0;
  const lup = +L.lan_up_bytes || 0, ldown = +L.lan_down_bytes || 0;
  if (!up && !down && !lup && !ldown) return '';
  const prev = bwPrev[L.id];
  const dt = bwPrevAt ? (Date.now() - bwPrevAt) / 1000 : 0;
  // Only trust a rate over a sane interval: a sub-second gap divides by noise,
  // and a long gap (tab was backgrounded) averages away the thing being shown.
  let upR = null, downR = null;
  if (prev && dt >= 2 && dt <= 120) {
    upR = Math.max(0, (up + lup) - prev.up) / dt;
    downR = Math.max(0, (down + ldown) - prev.down) / dt;
  }
  const moving = (upR > 0 || downR > 0);
  // Per-row LAN label removed (#109): it duplicated the metered figure's
  // job and cluttered every row. LAN bytes still count toward the live rate.
  const rate = moving ? `<span class="muted bwrate">${fmtRate(upR + downR)}</span>` : '';
  return `<div class="bw mt-1 text-[length:var(--fs-xs)]${moving ? ' bwlive' : ''}"
      title="Estimated from token counts (${(DATA.bytes_per_token || 4.68)} bytes/token) — not measured">
    <span class="bwleg"><span class="bwarrow bwup">&uarr;</span><span>${fmtB(up)}</span></span>
    <span class="bwleg"><span class="bwarrow bwdown">&darr;</span><span>${fmtB(down)}</span></span>
    ${rate}
  </div>`;
}

// Aggregated bandwidth across every live session in the current profile, both
// directions in one card. Internet and LAN are summed separately: LAN traffic is
// real load but costs nothing on a metered link, so blending them would overstate
// what the connection is carrying.
// Aggregated transfer for the SELECTED RANGE (#86). Distinct from the live
// card above it: that one sums sessions in flight, this sums every row in the
// date filter. The live card answers "what is moving now", this one answers
// "how much have I moved" — the number that was previously impossible to see.
// #114: sticky-after-first-sighting latch for the bandwidth card.
export let PROJ_WEIGHT = localStorage.getItem('hermes-dash-projweight') || 'cost';
if (!['cost', 'calls', 'tokens', 'sessions'].includes(PROJ_WEIGHT)) PROJ_WEIGHT = 'cost';

export const PROJ_WEIGHT_LABELS = {
  cost: {axis: 'Cost ($)', unit: '$', fmt: v => '$' + v.toFixed(2)},
  calls: {axis: 'Calls', unit: 'calls', fmt: v => Math.round(v).toLocaleString()},
  tokens: {axis: 'Tokens', unit: 'tokens', fmt: v => Math.round(v).toLocaleString()},
  sessions: {axis: 'Sessions', unit: 'sessions', fmt: v => Math.round(v).toLocaleString()},
};

// Aggregates a GROUP of rows into a single weighted number. "sessions"
// counts distinct session_id (a project/model/provider bucket can span
// several rows that belong to the SAME session across dates/tasks — a
// naive per-row sum would double count), everything else is a plain sum.
export function weightValue(rowsGroup){
  if (PROJ_WEIGHT === 'sessions'){
    const ids = new Set(rowsGroup.map(r => r.session_id).filter(Boolean));
    // Rows with no session_id at all still count as one anonymous unit
    // each, rather than vanishing from the Sessions-weighted view (the
    // ticket's own "must render sensibly, not hidden" requirement for the
    // exact mode most likely to expose a missing-attribution problem).
    const anon = rowsGroup.filter(r => !r.session_id).length;
    return ids.size + anon;
  }
  if (PROJ_WEIGHT === 'calls') return rowsGroup.reduce((s, r) => s + (+r.calls || 0), 0);
  if (PROJ_WEIGHT === 'tokens') return rowsGroup.reduce((s, r) =>
    s + (+r.inp || 0) + (+r.outp || 0) + (+r.cread || 0) + (+r.cwrite || 0), 0);
  return rowsGroup.reduce((s, r) => s + (+r.act || +r.est || 0), 0);
}

export let projDistNormalized = false;

export let projTrendStacked = false;

export const GAUGE_PREV = new Map();   // stable id -> previous value-arc offset, for the sweep

// Grafana-style arc gauge, shared by the load dial (.loe) and the KPI rings:
// a 270° track, a threshold-coloured value arc, the number centred with its
// unit, a small label under it. `from` is the previous arc offset, so a
// refresh sweeps the arc from where it was (CSS arc-sweep; off under
// prefers-reduced-motion).
export function arcGauge(id, frac, color, num, unit, label, title){
  const CX = 50, CY = 50, R = 40, LEN = R * 270 * Math.PI/180;
  const pt = a => { const r = (a - 90) * Math.PI/180;
    return `${(CX + R*Math.cos(r)).toFixed(2)} ${(CY + R*Math.sin(r)).toFixed(2)}`; };
  const d = `M${pt(-135)} A${R} ${R} 0 1 1 ${pt(135)}`;
  const off = (LEN*(1-frac)).toFixed(2);
  const from = GAUGE_PREV.has(id) ? GAUGE_PREV.get(id) : off;
  GAUGE_PREV.set(id, off);
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><title>${escA(title)}</title>
      <path class="gtrack" d="${d}" fill="none" stroke="var(--border)" stroke-width="8" stroke-linecap="round"/>
      <path class="gval" d="${d}" fill="none" stroke="${color}" stroke-width="8"
        stroke-linecap="round" stroke-dasharray="${LEN.toFixed(2)} 999" stroke-dashoffset="${off}"
        style="--from:${from}"/>
      <text class="gnum" x="${CX}" y="${CY+4}" text-anchor="middle" fill="${color}"
        style="font-size:22px;font-weight:700;font-variant-numeric:tabular-nums">${num}<tspan style="font-size:12px">${unit}</tspan></text>
      <text class="glbl" x="${CX}" y="${CY+22}" text-anchor="middle" fill="var(--muted)"
        style="font-size:10px;font-weight:600">${escA(label)}</text>
    </svg>`;
}

// #11: compact radial ring — the gauge's zone colours and geometry style
// on the shared arcGauge, for bounded 0-100 metrics living in the tight KPI strip
// (success rate, cache hit rate). Reuses --z-ok/--z-warn/--z-bad so "green
// ring" means the same thing as the full instrument dial (#7/#8) everywhere
// on the page. Deliberately NOT used for every KPI: only genuinely bounded
// percentages get a ring — unbounded counters (calls, tokens, spend) keep a
// plain number plus a 7-day sparkline (sparkSvg below), because a 0-100 ring
// around a number with no ceiling would be a fabricated bound.
export function radialRing(pct, opts){
  const o = opts || {};
  const label = o.label || '';
  const warnAt = o.warnAt != null ? o.warnAt : 80;   // #11 rings read HIGH=good
  const badAt  = o.badAt  != null ? o.badAt  : 60;   // (success/cache-hit rate), so bands invert vs. loeIcon's load gauge
  const tier = pct == null ? {c:'var(--muted)', n:'—'}
             : pct >= warnAt ? {c:'var(--z-ok)', n:'Healthy'}
             : pct >= badAt  ? {c:'var(--z-warn)', n:'Watch'}
             :                 {c:'var(--z-bad)', n:'Low'};
  const frac = pct == null ? 0 : Math.max(0, Math.min(1, pct/100));
  const ariaText = pct == null ? `${label}: no data` : `${label} ${Math.round(pct)} percent, ${tier.n.toLowerCase()}`;
  return `<span class="kring" role="meter" aria-valuenow="${pct==null?0:Math.round(pct)}"
      aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escA(ariaText)}" aria-label="${escA(label)}"
      title="${escA(ariaText)}">
    ${arcGauge('ring:' + label, frac, tier.c, pct == null ? '—' : Math.round(pct), pct == null ? '' : '%', pct == null ? 'No data' : tier.n, ariaText)}</span>`;
}

// #11: 7-day trend sparkline for the unbounded KPI counters (API calls,
// tokens) — these have no ceiling, so a ring would imply a fake bound;
// a trend line answers "is this going up or down" instead.
export function sparkSvg(values, color, opts){
  const vals = (values||[]).map(v=>+v||0);
  if (vals.length < 2 || vals.every(v=>v===vals[0])) return '';
  const o = opts || {};
  const W = o.w || 64, H = o.h || 20, PAD = o.pad != null ? o.pad : 2;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = (max-min) || 1;
  const pts = vals.map((v,i)=>{
    const x = PAD + (i/(vals.length-1))*(W-2*PAD);
    const y = H-PAD - ((v-min)/span)*(H-2*PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length-1].split(',');
  return `<svg class="kspark" viewBox="0 0 ${W} ${H}" aria-hidden="true" role="img">
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="1.8" fill="${color}"/>
  </svg>`;
}

export function loeIcon(L, opts){
  const heavy = new Set(['delegate_task','execute_code','terminal','mcp__browser_exec']);
  const light = new Set(['read_file','search_files','web_search']);
  const tools = L.tools||[];
  let score = tools.filter(t=>heavy.has(t)).length*2 + tools.filter(t=>!heavy.has(t)&&!light.has(t)).length;
  score = Math.min(score, 6);
  const frac = score/6;
  const pct = Math.round(frac*100);
  const o = opts || {};
  const size = o.size || 'md';                 // #10: sm|md|lg preset
  const id = o.id != null ? String(o.id) : (L.id || L.sid || 'x');
  const label = o.label || 'load';
  // #8: zone thresholds — configurable per metric via opts, default matches
  // the original Light/Medium/Heavy split (40%/70%) so existing behaviour is
  // unchanged unless a caller opts into different bands (e.g. olBar's queue).
  const warnAt = o.warnAt != null ? o.warnAt : 40;
  const badAt  = o.badAt  != null ? o.badAt  : 70;
  const tier = pct >= badAt ? {c:'var(--z-bad)', cls:'gdanger', n:'Heavy'}
             : pct >= warnAt ? {c:'var(--z-warn)', cls:'', n:'Medium'}
             :                 {c:'var(--z-ok)', cls:'', n:'Light'};
  const ariaText = `${label} ${pct} percent, ${tier.n.toLowerCase()}`;
  return `<span class="loe sz-${size} ${tier.cls}" role="meter"
      aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
      aria-valuetext="${escA(ariaText)}" aria-label="${escA(label)}"
      title="${tier.n} load — ${score}/6 (${pct}%)">
    ${arcGauge(id, frac, tier.c, pct, '%', tier.n, ariaText)}</span>`;
}

// Merge delegation payloads across profiles for the synthetic "All" tab.
//
// Rates CANNOT be averaged — a profile with 2 children at 50% and one with 100
// children at 99% do not average to 74.5%. Every rate here is recomputed from
// summed counters, the same way the Python collector derives it per profile.
export function olBar(pct, lbl, val, invert, spark){
  const p = Math.max(0, Math.min(100, pct||0));
  // invert: for residency HIGH is good; for queue/vram/cpu/gpu HIGH is bad.
  // Load thresholds are tighter than the old 70/90 — a GPU at 85% is already
  // the thing slowing you down, so it must read amber, not green.
  const sev = invert ? (p >= 90 ? 'good' : p >= 60 ? 'warn' : 'bad')
                     : (p >= 85 ? 'bad'  : p >= 60 ? 'warn' : 'good');
  const sevColor = sev === 'bad' ? 'hsl(0 72% 55%)' : sev === 'warn' ? 'hsl(38 92% 52%)' : 'hsl(142 65% 45%)';
  const sp = spark ? sparkSvg(spark, sevColor, {w:44,h:14,pad:1.5}) : '';
  return `<div class="olrow"><span class="ollbl">${lbl}</span>` +
         `<span class="olbar"><i class="olfill ${sev}${invert?' inv':''}" style="width:${p}%"></i></span>` +
         `<span class="olval ${sev}">${val}</span>${sp?`<span class="olspwrap">${sp}</span>`:''}</div>`;
}
export function ctxSpark(series, compactions){
  if (!series || !series.length) return '<span class="muted text-[length:var(--fs-xs)]">no data</span>';
  const W = 260, H = 40, pad = 2;
  const xs = series.map(pt => pt[0]), ys = series.map(pt => pt[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs) || 1;
  const maxY = Math.max(...ys, 1);
  const xAt = x => pad + (maxX === minX ? 0 : (x - minX) / (maxX - minX)) * (W - 2*pad);
  const yAt = y => H - pad - (y / maxY) * (H - 2*pad);
  const pts = series.map(pt => `${xAt(pt[0]).toFixed(1)},${yAt(pt[1]).toFixed(1)}`).join(' ');
  const markers = (compactions || []).map(c => {
    const x = xAt(c.ts).toFixed(1);
    const color = c.ineffective ? '#c66a6a' : '#5f9e6e';
    return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${color}" stroke-width="1.5" stroke-dasharray="2,2"><title>${c.ineffective ? 'ineffective' : 'effective'} compaction: -${(c.yield_tok||0).toLocaleString()} tok</title></line>`;
  }).join('');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block">` +
    `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>` + markers + `</svg>`;
}

export function usdPerSec(v){
  return ((+v.gpu_draw_watts || 0) + (+v.host_overhead_watts || 0)) / 1000
    * (+v.electricity_rate_kwh || 0) / 3600;
}
export function outPer1M(v, tps){ return usdPerSec(v) * 1e6 / tps; }

