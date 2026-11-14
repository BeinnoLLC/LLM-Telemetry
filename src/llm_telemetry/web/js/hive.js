/**
 * Hive page (LLMTELEMET-271, H-4): the live family graph from /api/hive.
 * Hazem is an egg with a face and a crown at the EXACT centre; each family
 * assistant sits on its own ray round him and centres its cluster (tool bots,
 * brains, agents, workers). Nodes are polygons only (no circles, no triangles);
 * faces carry a mood derived from real data and nothing else.
 *
 * Pure parts (hvModel, hvLayout, hvFace) take plain data and are unit-tested;
 * the DOM part updates nodes in place, keyed by id, so animations survive
 * every snapshot. FX/anger (H-5), sound (H-6) and comms/replay (H-7) plug in
 * through hvHooks, which this ticket leaves empty.
 */
import { $, esc, ago } from './palette.js';
import { provOf, provLogoSvg } from './views.js';
import { attachZoom } from './zoom.js';
import { ensureAudioCtx } from './live.js';

export const HV_MOODS = ['smile', 'talk', 'sleep', 'happy', 'angry', 'fire', 'dizzy', 'worry', 'wow'];
export const HV_EGG = {rx: 55, ry: 74, crown: 80, r: 62};   // head 1 : 1.35
export const HV_PAD = 5;
export const HV_ACTIVE_S = 300;
export const HV_COMPACT = .62;   // below this scale the second label line is dropped
export const hvHooks = {onClick: null, onRender: null};

// Family colours live in the --hv-fam-<id> tokens (tokens.css); an unknown family falls back to a stable hash hue.
const hvColMemo = {theme: null, map: new Map()};   // per-family memo, dropped whenever the data-theme attribute changes
export const hvCol = f => {
  const th = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') || '' : '';
  if (th !== hvColMemo.theme) { hvColMemo.map.clear(); hvColMemo.theme = th; }
  let c = hvColMemo.map.get(f); if (c) return c;
  let v = ''; try { v = getComputedStyle(document.documentElement).getPropertyValue('--hv-fam-' + f).trim(); } catch (_) { /* no DOM */ }
  c = v || ('hsl(' + [...String(f)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7) + ',70%,62%)');
  if (v) hvColMemo.map.set(f, c);
  return c;
};
export const hvNgon = (cx, cy, rx, ry, n = 12) => [...Array(n)].map((_, i) => {
  const a = Math.PI * 2 * i / n;
  return (cx + rx * Math.cos(a)).toFixed(1) + ',' + (cy + ry * Math.sin(a)).toFixed(1);
}).join(' ');
export const hvHex = r => hvNgon(0, 0, r, r, 6);
export const hvEggPts = (rx, ry, n = 28) => [...Array(n)].map((_, i) => {
  const a = Math.PI * 2 * i / n, s = Math.sin(a);
  return (rx * Math.cos(a) * (1 - .12 * s)).toFixed(1) + ',' + (ry * s).toFixed(1);
}).join(' ');

// Face as SVG markup: polygons and paths only.
export function hvFace(r, mood) {
  const ex = r * .36, ey = -r * .14, er = r * .24, my = r * .42, P = (cx, cy, rx, c, n = 12) => `<polygon points="${hvNgon(cx, cy, rx, rx, n)}" class="${c}"/>`;
  if (mood === 'sleep') return `<path d="M${-ex - er},${ey} q${er},${er * .9} ${er * 2},0 M${ex - er},${ey} q${er},${er * .9} ${er * 2},0" class="hv-line"/>${P(0, r * .38, r * .08, 'hv-line', 10)}<text class="hv-zzz" x="${r * .6}" y="${-r * .7}">z</text>`;
  if (mood === 'happy') return `<path d="M${-ex - er},${ey + er * .3} q${er},${-er * 1.6} ${er * 2},0 M${ex - er},${ey + er * .3} q${er},${-er * 1.6} ${er * 2},0" class="hv-line hv-thick"/><path d="M${-r * .36},${r * .2} q${r * .36},${r * .5} ${r * .72},0 z" class="hv-fill"/>${P(-r * .62, r * .22, r * .13, 'hv-cheek')}${P(r * .62, r * .22, r * .13, 'hv-cheek')}`;
  if (mood === 'dizzy') return [-ex, ex].map(cx => P(cx, ey, er, 'hv-white', 14) + `<path d="M${cx - er * .5},${ey - er * .5} l${er},${er} m0,${-er} l${-er},${er}" class="hv-x"/>`).join('') + `<path d="M${-r * .3},${r * .38} q${r * .15},${-r * .14} ${r * .3},0 q${r * .15},${r * .14} ${r * .3},0" class="hv-line"/>`;
  const mad = mood === 'angry' || mood === 'fire', pr = mood === 'wow' ? er * .34 : er * .52;
  const eye = (cx, sx) => P(cx, ey, er, 'hv-white', 14) + `<g class="${mad ? '' : 'hv-look'}"><polygon points="${hvNgon(cx + sx, ey + (mood === 'worry' ? er * .2 : 0), pr, pr)}" class="hv-pupil"/>${P(cx + sx + pr * .4, ey - pr * .4, pr * .32, 'hv-shine', 10)}</g>`
    + (mad ? `<path d="M${cx - er * 1.1},${ey - er * (sx < 0 ? .2 : 1.2)} L${cx + er * 1.1},${ey - er * (sx < 0 ? 1.2 : .2)} L${cx + er * 1.1},${ey - er * 1.5} L${cx - er * 1.1},${ey - er * 1.5}z" class="hv-lid"/>` : '')
    + (mood === 'worry' ? `<path d="M${cx - er * 1.1},${ey - er * .5} Q${cx},${ey - er * 1.1} ${cx + er * 1.1},${ey - er * .5} L${cx + er * 1.1},${ey - er * 1.4} L${cx - er * 1.1},${ey - er * 1.4}z" class="hv-lid"/>` : '');
  let s = `<g class="hv-eyes">${eye(-ex, mad ? er * .2 : 0)}${eye(ex, mad ? -er * .2 : 0)}</g>`;
  if (mad) s += `<path class="hv-brow" d="M${-ex - er},${ey - er * 1.45} L${-ex + er * 1.1},${ey - er * .85} M${ex + er},${ey - er * 1.45} L${ex - er * 1.1},${ey - er * .85}"/>`;
  if (mood === 'angry') s += `<path d="M${-r * .26},${my + r * .06} q${r * .26},${-r * .22} ${r * .52},0" class="hv-line hv-thick hv-red"/>`;
  else if (mood === 'fire') s += `<path d="M${-r * .26},${my - r * .08} h${r * .52} v${r * .14} h${-r * .52} z M${-r * .09},${my - r * .08} v${r * .14} M${r * .09},${my - r * .08} v${r * .14}" class="hv-teeth"/>`;
  else if (mood === 'talk') s += `<polygon points="${hvNgon(0, my, r * .16, r * .11, 14)}" class="hv-fill hv-talk" style="transform-origin:0 ${my}px"/>`;
  else if (mood === 'worry') s += `<path d="M${-r * .22},${my + r * .05} q${r * .22},${-r * .16} ${r * .44},0" class="hv-line"/>`;
  else if (mood === 'wow') s += P(0, my, r * .12, 'hv-fill');
  else s += `<path d="M${-r * .3},${my - r * .1} q${r * .3},${r * .36} ${r * .6},0 z" class="hv-fill"/>`;
  return s;
}

// Provider mark for tooltips: the brand SVG, or a neutral hexagon for unknown providers. Never a letter.
export function hvProvMark(model) {
  if (!model) return '';
  const key = provOf('', model, ''), svg = provLogoSvg(model, 14, key);
  return svg.startsWith('<svg') ? svg : '<svg class="hv-prov" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7"/></svg>';
}

const hvShort = s => String(s || '').replace(/^(beinno|llm-telemetry)-/, '');
export const hvClip = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const hvAct = i => i != null && i < HV_ACTIVE_S;
export const hvUserMood = u => !u ? 'smile' : ({sending: 'talk', reply: 'happy', question: 'wow', waiting: 'worry'})[u.state] || 'smile';

