/**
 * arena.js: the agent hex arena — the dashboard's nod to anoma.ly/hex/.
 * A hexagonal ring drawn on canvas where the fleet's live agents orbit,
 * bounce off the hex walls and clash when they meet (spark burst + ring
 * pulse). Purely presentational: the weights, speeds and glow all come
 * from the same real live counts that fill the four KPI cards — no
 * synthetic session state is invented here.
 *
 *.every 5s the live poll re-calls renderArena() with fresh fleetKindCounts,
 * which re-weights agents; the rAF loop keeps running between polls.
 */

// Canvas palettes cannot read the CSS custom properties as strings, so each
// kind's colour is resolved from --kind-* (the ONE source of truth for kind
// identity) with a baked-in fallback for node/JSDOM harnesses.
const ARENA_FALLBACK = { hermes: 'hsl(199 60% 56%)', pi: 'hsl(265 55% 64%)', claude: 'hsl(18 70% 60%)', codex: 'hsl(152 50% 52%)' };
const ARENA_GLYPH = { hermes: 'H', pi: '\u03c0', claude: 'C', codex: 'X' };
const ARENA_KINDS = ['hermes', 'pi', 'claude', 'codex'];
// Each kind always fields one avatar so the ring never looks empty; an
// active kind (sessions in flight) fields a second, faster, brighter one.
const ARENA_PER_KIND = 2;
const ARENA_MAX_SPARKS = 90;
const ARENA_MAX_RINGS = 12;

// Pure planner so node tests can assert the counts->arena mapping without
// a canvas: per-kind brightness (alpha) and speed live here.
export function arenaPlan(counts){
  const c = counts || {};
  return ARENA_KINDS.map(kind => {
    const n = c[kind] || 0;
    return {
      kind,
      n: ARENA_PER_KIND,
      // Idle kinds drift at a third brightness; an active kind burns bright.
      alpha: n > 0 ? 1 : 0.35,
      // In-flight sessions make that kind visibly quicker around the ring.
      spd: n > 0 ? 1 + Math.min(n, 5) * 0.12 : 0.8,
      weight: n
    };
  });
}

function arenaKindColor(kind){
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--kind-' + kind).trim();
    if (v) return v;
  } catch (e) { /* JSDOM: computed style carries no vars */ }
  return ARENA_FALLBACK[kind] || '#999';
}

// One flat-top hexagon: vertices at angles 30deg + k*60deg. Containment is
// exact — |p dot n| <= apothem against the three edge normal axes.
const ARENA_AXES = [0, 60, 120].map(d => {
  const r = d * Math.PI / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
});

function arenaHexProject(px, py, apothem){
  // Deepest axis penetration; returns the normal to push back against.
  let best = null, worst = 0;
  for (const ax of ARENA_AXES){
    const d = (px * ax.x + py * ax.y) / apothem;
    if (Math.abs(d) > worst){ worst = Math.abs(d); best = { x: (d < 0 ? ax.x : -ax.x), y: (d < 0 ? ax.y : -ax.y), over: (Math.abs(d) - 1) * apothem }; }
  }
  return worst > 1 ? best : null;
}

