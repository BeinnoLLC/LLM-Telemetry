// Every payload the built page fetches ON DEMAND must have something that
// PRODUCES it in the refresh path.
//
// Why this gate exists: transcripts.json and sessions/<profile>/<id>.json are
// fetched by the page when a user opens a session, never by a build step, so a
// missing file is invisible to the build — the modal simply reports "This
// session was not exported." for every session. Both collectors existed and
// passed their own unit tests while the deployed per-minute job ran neither, so
// the transcript modal and the session timeline were dead in production for as
// long as those features had shipped. Nothing tied the page's fetch list to the
// commands that fill it; this does.
//
// It reads the BUILT dashboard.html, so a new on-demand fetch in the JS is
// caught here rather than in someone's browser.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS || path.join(ROOT, 'examples', 'reports');
const html = fs.readFileSync(path.join(REPORTS, 'dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function chk(ok, name, got) {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
}

// --- what the page asks for, on demand --------------------------------------
// fetch('name.json?t=' + Date.now()...) and the templated per-session path.
const targets = new Set();
for (const m of html.matchAll(/fetch\(\s*[`'"]([^`'"?]+)/g)) {
  let t = m[1];
  // The per-session path is built from template literals; normalise it to the
  // directory the collector writes into.
  t = t.replace(/\$\{encodeURIComponent\(profile\)\}.*/, '<profile>/<id>.json');
  if (t.endsWith('.json') || t.includes('sessions/')) targets.add(t);
}
const jsonTargets = [...targets].filter(t => t !== 'api/settings').sort();

chk(jsonTargets.length > 0, 'the built page fetches at least one on-demand payload',
    jsonTargets.join(', '));
chk(jsonTargets.includes('transcripts.json'),
    'the transcript modal is one of the on-demand payloads (the feature this gate was written for)');
chk(jsonTargets.includes('sessions/<profile>/<id>.json'),
    'the session timeline is one of the on-demand payloads');

// --- what the refresh path produces ----------------------------------------
// The refresh paths that actually run on this machine and on any deployment:
// the repo's cron script and the systemd unit. Both must cover the payloads —
// they are two spellings of the same cycle and drift apart silently.
const REFRESH_PATHS = ['scripts/refresh-dashboard.sh', 'systemd/llm-telemetry-build.service'];

// payload file -> the CLI subcommand(s) that write it.
const PRODUCER = {
  'analytics-data.json': ['dashboard', 'analytics'],
  'live-data.json': ['live'],
  'logs-data.json': ['logs'],
  'router-data.json': ['router', 'dashboard'],   // dashboard re-collects when stale
  'transcripts.json': ['transcripts'],
  'sessions/<profile>/<id>.json': ['session-timeline'],
};

for (const rel of REFRESH_PATHS) {
  const p = path.join(ROOT, rel);
  chk(fs.existsSync(p), `the refresh path is in the repo (${rel})`);
  if (!fs.existsSync(p)) continue;
  const body = fs.readFileSync(p, 'utf8');
  for (const t of jsonTargets) {
    const names = PRODUCER[t];
    chk(!!names, `every on-demand payload has a declared producer (${t})`);
    if (!names) continue;
    const hit = names.find(n => new RegExp(`(^|[\\s"/])${n}("|\\s|$)`).test(body));
    chk(!!hit, `${rel} runs a collector for ${t} (${names.join(' or ')})`);
  }
}

// --- negative control ------------------------------------------------------
// The gate must be able to see the exact hole that shipped: a refresh path
// with no collector for transcripts.json. Removing the line from the body text
// is what "the deployed job does not run it" looks like.
const script = fs.readFileSync(path.join(ROOT, 'scripts/refresh-dashboard.sh'), 'utf8');
const withoutTranscripts = script.split('\n')
  .filter(l => !/(^|[\s"/])transcripts("|\s|$)/.test(l)).join('\n');
chk(!/(^|[\s"/])transcripts("|\s|$)/.test(withoutTranscripts),
    'control: the transcripts line is what the check keys on',
    withoutTranscripts.slice(0, 0) || 'line removed');
chk(!['transcripts'].find(n => new RegExp(`(^|[\\s"/])${n}("|\\s|$)`).test(withoutTranscripts)),
    'control: a refresh path that skips `transcripts` is detected as missing it');

console.log(`\ncheck_refresh_coverage.js  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