// Real-data model: nodes (kind egg | assistant | bot | brain | agent | worker), links, and per-node counts.
export function hvModel(snap, view = 'all') {
  const items = [], edges = [], c = {assistants: 0, brains: 0, agents: 0, running: 0, queued: 0, blocked: 0, done: 0};
  const add = (id, o) => { items.push({id, r: 24, label: '', sub: '', mood: 'sleep', hot: false, blocked: false, data: true, pool: false, press: 0, ...o}); return id; };
  const link = (a, b, hot, fam, thin) => edges.push({id: a + '|' + b, a, b, hot, fam, thin: !!thin});
  const fams = (snap.families || []).filter(f => view === 'all' || f.id === view);
  const u = snap.user;
  const sys = hvSystem(snap);
  add('hazem', {kind: 'egg', fam: 'root', r: HV_EGG.r, label: 'Hazem', sub: 'you', mood: hvUserMood(u), hot: !!u && u.state !== 'idle', press: sys.p,
    tip: `<h4>Hazem</h4>You. Every assistant answers to you.${u ? '<br>Link: ' + esc(u.state) : ''}<br>System pressure ${Math.round(sys.p * 100)}% · flames ${hvFlameLevel(sys.p)} · anger ${Math.round(sys.a * 100)}%`});
  const worker = (w, owner, fam) => {
    const run = w.status === 'running', mins = Math.round((w.secs || 0) / 60), id = 'w:' + w.id;
    add(id, {kind: 'worker', fam, r: 11, label: w.ticket || w.role || 'worker', sub: (w.engine || '') + ' · ' + (run ? mins + 'm' : 'queued'),
      mood: run ? 'talk' : 'sleep', hot: run, owner, pool: !owner, model: w.model, press: hvScoreP(hvNodeScore({}, [w])),
      tip: `<h4>${esc(w.engine || '')} worker · ${esc(w.role || '')}${w.ticket ? ' · ' + esc(w.ticket) : ''}</h4>${run ? 'Running ' + mins + ' min' : 'Waiting for a slot (' + mins + ' min)'}${w.model ? '<br>' + hvProvMark(w.model) + ' ' + esc(w.model) : ''}${w.spend && w.spend.label ? '<br>' + esc(w.spend.label) : ''}`});
    if (owner) link(owner, id, run, fam, true);
    if (run) c.running++; else c.queued++;
  };
  const model = f => f.model ? `<br>${hvProvMark(f.model)} ${esc(f.model)}` : '';
  const spend = f => f.spend && f.spend.usd != null ? ` · $${(+f.spend.usd).toFixed(2)}${f.spend.label ? ' (' + esc(f.spend.label) + ')' : ''}` : '';
  fams.forEach(f => {
    const A = f.assistant, aid = 'a:' + f.id, run = f.brains.reduce((n, b) => n + b.counts.running, 0), blk = f.brains.reduce((n, b) => n + b.counts.blocked, 0);
    const hot = run > 0 || hvAct(A.idle);
    c.assistants++;
    add(aid, {kind: 'assistant', fam: f.id, r: 36, label: A.label || A.id, sub: `${f.brains.length} brains · ${run} running`, title: String(f.label || f.id).toUpperCase(),
      mood: blk ? 'angry' : hot ? 'talk' : 'smile', hot, blocked: blk > 0, data: A.idle != null || run > 0 || blk > 0, press: hvScoreP(hvNodeScore({}, A.workers)),
      tip: `<h4>${esc(A.label || A.id)} · ${esc(f.label || f.id)} assistant</h4>Last active ${A.idle == null ? 'unknown' : ago(A.idle)} · ${A.sessions || 0} open session(s)<br>${f.brains.length} brains · ${run} running · ${blk} blocked${model(A)}${spend(A)}`});
    link('hazem', aid, run > 0, f.id);
    (A.workers || []).forEach(w => worker(w, aid, f.id));
    (f.bots || []).forEach(b => {
      const id = `b:${f.id}:${b.id}`, ws = b.workers || [], h = ws.length > 0 || b.sessions > 0 || hvAct(b.idle);
      add(id, {kind: 'bot', fam: f.id, r: 18, label: hvShort(b.id), sub: ws.length ? ws.length + ' worker' + (ws.length > 1 ? 's' : '') : h ? 'working' : '',
        mood: h ? 'talk' : 'sleep', hot: h, owner: aid, data: b.idle != null || h, press: hvScoreP(hvNodeScore({}, ws)),
        tip: `<h4>${esc(b.id)} · tool bot</h4>Last active ${b.idle == null ? 'unknown' : ago(b.idle)} · ${b.sessions || 0} open session(s)${model(b)}`});
      link(aid, id, h, f.id, true);
      ws.forEach(w => worker(w, id, f.id));
    });
    f.brains.forEach(b => {
      const id = `b:${f.id}:${b.id}`, k = b.counts, q = (k.todo || 0) + (k.ready || 0), h = k.running > 0 || hvAct(b.idle);
      c.brains++; c.running += k.running; c.queued += q; c.blocked += k.blocked; c.done += k.done;
      add(id, {kind: 'brain', fam: f.id, r: 24, label: b.label, owner: aid, hot: h, blocked: k.blocked > 0, data: b.idle != null || h || q > 0 || k.blocked > 0,
        sub: k.running || q || k.blocked ? `${k.running} run · ${q} queued${k.blocked ? ' · ' + k.blocked + ' blk' : ''}` : 'idle' + (b.idle == null ? '' : ' · ' + ago(b.idle)),
        mood: k.blocked ? 'angry' : k.running ? 'talk' : h ? 'smile' : 'sleep', press: hvScoreP(hvNodeScore(k, b.workers)),
        tip: `<h4>${esc(b.label)} brain</h4>${esc(b.id)} · board ${esc(b.board)}<br>${k.done} done · ${k.running} running · ${q} queued · ${k.blocked} blocked${model(b)}${spend(b)}`});
      link(aid, id, k.running > 0, f.id);
      (b.workers || []).forEach(w => worker(w, id, f.id));
      b.agents.forEach(a => {
        const gid = `g:${f.id}:${b.id}:${a.id}`, ar = a.tasks.some(t => t.status === 'running'), ab = a.tasks.some(t => t.status === 'blocked');
        c.agents += ar ? 1 : 0;
        add(gid, {kind: 'agent', fam: f.id, r: 13, label: hvShort(a.id), sub: view === 'all' ? '' : a.tasks.length + ' task' + (a.tasks.length > 1 ? 's' : ''),
          mood: ab ? 'angry' : ar ? 'talk' : 'smile', hot: ar, blocked: ab, owner: id, data: a.idle != null || a.tasks.length > 0,
          press: hvScoreP(hvNodeScore({running: +ar, blocked: +ab}, [])),
          tip: `<h4>${esc(a.id)} · agent</h4>${a.tasks.map(t => `<div>· <b>${esc(t.status)}</b> ${esc(t.title)}</div>`).join('')}${model(a)}`});
        link(id, gid, ar, f.id, true);
      });
    });
  });
  (view === 'all' ? snap.unattributed || [] : []).forEach(w => worker(w, null, 'root'));
  return {items, edges, counts: c, sys, fams: (snap.families || []).map(f => ({id: f.id, label: f.label || f.id}))};
}

// ---- pressure, anger and flames (LST-272): real snapshot data only, nothing is set by hand ----
// Node pressure uses the server's formula: 2/running worker + 1.5/queued worker + 1.5/blocked + 1/running task + long-turn bonus.
export const hvScoreP = s => s <= 0 ? 0 : s <= 3 ? s / 6 : s <= 6 ? .5 + (s - 3) * .4 / 3 : Math.min(1, .9 + (s - 6) * .025);
export const hvFlameLevel = p => p >= .9 ? 'full blaze' : p >= .8 ? 'medium' : p >= .65 ? 'small' : p >= .5 ? 'smoulder' : 'none';
export const hvFlameU = p => hvClamp((p - .5) / .5, 0, 1);   // 0 below half pressure (no fire) .. 1 at full blaze
const hvLong = age => age > 3600 ? 2 : age > 1800 ? 1.5 : age > 900 ? 1 : 0;
export function hvNodeScore(counts, ws) {
  counts = counts || {}; ws = ws || [];
  const run = ws.filter(w => w.status === 'running');
  return 2 * run.length + 1.5 * (ws.length - run.length) + 1.5 * (counts.blocked || 0) + (counts.running || 0) + hvLong(Math.max(0, ...run.map(w => w.secs || 0)));
}
// System pressure p = .5 * hottest node + .5 * mean per-family score; anger target a = .7 p + .3 blocked share (blocked / all open cards).
// Waiting links (an assistant waits on a reply or a question) add 1.5 each to the score.
export function hvSystem(snap) {
  const S = {runW: 0, qW: 0, age: 0, blocked: 0, tasks: 0, todo: 0, waiting: 0}, ws = [], fams = snap.families || [];
  let hot = 0;
  const node = (k, w) => { hot = Math.max(hot, hvScoreP(hvNodeScore(k, w))); ws.push(...(w || [])); };
  fams.forEach(f => {
    node({}, f.assistant.workers); (f.bots || []).forEach(b => node({}, b.workers));
    (f.brains || []).forEach(b => { const k = b.counts || {}; node(k, b.workers); S.blocked += k.blocked || 0; S.tasks += k.running || 0; S.todo += (k.todo || 0) + (k.ready || 0); });
  });
  ws.push(...(snap.unattributed || []));
  const run = ws.filter(w => w.status === 'running');
  S.runW = run.length; S.qW = ws.length - run.length; S.age = Math.max(0, ...run.map(w => w.secs || 0));
  S.waiting = ((snap.user && snap.user.links) || []).filter(l => l.state === 'waiting' || l.state === 'question').length;
  const score = 2 * S.runW + 1.5 * S.qW + 1.5 * S.blocked + S.tasks + hvLong(S.age) + 1.5 * S.waiting;
  const open = S.todo + S.blocked + S.tasks, bs = open ? S.blocked / open : 0, p = hvClamp(.5 * hot + .5 * hvScoreP(score / Math.max(1, fams.length)), 0, 1);
  return {...S, score, hot, bs, p, a: hvClamp(.7 * p + .3 * bs, 0, 1)};
}
export const hvEase = (cur, to, dt, tau) => cur + (to - cur) * (1 - Math.exp(-dt / tau));   // never jumps: a small step per frame

// Hazem's face parameters at the anger keyframes a = 0, .25, .5, .75, 1 (W = head width). brow: inner-end drop in degrees, bt: thickness,
// gap: brow height over the eyes, ew/eh: eye half width/height, eo: eye brightness, mo: mouth openness, mw/up: mouth width / upper lip,
// bloom: rim glow strength, teeth: upper teeth share. Rim, mouth and flame colours are the --hv-* tokens, read by hvPalette.
export const HV_KF = [
  {a: 0,   brow: 7,  bt: .068, gap: .132, ew: .088, eh: .074, eo: 1,   mo: 0,   mw: .20, up: .016, bloom: .35, teeth: 0},
  {a: .25, brow: 13, bt: .072, gap: .124, ew: .088, eh: .068, eo: .97, mo: .04, mw: .22, up: .02,  bloom: .52, teeth: 0},
  {a: .5,  brow: 21, bt: .076, gap: .114, ew: .086, eh: .058, eo: .93, mo: .30, mw: .25, up: .03,  bloom: .72, teeth: .15},
  {a: .75, brow: 29, bt: .080, gap: .105, ew: .085, eh: .049, eo: .90, mo: .65, mw: .28, up: .04,  bloom: .88, teeth: .45},
  {a: 1,   brow: 36, bt: .084, gap: .097, ew: .084, eh: .040, eo: .86, mo: 1,   mw: .31, up: .05,  bloom: 1,   teeth: .5}];
const hvMix = (A, B, u) => Array.isArray(A) ? A.map((v, j) => v + (B[j] - v) * u) : A + (B - A) * u;
export function hvKf(a, pal) {
  a = hvClamp(a, 0, 1);
  const i = Math.min(3, Math.floor(a * 4)), A = HV_KF[i], B = HV_KF[i + 1], u0 = (a - A.a) / (B.a - A.a), u = u0 * u0 * (3 - 2 * u0), o = {a};   // smoothstep inside each segment
  for (const k in A) if (k !== 'a') o[k] = hvMix(A[k], B[k], u);
  if (pal) [['top', 'rim-top'], ['bot', 'rim-bot'], ['mc', 'mouth']].forEach(([k, t]) => { o[k] = hvMix(pal[t][i], pal[t][i + 1], u); });
  return o;
}
export function hvPalette(read) {
  const hx = h => [1, 3, 5].map(i => parseInt(String(h).trim().slice(i, i + 2), 16)), p = {};
  ['rim-top', 'rim-bot', 'mouth', 'flame'].forEach(t => { p[t] = [0, 1, 2, 3, 4].map(i => hx(read(`--hv-${t}-${i}`))); });
  return p;
}
const hvCss = () => { const cs = getComputedStyle(document.documentElement); return hvPalette(n => cs.getPropertyValue(n)); };
const hvRgb = c => `rgb(${c.map(Math.round)})`;
export function hvFlameRgb(q, pal) {   // deep orange -> orange -> yellow -> pale yellow -> white-hot along the flame tokens
  const T = [.5, .65, .8, .9, 1], i = q >= .9 ? 3 : q >= .8 ? 2 : q >= .65 ? 1 : 0;
  return hvMix(pal.flame[i], pal.flame[i + 1], hvClamp((q - T[i]) / (T[i + 1] - T[i]), 0, 1));
}

