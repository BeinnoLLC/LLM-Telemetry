const fs = require('fs');
const css = fs.readFileSync('src/llm_telemetry/web/css/dashboard.css','utf8');

let passed = 0, failed = 0;
function check(name, cond){ if(cond){passed++;} else {failed++; console.log('FAIL:', name);} }

// extract rule blocks for selectors
function rule(sel){
  const re = new RegExp(sel + '\\s*\\{([^}]*)\\}', 'g');
  let m, out='';
  while((m=re.exec(css))!==null) out += m[1] + '\n';
  return out;
}

const selectChip = rule('select\\.chip');
const comboBtn = rule('\\.combo-btn');

function val(ruleText, prop){
  const m = ruleText.match(new RegExp(prop + '\\s*:\\s*([^;]+);'));
  return m ? m[1].trim() : null;
}

const h1 = val(selectChip,'min-height') || val(selectChip,'height');
const h2 = val(comboBtn,'min-height') || val(comboBtn,'height');
const r1 = val(selectChip,'border-radius');
const r2 = val(comboBtn,'border-radius');

check('select.chip and .combo-btn same height', h1 === h2 && h1 === 'var(--ctl-md)');
check('select.chip and .combo-btn same border-radius', r1 === r2 && r1 === 'var(--radius-ctl)');

// no raw px border-radius in chip/combo rules
const chipComboRules = css.match(/(?:\.chip|\.combo-btn|\.combo-pop|select\.chip)[^{]*\{[^}]*\}/g) || [];
let rawPx = false;
for(const r of chipComboRules){
  const m = r.match(/border-radius\s*:\s*(\d+)px/);
  if(m && m[1] !== '999') rawPx = true;
}
check('no raw px border-radius in chip/combo rules', !rawPx);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
