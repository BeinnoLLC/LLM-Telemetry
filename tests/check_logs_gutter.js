// LST-254's fixed #logbtn edge tab is RETIRED (UI pass A moved the unread
// badge to the rail's Live tail item and the drawer opens from there or the
// 'l' shortcut). The tab used to reserve a right-hand gutter on .page; this
// suite guards the source-level removal — no tab markup, no --logtab-* CSS,
// no reserved gutter — so the dead geometry cannot creep back, alongside the
// misc CSS hygiene checks it has always carried. check_ui_a.js guards the
// same removal on the built page.
const fs = require('fs'), path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, label, extra) => { console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`); ok ? pass++ : fail++; };

const rule = sel => { const m = css.match(new RegExp('(?:^|\\n)\\s*' + sel.replace(/[.#]/g, '\\$&') + '\\{([^}]*)\\}')); return m && m[1]; };

chk(!/logbtn|logtab/.test(css), 'no floating Logs tab CSS left (no #logbtn rule, no --logtab-* variable)');
chk(!/logbtn|logtab/.test(html), 'no floating Logs tab markup in dashboard.html');
chk(!/max\(\s*var\(--pad\)\s*,\s*var\(--logtab-gutter\)\s*\)/.test(css), '.page no longer reserves the dead edge-tab gutter');
chk(/\.page\{[^}]*padding:var\(--pad\) var\(--pad\) 40px var\(--pad\)/.test(css), '.page pads symmetrically left/right');

// misc CSS hygiene (unchanged behaviour)
chk(!/padding-right/.test(css.match(/body\.hasnav \.page\{[^}]*\}/g).join('')), 'nav rules only touch padding-left');
chk(!/mask-image/.test(rule('.qt-cars') || ''), 'jar tiles carry no chopper mask');
chk(!/\n\s*\.n2\{/.test(css), 'dead .n2 rule stays removed');
chk(/\.fbwrap\{min-width:0\}/.test(css), 'fleet-bar wrapper can shrink (min-width:0)');
chk(/\.olhead\{[^}]*flex-wrap:wrap/.test(css), '.olhead wraps long hostnames');
chk(/@media \(max-width:960px\)\{\s*\.fb-label,\.fb-sep,\.kseg \.l\{display:none\}/.test(css), 'fleet-bar labels collapse at 960px');
chk(/class="[^"]*\bfbwrap\b[^"]*">\s*<div class="fleetbar" id="tabs"/.test(html), 'dashboard.html wrapper carries .fbwrap');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
