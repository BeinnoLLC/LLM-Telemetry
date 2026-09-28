// Ollama Cloud rows must never render with the LOCAL provider badge.
// Repro for #118 (display side): real ollama-cloud live rows carry
// provider=null + base_url=https://ollama.com/v1, and provOf()'s old terminal
// `return 'local'` put a LOCAL badge on them. Also: ':cloud' SKUs must beat
// LOCAL_RE name hints, and unidentified endpoints must default remote.
// Runs against the BUILT dashboard so the shipped page itself is asserted.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; }
  else { fail++; console.log(`FAIL ${name}${got !== undefined ? ' got: ' + got : ''}`); }
}
function grab(start, end) {
  const i = html.indexOf(start);
  if (i < 0) throw new Error('marker missing: ' + start);
  const j = html.indexOf(end, i);
  if (j < 0) throw new Error('end missing for: ' + start);
  return html.slice(i, j + end.length);
}

// pull the shipped pieces verbatim out of the page
const provTable = grab('const PROV = {', '};');
const localRe   = grab('const LOCAL_RE = /', '/i;');
const cloudRe   = grab('const CLOUD_SUFFIX = /', '/i;');
const localHosts = grab('const LOCAL_HOSTS = ', ';');
const provFn    = grab('function provOf(p, model, url){', '\n}');

const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
vm.runInContext([
  "const MU='#888';",
  localHosts, provTable, localRe, cloudRe, provFn,
  "globalThis.__provOf = provOf;",
].join('\n'), ctx);
const provOf = ctx.__provOf;

const CASES = [
  // [label, provider, model, base_url, expected]
  ['ollama-cloud live row',      null, 'deepseek-v4.1-flash',    'https://ollama.com/v1', 'ollama-cloud'],
  ['ollama-cloud slot, no url',  'ollama-cloud', 'deepseek-v4.1-flash', null,      'ollama-cloud'],
  [':cloud tag (kimi)',          null, 'kimi-k3:cloud',          null,                    'ollama-cloud'],
  [':cloud tag matches LOCAL_RE',null, 'qwen3-coder:480b-cloud', null,                    'ollama-cloud'],
  ['-cloud dash form',           null, 'qwen3-coder-480b-cloud', null,                    'ollama-cloud'],
  ['genuine local, LAN url',     null, 'qwen3-coder:30b',        'http://192.168.1.11:11434', 'local'],
  ['genuine local, name only',   null, 'qwen3.8:latest',         null,                    'local'],
  ['anthropic url',              null, 'claude-fable-5',         'https://api.anthropic.com', 'anthropic'],
  ['fireworks via custom slot',  'custom', 'accounts/fireworks/models/x', null,           'fireworks'],
  ['codex url',                  null, 'gpt-5.3-codex',          'https://chatgpt.com',   'openai-codex'],
  ['openrouter slug+url',        null, 'deepseek/deepseek-v4',   'https://openrouter.ai/api/v1', 'openrouter'],
  // the old terminal default sent unidentified hosts to 'local'
  ['unidentified host -> remote',null, 'some-vendor/odd-model',  'https://api.somehost.example/v1', 'cloud'],
];
for (const [label, p, m, u, want] of CASES) {
  const got = provOf(p, m, u);
  chk(got === want, label, got);
}

// the badge table must carry the new entry
chk(/'ollama-cloud':\{icon:'☁'/.test(provTable), 'PROV has an ollama-cloud badge');

console.log(`check_cloud_badge.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);