const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

const files = [];
function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f);const st=fs.statSync(p);if(st.isDirectory())walk(p);else if(/\.(css|js)$/.test(f))files.push(p);}}
walk(root);

const bad = [];
for (const f of files) {
  if (f.endsWith('tokens.css')) continue;
  const src = fs.readFileSync(f, 'utf8');
  if (/ui-monospace|SFMono-Regular|Menlo,monospace/.test(src)) bad.push(path.relative(root, f));
}
chk(bad.length === 0, 'no monospace stack outside tokens.css', bad.join(','));

console.log(`\ncheck_mono_token.js  ${pass} passed, ${fail} failed`);
