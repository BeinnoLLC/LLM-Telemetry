// The fixed #logbtn tab sits on the right edge; .page must reserve at least its
// width on the right so no content ends up underneath it.
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, label, extra) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++; };

const rule = sel => { const m = css.match(new RegExp('(?:^|\\n)\\s*' + sel.replace(/[.#]/g, '\\$&') + '\\{([^}]*)\\}')); return m && m[1]; };
const px = v => { const m = /(\d+(?:\.\d+)?)px/.exec(v || ''); return m ? Number(m[1]) : NaN; };

const page = rule('.page'), btn = rule('#logbtn');
chk(!!page && !!btn, '.page and #logbtn rules found');
// #logbtn: padding 13px 10px + ~1.5 line glyph; hover widens right padding to 14px.
const hover = /#logbtn:hover\{[^}]*padding-right:(\d+)px/.exec(css);
const pr = /padding:\s*\S+\s+max\(\s*var\(--pad\)\s*,\s*(\d+)px\s*\)/.exec(page || '');
chk(!!pr, '.page right padding is max(var(--pad), Npx)');
const gutter = pr ? Number(pr[1]) : 0;
const TAB_W = 51, HOVER_GROW = hover ? Number(hover[1]) - 10 : 0;
chk(gutter >= TAB_W + HOVER_GROW, `.page right gutter ${gutter}px >= tab ${TAB_W}px + hover growth ${HOVER_GROW}px`);
chk(!/padding-right/.test(css.match(/body\.hasnav \.page\{[^}]*\}/g).join('')), 'nav rules only touch padding-left');
chk(/\.qt-line \.qt-cars\{[^}]*mask-image:linear-gradient/.test(css), 'train edge fade present');
chk(!/\n\s*\.n2\{/.test(css), 'dead .n2 rule stays removed');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
