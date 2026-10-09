// #146: one focus trap for every overlay. Six overlays shipped four different
// amounts of keyboard support: the three modals in drawer.js each carried a
// copy of the same Tab-wrap code (two of them), the drilldown panel had its own
// copy, the nav rail's trap was silently disabled (offsetParent is null under
// every transform so the focusable list came back empty), and #helpwrap — a
// whole dialog with a scrim and a close button — had NO wiring at all:
// #helpbtn did nothing.
//
// Expectations are hand-derived from the helpers in palette.js and the dialog
// ARIA pattern (Tab wraps inside, Escape reaches the overlay's own handler,
// aria-hidden tracks open state, focus returns to the opener on release).
// Nothing is captured from output.
import { isolate } from './lib/isolate.mjs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);

// A tiny fake focusable: records .focus() calls and is checkable for
// containment.
const mk = (name, inRoot = true) => ({
  name,
  focused: 0,
  focus() { this.focused++; },
});
// Records setAttribute calls as k=v strings; modal needs them keyed.
const attrEl = () => { const el = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; return el; };
const root = els => ({
  contains: el => els.includes(el),
  querySelectorAll: sel => (sel === 'a[href],button,[tabindex]' ? els : []),
});

// ---- palette.js loads its real helpers ---------------------------------
const P = await isolate('palette.js', { 'main.js': { DATA: {} }, 'views.js': { PROV: {} } });

// ---- focusables ---------------------------------------------------------
eq(P.focusables(null), [], 'a missing root yields no focusables, not a crash');
eq(P.focusables({}), [], 'a root without querySelectorAll yields none');
{
  const a = mk('a'), b = mk('b');
  eq(P.focusables(root([a, b])).map(x => x.name), ['a', 'b'], 'the list is every anchor/button/[tabindex] in the root');
}

// ---- trapTab ------------------------------------------------------------
const press = (key, shift) => ({ key, shiftKey: !!shift, preventDefault() { this.prevented = true; } });

{
  const a = mk(), b = mk(), c = mk();
  const r = root([a, b, c]);
  globalThis.document = { activeElement: a };
  const e = press('Tab');
  eq(P.trapTab(e, r), false, 'Tab on the first element moves normally — no wrap');
  chk(!e.prevented, 'no preventDefault when the move is legal');
  const e2 = press('Tab');
  globalThis.document.activeElement = b;
  eq(P.trapTab(e2, r), false, 'Tab in the middle moves normally');
  chk(!e2.prevented, 'no preventDefault in the middle either');

  const e3 = press('Tab');
  globalThis.document.activeElement = c;
  eq(P.trapTab(e3, r), true, 'Tab on the last element wraps to the first');
  chk(e3.prevented, 'the wrap preventDefaults the browser move');
  eq(a.focused, 1, 'focus landed on the first element');

  const e4 = press('Tab', true);
  globalThis.document.activeElement = a;
  eq(P.trapTab(e4, r), true, 'Shift+Tab on the first element wraps to the last');
  chk(e4.prevented, 'the backwards wrap preventDefaults too');
  eq(c.focused, 1, 'focus landed on the last element');

  const e5 = press('Tab', true);
  globalThis.document.activeElement = b;
  eq(P.trapTab(e5, r), false, 'Shift+Tab in the middle moves backwards normally');

  // Focus outside the root: every Tab is pulled back, as if from the opener.
  const out = mk('outside');
  const e6 = press('Tab');
  globalThis.document.activeElement = out;
  eq(P.trapTab(e6, r), true, 'Tab with focus outside the root is pulled in');
  eq(a.focused, 2, 'pulled in to the first element');
  const e7 = press('Tab', true);
  globalThis.document.activeElement = out;
  eq(P.trapTab(e7, r), true, 'Shift+Tab with focus outside is pulled to the last');
  eq(c.focused, 2, 'the last element got it');

  eq(P.trapTab(press('Tab'), null), false, 'no root — nothing trapped');
  eq(P.trapTab(press('Enter'), r), false, 'a non-Tab key is not the trap\'s business');
  eq(P.trapTab(null, r), false, 'no event — not a crash');
  const emptyRoot = root([]);
  eq(P.trapTab(press('Tab'), emptyRoot), false, 'a root with nothing focusable does nothing');
}

