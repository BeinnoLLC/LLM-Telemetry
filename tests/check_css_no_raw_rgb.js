// LLMTELEMET-311 guard: dashboard.css must not carry raw rgb()/rgba()/hsl()/hsla()
// colour literals. Every colour there is a var(--token), a color-mix() of tokens,
// or transparent; the literals live in tokens.css (the sole owner).
// Exemptions:
//   * comments (any colour mentioned in prose)
//   * tooltip rules (.qtip*, .flowtip*) — exemption kept only as a scoped safety net (LLMTELEMET-312 Done, LLMTELEMET-322 tokenised)
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css');
const RAW = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;
// Exactly .qtip / .flowtip (not .foo-qtip, .qtip-x), optionally with attribute /
// pseudo / class suffixes on the same element: no whitespace or combinator after it.
const TOOLTIP_HEAD = /^\.(qtip|flowtip)(?![\w-])/;
const TOOLTIP = {test: s => { s = s.trim(); return TOOLTIP_HEAD.test(s) && !/[\s>+~]/.test(s.replace(/\[[^\]]*\]/g, '')); }};

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

// Blank out comments so prose colour mentions don't count. Newlines are kept
// ([^\n], not every char) so reported line numbers still match the real file.
const src = fs.readFileSync(CSS, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

// Collect every raw colour literal with its exact character offset. A hit is
// exempt only when its own position sits inside a declaration block whose every
// selector is a tooltip selector. At-rule wrappers (@media, @supports...) carry
// no declarations themselves, so their heads never exempt anything.
const hits = [...src.matchAll(RAW)].map(m => ({ idx: m.index, hit: m[0].replace(/\s*\(/, '(') }));
const lineOf = idx => {
  let line = 1;
  for (let i = 0; i < idx; i++) if (src[i] === '\n') line++;
  return line;
};
const lines = src.split('\n');

// Walk braces. The exemption is armed at a tooltip block's '{' and cleared at
// that same block's '}' (depth == skipDepth), so following sibling rules are
// never swept into it; nested blocks inside the tooltip rule stay exempt.
const violations = [];
const exemptHits = [];
let head = '';
let depth = 0;
let skipDepth = -1; // depth at which the innermost exempt tooltip block started
let hi = 0;

for (let i = 0; i < src.length; i++) {
  // Attribute any literal starting exactly here the block state at its position.
  while (hi < hits.length && hits[hi].idx === i) {
    const rec = { line: lineOf(i), hits: [hits[hi].hit], text: (lines[lineOf(i) - 1] || '').trim().slice(0, 100) };
    if (skipDepth >= 0) exemptHits.push({ line: rec.line, hits: rec.hits });
    else violations.push(rec);
    hi++;
  }
  const ch = src[i];
  if (ch === '{') {
    depth++;
    if (skipDepth < 0) {
      const sels = head.split(',').map(s => s.trim()).filter(Boolean);
      if (sels.length > 0 && sels.every(s => TOOLTIP.test(s))) skipDepth = depth;
    }
    head = '';
  } else if (ch === '}') {
    if (skipDepth >= 0 && depth <= skipDepth) skipDepth = -1;
    depth = Math.max(0, depth - 1);
    head = '';
  } else {
    head += ch;
  }
}

chk(violations.length === 0, `no raw rgb()/hsl() outside comments and tooltip rules (${violations.length} found)`);
for (const v of violations) console.log(`      ${v.line}: ${v.hits.join(', ')}  ${v.text}`);

// LLMTELEMET-322 tokenised the tooltip shadows to var(--elev-3): no exempt
// literals should remain, proving the exemption is a scoped safety net.
chk(exemptHits.length === 0, `tooltip rules carry no raw literals, shadows use --elev-3 per LLMTELEMET-322 (${exemptHits.map(e => e.line).join(', ')})`);

// Negative controls for the selector exemption itself.
chk(TOOLTIP.test('.qtip') && TOOLTIP.test('.flowtip.on') && TOOLTIP.test('.qtip[data-side=top]::before'), 'exempt: .qtip, .flowtip.on, .qtip[data-side]::before');
chk(!TOOLTIP.test('.foo-qtip'), 'not exempt: .foo-qtip');
chk(!TOOLTIP.test('.qtip ~ main .card'), 'not exempt: .qtip ~ main .card');
chk(!TOOLTIP.test('.qtip .card') && !TOOLTIP.test('.qtip>.card') && !TOOLTIP.test('.qtip-x'), 'not exempt: descendant/child/.qtip-x');

console.log(`${pass} passed, ${fail} failed`);
if (require.main === module) process.exit(fail ? 1 : 0);
