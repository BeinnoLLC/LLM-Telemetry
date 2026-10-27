// LST-254: the fixed Logs edge tab must never cover content. The tab width and
// the page gutter come from ONE set of custom properties; narrow widths get a
// compact tab that still reserves its (smaller) space.
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'dashboard.html'), 'utf8');
const drawer = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'js', 'drawer.js'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, label, extra) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++; };
const num = (re, src) => { const m = re.exec(src); return m ? Number(m[1]) : NaN; };

const root = css.slice(0, css.indexOf('}', css.indexOf('--logtab-w:')));
const w = num(/--logtab-w:(\d+)px/, root), gap = num(/--logtab-gap:(\d+)px/, root);
chk(w > 0 && gap > 0, 'default --logtab-w and --logtab-gap declared', `w=${w} gap=${gap}`);
chk(/--logtab-gutter:calc\(var\(--logtab-w\)\s*\+\s*var\(--logtab-gap\)\)/.test(root), 'gutter variable = tab width + gap');
chk(w + gap > w, 'gap is positive: content ends before the tab starts');

const logbtn = (/\n\s*#logbtn\{([^}]*)\}/.exec(css) || [])[1] || '';
chk(/width:var\(--logtab-w\)/.test(logbtn) && /box-sizing:border-box/.test(logbtn), '#logbtn is exactly --logtab-w wide (border-box)');
chk(/overflow:hidden/.test(logbtn), '#logbtn clips overflow so the badge/fonts cannot widen it');
chk(/position:fixed;right:0/.test(logbtn), '#logbtn pinned to the right edge');
const page = (/\n\s*\.page\{([^}]*)\}/.exec(css) || [])[1] || '';
chk(/max\(var\(--pad\),\s*var\(--logtab-gutter\)\)\s+40px/.test(page), '.page reserves the gutter on the right');
chk(!/--logtab-gutter/.test(css.replace(/--logtab-gutter:calc[^;]*;/, '').replace(/\.page\{[^}]*\}/, '')) , 'only .page consumes the gutter variable');

// narrow widths: compact tab, still reserved
const mq = /@media \(max-width:599px\)\{\s*:root\{--logtab-w:(\d+)px;--logtab-gap:(\d+)px\}/.exec(css);
chk(!!mq, 'under 600px the tab shrinks via the same variables');
chk(mq && Number(mq[1]) < w && Number(mq[1]) + Number(mq[2]) >= Number(mq[1]) + 4, 'compact tab is narrower yet keeps a gap', mq ? `w=${mq[1]} gap=${mq[2]}` : '');
chk(!/@media[^{]*\{[^{}]*\.page\{[^}]*padding[^}]*\}/.test(css.slice(css.indexOf('@media (max-width:599px)'), css.indexOf('@media (max-width:599px)') + 200)), 'narrow rule does not override .page padding (reservation follows the variables)');

// function kept: keyboard + drawer
chk(/<button id="logbtn"/.test(html), 'tab is a real <button> (focusable, Enter/Space)');
chk(/#logbtn:focus-visible\{[^}]*outline:2px solid/.test(css), 'visible focus ring');
chk(/\$\('logbtn'\)\?\.addEventListener\('click'/.test(drawer), 'click handler opens the drawer');
chk(/id="logn" hidden/.test(html), 'count badge still present');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
