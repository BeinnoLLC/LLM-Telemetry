/**
 * Live: the live session list, host cards, gauges and the polling loop
 * (including the completion sound).
 */
import {
  $, BD, COLORS, PAL, TOOLCOLORS, ago, allModelNames, allToolNames, buildColors, buildToolColors, bwPrev, bwPrevAt, catOf, colorOf, emptyHTML, esc, escA, fmt, fmtB, pick, short, stampFreshness,
} from './palette.js';
import { bwRow, current, loeIcon, mk, sparkSvg } from './charts.js';
import {
  REPO_EXPANDED, installProjFilter, installProjWeight, installProjectDrilldown, installSesstree, modelsBadge, modelsPanel, provBadge, provLogoSvg, provOf, render, renderOllama, renderRepoBranch, renderResolution, schemaProblem, showSchemaError,
} from './views.js';
import { renderAgents, renderQueue } from './flow.js';
import {
  drawerSync, installDrawer, installSessionFinder, installTimelineModal, installTranscriptModal,
} from './drawer.js';
import {
  POWER, PV_ALL, intervalsInstall, navSync, profileHue, profileIconHtml, pvFilter, settingsInstall, tabs,
} from './router.js';
import { installHelp } from './routerview.js';
import { applyDiff, motionReduced, invalidate } from './diffdom.js';
import { DATA, SCHEMA_VERSION } from './main.js';

// A live session renders as a ROW DIV + (optionally) the lmpanel DIV, so a
// "key" owns 1–2 consecutive nodes. Row carries data-tsession; panel carries
// data-lmp. Anything else (empty-state block, stray nodes) keys as null →
// treated as its own singleton group by groupsOf.
let _announceLast = 0;
export function announceLive(msg){
  void msg;
  const now = Date.now();
  if (now - _announceLast < 10000) return false;
  _announceLast = now;
  const box = document.getElementById('livekpis');
  if (box) box.setAttribute('aria-live','polite');
  // update a polite live region text if present
  return true;
}
function liveGroupKeyOf(el){
  if (el.classList && el.classList.contains('liverow')){
    // The row div itself carries no session id; its first action button does
    // (title button) — the panel that follows the row is keyed by data-lmp,
    // which matches the row's session id 1:1. PI rows carry no action
    // button/panel (#245, merged into this list) — they key off the row's
    // own data-pisession attribute, prefixed so a PI session id can never
    // collide with a Hermes one.
    const btn = el.querySelector('[data-tsession]');
    if (btn) return btn.getAttribute('data-tsession');
    const pisession = el.getAttribute('data-pisession');
    if (pisession) return 'pi:' + pisession;
    const agentsession = el.getAttribute('data-agentsession');
    return agentsession ? (el.getAttribute('data-engine') || 'agent') + ':' + agentsession : null;
  }
  if (el.classList && el.classList.contains('lmpanel')){
    // A panel FOLLOWS its row, so it belongs to the row's group (data-lmp
    // equals the row's session id); a leading panel (its row was just
    // removed) is a stale leftover — key it as its own group.
    return el.getAttribute('data-lmp') || null;
  }
  return null;
}

// #181/#182/#184: above-the-fold live KPIs. Throughput is derived client-side: the
// feed carries CUMULATIVE per-session counters, so each poll diffs sessions into a
// 5-minute ring (per profile; the merged view sums them).
export const TPUT_WINDOW_S = 300;
export let tputPrev = null;     // session id -> {c, k}; null until the first sample
export let tputRing = [];       // [{t, by: {profile: {c, k}}}], oldest first
function sessTotals(L){
  let c = 0, k = 0;
  (L.models || []).forEach(m => { c += +m.calls || 0; k += (+m.in_tok || 0) + (+m.out_tok || 0); });
  return { c, k };
}
export function sampleThroughput(profiles, now){
  const t = now == null ? Math.floor(Date.now() / 1000) : now;
  const baseline = tputPrev == null;
  const next = new Map(), by = {};
  Object.entries(profiles || {}).forEach(([name, p]) => {
    let c = 0, k = 0;
    ((p && p.live) || []).forEach(L => {
      if (!L || !L.id || next.has(L.id)) return;
      const cur = sessTotals(L);
      next.set(L.id, cur);
      if (baseline) return;
      const prev = tputPrev.get(L.id) || { c: 0, k: 0 };
      // max(0, …): a counter that goes backwards is a restart, not negative work.
      c += Math.max(0, cur.c - prev.c);
      k += Math.max(0, cur.k - prev.k);
    });
    by[name] = { c, k };
  });
  tputPrev = next;
  if (!baseline) tputRing.push({ t, by });
  tputRing = tputRing.filter(s => t - s.t < TPUT_WINDOW_S);
  return by;
}
// Window totals + per-poll series for one view. `name` is a profile key, or
// anything not in the ring (the merged 'All' view) to sum every profile.
export function throughputFor(name, now){
  const t = now == null ? Math.floor(Date.now() / 1000) : now;
  const ring = tputRing.filter(s => t - s.t < TPUT_WINDOW_S);
  const pick = s => {
    if (name in s.by) return s.by[name];
    return Object.values(s.by).reduce((a, v) => ({ c: a.c + v.c, k: a.k + v.k }), { c: 0, k: 0 });
  };
  const series = ring.map(pick);
  return {
    calls: series.reduce((a, v) => a + v.c, 0),
    tokens: series.reduce((a, v) => a + v.k, 0),
    series: series.map(v => v.c),
    // Seconds of history actually held, so a fresh page says "last 40s"
    // instead of passing 40 seconds of data off as five minutes.
    span: ring.length ? Math.min(TPUT_WINDOW_S, t - ring[0].t + LIVE_MS / 1000) : 0,
  };
}
// The merged 'All' key (router.js buildAll) carries the merged `live` list but
// NOT `agents` or `alerts`, so reading them off it would claim "0/0 agents,
// All clear" while a real profile has critical alerts. For the merged view the
// two lists are concatenated from the real profiles instead.
function mergedField(profiles, field){
  return Object.entries(profiles || {})
    .filter(([n]) => n !== 'All')
    .flatMap(([, q]) => (q && q[field]) || []);
}
// One entry per engine:session_id (keep the freshest by
// smallest idle_s), engine whitelisted to claude/codex.
export function dedupAgentLive(list){
  const best = new Map();
  for (const S of (list || [])){
    if (!S) continue;
    const key = (S.engine === 'codex' ? 'codex' : 'claude') + ':' + (S.session_id || '');
    const cur = best.get(key);
    const idle = Number.isFinite(S.idle_s) ? S.idle_s : Infinity;
    if (!cur || idle < cur.idle) best.set(key, { S, idle });
  }
  return [...best.values()].map(v => v.S);
}
// Sessions working right now for profile `p`: its Hermes rows plus the
// fleet-wide Pi and (deduped) Claude/Codex lists, which show under every
// profile. Idle Pi/agent sessions are not "in flight".
export function inFlight(p, piLive, agentLive){
  const seen = new Set(), out = [];
  ((p && p.live) || []).forEach(L => { if (L && !seen.has(L.id) && seen.add(L.id)) out.push({ kind: 'hermes', S: L }); });
  (piLive || []).forEach(S => { if (S && S.phase !== 'idle') out.push({ kind: 'pi', S }); });
  dedupAgentLive(agentLive).forEach(S => { if (S.phase !== 'idle') out.push({ kind: S.engine === 'codex' ? 'codex' : 'claude', S }); });
  return out;
}
// Sessions-in-flight sub-line: one dot (or brand mark) per non-zero kind,
// "5 Hermes · 3 Claude". Empty string when nothing is in flight.
export function inProgressHtml(p, piLive, agentLive){
  const c = { hermes: 0, pi: 0, claude: 0, codex: 0 };
  inFlight(p, piLive, agentLive).forEach(t => { c[t.kind]++; });
  const chips = KIND_ORDER.filter(k => c[k]).map(k => {
    const m = kindMeta(k);
    // Claude/Codex lead with their brand mark (inherits the kind colour);
    // PI and Hermes keep the coloured dot.
    const mark = (k === 'claude' || k === 'codex') && kindLogo(k)
      ? `<span class="kpi-logo" aria-hidden="true" style="color:${m.color}">${kindLogo(k)}</span>`
      : profileIconHtml(m.label, 12);
    return `<span class="kpi-kind" data-kind="${k}" title="${c[k]} ${escA(m.label)}">${mark}${c[k]} ${esc(m.label)}</span>`;
  }).join('');
  return chips ? `<span class="kpi-kinds">${chips}</span>` : '';
}
// ONE card anatomy for every KPI on Home (both rows): label, value (+ unit),
// sub-line, viz slot. Fixed grid rows in CSS keep the baselines shared and the
// height equal whether or not a card has a viz. `viz` is raw markup.
export function statHtml(o){
  const attrs = (o.kpi ? ` data-kpi="${o.kpi}"` : '') + (o.state ? ` data-state="${o.state}"` : '');
  const open = o.href ? `<a class="card stat" href="${o.href}"${attrs}>` : `<div class="card stat"${attrs}>`;
  return open
    + `<div class="stat-label" title="${escA(o.label)}">${esc(o.label)}</div>`
    + `<div class="stat-value">${o.value}${o.unit ? `<span class="stat-unit">${o.unit}</span>` : ''}</div>`
    + `<div class="stat-sub"${o.subState ? ` data-state="${o.subState}"` : ''}>${o.sub || ''}</div>`
    + `<div class="stat-viz">${o.viz || ''}</div>`
    + (o.href ? '</a>' : '</div>');
}
// Bounded 0-100 metric as a thin bar (replaces the ring gauge). Returns the
// state ('ok'|'warn'|'bad'|null) alongside the bar so the card can colour its
// sub-line from the same threshold.
export function meterStat(pct, o){
  const state = pct == null ? null : pct >= o.warnAt ? 'ok' : pct >= o.badAt ? 'warn' : 'bad';
  const word = pct == null ? 'no data' : state === 'ok' ? 'Healthy' : state === 'warn' ? 'Watch' : 'Low';
  const v = pct == null ? 0 : Math.round(Math.max(0, Math.min(100, pct)));
  return {
    state, word,
    viz: `<div class="stat-meter" role="meter" aria-valuenow="${v}" aria-valuemin="0" aria-valuemax="100"`
      + ` aria-label="${escA(o.label)}" style="--v:${v}%"><i></i></div>`,
  };
}
export function liveKpis(p, name, now, profiles, agentLive, piLive){
  const sessions = inFlight(p, piLive, agentLive).length;
  const merged = name === 'All' && profiles;
  const agents = merged ? mergedField(profiles, 'agents') : ((p && p.agents) || []);
  const alive = agents.filter(a => a && a.state === 'alive').length;
  const alerts = merged ? mergedField(profiles, 'alerts') : ((p && p.alerts) || []);
  return {
    sessions, alive, agents: agents.length,
    alerts: alerts.length, list: alerts.filter(Boolean),
    critical: alerts.filter(a => a && a.severity === 'critical').length,
    tput: throughputFor(name, now),
  };
}
// The cards repaint through one innerHTML write, which would orphan the
// throughput sparkline's Chart.js canvas every poll. So the canvas wrapper is
// lifted out first and put back into the new throughput card; it is only
// emitted as markup the first time (or after a full rebuild removed it).
const LKPI_SPARK = '<div class="stat-spark" aria-hidden="true"><canvas id="cLkpiSpark"></canvas></div>';
// One chart per page: built through mk() (which destroys any chart already
// bound to the canvas) the first time, then fed the new window in place.
function paintSpark(series){
  const el = $('cLkpiSpark');
  if (!el) return;
  const labels = series.map((_, i) => i);
  const have = (typeof Chart.getChart === 'function') ? Chart.getChart(el) : null;
  if (have){
    have.data.labels = labels;
    have.data.datasets[0].data = series;
    have.update('none');
    return;
  }
  mk('cLkpiSpark', 'line', labels, [
    {data: series, borderColor: PAL[0], backgroundColor: PAL[0] + '1a', fill: true,
     tension: .3, pointRadius: 0, borderWidth: 1.5}],
    {events: [], layout: {padding: 0}, ...(motionReduced() ? {animation: false} : {}),
     plugins: {legend: {display: false}, tooltip: {enabled: false}},
     scales: {x: {display: false}, y: {display: false, beginAtZero: true}}});
}
const SEV_RANK = { critical: 0, warning: 1, info: 2 };
// "delegation_failure_rate" -> "Delegation failure rate": the rule name is the
// short title, the full sentence rides in title=.
const ruleTitle = r => { const t = String(r || '').replace(/[_-]+/g, ' ').trim(); return t ? t[0].toUpperCase() + t.slice(1) : 'Alert'; };
function alertsStat(k){
  if (!k.alerts){
    return statHtml({kpi: 'alerts', label: 'Active alerts', value: '0', state: 'ok', href: '#/health',
      sub: '<span class="stat-clear"><span aria-hidden="true">\u25CF</span> All clear</span>'});
  }
  const list = k.list.slice().sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
  const worst = list[0];
  const warn = list.filter(a => a.severity !== 'critical').length;
  const split = [k.critical ? `${k.critical} critical` : '', warn ? `${warn} warning` : ''].filter(Boolean).join(' \u00b7 ');
  const viz = `<span class="stat-alert${worst.severity === 'critical' ? ' crit' : ''}" title="${escA(worst.why || worst.message || '')}">`
    + `<span class="adot" aria-hidden="true"></span><span class="atext">${esc(ruleTitle(worst.rule))}</span></span>`;
  return statHtml({kpi: 'alerts', label: 'Active alerts', value: String(k.alerts), href: '#/health',
    state: k.critical ? 'bad' : 'warn', sub: split, viz});
}
export function renderLiveKpis(p, name, now, profiles, agentLive, piLive){
  const box = $('livekpis');
  if (!box) return null;
  const k = liveKpis(p, name, now, profiles, agentLive, piLive);
  checkCriticalAlerts(k.list);
  const win = k.tput.span >= TPUT_WINDOW_S ? 'last 5 min'
    : k.tput.span > 0 ? `last ${ago(Math.round(k.tput.span))}` : 'measuring\u2026';
  const had = $('cLkpiSpark');
  const keep = had && had.parentNode;
  if (keep && keep.parentNode) keep.parentNode.removeChild(keep);
  const down = k.agents - k.alive;
  box.innerHTML = [
    statHtml({kpi: 'sessions', label: 'Sessions in flight', value: String(k.sessions),
      sub: inProgressHtml(p, piLive, agentLive) || 'open right now'}),
    // No heartbeat rows (a profile without a gateway backend, or a feed that
    // carries none) is "unknown", not "all heartbeating".
    k.agents
      ? statHtml({kpi: 'agents', label: 'Agents alive', value: String(k.alive), unit: `/${k.agents}`,
          sub: down ? `${down} not heartbeating` : 'all heartbeating', subState: down ? 'warn' : ''})
      : statHtml({kpi: 'agents', label: 'Agents alive', value: '\u2014', sub: 'no agent heartbeats reported'}),
    statHtml({kpi: 'throughput', label: 'Calls \u00b7 tokens', value: k.tput.calls.toLocaleString(), unit: 'calls',
      sub: `${fmt(k.tput.tokens)} tokens \u00b7 ${win}`, viz: keep ? '' : LKPI_SPARK}),
    alertsStat(k),
  ].join('');
  if (keep) box.querySelector('[data-kpi="throughput"] .stat-viz').appendChild(keep);
  paintSpark(k.tput.series);
  return k;
}

