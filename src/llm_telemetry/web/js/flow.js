/**
 * Flow: the provider→model→task force graph (layout, drag, focus/dim,
 * tooltip), the task-queue visualisation and the agent cards.
 */
import { $, ago, colorOf, esc, escA, hashHue, short } from './palette.js';
import { current } from './charts.js';
import { PROV, provOf, render } from './views.js';
import { DATA, css } from './main.js';
import { inFlight, kindMeta } from './live.js';
import { lnOpenModal, sfOpenPalette } from './drawer.js';

// LST-261: the queue is three glass jars of small balls. Depot = requests waiting at an Ollama
// host, on the line = live sessions (Hermes, Pi, Claude, Codex), yard = finished sessions. One
// ball per task, piled from the bottom (no scrolling: the balls shrink, then a "+N" chip takes
// over); balls are keyed and reused across polls, so only real arrivals/departures animate.
export function renderQueue(){
  const p = DATA.profiles[current] || {};
  const hosts = (DATA.ollama && DATA.ollama.hosts) || [];
  const titleOf = (title, model) => (title && title !== '(untitled)') ? title : (short(model) || 'session');

  const queuedAll = [];
  hosts.forEach(h => {
    const depth = Math.max(0, (+h.queue || 0));
    for (let i = 0; i < depth; i++) {
      queuedAll.push({ key: `q:${h.label}:${i}`, kind: 'q', label: h.label, host: h.label, pos: i + 1, depth });
    }
  });

  // Hermes rows of this profile plus the fleet-wide Pi/Claude/Codex sessions.
  const runningAll = inFlight(p, DATA.pi_live, DATA.agent_live)
    .sort((a, b) => (+a.S.idle_s || 0) - (+b.S.idle_s || 0)) // most recently active leads
    .map(({ kind, S: L }) => {
      const hermes = kind === 'hermes', sid = hermes ? L.id : L.session_id;
      return {
        key: hermes ? `s:${sid}` : `${kind}:${sid}`, kind: 'r', eng: kind, sid, label: titleOf(L.title, L.model),
        model: short(L.model) || '', profile: L.profile || '', hue: hashHue(L.model || ''),
        phase: L.phase || '', state: /compress/i.test(L.phase || '') ? 'compressing' : /wait|approv|blocked|input/i.test(L.phase || '') ? 'waiting' : 'running',
        category: L.category || '', idle_s: L.idle_s, up: L.uptime_s, cost: +L.cost_usd || 0, covered: L.cost_class === 'subscription',
        tools: (L.tools || []).length, nmodels: L.nmodels,
      };
    });

  const doneAll = (p.recent_sessions || [])
    .slice()
    .sort((a, b) => (+b.last_ts || 0) - (+a.last_ts || 0))
    .map(s => ({
      key: `s:${s.id}`, kind: 'd', sid: s.id, label: titleOf(s.title, s.last_model || s.model),
      model: short(s.last_model || s.model) || '', profile: current, dur_s: s.dur_s, last_ts: s.last_ts,
      tokens: s.tokens, api_calls: s.api_calls, cost: +s.cost_usd || 0, hue: hashHue(s.last_model || s.model || ''),
    }));

  qtDemoWire(queuedAll, runningAll, doneAll);
  paintTrain(...qtDemoApply(queuedAll, runningAll, doneAll));

  const sub = $('qsub');
  if (sub){
    const busy = hosts.filter(h => (+h.queue || 0) > 0).map(h => h.label);
    sub.textContent = busy.length
      ? `backed up on ${busy.join(', ')}`
      : (hosts.length ? `fleet clear · ${hosts.length} host${hosts.length===1?'':'s'}` : '');
  }
}

// Preview-only: `?demoQueue=1` cycles one synthetic task Depot -> Line -> Yard every 3s so the
// jar motion can be watched without live traffic. Inert (returns the lists untouched) otherwise.
const QT_DEMO = { on: null, step: 0, timer: 0, last: null };
export function qtDemoOn(){
  if (QT_DEMO.on === null) QT_DEMO.on = /[?&]demoQueue=1(?:&|$)/.test((typeof window !== 'undefined' && window.location && window.location.search) || '');
  return QT_DEMO.on;
}
export function qtDemoApply(q, r, d){
  if (!qtDemoOn()) return [q, r, d];
  const n = Math.floor(QT_DEMO.step / 3), ph = QT_DEMO.step % 3, id = 'demo' + n;
  const base = { label: 'Demo task ' + (n + 1) + ': a long synthetic title that wraps over a few lines in the tile', model: 'demo', profile: 'demo', hue: 28 + (n * 47) % 300, sid: id };
  const past = [];
  for (let i = Math.max(0, n - 3); i < n; i++) past.push({ ...base, key: 's:demo' + i, kind: 'd', label: 'Demo task ' + (i + 1), sid: 'demo' + i, hue: 28 + (i * 47) % 300, last_ts: Date.now() / 1000 - 60 });
  const mine = ph === 0 ? [{ key: 'q:demo:' + n, kind: 'q', label: 'demo', host: 'demo-host', pos: 1, depth: 1 }]
    : ph === 1 ? [{ ...base, key: 's:' + id, kind: 'r', eng: 'hermes', state: 'running', idle_s: 2 }]
    : [{ ...base, key: 's:' + id, kind: 'd', last_ts: Date.now() / 1000 }];
  return [q.concat(ph === 0 ? mine : []), r.concat(ph === 1 ? mine : []), (ph === 2 ? mine : []).concat(past, d)];
}
function qtDemoWire(q, r, d){
  if (!qtDemoOn()) return;
  QT_DEMO.last = [q, r, d];
  if (QT_DEMO.timer) return;
  QT_DEMO.timer = setInterval(() => { QT_DEMO.step++; paintTrain(...qtDemoApply(...QT_DEMO.last)); }, 3000);
}

export function trainBall(it){
  const c = document.createElement('button');
  c.className = 'qt-ball qt-' + it.kind;
  c.setAttribute('type', 'button');
  c.dataset.key = it.key;
  c.tabIndex = 0;
  const g = document.createElement('span'); g.className = 'qt-ball-g'; c.appendChild(g);
  return c;
}

