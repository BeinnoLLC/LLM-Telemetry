// Generic a11y lint: every button-like control in src/llm_telemetry/web must
// expose an accessible name. LLMTELEMET-327 (docs/design-audit.md §10 item 22,
// DESIGN.md HARD RULE 7).
//
// Controls scanned:
//   * <button>...</button> markup
//   * createElement('button') assignments
//   * role="button" markup, X.setAttribute('role','button'), X.role = 'button'
//   * <input type="button|submit|reset">
//
// A control passes when it has visible text, or aria-label/aria-labelledby.
// `title` alone does NOT count: it is not announced reliably and is absent on
// touch. `data-aria-label` does NOT count either: it is not an ARIA attribute.
// aria-label="" is not a name.
//
// Visible text is judged on VALUES, not identifiers. After dropping <svg>,
// aria-hidden subtrees, tags and entities, raw text counts when it contains a
// letter or digit. A template expression counts as glyph-only ONLY when
// everything it can emit is a string literal made of non-alphanumeric
// characters — ${'\u25B8'}, ${'\u25BE'}, ${cond ? '\u25B2' : '\u25BC'} —
// with escape sequences decoded first. Expressions of variables and calls
// (${arrowGlyph}, ${esc(label)}) count as text even when the identifier says
// "glyph" or "arrow".
//
// For createElement('button') and JS role=button targets the variable must be
// named close by (about 15 lines): aria-label/ariaLabel set on that variable,
// text assigned or read via .textContent/.innerText/.innerHTML (literal
// assignments go through visibleText, so glyph-only innerHTML is not a name),
// header text moved in via X.appendChild(Y.firstChild) or
// X.appendChild(document.createTextNode(...)), or the element coming from
// querySelector(All) of a template element whose body has visible text. An
// UNRELATED th.firstChild call — one appending into some other element —
// never names the created button.
//
// The scan core is pure: scanButtons(src), scanRoleButtons(src) and
// scanSource(src) take a source string and return { findings, stats }. The
// real scan at the bottom feeds src/llm_telemetry/web through the same
// functions that the in-file negative/positive fixtures exercise.
//
// Usage: node tests/check_icon_button_aria.js [--quiet]
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// pure helpers (no I/O)
// ---------------------------------------------------------------------------
const lineOf = (s, i) => s.slice(0, i).split('\n').length;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

/** decode \uXXXX, \xXX and simple escapes inside a raw string-literal body */
function decodeEscapes(s) {
  return s.replace(/\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\([\s\S])/g,
    (m, braced, u4, x2, ch) => braced ? String.fromCodePoint(parseInt(braced, 16))
      : u4 ? String.fromCharCode(parseInt(u4, 16))
      : x2 ? String.fromCharCode(parseInt(x2, 16))
      : ({ n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"', '`': '`' }[ch] ?? ch));
}

/** the decoded value of a single string literal, or null if s is not one */
function strLiteralValue(s) {
  s = s.trim();
  if (s.length < 2) return null;
  const q = s[0];
  if (q !== '"' && q !== "'" && q !== '`') return null;
  if (s[s.length - 1] !== q) return null;
  const body = s.slice(1, -1);
  if (q === '`' && body.includes('${')) return null; // interpolated template: dynamic
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { i++; continue; }
    if (body[i] === q) return null; // unescaped quote in the middle: not one literal
  }
  return decodeEscapes(body);
}

/** split on a top-level operator character (outside strings and brackets) */
function splitTop(s, ch) {
  const parts = [];
  let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\') { cur += s[++i] || ''; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    if (depth === 0 && c === ch && s[i - 1] !== ch && s[i + 1] !== ch) {
      parts.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

function balancedOuter(s) {
  let depth = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth < 0) return false; }
  }
  return depth === 0;
}