// LST-245: PI-vs-Hermes badge. Same visual pattern as views.js's pv-badge
// (pill, signature glyph, colour via color-mix on a CSS custom prop) rather
// than a new badge style — only the glyph/colour/label differ per kind.
// Colours are NOT declared here: css/tokens.css owns --kind-hermes/pi/claude/
// codex and the fleet bar reads the same tokens, so there is one palette.
export const KIND_ORDER = ['hermes', 'pi', 'claude', 'codex'];
// Brand marks for the two coding-agent engines. Path data is copied VERBATIM
// from simple-icons (https://simpleicons.org, CC0 1.0 Universal): icon
// "claude" from simple-icons 16.36.0 and icon "openai" from 15.22.0 (16.x
// dropped it). Never redraw or approximate them. Defined once here and reused
// by the KPI chips, train cars, live rows, fleet bar and the provider badges.
// fill is currentColor, so the mark inherits the kind colour from its parent.
function logoSvg(kind, d){
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" data-kindlogo="${kind}"><path d="${d}"/></svg>`;
}
const KIND_LOGO = {
  claude: logoSvg('claude', 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'),
  codex:  logoSvg('codex', 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'),
  hermes: logoSvg('hermes', 'M11.981.009c.226-.012.453-.011.679 0 .247.01.495.024.74.062.401.064.798.157 1.19.273.463.138.92.299 1.356.511a7.31 7.31 0 012.948 2.642c.292.469.536.963.739 1.479.219.556.446 1.11.623 1.683.204.654.329 1.326.458 1.997.097.504.182 1.01.29 1.511.156.722.329 1.44.494 2.16.186.812.4 1.615.63 2.415.102.355.193.713.282 1.072.11.436.202.876.254 1.323.031.278.066.557.073.837a7.56 7.56 0 01-.017.88c-.037.413-.1.818-.226 1.212a5.017 5.017 0 01-.915 1.649l-.13.156.018.023c.043-.023.088-.041.127-.068.2-.138.373-.307.531-.49.4-.46.721-.973.975-1.529a3.59 3.59 0 00.325-1.72c-.024-.424-.097-.834-.3-1.213-.013-.027-.015-.06-.03-.121.05.035.082.048.101.072.107.13.22.258.315.398.33.494.46 1.052.486 1.64a3.75 3.75 0 01-.47 1.97c-.36.655-.887 1.14-1.526 1.506-.193.111-.394.21-.595.308-.157.078-.248.211-.318.365a.522.522 0 00-.033.406.359.359 0 01.013.139c-.005.077-.077.155-.14.162-.054.006-.125-.043-.15-.116a1.206 1.206 0 01-.06-.233c-.04-.314-.155-.6-.308-.87a3.906 3.906 0 00-.73-.91 2.129 2.129 0 00-.897-.524 4.093 4.093 0 00-.692-.131c-.075-.008-.15-.04-.22.01.18.06.363.11.538.18.434.173.82.43 1.18.728.308.255.58.543.794.884.098.155.186.315.227.496.027.123.042.25.067.375.013.062-.002.109-.053.144-.047.033-.122.034-.163-.01a.455.455 0 01-.08-.14c-.03-.073-.038-.159-.078-.225a7.314 7.314 0 00-1.423-1.664c-.16-.137-.329-.26-.537-.323-.376-.114-.753-.203-1.15-.154-.213.025-.427.032-.64.053a1.6 1.6 0 00-.736.278 5.14 5.14 0 00-.834.72c-.329.342-.642.699-.955 1.055-.136.155-.264.319-.314.531a5.227 5.227 0 00-.012.051.096.096 0 01-.09.076h-.31c-.046 0-.082-.048-.072-.094.023-.108.045-.216.07-.324.075-.325.19-.635.368-.917.024-.039.04-.088.104-.08l.01.049.027.077c.28-.435.571-.834.996-1.135.283-.204.584-.378.89-.55a.196.196 0 00-.098-.002c-.162.043-.325.084-.485.134-.402.124-.764.33-1.11.566-.147.1-.298.193-.414.333a7.314 7.314 0 00-1.07 1.767.845.845 0 00-.04.12.075.075 0 01-.072.056h-.494c-.04 0-.062-.051-.036-.082.123-.14.246-.282.377-.415.275-.281.58-.532.777-.884.027-.048.063-.09.095-.135.238-.333.54-.607.818-.902.082-.086.175-.16.26-.24.029-.027.053-.057.079-.085l-.018-.025-.135.041c-.034.017-.07.031-.102.05-.248.144-.494.292-.743.433-.408.23-.825.439-1.209.711-.281.2-.591.358-.889.533-.02.012-.044.015-.08.028-.015-.135.143-.201.108-.336-.033.014-.064.02-.085.038-.111.096-.227.19-.328.296-.148.157-.284.325-.425.488-.125.143-.25.286-.373.431A.153.153 0 019.89 24H8.762a.316.316 0 00.016-.042c.028-.09.085-.172.083-.28-.091-.018-.162.001-.212.077a4.45 4.45 0 00-.136.215c-.01.016-.024.03-.042.03h-.093c-.019 0-.029-.022-.017-.037.071-.088.14-.178.209-.268.001-.002-.006-.012-.012-.024-.014.004-.03.006-.045.013-.176.09-.352.181-.527.274a.363.363 0 01-.168.042H5.202c-.026 0-.039-.036-.019-.053.21-.178.402-.374.558-.605.335-.496.538-1.047.667-1.629.004-.02-.003-.043-.006-.091-.037.048-.059.072-.076.1a1.943 1.943 0 01-.334.415c-.28.258-.59.448-.983.464-.297.012-.588 0-.865-.127-.46-.21-.722-.57-.794-1.072-.025-.17-.017-.171-.182-.219A3.513 3.513 0 011.97 20.6a2.286 2.286 0 01-.808-1.13 3.569 3.569 0 01-.16-1.245c.002-.034.016-.067.024-.1.032.023.046.043.05.066.033.153.059.308.096.46.086.355.257.664.516.92.258.256.571.419.91.532.358.118.717.138 1.07-.016a1.89 1.89 0 00.621-.452c.328-.348.533-.76.648-1.223.009-.034.005-.071.007-.11-.015.006-.026.006-.03.011-.031.05-.064.1-.093.152-.284.502-.679.887-1.196 1.135-.351.17-.718.255-1.11.159a1.607 1.607 0 01-.971-.64 2.006 2.006 0 01-.368-.924 2.903 2.903 0 01.02-.886c.05-.439.466-1.17.742-1.271-.02.063-.035.112-.053.16-.043.116-.097.227-.13.345a1.901 1.901 0 00-.05.82c.033.212.09.416.204.6.147.236.346.407.62.465.11.023.225.014.338.018a.576.576 0 00.386-.131c.164-.128.282-.292.366-.481.168-.375.24-.777.309-1.179.05-.296.093-.594.133-.893.039-.281.071-.563.104-.845.026-.232.048-.464.074-.696.024-.228.052-.455.076-.683.024-.227.047-.455.069-.683.013-.14.022-.28.034-.42l.037-.417c.022-.25.041-.5.065-.748.008-.082-.02-.132-.09-.177a2.46 2.46 0 01-.492-.418c-.1-.109-.188-.228-.282-.342-.035-.042-.056-.097-.116-.118a2.084 2.084 0 00.275.597c.06.092.131.176.196.265.063.086.182.115.234.226-.028.003-.046.01-.06.006a4.74 4.74 0 01-.22-.057 2.71 2.71 0 01-1.287-.819c-.435-.487-.656-1.076-.71-1.723a5.206 5.206 0 01.014-1.06c.072-.602.22-1.186.45-1.745.155-.376.338-.741.526-1.102.205-.393.466-.75.765-1.076.512-.559 1.104-1.024 1.726-1.448.717-.49 1.478-.898 2.277-1.233C8.244.828 8.767.632 9.31.494c.655-.166 1.31-.33 1.982-.415.229-.03.458-.058.688-.07zm-1.847 22.82c-.07.06-.147.111-.207.18-.238.27-.464.549-.668.869l-.044.108a.177.177 0 00.093-.057c.174-.19.351-.378.519-.574.104-.122.195-.255.288-.386.024-.034.03-.08.046-.12l-.027-.02zm1.65-3.695a5.51 5.51 0 00-.653.593l-.37.386a.963.963 0 01-.377.25 1.372 1.372 0 01-.467.09c-.044 0-.087.006-.151.012.028.058.043.097.064.131.15.242.301.482.45.724.136.22.276.438.399.666.068.125.105.267.156.404.077.027.14-.018.202-.048.29-.135.579-.274.867-.412.213-.101.437-.186.636-.31.347-.215.68-.455 1.018-.685.015-.01.026-.028.042-.046-.023-.019-.038-.037-.056-.044-.287-.111-.527-.3-.77-.482a5.319 5.319 0 01-.506-.42 1.757 1.757 0 01-.41-.653c-.019-.049-.045-.095-.075-.156zm-5.847.264c-.06.096-.097.194-.132.293a3.38 3.38 0 01-.555 1.01c-.2.25-.455.412-.762.493-.23.06-.464.076-.7.07-.048-.002-.097.002-.158.005.016.04.021.066.035.085.1.145.23.246.4.295.157.046.316.034.498.023.181-.037.343-.115.485-.234.238-.199.402-.454.536-.732.175-.363.264-.751.342-1.144.01-.053.008-.11.011-.164zm14.945-4.586c.008.029.016.057.027.107.024.155.051.31.072.464.03.219.067.437.078.657.017.344.027.689-.014 1.033-.037.315-.063.633-.116.946a6.153 6.153 0 01-.46 1.518c-.008.018-.01.039-.02.082.047-.03.077-.042.098-.064.085-.083.17-.167.248-.255.271-.305.458-.66.596-1.043.18-.498.228-1.011.145-1.531-.103-.65-.33-1.263-.597-1.881a9.055 9.055 0 00-.024-.055l-.033.022zM5.797 8.29a.26.26 0 00.018.153c.124.251.25.501.379.75.025.049.066.09.03.163-.284.06-.578.119-.88.255.059.038.097.06.132.087.042.032.112.058.09.12-.01.033-.075.048-.117.072.017.01.043.021.067.036.166.102.33.207.447.368.138.192.229.404.188.644-.079.469-.306.85-.69 1.132-.054.04-.106.083-.161.122a.243.243 0 00-.103.245.77.77 0 00.055.195c.083.196.22.35.375.492.083.076.159.164.222.257a.37.37 0 01.025.377c-.023.05-.05.099-.076.148-.03.06-.028.111.022.162.041.042.08.089.112.138.038.058.078.079.147.05a.486.486 0 01.333-.006c.16.046.302.126.444.21.13.077.264.149.4.219.067.035.14.05.219.026.071-.022.124.01.145.076.02.064-.003.108-.074.139-.07.03-.137.063-.209.088-.1.035-.201.073-.314.077-.013-.107.11-.088.127-.159-.206-.126-.643-.145-.801-.034.063.112.035.21-.096.313-.13-.1-.025-.202.002-.3a.209.209 0 00-.249.17c-.015.101.067.216.178.224.108.007.218-.005.326-.012.06-.005.12-.027.199 0-.103.123-.248.127-.357.19.002.05.07.086.019.131-.053.048-.095-.001-.132-.03-.08-.063-.16-.126-.231-.197a.474.474 0 01-.157-.311.52.52 0 00-.043-.172c-.032-.074-.032-.137.033-.19-.018-.03-.028-.053-.045-.072a1.222 1.222 0 01-.196-.369c-.053-.137-.046-.264.048-.381.024-.03.05-.06.064-.095a.664.664 0 00.047-.168c.017-.165-.064-.287-.182-.387-.186-.156-.36-.322-.46-.551-.005-.011-.024-.017-.037-.026-.011.017-.024.027-.025.038-.019.185-.045.37-.052.557-.014.377.058.743.162 1.104.118.41.289.798.488 1.173.267.502.537 1.002.812 1.5.055.098.13.189.208.27.198.202.452.272.724.273.202 0 .404-.006.605-.026.295-.03.59-.073.884-.113.183-.025.365-.057.548-.08.21-.026.38.073.522.21.16.156.305.327.447.5.22.265.397.56.554.867.05.098.07.1.147.03.13-.121.26-.242.394-.36.067-.059.088-.12.067-.213a3.535 3.535 0 01-.085-.796c.002-.157.006-.314.018-.471.015-.224.03-.45.06-.672a59.114 59.114 0 01.362-2.298c.087-.493.182-.984.268-1.477.06-.347.118-.694.162-1.043.034-.273.055-.55.063-.825.011-.332.003-.665.002-.998 0-.077.004-.155-.01-.23-.028-.142-.01-.155-.162-.19a5.826 5.826 0 00-.607-.107c-.146-.018-.207-.053-.221-.19-.006-.049-.025-.098-.041-.146-.009-.025-.024-.048-.046-.09l-.025.264c-.009.096-.029.116-.127.115-.055 0-.11-.008-.164-.008-.476 0-.952-.008-1.426.032-.095.008-.173-.015-.226-.103-.04-.066-.088-.126-.134-.186-.063-.084-.086-.093-.182-.06-.195.068-.388.138-.582.21a2.71 2.71 0 00-.675.394.986.986 0 01-.323.168c-.033.01-.07.008-.127.013.02-.066.024-.114.047-.15.064-.105.135-.205.205-.306.023-.033.049-.063.073-.095l-.015-.023-.201.037c-.146.04-.296.07-.437.122-.148.053-.266.023-.386-.072a3.623 3.623 0 01-.733-.786l-.093-.132zm8.592 8.963l-.147.09c-.22.134-.44.266-.659.402-.093.058-.184.12-.27.188-.085.07-.124.161-.072.272.047.1.093.2.147.294.047.08.124.138.213.147.11.01.228.012.336-.012.217-.05.372-.205.528-.357a.291.291 0 00.087-.308c-.046-.18-.079-.365-.118-.547-.011-.052-.027-.103-.045-.169zm-.257-2.409c-.12.291-.205.597-.325.91-.151.433-.294.87-.435 1.323.036-.01.054-.01.067-.018.261-.16.522-.324.785-.484.054-.033.071-.078.065-.138-.012-.13-.024-.262-.034-.393l-.068-.886c-.008-.103-.02-.206-.029-.31-.009 0-.017-.002-.026-.004zm3.081-8.13l.099.285c.08.231.159.463.24.714l.58 1.952c.187.63.372 1.262.558 1.893.114.382.235.762.343 1.146.072.257.126.519.186.799.044.206.087.413.127.64.034.106.023.226.077.325l.025-.006-.068-.362c-.038-.206-.077-.412-.113-.638-.015-.07-.029-.141-.046-.211-.095-.396-.177-.796-.29-1.187-.196-.685-.413-1.364-.618-2.046-.165-.549-.322-1.1-.488-1.648-.069-.227-.15-.45-.226-.695l-.117-.336c-.037-.107-.075-.216-.115-.322-.04-.106-.084-.21-.127-.314a7.558 7.558 0 01-.027.01zM6.225 14.304c-.063-.001-.115.014-.134.083a.35.35 0 00.41.012 4.533 4.533 0 00-.276-.095zM5.23 11.98c-.026-.027-.057-.048-.075.002-.012.032-.007.07-.01.113.082-.037.082-.037.085-.115zm.062-1.189a.135.135 0 00-.088.056.197.197 0 00-.025.11c.005.152.01.306.026.457a.751.751 0 00.066.218c.061.136.157.167.288.101.055-.027.06-.054.025-.11a4.52 4.52 0 01-.129-.211c-.015-.068-.066-.131-.033-.207.04-.09-.076-.116-.074-.19V10.874c-.003-.038-.006-.087-.056-.083zm-.017-.968a.867.867 0 00-.467.127c-.076.045-.084.07-.05.158.034.087.07.173.115.254.064.117.09.125.21.077a.657.657 0 01.336-.053c.202.022.357.136.504.264l.092.077c.007-.006.014-.013.022-.018-.019-.105-.035-.226-.149-.264-.157-.053-.324-.075-.508-.117l-.24-.005c.24-.169.452-.044.687.009-.063-.115-.153-.147-.23-.193-.082-.05-.17-.092-.25-.144-.06-.037-.12-.08-.072-.172zm10.233.325c-.23-.01-.427.08-.608.211-.034.026-.06.065-.105.117.087.026.15.046.232.065.044-.015.088-.03.13-.046.306-.114.61-.115.904.031.126.063.237.04.366-.005-.02-.031-.03-.054-.045-.071a.986.986 0 00-.448-.273c-.14-.044-.284-.024-.426-.03zM7.99 6.483a.308.308 0 00.002.133c.08.321.156.643.242.962.104.387.27.75.456 1.103.02.037.061.08.098.087a.404.404 0 00.253-.051l-.472-.84c-.23-.448-.405-.92-.579-1.394zM10.397.497c-.2-.008-.405.004-.603.034-.236.035-.47.087-.7.152-.287.08-.569.18-.852.273-.04.013-.074.038-.11.058.028.014.05.018.07.014.287-.068.58-.085.873-.09.134-.002.269.009.402.025.19.024.382.048.57.09.456.104.874.3 1.265.556.464.306.888.66 1.257 1.078.205.232.395.475.56.739.17.274.315.561.449.856.273.601.456 1.232.6 1.876.04.173.07.348.1.524.017.104.065.167.17.19.122.028.2.105.22.251-.003.102-.06.174-.129.24a1.065 1.065 0 00-.268.358.164.164 0 00.083-.039c.08-.086.162-.172.235-.265a.56.56 0 00.13-.333c.009-.05.022-.1.024-.15.007-.124-.017-.15-.143-.168-.025-.004-.049-.014-.073-.015-.082-.007-.125-.063-.137-.131-.033-.198-.004-.355.247-.408.086-.018.174-.03.26-.042.158-.023.315-.053.473-.067.14-.012.19.033.226.167.008.029.018.057.021.087.019.179-.008.225-.141.288-.027.013-.055.024-.078.042a.148.148 0 00-.051.067c-.039.144.073.382.206.445l.673.32c.023.011.05.015.075.023l.018-.026c-.015-.008-.032-.013-.044-.024a2.27 2.27 0 00-.544-.32 4.898 4.898 0 00-.173-.075.203.203 0 01-.126-.191c-.003-.085.045-.154.128-.187l.059-.025c.099-.044.118-.076.112-.187a.384.384 0 00-.008-.063c-.067-.294-.123-.59-.205-.88a9.478 9.478 0 00-.826-2.036 7.465 7.465 0 00-1.39-1.805 4.536 4.536 0 00-1.177-.824 3.656 3.656 0 00-1.016-.328 6.155 6.155 0 00-.712-.074zm6.719 5.955c.01.014.018.028.038.034l-.022-.044-.016.01zM4.103 3.917a.062.062 0 01-.03.012.455.455 0 01-.04.039c-.01.01-.02.02-.045.04l-.363.354c-.088.085-.17.178-.266.253-.284.22-.425.53-.544.855a.132.132 0 00-.007.071c.013.055.033.108.052.168l.074.026c-.017.056-.03.105-.047.152-.058.164-.118.327-.175.491-.005.015.008.036.019.077.08-.175.158-.33.225-.489.228-.544.484-1.074.819-1.561.09-.133.182-.266.283-.401.004-.006.007-.013.022-.03.001-.016.003-.032.015-.04l.008-.017zm12.976 2.408a.023.023 0 01.009.019.073.073 0 00-.006.01.188.188 0 00.007.02l.018.022c.002-.007.007-.016.005-.021-.003-.01-.012-.018-.02-.038a1.331 1.331 0 01-.013-.012zM4.199 4.48c-.003.004-.008.008-.027.014-.005.013-.011.025-.031.047a2.085 2.085 0 01-.124.167c-.048.07-.116.055-.181.041-.134-.028-.228.016-.287.143-.089.187-.187.37-.273.56-.049.108-.11.216-.118.36.081.003.154.007.228.008h.228a2.563 2.563 0 01-.079.264c-.01.052-.022.103-.033.155l.02.004c.018-.046.037-.092.067-.153.066-.142.13-.285.2-.426.02-.04.034-.1.116-.092 0 .043.004.084 0 .124-.005.045-.017.09-.028.143.141.043.086.174.115.269.102-.022.104-.195.248-.144v.205l.017.002.439-1.059c-.13 0-.246-.02-.358.033-.024.011-.058-.001-.108-.004.075-.15.139-.278.211-.417a.128.128 0 01.025-.036c0-.015-.001-.03.008-.038l.006-.02c-.005.006-.01.011-.028.017-.004.012-.009.024-.026.045a.085.085 0 01-.032.033c-.123.157-.09.164-.258.106-.079-.027-.078-.028-.047-.144.028-.046.056-.093.098-.15 0-.016-.001-.032.007-.042L4.2 4.48zm2.073-.67c-.003.006-.007.011-.027.016-.094.125-.194.246-.28.377-.155.238-.301.481-.451.723-.14.224-.345.368-.575.481-.017.008-.04.006-.079.011.012-.059.016-.109.033-.153a6.076 6.076 0 01.229-.518l-.007-.02a.138.138 0 01-.035.025c-.028.05-.055.1-.093.164-.26.424-.443.817-.442.95.024.004.048.011.073.013.177.013.188.007.26-.165.03-.07.077-.12.147-.15l.175-.07c.044-.018.085-.057.146-.032.003.05-.01.11.014.145.042.062.044.125.047.193.002.049.017.098.026.147.029-.034.039-.065.05-.097.142-.39.277-.782.428-1.17.1-.256.22-.504.33-.756.013-.03.013-.067.03-.092V3.81zm3.987-.34c0 .045.01.084.021.123.042.16.094.318.124.48.024.133.023.27.028.406 0 .033-.019.067-.032.11-.094-.058-.047-.158-.106-.215h-.125c-.015.072-.01.152-.046.2-.066.085-.155.154-.236.227-.043.038-.078.018-.103-.025l-.046-.087c-.065.035-.117.069-.172.093-.116.051-.235.095-.35.147-.085.038-.09.053-.07.147.014.075.034.148.047.223.013.072.05.109.123.124.233.05.462.115.657.265.058-.102.058-.102.168-.151.03-.014.06-.03.092-.042.08-.03.115-.017.15.06.023.048.041.098.066.158.06-.14-.042-.267.017-.416.157.18.24.39.375.567a.235.235 0 00.022-.098c.002-.124 0-.247.002-.371 0-.034.013-.067.02-.1l.032-.003c.11.155.13.354.226.52a3.036 3.036 0 00-.01-.392c-.004-.045 0-.074.05-.088.08.036.116.14.215.158-.03-.275-.423-1.137-.798-1.635-.114-.127-.2-.28-.34-.386zm-2.667.696c-.019.034-.03.05-.037.067-.061.185-.125.37-.18.556-.031.105-.087.169-.195.19-.09.019-.178.052-.268.073-.038.009-.089.015-.118-.003-.024-.016-.025-.069-.036-.106-.064.076-.082.087-.17.047-.133-.062-.262-.135-.393-.201-.048-.025-.093-.063-.17-.03-.043.12-.091.25-.137.382-.099.28-.087.242.095.453.046.048.102.03.154.023.054-.009.106-.03.16-.036.13-.013.26-.08.367-.015.204-.064.387-.122.571-.178.05-.015.089.005.114.054.022.042.034.093.082.121.038-.056-.013-.128.063-.178l.14.241-.042-1.46zm.278.358c-.096-.01-.107.01-.11.108-.002.038-.003.078.002.115.03.2.099.386.174.57.002.006.012.01.022.015l.078-.05c.052.036.081.088.153.088.205-.002.41.014.616.012.099-.001.158.042.205.12.018.03.024.077.088.066l-.08-.394c-.05-.195-.085-.395-.172-.589-.057.057-.114.068-.18.046a.72.72 0 00-.135-.028c-.22-.028-.44-.059-.66-.08zm10.254-1.727c.089.163.155.316.139.491-.016.168.026.342-.044.516-.047-.033-.088-.082-.112-.075-.117.035-.164-.057-.227-.115a4.772 4.772 0 01-.286-.29l-.104-.113a4.856 4.856 0 01-.023.019c.035.046.07.093.11.156.04.064.084.127.122.193.034.058.065.118.031.205-.082-.01-.164-.019-.246-.032-.06-.01-.101 0-.124.07-.031.098-.037.096-.15.09.02.042.036.08.057.116.041.074.03.138-.03.196-.06.06-.118.122-.178.181a.175.175 0 01-.185.046c-.222-.061-.447-.113-.67-.174-.032-.009-.063-.04-.086-.068-.03-.04-.052-.087-.08-.13-.044-.07-.09-.138-.136-.207a.18.18 0 00-.014.105c.012.127.03.253.035.38.005.1-.024.12-.121.104-.104-.017-.206-.04-.31-.058-.064-.012-.131-.028-.202.03l.081.208c.09 0 .166-.01.237.002a.819.819 0 01.458.251c.078.083.154.168.241.26l.018-.005c-.004-.006-.008-.013-.01-.04.014-.056-.062-.118.018-.178.031.03.064.057.088.09.058.078.111.159.169.257l.089.141.024-.013a2093.819 2093.819 0 01-.427-.934c.055.007.083.007.108.016.193.07.385.142.577.216.074.028.147.06.219.094.062.028.112.018.157-.033.05-.056.102-.112.154-.167.05-.051.095-.046.132.014.016.025.026.053.04.08.071.138.143.277.217.433l.159.308.025-.011c-.044-.106-.07-.218-.138-.334-.057-.182-.168-.346-.206-.545.136.034.362.326.567.732l.057.074.018-.011a1.563 1.563 0 01-.052-.127c-.046-.145-.097-.29-.136-.436-.022-.083-.036-.173.022-.26l.109.058-.026-.207.027-.016c.022.02.05.036.065.06.073.108.143.22.215.33.01.016.029.029.043.043-.036-.217-.2-.38-.229-.626l.155.112c.014-.166.012-.319.042-.465.032-.158-.023-.297-.063-.445.024.004.036.006.055.025.092.124.183.249.277.371.02.027.05.047.069.087l.04.063.019-.015a.293.293 0 01-.053-.082 27.922 27.922 0 01-.332-.49c-.221-.311-.363-.467-.485-.521zm-6.57.327c-.003.161.092.275.069.415l-.368.087c.09.139.032.237-.052.331-.05.057-.092.122-.143.178-.037.04-.046.078-.018.126l.16.275c.029.048.072.066.128.064.076-.003.152 0 .228-.001.116-.003.216.022.275.137.006.014.02.024.044.052.004-.059-.003-.098.01-.13.016-.04.04-.099.072-.108.084-.023.173-.024.26-.03.013-.001.027.018.04.029l.071.065c.019-.11-.082-.198-.024-.31l.126.04c-.026-.123-.07-.245-.071-.366 0-.123.051-.243.115-.36.107.062.16.156.234.253.183.265.36.533.494.834.165-.078.27.068.407.088-.003-.106-.133-.441-.197-.492a.142.142 0 00-.102-.028c-.06.011-.119.039-.191.063-.025-.039-.056-.078-.077-.122a3.936 3.936 0 00-.473-.783c-.076-.094-.16-.182-.228-.26l-.391.285c-.049.035-.094.03-.132-.017l-.169-.207c-.025-.03-.053-.059-.097-.108z'),
  pi: `<svg class="pv-kindlogo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F09082" d="M4.9587 4.9587H15.5208V12H12V8.4795H4.9587Z"/><path fill="#4D9ABF" d="M4.9587 8.4795H8.4795V12H12V15.5208H8.4795V19.0416H4.9587Z"/><path fill="#F1BE58" d="M15.5208 12H19.0416V19.0416H15.5208Z"/></svg>`,
};
// The logo markup for a kind, or '' for kinds that keep a text glyph (PI only).
export function kindLogo(kind){
  return KIND_LOGO[kind] || '';
}
const KIND_META = {
  pi:     { sig: '\u03C0', label: 'PI',     title: 'PI coding agent (pi-worker)' },
  claude: { sig: KIND_LOGO.claude, label: 'Claude', title: 'Claude Code agent (agent-worker)' },
  codex:  { sig: KIND_LOGO.codex, label: 'Codex',  title: 'Codex CLI agent (agent-worker)' },
  hermes: { sig: KIND_LOGO.hermes, label: 'Hermes', title: 'Hermes session' },
};
export function kindMeta(kind){
  const m = KIND_META[kind];
  return m ? { ...m, color: `var(--kind-${kind})` }
           : { sig: '\u25CF', color: 'hsl(215 16% 55%)', label: kind || '?', title: '' };
}
// The one list the count badges AND the tiles are built from: Hermes live rows
// of the ON profiles ('All' is skipped), DATA.pi_live, de-duplicated agent_live.
export function fleetTiles(profiles, piLive, agentLive){
  const out = [];
  const seen = new Set();
  Object.keys(profiles || {}).forEach(n => {
    if (n === 'All') return;
    ((profiles[n] && profiles[n].live) || []).forEach(L => {
      if (L && !seen.has(L.id)) { seen.add(L.id); out.push({ kind: 'hermes', S: L }); }
    });
  });
  (piLive || []).filter(Boolean).forEach(S => out.push({ kind: 'pi', S }));
  dedupAgentLive(agentLive).forEach(S => out.push({ kind: S.engine === 'codex' ? 'codex' : 'claude', S }));
  return out;
}
// Zero dims a kind, never hides it. All = sum of the tiles.
export function fleetKindCounts(profiles, piLive, agentLive){
  const c = { hermes: 0, pi: 0, claude: 0, codex: 0 };
  fleetTiles(profiles, piLive, agentLive).forEach(t => { c[t.kind]++; });
  c.all = c.hermes + c.pi + c.claude + c.codex;
  return c;
}
// A Hermes session quiet for longer than this reads Idle (the live query
// itself drops sessions after 600s). PI/Claude/Codex report phase 'idle'.
export const TILE_IDLE_S = 120;
export function kindBadge(kind){
  const meta = kindMeta(kind);
  // Icon-only: the glyph carries the visible signal; the text label
  // (meta.label) only lives in the title tooltip now — less chrome in a row
  // that is already dense with chips, meaning still discoverable on hover.
  return `<span class="pv-badge" data-kindbadge="${kind}" title="${escA(meta.title)}"`
    + ` style="color:${meta.color};border-color:color-mix(in srgb,${meta.color} 45%,transparent);background:color-mix(in srgb,${meta.color} 12%,var(--card))">`
    + `${meta.sig}</span>`;
}

// Live board = a compact table panel (Grafana-style). One .liverow per
// session, eight cells in a fixed grid shared with the sticky header (#livehead):
// kind | session | model (.metacol) | state (+ elapsed on its second line) |
// tokens | cost | last activity | load (.loecol). Sorting only reorders the keyed rows (applyDiff
// moves them), so refresh behaviour is unchanged.
export const LV_COLS = [
  { k: 'kind', t: 'Kind', ico: true }, { k: 'session', t: 'Session' }, { k: 'model', t: 'Model' },
  { k: 'state', t: 'State' }, { k: 'elapsed', t: 'Elapsed', num: true }, { k: 'tokens', t: 'Tokens', num: true },
  { k: 'cost', t: 'Cost', num: true }, { k: 'activity', t: 'Last activity' }, { k: 'load', t: 'Load', num: true },
];
export const lvSort = { key: null, dir: 'asc' };
const STATE_RANK = { Running: 0, Compressing: 1, Waiting: 2, Idle: 3 };
export function liveState(kind, S){
  if (kind === 'hermes') {
    if (Number.isFinite(S.idle_s) && S.idle_s > TILE_IDLE_S) return 'Idle';
    // Compression is a state of the row, not a chart slice (Home feedback).
    return /compress/i.test(S.phase || '') && !/completed|done|finished/i.test(S.phase || '') ? 'Compressing' : 'Running';
  }
  if (S.phase === 'idle') return 'Idle';
  return /wait|approv|blocked|input/i.test(S.phase || '') ? 'Waiting' : 'Running';
}
const usd = c => '$' + (+c).toFixed(c < 1 ? 3 : 2);
// Claude Code / Codex run on a flat Claude / ChatGPT subscription: their cost
// is the API-price equivalent, shown muted with a "sub" badge and kept out of
// every spend total.
const COVERED_PLAN = { claude: 'Claude', codex: 'ChatGPT' };
const coveredTip = kind => `API-price equivalent, covered by your ${COVERED_PLAN[kind] || 'subscription'} subscription`;
function coveredCost(kind, text){
  const tip = escA(coveredTip(kind));
  return `<span class="lvcov" role="img" title="${tip}" aria-label="${escA(text)}, ${tip}">${esc(text)}<span class="lvsubb">subscription</span></span>`;
}
// Owner badge: the profile / login / agent that owns a row. Hermes profiles are
// tinted with the same profileHue() the profile tabs use, so one colour means one
// profile everywhere; pi / Claude / Codex owners take their kind colour token.
export function ownerBadge(name, what, kindColor){
  const n = name || '';
  if (!n) return '';
  let style;
  if (kindColor) style = `color:color-mix(in srgb,${kindColor} 60%,var(--fg));background:color-mix(in srgb,${kindColor} 18%,var(--card));border:1px solid color-mix(in srgb,${kindColor} 45%,transparent)`;
  else { const h = profileHue(n); style = `background:hsl(${h} 62% 30%);color:hsl(${h} 80% 78%);border:1px solid hsl(${h} 55% 42%)`; }
  return `<span class="lvtag lvowner" data-owner="${escA(n)}" style="${style}" title="${escA(what || 'Profile')}: ${escA(n)}">${esc(n)}</span>`;
}
// Short session id (last 6 chars; the full id is in title=). With `open` it is a
// button that opens the transcript, like the title.
export function sidChip(id, open, profile){
  const full = String(id || '');
  if (!full) return '';
  const short6 = full.slice(-6);
  return open
    ? `<button type="button" class="lvsid ttitlebtn" data-tsession="${escA(full)}" data-tprofile="${escA(profile || '')}" title="${escA(full)} \u2014 open transcript">${esc(short6)}</button>`
    : `<span class="lvsid" title="${escA(full)}">${esc(short6)}</span>`;
}
// Per-worker token history for sparklines (last 12 polls).
const WORKER_TOK_HIST = new Map();
function workerTokPush(key, tok){ if(!key) return; const h = WORKER_TOK_HIST.get(key) || []; h.push(tok || 0); if(h.length > 12) h.shift(); WORKER_TOK_HIST.set(key, h); }
// Hermes rows from older payloads carry no `profile`; the owner is then the
// profile whose live list holds the session.
function profileOf(L){
  if (L.profile) return L.profile;
  for (const [n, q] of Object.entries(DATA.profiles || {})){
    if (n !== 'All' && q && (q.live || []).some(x => x && x.id === L.id)) return n;
  }
  return current && current !== 'All' ? current : '';
}
// o: {kind, attrs, lead, title, tags, model, mcol, mextra, S, tok, cost, up, tools, gauge, bw}
function lvRow(o){
  const S = o.S, st = liveState(o.kind, S);
  const ago_ = Number.isFinite(S.idle_s) ? ago(S.idle_s) + ' ago' : '—';
  const pct = (/aria-valuenow="(\d+)"/.exec(o.gauge) || [])[1];
  // Line two of Last activity: the tool chips (the CSS shows the first three that
  // fit and hides the rest whole; the full list is in the cell's title=).
  const allTools = escA((o.tools || []).filter(Boolean).join(', '));
  const tools = (o.tools || []).slice(0, 5).map(t =>
    `<span class="lvtool" title="${escA(t)}">${esc(t)}</span>`).join('');
  const _pi = `<span class="lvprovicon" style="margin-right:4px">${provLogoSvg(short(o.model))}</span>`;
  const html = `<div class="liverow lvrow items-center" role="row" data-lvstate="${st.toLowerCase()}"${S.idle_s > 86400 ? ' data-longidle="1"' : ''}${o.attrs}>
      <div class="lvc lvc-kind" role="cell">${kindBadge(o.kind)}</div>
      ${o.sub ? `<div class="lvc lvc-sess lvc-sess2" role="cell"><div class="lvstk"><div class="lvs1">${o.lead || ''}${o.title}</div><div class="lvs2">${o.sub}</div></div></div>`
        : `<div class="lvc lvc-sess" role="cell"><div class="lvstk"><div class="lvs1">${o.lead || ''}${o.title}</div></div></div>`}
      <div class="lvc metacol" role="cell">${_pi}<div class="lvmodel text-[length:var(--fs-sm)] muted truncate leading-tight" style="color:${o.mcol}" title="${escA(short(o.model))}">${esc(short(o.model) || '—')}</div>${o.mextra ? `<div class="lvmx">${o.mextra}</div>` : (o.prov ? `<div class="lvmx"><span class="lvprov">${provBadge(o.prov)}</span></div>` : '')}</div>
      <div class="lvc lvc-state" role="cell"><div class="lvstk"><span class="lvst" data-state="${st.toLowerCase()}">${st}</span><span class="lvel" title="running since session start">${Number.isFinite(S.uptime_s) ? ago(S.uptime_s) : '—'}</span></div></div>
      <div class="lvc lvnum" role="cell" title="tokens in + out">${o.tok ? fmt(o.tok) : '—'}${o.tok ? `<div class="lvspark">${sparkSvg(WORKER_TOK_HIST.get(S.id) || [], o.mcol || '#888', {w:48,h:12,pad:1})}</div>` : ''}</div>
      <div class="lvc lvnum" role="cell" title="${o.cost && o.covered ? escA(coveredTip(o.kind)) : 'estimated cost for this session'}">${o.cost ? (o.covered ? coveredCost(o.kind, o.cost) : esc(o.cost)) : '—'}</div>
      <div class="lvc lvc-act" role="cell"><div class="lva1"><span class="lvago">${ago_}</span><span class="lvphase" title="${escA(S.phase || '')}">${esc(S.phase || '—')}</span></div>${tools ? `<div class="lva2" title="${allTools}">${tools}</div>` : ''}</div>
      <div class="lvc loecol" role="cell">${o.gauge}${pct != null ? `<span class="lvpct">${pct}%</span>` : ''}${o.bw || ''}</div>
    </div>${o.panel || ''}`;
  const num = v => Number.isFinite(+v) && v != null ? +v : null;
  return { key: o.key, html, sv: {
    kind: o.kind, session: (S.title || '').toLowerCase(), model: short(o.model).toLowerCase() || null,
    state: STATE_RANK[st], elapsed: num(S.uptime_s), tokens: o.tok || null, cost: num(o.costv),
    activity: num(S.idle_s), load: pct != null ? +pct : null } };
}
// Stable sort by the active header; missing values always sink to the bottom.
export function sortLiveRows(rows){
  if (!lvSort.key) return rows;
  const d = lvSort.dir === 'desc' ? -1 : 1, k = lvSort.key;
  return rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => {
    const x = a.sv[k], y = b.sv[k];
    if (x == null && y == null) return i - j;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return c ? c * d : i - j;
  }).map(p => p[0]);
}
// Eight grid tracks, nine sortable headers: Elapsed lives on the State cell's
// second line, so its header sits under State inside the same track.
export function lvHeadHtml(){
  const one = c => {
    const on = lvSort.key === c.k;
    return `<div class="lvh${c.num ? ' lvnum' : ''}" role="columnheader" tabindex="0" data-sort="${c.k}"`
      + ` aria-sort="${on ? (lvSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"`
      + ` title="Sort by ${c.t.toLowerCase()}">${c.t}<span class="lvarr" aria-hidden="true">${on ? (lvSort.dir === 'desc' ? '▼' : '▲') : ''}</span></div>`;
  };
  const out = [];
  for (let i = 0; i < LV_COLS.length; i++){
    const c = LV_COLS[i];
    if (c.k === 'state') out.push(`<div class="lvhgrp" role="presentation">${one(c)}${one(LV_COLS[i + 1])}</div>`);
    else if (c.k !== 'elapsed') out.push(one(c));
  }
  return out.join('');
}
// applyDiff's reorder pass is built for adds/removes, not arbitrary
// permutations, so after it runs the groups (row + optional panel) are put in
// the wanted order here. A no-op whenever the order already matches.
function orderLiveRows(box, rows){
  const groups = new Map(), have = [];
  [...box.children].forEach(el => {
    if (el.classList.contains('diff-ghost')) return;
    const k = liveGroupKeyOf(el);
    if (k == null) return;
    if (!groups.has(k)){ groups.set(k, []); have.push(k); }
    groups.get(k).push(el);
  });
  const want = rows.map(r => r.key).filter(k => groups.has(k));
  if (want.join('\u0001') === have.join('\u0001')) return;
  want.forEach(k => groups.get(k).forEach(el => box.appendChild(el)));
}
// Click or Enter/Space on a header: none -> ascending -> descending -> none.
export function installLiveSort(){
  const head = $('livehead');
  if (!head || head.dataset.sortInstalled) return;
  head.dataset.sortInstalled = '1';
  const hit = e => {
    const h = e.target.closest && e.target.closest('[data-sort]');
    if (!h) return;
    const k = h.getAttribute('data-sort');
    if (lvSort.key !== k){ lvSort.key = k; lvSort.dir = 'asc'; }
    else if (lvSort.dir === 'asc') lvSort.dir = 'desc';
    else lvSort.key = null;
    renderLive();
    const again = head.querySelector(`[data-sort="${k}"]`);
    if (again && e.type === 'keydown') again.focus();
  };
  head.addEventListener('click', hit);
  head.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); hit(e); }
  });
}

