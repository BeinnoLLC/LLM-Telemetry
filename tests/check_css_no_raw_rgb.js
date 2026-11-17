// LLMTELEMET-311 guard: dashboard.css must not carry raw rgb()/rgba()/hsl()/hsla()
// colour literals. Every colour there is a var(--token), a color-mix() of tokens,
// or transparent; the literals live in tokens.css (the sole owner).
// Exemptions:
//   * comments (any colour mentioned in prose)
//   * tooltip rules (.qtip*, .flowtip*) — owned by LLMTELEMET-312
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css');
const RAW = /\b(?:rgb|rgba|hsl|hsla)\s*\(/gi;
const TOOLTIP = /^\s*[.#][\w-]*(?:qtip|flowtip)\b/;

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

// Blank out comments so prose colour mentions don't count, keeping line numbers.
const src = fs.readFileSync(CSS, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\\n]/g, ' '));

// Walk braces; a declaration block is exempt only when every selector on its
// head is a tooltip selector. At-rule wrappers (@media, @supports...) carry no
// declarations themselves, so their heads never exempt anything.
const lines = src.split('\n');
const violations = [];
const exemptHits = [];
let head = '';
let depth = 0;
let skipDepth = -1; // depth at which an exempt tooltip block started
let inExemptBlock = false;
const heads = [];

for (let i = 0; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') {
      depth++;
      if (skipDepth < 0) {
        const sels = head.split(',').map(s => s.trim()).filter(Boolean);
        const isTooltip = sels.length > 0 && sels.every(s => TOOLTIP.test(s));
        if (isTooltip) {
          skipDepth = depth;
          inExemptBlock = true;
        }
        heads.push(isTooltip);
      } else {
        heads.push(true);
      }
      head = '';
    } else if (ch === '}') {
      heads.pop();
      // Only clear exemption when we've actually exited the exempt block (depth < skipDepth)
      if (skipDepth >= 0 && depth < skipDepth) {
        skipDepth = -1;
        inExemptBlock = false;
      }
      depth = Math.max(0, depth - 1);
      head = '';
    } else {
      head += ch;
    }
  }
  head += '\n';
  RAW.lastIndex = 0;
  const hits = [];
  let m;
  while ((m = RAW.exec(lines[i]))) hits.push(m[0].replace(/\s*\(/, '('));
  if (!hits.length) continue;
  if (!inExemptBlock) {
    violations.push({ line: i + 1, hits, text: lines[i].trim().slice(0, 100) });
  } else {
    exemptHits.push({ line: i + 1, hits });
  }
}

chk(violations.length === 0, `no raw rgb()/hsl() outside comments and tooltip rules (${violations.length} found)`);
for (const v of violations) console.log(`      ${v.line}: ${v.hits.join(', ')}  ${v.text}`);

// Positive control: the scanner must still SEE the exempt tooltip literals —
// proves the exemption is scoped to .qtip/.flowtip blocks, not a blanket pass.
chk(exemptHits.length > 0, `tooltip rules keep their LLMTELEMET-312 literals, exempt (${exemptHits.map(e => e.line).join(', ')})`);

if (require.main === module) process.exit(fail ? 1 : 0);
