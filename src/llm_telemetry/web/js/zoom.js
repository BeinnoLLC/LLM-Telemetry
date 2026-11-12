/**
 * Shared SVG-graph zoom (LLMTELEMET-279): mouse-wheel zoom anchored at the
 * cursor, drag to pan, two-finger pinch, double-click reset and visible
 * +/−/Fit controls — ONE implementation shared by the Flow/Life graph, the
 * Orchestration graph and the future Hive page.
 *
 * The zoom state ({k, ox, oy}: factor and pan offset over the caller's base
 * rect) is kept across live re-renders. A re-render may hand over a brand-new
 * <svg> element (Orchestration rebuilds its markup wholesale), so the state is
 * keyed by the caller's `key` (or the element itself), never by a DOM node that
 * may be thrown away. Re-attaching also swaps the element the listeners live
 * on, so handlers never stack up across renders.
 */
const ZOOMS = new Map();

export function attachZoom(svg, opts = {}){
  const key = opts.key || svg;
  let h = ZOOMS.get(key), carry = null;
  // A live re-render may hand over a brand-new <svg> (Orchestration rebuilds
  // its markup): keep the zoom STATE, drop the dead element and its listeners.
  if (h && h.svg !== svg) { carry = h.state; h.unbind(); h = null; }
  h = h || newHandle(key, svg, opts, carry);
  h.opts = opts;
  // A non-pristine zoom is re-applied on attach so the live re-render that just
  // rebuilt the graph leaves the user's zoom where it was. Pristine state never
  // touches the attribute: the renderer set a viewBox that already fits.
  if (h.state.k !== 1 || h.state.ox || h.state.oy) h.apply();
  return h.api;
}