// Deterministic 0..1 from a string: the same task id always lands on the same spot,
// so a 5s poll never re-shuffles the pile.
export function qtSeed(key){
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const QT_CAP = 60;                     // balls drawn per jar; the 60th slot becomes a "+N" chip
// Ball px: start at QT_MAX and step down to QT_MIN until the pile fits in QT_FILL of the jar.
export const QT_MAX = 20;
export const QT_MIN = 12;
export const QT_FILL = 0.5;

// Pour the balls in, oldest first: each one drops from a seeded column (best of six, so it
// rolls into a valley) and rests on whatever is below. Only earlier balls matter, so
// appending a task never moves the existing pile. Centres, in px, inside a w x h box.
export function qtPack(keys, w, h, size){
  const r = size / 2, d = size * 0.94, pad = 7, balls = [];
  let top = h;
  keys.forEach(k => {
    let best = null;
    for (let t = 0; t < 6; t++){
      const x = r + pad + qtSeed(k + ':' + t) * Math.max(0, w - size - 2 * pad);
      let y = h - r - pad;
      for (const b of balls){ const dx = Math.abs(b.x - x); if (dx < d) y = Math.min(y, b.y - Math.sqrt(d * d - dx * dx)); }
      if (!best || y > best.y) best = { x, y };
    }
    balls.push({ x: best.x, y: best.y, rz: (qtSeed(k + ':r') - 0.5) * 44 });
    top = Math.min(top, best.y - r);
  });
  return { balls, top };
}

// Size the whole jar (steps down from 20px to 12px as it fills), pack it and write the
// positions. A ball that already sat somewhere and now moves glides there (.qt-repack).
export function qtLayout(box, els){
  const w = box.clientWidth || 200, h = box.clientHeight || 240;
  const keys = els.map(c => c.dataset.key);
  let size = QT_MAX, pk = qtPack(keys, w, h, size);
  while (size > QT_MIN && pk.top < h * (1 - QT_FILL)){ size--; pk = qtPack(keys, w, h, size); }
  const pos = pk.balls.map(b => [b.x.toFixed(1) + 'px', b.y.toFixed(1) + 'px']);
  const moved = els.some((c, i) => c._qtL !== undefined && (c._qtL !== pos[i][0] || c._qtT !== pos[i][1] || c._qtS !== size));
  if (moved){
    box.classList.add('qt-repack');
    clearTimeout(box._qtRp);
    box._qtRp = setTimeout(() => box.classList.remove('qt-repack'), 360);
  }
  els.forEach((c, i) => {
    const fresh = c._qtL === undefined;
    c._qtL = pos[i][0]; c._qtT = pos[i][1]; c._qtS = size;
    c.style.left = pos[i][0]; c.style.top = pos[i][1];
    c.style.setProperty('--sz', size + 'px');
    c.style.setProperty('--rz', pk.balls[i].rz.toFixed(1) + 'deg');
    if (fresh) c.style.setProperty('--drop', Math.round(Math.min(pk.balls[i].y, 150)) + 'px');
    c.classList.toggle('qt-sm', size <= QT_MIN + 2);
  });
}
export function qtRelayout(box){ if (box && box._qtEls && box._qtEls.length) qtLayout(box, box._qtEls); }

// Keyed reconcile of one jar. Returns the balls created this pass so the caller can fly
// them in from where the task was a moment ago. `elsewhere` = keys now in any jar: a ball
// whose task moved is removed at once (the flying ghost replaces it) instead of fading.
export function paintBalls(box, items, decorate, elsewhere){
  const have = new Map();
  [...box.children].forEach(c => {
    if (c.dataset && c.dataset.key && !c.classList.contains('qt-leaving')) have.set(c.dataset.key, c);
  });
  // Pile order = first-seen order (a poll brings the newest first, so number them backwards).
  const seq = box._qtSeq || (box._qtSeq = new Map()), live = new Set(items.map(it => it.key));
  [...seq.keys()].forEach(k => { if (!live.has(k)) seq.delete(k); });
  for (let i = items.length - 1; i >= 0; i--){
    if (!seq.has(items[i].key)) seq.set(items[i].key, box._qtN = (box._qtN || 0) + 1);
  }
  const byNew = items.slice().sort((a, b) => seq.get(b.key) - seq.get(a.key));
  const vis = byNew.slice(0, byNew.length > QT_CAP ? QT_CAP - 1 : byNew.length).reverse();
  const hidden = items.length - vis.length;
  const where = { q: 'waiting', r: 'running', d: 'finished' };
  const keep = new Set(), fresh = [], els = [];
  vis.forEach(it => {
    let c = have.get(it.key);
    if (!c){ c = trainBall(it); fresh.push(c); }
    keep.add(c); els.push(c);
    const eng = it.eng && it.eng !== 'hermes' ? ` · ${kindMeta(it.eng).label} agent` : '';
    const when = carMeta(it);
    c.setAttribute('aria-label', `${where[it.kind] || ''}: ${it.label}${it.model ? ' · ' + it.model : ''}${eng}${when ? ' · ' + when : ''}`);
    c._qt = it;
    c.classList.toggle('qt-run', it.kind === 'r');
    c.classList.toggle('qt-warn', it.state === 'waiting');
    decorate(c, it);
  });
  qtLayout(box, els);
  fresh.slice().reverse().forEach(c => box.appendChild(c));   // DOM order = list order (newest first)
  box._qtEls = els;
  have.forEach((c, k) => {
    if (keep.has(c)) return;
    if (elsewhere && elsewhere.has(k)){ c.remove(); return; }
    c.classList.add('qt-leaving');
    setTimeout(() => c.remove(), 400);
  });
  let chip = box._qtChip;
  if (hidden > 0){
    if (!chip){
      chip = document.createElement('button'); chip.className = 'qt-overflow'; chip.setAttribute('type', 'button');
      box._qtChip = chip; box.appendChild(chip);
    }
    chip.textContent = '+' + hidden;
    chip.setAttribute('aria-label', `${hidden} more tasks in this jar; open the session finder`);
  } else if (chip){ chip.remove(); box._qtChip = null; }
  return fresh;
}

// Second line of a ball's label: who ran it, how long ago, and a short id so two balls
// with the same title can still be told apart.
export function carMeta(it){
  const id = it.sid ? '#' + String(it.sid).slice(-6) : '';
  const at = it.kind === 'd' ? (it.last_ts ? ago(Math.max(0, Date.now() / 1000 - it.last_ts)) + ' ago' : '')
    : it.idle_s != null ? ago(+it.idle_s) + ' ago' : '';
  if (it.kind === 'q') return `${it.host} · ${it.pos} of ${it.depth}`;
  return [at, it.profile, id].filter(Boolean).join(' · ');
}

export const ttRow = (k, v) => (v === '' || v == null || v === 0) ? ''
  : `<div class="ft-r"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`;
// Hover/focus card for one ball. Only fields the feeds really carry.
export function carTip(it){
  if (!it) return '';
  const row = ttRow;
  const tk = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
  if (it.kind === 'q'){
    return `<div class="ft-h">Waiting on ${esc(it.host)}</div>`
      + row('position', `${it.pos} of ${it.depth}`) + row('state', 'queued at the Ollama host');
  }
  const head = `<div class="ft-h">${esc(it.label)}</div>`;
  if (it.kind === 'r'){
    return head + row('state', ({ compressing: 'compressing', waiting: 'waiting on a tool or approval' })[it.state] || 'running')
      + row('engine', kindMeta(it.eng).label) + row('model', it.model) + row('profile', it.profile)
      + row('doing', it.phase || it.category)
      + row('last activity', it.idle_s != null ? ago(+it.idle_s) + ' ago' : '')
      + row('tools used', it.tools) + row('models seen', it.nmodels > 1 ? it.nmodels : '');
  }
  return head + row('profile', it.profile) + row('engine', 'Hermes') + row('model', it.model)
    + row('ran for', it.dur_s != null ? ago(Math.max(0, +it.dur_s)) : '')
    + row('finished', it.last_ts ? ago(Math.max(0, Date.now() / 1000 - it.last_ts)) + ' ago' : '')
    + row('tokens', it.tokens ? tk(+it.tokens) : '') + row('API calls', it.api_calls);
}

// The click popover: the hover card plus what is too long for a tooltip (cost, session id)
// and the way into the session.
export function carPop(it){
  if (!it) return '';
  const usd = it.cost ? '$' + (+it.cost).toFixed(+it.cost < 1 ? 4 : 2) + (it.covered ? ' (covered by subscription)' : '') : '';
  const up = it.up != null && it.kind === 'r' ? ago(Math.max(0, +it.up)) : '';
  const open = it.kind !== 'q' && it.sid
    ? `<div class="pp-act"><button type="button" class="pp-open" data-sid="${escA(it.sid)}" data-profile="${escA(it.profile || current)}" data-title="${escA(it.label)}">Open session</button></div>` : '';
  return carTip(it) + ttRow('running for', up) + ttRow('cost', usd) + ttRow('session', it.sid ? '#' + String(it.sid).slice(-8) : '') + open;
}

// Splash fires when a ball LANDS in the yard, not when the poll arrives.
export function qtSplash(jar){
  if (!jar) return;
  jar.classList.remove('qt-splash'); void jar.offsetWidth; jar.classList.add('qt-splash');
  setTimeout(() => jar.classList.remove('qt-splash'), 1700);
}

// Fly a ghost ball from where a task WAS (fromRect) to its new ball along a shallow arc, then
// reveal the real ball with a landing bounce. Duration scales with distance (600-900ms),
// flights in one poll start 70ms apart and at most four fly at once (the rest just appear).
// No-op without the Web Animations API, without layout (rects of 0), or under reduced motion.
export const QT_FLY = { live: 0, batch: 0 };
export function qtFly(tr, fromRect, toEl, cls){
  if (!tr || !toEl || !fromRect || typeof toEl.animate !== 'function') return false;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (QT_FLY.live >= 4) return false;
  const base = tr.getBoundingClientRect(), to = toEl.getBoundingClientRect();
  if (!to.width || !fromRect.width) return false;
  const g = document.createElement('span');
  g.className = 'qt-ball qt-ghost ' + cls + (toEl.classList.contains('qt-run') ? ' qt-run' : '');
  g.style.cssText = `left:${fromRect.left - base.left}px;top:${fromRect.top - base.top}px;`
    + `width:${to.width}px;height:${to.height}px`;
  ['--k', '--rz'].forEach(v => { const x = toEl.style.getPropertyValue(v); if (x) g.style.setProperty(v, x); });
  tr.appendChild(g);
  toEl.style.visibility = 'hidden';
  const dx = to.left - fromRect.left, dy = to.top - fromRect.top, dist = Math.hypot(dx, dy);
  const lift = Math.min(44, Math.max(18, dist * 0.1));
  const anim = g.animate([
    { transform: 'translate(0,0) rotate(0deg)', easing: 'cubic-bezier(.32,0,.67,0)' },
    { transform: `translate(${dx / 2}px,${dy / 2 - lift}px) rotate(110deg)`, offset: 0.45, easing: 'cubic-bezier(.33,1,.68,1)' },
    { transform: `translate(${dx}px,${dy}px) rotate(220deg)` },
  ], { duration: Math.min(900, Math.max(600, 480 + dist * 0.55)), delay: QT_FLY.batch++ * 70, fill: 'backwards' });
  QT_FLY.live++;
  let fin = false;
  const land = () => {
    if (fin) return; fin = true;
    QT_FLY.live--;
    g.remove(); toEl.style.visibility = '';
    toEl.classList.add('qt-land');
    setTimeout(() => toEl.classList.remove('qt-land'), 300);
    if (/yard/.test(cls)) qtSplash(toEl.closest && toEl.closest('.qt-jar'));
  };
  anim.onfinish = land; anim.oncancel = land;
  return true;
}

export function paintTrain(queued, running, done){
  const tr = $('qtrain'), qb = $('qt-queued'), rb = $('qt-running'), db = $('qt-done');
  if (!tr || !qb || !rb || !db) return;
  const nq = queued.length, nr = running.length, nd = done.length;
  const prevDone = +($('qt-n-done') || {}).textContent || 0, painted = !!tr.dataset.tip;

  // Where every ball is right now, so a task that changes jar flies across.
  const before = new Map();
  tr.querySelectorAll('.qt-ball[data-key]').forEach(c => {
    if (c.classList.contains('qt-leaving') || c.classList.contains('qt-ghost')) return;
    before.set(c.dataset.key, { rect: c.getBoundingClientRect(),
      sec: c.classList.contains('qt-q') ? 'q' : c.classList.contains('qt-r') ? 'r' : 'd' });
  });
  const keepQ = new Set(queued.map(q => q.key));
  const departing = [...qb.querySelectorAll('.qt-ball[data-key]')]
    .filter(c => !keepQ.has(c.dataset.key) && !c.classList.contains('qt-leaving'))
    .map(c => c.getBoundingClientRect());

  [[qb, nq], [rb, nr], [db, nd]].forEach(([box, n]) => {
    const jar = box.closest && box.closest('.qt-jar');
    if (jar) jar.style.setProperty('--wv', n ? 1 : 0);
    if (jar) jar.style.setProperty('--fill', n ? Math.min(92, 12 + 80 * Math.log10(1 + n) / Math.log10(61)).toFixed(1) + '%' : '0%');
  });

  tr.classList.toggle('moving', nr > 0);
  tr.classList.toggle('backed', nq > 0);
  tr.classList.toggle('clear', nq === 0 && nr === 0);

  QT_FLY.batch = 0;
  const elsewhere = new Set([...queued, ...running, ...done].map(i => i.key));
  const freshQ = paintBalls(qb, queued, (c) => { c.style.setProperty('--k', 'var(--qk-wait)'); }, elsewhere);
  const freshR = paintBalls(rb, running, (c, it) => {
    c.dataset.kind = it.eng;
    c.dataset.state = it.state;
    c.style.setProperty('--k', kindMeta(it.eng).color);
  }, elsewhere);
  const freshD = paintBalls(db, done, (c) => {
    c.style.setProperty('--k', kindMeta('hermes').color);
  }, elsewhere);

  // line -> yard is an exact identity (same session id in both feeds).
  let flewYard = false;
  const flown = new Set();
  freshD.forEach(c => {
    const b = before.get(c.dataset.key);
    if (b && b.sec === 'r' && qtFly(tr, b.rect, c, 'qt-fly-yard')){ flewYard = true; flown.add(c); }
  });
  // depot -> line: a queue slot has no id, so a departing depot ball is paired
  // with a newly running one by COUNT. Never claimed as an exact match.
  freshR.forEach(c => {
    if (before.has(c.dataset.key)) return;
    const from = departing.shift();
    if (from && qtFly(tr, from, c, 'qt-fly-line')) flown.add(c);
  });
  // Everything else that is new drops in from the top of its jar, with a small bounce.
  if (painted) [...freshQ, ...freshR, ...freshD].forEach(c => { if (!flown.has(c)) c.classList.add('qt-arrive'); });

  if (painted && nd > prevDone && !flewYard) qtSplash(db.closest && db.closest('.qt-jar'));

  [['qt-n-queued', nq], ['qt-n-running', nr], ['qt-n-done', nd]].forEach(([id, n]) => {
    const el = $(id);
    if (el && el.textContent !== String(n)){
      el.textContent = String(n);
      el.classList.remove('qt-bump'); void el.offsetWidth; el.classList.add('qt-bump');
    }
  });

  if (!tr.dataset.tip){
    tr.dataset.tip = '1'; qtTipWire(tr);
    if (typeof ResizeObserver !== 'undefined'){
      const ro = new ResizeObserver(es => es.forEach(e => qtRelayout(e.target)));
      [qb, rb, db].forEach(b => ro.observe(b));
    }
  }
}

// Place a fixed card (tooltip or popover) beside a ball: below the jar, else above it, else
// beside the ball; the first spot that stays inside the viewport without covering the lid.
export function qtPlace(el, r, jar){
  const vw = window.innerWidth || 1024, vh = window.innerHeight || 768;
  const w = el.offsetWidth || 240, hgt = el.offsetHeight || 80, g = 8;
  const lid = jar && jar.querySelector('.qt-lid');
  const lr = lid ? lid.getBoundingClientRect() : null;
  const cx = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, vw - w - 6));
  const cy = Math.max(6, Math.min(r.top + r.height / 2 - hgt / 2, vh - hgt - 6));
  const jr = jar ? jar.getBoundingClientRect() : r;
  const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const spots = [[cx, jr.bottom + g], [cx, jr.top - hgt - g], [cx, r.bottom + g], [cx, r.top - hgt - g], [r.right + g, cy], [r.left - w - g, cy]];
  const fits = ([x, y]) => x >= 6 && y >= 6 && x + w <= vw - 6 && y + hgt <= vh - 6
    && !(lr && hits({ left: x, top: y, right: x + w, bottom: y + hgt }, lr));
  const at = Math.max(0, spots.findIndex(fits)), [x, y] = spots.find(fits) || [cx, Math.max(6, Math.min(r.bottom + g, vh - hgt - 6))];
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.dataset.side = ['bottom', 'top', 'bottom', 'top', 'right', 'left'][at];
  el.style.setProperty('--ax', Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x)) + 'px');
  el.style.setProperty('--ay', Math.max(14, Math.min(hgt - 14, r.top + r.height / 2 - y)) + 'px');
}

