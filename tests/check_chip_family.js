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

// mobile tap-target rule: exact block whose selector is .chip, select.chip, button inside max-width 640px media
const tapBlockRe = /@media\(max-width:640px\)[\s\S]*?(\.chip,\s*select\.chip,\s*button)\s*\{([^}]*)\}/;
const tapMatch = css.match(tapBlockRe);
const tapBlock = tapMatch ? tapMatch[2] : '';
check('mobile tap-target exact block present', !!tapMatch);
check('mobile tap-target block min-height 44px', /min-height\s*:\s*44px/.test(tapBlock));
check('mobile tap-target block min-width 44px', /min-width\s*:\s*44px/.test(tapBlock));

// base .chip block has no display inline-flex and no min-height
const baseChipRe = /\.chip\s*\{([^}]*)\}/;
const baseChipMatch = css.match(baseChipRe);
const baseChip = baseChipMatch ? baseChipMatch[1] : '';
check('base .chip has no display inline-flex', !/display\s*:\s*inline-flex/.test(baseChip));
check('base .chip has no min-height', !/min-height/.test(baseChip));

// mobile tap-target rule keeps select.chip right padding for dropdown arrow
const tapSelect = css.match(/@media\(max-width:640px\)[\s\S]*?select\.chip\s*\{[^}]*padding-right\s*:\s*28px[^}]*\}/);
check('mobile tap-target rule keeps select.chip padding-right 28px', !!tapSelect);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
