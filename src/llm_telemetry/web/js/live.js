/**
 * Live: the live session list, host cards, gauges and the polling loop
 * (including the completion sound).
 */
import {
  $, BD, COLORS, PAL, TOOLCOLORS, ago, allModelNames, allToolNames, buildColors, buildToolColors, bwPrev, bwPrevAt, catOf, colorOf, emptyHTML, esc, escA, fmt, fmtB, pick, short, stampFreshness, toolColor,
} from './palette.js';
import { agg, bwRow, current, loeIcon, mk, noLeg, sparkSvg } from './charts.js';
import {
  REPO_EXPANDED, installProjFilter, installProjWeight, installProjectDrilldown, installSesstree, modelsBadge, modelsPanel, provBadge, provOf, render, renderOllama, renderRepoBranch, renderResolution, schemaProblem, showSchemaError,
} from './views.js';
import { renderAgents, renderQueue } from './flow.js';
import {
  drawerSync, installDrawer, installSessionFinder, installTimelineModal, installTranscriptModal,
} from './drawer.js';
import {
  POWER, PV_ALL, intervalsInstall, navSync, profileHue, pvFilter, settingsInstall, tabs,
} from './router.js';
import { installHelp } from './routerview.js';
import { applyDiff, motionReduced, invalidate } from './diffdom.js';
import { DATA, SCHEMA_VERSION } from './main.js';