function arenaHexPath(ctx, cx, cy, r, rot){
  ctx.beginPath();
  for (let i = 0; i < 6; i++){
    const a = rot + (30 + i * 60) * Math.PI / 180;
    const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const ARENA = { on: false, agents: [], sparks: [], rings: [], counts: null, last: 0, w: 0, h: 0, dpr: 1};

export function renderArena(counts){
  const cv = document.getElementById('arenacv');
  if (!cv) return;
  // A canvas 2d context may be missing (node, severe sandboxing); skip the
  // whole show rather than throwing during the 5s live poll.
  let ctx = null;
  try { ctx = cv.getContext && cv.getContext('2d'); } catch (e) { ctx = null; }
  ARENA.counts = counts || {};
  const sub = document.getElementById('arenasub');
  if (sub){
    const plan = arenaPlan(ARENA.counts);
    const active = plan.filter(p => p.weight > 0).map(p => ARENA_GLYPH[p.kind]).join(' ');
    sub.textContent = active ? ('in flight: ' + active) : 'fleet idle';
  }
  if (!ctx) return;
  if (!ARENA.on){
    ARENA.on = true;
    arenaSpawn(cv);
    const reduced = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
    if (reduced){
      const c = arenaFit(cv); if (c) arenaTickFrame(cv, c, 0);
    } else if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(arenaTick);
    } else {
      arenaTickFrame(cv, ctx, 0); // static fallback: draw once, no loop
    }
  }
  // Re-weighting only: live poll updates who is active; agents keep their
  // random orbits across repaints so a 5s poll never teleports them.
  arenaReweight(cv);
}

function arenaFit(cv){
  const w = cv.clientWidth, h = cv.clientHeight;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  if (w === ARENA.w && h === ARENA.h && dpr === ARENA.dpr){
    try { return cv.getContext('2d'); } catch (e) { return null; }
  }
  ARENA.w = w; ARENA.h = h; ARENA.dpr = dpr;
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  try { return cv.getContext('2d'); } catch (e) { return null; }
}

function arenaSpawn(_cv){
  const plan = arenaPlan(ARENA.counts);
  ARENA.agents = [];
  for (const p of plan){
    for (let i = 0; i < p.n; i++){
      const a = Math.random() * Math.PI * 2;
      const rr = 0.25 + Math.random() * 0.55;
      ARENA.agents.push({
        kind: p.kind, alpha: p.alpha, spd: p.spd, plan: p, flash: 0,
        x: Math.cos(a) * rr, y: Math.sin(a) * rr,
        dx: Math.cos(a + Math.PI / 2), dy: Math.sin(a + Math.PI / 2),
        v: 0.35 + Math.random() * 0.25, turn: 0.9 + Math.random() * 0.5
      });
    }
  }
}

function arenaReweight(_cv){
  const plan = arenaPlan(ARENA.counts);
  const byKind = {};
  plan.forEach(p => { byKind[p.kind] = p; });
  for (const ag of ARENA.agents){
    const p = byKind[ag.kind];
    if (!p) continue;
    ag.alpha = p.alpha; ag.spd = p.spd; ag.plan = p;
  }
}

function arenaTick(ts){
  const cv = document.getElementById('arenacv');
  if (!cv){ ARENA.on = false; return; } // view torn down: stop the loop
  window.requestAnimationFrame(arenaTick);
  if (document.hidden) return;
  const view = cv.closest('.view');
  if (view && view.hidden) return;
  const ctx = arenaFit(cv);
  if (!ctx) return;
  arenaTickFrame(cv, ctx, ts);
}

function arenaTickFrame(cv, ctx, ts){
  const W = ARENA.w || cv.clientWidth || 320, H = ARENA.h || cv.clientHeight || 200;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(H / 2, Math.min(W, H) / 2 * 1.6) * 0.88;
  const apothem = R * Math.sin(Math.PI / 3);
  const dt = ARENA.last && ts ? Math.min(0.05, (ts - ARENA.last) / 1000) : 0.016;
  ARENA.last = ts || 0;
  const scale = apothem; // sim runs in unit space, drawn as (x * scale)

  // --- simulate ------------------------------------------------------------
  const s = ARENA.agents;
  for (const ag of s){
    if (!ts) continue; // static fallback frame: no physics
    // Orbital steering: gentle pull toward tangential travel + wander.
    const nx = ag.x, ny = ag.y;
    const len = Math.hypot(nx, ny) || 1;
    const tanx = -ny / len, tany = nx / len;
    const wantSpd = ag.v * ag.spd * scale / 100;
    ag.dx += (tanx * wantSpd - ag.dx) * 0.02 + (Math.random() - 0.5) * 0.01 * ag.turn;
    ag.dy += (tany * wantSpd - ag.dy) * 0.02 + (Math.random() - 0.5) * 0.01 * ag.turn;
    ag.x += ag.dx * dt * scale / 100;
    ag.y += ag.dy * dt * scale / 100;
    ag.flash = Math.max(0, ag.flash - dt * 3);
    // Exact hex containment, in unit space: reflect on the deepest
    // violated edge so agents truly bounce off the hex walls.
    const hit = arenaHexProject(ag.x, ag.y, 1);
    if (hit){
      ag.x -= hit.x * (hit.over + 0.02);
      ag.y -= hit.y * (hit.over + 0.02);
      const d = ag.dx * hit.x + ag.dy * hit.y;
      if (d > 0){ ag.dx -= 2 * d * hit.x; ag.dy -= 2 * d * hit.y; }
    }
  }
  // Clashes: agents that meet throw sparks and bounce apart.
  if (ts) for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++){
    const a = s[i], b = s[j];
    const px = (a.x - b.x) * scale, py = (a.y - b.y) * scale;
    if (px * px + py * py > 400) continue; // ~20px clash radius, unit space
    if (a.flash > 0.5 || b.flash > 0.5) continue;
    a.flash = 1; b.flash = 1;
    const mx = cx + (a.x + b.x) / 2 * scale, my = cy + (a.y + b.y) / 2 * scale;
    arenaBurst(mx, my);
    const ux = (a.x - b.x) || 0.01, uy = (a.y - b.y) || 0.01;
    const ul = Math.hypot(ux, uy);
    a.dx += ux / ul * 0.35; a.dy += uy / ul * 0.35;
    b.dx -= ux / ul * 0.35; b.dy -= uy / ul * 0.35;
  }
  if (ts) arenaAdvance(dt, ARENA.w, ARENA.h);

  // --- draw ----------------------------------------------------------------
  ctx.setTransform(ARENA.dpr, 0, 0, ARENA.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  // Faint accent wash inside the ring
  const accent = arenaCssVar('--accent', '#7aa2f7');
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = accent;
  arenaHexPath(ctx, cx, cy, R * 0.98, ts ? ts / 24000 : 0);
  ctx.fill();
  ctx.restore();
  // The hex ring outline
  const border = arenaCssVar('--border', '#333');
  const fg = arenaCssVar('--fg', '#eee');
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = border;
  arenaHexPath(ctx, cx, cy, R, ts ? ts / 24000 : 0);
  ctx.stroke();
  // Rotating centre core
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  arenaHexPath(ctx, cx, cy, R * 0.24, ts ? -ts / 5000 : 0);
  ctx.stroke();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = accent;
  arenaHexPath(ctx, cx, cy, R * 0.24, ts ? -ts / 5000 : 0);
  ctx.fill();
  ctx.restore();
  // Live count in the middle of the core
  ctx.save();
  ctx.fillStyle = fg;
  ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String((ARENA.counts && ARENA.counts.all) || 0), cx, cy);
  ctx.restore();
  // Ring pulses from clashes
  for (const r of ARENA.rings){
    ctx.save();
    ctx.globalAlpha = Math.max(0, r.a) * 0.6;
    ctx.strokeStyle = r.c;
    ctx.lineWidth = 1.5;
    arenaHexPath(ctx, r.x, r.y, r.r, ts ? ts / 9000 : 0);
    ctx.stroke();
    ctx.restore();
  }
  // Agents
  for (const ag of s){
    const ax = cx + ag.x * scale, ay = cy + ag.y * scale;
    const col = arenaKindColor(ag.kind);
    const rad = 7;
    ctx.save();
    ctx.globalAlpha = ag.alpha;
    // glow
    ctx.beginPath();
    ctx.arc(ax, ay, rad * 2.2, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.globalAlpha = ag.alpha * (0.10 + 0.22 * ag.flash + 0.06 * (ag.plan && ag.plan.weight ? 1 : 0));
    ctx.fill();
    // body
    ctx.globalAlpha = ag.alpha;
    ctx.beginPath();
    ctx.arc(ax, ay, rad, 0, Math.PI * 2);
    ctx.fill();
    if (ag.flash > 0){
      ctx.globalAlpha = ag.alpha * ag.flash;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ax, ay, rad + 2 + 4 * (1 - ag.flash), 0, Math.PI * 2);
      ctx.stroke();
    }
    // glyph
    ctx.globalAlpha = Math.min(1, ag.alpha + 0.25);
    ctx.fillStyle = '#0b1220';
    ctx.font = '700 10px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ARENA_GLYPH[ag.kind] || '?', ax, ay + 0.5);
    ctx.restore();
  }
  // Sparks last, additive
  if (ARENA.sparks.length){
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const sp of ARENA.sparks){
      ctx.globalAlpha = Math.max(0, sp.a);
      ctx.strokeStyle = sp.c;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(sp.x - sp.dx * 4, sp.y - sp.dy * 4);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function arenaBurst(x, y){
  if (ARENA.sparks.length > ARENA_MAX_SPARKS) ARENA.sparks.splice(0, ARENA.sparks.length - ARENA_MAX_SPARKS);
  const kinds = ARENA.agents;
  const col = kinds.length ? arenaKindColor(kinds[Math.floor(Math.random() * kinds.length)].kind) : '#ffd27f';
  for (let i = 0; i < 10; i++){
    const a = Math.random() * Math.PI * 2, v = 0.6 + Math.random() * 0.9;
    ARENA.sparks.push({ x, y, dx: Math.cos(a) * v, dy: Math.sin(a) * v, c: col, a: 0.5 + Math.random() * 0.4 });
  }
  if (ARENA.rings.length > ARENA_MAX_RINGS) ARENA.rings.splice(0, ARENA.rings.length - ARENA_MAX_RINGS);
  ARENA.rings.push({ x, y, r: 6, a: 0.8, c: col });
}

function arenaAdvance(dt, W, _H){
  for (const sp of ARENA.sparks){ sp.x += sp.dx * dt * 60; sp.y += sp.dy * dt * 60; sp.dx *= 0.94; sp.dy *= 0.94; sp.a -= dt * 1.6; }
  ARENA.sparks = ARENA.sparks.filter(sp => sp.a > 0);
  for (const r of ARENA.rings){ r.r += dt * 60 * 1.4; r.a -= dt * 1.6; }
  ARENA.rings = ARENA.rings.filter(r => r.a > 0 && r.r < (ARENA.w || W) / 2);
}

function arenaCssVar(name, fb){
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
  } catch (e) { /* node harness */ }
  return fb;
}
