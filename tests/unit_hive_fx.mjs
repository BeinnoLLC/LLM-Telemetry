// LST-272 (H-5): the anger model, the flame scale and Hazem's face keyframes as pure units.
// Anger is computed from real snapshot data only; the face is a continuous blend, never on/off.
import { readFileSync } from 'node:fs';
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const H = await isolate('hive.js', {
  'palette.js': { $: () => null, esc: s => String(s == null ? '' : s), ago: s => s + 's' },
  'views.js': { provOf: () => 'cloud', provLogoSvg: () => '<svg class="x"></svg>' },
  'zoom.js': { attachZoom: () => ({}) },
  'live.js': { ensureAudioCtx: () => null, armAudioUnlock: () => {} },
});

// the palette comes from the real tokens, so a missing --hv-* token fails here
const css = readFileSync(new URL('../src/llm_telemetry/web/css/tokens.css', import.meta.url), 'utf8');
const pal = H.hvPalette(n => (new RegExp(n + ':\\s*(#[0-9a-fA-F]{6})').exec(css) || [])[1]);
chk(['rim-top', 'rim-bot', 'mouth', 'flame'].every(t => pal[t].length === 5 && pal[t].flat().every(Number.isFinite)), 'all 20 --hv-* colour tokens resolve');

// ---- anger model ----
const w = (st, secs = 60) => ({ id: 'w' + Math.random(), status: st, secs });
const fam = (id, k, ws = [], aw = []) => ({ id, label: id, assistant: { id: 'a' + id, label: 'A', idle: 5, sessions: 1, workers: aw }, bots: [],
  brains: [{ id: 'b' + id, board: 'b', label: 'B', idle: 5, sessions: 1, counts: { running: 0, blocked: 0, todo: 0, ready: 0, done: 0, ...k }, workers: ws, agents: [] }] });
const snap = (families, user = { state: 'idle', links: [] }, unattributed = []) => ({ user, families, unattributed });
const calm = H.hvSystem(snap([fam('r', { done: 9 })]));
chk(calm.p === 0 && calm.a === 0, 'quiet system: pressure 0, anger 0', calm);
chk(H.hvSystem(snap([])).a === 0, 'empty snapshot: anger 0, no crash');
const busy = H.hvSystem(snap([fam('r', { running: 2, todo: 4 }, [w('running'), w('running')])]));
const blocked = H.hvSystem(snap([fam('r', { running: 1, blocked: 3, todo: 2 }, [w('running'), w('queued')])]));
chk(busy.a > calm.a && blocked.a > busy.a, 'anger rises with workload then with blocked work', [calm.a, busy.a, blocked.a]);
chk(Math.abs(blocked.bs - 3 / 6) < 1e-9, 'blocked share = blocked / open cards', blocked.bs);
chk(Math.abs(blocked.a - Math.min(1, .7 * blocked.p + .3 * blocked.bs)) < 1e-9, 'a = .7 p + .3 blocked share', blocked);
const waiting = H.hvSystem(snap([fam('r', {})], { state: 'waiting', links: [{ state: 'waiting' }, { state: 'question' }, { state: 'idle' }] }));
chk(waiting.waiting === 2 && waiting.p > 0, 'waiting/question links count as pressure', waiting);
const swarm = H.hvSystem(snap([fam('r', { running: 6, blocked: 9, todo: 1 }, Array.from({ length: 8 }, () => w('running', 4000))), fam('s', { blocked: 5 }, [w('queued'), w('queued')])]));
chk(swarm.a > .8 && swarm.a <= 1 && swarm.p <= 1, 'a swarm of blocked work drives anger near the top, never above 1', swarm.a);
let prev = -1, mono = true;
for (let b = 0; b <= 12; b++) { const a = H.hvSystem(snap([fam('r', { running: 1, blocked: b, todo: 2 }, [w('running')])])).a; if (a < prev) mono = false; prev = a; }
chk(mono, 'anger never falls as blocked cards are added');
chk(JSON.stringify(H.hvSystem(snap([fam('r', { blocked: 2 }, [w('running')])]))) === JSON.stringify(H.hvSystem(snap([fam('r', { blocked: 2 }, [w('running')])]))), 'deterministic inputs');
chk(H.hvEase(0, 1, 16, 1500) > 0 && H.hvEase(0, 1, 16, 1500) < .02 && H.hvEase(0, 1, 1e6, 1500) > .999, 'easing takes small steps and converges');

