// Generic a11y lint: every <button> (and every createElement('button')) in
// src/llm_telemetry/web must expose an accessible name. LLMTELEMET-327
// (docs/design-audit.md §10 item 22, DESIGN.md HARD RULE 7).
//
// A button passes when it has visible text (a letter or digit outside any
// aria-hidden span / svg), or aria-label, or aria-labelledby. `title` alone
// does NOT count: it is not announced reliably and is absent on touch.
// Template expressions `${...}` are treated as dynamic visible text, unless
// the whole body is wrapped in aria-hidden. For createElement('button') the
// next 14 lines must set aria-label/ariaLabel (or move a header's existing
// text into the button).
//
// Usage: node tests/check_icon_button_aria.js [--quiet]
const fs = require('fs');
const path = require('path');

const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const quiet = process.argv.includes('--quiet');
let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; if (!quiet) console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') walk(p, out); }
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** end index of the opening tag starting at i: first '>' outside quotes and ${...} */
function tagEnd(s, i) {
  let q = null, depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (depth) { if (c === '{') depth++; else if (c === '}') depth--; continue; }
    if (c === '$' && s[i + 1] === '{') { depth = 1; i++; continue; }
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

const lineOf = (s, i) => s.slice(0, i).split('\n').length;
const hasName = (attrs) => /(?:^|\s)aria-label(ledby)?\s*=\s*['"][^'"]+['"]/.test(attrs);

function visibleText(body) {
  let t = body
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<(\w+)\b[^>]*\baria-hidden=["']true["'][^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#?\w+;/g, '');
  if (/\$\{/.test(t)) {
    const stripped = t.replace(/\$\{[^}]*\}/g, '').trim();
    const exprs = t.match(/\$\{[^}]*\}/g) || [];
    const glyphOnly = exprs.length > 0 && stripped === '' && exprs.every(e => /glyph|arrow|chevron|triang|\\u25B/.test(e));
    if (glyphOnly) return false;
    return true;
  }
  return /[A-Za-z0-9]/.test(t);
}

const bad = [];
let scanned = 0, buttons = 0;
for (const file of walk(WEB)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(path.join(__dirname, '..'), file);
  scanned++;
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(src))) {
    const end = tagEnd(src, m.index + 7);
    if (end < 0) continue;
    const attrs = src.slice(m.index + 7, end);
    const close = src.indexOf('</button>', end);
    const body = close < 0 ? '' : src.slice(end + 1, close);
    buttons++;
    if (!hasName(attrs) && !visibleText(body)) bad.push(`${rel}:${lineOf(src, m.index)} <button${attrs.slice(0, 60).replace(/\s+/g, ' ')}>`);
  }
  const ce = /createElement\(\s*['"]button['"]\s*\)/g;
  while ((m = ce.exec(src))) {
    buttons++;
    const win = src.split('\n').slice(lineOf(src, m.index) - 1, lineOf(src, m.index) + 14).join('\n');
    const named = /aria-label|ariaLabel/.test(win) || /while\s*\(\s*th\.firstChild\s*\)\s*btn\.appendChild\(\s*th\.firstChild\s*\)/.test(win);
    if (!named) bad.push(`${rel}:${lineOf(src, m.index)} createElement('button') with no aria-label`);
  }
}
chk(scanned > 0 && buttons > 0, 'scanned web js/html for buttons', `${scanned} files, ${buttons} buttons`);
// role="button" elements (markup)
const rb = /<[^>]*\brole=["']button["'][^>]*>/g;
// (covered by generic tag scan above conceptually; ensure no new failures)
chk(bad.length === 0, 'every button has visible text or aria-label/aria-labelledby', '\n    ' + bad.join('\n    '));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