// Hazem's whole head as SVG markup (polygons and paths only): halo, bloom, egg, brows, eyes, mouth, rim, crown.
export function hvHead(rx, ry, F) {
  const W = rx * 2, ex = .19 * W, ey = -.135 * W, my = .30 * W, bl = .1 * W, by = ey - F.gap * W, th = F.brow * Math.PI / 180, f1 = n => n.toFixed(1);
  const egg = hvEggPts(rx, ry, 48), mw = F.mw * W, up = F.up * W, lo = (.022 + .17 * F.mo) * W, N = 8, lens = [];
  for (let t = 0; t <= N; t++) lens.push([mw * (t / N - .5), my - 4 * up * (t / N) * (1 - t / N)]);     // upper lip: quadratic arch
  for (let t = N - 1; t > 0; t--) lens.push([mw * (t / N - .5), my + 4 * lo * (t / N) * (1 - t / N)]);  // lower lip: opens with anger
  const L = lens.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ');
  const brows = [-1, 1].map(s => { const bx = s * ex; return `M${f1(bx - s * bl * Math.cos(th))},${f1(by + bl * Math.sin(th))} L${f1(bx + s * bl * Math.cos(th))},${f1(by - bl * Math.sin(th))}`; }).join(' ');
  const eyes = [-1, 1].map(s => { const bx = s * ex, pr = Math.min(F.eh * .78, F.ew * .55) * W;
    return `<polygon points="${hvNgon(bx, ey, F.ew * W, F.eh * W, 16)}" class="hv-hz-eye" style="opacity:${F.eo.toFixed(2)}"/><polygon points="${hvNgon(bx - s * .008 * W, ey + .004 * W, pr, pr, 10)}" class="hv-hz-pupil"/>`; }).join('');
  const cw = rx * .58, c0 = -ry * .6, ch = ry * .34, tY = my - up + (up + lo) * .6 * F.teeth;
  return `<polygon points="${hvNgon(0, 0, rx * 1.9, ry * 1.5, 32)}" fill="url(#hv-hz-halo)" style="opacity:${(.5 + .4 * F.a).toFixed(2)}"/>`
    + `<radialGradient id="hv-hz-halo"><stop offset="0" style="stop-color:var(--hv-halo)"/><stop offset="1" style="stop-color:var(--hv-halo);stop-opacity:0"/></radialGradient>`
    + `<radialGradient id="hv-hz-gloss" cx=".34" cy=".2" r=".5"><stop offset="0" style="stop-color:var(--hv-feat);stop-opacity:.16"/><stop offset="1" style="stop-color:var(--hv-feat);stop-opacity:0"/></radialGradient>`
    + `<linearGradient id="hv-hz-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hvRgb(F.top)}"/><stop offset="1" stop-color="${hvRgb(F.bot)}"/></linearGradient>`
    + `<clipPath id="hv-hz-mouth"><polygon points="${L}"/></clipPath>`
    + `<polygon points="${egg}" class="hv-hz-bloom" stroke="url(#hv-hz-rim)" filter="url(#hv-bloom)" style="stroke-width:${(3 + 3 * F.bloom).toFixed(1)}px;opacity:${(.35 + .55 * F.bloom).toFixed(2)}"/>`
    + `<polygon points="${egg}" class="hv-hz-egg"/><polygon points="${egg}" fill="url(#hv-hz-gloss)"/>`
    + `<path d="${brows}" class="hv-hz-brow" style="stroke-width:${f1(F.bt * W)}px"/><g class="hv-eyes" style="transform-origin:0 ${f1(ey)}px">${eyes}</g>`
    + `<polygon points="${L}" style="fill:${hvRgb(F.mc)}"/>`
    + (F.teeth > .05 ? `<polygon points="${f1(-mw / 2)},${f1(my - up)} ${f1(mw / 2)},${f1(my - up)} ${f1(mw / 2)},${f1(tY)} ${f1(-mw / 2)},${f1(tY)}" clip-path="url(#hv-hz-mouth)" class="hv-hz-teeth"/>` : '')
    + `<polygon points="${egg}" class="hv-hz-rim" stroke="url(#hv-hz-rim)"/>`
    + `<path class="hv-crown" d="M${-cw},${c0} L${-cw},${c0 - ch} L${-cw * .45},${c0 - ch * .52} L0,${c0 - ch * 1.5} L${cw * .45},${c0 - ch * .52} L${cw},${c0 - ch} L${cw},${c0} Z"/>`;
}

// One node's flame layer: faceted tongues (straight segments, never soft blobs) that grow, rise and flicker with pressure q.
// None below .5; tongue count, length, width, rise and flicker speed all interpolate continuously up to full blaze at .9+.
function hvTongue(bx, by, ux, uy, len, w, t, i) {
  const px = -uy, py = ux, fl = Math.sin(t + i * 2.1), fl2 = Math.cos(t * .7 + i * 1.3), A = [], B = [];
  for (let s = 1; s <= 4; s++) {
    const f = s / 4, o = fl * w * .5 * f + (s % 2 ? 1 : -1) * w * .34 * f, cx = bx + ux * len * f + px * o, cy = by + uy * len * f + py * o, hw = w * (1 - f * .92) * (1 + .25 * fl2 * f);
    A.push([cx - px * hw, cy - py * hw]); B.push([cx + px * hw, cy + py * hw]);
  }
  const tip = [bx + ux * len * 1.06 + px * fl * w * .8, by + uy * len * 1.06 + py * fl * w * .8];
  return 'M' + [[bx - px * w, by - py * w], ...A, tip, ...B.reverse(), [bx + px * w, by + py * w]].map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z';
}
export function hvFlame(rx, ry, q, now, seed, upper) {
  if (q < .5) return null;
  const u = hvFlameU(q), n = Math.max(3, Math.round(4 + 12 * u)), r = (rx + ry) / 2, rise = .38 + .5 * u, core = Math.max(0, (q - .6) / .4) * .85;
  let d = '', dc = '';
  for (let i = 0; i < n; i++) {
    const ph = now * (.004 + .012 * u) + i * 2.3 + seed * 7, ang = upper ? -Math.PI + Math.PI * (i + .5) / n : seed + i * Math.PI * 2 / n;
    const dx = Math.cos(ang), dy = Math.sin(ang) - rise, dl = Math.hypot(dx, dy) || 1, len = r * (.26 + .4 * u) * (.72 + .28 * Math.sin(ph)), w = r * (.12 + .14 * u);
    d += hvTongue(rx * .92 * dx, ry * .92 * Math.sin(ang), dx / dl, dy / dl, len, w, ph, i);
    if (core > .03) dc += hvTongue(rx * .88 * dx, ry * .88 * Math.sin(ang), dx / dl, dy / dl, len * .62, w * .5, ph * 1.15, i);
  }
  return {n, d, dc, alpha: .34 + .36 * u, core};
}

// ---- layout (px space, origin = stage centre, 1 SVG unit = 1 CSS px) ----
export const hvClamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function hvFoot(it, k) {
  const egg = it.kind === 'egg', r = egg ? HV_EGG.rx * 1.12 : it.r * k, w1 = it.label.length * 7.6 / 2, w2 = k < HV_COMPACT ? 0 : it.sub.length * 6.8 / 2;
  const half = Math.max(r, w1, w2, it.title ? it.title.length * 8.4 / 2 : 0), lab = (it.sub && k >= HV_COMPACT ? 36 : 20) * Math.min(1, .7 + k / 3);
  return {l: -half, r: half, t: egg ? -(HV_EGG.crown + 4) : -(r + (it.title ? 20 : 2)), b: egg ? HV_EGG.ry * 1.12 + lab : r + lab};
}
export const hvHit = (a, b, gap = 2 * HV_PAD) => Math.min(a.x + a.r, b.x + b.r) - Math.max(a.x + a.l, b.x + b.l) + gap > 0
  && Math.min(a.y + a.b, b.y + b.b) - Math.max(a.y + a.t, b.y + b.t) + gap > 0;
export function hvOverlaps(boxes, gap = 0) {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hvHit(boxes[i], boxes[j], gap)) n++;
  return n;
}
export const HV_OFFS = (() => {
  const o = [[0, 0]];
  for (let r = 8; r <= 900; r += 8) { const n = Math.max(6, Math.round(2 * Math.PI * r / 8)); for (let q = 0; q < n; q++) o.push([r * Math.cos(2 * Math.PI * q / n), r * Math.sin(2 * Math.PI * q / n)]); }
  return o.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
})();
const HV_LV = {assistant: 0, bot: 1, brain: 1, agent: 2, worker: 2};

export function hvTry(model, W, H, k) {
  const BX = W / 2 - 18, BY = H / 2 - 12, TOP = 44, pool = model.items.filter(i => i.pool);
  const poolRows = pool.length ? Math.ceil(pool.length * 96 * k / Math.max(200, 2 * BX)) : 0, poolH = poolRows ? poolRows * 56 + 8 : 0;
  const X0 = -BX, X1 = BX, Y0 = -BY + TOP, Y1 = BY - poolH, clear = 2.5 * HV_EGG.r;
  const feet = {}, pos = {hazem: {x: 0, y: 0}};
  model.items.forEach(i => { feet[i.id] = hvFoot(i, k); });
  const egg = {x: 0, y: 0, ...feet.hazem};
  const asst = model.items.filter(i => i.kind === 'assistant'), N = asst.length, miss = [];
  const members = a => model.items.filter(i => i.fam === a.fam && !i.pool && i !== a && i.kind !== 'egg');
  const wt = a => members(a).length + 1;
  const rank = asst.slice().sort((p, q) => wt(q) - wt(p) || (p.id < q.id ? -1 : 1)).map(i => i.id);
  const ANG = [[180], [180, 0], [180, 0, -90], [180, 0, -90, 90]][Math.min(N, 4) - 1];
  const cl = asst.map((a, i) => {
    const m = members(a), area = [a, ...m].reduce((s, it) => { const f = feet[it.id]; return s + (f.r - f.l + 2 * HV_PAD) * (f.b - f.t + 2 * HV_PAD); }, 0);
    const deg = N <= 4 ? ANG[rank.indexOf(a.id)] : -135 + 360 * i / N, th = deg * Math.PI / 180;
    const asp = hvClamp((X1 - X0) / Math.max(1, Y1 - Y0), 1, 2), ry = Math.max(Math.sqrt(area / .5 / Math.PI / asp), 70 * k), rx = ry * asp;
    return {a, m, deg, ux: Math.cos(th), uy: Math.sin(th), rx, ry};
  });
  for (const c of cl) {   // centre on the ray as far out as the stage allows, never inside the clear ring
    const lim = (u, lo, hi, r) => Math.abs(u) < 1e-6 ? Infinity : (u > 0 ? (hi - r) / u : (lo + r) / u);
    const dx = lim(c.ux, X0, X1, c.rx), dy = lim(c.uy, Y0, Y1, c.ry);
    c.d = Math.min(dx < 0 ? 0 : dx, dy < 0 ? 0 : dy, 1e5);
    const lo = clear + Math.hypot(c.rx * Math.abs(c.ux), c.ry * Math.abs(c.uy)) * .55;
    if (c.d < lo) c.d = lo;
    c.cx = c.d * c.ux; c.cy = c.d * c.uy;
  }
  const placed = [egg], boxes = {hazem: egg};
  const put = (it, x, y) => { pos[it.id] = {x, y}; const b = {x, y, ...feet[it.id]}; boxes[it.id] = b; placed.push(b); };
  for (const c of cl) {
    put(c.a, c.cx, c.cy);
    const rest = c.m.slice().sort((p, q) => HV_LV[p.kind] - HV_LV[q.kind]);
    const nb = rest.filter(i => HV_LV[i.kind] === 1).length;
    let bi = 0;
    const ideal = {};
    for (const it of rest) {
      const f = feet[it.id], own = it.owner && pos[it.owner] ? pos[it.owner] : {x: c.cx, y: c.cy};
      let gx, gy;
      if (HV_LV[it.kind] === 1) { const ang = -Math.PI / 2 + Math.PI * 2 * (bi++ + .5) / Math.max(1, nb), s = it.kind === 'bot' ? .5 : .85; gx = c.cx + c.rx * s * Math.cos(ang); gy = c.cy + c.ry * s * Math.sin(ang); }
      else { const sib = ideal[it.owner] = (ideal[it.owner] || 0) + 1, ang = (sib * 2.4) % (Math.PI * 2), rr = 40 * k + 14 * Math.floor(sib / 6); gx = own.x + rr * Math.cos(ang); gy = own.y + rr * Math.sin(ang); }
      let ok = false;
      for (const [ox, oy] of HV_OFFS) {
        const x = gx + ox, y = gy + oy, bb = {x, y, ...f};
        if (x + f.l < X0 || x + f.r > X1 || y + f.t < Y0 || y + f.b > Y1) continue;
        if (Math.pow((x - c.cx) / c.rx, 2) + Math.pow((y - c.cy) / c.ry, 2) > 1.15) continue;
        if (placed.some(p => hvHit(bb, p))) continue;
        put(it, x, y); ok = true; break;
      }
      if (!ok) { put(it, hvClamp(gx, X0 - f.l, X1 - f.r), hvClamp(gy, Y0 - f.t, Y1 - f.b)); miss.push(it.id); }
    }
  }
  pool.forEach((it, i) => {   // the pool strip along the bottom edge
    const per = Math.max(1, Math.floor((X1 - X0) / (96 * k))), row = Math.floor(i / per), col = i % per;
    put(it, X0 + 48 * k + col * 96 * k, Y1 + 14 + row * 56);
  });
  const over = hvOverlaps(Object.values(boxes), 0);
  return {pos, boxes, k, miss, over, stage: {y1: BY}, bounds: {x0: X0, x1: X1, y0: Y0, y1: Y1}};
}

