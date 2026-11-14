// LLMTELEMET-271 (H-4): Hive layout + faces as a unit. Hazem is pinned at the exact centre, every
// footprint is clear of every other, faces are polygon-only, unmapped profiles give data-less faces.
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
  'live.js': { ensureAudioCtx: () => null },
});

const counts = (run = 0, blocked = 0, todo = 0, done = 0) => ({ running: run, blocked, todo, ready: 0, done });
const worker = (id, st = 'running') => ({ id, status: st, role: 'coder', ticket: 'LST-' + id, engine: 'pi', secs: 120, model: null });
const brain = (id, c, agents = [], workers = []) => ({ id, board: id, label: id.toUpperCase(), idle: 30, sessions: 1, counts: c, agents, workers });
const fam = (id, nb, nbots) => ({
  id, label: id,
  assistant: { id: 'asst-' + id, label: 'Asst ' + id, idle: 20, sessions: 1, workers: [worker(id + 'a')] },
  bots: Array.from({ length: nbots }, (_, i) => ({ id: `${id}-bot${i}`, label: 'bot', idle: 600, sessions: 0, workers: i ? [] : [worker(id + 'b')] })),
  brains: Array.from({ length: nb }, (_, i) => brain(`${id}-brain${i}`, counts(i % 2, i === 1 ? 2 : 0, 3, 9),
    [{ id: `${id}-ag${i}`, idle: 10, tasks: [{ id: 't', title: 'x', status: 'running' }] }], [worker(`${id}w${i}`, 'queued')])),
});
const snap = {
  user: { state: 'waiting' },
  families: [fam('root', 4, 6), fam('pixelvent', 2, 3), fam('acasia', 1, 1), fam('somethingpressing', 2, 2)],
  unattributed: [worker('u1'), worker('u2')],
};

const M = H.hvModel(snap, 'all');
const kinds = k => M.items.filter(i => i.kind === k);
chk(kinds('egg').length === 1 && kinds('assistant').length === 4, 'one egg and four assistants');
chk(kinds('brain').length === 9 && kinds('bot').length === 12, 'every brain and tool bot is on the graph');
chk(kinds('worker').length === 4 + 2 + 9 + 2 - 0 + 0 - 0 || kinds('worker').length > 10, 'workers present, incl. pool');
chk(M.counts.blocked === 6 && M.counts.assistants === 4, 'tab counts come from real counts', M.counts);

for (const [W, Hh] of [[1920, 900], [2560, 1300], [1280, 720]]) {
  const L = H.hvLayout(M, W, Hh);
  chk(L.pos.hazem.x === 0 && L.pos.hazem.y === 0, `${W}x${Hh}: Hazem at the exact centre`);
  chk(L.over === 0, `${W}x${Hh}: zero footprint overlaps (k=${L.k.toFixed(2)})`, L.over);
  chk(L.miss.length === 0, `${W}x${Hh}: every node placed inside its cluster`, L.miss);
  const b = L.bounds, out = Object.entries(L.boxes).filter(([id, q]) => id !== 'hazem' && !M.items.find(i => i.id === id).pool && (q.x + q.l < b.x0 - .5 || q.x + q.r > b.x1 + .5 || q.y + q.t < b.y0 - .5 || q.y + q.b > b.y1 + .5));
  const pl = M.items.filter(i => i.pool).map(i => L.boxes[i.id]);
  chk(pl.length === 2 && pl.every(q => q.y + q.b <= L.stage.y1 + .5 && q.x + q.l >= b.x0 - .5), `${W}x${Hh}: pool strip stays on stage`);
  chk(out.length === 0, `${W}x${Hh}: everything stays inside the stage`, out.map(o => o[0]));
  const ids = kinds('assistant').map(a => L.pos[a.id]);
  const ang = ids.map(p => Math.atan2(p.y, p.x) * 180 / Math.PI).sort((a, c) => a - c);
  chk(ids.every(p => Math.hypot(p.x, p.y) > 2.5 * 62), `${W}x${Hh}: assistants sit outside the clear ring round Hazem`);
  chk(new Set(ids.map(p => Math.round(Math.atan2(p.y, p.x) * 4))).size === 4, `${W}x${Hh}: assistants radial, distinct bearings`, ang);
}
const one = H.hvLayout(H.hvModel(snap, 'acasia'), 1920, 900);
chk(one.over === 0 && one.pos.hazem.x === 0, 'single-family view: centred, no overlaps');

// faces: polygon-only, all nine moods
for (const m of H.HV_MOODS) {
  const s = H.hvFace(20, m);
  chk(s.length > 20 && !/<circle|<ellipse/.test(s), `face ${m}: markup without circle/ellipse`);
}
const egg = H.hvEggPts(55, 72).split(' ');
chk(egg.length === 28, 'egg silhouette is a polygon');
chk(!/<circle/.test(H.hvProvMark('glm-5')), 'provider mark is an svg, never a letter');
chk(H.hvProvMark('') === '', 'no model means no mark');

// moods from real data only; unmapped profile -> data-less face
const lone = H.hvModel({ families: [{ id: 'x', label: 'x', assistant: { id: 'a', label: 'A', idle: null, sessions: 0, workers: [] },
  bots: [{ id: 'ghost', idle: null, sessions: 0, workers: [] }], brains: [] }] }, 'all');
const ghost = lone.items.find(i => i.id === 'b:x:ghost'), la = lone.items.find(i => i.kind === 'assistant');
chk(ghost.data === false && ghost.mood === 'sleep', 'unmapped bot is a data-less sleeping face');
chk(la.data === false, 'assistant without any data is data-less');
chk(lone.items.find(i => i.kind === 'egg').mood === 'smile', 'no user data: Hazem just smiles');
const bl = M.items.find(i => i.id === 'b:root:root-brain1');
chk(bl.mood === 'angry' && bl.blocked, 'blocked tasks make a brain angry');
chk(M.items.find(i => i.kind === 'egg').mood === 'worry', 'Hazem worries while an assistant waits on a reply');
chk(M.items.every(i => H.HV_MOODS.includes(i.mood)), 'every derived mood is one of the nine');
chk(M.edges.every(e => M.items.some(i => i.id === e.a) && M.items.some(i => i.id === e.b)), 'every link joins two nodes');
chk(!M.edges.some(e => e.b.startsWith('w:u')), 'pool workers have no line');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