export function qtPopClose(restore){
  const pop = $('qpop');
  if (!pop || !pop._ball) return;
  const b = pop._ball;
  pop._ball = null;
  pop.classList.remove('on');
  b.classList.remove('qt-tip-on');
  if (restore && b.focus) b.focus();
}
export function qtPopOpen(ball){
  const pop = $('qpop'), it = ball && ball._qt;
  if (!pop || !it) return false;
  qtPopClose(false);
  const tip = $('qtip'); if (tip) tip.classList.remove('on');
  pop._ball = ball;
  ball.classList.add('qt-tip-on');
  pop.innerHTML = carPop(it);
  pop.classList.add('on');
  qtPlace(pop, ball.getBoundingClientRect(), ball.closest('.qt-jar'));
  const go = pop.querySelector('.pp-open');
  if (go && go.focus) go.focus(); else if (pop.focus) pop.focus();
  return true;
}

// One shared tooltip for every ball (event delegation, wired once), plus the click popover.
export function qtTipWire(tr){
  const tip = $('qtip');
  if (!tip) return;
  let cur = null;
  const hide = () => { tip.classList.remove('on'); if (cur && !($('qpop') || {})._ball) cur.classList.remove('qt-tip-on'); cur = null; };
  const show = c => {
    if (!c || !c._qt) return;
    const pop = $('qpop');
    if (pop && pop._ball) return;
    if (cur && cur !== c) cur.classList.remove('qt-tip-on');
    cur = c; c.classList.add('qt-tip-on');
    tip.innerHTML = carTip(c._qt);
    tip.classList.add('on');
    qtPlace(tip, c.getBoundingClientRect(), c.closest('.qt-jar'));
  };
  const carOf = t => (t && t.closest) ? t.closest('.qt-ball') : null;
  tr.addEventListener('mouseover', e => { const c = carOf(e.target); if (c) show(c); });
  tr.addEventListener('mouseout', e => { const c = carOf(e.target); if (c && !c.contains(e.relatedTarget)) hide(); });
  tr.addEventListener('focusin', e => show(carOf(e.target)));
  tr.addEventListener('focusout', hide);
  tr.addEventListener('mouseleave', hide);
  tr.addEventListener('click', e => {
    if (e.target.closest && e.target.closest('.qt-overflow')){ qtPopClose(false); hide(); sfOpenPalette(); return; }
    const c = carOf(e.target);
    if (!c) return;
    const pop = $('qpop');
    if (pop && pop._ball === c) qtPopClose(true); else qtPopOpen(c);
  });
  const pop = $('qpop');
  if (pop){
    pop.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.pp-open');
      if (!b) return;
      const d = b.dataset;
      qtPopClose(false);
      lnOpenModal(d.sid, d.profile, d.title);
    });
    document.addEventListener('click', e => {
      if (!pop._ball || pop.contains(e.target) || carOf(e.target)) return;
      qtPopClose(false);
    });
  }
  window.addEventListener('scroll', () => { hide(); qtPopClose(false); }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hide();
    qtPopClose(true);
  });
}

