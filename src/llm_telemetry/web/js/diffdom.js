/**
 * diffdom: tiny keyed-DOM diff + fade helper — presentation-plane lib (P10).
 * First module of the #38 presentation plane: renderers emit HTML per key;
 * applyDiff decides create/patch/fade-out/reorder in place, so a refresh no
 * longer tears the whole list down (hover, focus, scroll anchors and expanded
 * panels survive).
 *
 *   planDiff(beforeKeys, afterKeys) -> ops[]           (pure; unit-testable)
 *   applyDiff(box, keyOf, rows)  rows = [{key, html}]
 *   invalidate(box)               — drop the per-key cache after external
 *                                   innerHTML replaces (e.g. empty-state swap)
 *
 * Keys group CONSECUTIVE sibling nodes (a session renders as a row div plus
 * an optional lmpanel div — keyOf must map both nodes to the same key).
 * Per-key html cache: an idle poll whose rows are byte-identical to the last
 * render touches ZERO nodes.
 * Fade-out ghosts: cloned (identifiers stripped → never re-match a key),
 * pinned in place, faded via WAAPI, removed on finish + timer safety net.
 * Reduced motion: no fades, nodes swap instantly.
 */
export function motionReduced(){
  try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

export const FADE_MS = 240;
const GHOST = 'diff-ghost';
const EXITY = 'diff-exit';
const isGhost = (el) => el.classList && el.classList.contains(GHOST);

// Grouping walk: consecutive children sharing a key form one entry. Nodes
// whose key is null/'' become unique singletons (empty-state block etc.).
// Ghost clones are skipped — they are corpses, not entries.
function groupsOf(children, keyOf){
  const groups = [];
  let cur = null;
  for (const el of children){
    if (isGhost(el)) continue;
    const k = keyOf(el);
    const key = (k != null && k !== '') ? k : '·#' + groups.length;
    if (cur && cur.key === key){ cur.nodes.push(el); }
    else { cur = { key, nodes: [el] }; groups.push(cur); }
  }
  return groups;
}

export function planDiff(beforeKeys, afterKeys){
  const bset = new Set(beforeKeys), aset = new Set(afterKeys);
  const ops = [];
  afterKeys.forEach((k, i) => {
    if (!bset.has(k)) ops.push({ op:'enter', key:k, index:i });
    else if (beforeKeys.indexOf(k) !== i) ops.push({ op:'move', key:k, index:i });
  });
  beforeKeys.forEach((k, i) => { if (!aset.has(k)) ops.push({ op:'exit', key:k, index:i }); });
  return ops;
}

const cacheFor = new WeakMap(); // box -> Map(key -> html string)

export function invalidate(box){ cacheFor.delete(box); }

function freshNodes(tmp, html){
  tmp.innerHTML = html;
  return [...tmp.content.children]; // multi-root friendly
}

export function applyDiff(box, keyOf, rows){
  const doc = box.ownerDocument || document;
  const win = doc.defaultView || window;
  const existingGroups = groupsOf([...box.children], keyOf);
  const keysBefore = existingGroups.map(g => g.key);
  const byKey = new Map(existingGroups.map(g => [g.key, g]));
  const plan = planDiff(keysBefore, rows.map(r => r.key));
  const reduced = motionReduced();
  const out = { enter:0, move:0, exit:0, patch:0, keep:0 };
  const cache = cacheFor.get(box) || new Map();
  cacheFor.set(box, cache);
  // First applyDiff on pre-existing (e.g. server-rendered) markup: adopt the
  // incoming DOM instead of fading everything old out — boot must not spray
  // ghosts over content the user was already shown.
  const adopt = cache.size === 0 && keysBefore.length > 0;
  const tmp = doc.createElement('template');

  // 1) EXIT — clone each node of the group, pin clones at the old slot, fade
  //    them out, then drop the originals from the flow immediately. Skipped
  //    for the adopt pass (no ghosts on boot) and when WAAPI is unavailable:
  //    the CSS-transition fallback renders ghosts queryable during the fade,
  //    which confuses tests and screen readers — an instant swap is safer.
  const canGhost = !reduced && !adopt &&
    typeof (doc.defaultView || window).Element.prototype.animate === 'function' &&
    cache.size > 0;
  for (const o of plan.filter(o => o.op === 'exit')){
    const g = byKey.get(o.key);
    if (!g || !g.nodes.length) continue;
    const pin = g.nodes[0];
    if (canGhost) for (const n of g.nodes){
      const c = n.cloneNode(true);
      if (c.classList){
        c.classList.add(GHOST);
        // Strip identity so a ghost never matches a keyed lookup: every
        // data-* hook (session id, model badge, profile chip…) has to go,
        // not just the ones today's callers happen to query.
        c.removeAttribute('id');
        for (const a of [...c.attributes]) if (a.name.startsWith('data-')) c.removeAttribute(a.name);
        c.querySelectorAll && c.querySelectorAll('[id],[data-]').forEach(x => {
          x.removeAttribute('id');
          for (const a of [...x.attributes]) if (a.name.startsWith('data-')) x.removeAttribute(a.name);
        });
      }
      box.insertBefore(c, pin);               // pin clone at the old slot
      if (!reduced && typeof c.animate === 'function'){
        c.animate([{ opacity:1 }, { opacity:0 }],
          { duration:FADE_MS, easing:'ease-in', fill:'forwards' });
      } else if (!reduced){
        // CSS path: ghosts insert at opacity:1, then the .diff-exit class
        // flips them to 0 one frame later — a transition needs a style
        // change AFTER insertion to actually run.
        (win.requestAnimationFrame || (f => win.setTimeout(f, 16)))(
          () => c.classList.add(EXITY));
      }
      win.setTimeout(() => c.remove(), FADE_MS + 160);
    }
    for (const n of g.nodes) n.remove();   // originals leave now; ghosts linger
    cache.delete(o.key);
    out.exit++;
  }

  // 2) Build fresh nodes for every row (parse once).
  const freshByKey = new Map();
  for (const r of rows) freshByKey.set(r.key, freshNodes(tmp, r.html));

  // 3) RECONCILE — for each wanted row, in wanted order:
  //    • adopt pass   → take over the existing server-rendered markup as-is;
  //    • cache hit    → reuse the existing group untouched (keep);
  //    • survivor     → insert fresh nodes before the old group, remove old;
  //    • new group    → stage via appendChild (ordering step fixes position).
  const staged = new Map(); // key -> nodes now representing that key in the box
  if (adopt){
    for (const r of rows){
      const g = byKey.get(r.key);
      if (g && g.nodes.length){ cache.set(r.key, r.html); staged.set(r.key, g.nodes); }
      else {
        (freshByKey.get(r.key) || []).forEach(n => box.appendChild(n));
        cache.set(r.key, r.html);
        out.enter++;
      }
    }
  } else for (const r of rows){
    const nodes = freshByKey.get(r.key) || [];
    const g = byKey.get(r.key);
    if (g && g.nodes.length && cache.get(r.key) === r.html){
      out.keep++;
      staged.set(r.key, g.nodes);
      continue;
    }
    if (g && g.nodes.length){
      const pin = g.nodes[0];
      nodes.forEach(n => box.insertBefore(n, pin));
      for (const n of g.nodes) n.remove();
      cache.set(r.key, r.html);
      out.patch++;
    } else {
      nodes.forEach(n => box.appendChild(n));
      cache.set(r.key, r.html);
      out.enter++;
    }
    staged.set(r.key, nodes);
  }

  // 4) ORDER — two-pointer reconciliation: walk the WANTED order, advancing a
  //    cursor over the box's CURRENT groups. A group sitting exactly at the
  //    cursor stays; any other group moves before the cursor group (or to the
  //    end when the cursor has run past).
  {
    const cur = groupsOf([...box.children], keyOf);
    const firstOf = (key) => {
      const inBox = (staged.get(key) || []).filter(n => n.parentNode === box);
      return inBox.length ? inBox[0] : null;
    };
    let j = 0;
    for (const r of rows){
      const first = firstOf(r.key);
      if (!first) continue;
      if (j < cur.length && cur[j].nodes[0] === first){ j++; continue; } // in place
      let ref = null;
      for (let k = rows.indexOf(r) + 1; k < rows.length && !ref; k++){
        const nf = firstOf(rows[k].key);
        if (nf && nf !== first) ref = nf;
      }
      for (const n of (staged.get(r.key) || [])) ref ? box.insertBefore(n, ref) : box.appendChild(n);
      out.move++;
    }
  }

  // 5) FADE-IN for entering groups (first node only — the group is one unit).
  if (!reduced){
    for (const r of rows){
      if (byKey.has(r.key)) continue;
      const first = ((staged.get(r.key) || []).filter(n => n.parentNode === box))[0];
      if (first && typeof first.animate === 'function'){
        first.animate([{ opacity:0 }, { opacity:1 }],
          { duration:FADE_MS, easing:'ease-out' });
      }
    }
  }
  return out;
}

export const _internal = { FADE_MS, GHOST, groupsOf, cacheFor, isGhost };