// A live session renders as a ROW DIV + (optionally) the lmpanel DIV, so a
// "key" owns 1–2 consecutive nodes. Row carries data-tsession; panel carries
// data-lmp. Anything else (empty-state block, stray nodes) keys as null →
// treated as its own singleton group by groupsOf.
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
// "In progress" KPI body: total plus one tinted chip per non-zero kind.
export function inProgressHtml(p, piLive, agentLive){
  const c = { hermes: 0, pi: 0, claude: 0, codex: 0 };
  inFlight(p, piLive, agentLive).forEach(t => { c[t.kind]++; });
  const n = c.hermes + c.pi + c.claude + c.codex;
  // Labelled chips ("2 Claude"), dot in the kind colour, zero kinds omitted.
  const chips = KIND_ORDER.filter(k => c[k]).map(k => {
    const m = kindMeta(k);
    // Claude/Codex lead with their brand mark (inherits the kind colour);
    // PI and Hermes keep the coloured dot.
    const mark = kindLogo(k)
      ? `<span class="kpi-logo" aria-hidden="true" style="color:${m.color}">${kindLogo(k)}</span>`
      : `<i class="kpi-dot" aria-hidden="true" style="background:${m.color}"></i>`;
    return `<span class="kpi-kind" data-kind="${k}" title="${c[k]} ${escA(m.label)}">${mark}${c[k]} ${esc(m.label)}</span>`;
  }).join('');
  return `<span class="${n ? '' : 'muted'}"${n ? ' style="color:var(--z-ok)"' : ''}>\u25CF</span> ${n}`
    + (chips ? `<span class="kpi-kinds">${chips}</span>` : '');
}
export function liveKpis(p, name, now, profiles, agentLive, piLive){
  const sessions = inFlight(p, piLive, agentLive).length;
  const merged = name === 'All' && profiles;
  const agents = merged ? mergedField(profiles, 'agents') : ((p && p.agents) || []);
  const alive = agents.filter(a => a && a.state === 'alive').length;
  const alerts = merged ? mergedField(profiles, 'alerts') : ((p && p.alerts) || []);
  return {
    sessions, alive, agents: agents.length,
    alerts: alerts.length,
    critical: alerts.filter(a => a && a.severity === 'critical').length,
    tput: throughputFor(name, now),
  };
}
export function renderLiveKpis(p, name, now, profiles, agentLive, piLive){
  const box = $('livekpis');
  if (!box) return null;
  const k = liveKpis(p, name, now, profiles, agentLive, piLive);
  const win = k.tput.span >= TPUT_WINDOW_S ? 'last 5 min'
    : k.tput.span > 0 ? `last ${ago(Math.round(k.tput.span))}` : 'measuring…';
  const spark = sparkSvg(k.tput.series, 'var(--accent)', { w: 96, h: 22 });
  const alertsBody = k.alerts
    ? `<a class="lkpi-num lkpi-alerts${k.critical ? ' crit' : ''}" href="#/health">${k.alerts}</a>
       <div class="lkpi-sub">${k.critical ? `${k.critical} critical` : 'need attention'}</div>`
    : `<div class="lkpi-clear"><span aria-hidden="true">●</span> All clear</div>`;
  const card = (key, label, body) =>
    `<div class="card lkpi" data-kpi="${key}"><div class="lkpi-name">${label}</div>${body}</div>`;
  box.innerHTML = [
    card('sessions', 'Sessions in flight',
      `<div class="lkpi-num">${k.sessions}</div><div class="lkpi-sub">open right now</div>`),
    card('agents', 'Agents alive',
      `<div class="lkpi-num">${k.alive}<span class="lkpi-of">/${k.agents}</span></div>`
      + `<div class="lkpi-sub">${k.agents - k.alive ? `${k.agents - k.alive} not heartbeating` : 'all heartbeating'}</div>`),
    card('throughput', 'Calls · tokens',
      `<div class="lkpi-num">${k.tput.calls.toLocaleString()}<span class="lkpi-of"> · ${fmt(k.tput.tokens)}</span></div>`
      + `<div class="lkpi-sub">${win}</div>${spark ? `<div class="lkpi-spark">${spark}</div>` : ''}`),
    card('alerts', 'Active alerts', alertsBody),
  ].join('');
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
};
// The logo markup for a kind, or '' for kinds that keep a text glyph (PI, Hermes).
export function kindLogo(kind){
  return KIND_LOGO[kind] || '';
}
const KIND_META = {
  pi:     { sig: '\u2699', label: 'PI',     title: 'PI coding agent (pi-worker)' },
  claude: { sig: KIND_LOGO.claude, label: 'Claude', title: 'Claude Code agent (agent-worker)' },
  codex:  { sig: KIND_LOGO.codex, label: 'Codex',  title: 'Codex CLI agent (agent-worker)' },
  hermes: { sig: '\u25C9', label: 'Hermes', title: 'Hermes session' },
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
// Per-agent tile, fixed scan order: status, model, phase chip, cost.
// Only already-sanitised fields ever reach the DOM (title, short model, coarse
// phase) — never prompts, tool arguments or paths. A Hermes session's phase
// chip is its short category token; its free-text last-activity sentence is
// only offered as a truncated, escaped tooltip.
export function fleetTileHtml(kind, S){
  const meta = kindMeta(kind);
  const hermes = kind === 'hermes';
  const idle = hermes ? Number.isFinite(S.idle_s) && S.idle_s > TILE_IDLE_S : S.phase === 'idle';
  const model = short(S.model) || '\u2014';
  const chip = hermes ? (S.category || '\u2014') : (S.phase || '\u2014');
  const tip = hermes && S.phase ? String(S.phase).slice(0, 80) : '';
  const cost = Number.isFinite(S.cost_usd) ? '$' + S.cost_usd.toFixed(S.cost_usd < 1 ? 3 : 2) : '';
  return `<div class="ftile" data-kind="${escA(kind)}" data-state="${idle ? 'idle' : 'run'}" style="--k:${meta.color}">`
    + `<div class="ft-status"><span class="ft-dot" aria-hidden="true"></span>`
    + `<span class="ft-kind" aria-hidden="true">${meta.sig}</span>`
    + `<span class="ft-st">${idle ? 'Idle' : 'Running'}</span></div>`
    + `<div class="ft-model" title="${escA(model)}">${esc(model)}</div>`
    + `<div class="ft-sub"><span class="ft-phase"${tip ? ` title="${escA(tip)}"` : ''}>${esc(chip)}</span>`
    + (cost ? (S.cost_class === 'subscription'
      ? `<span class="ft-cost">${coveredCost(kind, cost)}</span>`
      : `<span class="ft-cost">${esc(cost)}</span>`) : '') + `</div></div>`;
}
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
// session, nine cells in a fixed grid shared with the sticky header (#livehead):
// kind | session | model (.metacol) | state | elapsed | tokens | cost | last
// activity | load (.loecol). Sorting only reorders the keyed rows (applyDiff
// moves them), so refresh behaviour is unchanged.
export const LV_COLS = [
  { k: 'kind', t: 'Kind', ico: true }, { k: 'session', t: 'Session' }, { k: 'model', t: 'Model' },
  { k: 'state', t: 'State' }, { k: 'elapsed', t: 'Elapsed', num: true }, { k: 'tokens', t: 'Tokens', num: true },
  { k: 'cost', t: 'Cost', num: true }, { k: 'activity', t: 'Last activity' }, { k: 'load', t: 'Load', num: true },
];
export const lvSort = { key: null, dir: 'asc' };
const STATE_RANK = { Running: 0, Waiting: 1, Idle: 2 };
export function liveState(kind, S){
  if (kind === 'hermes') return Number.isFinite(S.idle_s) && S.idle_s > TILE_IDLE_S ? 'Idle' : 'Running';
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
  return `<span class="lvcov" role="img" title="${tip}" aria-label="${escA(text)}, ${tip}">${esc(text)}<span class="lvsubb">sub</span></span>`;
}
// o: {kind, attrs, lead, title, tags, model, mcol, mextra, S, tok, cost, up, tools, gauge, bw}
function lvRow(o){
  const S = o.S, st = liveState(o.kind, S);
  const ago_ = Number.isFinite(S.idle_s) ? ago(S.idle_s) + ' ago' : '—';
  const pct = (/aria-valuenow="(\d+)"/.exec(o.gauge) || [])[1];
  const tools = (o.tools || []).slice(0, 5).map(t =>
    `<span class="lvtool">${esc(t)}</span>`).join('');
  const html = `<div class="liverow lvrow items-center" role="row" data-lvstate="${st.toLowerCase()}"${o.attrs}>
      <div class="lvc lvc-kind" role="cell">${kindBadge(o.kind)}</div>
      ${o.sub ? `<div class="lvc lvc-sess lvc-sess2" role="cell"><div class="lvstk"><div class="lvs1">${o.lead || ''}${o.title}</div><div class="lvs2">${o.sub}</div></div></div>`
        : `<div class="lvc lvc-sess" role="cell">${o.lead || ''}${o.title}${o.tags || ''}</div>`}
      <div class="lvc metacol" role="cell">
        <div class="lvmodel text-[length:var(--fs-sm)] muted truncate leading-tight" style="color:${o.mcol}" title="${escA(short(o.model))}">${esc(short(o.model) || '—')}</div>${o.mextra ? `<div class="lvmx">${o.mextra}</div>` : (o.prov ? `<div class="lvmx"><span class="lvprov">${provBadge(o.prov)}</span></div>` : '')}
      </div>
      <div class="lvc" role="cell"><span class="lvst" data-state="${st.toLowerCase()}">${st}</span></div>
      <div class="lvc lvnum" role="cell" title="running since session start">${Number.isFinite(S.uptime_s) ? ago(S.uptime_s) : '—'}</div>
      <div class="lvc lvnum" role="cell" title="tokens in + out">${o.tok ? fmt(o.tok) : '—'}</div>
      <div class="lvc lvnum" role="cell" title="${o.cost && o.covered ? escA(coveredTip(o.kind)) : 'estimated cost for this session'}">${o.cost ? (o.covered ? coveredCost(o.kind, o.cost) : esc(o.cost)) : '—'}</div>
      <div class="lvc lvc-act" role="cell"><span class="lvago">${ago_}</span><span class="lvphase" title="${escA(S.phase || '')}">${esc(S.phase || '—')}</span>${tools}</div>
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
export function lvHeadHtml(){
  return LV_COLS.map(c => {
    const on = lvSort.key === c.k;
    return `<div class="lvh${c.num ? ' lvnum' : ''}" role="columnheader" tabindex="0" data-sort="${c.k}"`
      + ` aria-sort="${on ? (lvSort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"`
      + ` title="Sort by ${c.t.toLowerCase()}">${c.t}<span class="lvarr" aria-hidden="true">${on ? (lvSort.dir === 'desc' ? '▼' : '▲') : ''}</span></div>`;
  }).join('');
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
      title: `<span class="lvtitle text-[length:var(--fs-md)] font-semibold truncate" title="${escA(S.title || '')}">${esc(S.title || S.agent || 'pi session')}</span>`,
      tags: `<span class="lvtag" style="color:var(--kind-pi);background:color-mix(in srgb,var(--kind-pi) 18%,var(--card));border:1px solid color-mix(in srgb,var(--kind-pi) 45%,transparent)" title="${escA(S.agent||'pi')}">${esc(S.agent||'pi')}</span>`,
      model: S.model, mcol: colorOf(short(S.model)),
      mextra: S.switched ? `<span class="lvswitch" title="started on ${escA(short(S.init_model))}">↯ from ${esc(short(S.init_model))}</span>` : '',
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
      title: `<span class="lvtitle text-[length:var(--fs-md)] font-semibold truncate" title="${escA(S.title || '')}">${esc(S.title || engine + ' session')}</span>`,
      model: S.model, mcol: colorOf(short(S.model)),
      gauge: '' });
  });
}

// Tiles under the fleet bar: one per live session of the kind the bar's
// filter selects ('All' shows every kind), from the same fleetTiles() list the
// count badges use.
export function renderFleetTiles(){
  const box = $('livetiles');
  if (!box) return;
  const bar = $('tabs');
  const want = (bar && bar.dataset.kind) || 'all';
  const tiles = fleetTiles(DATA.profiles, DATA.pi_live, DATA.agent_live)
    .filter(t => want === 'all' || want === t.kind)
    .map(t => fleetTileHtml(t.kind, t.S));
  box.innerHTML = tiles.join('');
  box.hidden = tiles.length === 0;
}
export function renderLive(){
  const p = DATA.profiles[current] || {};
  renderFleetTiles();
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
      return lvRow({ kind: 'hermes', key: L.id, S: L, tok, tools: L.tools, mcol, model: L.model, costv: null, cost: '',
        prov: provOf('', L.model, L.base_url),
        lead: `<span class="lvcat" style="color:${c.c}" title="${escA(L.category)}">${c.i}</span>`,
        title: `<button type="button" class="ttitlebtn lvtitle text-[length:var(--fs-md)] font-semibold truncate" data-tsession="${escA(L.id)}" data-tprofile="${escA(L.profile||'')}" title="${escA(L.title)} — open transcript">${esc(L.title)}</button>`,
        sub: `<button type="button" class="chip lntimelinebtn" data-tsession="${escA(L.id)}" data-tprofile="${escA(L.profile||'')}" data-title="${escA(L.title)}" title="${escA(L.title)} — view timeline">Timeline</button>`
          + (L.profile ? `<span class="lvtag" style="background:hsl(${profileHue(L.profile)} 62% 30%);color:hsl(${profileHue(L.profile)} 80% 78%);border:1px solid hsl(${profileHue(L.profile)} 55% 42%)" title="${escA(L.profile)}">${esc(L.profile)}</span>` : '')
          + `<span class="lvcatl" style="color:${c.c}" title="${escA(L.category)}">${esc(L.category)}</span>`
          + (L.kind==='subagent' ? '<span class="lvsub">↳ subagent</span>' : ''),
        mextra: (L.switched ? `<span class="lvswitch" title="router fell back from ${escA(short(L.init_model))}">↯ from ${esc(short(L.init_model))}</span>` : '') + modelsBadge(L),
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

// ---- Completion sound (#105): off by default, Web Audio (no audio file to ship,
// ADR 0001); turning it on is itself the user gesture browsers require.
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
export async function pollLive(){
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
    // Update only the "In progress" KPI in place — the other cards depend on
    // date-filtered aggregates the live feed does not carry, so a full KPI
    // rebuild here would show wrong numbers.
    const p = DATA.profiles[current] || {};
    const card = document.querySelector('#kpis .kpi-live');
    if (card) card.innerHTML = inProgressHtml(p, DATA.pi_live, DATA.agent_live);
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
  // #149: the live panel ages on the 5s poll cadence, not the build's 60s.
  return stampFreshness(t, liveUpdatedAt, 'live', at);
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