// PI sessions (#245) have no sqlite state; their JSONL files are the live state, so
// they ride DATA.pi_live and share '#livelist' with Hermes rows (keyed 'pi:'+id).
// LST-251: Hermes parity -- loeIcon gauge (S.tools_gauge), tool chips, model-switch
// note, uptime. No bandwidth: PI tracks no byte counters.
function piLiveRows(list){
  return (list || []).filter(Boolean).map(S => {
    const tok = (+S.in_tok||0) + (+S.out_tok||0);
    return lvRow({ kind: 'pi', key: 'pi:' + (S.session_id || ''), S, tok, tools: S.tools,
      costv: S.cost_usd || null, cost: S.cost_usd ? '$' + (+S.cost_usd).toFixed(4) : '',
      attrs: ` data-pisession="${escA(S.session_id||'')}" data-piagent="${escA(S.agent||'')}"`,
      title: `<span class="lvtitle text-[length:var(--fs-md)] font-semibold" title="${escA(S.title || '')}">${esc(S.title || S.agent || 'pi session')}</span>`,
      sub: ownerBadge(S.agent || 'pi', 'Agent', 'var(--kind-pi)') + `<span class="lvsrc" title="Session source">PI</span>` + sidChip(S.session_id),
      model: S.model, mcol: colorOf(short(S.model)),
      mextra: S.switched ? `<span class="lvswitch" title="started on ${escA(short(S.init_model))}">${provLogoSvg(short(S.init_model))}↯ from ${esc(short(S.init_model))}</span>` : '',
      gauge: loeIcon({...S, tools:S.tools_gauge||S.tools}, {id:'pi:'+(S.session_id||''), size:'sm', label:(S.title&&S.title!=='pi session')?S.title:'session load'}) });
  });
}

