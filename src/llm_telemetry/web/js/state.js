import { css } from './main.js';
// State renderers: skeleton / empty / error for every panel.
export function renderSkeleton(container, opts) {
  opts = opts || {};
  const n = (opts.lines || 3);
  let html = '<div class="state-skeleton" aria-busy="true" aria-live="polite">';
  for (let i = 0; i < n; i++) {
    html += '<div class="skel-line" style="width:' + (i === n - 1 ? '60%' : '100%') + '"></div>';
  }
  html += '</div>';
  if (typeof container === 'string') {
    const el = document.querySelector(container);
    if (el) el.innerHTML = html;
  } else if (container) {
    container.innerHTML = html;
  }
  return html;
}

export function renderEmpty(container, opts) {
  opts = opts || {};
  const icon = opts.icon || '∅';
  const message = opts.message || 'No data yet.';
  const action = opts.action ? '<a class="state-action" href="' + opts.action.href + '">' + (opts.action.label || 'Retry') + '</a>' : '';
  const html = '<div class="state-empty"><div class="state-icon">' + icon + '</div><p class="state-msg">' + message + '</p>' + action + '</div>';
  if (typeof container === 'string') {
    const el = document.querySelector(container);
    if (el) el.innerHTML = html;
  } else if (container) {
    container.innerHTML = html;
  }
  return html;
}

export function renderError(container, opts) {
  opts = opts || {};
  const message = opts.message || 'Something went wrong.';
  const lastError = opts.lastError ? '<div class="state-lasterr">Last error: ' + opts.lastError + '</div>' : '';
  const where = opts.whereToLook ? '<div class="state-where">See: ' + opts.whereToLook + '</div>' : '';
  const html = '<div class="state-error"><p class="state-msg">' + message + '</p>' + lastError + where + '</div>';
  if (typeof container === 'string') {
    const el = document.querySelector(container);
    if (el) el.innerHTML = html;
  } else if (container) {
    container.innerHTML = html;
  }
  return html;
}

// Z-state token values. Read lazily via getters: `css` comes from main.js,
// which sits in an import cycle with this module, so an eager read here could
// hit the temporal dead zone at eval time — and a theme switch would never
// update colours frozen at import. Getters resolve both.
export const Z = {
  get ok(){ return css('--z-ok'); },
  get warn(){ return css('--z-warn'); },
  get bad(){ return css('--z-bad'); },
};