// Shrinks the whole graph until every footprint is clear of every other.
export function hvLayout(model, W, H) {
  let best = null;
  for (let k = 1; k >= .38; k *= .92) {
    const L = hvTry(model, W, H, k);
    if (!best || L.over + L.miss.length < best.over + best.miss.length) best = L;
    if (!L.over && !L.miss.length) return L;
  }
  return best;
}

// ---- DOM ----
const hvS = {a: null, p: 0, sys: null, fx: {}, pal: null, loop: 0, t: 0, ft: 0, snap: null, view: 'all', nodes: {}, edges: {}, key: '', L: null, es: null, zoom: null, live: false, at: 0, size: [0, 0]};
export const hvState = hvS;
const SVGNS = 'http://www.w3.org/2000/svg';
const hvEl = (tag, attrs, parent) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };

export function hvNodeShape(g, it) {
  if (it.kind === 'egg') {
    hvEl('polygon', {class: 'hv-orbit', points: hvNgon(0, 0, it.r * 1.5, it.r * 1.5, 26)}, g);
  } else hvEl('polygon', {class: 'hv-hex', points: hvHex(it.r)}, g);
}
const hvFaceR = it => it.r * (it.kind === 'egg' ? .62 : .7);

export function hvDrawNode(it, pos, k) {
  const root = $('hive-nodes'); let n = hvS.nodes[it.id];
  const r = it.kind === 'egg' ? it.r : it.r * k;
  if (!n) {
    const g = hvEl('g', {'data-id': it.id}, root), bob = hvEl('g', {class: 'hv-bob', style: `animation-delay:${-(hvS.n = (hvS.n || 0) + 1) * .7 % 4}s`}, g);
    const body = hvEl('g', {}, bob), fg = hvEl('g', {class: 'hv-face'}, bob), t1 = hvEl('text', {class: 'hv-lbl'}, bob), t2 = hvEl('text', {class: 'hv-sub'}, bob);
    const tt = it.title ? hvEl('text', {class: 'hv-fam'}, g) : null;
    g.addEventListener('mousemove', e => { const t = $('hive-tip'); t.innerHTML = n.tip; t.style.opacity = 1; t.style.left = Math.min(e.clientX + 14, innerWidth - 340) + 'px'; t.style.top = (e.clientY + 14) + 'px'; });
    g.addEventListener('mouseleave', () => { $('hive-tip').style.opacity = 0; });
    g.addEventListener('click', () => { if (hvHooks.onClick) hvHooks.onClick(it.id, n); });
    n = hvS.nodes[it.id] = {id: it.id, label: it.label, g, body, fg, t1, t2, title: tt, mood: null, r: -1, kind: it.kind};
  }
  if (n.r !== r) { n.body.innerHTML = ''; hvNodeShape(n.body, {...it, r}); n.r = r; n.mood = null; }
  n.tip = it.tip; n.fam = it.fam; n.label = it.label;
  n.g.setAttribute('transform', `translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})`);
  n.g.setAttribute('class', `hv-node hv-${it.kind} ${it.hot ? 'hot' : 'idle'}${it.blocked ? ' blocked' : ''}${it.data ? '' : ' nodata'}${it.pool ? ' pool' : ''}`);
  n.g.style.setProperty('--c', hvCol(it.fam));
  const tight = it.kind === 'worker';
  n.t1.setAttribute('y', (r + (tight ? 15 : 18) * Math.max(.7, k)).toFixed(1)); n.t2.setAttribute('y', (r + (tight ? 29 : 34) * Math.max(.7, k)).toFixed(1));
  if (it.kind === 'egg') { n.t1.setAttribute('y', (HV_EGG.ry + 19).toFixed(1)); n.t2.setAttribute('y', (HV_EGG.ry + 35).toFixed(1)); }
  n.t1.textContent = hvClip(it.label, tight ? 13 : 17); n.t2.textContent = k < HV_COMPACT ? '' : hvClip(it.sub, tight ? 15 : 26);
  if (n.title) { n.title.textContent = it.title; n.title.setAttribute('y', (-(r + 7)).toFixed(1)); n.title.style.fill = hvCol(it.fam); }
  n.rx = it.kind === 'egg' ? HV_EGG.rx : r; n.ry = it.kind === 'egg' ? HV_EGG.ry : r; n.x = pos.x; n.y = pos.y; n.press = it.press;
  const mood = n.temp || it.mood;
  if (it.kind === 'egg') { if (n.mood !== mood) { n.mood = mood; n.lv = -1; } hvPaintHazem(); }   // the head follows the anger value, not the mood
  else if (n.mood !== mood) { n.fg.innerHTML = hvFace(hvFaceR({...it, r}), mood); n.fg.setAttribute('transform', it.kind === 'egg' ? `translate(0,${(HV_EGG.ry * .1).toFixed(1)})` : ''); n.mood = mood; }
  n.g.dataset.mood = mood;
}

// Hazem's head at the quantised anger level (HV_STEPS levels): repainted only when the level changes, one cached markup per level.
const HV_STEPS = 48, hvHeads = {};
export function hvPaintHazem() {
  const n = hvS.nodes.hazem; if (!n || hvS.a == null) return;
  const lv = Math.round(hvS.a * HV_STEPS); if (n.lv === lv) return;
  n.lv = lv; n.g.dataset.anger = lv;
  hvS.pal = hvS.pal || hvCss();
  n.fg.innerHTML = hvHeads[lv] || (hvHeads[lv] = hvHead(HV_EGG.rx, HV_EGG.ry, hvKf(lv / HV_STEPS, hvS.pal)));
  n.fg.removeAttribute('transform');
}

// One animation tick: anger and pressure ease toward the live targets; flames are redrawn at ~20 fps for nodes at pressure >= .5 only.
export function hvFx(now) {
  const dt = hvS.t ? Math.min(250, now - hvS.t) : 16; hvS.t = now;
  if (!hvS.sys) return;
  hvC.bump = hvC.bump * Math.exp(-dt / 6000); hvS.a = hvEase(hvS.a, hvClamp(hvS.sys.a + hvC.bump, 0, 1), dt, 1500); hvS.p = hvEase(hvS.p, hvS.sys.p, dt, 320);
  hvPaintHazem(); hvGauge();
  if (now - (hvS.ft || 0) < 50) return;
  const k = 1 - Math.exp(-(now - (hvS.ft || now)) / 320), root = $('hive-fx'); hvS.ft = now;
  if (!root) return;
  hvS.pal = hvS.pal || hvCss();
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (const id in hvS.nodes) {
    const n = hvS.nodes[id], tgt = id === 'hazem' ? hvS.sys.p : n.press || 0;
    n.q = id === 'hazem' ? hvS.p : (n.q || 0) + (tgt - (n.q || 0)) * k;
    let f = hvS.fx[id];
    const fl = n.q >= .5 && n.x != null ? hvFlame(n.rx, n.ry, n.q, reduce ? 0 : now, ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 97, 7)) / 15, id === 'hazem') : null;
    if (!fl) { if (f) { f.g.remove(); delete hvS.fx[id]; } continue; }
    if (!f) { const g = hvEl('g', {}, root); f = hvS.fx[id] = {g, a: hvEl('path', {}, g), c: hvEl('path', {}, g)}; }
    f.g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    f.a.setAttribute('d', fl.d); f.a.style.fill = hvRgb(hvFlameRgb(Math.min(n.q, .9), hvS.pal)); f.a.style.fillOpacity = fl.alpha.toFixed(2);
    f.c.setAttribute('d', fl.dc); f.c.style.fill = hvRgb(hvS.pal.flame[4]); f.c.style.fillOpacity = fl.core.toFixed(2);
  }
  for (const id in hvS.fx) if (!hvS.nodes[id]) { hvS.fx[id].g.remove(); delete hvS.fx[id]; }
}
const hvTick = now => { if (!hvS.loop) return; hvFx(now); hvS.loop = requestAnimationFrame(hvTick); };

// System pressure gauge (top right of the stage): value, bar and the real inputs behind it.
export function hvGauge() {
  const s = hvS.sys, v = $('hive-g-v'); if (!s || !v) return;
  const pct = Math.round(hvS.p * 100), lvl = hvS.p >= .8 ? 'hi' : hvS.p >= .5 ? 'mid' : 'lo';
  v.textContent = pct + '%'; $('hive-g-fill').style.width = pct + '%';
  $('hive-gauge').dataset.level = lvl;
  $('hive-g-sub').textContent = `flames ${hvFlameLevel(hvS.p)} · anger ${Math.round(hvS.a * 100)}%`;
  $('hive-gauge').title = `${s.runW} running + ${s.qW} queued workers · ${s.blocked} blocked · ${s.tasks} running tasks · ${s.todo} queued cards · ${s.waiting} waiting on you · blocked share ${Math.round(s.bs * 100)}%`;
}

// Transient mood hook for H-5/H-7: a real event overrides the status mood for `ms`.
export function hvSetMood(id, mood, ms = 3000) {
  const n = hvS.nodes[id]; if (!n || !HV_MOODS.includes(mood)) return;
  n.temp = mood; n.mood = null; clearTimeout(n.tt);
  n.tt = setTimeout(() => { n.temp = null; n.mood = null; hvRender(); }, ms);
  hvRender();
}