// Claude Code / Codex CLI sessions (agent-worker) ride DATA.agent_live, one
// flat fleet-wide list tagged with `engine`. Same row shape as PI rows, keyed
// '<engine>:<session id>' so ids cannot collide across engines or with Hermes.
function agentLiveRows(list){
  return dedupAgentLive(list).map(S => {
    const engine = S.engine === 'codex' ? 'codex' : 'claude';
    const tok = (+S.in_tok||0) + (+S.out_tok||0);
    return lvRow({ kind: engine, key: engine + ':' + (S.session_id || ''), S, tok,
      costv: Number.isFinite(S.cost_usd) ? S.cost_usd : null, cost: Number.isFinite(S.cost_usd) ? usd(S.cost_usd) : '',
      covered: S.cost_class === 'subscription',
      attrs: ` data-agentsession="${escA(S.session_id||'')}" data-engine="${engine}"`,
      title: `<span class="lvtitle text-[length:var(--fs-md)] font-semibold" title="${escA(S.title || '')}">${esc(S.title || engine + ' session')}</span>`,
      sub: ownerBadge(S.login || engine, S.login ? 'Login' : 'Agent', `var(--kind-${engine})`) + `<span class="lvsrc" title="Session source">${engine === 'codex' ? 'Codex' : 'Claude'}</span>` + sidChip(S.session_id),
      model: S.model, mcol: colorOf(short(S.model)),
      gauge: '' });
  });
}