/** split `cond ? then : other` at the top level, or null if there is no ternary */
function splitTernary(s) {
  let depth = 0, q = null, qi = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '?' && s[i + 1] !== '?' && s[i + 1] !== '.') { qi = i; break; }
  }
  if (qi < 0) return null;
  let pending = 0;
  q = null;
  for (let i = qi + 1; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && c === '?' && s[i + 1] !== '?' && s[i + 1] !== '.') pending++;
    else if (depth === 0 && c === ':') {
      if (pending === 0) return { then: s.slice(qi + 1, i), other: s.slice(i + 1) };
      pending--;
    }
  }
  return null;
}

/**
 * True when EVERY value this expression can emit is a string literal made
 * only of non-alphanumeric characters (glyph-only). Decides on literal values:
 * ${'\u25B8'} and ${cond ? '\u25B8' : '\u25BE'} are glyph-only; expressions
 * of variables and calls (${arrowGlyph}, ${esc(x)}) are text.
 */
function exprIsGlyphOnly(inner) {
  let s = inner.trim();
  if (!s) return false;
  for (;;) {
    if (s[0] === '(' && s[s.length - 1] === ')' && balancedOuter(s.slice(1, -1))) {
      s = s.slice(1, -1).trim();
    } else break;
  }
  const t = splitTernary(s);
  if (t) return exprIsGlyphOnly(t.then) && exprIsGlyphOnly(t.other);
  const parts = splitTop(s, '+');
  if (parts.length > 1) return parts.every(exprIsGlyphOnly);
  const v = strLiteralValue(s);
  return v !== null && !/[A-Za-z0-9]/.test(v);
}

