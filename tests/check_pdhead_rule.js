// Guard (LLMTELEMET-311 review): the .pdhead flex rule once vanished in a CSS
// refactor, breaking the product drawer header. Built html and source css must keep it.
const fs = require('fs');
const path = require('path');
let fail = 0;
const chk = (ok, name) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail++; };
const root = path.join(__dirname, '..');
const has = t => /\.pdhead\s*\{[^}]*display\s*:\s*flex/.test(t);
const css = fs.readFileSync(path.join(root, 'src/llm_telemetry/web/css/dashboard.css'), 'utf8');
chk(has(css), 'dashboard.css has .pdhead{display:flex}');
const htmlPath = path.join(root, 'examples/reports/dashboard.html');
if (fs.existsSync(htmlPath)) chk(has(fs.readFileSync(htmlPath, 'utf8')), 'built dashboard.html has .pdhead{display:flex}');
console.log(`${fail ? 'FAIL' : 'ok'}`);
process.exit(fail ? 1 : 0);