export function renderLive(){
  const p = DATA.profiles[current] || {};
  renderLiveKpis(p, current, undefined, DATA.profiles, DATA.agent_live, DATA.pi_live);
  renderOllama(DATA.ollama);
  renderQueue();
  // The merged All key has no `agents` (see mergedField), which left the
  // agents card hidden whenever 2+ profiles were on; each row names its profile.
  renderAgents(current === 'All' ? mergedField(DATA.profiles, 'agents') : p.agents);
  // Deduplicate live sessions by ID — the All tab can merge the same session from
  // two profiles, and the 5s poll can occasionally return duplicates mid-refresh.
  const seen = new Set();
  const live = (p.live || []).filter(L => { if(seen.has(L.id)) return false; seen.add(L.id); return true; });
  // PI sessions (#245) are not scoped to a Hermes profile, they have no
  // sqlite row to filter by, so they show on every tab, merged into this
  // same list.
  const piRows = piLiveRows(DATA.pi_live);
  const agentRows = agentLiveRows(DATA.agent_live);
  const box = $('livelist');
  if(!box) return;
  // Sticky header: only repainted when the sort changes, so a 5s poll never
  // steals keyboard focus from a header cell.
  const head = $('livehead');
  if (head){
    const sig = lvSort.key + ':' + lvSort.dir;
    if (head.dataset.sig !== sig){ head.innerHTML = lvHeadHtml(); head.dataset.sig = sig; }
    head.hidden = !(live.length || piRows.length || agentRows.length);
  }

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
          return `<button type="button" class="chip livefanout-chip ttitlebtn" data-tsession="${escA(pid)}" data-tprofile="${escA(current)}">${esc(parentTitle)} \u2192 ${n} running</button>`;
        }).join(' ')
      : '';
    fanoutEl.hidden = fanouts.length === 0;
  }

  if(!live.length && !piRows.length && !agentRows.length){
    // Fade the list out (if it had content), then show the empty state.
    // applyDiff can't do this: the empty state is not a keyed row, it is a
    // swap of the whole box. Only rebuild when the content actually changes,
    // so an idle poll doesn't fight the fade mid-flight.
    const swap = (post) => {
      box.innerHTML = emptyHTML('○', 'Nothing running right now.', 'Start an agent run and it will appear here within a few seconds.');
      box.dataset.state = 'empty';
      if (post) post();
    };
    if (box.dataset.state !== 'empty'){
      const hadRows = box.children.length > 0;
      if (hadRows && !motionReduced()){
        box.classList.add('live-fadeout');
        setTimeout(() => { swap(); box.classList.remove('live-fadeout'); }, 180);
      } else swap();
      invalidate(box);
    }
  } else {
    // Keyed diff refresh (P10 presentation plane): rows are reused by session
    // id, patched in place when their content changes, faded out when a
    // session completes and faded in when one starts — so a 5s poll no longer
    // tears down the whole list (hover, focus and scroll anchors survive).
    const rows = live.map(L => {
      const c = catOf(L.category);
      const mcol = colorOf(short(L.model));
      const tok = sessTotals(L).k;
      workerTokPush(L.id, tok);
      const prof = profileOf(L);
      return lvRow({ kind: 'hermes', key: L.id, S: L, tok, tools: L.tools, mcol, model: L.model, costv: null, cost: '',
        prov: provOf('', L.model, L.base_url),
        lead: `<span class="lvcat" style="color:${c.c}" title="${escA(L.category)}">${c.i}</span>`,
        title: `<button type="button" class="ttitlebtn lvtitle text-[length:var(--fs-md)] font-semibold truncate" data-tsession="${escA(L.id)}" data-tprofile="${escA(prof)}" title="${escA(L.title)} — open transcript">${esc(L.title)}</button>`,
        sub: ownerBadge(prof, 'Profile')
          + (L.source ? `<span class="lvsrc" title="Session source: ${escA(L.source)}">${esc(L.source)}</span>` : '')
          + sidChip(L.id, true, prof)
          + `<button type="button" class="chip lntimelinebtn" data-tsession="${escA(L.id)}" data-tprofile="${escA(prof)}" data-title="${escA(L.title)}" title="${escA(L.title)} \u2014 view timeline">Timeline</button>`
          + `<span class="lvcatl" style="color:${c.c}" title="${escA(L.category)}">${esc(L.category)}</span>`
          + (L.kind==='subagent' ? '<span class="lvsub">\u21b3 subagent</span>' : ''),
        mextra: (L.switched ? `<span class="lvswitch" title="router fell back from ${escA(short(L.init_model))}">${provLogoSvg(short(L.init_model))}↯ from ${esc(short(L.init_model))}</span>` : '') + modelsBadge(L),
        gauge: loeIcon(L, {id:L.id, size:'sm', label:(L.title&&L.title!=='(untitled)')?L.title:'session load'}), bw: bwRow(L),
        panel: modelsPanel(L) });
    });
    // PI sessions (#245) are interleaved into the same keyed array — they use
    // the SAME liverow shape (just kindBadge('pi') instead of 'hermes') and
    // share this one applyDiff call, so a reader does not learn a second
    // layout for a second list to answer "what is running right now".
    rows.push(...piRows, ...agentRows);
    // Keyed-diff applier (P10 presentation plane). If every row's HTML is
    // byte-identical to the last render the applier is a no-op (per-key
    // cache) — idle polls touch zero nodes; genuine changes patch in place
    // with fade-in (new sessions) / fade-out (completed sessions).
    const ordered = sortLiveRows(rows);
    applyDiff(box, liveGroupKeyOf, ordered);
    orderLiveRows(box, ordered);
    box.dataset.state = 'rows';
  }
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

  renderHomeSeries(p);

}

