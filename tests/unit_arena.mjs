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
process.exit(fail ? 1 : 0);