export function hvStage() {
  const w = $('hive-stage'); if (!w) return [0, 0];
  // the stage fills the rest of the viewport under the header
  const top = w.getBoundingClientRect().top + (window.scrollY || 0), h = Math.max(420, Math.round(window.innerHeight - top - 16));
  if (Math.abs(w.offsetHeight - h) > 1) w.style.height = h + 'px';
  const r = w.getBoundingClientRect(); return [r.width, r.height || h];
}

export function hvRender(snap) {
  const fresh = !!snap; if (snap) hvS.snap = snap; snap = hvS.snap;
  if (!snap || !$('hive-svg')) return null;
  const [W, H] = hvStage(); if (W < 50 || H < 50) return null;
  const model = hvModel(snap, hvS.view);
  const key = [Math.round(W), Math.round(H), hvS.view, model.items.map(i => i.id).join()].join('|');
  if (key !== hvS.key || !hvS.L) { hvS.L = hvLayout(model, W, H); hvS.key = key; }   // positions only move when the roster or stage does
  const L = hvS.L, seen = new Set(), seenE = new Set();
  hvS.sys = model.sys; if (fresh) hvSoundDiff(snap, model);
  if (hvS.a == null || !hvS.loop) { hvS.a = model.sys.a; hvS.p = model.sys.p; }   // first paint (or no animation running): take the live value, then ease
  if (!$('hive-fx')) {   // one shared bloom filter for the rim, and the flame layer between the links and the nodes
    const svg = $('hive-svg'), df = hvEl('defs', {}, svg); df.innerHTML = '<filter id="hv-bloom" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>';
    svg.insertBefore(hvEl('g', {id: 'hive-fx'}), $('hive-nodes'));
  }
  $('hive-svg').setAttribute('viewBox', `${-W / 2} ${-H / 2} ${W} ${H}`);
  model.edges.forEach(e => {
    if (!L.pos[e.a] || !L.pos[e.b]) return;
    seenE.add(e.id);
    let el = hvS.edges[e.id]; if (!el) el = hvS.edges[e.id] = hvEl('line', {}, $('hive-edges'));
    el.setAttribute('x1', L.pos[e.a].x.toFixed(1)); el.setAttribute('y1', L.pos[e.a].y.toFixed(1));
    el.setAttribute('x2', L.pos[e.b].x.toFixed(1)); el.setAttribute('y2', L.pos[e.b].y.toFixed(1));
    el.setAttribute('class', 'hv-edge' + (e.hot ? ' hot' : '') + (e.thin ? ' thin' : '')); el.style.setProperty('--c', hvCol(e.fam));
  });
  model.items.forEach(it => { if (L.pos[it.id]) { seen.add(it.id); hvDrawNode(it, L.pos[it.id], L.k); } });
  for (const id in hvS.nodes) if (!seen.has(id)) { hvS.nodes[id].g.remove(); delete hvS.nodes[id]; }
  for (const id in hvS.edges) if (!seenE.has(id)) { hvS.edges[id].remove(); delete hvS.edges[id]; }
  // labels and family titles always draw on top of bodies and edges
  const nodes = $('hive-nodes'); Object.values(hvS.nodes).forEach(n => { if (n.title) nodes.appendChild(n.g); });
  hvTabs(model); hvViews(model); hvLayers(); if (fresh) hvPaintComms();
  hvS.zoom = attachZoom($('hive-svg'), {key: 'hive', getBase: () => { const [w, h] = hvStage(); return {x: -w / 2, y: -h / 2, w, h}; }});
  hvPaintHazem(); hvGauge();
  if (hvHooks.onRender) hvHooks.onRender(model, L);
  return {model, L};
}

export function hvTabs(model) {
  const c = model.counts, T = [['Assistants', c.assistants], ['Brains', c.brains], ['Agents working', c.agents], ['Running', c.running], ['Queued', c.queued], ['Blocked', c.blocked], ['Done', c.done]];
  const el = $('hive-tabs'); if (el) el.innerHTML = T.map(([l, v]) => `<div class="hv-stat"><b>${v}</b><span>${l}</span></div>`).join('');
}
export function hvViews(model) {
  const el = $('hive-views'); if (!el) return;
  const V = [['all', 'All families'], ...model.fams.map(f => [f.id, f.label])];
  const k = JSON.stringify(V) + '|' + hvS.view;
  if (el.dataset.k === k) return;   // same roster + selection: keep the buttons (and focus) across refreshes
  el.dataset.k = k;
  el.innerHTML = V.map(([id, l]) => `<button type="button" class="seg-btn${id === hvS.view ? ' on' : ''}" data-hv="${esc(id)}" aria-pressed="${id === hvS.view}">${esc(l)}</button>`).join('');
}
export function hvSetView(v) {
  hvS.view = v; hvS.key = ''; hvC.pk = '';
  try { localStorage.setItem('hiveView', v); } catch (_) { /* private mode */ }
  hvRender();
}

export function hvPill(live, text) {
  const p = $('hive-pill'); if (!p) return;
  hvS.live = live; p.className = 'stamp hv-pill ' + (live ? 'fresh' : 'old'); p.textContent = text;
  if (live) p.dataset.stampState = 'fresh'; else delete p.dataset.stampState;
}

export async function hvPoll() {
  try {
    if (!hvS.es && hvC.seq != null) {   // no live stream: replay exactly the frames missed since the last seen seq
      const q = await fetch('/api/hive?since=' + hvC.seq), d = q.ok ? await q.json() : null;
      if (d && d.type === 'reset') hvSnapshot(d.snapshot, true);
      else if (d && d.type === 'delta') { d.events.forEach(hvApply); hvC.seq = Math.max(hvC.seq, d.to); }
    }
    const r = await fetch('/api/hive'); if (!r.ok) throw new Error(r.status);
    hvSnapshot(await r.json()); hvPill(true, hvS.es ? 'live' : 'live · polling');
  } catch (_) { hvPill(false, 'reconnecting…'); }
}
export function hvConnect() {
  if (hvS.es || hvS.timer) return;
  // The /api/hive refresher runs in every mode: the stream only speaks when
  // something changed and closes idle after 10 minutes, but the moods, states
  // and counters on the faces must keep following real data either way.
  hvS.timer = setInterval(hvPoll, 5000);
  hvPoll();
  const open = () => {   // also the retry path after a stream error
    if (hvS.es || !hvS.timer || typeof EventSource !== 'function') return;
    const es = hvS.es = new EventSource('/api/hive/stream');
    es.addEventListener('snapshot', e => { hvSnapshot(JSON.parse(e.data), true); hvPill(true, 'live'); });
    // A delta frame is real change: apply it (feed + animation), then refresh the snapshot (at most once a second).
    es.addEventListener('delta', e => { try { hvApply(JSON.parse(e.data)); } catch (_) { /* heartbeat or malformed */ } hvPill(true, 'live'); if (Date.now() - hvC.pollAt >= 1000) { hvC.pollAt = Date.now(); hvPoll(); } });
    es.onerror = () => { hvPill(false, 'reconnecting…'); es.close(); if (hvS.es === es) hvS.es = null; hvC.retry = setTimeout(open, 5000); };
  };
  open();
}
export function hvStop() {
  if (hvS.loop) { cancelAnimationFrame(hvS.loop); hvS.loop = 0; hvS.t = 0; }
  if (hvS.es) { hvS.es.close(); hvS.es = null; }
  if (hvS.timer) { clearInterval(hvS.timer); hvS.timer = null; }
  hvC.rt.forEach(clearTimeout); hvC.rt = []; hvC.bt.forEach(clearTimeout); hvC.bt.clear(); hvC.ft.forEach(clearTimeout); hvC.ft.clear(); clearTimeout(hvC.retry); clearInterval(hvC.hb); hvC.hb = 0; hvSnd.show = false; hvDisarm(); hvAmbient(false); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}

// Called by the router whenever the Hive tab is shown or hidden.
export function hvShow(on) {
  if (!on) { hvStop(); return; }
  try { hvS.view = localStorage.getItem('hiveView') || 'all'; } catch (_) { hvS.view = 'all'; }
  hvSndInit(); hvCommInit();
  if (!hvS.bound) {
    hvS.bound = true;
    $('hive-views').addEventListener('click', e => { const b = e.target.closest('[data-hv]'); if (b) hvSetView(b.dataset.hv); });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => hvRender()).observe($('hive-stage'));
    else window.addEventListener('resize', () => hvRender());
  }
  hvPill(false, 'connecting…');
  requestAnimationFrame(() => { if (hvS.snap) hvRender(); hvConnect(); if (!hvS.loop) hvS.loop = requestAnimationFrame(hvTick); });
}

// ---- Sound + voice (LLMTELEMET-273): Web Audio synth and browser speech, driven only by real snapshot changes ----
// On by default but silent until the first gesture unlocks the shared AudioContext (live.js); toggles persist in localStorage.
export const hvSnd = {on: true, amb: false, voice: true, vol: .5, ctx: null, m: null, last: {}, prev: null, lv: 0, pb: -1, show: false, unl: [], vs: null, k: 1, pv: 1, a: null};
const hvLs = (k, d, v) => { try { if (v === undefined) { const x = localStorage.getItem(k); return x == null ? d : x; } localStorage.setItem(k, v); } catch (_) { /* private mode */ } return d; };
export const hvLvOf = a => a >= .85 ? 3 : a >= .6 ? 2 : a >= .35 ? 1 : 0;
export const hvQuiet = (h = new Date().getHours()) => h >= 22 || h < 7;   // quiet hours: only done and dizzy, softly; no beds, pressure or barks
const hvReduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const hvHash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const hvNote = f => 440 * 2 ** (hvHash(f) % 8 / 12);