// P10-08 (#96): agents alive. Renders the collector's own already-computed
// classification (alive/stale/dead + kill_hint); never guesses liveness
// client-side.
export function renderAgents(agents){
  const card = $('agentscard');
  if (!card) return;
  agents = agents || [];
  if (!agents.length) { card.hidden = true; return; }
  card.hidden = false;
  const stateColor = { alive: '#5f9e6e', stale: '#c4a06e', dead: '#c66a6a' };
  $('agentslist').innerHTML = agents.map(a => `
    <div class="flex items-center gap-2 text-[length:var(--fs-sm)] py-1.5" style="border-bottom:1px solid var(--border)">
      <span class="qdotwrap" style="background:${stateColor[a.state] || '#64748b'};width:7px;height:7px;border-radius:999px;flex:none"></span>
      <span class="font-semibold" style="min-width:5.5rem">${esc(a.state)}</span>
      <span class="muted flex-1 truncate" title="${escA(a.backend)}">${esc(a.host)} · pid ${a.pid} · ${esc(a.profile)}</span>
      <span class="muted">${ago(a.age_s)} ago</span>
      <span class="muted" title="mid-turn session leases held by this backend">${a.leases} lease${a.leases===1?'':'s'}</span>
      ${a.kill_hint ? `<code class="muted text-[length:var(--fs-xs)]" title="confirmed-dead on this host">${esc(a.kill_hint)}</code>` : ''}
    </div>`).join('');
}

