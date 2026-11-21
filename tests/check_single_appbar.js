// LLMTELEMET-315: exactly one app bar shell. The retired .appbar shell
// (dashboard.css:670) and its #hamburger/#barmore/#barmenu controls were
// deleted; the live bar is #appbar (markup in dashboard.html, spec near the
// old dashboard.css:2166). This suite fails if a second app bar shell rule,
// markup or JS ever comes back.
const fs = require('fs');
const path = require('path');
const WEB = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web');
const cssDir = path.join(WEB, 'css');
const jsDir = path.join(WEB, 'js');

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

// Comments must not count: the LLMTELEMET-315 note in dashboard.css mentions
// the retired selector names on purpose.
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

const cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
const css = cssFiles.map(f => [f, strip(fs.readFileSync(path.join(cssDir, f), 'utf8'))]);
const html = strip(fs.readFileSync(path.join(WEB, 'dashboard.html'), 'utf8'));
const js = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'))
  .map(f => [f, strip(fs.readFileSync(path.join(jsDir, f), 'utf8'))]);

// ---- 1. No retired shell selectors anywhere in CSS -------------------------
const RETIRED = [/\.appbar\b/, /#hamburger\b/, /#barmore\b/, /#barmenu\b/];
for (const [f, text] of css) {
  for (const re of RETIRED) chk(!re.test(text), `${f}: retired selector ${re} is gone`, (text.match(re) || [])[0]);
}

// ---- 2. Exactly one sticky top shell rule, and it is #appbar --------------
// App-bar shell fingerprint: a sticky top:0 flex row centred vertically.
const RULE = /([^{}]+)\{([^{}]*)\}/g;
const shells = [];
for (const [f, text] of css) {
  let m;
  while ((m = RULE.exec(text))) {
    const [, sel, body] = m;
    if (/(?:position:\s*sticky|position:\s*fixed)/.test(body) && /(^|[;{\s])top:\s*0/.test(body) &&
        /display:\s*flex/.test(body) && /align-items:\s*center/.test(body)) {
      shells.push({ f, sel: sel.trim().replace(/\s+/g, ' ') });
    }
  }
}
chk(shells.length === 1, `exactly one app bar shell rule (${shells.length} found)`,
  shells.map(s => s.sel).join(' | '));
chk(shells.length === 1 && /(^|[\s,])#appbar([\s,{]|$)/.test(shells[0].sel),
  'the one shell rule is #appbar', shells.map(s => s.sel).join(' | '));

// ---- 3. #appbar is a shell rule itself (the survivor spec) ----------------
const appbarShell = css
  .filter(([, t]) => /(^|[},\s])#appbar\s*\{/.test(t))
  .map(([, t]) => (t.match(/#appbar\s*\{[^}]*\}/) || [''])[0])
  .join('\n');
chk(/position:\s*sticky/.test(appbarShell) && /top:\s*0/.test(appbarShell),
  '#appbar keeps its sticky top shell rule');

// ---- 4. Markup mounts one app bar ----------------------------------------
const banners = html.match(/role="banner"/g) || [];
chk(banners.length === 1, `exactly one role="banner" in the template (${banners.length})`);
const barIds = html.match(/<[^>]+id="appbar"/g) || [];
chk(barIds.length === 1, `exactly one #appbar element in the template (${barIds.length})`);
chk(!/class="[^"]*\bappbar\b/.test(html), 'no .appbar markup in the template');
for (const id of ['hamburger', 'barmore', 'barmenu']) {
  chk(!new RegExp(`id="${id}"`).test(html), `no #${id} markup in the template`);
}

// ---- 5. No JS mounts or queries the retired shell ------------------------
for (const [f, text] of js) {
  const hit = text.match(/getElementById\(\s*['"](?:hamburger|barmore|barmenu|appbar2)['"]|querySelector(?:All)?\(\s*['"][^'"]*\.(?:appbar|topbar|app-bar)\b/);
  chk(!hit, `${f}: no JS for a second app bar`, hit && hit[0]);
}

// ---- 6. No JS builds a second bar --------------------------------------
for (const [f, text] of js) {
  const t1 = text.match(/role\s*=\s*["']banner["']/);
  chk(!t1, `${f}: no template string with role=banner`, t1 && t1[0]);
  const t2 = text.match(/id\s*=\s*["']appbar["']/);
  chk(!t2, `${f}: no template string with id=appbar`, t2 && t2[0]);
  const t3 = text.match(/classList\.add\([^)]*['"]appbar['"]/);
  chk(!t3, `${f}: no classList.add of appbar`, t3 && t3[0]);
}

// ---- 7. jsdom smoke (optional, needs built page) -------------------------
const PAGE = process.env.LST342_PAGE || '/home/hazemhagrass/.hermes/profiles/llm-telemetry-brain/cache/scratch/lst342.html';
const fs2 = require('fs');
if (!fs2.existsSync(PAGE)) {
  console.log(`  skip jsdom smoke — page missing: ${PAGE}`);
} else {
  let JSDOM;
  try { JSDOM = require('jsdom').JSDOM; } catch (e) { JSDOM = null; }
  if (!JSDOM) {
    console.log('  skip jsdom smoke — jsdom not installed');
  } else {
    const dom = new JSDOM(fs2.readFileSync(PAGE, 'utf8'), { runScripts: 'dangerously', url: 'http://localhost/' });
    const doc = dom.window.document;
    const banners = doc.querySelectorAll('[role="banner"]');
    chk(banners.length === 1, `jsdom: exactly one role=banner (${banners.length})`);
    const h1s = doc.querySelectorAll('h1');
    chk(h1s.length === 1, `jsdom: exactly one h1 (${h1s.length})`);
    const toggles = Array.from(doc.querySelectorAll('button')).filter(b => b.getAttribute('aria-label') === 'Toggle theme');
    chk(toggles.length === 1, `jsdom: exactly one Toggle theme button (${toggles.length})`);
    if (toggles.length === 1 && typeof toggles[0].onclick === 'function') {
      const before = doc.documentElement.getAttribute('data-theme');
      toggles[0].click();
      const after = doc.documentElement.getAttribute('data-theme');
      chk(before !== after, `jsdom: clicking toggle changes data-theme (${before} -> ${after})`);
    } else if (toggles.length === 1) {
      console.log('  skip jsdom click — handler not attached in jsdom');
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
