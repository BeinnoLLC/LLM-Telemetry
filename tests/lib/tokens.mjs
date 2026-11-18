// #306: tokens.css-backed doubles for the render-time colour lookups.
//
// The web/js modules resolve colours through main.js's css() at render time
// (--prov-*, --ln-*, --pi-mark-*, --spark-neutral live in tokens.css), but the
// unit harness runs in plain node with no stylesheet, so a stub that returns
// nothing makes every token lookup render a grey. These doubles read the real
// tokens.css, so a stubbed lookup yields the same colour the dashboard shows.
import { readFileSync } from 'node:fs';

const SRC = readFileSync(
  new URL('../../src/llm_telemetry/web/css/tokens.css', import.meta.url), 'utf8');
const TOKENS = {};
for (const m of SRC.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;]+)/g)) {
  TOKENS[m[1]] = m[2].trim();
}

// Same contract as main.js css(): the token's declared value or the '#888' fallback.
export const css = k => TOKENS[k] || '#888';

// Same contract as routerview.js rtColor(): a --token name resolves to its
// colour, anything else (an already-resolved literal) passes through.
export const rtColor = c => (c && String(c).startsWith('--') ? css(c) : c);

// Same contract as main.js rawCss(): the token's declared value, '' when unset.
export const rawCss = k => TOKENS[k] || '';

// Same contract as main.js hueCss(): hash hue from the caller, saturation and
// lightness from the --hue-<k>-s/-l tokens, muted when either is missing.
export const hueCss = (h, k) => {
  const sat = rawCss('--hue-' + k + '-s');
  const lig = rawCss('--hue-' + k + '-l');
  if (!sat || !lig) return css('--muted');
  return `hsl(${h} ${sat} ${lig})`;
};