export let FLOWROWS = null;     // last rows rendered, so a resize can re-render without refetching
export let flowDepth = 3;       // 2 = provider>model, 3 = provider>model>task

export function flowData(rows){
  // Aggregate rows into a tree. Calls are the size metric; cost rides along for
  // the tooltip because "who is expensive" is the other question this answers.
  const root = {id:'root', name:'all traffic', kind:'root', calls:0, cost:0, kids:[]};
  const pmap = new Map();
  rows.forEach(r => {
    const pk = provOf(r.provider, r.model, r.base_url);
    const mk = short(r.model);
    const cost = r.market_value_usd || 0;
    root.calls += r.calls; root.cost += cost;

    let P = pmap.get(pk);
    if (!P){ P = {id:'p:'+pk, name:pk, kind:'prov', calls:0, cost:0, kids:[], _m:new Map()};
             pmap.set(pk, P); root.kids.push(P); }
    P.calls += r.calls; P.cost += cost;

    let M = P._m.get(mk);
    if (!M){ M = {id:'p:'+pk+'|m:'+mk, name:mk, kind:'model', calls:0, cost:0, kids:[], _t:new Map()};
             P._m.set(mk, M); P.kids.push(M); }
    M.calls += r.calls; M.cost += cost;

    if (flowDepth >= 3){
      const tk = r.task || 'main';
      let T = M._t.get(tk);
      if (!T){ T = {id:M.id+'|t:'+tk, name:tk, kind:'task', calls:0, cost:0, kids:[]};
               M._t.set(tk, T); M.kids.push(T); }
      T.calls += r.calls; T.cost += cost;
    }
  });
  // Biggest first: stable ordering keeps the layout from reshuffling on refresh.
  const sort = n => { n.kids.sort((a,b)=>b.calls-a.calls); n.kids.forEach(sort); };
  sort(root);
  return root;
}

export function flowFlatten(root){
  const nodes = [], links = [];
  (function walk(n, depth, parent){
    n.depth = depth; nodes.push(n);
    if (parent) links.push({s:parent, t:n});
    (n.kids||[]).forEach(k => walk(k, depth+1, n));
  })(root, 0, null);
  return {nodes, links};
}

// Which chats a Flow node served: node_sessions is keyed by FULL model id + task but nodes
// carry the SHORT name, so each model node remembers its full ids and we union them.
// ---- Tool palette: ONE colour per tool everywhere, grouped into families by what they do.
export function flowSessions(n){
  const ns = (DATA.profiles[current]||{}).node_sessions || {};
  const keys = [];
  if (n.kind === 'task'){
    (n.fullModels||[]).forEach(fm => keys.push(fm + '\t' + n.name));
  } else if (n.kind === 'model'){
    (n.fullModels||[]).forEach(fm => (n.kids||[]).forEach(t => keys.push(fm + '\t' + t.name)));
  } else return [];
  const by = {};
  keys.forEach(k => (ns[k]||[]).forEach(s => {
    const e = (by[s.id] ||= {title:s.title, calls:0, id:s.id});
    e.calls += s.calls;
  }));
  return Object.values(by).sort((a,b)=>b.calls-a.calls).slice(0,4);
}

export function flowColor(n){
  if (n.kind === 'root')  return css('--accent');
  if (n.kind === 'prov')  return (PROV[n.name]||{}).fg || css('--accent');
  if (n.kind === 'model') return colorOf(n.name);
  // Tasks inherit their model's hue so a branch reads as one family.
  return colorOf(n.parentModel || n.name);
}