function newHandle(key, svg, opts, carry){
  const state = carry || { k: 1, ox: 0, oy: 0 };
  const handle = { key, svg, state, opts: opts || {} };
  ZOOMS.set(key, handle);
  const kMin = () => (handle.opts.kMin == null ? 0.5 : handle.opts.kMin);
  const kMax = () => (handle.opts.kMax == null ? 8 : handle.opts.kMax);
  const clampK = k => Math.max(kMin(), Math.min(kMax(), k));
  const baseOf = () => handle.opts.getBase && handle.opts.getBase();

  // The user's zoom/pan on top of the caller's fitted base rect: the visible
  // rect is the base shrunk by k around the base centre, moved by (ox, oy).
  function viewOf(){
    const base = baseOf();
    if (!base) return null;
    const w = base.w / state.k, h = base.h / state.k;
    const cx = base.x + base.w / 2 + state.ox, cy = base.y + base.h / 2 + state.oy;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  function apply(){
    const v = viewOf();
    if (!v) return;
    svg.setAttribute('viewBox', `${v.x.toFixed(1)} ${v.y.toFixed(1)} ${v.w.toFixed(1)} ${v.h.toFixed(1)}`);
    if (handle.opts.onChange) handle.opts.onChange(v, state);
  }

  // Wheel/pinch zoom anchored at a client point: the point under the cursor
  // (or pinch centre) stays fixed while the scale changes around it.
  function zoomAt(clientX, clientY, factor){
    const base = baseOf(), v = viewOf();
    if (!base || !v) return;
    const b = svg.getBoundingClientRect();
    const relx = b.width ? (clientX - b.left) / b.width : 0.5;
    const rely = b.height ? (clientY - b.top) / b.height : 0.5;
    const px = v.x + relx * v.w, py = v.y + rely * v.h;
    const nk = clampK(state.k * factor), f = state.k / nk;
    const cx = base.x + base.w / 2 + state.ox, cy = base.y + base.h / 2 + state.oy;
    state.ox = px + (cx - px) * f - (base.x + base.w / 2);
    state.oy = py + (cy - py) * f - (base.y + base.h / 2);
    state.k = nk;
    apply();
  }

  // Reset to the fitted base — the SAME logic for the Fit control and the
  // double-tap/double-click.
  function fitView(){
    state.k = 1; state.ox = 0; state.oy = 0;
    apply();
  }

  const offs = [];
  const on = (type, fn, o) => {
    svg.addEventListener(type, fn, o);
    offs.push(() => svg.removeEventListener(type, fn, o));
  };

  // Pan + pinch: one pointer drags, two pointers pinch around their midpoint.
  // A pointerdown the caller wants kept for itself (a node drag) is filtered
  // out via panFilter.
  const active = new Map(); // pointerId -> last client {x,y}
  let panStart = null, pinchStart = null;
  const panOK = ev => !handle.opts.panFilter || handle.opts.panFilter(ev);
  on('pointerdown', ev => {
    if (ev.button != null && ev.button !== 0) return;
    if (!panOK(ev)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (active.size === 1){
      panStart = { s: { ...state }, p: { x: ev.clientX, y: ev.clientY } };
    } else if (active.size === 2){
      const pts = [...active.values()];
      pinchStart = {
        s: { ...state },
        d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2,
      };
      panStart = null;
    }
  });
  on('pointermove', ev => {
    if (!active.has(ev.pointerId)) return;
    active.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const b = svg.getBoundingClientRect();
    const bw = b.width || 1, bh = b.height || 1;
    const base = baseOf();
    if (!base) return;
    if (active.size === 2 && pinchStart){
      const pts = [...active.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const factor = d / (pinchStart.d || 1);
      // Keep the base point that was under the pinch-start midpoint pinned to
      // the midpoint now: scale change plus follow-the-fingers pan in one go.
      const s0 = pinchStart.s, w0 = base.w / s0.k, h0 = base.h / s0.k;
      const c0x = base.x + base.w / 2 + s0.ox, c0y = base.y + base.h / 2 + s0.oy;
      const px = c0x - w0 / 2 + (pinchStart.cx - b.left) / bw * w0;
      const py = c0y - h0 / 2 + (pinchStart.cy - b.top) / bh * h0;
      const nk = clampK(s0.k * factor), w = base.w / nk, h = base.h / nk;
      const mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
      state.k = nk;
      state.ox = px - (mx - b.left) / bw * w + w / 2 - (base.x + base.w / 2);
      state.oy = py - (my - b.top) / bh * h + h / 2 - (base.y + base.h / 2);
      apply();
    } else if (active.size === 1 && panStart){
      const s0 = panStart.s, w0 = base.w / s0.k, h0 = base.h / s0.k;
      state.ox = s0.ox - (ev.clientX - panStart.p.x) / bw * w0;
      state.oy = s0.oy - (ev.clientY - panStart.p.y) / bh * h0;
      apply();
    }
  });
  function endPointer(ev){
    active.delete(ev.pointerId);
    if (active.size < 2) pinchStart = null;
    if (active.size === 1){
      const [p] = active.values();
      panStart = { s: { ...state }, p };
    } else if (active.size === 0) panStart = null;
  }
  on('pointerup', endPointer);
  on('pointercancel', endPointer);
  on('pointerleave', endPointer);

  // Wheel zoom. A non-passive listener that cancels the event keeps the page
  // from scrolling while the cursor is over the graph. deltaMode ? .05 : .0035
  // keeps line-mode wheels (old mice) at a usable speed.
  on('wheel', ev => {
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * (ev.deltaMode ? 0.05 : 0.0035));
    zoomAt(ev.clientX, ev.clientY, factor);
  }, { passive: false });

  // Double-tap/double-click resets to the fitted view. Not routed through
  // on(): the unbind path only ever runs for an element the caller has already
  // thrown away (live re-render replaced the <svg>), which takes its listeners
  // with it.
  svg.addEventListener('dblclick', () => fitView());

  // Visible +/−/Fit controls (skipped when the caller renders its own, e.g.
  // Flow's #flowctl box) anchored into the graph's wrapper.
  if (handle.opts.controls !== false){
    const host = svg.parentElement;
    if (host && !host.querySelector('.zoomctl')){
      const view = (host.ownerDocument && host.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
      const cs = view && view.getComputedStyle ? view.getComputedStyle(host) : null;
      if (cs && (!cs.position || cs.position === 'static')) host.style.position = 'relative';
      const box = host.ownerDocument.createElement('div');
      box.className = 'zoomctl';
      const mkBtn = (label, title, fn) => {
        const b = host.ownerDocument.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', title);
        b.addEventListener('click', fn);
        return b;
      };
      box.appendChild(mkBtn('\u2212', 'Zoom out', () => {
        const b = svg.getBoundingClientRect();
        zoomAt(b.left + b.width / 2, b.top + b.height / 2, 1 / 1.4);
      }));
      box.appendChild(mkBtn('+', 'Zoom in', () => {
        const b = svg.getBoundingClientRect();
        zoomAt(b.left + b.width / 2, b.top + b.height / 2, 1.4);
      }));
      box.appendChild(mkBtn('Fit', 'Reset pan/zoom to fit', fitView));
      host.appendChild(box);
    }
  }

  handle.unbind = () => {
    while (offs.length) offs.pop()();
    ZOOMS.delete(key);
  };
  handle.apply = apply;
  handle.api = { state, zoomAt, reset: fitView, apply };
  return handle;
}
