// LLMTELEMET-321 guard: border-radius raw values live in tokens.css only.
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const FILES = ['dashboard.css','hive.css','utilities.css'];
const ALLOWED_RAW = new Set(['0','0 0 30px 30px']);

function blankComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
}

function isAllowed(val){
  const v = val.trim();
  if (v === '') return true;
  if (ALLOWED_RAW.has(v)) return true;
  if (v.includes('calc(') || v.includes('var(')) return true;
  // disallow any raw px or percent numbers
  if (/\d/.test(v) && !v.includes('calc(') && !v.includes('var(')) return false;
  return true;
}

let failed = 0;
for (const f of FILES){
  const src = blankComments(fs.readFileSync(path.join(CSS_DIR, f), 'utf8'));
  const re = /border-radius\s*:\s*([^;}]*)/g;
  let m;
  while ((m = re.exec(src)) !== null){
    const val = m[1].trim();
    if (!isAllowed(val)){
      console.log('FAIL', f, 'border-radius:', val);
      failed++;
    }
  }
}

// tokens.css defines the radius tokens
const tokens = fs.readFileSync(path.join(CSS_DIR, 'tokens.css'), 'utf8');
const expected = {
  '--radius-sm': '4px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--radius-pill': '999px',
  '--radius-full': '50%'
};
for (const [k,v] of Object.entries(expected)){
  const re = new RegExp(k + '\\s*:\\s*' + v.replace(/%/,'\\%'));
  if (!re.test(tokens)){
    console.log('FAIL tokens.css missing', k, v);
    failed++;
  }
}

console.log(failed === 0 ? '0 failed' : failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