function hvTone(f, {d = .15, t = 'sine', v = .2, at = 0, s = 0, a = .005} = {}) {
  const c = hvSnd.ctx, w = c.currentTime + at, o = c.createOscillator(), g = c.createGain(); f *= hvSnd.pv;
  o.type = t; o.frequency.setValueAtTime(f, w); if (s) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * s), w + d);
  g.gain.setValueAtTime(0, w); g.gain.linearRampToValueAtTime(v * .35 * hvSnd.k, w + a); g.gain.exponentialRampToValueAtTime(.0001, w + d);
  o.connect(g); g.connect(hvSnd.m); o.start(w); o.stop(w + d + .05);
}
function hvNoise(d, v, hp, at = 0) {
  const c = hvSnd.ctx, b = c.createBuffer(1, c.sampleRate * d, c.sampleRate), x = b.getChannelData(0), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / x.length);
  s.buffer = b; f.type = 'highpass'; f.frequency.value = hp; g.gain.value = v * .35 * hvSnd.k; s.connect(f); f.connect(g); g.connect(hvSnd.m); s.start(c.currentTime + at);
}
const hvT = hvTone;
const hvN = hvNoise;
// Every cue the old Hive had (launch..calm) plus a graded kettle/boil/klaxon pressure cue (never a roar or a scream).
export const HV_SFX = {
  launch: f => hvT(hvNote(f) * 2, {d: .12, t: 'triangle', v: .08, s: 1.6}),
  arrive: f => hvT(hvNote(f) * 4, {d: .09, v: .07}),
  newTask: f => { [1, 1.5, 2].forEach((m, i) => hvT(hvNote(f) * m, {d: .35, t: 'triangle', v: .14, at: i * .07})); hvN(.2, .05, 3000); },
  done: f => { [1, 1.26, 1.5, 2, 2.52, 3, 4].forEach((m, i) => hvT(hvNote(f) * m, {d: .5, t: 'square', v: .05, at: i * .06})); hvT(hvNote(f) / 2, {d: 1.2, v: .15}); hvN(.5, .08, 5000, .05); },
  blocked: () => { hvT(110, {d: .6, t: 'sawtooth', v: .12, s: .5}); hvT(116, {d: .6, t: 'sawtooth', v: .1, s: .5}); hvN(.3, .12, 200); },
  running: f => hvT(hvNote(f) * 4, {d: .18, v: .1, s: 1.25}),
  whoosh: () => { hvN(.6, .1, 400); hvT(80, {d: .8, v: .25, s: 3}); },
  click: () => hvT(1200, {d: .04, t: 'square', v: .05}),
  blast: f => { hvT(hvNote(f) * 3, {d: .18, t: 'sawtooth', v: .12, s: .25}); hvN(.12, .14, 1500); },
  casings: () => [0, 1, 2].forEach(i => hvT(2600 + Math.random() * 900, {d: .05, t: 'triangle', v: .05, at: .18 + i * .07})),
  hit: () => { hvN(.22, .18, 300); hvT(70, {d: .25, v: .3, s: .5}); },
  shatter: () => { hvN(.6, .14, 4000); [0, .05, .11, .18, .26].forEach(t => hvT(3000 + Math.random() * 3000, {d: .12, v: .05, at: t})); },
  charge: () => hvT(200, {d: .45, t: 'sawtooth', v: .07, s: 4, a: .3}),
  dizzy: () => [0, 1, 2, 3].forEach(i => hvT(i % 2 ? 660 : 520, {d: .12, v: .08, at: i * .12})),
  grumble: () => { hvT(90, {d: .5, t: 'sawtooth', v: .14, s: .7}); hvT(97, {d: .5, t: 'square', v: .06, s: .7}); },
  boom: () => { hvN(.9, .25, 60); hvT(50, {d: 1, v: .4, s: .4}); },
  rage: lv => { lv = hvClamp(lv | 0, 1, 3);   // 1 huff, 2 growl, 3 growl with stomps: lower, louder, longer; never a roar
    const f = [0, 120, 92, 70][lv], d = [0, .35, .6, .95][lv], v = [0, .1, .15, .22][lv];
    hvT(f, {d, t: 'sawtooth', v, s: .65}); hvT(f * 1.07, {d, t: 'square', v: v / 2, s: .6}); hvN(d * .8, v * .7, [0, 900, 400, 150][lv]);
    if (lv > 1) [0, 1, 2].forEach(i => hvT(f * 2 + i * 9, {d: .09, t: 'sawtooth', v: v / 2, at: .08 + i * .11}));
    if (lv > 2) [0, .32, .64].forEach(t => { hvT(48, {d: .3, v: .45, at: t, s: .5}); hvN(.18, .2, 60, t); }); },
  calm: () => { hvT(659, {d: .4, v: .08, s: .75}); hvT(523, {d: .6, v: .07, at: .15}); },
  // pressure bands: 0 steam + boil bubbles (50-69%), 1 kettle whistle (70-79), 2 fuller whistle (80-89), 3 klaxon honk + whistle (90+)
  kettle: b => { hvN(.8, .04 + b * .01, 3000);
    if (!b) return [0, 1].forEach(i => hvT(300 + 150 * i, {d: .08, v: .04, at: .15 + i * .25}));
    const w = 1300 + b * 60; hvT(w, {d: .9, v: .04 + b * .01, s: 1.04}); if (b > 1) hvT(w * 1.02, {d: .9, v: .04, s: 1.04});
    if (b > 2) [0, .32].forEach((t, i) => hvT(i ? 330 : 440, {d: .28, t: 'square', v: .06, at: t})); },
};
const HV_CD = {kettle: 1600, launch: 90, arrive: 250, click: 60, rage: 1500, calm: 2000};

// Plays one cue; false when sound is off, still locked (no gesture yet), muted by quiet hours / reduced motion (no glass, blast, boom, charge, kettle above 70%), or cooling down.
export function hvPlay(n, arg) {
  const S = hvSnd, c = S.ctx, now = Date.now(), q = hvQuiet(), rm = hvReduced();
  if (!S.show || !S.on || !c || c.state !== 'running' || !HV_SFX[n]) return false;
  if (q ? n !== 'done' && n !== 'dizzy' : rm && (/^(shatter|blast|boom|charge)$/.test(n) || n === 'kettle' && arg > 0)) return false;
  if (now - (S.last[n] || 0) < (HV_CD[n] ?? 400)) return false;
  S.last[n] = now; S.k = q ? .35 : rm ? .5 : 1; S.pv = S.pv === 1 ? 1.06 : 1;   // two pitch variants, alternating
  HV_SFX[n](arg); return true;
}

export function hvAmbient(on) {
  const S = hvSnd, c = S.ctx;
  if (on && c && S.m && !S.a && S.show && !hvQuiet()) {
    const g = c.createGain(), f = c.createBiquadFilter(); g.gain.value = 0; g.gain.linearRampToValueAtTime(.05, c.currentTime + 2); f.type = 'lowpass'; f.frequency.value = 400; f.Q.value = 6;
    S.a = {g, os: [55, 82.4, 110.3].map(r => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = r; o.connect(f); o.start(); return o; })}; f.connect(g); g.connect(S.m);
  } else if (!on && S.a) { const a = S.a; S.a = null; a.g.gain.linearRampToValueAtTime(0, c.currentTime + 1); setTimeout(() => a.os.forEach(o => o.stop()), 1200); }
}

// Voice: a stable voice per profile (hash), angrier = lower, faster, clipped ("!" at level 3); the project name opens every line.
export function hvVoice(profile, lv = 0, mood = '', nv = 0) {
  const h = hvHash(profile || 'x'); let pitch = .7 + (h % 9) / 8 - .18 * lv, rate = 1.05 + (h % 5) / 20 + .07 * lv;
  if (mood === 'happy') { pitch += .25; rate += .05; } else if (mood === 'dizzy' || mood === 'worry') rate -= .15;
  return {vi: nv ? h % nv : -1, pitch: hvClamp(pitch, .1, 2), rate: hvClamp(rate, .6, 1.7), volume: lv >= 2 ? 1 : .9};
}
export const hvLine = (project, text, lv = 0) => { const t = (project ? 'On ' + project + '. ' : '') + text; return lv >= 3 ? t.replace(/[.\s]*$/, '!') : t; };
// English voices, cached once the browser has any (Chrome fills the list late) so a profile's voice never changes mid-session.
function hvVoices(ss) {
  const S = hvSnd; if (S.vs) return S.vs;
  const vs = (ss.getVoices() || []).filter(v => /^en/i.test(v.lang));
  if (vs.length) S.vs = vs; return vs;
}
export function hvSay(profile, text, project, lv = 0, mood = '') {
  const S = hvSnd, ss = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  if (!S.show || !S.on || !S.voice || !S.ctx || !ss || hvQuiet() || ss.pending || ss.speaking) return false;   // locked before the first gesture, never piles up
  const vs = hvVoices(ss); if (!vs.length) return false;   // no voice list yet: stay silent rather than switch voice later
  const p = hvVoice(profile, lv, mood, vs.length), u = new SpeechSynthesisUtterance(hvLine(project, text, lv));
  if (p.vi >= 0) u.voice = vs[p.vi];
  u.pitch = p.pitch; u.rate = p.rate; u.volume = p.volume * (hvReduced() ? .5 : 1);
  ss.speak(u); return true;
}

// Real changes only: the first snapshot is a baseline, later ones sound per-brain done / blocked / started / queued, anger-level moves and the pressure band.
export function hvSoundDiff(snap, model) {
  const S = hvSnd, cur = {}, prev = S.prev, p = model.sys.p, a = model.sys.a, lv = hvLvOf(a), was = S.lv;
  const pb = p >= .9 ? 3 : p >= .8 ? 2 : p >= .7 ? 1 : p >= .5 ? 0 : -1, wasPb = S.pb;
  S.prev = cur; S.lv = lv; S.pb = pb;
  if (S.a && hvQuiet()) hvAmbient(false); else if (!S.a && S.on && S.amb) hvAmbient(true);   // the hum ends when quiet hours begin
  (snap.families || []).forEach(f => (f.brains || []).forEach(b => { const k = b.counts || {};
    cur[f.id + b.id] = {r: k.running || 0, b: k.blocked || 0, d: k.done || 0, q: (k.todo || 0) + (k.ready || 0), l: b.label, i: b.id, f: f.id}; }));
  if (!prev) return;
  for (const id in cur) {
    const c = cur[id], o = prev[id], say = (t, m) => hvSay(c.i, t, c.l, lv, m); if (!o) continue;
    if (c.d > o.d) { hvPlay('done', c.f); say('Task finished.', 'happy'); }
    else if (c.b > o.b) { hvPlay('blocked'); say('Task blocked.', 'angry'); }
    else if (c.r > o.r) hvPlay('launch', c.f);
    else if (c.q > o.q) hvPlay('newTask', c.f);
  }
  if (lv > was) hvPlay('rage', lv); else if (lv < was && !lv) hvPlay('calm');
  if (pb > wasPb) hvPlay('kettle', pb);   // only when the pressure band rises, never at steady pressure
}

function hvPaintSnd() {
  const S = hvSnd;
  [['hive-snd', S.on], ['hive-amb', S.amb && S.on], ['hive-voice', S.voice]].forEach(([id, on]) => { const b = $(id); if (b) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); } });
}
// First gesture: resume the shared AudioContext (live.js), build the master chain, greet. Nothing is created or played before it.
export function hvUnlock() {
  const S = hvSnd; if (S.m) return S.ctx;
  try { S.ctx = ensureAudioCtx(); } catch (_) { return null; }
  const c = S.ctx, k = c.createDynamicsCompressor(); S.m = c.createGain(); S.m.gain.value = S.vol; S.m.connect(k); k.connect(c.destination);
  hvAmbient(S.on && S.amb); hvSay('hive', 'Hive is live.');
  return c;
}
// First-gesture listeners live only while Hive is showing: leaving the tab removes them, returning re-arms them until unlocked.
function hvArm() {
  const S = hvSnd; if (S.m || S.unl.length) return;
  ['pointerdown', 'keydown', 'touchend'].forEach(e => { const f = () => { if (hvUnlock()) hvDisarm(); }; window.addEventListener(e, f, true); S.unl.push([e, f]); });
}
function hvDisarm() { const S = hvSnd; S.unl.forEach(([e, f]) => window.removeEventListener(e, f, true)); S.unl = []; }
export function hvSndInit() {
  const S = hvSnd; if (S.bound) { S.show = true; hvArm(); return; } S.bound = true;
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => hvVoices(speechSynthesis));
  S.on = hvLs('hiveSound', '1') !== '0'; S.amb = hvLs('hiveAmb', '0') === '1'; S.voice = hvLs('hiveVoice', '1') !== '0'; S.vol = hvClamp(+hvLs('hiveVol', '.5') || 0, 0, 1);
  S.show = true; hvArm();
  [['hive-snd', 'on', 'hiveSound'], ['hive-amb', 'amb', 'hiveAmb'], ['hive-voice', 'voice', 'hiveVoice']].forEach(([id, key, ls]) => { const b = $(id);
    if (b) b.addEventListener('click', () => { S[key] = !S[key]; hvLs(ls, 0, S[key] ? '1' : '0'); hvUnlock(); if (key === 'voice' && S.voice) hvSay('hive', 'Voice on.'); hvAmbient(S.on && S.amb); hvPaintSnd(); }); });
  const v = $('hive-vol'); if (v) { v.value = S.vol * 100; v.addEventListener('input', () => { S.vol = v.value / 100; hvLs('hiveVol', 0, S.vol); if (S.m) S.m.gain.value = S.vol; }); }
  hvPaintSnd();
}

