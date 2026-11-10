import assert from 'node:assert/strict';
import { arenaPlan } from '../src/llm_telemetry/web/js/arena.js';

let pass = 0, fail = 0;
const eq = (a, e, m) => { try { assert.deepEqual(a, e); pass++; } catch { fail++; console.error(`FAIL: ${m}\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`); } };

const plan = arenaPlan({ hermes: 2, pi: 0, claude: 1, codex: 0 });
eq(plan.length, 4, 'arenaPlan: always 4 kinds');
for (const k of ['hermes','pi','claude','codex']) {
  const p = plan.find(x => x.kind === k);
  const active = (k === 'hermes' || k === 'claude');
  eq(p.alpha, active ? 1 : 0.35, `arenaPlan: ${k} alpha`);
  eq(p.spd, active ? 1 + Math.min((k==='hermes'?2:1),5)*0.12 : 0.8, `arenaPlan: ${k} spd`);
}
console.log(`${pass} passed, ${fail} failed`);

import { ARENA, arenaSpawn, arenaTickFrame } from '../src/llm_telemetry/web/js/arena.js';

const cv = { clientWidth: 1259, clientHeight: 259 };
const ctx = new Proxy({}, { get(){ return () => {}; }, set(){ return true; } });

ARENA.counts = { hermes: 4, claude: 1 };
arenaSpawn(null);

let ts = 0;
for (let i = 0; i < 2000; i++){ ts += 16; arenaTickFrame(cv, ctx, ts); }

let simPass = 0, simFail = 0;
const axes = [0, 60, 120].map(d => { const r = d*Math.PI/180; return {x:Math.cos(r), y:Math.sin(r)}; });
for (const ag of ARENA.agents){
  const finite = Number.isFinite(ag.x) && Number.isFinite(ag.y) && Number.isFinite(ag.dx) && Number.isFinite(ag.dy);
  if (!finite){ simFail++; console.error('FAIL: agent not finite'); continue; }
  simPass++;
  for (const ax of axes){
    const val = Math.abs(ag.x*ax.x + ag.y*ax.y);
    if (val > 1.05){ simFail++; console.error(`FAIL: agent outside hex axis (${val})`); } else { simPass++; }
  }
}
console.log(`sim: ${simPass} passed, ${simFail} failed`);
process.exit((fail + simFail) ? 1 : 0);