// ---- setAria ------------------------------------------------------------
{
  const modal = attrEl(), scrim = attrEl();
  P.setAria(modal, scrim, true);
  eq(modal.attrs, { 'aria-hidden': 'false', 'aria-modal': 'true' }, 'opening: aria-hidden=false on the modal and it is declared aria-modal');
  eq(scrim.attrs, { 'aria-hidden': 'false' }, 'opening clears aria-hidden on the scrim');
  P.setAria(modal, scrim, false);
  eq(modal.attrs, { 'aria-hidden': 'true', 'aria-modal': 'true' }, 'closing sets aria-hidden=true on the modal');
  eq(scrim.attrs, { 'aria-hidden': 'true' }, 'closing sets aria-hidden=true on the scrim');
  const onlyScrim = attrEl();
  P.setAria(null, onlyScrim, true);
  eq(onlyScrim.attrs, { 'aria-hidden': 'false' }, 'a missing modal is skipped, not a crash');
  const bare = { click() {} };
  P.setAria(bare, null, true);
  eq(bare.attrs, undefined, 'an element without setAttribute is skipped');
}

// ---- trapFocus / release -------------------------------------------------
{
  const a = mk(), b = mk(), modalEl = root([a, b]);
  const saved = {};
  const doc = {
    activeElement: a,                 // the opener is focused when it opens
    listeners: saved,
    addEventListener(t, f) { (saved[t] ||= []).push(f); },
    removeEventListener(t, f) { saved[t] = (saved[t] || []).filter(x => x !== f); },
  };
  globalThis.document = doc;
  const modal = mk('modal'); modal.contains = modalEl.contains; modal.querySelectorAll = modalEl.querySelectorAll;
  const scrim = attrEl();

  const trap = P.trapFocus(modal, scrim, e => { if (e.key === 'Escape') e.closed = true; });

  chk(trap.opener === a, 'the opener (the focused element) is remembered');
  chk(doc.listeners.keydown.length === 1, 'one capture keydown was bound');
  eq(scrim.attrs['aria-hidden'], 'false', 'opening cleared the scrim\'s aria-hidden');

  // Tab inside the modal wraps WITHOUT reaching the overlay's own handler.
  const tabEvt = press('Tab');
  globalThis.document.activeElement = b;
  trap.onKeydown(tabEvt);
  eq(a.focused, 1, 'trapFocus wraps Tab to the first element');
  chk(tabEvt.closed === undefined, 'a wrapped Tab is consumed — the overlay handler never sees it');

  // Escape reaches the overlay's own handler (which closes).
  const escEvt = press('Escape');
  trap.onKeydown(escEvt);
  chk(escEvt.closed === true, 'Escape is forwarded to the overlay handler');

  // release: unbinds, restores aria-hidden, returns focus to the opener.
  chk(trap.release() === true, 'the first release returns true');
  eq(doc.listeners.keydown.length, 0, 'release unbound the keydown');
  chk(trap.release() === false, 'release is idempotent — a second release reports it did nothing');
  eq(scrim.attrs['aria-hidden'], 'true', 'release restored aria-hidden');
  // a.focused was 1 (from the wrap) before release; release adds one more.
  eq(a.focused, 2, 'release restores focus to the opener');
}

// ---- the drawers actually use it (wiring, hand-inspected) ---------------
// Because the trap helpers are exercised above with real behaviour, here the
// wiring is verified by reading the source: every overlay opens through
// trapFocus and closes through release, and the duplicated offsetParent
// filters are gone.
import { readFileSync } from 'node:fs';
{
  const src = mod => readFileSync(new URL(`../src/llm_telemetry/web/js/${mod}`, import.meta.url), 'utf8');
  const drawer = src('drawer.js');
  chk((drawer.match(/trapFocus\(/g) || []).length >= 4, 'drawer.js calls trapFocus for its overlays (tKeydown, sf, ln, drawer)');
  chk(!drawer.includes('offsetParent'), 'the offsetParent filter (and its silent-empty trap) is gone from drawer.js');
  chk((drawer.match(/\.release\(\)/g) || []).length >= 4, 'every open has a matching release path');
  const views = src('views.js');
  chk((views.match(/trapFocus\(/g) || []).length >= 1, 'views.js traps the drilldown panel');
  chk(!views.includes('offsetParent'), 'the offsetParent filter is gone from views.js');
  const router = src('router.js');
  chk(/querySelectorAll\([\s\S]*?\)\s*\.filter\([\s\S]*?offsetParent/.test(router) === false,
    'no focusable list in router.js is filtered by offsetParent (a list filtered to nothing silently disables the trap)');
  const rv = src('routerview.js');
  chk(rv.includes('export function installHelp'), 'routerview.js ships the help install');
  chk((rv.match(/trapFocus\(/g) || []).length >= 1, 'the help overlay goes through the shared trap');
  const live = src('live.js');
  chk(live.includes('installHelp()'), 'live.js installs the help overlay at boot');
  const pal = src('palette.js');
  chk(pal.includes('export function trapFocus') && pal.includes('export function trapTab'), 'the helpers live in palette.js — one copy, one rule');
  chk(readFileSync(new URL('../src/llm_telemetry/web/js/order.json', import.meta.url), 'utf8')
    .includes('"trapTab"'), 'order.json replays the trap helpers into the built page');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