// ---- flames: none < .5, full blaze >= .9, continuous in between ----
chk(['none', 'none', 'smoulder', 'small', 'medium', 'full blaze', 'full blaze'].join() === [0, .49, .5, .7, .85, .9, 1].map(H.hvFlameLevel).join(), 'flame level names by pressure');
chk(H.hvFlame(55, 74, .49, 0, 1, true) === null && H.hvFlame(55, 74, .5, 0, 1, true) !== null, 'no flames below .5, flames from .5');
const sizes = [.5, .6, .7, .8, .9, 1].map(q => H.hvFlame(55, 74, q, 0, 1, true));
chk(sizes.every((f, i) => i === 0 || f.n >= sizes[i - 1].n) && sizes[5].n === 16 && sizes[0].n === 4, 'tongue count grows 4 -> 16 with pressure', sizes.map(f => f.n));
chk(H.hvFlameU(.5) === 0 && H.hvFlameU(1) === 1 && H.hvFlameU(.9) === .8, 'flame scale is linear over .5..1');
chk(sizes[5].core > sizes[1].core && sizes[0].core === 0, 'white-hot core fades in with pressure');
chk(/^M[\d.,L-]+Z/.test(sizes[3].d) && !/[CQA]/.test(sizes[3].d), 'tongues are straight-segment polygons');
const c0 = H.hvFlameRgb(.5, pal), c1 = H.hvFlameRgb(.95, pal);
chk(c1[1] > c0[1] && c1[2] > c0[2], 'flame colour goes deep orange -> white-hot');

// ---- face keyframes ----
const K = [0, .25, .5, .75, 1].map(a => H.hvKf(a, pal));
chk(K[0].brow === 7 && K[0].mo === 0 && K[0].bloom === .35, 'a=0 (ref-stern): brow 7deg, mouth closed, bloom .35', K[0]);
chk(K[2].brow === 21 && K[2].mo === .30, 'a=.5: brow 21deg, mouth .30 open', K[2]);
chk(K[4].brow === 36 && K[4].mo === 1 && K[4].bloom === 1, 'a=1 (ref-angry): brow 36deg, mouth fully open, bloom 1', K[4]);
chk(H.hvKf(0, pal).top.join() === pal['rim-top'][0].join() && H.hvKf(1, pal).bot.join() === pal['rim-bot'][4].join(), 'rim colours hit the token ends exactly');
const grid = Array.from({ length: 101 }, (_, i) => H.hvKf(i / 100, pal));
const up = k => grid.every((f, i) => i === 0 || f[k] >= grid[i - 1][k] - 1e-9), down = k => grid.every((f, i) => i === 0 || f[k] <= grid[i - 1][k] + 1e-9);
chk(['brow', 'bt', 'mo', 'mw', 'bloom', 'teeth'].every(up), 'brow angle, thickness, mouth, bloom, teeth rise monotonically');
chk(['eh', 'gap', 'eo'].every(down), 'eyes narrow, darken and brows lower monotonically');
chk(grid.every((f, i) => i === 0 || f.bot[1] <= grid[i - 1].bot[1] + 1e-9 && f.top[1] <= grid[i - 1].top[1] + 1e-9), 'rim shifts pink/orange -> orange-red (green channel only falls)');
chk(grid.every((f, i) => i === 0 || f.mc[0] <= grid[i - 1].mc[0] + 1e-9) && K[4].mc[0] < K[0].mc[0], 'mouth goes from mauve to dark red');
chk(grid.every((f, i) => i === 0 || Math.abs(f.brow - grid[i - 1].brow) < 1), 'no jump between neighbouring a values (continuous)');
// ---- markup ----
for (const a of [0, .25, .5, .75, 1]) {
  const m = H.hvHead(55, 74, H.hvKf(a, pal));
  chk(!/<circle|<ellipse|<rect/.test(m) && /hv-hz-rim/.test(m) && /hv-crown/.test(m), `head at a=${a}: polygons and paths only, rim and crown present`);
}
chk(!/hv-hz-teeth/.test(H.hvHead(55, 74, K[0])) && /hv-hz-teeth/.test(H.hvHead(55, 74, K[4])), 'teeth appear only with anger');
chk(H.HV_EGG.ry / H.HV_EGG.rx > 1.3 && H.HV_EGG.ry / H.HV_EGG.rx < 1.4, 'head is taller than wide, about 1:1.35');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