// ---- Comms, events, replay, firing mode (LLMTELEMET-274, H-7): every animation comes from a real frame or comm, never a timer ----
export const HV_VOCAB = {
  ask: ['On it?', 'Status, please.'], reply: ['Got it.', 'Copy that.'], replyGood: ['Shipped it.', 'All green.'], replyBad: ["I'm blocked.", 'That failed.'], comment: ['Checkpoint.'],
  done: ['Done!'], blocked: ['Blocked!'], crashed: ['Ouch.'], timed_out: ['Timed out.'], gave_up: ['I give up.'], spawned: ['Worker spawned.'], unblocked: ['Free again!'],
};
const HV_GOOD = /\b(done|merged|shipped|green|passed|closed|fixed)\b/i;
const HV_BAD = /\b(blocked|fail(ed)?|error|crash(ed)?|can'?t|broken|timed? ?out|stuck)\b/i;
const hvTx = c => HV_BAD.test(c.text || '') ? 'Bad' : HV_GOOD.test(c.text || '') ? 'Good' : '';
export const hvOutcome = c => c.kind === 'event' ? ({done: 'happy', unblocked: 'happy', blocked: 'angry', gave_up: 'angry', crashed: 'dizzy', timed_out: 'dizzy'})[c.event] || null
  : c.kind === 'reply' || c.kind === 'comment' ? ({Bad: 'angry', Good: 'happy'})[hvTx(c)] || null : null;
export const hvCommLine = (c, r = Math.random) => {
  const a = c.kind === 'event' ? HV_VOCAB[c.event] || HV_VOCAB.comment : HV_VOCAB[c.kind === 'reply' ? 'reply' + hvTx(c) : c.kind] || HV_VOCAB.ask;
  return a[Math.floor(r() * a.length)];
};
const hvFamOf = p => /^pv-|pixelvent/.test(p) ? 'pixelvent' : /^acasia/.test(p) ? 'acasia' : /^sp-|aixiom|rebate|somethingpressing/.test(p) ? 'somethingpressing' : 'root';

// profile -> node id for the live roster; resolve() falls back board -> map -> family assistant -> Hazem
export function hvPmap(snap) {
  const m = {hazem: 'hazem', cron: 'hazem', system: 'hazem'};
  ((snap && snap.families) || []).forEach(f => {
    m[f.assistant.id] = 'a:' + f.id; (f.bots || []).forEach(b => { m[b.id] = `b:${f.id}:${b.id}`; });
    (f.brains || []).forEach(b => { m[b.id] = `b:${f.id}:${b.id}`; (b.agents || []).forEach(a => { m[a.id] = m[a.id] || `g:${f.id}:${b.id}:${a.id}`; }); });
  });
  return m;
}
export function hvResolve(p, board, snap, has = () => true, pm = hvPmap(snap)) {
  if (!p) return null;
  for (const f of board && snap ? snap.families || [] : []) for (const b of f.brains || []) if (b.board === board) {
    if (b.id === p) return `b:${f.id}:${b.id}`; if (has(`g:${f.id}:${b.id}:${p}`)) return `g:${f.id}:${b.id}:${p}`; }
  const a = 'a:' + hvFamOf(p); return pm[p] && has(pm[p]) ? pm[p] : has(a) ? a : has('hazem') ? 'hazem' : null;
}
export function hvProject(c, snap) {
  const nice = x => x.replace(/-brain$/, '').replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
  for (const f of (snap && snap.families) || []) for (const b of f.brains || []) if (c.board && b.board === c.board || b.id === c.to || b.id === c.from) return b.label || nice(c.board && b.board === c.board ? b.board : b.id);
  const t = c.board || [c.to, c.from].find(x => x && /-brain$/.test(x)); return t ? nice(t) : '';
}
export const hvWho = (p, pm, lbl) => ({hazem: 'Hazem', cron: 'Cron', board: 'card'})[p] || (lbl && lbl(pm[p])) || hvShort(p);
export function hvWrap(t, w = 34, max = 3) {
  const L = [''];
  for (const x of String(t).split(' ')) {
    if ((L[L.length - 1] + ' ' + x).trim().length > w) { if (L.length === max) { L[max - 1] += '…'; break; } L.push(x); } else L[L.length - 1] = (L[L.length - 1] + ' ' + x).trim();
  }
  return L;
}
export const hvVia = (c, o) => (o.replay ? 'replay · ' + ago(Math.max(0, o.now - c.at)) + ' ago · ' : '') + (o.project ? o.project.toUpperCase() + ' · ' : '')
  + `${hvWho(c.from, o.pm, o.lbl)} → ${hvWho(c.to, o.pm, o.lbl)} · ${c.via}${c.task ? ' · ' + c.task.slice(0, 30) : ''}`;

export const hvC = {shown: new Set(), log: [], seq: null, first: true, lastSnap: 0, fire: true, bump: 0, hb: 0, pk: '', bound: false, rt: [], bt: new Set(), ft: new Set(), pollAt: 0, retry: 0};
const hvHas = id => !!hvS.nodes[id];
const hvNLabel = id => hvS.nodes[id] && hvS.nodes[id].label;
const hvFamId = id => id === 'hazem' ? 'root' : String(id).split(':')[1];
const hvInView = (c, view, snap) => {
  const pm = hvPmap(snap), a = hvResolve(c.from, c.board, snap, hvHas, pm), b = hvResolve(c.to, c.board, snap, hvHas, pm);
  return view === 'all' || [a, b].some(x => x && hvFamId(x) === view) || hvFamOf(c.from) === view || hvFamOf(c.to) === view;
};

function hvLayers() { const svg = $('hive-svg'); if (svg && !$('hive-bubbles')) ['hive-pk', 'hive-bubbles'].forEach(id => hvEl('g', {id}, svg)); }
function hvTween(ms, fn, done) {   // a hidden tab pauses rAF: finish at once instead of stalling the choreography
  if (document.hidden || typeof requestAnimationFrame !== 'function') { fn(1); if (done) done(); return; }
  let t0; const st = t => { t0 = t0 || t; const u = Math.min(1, (t - t0) / ms); fn(u); if (u < 1) requestAnimationFrame(st); else if (done) done(); }; requestAnimationFrame(st);
}
function hvKick(cls) { const s = $('hive-stage'); if (!s) return; s.classList.remove(cls); void s.offsetWidth; s.classList.add(cls); setTimeout(() => s.classList.remove(cls), 900); }
function hvPacket(a, b, fam, o = {}) {
  const A = hvS.nodes[a], B = hvS.nodes[b], g = $('hive-pk');
  if (!A || !B || !g || A.x == null || B.x == null) { if (o.then) o.then(); return; }
  const e = hvEl('polygon', {class: 'hv-pk', points: o.bolt ? '-10,0 0,-2.5 10,0 0,2.5' : hvHex(5)}, g), dx = B.x - A.x, dy = B.y - A.y, rot = o.bolt ? Math.round(Math.atan2(dy, dx) * 57.3) : 0;
  e.style.setProperty('--c', hvCol(fam));
  hvTween(Math.max(260, Math.hypot(dx, dy) * (o.bolt ? 1 : 2)), u => e.setAttribute('transform', `translate(${(A.x + dx * u).toFixed(1)},${(A.y + dy * u).toFixed(1)}) rotate(${rot})`), () => { e.remove(); if (o.then) o.then(); });
}
function hvPuff(id, cls, n = 0, v = 120, fam = '') {   // n confetti polygons thrown out and faded, or (n = 0) one expanding wave ring
  const N = hvS.nodes[id], g = $('hive-pk'); if (!N || !g || N.x == null) return;
  const ps = [...Array(n || 1)].map((_, i) => ({e: hvEl('polygon', {class: n ? 'hv-p conf' : 'hv-wave ' + cls, points: n ? hvNgon(0, 0, 2.6, 2.6, 4) : hvHex(1)}, g), a: Math.PI * 2 * i / n + Math.random(), v: 46 * (.5 + Math.random())}));
  if (n) ps.forEach(p => p.e.style.setProperty('--c', hvCol(fam || (N.fam) || hvFamId(id))));
  hvTween(n ? 900 : 700, u => ps.forEach(p => { p.e.style.opacity = 1 - u; p.e.setAttribute('transform', n ? `translate(${(N.x + Math.cos(p.a) * p.v * u).toFixed(1)},${(N.y + Math.sin(p.a) * p.v * u + 34 * u * u).toFixed(1)}) rotate(${Math.round(u * 360)})` : `translate(${N.x.toFixed(1)},${N.y.toFixed(1)}) scale(${(14 + v * u).toFixed(1)})`); }), () => ps.forEach(p => p.e.remove()));
}
const hvBump = v => { hvC.bump = hvClamp(hvC.bump + v, -.3, .4); };   // a transient lift on the data-derived anger; decays in hvFx

const HV_VIA_MAX = 48;
// Speech bubble above a node. Never more than 2 on screen: a new one evicts the oldest.
export function hvBubble(id, text, via, fam, ms = 5200) {
  const n = hvS.nodes[id], box = $('hive-bubbles'); if (!n || n.x == null || !text || !box) return null;
  while (box.children.length >= 2) box.firstChild.remove();
  via = hvClip(via, HV_VIA_MAX);
  const L = hvWrap(text), w = Math.max(...L.map(l => l.length * 7.8), via.length * 7.8) + 24, h = L.length * 18 + 32, B = hvS.L ? hvS.L.bounds : {x0: -300, x1: 300, y0: -300};
  const x = hvClamp(n.x + 30 + w > B.x1 ? n.x - w - 30 : n.x + 30, B.x0, Math.max(B.x0, B.x1 - w)), y = Math.max(B.y0, n.y - h - 24), g = hvEl('g', {class: 'hv-bubble'}, box);
  g.style.setProperty('--c', hvCol(fam)); hvEl('rect', {x, y, width: w, height: h}, g);
  hvEl('text', {x: x + 12, y: y + 15, class: 'hv-via'}, g).textContent = via;
  L.forEach((l, i) => { hvEl('text', {x: x + 12, y: y + 36 + i * 18}, g).textContent = l; });
  const t = setTimeout(() => { hvC.bt.delete(t); g.remove(); }, ms); hvC.bt.add(t); return g;
}

// One real message: sender -> recipient (laser bolt in firing mode, big packet otherwise), then the outcome on arrival.
export function hvPlayComm(c, {replay = false} = {}) {
  const snap = hvS.snap, pm = hvPmap(snap), a = hvResolve(c.from, c.board, snap, hvHas, pm), b = hvResolve(c.to === 'board' ? c.from : c.to, c.board, snap, hvHas, pm); if (!a) return false;
  const fam = (hvS.nodes[a] && hvS.nodes[a].fam) || hvFamId(a), o = hvOutcome(c), pj = hvProject(c, snap), ev = c.kind === 'event', who = p => hvWho(p, pm, hvNLabel), fire = hvC.fire;
  const via = hvVia(c, {replay, now: Date.now() / 1000, project: pj, pm, lbl: hvNLabel}), words = n => String(c.text || '').replace(/https?:\S+/g, 'link').split(/\s+/).slice(0, n).join(' ');
  const arrive = () => {
    const t = b || a, lv = Math.max(1, hvLvOf(hvS.a)), say = m => ev && hvSay(c.from, `${hvCommLine(c)} ${who(c.from)}: ${String(c.event || '').replace('_', ' ')}. ${words(8)}`, pj, o === 'angry' ? lv : 0, m);
    hvBubble(ev ? t : a, ev ? [String(c.event || '').replace('_', ' '), c.text].filter(Boolean).join(': ') : c.text, via, fam);
    if (o === 'happy') { const was = hvLvOf(hvS.a); hvBump(-.15); hvSetMood(t, 'happy', 3500); hvPuff(t, '', 18, 120, fam); hvPlay('done', fam); if (was) hvPlay('calm'); say('happy'); }
    else if (o === 'angry') { hvBump(.25); hvSetMood(t, lv >= 2 ? 'fire' : 'angry', 3500 + lv * 1000); if (t !== a) hvSetMood(a, 'angry', 3000); hvPuff(t, 'bad', 0, 140 + lv * 60); hvKick('hv-flash'); hvPlay('rage', lv); if (fire && lv >= 3) hvPlay('boom'); say('angry'); }
    else if (o === 'dizzy') { hvSetMood(t, 'dizzy', 4000); hvPlay('dizzy'); say('dizzy'); }
    else { hvSetMood(t, 'wow', 1600); hvPlay(fire ? 'hit' : 'arrive', fam); }
  };
  if (!ev) hvSay(c.from, `${who(c.from)} ${c.kind === 'reply' ? 'reports to' : c.kind === 'comment' ? 'notes for' : 'asks'}${c.to && c.to !== 'board' ? ' ' + who(c.to) : ''}: ${words(16)}`, pj, hvLvOf(hvS.a), '');
  if (!b || b === a) { hvSetMood(a, 'talk', 2500); arrive(); return true; }
  if (fire) { hvSetMood(a, 'fire', 1400); hvPlay('charge'); const ft = setTimeout(() => { hvC.ft.delete(ft); hvPlay('blast', fam); hvPacket(a, b, fam, {bolt: true, then: arrive}); }, 280); hvC.ft.add(ft); }
  else { hvSetMood(a, 'talk', 2000); hvPacket(a, b, fam, {then: arrive}); }
  return true;
}

// Conversations panel
const hvHM = at => new Date(at * 1000).toTimeString().slice(0, 5);
const hvRow = c => {
  const o = hvOutcome(c), pm = hvPmap(hvS.snap), pj = hvProject(c, hvS.snap), who = p => esc(hvWho(p, pm, hvNLabel)), tag = (x, k = '') => `<span class="hv-tag ${k}">${esc(x)}</span>`, d = document.createElement('div');
  d.className = 'hv-cm' + (c.pending ? ' pending' : '') + (o === 'angry' || o === 'dizzy' ? ' bad' : o === 'happy' ? ' good' : '');
  d.innerHTML = `<div class="hv-hd"><span style="color:${hvCol(hvFamOf(c.from))}">${who(c.from)}</span>→<span style="color:${hvCol(hvFamOf(c.to === 'board' ? c.from : c.to))}">${who(c.to)}</span>`
    + `${pj ? tag(pj, 'hv-pj') : ''}${tag(c.via)}${tag(c.kind === 'event' ? c.event : c.kind)}${c.pending ? tag('waiting reply', 'p') : ''}<span class="hv-meta">${hvHM(c.at)}</span></div>`
    + `<div class="hv-tx">${c.task && c.kind !== 'event' ? `<b>${esc(c.task)}</b> · ` : ''}${esc(c.text)}</div>`;
  return d;
};
const hvVisible = () => hvC.log.filter(c => hvInView(c, hvS.view, hvS.snap));
const hvPk = () => hvS.view + '|' + hvS.key + '|' + hvC.log.length;
const hvCount = () => { $('hive-ccount').textContent = `${hvVisible().length} in 12 h`; hvC.pk = hvPk(); };
export function hvPaintComms() {
  const list = $('hive-clist'); if (!list || hvC.pk === hvPk()) return;
  list.innerHTML = ''; hvVisible().slice(-80).reverse().forEach(c => list.appendChild(hvRow(c))); hvCount();
}
export function hvAddComm(c, animate) {
  if (hvC.shown.has(c.id)) return false; hvC.shown.add(c.id); hvC.log.push(c); if (hvC.log.length > 400) hvC.log.shift();
  if (!hvInView(c, hvS.view, hvS.snap)) return false;
  const list = $('hive-clist');
  if (list) { list.prepend(hvRow(c)); while (list.children.length > 80) list.lastChild.remove(); hvCount(); }
  if (animate) hvPlayComm(c);
  return true;
}

// Task-events panel + choreography: Hazem -> assistant -> brain -> agent hops, then the status outcome
export function hvFeed(ev) {
  const box = $('hive-feed'); if (!box) return;
  if ($('hive-feedempty')) $('hive-feedempty').remove();
  const f = ((hvS.snap && hvS.snap.families) || []).find(x => x.id === ev.family), d = document.createElement('div'), st = esc(ev.status);
  const verb = ev.worker ? (ev.kind === 'new' ? 'worker started:' : `worker <b>${st}</b>:`) : ev.kind === 'new' ? 'new task for' : `${esc(ev.from)} → <b class="hv-st-${st}">${st}</b> ·`;
  d.innerHTML = `<time>${hvHM(ev.at)}</time><span><b style="color:${hvCol(ev.family)}">${esc(f ? f.assistant.label : ev.family)}</b> · <b>${esc(ev.board)}</b> · ${verb} ${ev.worker ? '' : `<b>${esc(hvShort(ev.agent))}</b> — `}${esc(ev.title)}</span>`;
  box.prepend(d); while (box.children.length > 40) box.lastChild.remove();
}
export function hvHops(ev, has = hvHas) {
  const aid = 'a:' + ev.family, b0 = `b:${ev.family}:${ev.brain}`, g = `g:${ev.family}:${ev.brain}:${ev.agent}`, bid = has(b0) ? b0 : aid, end = has(g) ? g : bid;   // an assistant's own worker has no brain node
  return {aid, end, hops: [['hazem', aid], [aid, bid], [bid, end]].filter(([x, y]) => x !== y && has(x) && has(y))};
}
export function hvPlayEvent(ev) {
  const {aid, end, hops} = hvHops(ev); if (!hvHas(aid)) return false;
  const fam = ev.family, st = ev.status, finish = () => {
    if (st === 'done' || st === 'finished') { if (st === 'done') { hvPuff(end, '', 22, 120, fam); hvKick('hv-flash-ok'); } hvPuff(end, 'ok', 0, 200); hvPlay('done', fam); }
    else if (st === 'blocked') { hvBump(.2); hvPuff(end, 'bad', 0, 200); hvPlay('rage', Math.max(1, hvLvOf(hvS.a))); hvKick('hv-flash'); }
    else if (ev.kind === 'new') { hvPuff(end, '', 0, 150); hvPuff(end, '', 14, 120, fam); hvPlay('newTask', fam); }
    else { hvPuff(end, '', 0, 120); hvPlay('running', fam); }
  }, run = i => i < hops.length ? hvPacket(hops[i][0], hops[i][1], fam, {then: () => run(i + 1)}) : finish();
  run(0); return true;
}
export function hvReplay() {   // the last 8 conversations, 1.5 s apart
  hvUnlock();
  hvC.rt.forEach(clearTimeout); hvC.rt = [];
  return hvVisible().slice(-8).map((c, i) => { hvC.rt.push(setTimeout(() => hvPlayComm(c, {replay: true}), i * 1500)); return i * 1500; });
}

// Honest heartbeat: how fresh the data is and when the last real message happened; nothing else
export const hvBeat = (log, lastSnap, now) => {
  const last = Math.max(0, ...log.map(c => c.at));
  return {last: last ? `last real message: ${ago(Math.max(0, Math.round(now - last)))} ago` : 'no messages yet', fresh: lastSnap ? `checked ${Math.max(0, Math.round(now - lastSnap))}s ago` : ''};
};
function hvBeatPaint() { const b = hvBeat(hvC.log, hvC.lastSnap, Date.now() / 1000); $('hive-lastreal').textContent = b.last; $('hive-fresh').textContent = b.fresh; }

// Frames from the stream or from ?since= polling; a seq we have already seen is ignored, so both paths can run together
export function hvApply(fr) {
  if (!fr || (fr.seq != null && hvC.seq != null && fr.seq <= hvC.seq)) return false;
  if (fr.seq != null) hvC.seq = fr.seq;
  if (fr.type === 'comm') hvAddComm(fr, true); else if (fr.type === 'event') { hvFeed(fr); hvPlayEvent(fr); }
  return true;
}
// The first snapshot is a baseline (logged, never animated); later ones animate the comms that arrived since.
export function hvSnapshot(s, reset) {
  hvRender(s);
  (s.comms || []).forEach(c => hvAddComm(c, !hvC.first && c.at > hvC.lastSnap - 10));
  hvC.lastSnap = s.at || 0; hvC.first = false;
  if (s.seq != null && (reset || hvC.seq == null)) hvC.seq = s.seq;
  hvPaintComms(); hvBeatPaint();
}
export function hvCommInit() {
  if (!hvC.hb) hvC.hb = setInterval(hvBeatPaint, 1000);
  if (hvC.bound) return; hvC.bound = true;
  hvC.fire = hvLs('hiveFire', '1') !== '0';
  const paint = () => { $('hive-fire').classList.toggle('on', hvC.fire); $('hive-fire').setAttribute('aria-pressed', hvC.fire); };
  $('hive-fire').addEventListener('click', () => { hvC.fire = !hvC.fire; hvLs('hiveFire', 0, hvC.fire ? '1' : '0'); paint(); hvUnlock(); if (hvC.fire) { hvPlay('charge'); setTimeout(() => hvPlay('boom'), 400); } });
  $('hive-replay').addEventListener('click', hvReplay); paint();
}