/** split visible text into its literal part and its ${...} expression sources */
function splitExprs(t) {
  const exprs = [];
  let literal = '', i = 0;
  while (i < t.length) {
    const j = t.indexOf('${', i);
    if (j < 0) { literal += t.slice(i); break; }
    literal += t.slice(i, j);
    let depth = 1, k = j + 2, q = null;
    while (k < t.length && depth > 0) {
      const c = t[k];
      if (q) { if (c === '\\') k++; else if (c === q) q = null; }
      else if (c === '"' || c === "'" || c === '`') q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    if (depth > 0) { literal += t.slice(j); break; }
    exprs.push(t.slice(j + 2, k - 1));
    i = k;
  }
  return { literal, exprs };
}

/** does this element body render visible text (letters/digits), not just glyphs? */
function visibleText(body) {
  const t = body
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<(\w+)\b[^>]*\baria-hidden=["']true["'][^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&#?\w+;/g, '');
  const { literal, exprs } = splitExprs(t);
  if (/[A-Za-z0-9]/.test(literal)) return true;
  // no alphanumeric literal text: every expression must be glyph-only for the
  // body to count as "no visible text"
  return !exprs.every(exprIsGlyphOnly);
}

const NAME_RE = /(?:^|\s)aria-label(ledby)?\s*=\s*(['"])(.*?)\2/;
/** aria-label / aria-labelledby with a non-empty value (data-aria-label does not count) */
function hasName(attrs) {
  const m = NAME_RE.exec(attrs);
  return !!m && m[3].trim() !== '';
}
/** input buttons may also take their name from a non-empty value attribute */
function hasInputName(attrs) {
  if (hasName(attrs)) return true;
  const m = /(?:^|\s)value\s*=\s*(['"])(.*?)\1/.exec(attrs);
  return !!m && m[2].trim() !== '';
}

// --- JS element naming evidence (window around the statement) --------------
function jsNameEvidence(win, v) {
  return new RegExp('\\b' + escRe(v) + "\\.(?:setAttribute\\(\\s*['\"]aria-label(?:edby)?['\"]|ariaLabel\\s*=)").test(win);
}

/** text assigned or read on the variable; literal assignments go through visibleText */
function jsTextEvidence(win, v) {
  const re = new RegExp('\\b' + escRe(v) + '\\.(?:textContent|innerText|innerHTML)(\\s*=\\s*([^;\\n]+))?', 'g');
  let m;
  while ((m = re.exec(win))) {
    if (m[1] === undefined) return true; // read: the element carries text content
    const rhs = m[2].trim();
    const lit = strLiteralValue(rhs);
    if (lit === null) return true; // dynamic value
    if (visibleText(lit)) return true;
    // glyph-only assigned content is not a name; keep scanning
  }
  return false;
}

/** header text (or a text node) moved INTO this element */
function jsChildTextEvidence(win, v) {
  return new RegExp('\\b' + escRe(v) + '\\.(?:appendChild|append)\\(\\s*(?:[\\w$]+\\.(?:firstChild|firstElementChild)|document\\.createTextNode\\()')
    .test(win);
}

/** the element comes from querySelector(All) of a template element with visible text */
function jsTemplateTextEvidence(win, src, v) {
  const q = escRe(v);
  const eachRe = new RegExp("querySelector(?:All)?\\(\\s*(['\"])([^'\"]+)\\1\\s*\\)\\s*\\.(?:forEach|map)\\(\\s*\\(?\\s*\\b" + q + '\\b');
  const asgRe = new RegExp('\\b' + q + "\\s*=\\s*[^;\\n]*?querySelector(?:All)?\\(\\s*(['\"])([^'\"]+)\\1\\s*\\)");
  const m = eachRe.exec(win) || asgRe.exec(win);
  return !!m && templateSelectorHasText(src, m[2]);
}

function templateSelectorHasText(src, selector) {
  for (const tok of selector.matchAll(/[#.]([\w-]+)/g)) {
    const name = escRe(tok[1]);
    const byClass = new RegExp('<(\\w+)\\b[^>]*class=[\'"][^\'"]*\\b' + name + '\\b[^\'"]*[\'"][^>]*>');
    const byId = new RegExp('<(\\w+)\\b[^>]*id=[\'"]' + name + '[\'"][^>]*>');
    const m = byClass.exec(src) || byId.exec(src);
    if (!m) continue;
    const end = tagEnd(src, m.index);
    if (end < 0) continue;
    const close = src.indexOf('</' + m[1] + '>', end);
    const body = close < 0 ? '' : src.slice(end + 1, close);
    if (visibleText(body)) return true;
  }
  return false;
}

function jsElementNamed(win, src, v) {
  return jsNameEvidence(win, v) || jsTextEvidence(win, v) ||
    jsChildTextEvidence(win, v) || jsTemplateTextEvidence(win, src, v);
}

// ---------------------------------------------------------------------------
// pure scanners: source string in, findings out
// ---------------------------------------------------------------------------
// finding: { line, kind: 'button'|'createElement'|'role-markup'|'role-js'|'input', detail }

function scanButtons(src) {
  const findings = [];
  let m;
  const reBtn = /<button\b/g;
  while ((m = reBtn.exec(src))) {
    const end = tagEnd(src, m.index + 7);
    if (end < 0) continue;
    const attrs = src.slice(m.index + 7, end);
    const close = src.indexOf('</button>', end);
    const body = close < 0 ? '' : src.slice(end + 1, close);
    if (!hasName(attrs) && !visibleText(body)) {
      findings.push({
        line: lineOf(src, m.index), kind: 'button',
        detail: `<button${attrs.slice(0, 56).replace(/\s+/g, ' ')}>`,
      });
    }
  }
  const reCe = /\b([\w$]+)\s*=\s*(?:[\w$]+\.)*createElement\(\s*['"]button['"]\s*\)/g;
  while ((m = reCe.exec(src))) {
    const v = m[1];
    const line = lineOf(src, m.index);
    const win = src.split('\n').slice(Math.max(0, line - 13), line + 12).join('\n');
    if (!jsElementNamed(win, src, v)) {
      findings.push({ line, kind: 'createElement', detail: `createElement('button') -> ${v}, no accessible name` });
    }
  }
  return findings;
}

function scanRoleButtons(src) {
  const findings = [];
  let m;
  // 1. role="button" in markup (tag-based, so CSS selectors like [role="button"] never match)
  const reTag = /<([A-Za-z][\w-]*)\b/g;
  while ((m = reTag.exec(src))) {
    const end = tagEnd(src, m.index + 1 + m[1].length);
    if (end < 0) continue;
    const attrs = src.slice(m.index + 1 + m[1].length, end);
    if (!/\brole\s*=\s*['"]button['"]/.test(attrs)) continue;
    const tag = m[1];
    const voidTag = /^(input|img|br|hr)$/.test(tag);
    const close = voidTag ? -1 : src.indexOf('</' + tag + '>', end);
    const body = close < 0 ? '' : src.slice(end + 1, close);
    const named = voidTag ? hasInputName(attrs) : (hasName(attrs) || visibleText(body));
    if (!named) {
      findings.push({
        line: lineOf(src, m.index), kind: 'role-markup',
        detail: `<${tag}${attrs.slice(0, 48).replace(/\s+/g, ' ')}>`,
      });
    }
  }
  // 2. JS role=button: X.setAttribute('role','button') and X.role = 'button'
  const reSet = /\b([\w$][\w$.[\]()]*)\.setAttribute\(\s*['"]role['"]\s*,\s*['"]button['"]\s*\)/g;
  const reAsn = /\b([\w$][\w$.[\]()]*)\.role\s*=\s*['"]button['"]/g;
  for (const re of [reSet, reAsn]) {
    re.lastIndex = 0;
    while ((m = re.exec(src))) {
      const v = m[1].split(/[.[\]]/)[0];
      const line = lineOf(src, m.index);
      const win = src.split('\n').slice(Math.max(0, line - 13), line + 12).join('\n');
      if (!jsElementNamed(win, src, v)) {
        findings.push({ line, kind: 'role-js', detail: `${m[1]} role=button, no accessible name` });
      }
    }
  }
  // 3. <input type="button|submit|reset">
  const reInput = /<input\b/g;
  while ((m = reInput.exec(src))) {
    const end = tagEnd(src, m.index + 6);
    if (end < 0) continue;
    const attrs = src.slice(m.index + 6, end);
    if (!/\btype\s*=\s*['"]?(?:button|submit|reset)\b/.test(attrs)) continue;
    if (!hasInputName(attrs)) {
      findings.push({
        line: lineOf(src, m.index), kind: 'input',
        detail: `<input${attrs.slice(0, 48).replace(/\s+/g, ' ')}>`,
      });
    }
  }
  return findings;
}

function scanSource(src, label = 'source') {
  const findings = [
    ...scanButtons(src).map((f) => ({ ...f, where: label })),
    ...scanRoleButtons(src).map((f) => ({ ...f, where: label })),
  ];
  const stats = {
    buttons: (src.match(/<button\b/g) || []).length,
    createButtons: (src.match(/createElement\(\s*['"]button['"]\s*\)/g) || []).length,
    roleMarkup: findings.filter(() => false).length, // counted below from scans
    roleJs: (src.match(/\.setAttribute\(\s*['"]role['"]\s*,\s*['"]button['"]\s*\)|\b[\w$.[\]()]+\.role\s*=\s*['"]button['"]/g) || []).length,
    inputs: (src.match(/<input\b[^>]*\btype\s*=\s*['"]?(?:button|submit|reset)\b/g) || []).length,
  };
  stats.roleMarkup = (src.match(/<[^>]*\brole\s*=\s*['"]button['"][^>]*>/g) || []).length;
  return { findings, stats };
}

module.exports = { scanButtons, scanRoleButtons, scanSource, visibleText, hasName, exprIsGlyphOnly };

// ---------------------------------------------------------------------------
// in-file fixtures (exercised through the SAME pure functions as the real scan)
// ---------------------------------------------------------------------------
// Negative fixtures: each MUST be flagged, by the kind of scanner that owns it.
const FIXTURES_BAD = [
  ['data-aria-label only (not an ARIA attribute)', 'button',
    '<button class="icon-btn" data-aria-label="Close"></button>'],
  ['empty aria-label is not a name', 'button',
    '<button class="icon-btn" aria-label=""></button>'],
  ['glyph-only template body (value-based: \\u25B8 literal)', 'button',
    '<button type="button" class="sesstree-toggle">${\'\\u25B8\'}</button>'],
  ['glyph-only raw text body', 'button',
    '<button type="button" class="sep">\u25BE</button>'],
  ['createElement button with an unrelated th.firstChild call', 'createElement', [
    'function sortHeader(th){',
    "  const el = document.createElement('button');",
    "  el.className = 'dt-sort';",
    '  while (th.firstChild) btn.appendChild(th.firstChild); // appends into btn, not el',
    '  th.appendChild(el);',
    '}',
  ].join('\n')],
  ['role=button div with a glyph only', 'role-markup',
    '<div role="button" class="pd-close">${\'\\u25BE\'}</div>'],
  ['setAttribute role=button with glyph-only innerHTML', 'role-js', [
    'function render(box){',
    "  const el = document.createElement('div');",
    "  el.className = 'disc';",
    '  el.innerHTML = \'<span aria-hidden="true">\\u25B8</span>\';',
    "  el.setAttribute('role', 'button');",
    '  box.appendChild(el);',
    '}',
  ].join('\n')],
  ['X.role = button with empty textContent', 'role-js', [
    "el.role = 'button';",
    "el.textContent = '';",
  ].join('\n')],
  ['input type=submit with no name', 'input',
    '<input type="submit">'],
];

// Positive fixtures: each MUST pass.
const FIXTURES_GOOD = [
  ['aria-label on an icon-only button',
    '<button class="icon-btn" aria-label="Close"><svg viewBox="0 0 16 16"><path d="M2 2l12 12"/></svg></button>'],
  ['dynamic text body',
    '<button type="button" class="chip">${esc(label)}</button>'],
  ['expression of a VARIABLE counts as text even when its name says glyph/arrow',
    '<button type="button" class="toggle">${arrowGlyph}</button>'],
  ['aria-labelled glyph toggle (views.js sesstree pattern)',
    '<button type="button" class="sesstree-toggle" aria-expanded="false" aria-label="${collapsed ? \'Expand\' : \'Collapse\'} children">${collapsed ? \'\\u25B8\' : \'\\u25BE\'}</button>'],
  ['sort-arrow glyph beside a variable label (views.js dt-sort pattern)',
    '<button type="button" class="dt-sort" data-fsort="x">${l}<span class="dt-ar" aria-hidden="true">${st === \'ascending\' ? \'\\u25B2\' : st === \'descending\' ? \'\\u25BC\' : \'\\u2195\'}</span></button>'],
  ['createElement button that moves the header text in (table.js pattern)', [
    'function sortHeader(th, label){',
    "  const btn = document.createElement('button');",
    "  btn.type = 'button';",
    '  while (th.firstChild) btn.appendChild(th.firstChild);',
    '  btn.addEventListener(\'click\', () => sortBy(label));',
    '}',
  ].join('\n')],
  ['createElement button with aria-label (flow.js pattern)', [
    'function trainBall(it){',
    "  const c = document.createElement('button');",
    "  c.className = 'qt-ball';",
    "  c.setAttribute('type', 'button');",
    "  c.setAttribute('aria-label', 'Task (queue item)');",
    '  return c;',
    '}',
  ].join('\n')],
  ['setAttribute role=button with dynamic textContent', [
    'function render(box, title){',
    "  const el = document.createElement('div');",
    "  el.setAttribute('role', 'button');",
    '  el.textContent = title;',
    '  box.appendChild(el);',
    '}',
  ].join('\n')],
  ['setAttribute role=button on a template cell with text (views.js:1596 pattern)', [
    'function matrix(table, wl, v){',
    '  table.innerHTML = `<tbody><tr><td class="text-right proj-cell" data-project="p">${wl.fmt(v)}</td></tr></tbody>`;',
    "  table.querySelectorAll('.proj-cell').forEach(td => {",
    '    td.tabIndex = 0;',
    "    td.setAttribute('role', 'button');",
    '  });',
    '}',
  ].join('\n')],
  ['setAttribute role=button on a cell that carries textContent (views.js:1607 pattern)', [
    "table.querySelectorAll('tbody tr').forEach(tr => {",
    '  const labelCell = tr.firstElementChild;',
    '  const proj = labelCell.textContent;',
    "  labelCell.setAttribute('role', 'button');",
    '  labelCell.onclick = () => open(proj);',
    '});',
  ].join('\n')],
  ['markup role=button with text', '<td class="proj-cell" role="button">${esc(name)}</td>'],
  ['X.role = button with visible text', [
    "el.role = 'button';",
    'el.appendChild(document.createTextNode(title));',
  ].join('\n')],
  ['input buttons named by value or aria-label',
    '<input type="submit" value="Save"><input type="reset" aria-label="Reset the form">'],
];

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
if (require.main === module) {
  const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
  const quiet = process.argv.includes('--quiet');
  let pass = 0, fail = 0;
  const chk = (ok, name, got) => {
    if (ok) { pass++; if (!quiet) console.log(`  ok  ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
  };

  // ---- real scan of src/llm_telemetry/web (same functions as the fixtures) ----
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(p, out); }
      else if (/\.(js|html)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  const bad = [];
  const totals = { buttons: 0, createButtons: 0, roleMarkup: 0, roleJs: 0, inputs: 0 };
  let scanned = 0;
  for (const file of walk(WEB)) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(path.join(__dirname, '..'), file);
    scanned++;
    const { findings, stats } = scanSource(src, rel);
    for (const k of Object.keys(totals)) totals[k] += stats[k];
    for (const f of findings) bad.push(`${f.where}:${f.line} [${f.kind}] ${f.detail}`);
  }
  chk(scanned > 0 && totals.buttons > 0 && totals.createButtons > 0, 'scanned web js/html for button controls',
    `${scanned} files, ${totals.buttons} <button>, ${totals.createButtons} createElement('button'), ` +
    `${totals.roleMarkup} role=button markup, ${totals.roleJs} JS role=button, ${totals.inputs} input buttons`);
  chk(bad.length === 0, 'every button-like control has visible text or aria-label/aria-labelledby',
    '\n    ' + bad.join('\n    '));

  // ---- the two proj-matrix cell sites (views.js:1596/1607) actually scanned and passing ----
  const viewsSrc = fs.readFileSync(path.join(WEB, 'js', 'views.js'), 'utf8');
  const vr = scanSource(viewsSrc, 'views.js');
  chk(vr.stats.roleJs >= 2, 'views.js JS role=button sites (proj-matrix cells at 1596/1607) were actually scanned',
    `found ${vr.stats.roleJs}`);
  chk(vr.findings.length === 0, 'views.js:1596/1607 pass: the cells carry text content',
    '\n    ' + vr.findings.map((f) => `${f.line} [${f.kind}] ${f.detail}`).join('\n    '));

  // ---- fixtures ----
  for (const [name, kind, fixture] of FIXTURES_BAD) {
    const r = scanSource(fixture, name);
    chk(r.findings.some((f) => f.kind === kind), `negative fixture flagged (${kind}): ${name}`,
      r.findings.length ? r.findings.map((f) => `line ${f.line} [${f.kind}] ${f.detail}`).join('; ') : 'no findings');
  }
  for (const [name, fixture] of FIXTURES_GOOD) {
    const r = scanSource(fixture, name);
    chk(r.findings.length === 0, `positive fixture passes: ${name}`,
      r.findings.map((f) => `line ${f.line} [${f.kind}] ${f.detail}`).join('; '));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