// Home time-series: calls and tokens per hour for the last 6 hours, from the
// hour-grain rows already in the page payload (p.hour_rows, local-time buckets).
// A bucket with no rows plots as 0 — that is what the data says. Reuses the
// shared mk() factory and legend table; no new collector.
export const HOME_HOURS = 6;
export function homeSeries(p, now){
  const end = new Date(now); end.setMinutes(0, 0, 0);
  const keys = [], labels = [];
  for (let k = HOME_HOURS - 1; k >= 0; k--){
    const d = new Date(end.getTime() - k*3600e3);
    keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}|${d.getHours()}`);
    labels.push(String(d.getHours()).padStart(2,'0') + ':00');
  }
  const calls = keys.map(() => 0), tokens = keys.map(() => 0);
  (p.hour_rows || []).forEach(r => {
    const i = keys.indexOf(`${r.date}|${+r.hour}`);
    if (i < 0) return;
    calls[i] += +r.calls || 0;
    tokens[i] += (+r.inp || 0) + (+r.outp || 0);
  });
  return {labels, calls, tokens};
}
function renderHomeSeries(p){
  if (!$('cHome6h')) return;
  const s = homeSeries(p, Date.now());
  const fill = c => c + '1a';
  mk('cHome6h', 'line', s.labels, [
    {label:'Calls', data:s.calls, borderColor:PAL[0], backgroundColor:fill(PAL[0]), fill:true,
     tension:.3, pointRadius:0, borderWidth:1.5, yAxisID:'y'},
    {label:'Tokens', data:s.tokens, borderColor:PAL[2], backgroundColor:fill(PAL[2]), fill:true,
     tension:.3, pointRadius:0, borderWidth:1.5, yAxisID:'y1'}],
    {lgt:[v => Math.round(v).toLocaleString(), fmt], interaction:{mode:'index', intersect:false},
     ...(motionReduced() ? {animation:false} : {}),
     scales:{x:{grid:{display:false}}, y:{position:'left', beginAtZero:true, grid:{color:BD}, ticks:{precision:0}},
       y1:{position:'right', beginAtZero:true, grid:{display:false}, ticks:{precision:0, callback:v => Number.isInteger(v) ? fmt(v) : ''}}}});
}

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
      o.n += m.n || 0; o.ok += m.ok || 0; o.cost_usd += m.cost_usd || 0;
      o.tokens += m.tokens || 0; o.hours += m.hours || 0;
      o.wasted_hours += m.wasted_hours || 0;
    });
    (g.tools || []).forEach(t => {
      const o = T[t.tool] || (T[t.tool] = {tool:t.tool, calls:0, fail:0});
      o.calls += t.calls || 0; o.fail += t.fail || 0;
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
    // fail can exceed calls in merged data; clamp so a rate is always 0–100.
    ...t, rate: t.calls ? Math.round(1000*Math.max(0, t.calls-t.fail)/t.calls)/10 : 0,
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
export async function doRefresh(silent){
  const b = $('refresh');
  if (b.dataset.busy) return;
  b.dataset.busy = '1'; if(!silent) b.style.opacity = '.5';
  try {
    const r = await fetch('analytics-data.json?t=' + Date.now(), {cache:'no-store'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const fresh = await r.json();
    const bad = schemaProblem(fresh, 'analytics-data.json');
    if (bad) { showSchemaError(bad); throw new Error(bad); }
    if (!fresh.profiles || !Object.keys(fresh.profiles).length) throw new Error('empty payload');
    // Router data (#130) is merged at BUILD time only; swapping DATA wholesale
    // would blank the Router tab on refresh, so fetch the hourly payload too;
    // anything short of a good payload keeps what the page
    // booted with rather than emptying the tab.
    let router = null;
    try {
      const rr = await fetch('router-data.json?t=' + Date.now(), {cache:'no-store'});
      if (rr.ok) {
        const rd = await rr.json();
        // Shape, not just version: the tab is addressed by profile name, and a
        // payload without router data (the analytics one, say) would put every
        // profile there with no tier_router on it — the same empty tab, arrived
        // at more confusingly. `vocab` is written by collect_router alone.
        if (rd && rd.schema_version === SCHEMA_VERSION && rd.vocab && rd.profiles) {
          router = { profiles: rd.profiles,
                     meta: { vocab: rd.vocab, collected_at: rd.collected_at } };
        }
      }
    } catch (e){ /* keep the built-in router payload */ }
    // Same treatment for the Quota tab (#115): it reads DATA.quota, which
    // build_dashboard.py folds in from quota-data.json. Guarded by attention_percent
    // because collect_quota writes it alone — a payload without it carries no
    // per-profile headroom, so accepting it would blank the tab.
    let quota = null;
    try {
      const qr = await fetch('quota-data.json?t=' + Date.now(), {cache:'no-store'});
      if (qr.ok) {
        const qd = await qr.json();
        if (qd && qd.schema_version === SCHEMA_VERSION
            && qd.attention_percent && qd.profiles) {
          quota = { profiles: qd.profiles,
                    meta: { collected_at: qd.collected_at,
                            attention_percent: qd.attention_percent,
                            summary: qd.summary || {} } };
        }
      }
    } catch (e){ /* keep the built-in quota payload */ }
    const keepFrom = $('from').value, keepTo = $('to').value, keepProfile = current;
    const prevRouter = DATA.router, prevRouterMeta = DATA.router_meta;
    const prevQuota = DATA.quota, prevQuotaMeta = DATA.quota_meta;
    DATA = fresh;
    // Keep the tab populated even if the hourly payload could not be fetched:
    // stale router data beats an empty tab that reads like the job never ran.
    DATA.router = router ? router.profiles : prevRouter;
    DATA.router_meta = router ? router.meta : prevRouterMeta;
    DATA.quota = quota ? quota.profiles : prevQuota;
    DATA.quota_meta = quota ? quota.meta : prevQuotaMeta;
    // #121: re-filter through the ON set (this also rebuilds the merge).
    // installAll() alone would put the raw profile map back and lose the
    // toggles; pvFilter() reads PV_ALL, which the capture below refreshes.
    PV_ALL = Object.fromEntries(Object.entries(DATA.profiles).filter(([n]) => n !== 'All'));
    DATA.profiles = pvFilter();
    // A model can appear for the first time in a refresh; recompute the global
    // palette so it gets a stable shade instead of the grey fallback.
    COLORS = buildColors(allModelNames());
    TOOLCOLORS = buildToolColors(allToolNames());
    tabs();
    renderResolution();
    // keep the user where they were: the same profile if it is still shown,
    // else the merge, else whatever is left.
    pick(DATA.profiles[keepProfile] ? keepProfile
       : ('All' in DATA.profiles ? 'All' : Object.keys(DATA.profiles)[0]));
    // restore the range the user was looking at, when it is still in bounds
    if (keepFrom) $('from').value = keepFrom;
    if (keepTo) $('to').value = keepTo;
    render();
  } catch (e) {
    $('meta').textContent = 'refresh failed: ' + e.message + ' — showing last good data';
  } finally {
    b.dataset.busy = ''; b.style.opacity = '';
  }
}
$('refresh').onclick = () => doRefresh(false);

// ---- fast live polling -------------------------------------------------
// Live data is the one thing that is genuinely "now", so it gets its own tiny
// endpoint (~2 KB, 56 ms to build) polled every 5s, independent of the 60s
// full refresh. Only the Live view's data is swapped, so cost/usage charts are
// never rebuilt by a live tick.
export const LIVE_MS_DEFAULT = 5000;
// P7-05 (#112): live poll cadence, live-adjustable. A let (not const) so
// changing it in the Advanced settings card takes effect on the very next
// setInterval tick without a page reload.
export let LIVE_MS = (POWER.intervals && POWER.intervals.live_poll_interval_s
  ? Math.round(POWER.intervals.live_poll_interval_s * 1000) : LIVE_MS_DEFAULT);
export let liveBusy = false, liveFails = 0;

// ---- Completion sound (#105): ON by default (only an explicit saved 'off' mutes),
// Web Audio (no audio file to ship, ADR 0001). Browsers keep audio locked until a
// first click/key; armAudioUnlock() handles that.
export let soundOn = localStorage.getItem('lt-sound') !== '0';
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

// Debounce: completions within 2s play as one tone; `kind` escalates to 'fail'
// if any failed. Always schedules a play (timed past the window), never drops one.
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
    (f.recent_delegations || []).forEach((d, i) => {
      // A delegation that has not finished is not a completion: no tone, and
      // not remembered, so it is announced once it really ends.
      if (/^(running|pending|queued)$/i.test(d.state || '')) return;
      // Id-less rows still need distinct keys, or they collapse onto one.
      const key = d.id != null ? d.id : `anon:${d.completed_at ?? ''}:${d.state ?? ''}:${i}`;
      if (seenDeleg.has(key)) return;
      seenDeleg.add(key);
      if (soundBaseline) return;
      any = true;
      scheduleTone(/error|fail|interrupt|cancel|timeout/i.test(d.state || '') ? 'fail' : 'success');
    });
  });
  return any;
}

// Browsers keep an AudioContext suspended until a user gesture. A page that
// restores lt-sound=1 from storage has had no gesture yet, so the first tone
// would be scheduled on a suspended context and never heard. Unlock on the
// first real interaction (pointer / key / touch), then drop the listeners.
export let audioUnlocked = false;
export function unlockAudio(){
  try {
    const ctx = ensureAudioCtx();
    audioUnlocked = ctx.state === 'running';
    return ctx;
  } catch (e) { return null; }
}
export function armAudioUnlock(target){
  const t = target || window;
  const evs = ['pointerdown', 'keydown', 'touchend', 'click'];
  const off = () => evs.forEach(e => t.removeEventListener(e, on, true));
  const on = () => {
    const ctx = soundOn ? unlockAudio() : null;
    if (!soundOn) return;            // nothing to unlock yet; the toggle click does it
    if (ctx && ctx.state === 'running') off();
  };
  evs.forEach(e => t.addEventListener(e, on, true));
  return off;
}

// A NEW critical alert (never one already present at page load) sounds the
// failure tone once. Keyed by id/title so a 5s repaint does not repeat it.
// State lives on the function: renderLiveKpis runs during the first render,
// before module-level `let`s further down are initialised (TDZ).
export function checkCriticalAlerts(list){
  const st = checkCriticalAlerts.st || (checkCriticalAlerts.st = { seen: new Set(), baseline: true });
  let fresh = false;
  (list || []).forEach((a, i) => {
    if (!a || a.severity !== 'critical') return;
    const key = a.id != null ? a.id : `${a.title || a.message || ''}:${a.profile || ''}:${i}`;
    if (st.seen.has(key)) return;
    st.seen.add(key);
    if (!st.baseline) fresh = true;
  });
  st.baseline = false;
  if (fresh) scheduleTone('fail');
  return fresh;
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
    const label = soundOn ? 'Sound on \u2014 click to mute' : 'Sound off \u2014 click to unmute';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  armAudioUnlock();
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
export async function pollLive(){
  // The drawer is reachable from every tab, so the feed must keep running even
  // when Live is not on screen. Only a hidden document stops it.
  // A hidden tab only keeps polling while sound is on: that is exactly when a
  // completion tone is wanted and nobody is looking at the page.
  if (liveBusy || (document.hidden && !soundOn)) return;
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
    if (document.hidden) {   // sound-only poll: no repaint, but critical alerts still sound
      checkCriticalAlerts(mergedField(fresh.profiles, 'alerts').filter(Boolean));
      liveFails = 0; return;
    }
    // #185: the payload is fresh from here on; record it before the repaint so
    // a paint error cannot leave the pill claiming an older poll than the data.
    liveUpdatedAt = Math.floor(Date.now() / 1000);
    // #184: sample the RAW per-profile slices (no synthetic 'All' key) so a
    // session is counted once, under the profile that owns it.
    sampleThroughput(fresh.profiles, liveUpdatedAt);
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
    // PI agent sessions (#245): global, like ollama above -- not scoped to a
    // Hermes profile, so there is nothing per-profile to merge it into.
    DATA.pi_live = fresh.pi_live || [];
    // Claude Code / Codex agent-worker sessions: global too.
    DATA.agent_live = fresh.agent_live || [];
    // #121: re-apply the ON set. The live slice was merged INTO PV_ALL's
    // profiles above, so re-filtering keeps the toggles honoured while the
    // merge picks up the fresh live rows.
    PV_ALL = Object.fromEntries(
      Object.entries(PV_ALL).map(([n, p]) => [n, DATA.profiles[n] || p]));
    DATA.profiles = pvFilter();
    tabs();
    drawerSync();
    // Repaint unconditionally: gating on the Live view left it stale on other tabs.
    renderLive();
    navSync();
    liveFails = 0;
    tickLiveStamp();
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
export function scheduleLivePoll(){
  liveTimer = setTimeout(() => { pollLive(); scheduleLivePoll(); }, LIVE_MS);
}
export let liveTimer = null;
// #185: freshness pill. tickLiveStamp() rewrites it from `liveUpdatedAt` every tick,
// via dataset.stampBase, because stampFreshness caches the first text it sees.
export let liveUpdatedAt = null;
export function tickLiveStamp(now){
  const t = $('livestamp');
  if (!t) return null;
  if (liveUpdatedAt == null) return null;
  const at = now == null ? Math.floor(Date.now() / 1000) : now;
  const age = Math.max(0, at - liveUpdatedAt);
  t.dataset.stampBase = age < 1 ? 'live · updated just now' : `live · updated ${ago(age)} ago`;
  // #149/#185: the live panel ages against the ticket's absolute cuts (green
  // under 30 s, amber 30-90 s, red past 90 s) instead of the 5 s poll cadence,
  // so two missed polls no longer paint a healthy feed red. A red stamp also
  // routes to Health via the feeder timer named in its tooltip.
  return stampFreshness(t, liveUpdatedAt, 'liveboard', at, {health: true});
}
// One-second tick so the age is honest even when polling is stalled (a stalled
// poll never calls tickLiveStamp, so the stamp would otherwise lie at "4s ago").
export let liveStampTimer = null;
export function scheduleLiveStampTick(){
  liveStampTimer = setTimeout(() => { tickLiveStamp(); scheduleLiveStampTick(); }, 1000);
}
scheduleLivePoll();
scheduleLiveStampTick();
installDrawer();
installLiveSort();
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
// #146: the help overlay had a close button and no wiring at all — one install.
installHelp();
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