export function renderFlow(rows){
  const svg = $('flow'), wrap = $('flowwrap'), sub = $('flowsub');
  if (!svg || !wrap) return;

  if (!rows || !rows.length){
    svg.innerHTML = '';
    if (sub) sub.textContent = 'no data in this range';
    return;
  }

  const root = flowData(rows);
  // Tag tasks with their model name before flattening, for colour inheritance.
  root.kids.forEach(P => (P.kids||[]).forEach(M =>
    (M.kids||[]).forEach(T => T.parentModel = M.name)));

  const {nodes, links} = flowFlatten(root);
  // The wrapper measures 0 while the tab is still hidden (display:none), which
  // would collapse the whole layout into a dot. Fall back to the card's width
  // and a sane height, then re-render once the tab is actually visible.
  const W = wrap.clientWidth || svg.parentElement?.clientWidth || 1100;
  const H = wrap.clientHeight || 560;
  const cx = W/2, cy = H/2;

  // Radius encodes calls (sqrt so area is proportional, not radius).
  const maxCalls = Math.max(...nodes.map(n=>n.calls), 1);
  const R = n => n.kind==='root' ? 26
    : Math.max(4, Math.sqrt(n.calls/maxCalls) * (n.kind==='prov'?30:n.kind==='model'?22:14));

  // Seed positions on concentric rings by depth, spread by index. Starting from
  // a sane layout means the simulation only has to relax, not untangle.
  const byDepth = {};
  nodes.forEach(n => (byDepth[n.depth] ||= []).push(n));
  // Ring radii scale with the canvas: fixed pixel rings left ~80% of a
  // 1495x707 card empty, because the springs pulled everything to the middle.
  const SPAN = Math.min(W, H) / 2 - 40;
  const RING = {0:0, 1:SPAN*0.34, 2:SPAN*0.66, 3:SPAN*0.95};
  Object.entries(byDepth).forEach(([d, list]) => {
    list.forEach((n, i) => {
      const a = (i/list.length) * Math.PI*2 + (+d)*0.6;
      n.x = cx + Math.cos(a)*RING[d]; n.y = cy + Math.sin(a)*RING[d];
      n.vx = n.vy = 0;
    });
  });
  root.x = cx; root.y = cy;

  // --- force simulation (velocity Verlet, fixed step count) ---
  const LINK_LEN = d => d===1 ? SPAN*0.34 : d===2 ? SPAN*0.32 : SPAN*0.26;
  function step(){
    // repulsion — O(n^2) is fine at ~100 nodes
    for (let i=0;i<nodes.length;i++){
      const a = nodes[i];
      for (let j=i+1;j<nodes.length;j++){
        const b = nodes[j];
        let dx = b.x-a.x, dy = b.y-a.y;
        let d2 = dx*dx + dy*dy || 0.01;
        const minD = (R(a)+R(b)+14);
        // Stronger push when circles actually overlap: label collisions are
        // what make these graphs unreadable, not node distance in the abstract.
        // Repulsion scales with the canvas too — a constant that worked on a
        // 600px card is invisible on a 1500px one.
        const K = SPAN * SPAN * 0.035;
        const f = (d2 < minD*minD ? K*2.9 : K) / d2;
        const d = Math.sqrt(d2);
        const ux = dx/d, uy = dy/d;
        a.vx -= ux*f*0.01; a.vy -= uy*f*0.01;
        b.vx += ux*f*0.01; b.vy += uy*f*0.01;
      }
    }
    // springs along links
    links.forEach(l => {
      const a = l.s, b = l.t;
      const dx = b.x-a.x, dy = b.y-a.y;
      const d = Math.sqrt(dx*dx+dy*dy) || 0.01;
      const want = LINK_LEN(b.depth);
      const f = (d - want) * 0.035;
      const ux = dx/d, uy = dy/d;
      a.vx += ux*f; a.vy += uy*f;
      b.vx -= ux*f; b.vy -= uy*f;
    });
    // gentle pull to centre + damping
    nodes.forEach(n => {
      if (n.kind === 'root'){ n.x = cx; n.y = cy; n.vx = n.vy = 0; return; }
      n.vx += (cx - n.x) * 0.0016;
      n.vy += (cy - n.y) * 0.0016;
      n.vx *= 0.82; n.vy *= 0.82;
      n.x += n.vx; n.y += n.vy;
      // keep inside the viewport
      const r = R(n) + 4;
      n.x = Math.max(r, Math.min(W-r, n.x));
      n.y = Math.max(r, Math.min(H-r, n.y));
    });
  }
  for (let i=0;i<260;i++) step();

  // Fit the relaxed layout to the canvas. Tuning forces alone is fragile — the
  // equilibrium size depends on node count, so a 6-node day and a 90-node week
  // would fill the card differently. Scaling the final positions makes the
  // graph fill the space at ANY size, and caps zoom so a tiny graph does not
  // get blown up into absurdly distant nodes.
  (function fit(){
    const free = nodes.filter(n => n.kind !== 'root');
    if (!free.length) return;
    const pad = 46;
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    nodes.forEach(n => { const r=R(n);
      x0=Math.min(x0,n.x-r); x1=Math.max(x1,n.x+r);
      y0=Math.min(y0,n.y-r); y1=Math.max(y1,n.y+r); });
    const bw = x1-x0, bh = y1-y0;
    if (bw < 1 || bh < 1) return;
    // Independent x/y scales: the card is much wider than tall (1495x707), and
    // a radially symmetric layout scaled uniformly leaves the sides empty.
    // Allowing the x-stretch to exceed y (capped, so circles stay circles and
    // the tree does not look smeared) uses the real estate the card has.
    const kx0 = (W-pad*2)/bw, ky0 = (H-pad*2)/bh;
    const ky = Math.min(ky0, 2.6);
    const kx = Math.min(kx0, ky * 1.85, 3.4);
    const ox = (x0+x1)/2, oy = (y0+y1)/2;
    nodes.forEach(n => {
      n.x = cx + (n.x-ox)*kx;
      n.y = cy + (n.y-oy)*ky;
    });
  })();

  // --- draw ---
  const NS = 'http://www.w3.org/2000/svg';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = '';
  const gl = document.createElementNS(NS,'g'), gn = document.createElementNS(NS,'g');
  svg.appendChild(gl); svg.appendChild(gn);

  links.forEach(l => {
    const p = document.createElementNS(NS,'path');
    // Curved links read better than straight ones when many share an endpoint.
    const mx = (l.s.x+l.t.x)/2, my = (l.s.y+l.t.y)/2;
    const dx = l.t.x-l.s.x, dy = l.t.y-l.s.y;
    const nx = -dy*0.12, ny = dx*0.12;
    p.setAttribute('d', `M${l.s.x.toFixed(1)},${l.s.y.toFixed(1)} Q${(mx+nx).toFixed(1)},${(my+ny).toFixed(1)} ${l.t.x.toFixed(1)},${l.t.y.toFixed(1)}`);
    p.setAttribute('class','lnk');
    p.setAttribute('stroke-width', Math.max(0.6, Math.sqrt(l.t.calls/maxCalls)*5).toFixed(2));
    l.el = p; gl.appendChild(p);
  });

  nodes.forEach(n => {
    const g = document.createElementNS(NS,'g');
    g.setAttribute('class', 'nd ' + n.kind);
    g.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    const c = document.createElementNS(NS,'circle');
    const col = flowColor(n);
    c.setAttribute('r', R(n).toFixed(1));
    c.setAttribute('fill', col);
    c.setAttribute('fill-opacity', n.kind==='task' ? '.55' : '.9');
    c.setAttribute('stroke', col);
    c.setAttribute('stroke-width','1.5');
    g.appendChild(c);

    // #18: an invisible hit-area circle padded out to >=24px radius — the
    // visible circle for a small task node can be a few px, which is too
    // small to reliably hit with a finger even though a mouse cursor is
    // precise enough not to need it.
    const hit = document.createElementNS(NS,'circle');
    hit.setAttribute('r', Math.max(R(n), 12).toFixed(1));
    hit.setAttribute('fill', 'transparent');
    hit.setAttribute('class', 'hitarea');
    g.appendChild(hit);

    // Glow intensity = how much work this node did, as a share of the busiest
    // node. sqrt matches the radius scale, so glow and size tell the same
    // story; a linear ramp would leave everything but the top node dark.
    // Stored as a CSS var so the drag handler can brighten without recomputing.
    const heat = Math.sqrt(n.calls / maxCalls) || 0;
    n.heat = heat;
    g.style.setProperty('--heat', heat.toFixed(3));
    g.style.setProperty('--glow', col);
    n.circle = c;

    // Label every node big enough to carry one; tiny task nodes stay bare and
    // rely on the tooltip, otherwise the graph turns into a word cloud.
    if (n.kind !== 'task' || R(n) > 9){
      const t = document.createElementNS(NS,'text');
      t.setAttribute('y', (R(n) + 10).toFixed(1));
      t.textContent = n.name.length > 22 ? n.name.slice(0,21)+'…' : n.name;
      if (n.kind === 'model') t.setAttribute('fill', col);
      g.appendChild(t);
    }
    n.el = g; gn.appendChild(g);
  });

  // --- interaction: drag to reposition, hover focuses a subtree ---
  // Dragging is worth the complexity here: the force layout optimises for "no
  // overlaps", not "the comparison you care about" — let people pull a node
  // clear of its neighbours to read it.
  const tip = $('flowtip');

  // Viewport px -> SVG user units. The SVG is scaled by CSS (viewBox 0 0 W H
  // rendered into whatever the card is), so using clientX directly makes the
  // node drift away from the cursor on any non-1:1 card.
  function toSvg(ev){
    const b = svg.getBoundingClientRect();
    return { x: (ev.clientX - b.left) * (W / b.width),
             y: (ev.clientY - b.top)  * (H / b.height) };
  }

  let drag = null;
  function moveNode(n, x, y){
    const r = R(n) + 4;
    n.x = Math.max(r, Math.min(W - r, x));
    n.y = Math.max(r, Math.min(H - r, y));
    n.el.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
    // Redraw only the links touching this node — rebuilding all of them on
    // every pointermove is what makes naive drag implementations stutter.
    links.forEach(l => {
      if (l.s !== n && l.t !== n) return;
      const mx = (l.s.x + l.t.x) / 2, my = (l.s.y + l.t.y) / 2;
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y;
      const nx = -dy * 0.12, ny = dx * 0.12;
      l.el.setAttribute('d',
        `M${l.s.x.toFixed(1)},${l.s.y.toFixed(1)} Q${(mx+nx).toFixed(1)},${(my+ny).toFixed(1)} ${l.t.x.toFixed(1)},${l.t.y.toFixed(1)}`);
    });
  }

  nodes.forEach(n => {
    if (n.kind === 'root') return;          // root is pinned to the centre
    n.el.addEventListener('pointerdown', ev => {
      ev.preventDefault();
      const p = toSvg(ev);
      drag = { n, dx: n.x - p.x, dy: n.y - p.y, moved: false };
      // Capture on the SVG, not the node: a fast drag outruns the cursor and
      // would otherwise drop the node the moment the pointer leaves its circle.
      svg.setPointerCapture(ev.pointerId);
      svg.classList.add('drag');
      n.el.classList.add('dragging');
    });
  });

  svg.addEventListener('pointermove', ev => {
    if (!drag) return;
    const p = toSvg(ev);
    drag.moved = true;
    moveNode(drag.n, p.x + drag.dx, p.y + drag.dy);
  });

  function endDrag(ev){
    if (!drag) return;
    drag.n.el.classList.remove('dragging');
    // Mark as user-placed so it reads as deliberately positioned, and so a
    // future re-layout can respect the placement instead of snapping it back.
    if (drag.moved) drag.n.el.classList.add('pinned');
    svg.classList.remove('drag');
    try { svg.releasePointerCapture(ev.pointerId); } catch (e) {}
    drag = null;
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // #18: pan + pinch-zoom via viewBox, independent of node-drag (drag only
  // starts from a node's own pointerdown, so background pointerdowns are
  // always free for panning). Two active pointers = pinch; one = pan.
  const view = { x: 0, y: 0, w: W, h: H }; // current viewBox rect, in SVG units
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const active = new Map(); // pointerId -> last client {x,y}
  let panStart = null, pinchStart = null;

  function applyView(){
    svg.setAttribute('viewBox', `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);
    // Below ~60% of the fitted scale, the graph is more zoomed-out than its
    // initial fit — thin the labels so it doesn't turn into a tangle.
    svg.classList.toggle('zoomedout', view.w > W * 1.4);
  }
  function clampView(){
    // Zoom out capped at 3x the fitted size (nothing new to see past that),
    // zoom in capped so a pinch cannot shrink the viewBox to nothing.
    view.w = Math.max(W * 0.15, Math.min(W * 3, view.w));
    view.h = Math.max(H * 0.15, Math.min(H * 3, view.h));
  }
  function zoomAt(clientX, clientY, factor){
    const b = svg.getBoundingClientRect();
    // The point under the cursor/pinch-centre, in viewBox units, stays fixed.
    const px = view.x + (clientX - b.left) / b.width  * view.w;
    const py = view.y + (clientY - b.top)  / b.height * view.h;
    view.w /= factor; view.h /= factor;
    clampView();
    view.x = px - (clientX - b.left) / b.width  * view.w;
    view.y = py - (clientY - b.top)  / b.height * view.h;
    applyView();
  }
  function fitView(){
    view.x = 0; view.y = 0; view.w = W; view.h = H;
    applyView();
  }
  svg._flowFit = fitView; // exposed for the #flowctl "Fit" button
  // #111: keyboard-reachable zoom, centred on the SVG's own midpoint (no
  // cursor/finger position to anchor on from a button click).
  svg._flowZoom = factor => {
    const b = svg.getBoundingClientRect();
    zoomAt(b.left + b.width / 2, b.top + b.height / 2, factor);
  };

  svg.addEventListener('pointerdown', ev => {
    if (drag) return; // a node drag owns this pointer
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (active.size === 1){
      panStart = { view: { ...view }, p: { x: ev.clientX, y: ev.clientY } };
    } else if (active.size === 2){
      const pts = [...active.values()];
      pinchStart = {
        view: { ...view },
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      };
      panStart = null;
    }
  });
  svg.addEventListener('pointermove', ev => {
    if (drag || !active.has(ev.pointerId)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const b = svg.getBoundingClientRect();
    if (active.size === 2 && pinchStart){
      const pts = [...active.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const factor = d / (pinchStart.d || 1);
      view.w = pinchStart.view.w / factor;
      view.h = pinchStart.view.h / factor;
      clampView();
      const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
      // Two-finger pan happens naturally alongside the pinch: keep the
      // midpoint under the fingers, not just the zoom centred on itself.
      const px = pinchStart.view.x + (pinchStart.cx - b.left) / b.width  * pinchStart.view.w;
      const py = pinchStart.view.y + (pinchStart.cy - b.top)  / b.height * pinchStart.view.h;
      view.x = px - (cx - b.left) / b.width  * view.w;
      view.y = py - (cy - b.top)  / b.height * view.h;
      applyView();
    } else if (active.size === 1 && panStart){
      const dx = (ev.clientX - panStart.p.x) / b.width  * panStart.view.w;
      const dy = (ev.clientY - panStart.p.y) / b.height * panStart.view.h;
      view.x = panStart.view.x - dx;
      view.y = panStart.view.y - dy;
      applyView();
    }
  });
  function endPointer(ev){
    active.delete(ev.pointerId);
    if (active.size < 2) pinchStart = null;
    if (active.size === 1){
      const [p] = active.values();
      panStart = { view: { ...view }, p };
    } else if (active.size === 0) panStart = null;
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', endPointer);

  // Trackpad pinch and mouse-wheel zoom (desktop): ctrlKey is how browsers
  // report a trackpad pinch gesture via wheel events.
  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.0035);
    zoomAt(ev.clientX, ev.clientY, factor);
  }, { passive: false });

  // Double-tap/double-click resets to the fitted view.
  svg.addEventListener('dblclick', () => fitView());

  // #18: re-run the layout (debounced) when the wrapper resizes, only while Flow is on screen.
  if (!wrap._flowResizeWired && typeof ResizeObserver !== 'undefined'){
    wrap._flowResizeWired = true;
    let t = null;
    new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if ($('views')?.querySelector('[data-vtab="Flow"].tabon') && FLOWROWS)
          renderFlow(FLOWROWS);
      }, 200);
    }).observe(wrap);
  }
  FLOWROWS = rows;

  const kids = new Map();          // node -> descendant set (computed once)
  function descend(n, set){ (n.kids||[]).forEach(k => { set.add(k); descend(k, set); }); return set; }
  nodes.forEach(n => kids.set(n, descend(n, new Set())));

  function focus(n){
    if (!n){ svg.classList.remove('focus');
             nodes.forEach(x=>x.el.classList.remove('on'));
             links.forEach(l=>l.el.classList.remove('on'));
             tip.classList.remove('on'); return; }
    const set = kids.get(n); set.add(n);
    // Also light the path back to the root, so you see which provider owns it.
    let up = n; while (up){ set.add(up); up = up.parent; }
    svg.classList.add('focus');
    nodes.forEach(x => x.el.classList.toggle('on', set.has(x)));
    links.forEach(l => l.el.classList.toggle('on', set.has(l.s) && set.has(l.t)));
  }
  // parent pointers for the upward path
  links.forEach(l => l.t.parent = l.s);

  const pct = n => root.calls ? (n.calls/root.calls*100) : 0;
  nodes.forEach(n => {
    n.el.addEventListener('mouseenter', () => {
      focus(n);
      const rows = [
        ['calls', n.calls.toLocaleString() + ` (${pct(n).toFixed(1)}%)`],
        ['est. cost', '$' + n.cost.toFixed(2)],
      ];
      if (n.kids && n.kids.length) rows.push([n.kind==='prov'?'models':'tasks', n.kids.length]);
      // Which chats this node served. Model nodes aggregate across their task
      // children, task nodes are exact — so the same lookup serves both.
      const chats = flowSessions(n);
      const chatHtml = chats.length
        ? `<div class="ft-s">chats</div>` + chats.map(c =>
            `<div class="ft-c"><span>${esc(c.title)}</span><b>${c.calls.toLocaleString()}</b></div>`).join('')
        : '';
      tip.innerHTML = `<div class="ft-h" style="color:${flowColor(n)}">${esc(n.name)}</div>` +
        rows.map(([k,v])=>`<div class="ft-r"><span>${k}</span><b>${v}</b></div>`).join('') + chatHtml;
      const bx = wrap.getBoundingClientRect();
      const sx = bx.width / W, sy = bx.height / H;
      tip.style.left = Math.min(bx.width-230, n.x*sx + 14) + 'px';
      tip.style.top  = Math.max(0, n.y*sy - 10) + 'px';
      tip.classList.add('on');
    });
    n.el.addEventListener('mouseleave', () => focus(null));
  });

  const nProv = root.kids.length;
  const nModel = root.kids.reduce((s,p)=>s+p.kids.length,0);
  if (sub) sub.textContent =
    `${nProv} providers · ${nModel} models · ${nodes.length} nodes · ${root.calls.toLocaleString()} calls`;
}

export function flowControls(){
  const box = $('flowctl');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.innerHTML = [[2,'provider → model'],[3,'+ task']]
    .map(([d,l])=>`<button data-fd="${d}">${l}</button>`).join('') +
    // #18/#111: reset control for the pinch/pan/drag state — the graph's own
    // fitView() is stashed on the <svg> element by renderFlow each time it
    // rebuilds, so this button always calls whatever is current. +/- give
    // an accessible, keyboard-reachable equivalent to wheel/pinch zoom.
    `<button data-flowzoom="out" title="Zoom out">&minus;</button>` +
    `<button data-flowzoom="in" title="Zoom in">+</button>` +
    `<button data-flowfit title="Reset pan/zoom to fit">Fit</button>`;
  box.querySelectorAll('[data-fd]').forEach(b => {
    b.addEventListener('click', () => {
      flowDepth = +b.dataset.fd;
      box.querySelectorAll('[data-fd]').forEach(x =>
        x.classList.toggle('on', +x.dataset.fd === flowDepth));
      render();
    });
  });
  box.querySelectorAll('[data-fd]').forEach(x =>
    x.classList.toggle('on', +x.dataset.fd === flowDepth));
  box.querySelector('[data-flowfit]')?.addEventListener('click', () => {
    $('flow')?._flowFit?.();
  });
  box.querySelectorAll('[data-flowzoom]').forEach(b => {
    b.addEventListener('click', () => {
      $('flow')?._flowZoom?.(b.dataset.flowzoom === 'in' ? 1.4 : 1/1.4);
    });
  });
}

// Activity heatmap: GitHub-style calendar, intensity bucketed on quartiles of the observed range.
// P10-01 (#89): parent -> children session tree with roll-up costs, from the collector's nested payload.
