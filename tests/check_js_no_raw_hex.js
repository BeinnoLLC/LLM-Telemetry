// Guard (LLMTELEMET-306): no raw hex colour literal in web/js strings/templates.
// Runs the repo ESLint config's no-restricted-syntax rule over the sources, and
// proves the rule fires on a sample so it cannot silently go inert.
const path = require('path');
const root = path.join(__dirname, '..');
let pass = 0, fail = 0;
const chk = (ok, name) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}`); ok ? pass++ : fail++; };
(async () => {
  const { ESLint } = await import(require.resolve('eslint', { paths: [root, __dirname] }));
  const eslint = new ESLint({ cwd: root });
  const res = await eslint.lintFiles(['src/llm_telemetry/web/js']);
  const bad = res.flatMap(r => r.messages.filter(m => m.ruleId === 'no-restricted-syntax')
    .map(m => `${path.relative(root, r.filePath)}:${m.line} ${m.message}`));
  chk(bad.length === 0, 'no raw hex colour literals in web/js');
  bad.forEach(b => console.log('    ' + b));
  const probe = await eslint.lintText("const a = '#c4a06e'; const b = `x #fff`; const c = '&#128266;';",
    { filePath: path.join(root, 'src/llm_telemetry/web/js/_probe.js') });
  chk(probe[0].messages.filter(m => m.ruleId === 'no-restricted-syntax').length === 2, 'rule flags string+template hex, ignores entities');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
