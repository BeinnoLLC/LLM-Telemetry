// LLMTELEMET-320 guard: spacing scale lives in tokens.css only.
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const TOKENS = path.join(CSS_DIR, 'tokens.css');
const SP_PROPS = new Set(['padding','margin','gap','row-gap','column-gap']);
const SP_SUFFIXES = new Set(['top','right','bottom','left','inline','block','inline-start','inline-end','block-start','block-end']);
const SP_VALS = new Set(['4','8','12','16','20','24']);

function isSpacingProp(prop){
  const p = prop.trim().toLowerCase();
  if (SP_PROPS.has(p)) return true;
  for (const base of ['padding-','margin-']){
    if (p.startsWith(base)){
      const suf = p.slice(base.length);
      if (SP_SUFFIXES.has(suf)) return true;
    }
  }
  return false;
}

function blankComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function countRawSpacing(val){
  let count = 0;
  let i = 0, depth = 0, n = val.length;
  while (i < n){
    const ch = val[i];
    if (ch === '('){ depth++; i++; continue; }
    if (ch === ')'){ depth = Math.max(0,depth-1); i++; continue; }
    if (depth === 0){
      const m = val.slice(i).match(/^(\d+)px/);
      if (m){
        const num = m[1];
        const prev = i>0 ? val[i-1] : '';
        const afterIdx = i + m[0].length;
        const after = afterIdx < n ? val[afterIdx] : '';
        const prevBad = (prev === '-' || prev === '.' || prev === ',' || /\d/.test(prev) || prev === '(');
        const afterBad = /[a-zA-Z0-9%]/.test(after);
        if (SP_VALS.has(num) && !prevBad && !afterBad){
          count++;
        }
        i += m[0].length;
        continue;
      }
    }
    i++;
  }
  return count;
}

function findDeclarations(src){
  const decls = [];
  let i = 0, n = src.length;
  while (i < n){
    const colon = src.indexOf(':', i);
    if (colon === -1){ i = n; break; }
    let j = colon - 1;
    while (j >= i && /[a-zA-Z0-9_-]/.test(src[j])) j--;
    const prop = src.slice(j+1, colon).trim();
    const prev = j >= 0 ? src[j] : '';
    let startProp = j;
    while (startProp >= 0 && src[startProp] !== '{' && src[startProp] !== ';') startProp--;
    const between = src.slice(startProp+1, colon);
    const plainProp = /^\s*[a-zA-Z_-][a-zA-Z0-9_-]*\s*$/.test(between);
    let k = colon + 1;
    while (k < n && /\s/.test(src[k])) k++;
    let depth = 0;
    const startVal = k;
    while (k < n){
      const c = src[k];
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0,depth-1);
      else if (depth === 0 && (c === ';' || c === '}' || c === '{')) break;
      k++;
    }
    const val = src.slice(startVal, k);
    if (prop && plainProp){
      decls.push({prop, val});
    }
    i = k > i ? k : colon + 1;
    if (i < n && (src[i] === ';' || src[i] === '}' || src[i] === '{')) i++;
  }
  return decls;
}

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok){ pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

const selfCases = [
  ['.x:hover{padding:8px}', 1],
  ['.a{margin:0 0 4px}', 1],
  ['.a{padding:var(--sp-2,8px)}', 0],
  ['.a{margin:-8px}', 0],
  ['.a{line-height:8px}', 0],
  ['@media (max-width:800px){.a{gap:12px}}', 1],
  ['.a{padding:8px 10px;gap:16px}', 2],
];
for (const [css, expected] of selfCases){
  try {
    const decls = findDeclarations(css);
    let total = 0;
    for (const d of decls){
      if (!isSpacingProp(d.prop)) continue;
      total += countRawSpacing(d.val);
    }
    const ok = total === expected;
    if (ok){ pass++; console.log(`  ok  self-test: ${css} counts ${total}`); }
    else { fail++; console.log(`  FAIL self-test: ${css} counts ${total} (expected ${expected})`); }
  } catch (e){
    fail++; console.log(`  FAIL self-test: ${css} threw ${e.message}`);
  }
}

const files = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css')).sort();

let tokenViolations = [];
for (const f of files){
  if (f === 'tokens.css') continue;
  const src = blankComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  const re = /--sp-[1-8]\s*:/g;
  const m = src.match(re);
  if (m && m.length){
    tokenViolations.push(`${f}: ${m.length}`);
  }
}
chk(tokenViolations.length === 0, `only tokens.css declares --sp-1..--sp-8 (${tokenViolations.join(', ') || 'none elsewhere'})`);

const targets = ['dashboard.css','hive.css','utilities.css'];
for (const f of targets){
  const src = blankComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  const decls = findDeclarations(src);
  let total = 0;
  for (const d of decls){
    if (!isSpacingProp(d.prop)) continue;
    total += countRawSpacing(d.val);
  }
  chk(total === 0, `${f}: 0 raw spacing px (found ${total})`);
}

const tokensSrc = fs.readFileSync(TOKENS, 'utf8');
const declared = (tokensSrc.match(/--sp-[1-8]\s*:/g) || []).length;
chk(declared >= 6, `tokens.css declares --sp-1..--sp-8 (${declared})`);

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
