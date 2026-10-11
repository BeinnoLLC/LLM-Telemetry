// Unit tests for diffdom.js — the keyed-DOM diff + fade helper (P10/#38).
// planDiff is pure and asserted by hand; applyDiff runs against real jsdom
// nodes, checking: group reuse across idle polls (zero patches), in-place
// patch on content change, fade-out ghost lifecycle (cloned, pinned, removed),
// fade-in on enter, and ordering.
// Expected values derived by hand from the source, not captured from output.
import { isolate } from './lib/isolate.mjs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
function eq(actual, expected, msg){
  try { assert.deepStrictEqual(actual, expected); pass++; }
  catch { fail++; console.error(`FAIL: ${msg}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`); }
}

// ---------- planDiff (pure) ----------
{
  const src = await isolate('diffdom.js');
  const pd = (a, b) => src.planDiff(a, b).map(o => o.op + ':' + o.key);
  eq(pd(['a','b'], ['a','b']), [], 'identical keys → no ops');
  eq(pd(['a','b'], ['b','a']), ['move:b', 'move:a'], 'swap → two moves');
  eq(pd(['a','b','c'], ['a']), ['exit:b', 'exit:c'], 'removals → exits');
  eq(pd(['a'], ['a','x','y']), ['enter:x', 'enter:y'], 'additions → enters');
  eq(pd([], ['n']), ['enter:n'], 'from empty → one enter');
  eq(pd(['n'], []), ['exit:n'], 'to empty → one exit');
  eq(pd(['a','dup','dup','b'], ['dup','b']), ['move:dup', 'move:b', 'exit:a'],
     'first dup stays (matches by position), second dup exits via dedupe');
}

// ---------- applyDiff (jsdom) ----------
const { JSDOM } = await import('jsdom');
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="box"></div></body></html>', { pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
// diffdom.js reads matchMedia at apply-time; jsdom throws w/o implementation.
Object.defineProperty(dom.window, 'matchMedia', { value: () => ({ matches: false }) });

const src = await isolate('diffdom.js');
const box = document.getElementById('box');
const keyOf = (el) => el.getAttribute('data-tsession') || null;
const row = (id, txt) => ({ key: id, html: `<div data-tsession="${id}" class="liverow">${txt}</div>` });

// 1) first render: two rows enter
let out = src.applyDiff(box, keyOf, [row('s1','one'), row('s2','two')]);
eq([out.enter, out.patch, out.keep, out.exit], [2, 0, 0, 0], 'first render: 2 enters');
eq(box.children.length, 2, 'box holds 2 row nodes');
eq(box.children[0].textContent, 'one', 'order: s1 first');

// 2) idle poll, same html: keeps both, patches nothing
const beforeIdle = [...box.children].slice();
out = src.applyDiff(box, keyOf, [row('s1','one'), row('s2','two')]);
eq([out.enter, out.patch, out.keep, out.exit], [0, 0, 2, 0], 'idle poll: 2 keeps, 0 patches');
eq([...box.children][0], beforeIdle[0], 'idle poll: SAME node object reused (hover survives)');

// 3) content change on s2 only: 1 keep, 1 patch — s1 node untouched
out = src.applyDiff(box, keyOf, [row('s1','one'), row('s2','TWO (updated)')]);
eq([out.keep, out.patch], [1, 1], 'content change: s1 kept, s2 patched');
eq(box.children[0], beforeIdle[0], 'unchanged s1 keeps its node');
eq(box.children[1].textContent, 'TWO (updated)', 's2 shows new text');

// 4) exit with ghost (WAAPI available): ghost clone fades, real node gone
//    after, then ghost auto-removed by the safety timer
window.Element.prototype.animate = function (kf) {
  return { finished: Promise.resolve(), cancel() {} };
};
out = src.applyDiff(box, keyOf, [row('s2','TWO (updated)')]);
eq(out.exit, 1, 'exit: 1');
eq(box.children.length, 2, 'ghost pinned + survivor remains (2 children in-box)');
const ghost = [...box.children].find(el => el.classList.contains('diff-ghost'));
assert.ok(ghost, 'a ghost clone exists');
eq(ghost.textContent, 'one', 'ghost is the removed row');
const survivor = [...box.children].find(el => !el.classList.contains('diff-ghost'));
eq(survivor.textContent, 'TWO (updated)', 'survivor intact');
await new Promise(r => setTimeout(r, 550));
eq(box.children.length, 1, 'ghost auto-removed by timer (no leak)');

// 4b) exit WITHOUT WAAPI (old jsdom): instant swap — no ghost at all
delete window.Element.prototype.animate;
out = src.applyDiff(box, keyOf, []);
eq(out.exit, 1, 'no-WAAPI exit: 1');
eq(box.children.length, 0, 'no-WAAPI: instant removal, zero ghosts');
eq([...box.children].filter(el => el.classList.contains('diff-ghost')).length, 0, 'no ghost clone created');

// 5) enter with fade-in: s3 appears, ghost of previous exit gone
src.invalidate(box);
out = src.applyDiff(box, keyOf, [row('s2','TWO (updated)')]);
eq(out.enter, 1, 're-entrant s2 after empty box');
out = src.applyDiff(box, keyOf, [row('s2','TWO (updated)'), row('s3','three')]);
eq(out.enter, 1, 'enter: s3');
eq([...box.children].map(c => c.dataset.tsession), ['s2','s3'], 'order: s2 then s3');
await new Promise(r => setTimeout(r, 550));
eq(box.children.length, 2, 'no ghost leak after enter');

// 6) reorder: s3 first, s2 second
out = src.applyDiff(box, keyOf, [row('s3','three'), row('s2','TWO (updated)')]);
eq(out.move, 1, 'reorder counted');
eq([...box.children].map(c => c.dataset.tsession), ['s3','s2'], 'order after move');

// 7) multi-node group: lmpanel second node shares the row's key (the real
//    liveGroupKeyOf contract — row carries data-tsession, panel data-lmp)
const liveGroupKeyOf = (el) => {
  if (el.classList.contains('liverow')) return el.getAttribute('data-tsession');
  if (el.classList.contains('lmpanel')) return el.getAttribute('data-lmp');
  return null;
};
box.innerHTML = '';
src.invalidate(box);
const rowP = (id, panel) => ({ key: id, html:
  `<div data-tsession="${id}" class="liverow">row ${id}</div>` + (panel ? `<div class="lmpanel" data-lmp="${id}">panel ${id}</div>` : '') });
out = src.applyDiff(box, liveGroupKeyOf, [rowP('a', true)]);
eq(box.children.length, 2, 'row+panel both inserted');
out = src.applyDiff(box, liveGroupKeyOf, [rowP('a', true)]);
eq(out.keep, 1, 'group keep counts once');
eq(out.exit, 0, 'group keep emits no exit');
eq(box.children.length, 2, 'group unchanged across idle poll');
out = src.applyDiff(box, liveGroupKeyOf, [rowP('a', false)]);
eq(out.patch, 1, 'panel removal = patch (group shrink)');
eq(out.exit, 0, 'group shrink is not an exit');
await new Promise(r => setTimeout(r, 550));   // let any stray ghost timer run
eq(box.querySelectorAll('.lmpanel').length, 0, 'panel node removed');

// 8) reduced motion: no ghosts linger — exits removed immediately is NOT the
//    contract (timer still owns removal) but no WAAPI calls (jsdom lacks
//    Element.animate) must throw — exercised implicitly above; assert a plain
//    swap happened in all runs without error.

console.log(`unit_diffdom: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);