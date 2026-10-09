// #149: per-section freshness. The header used to carry one "rebuilt Ns ago"
// derived from the build, so a 5s live panel and an hourly router panel looked
// equally current and a frozen artifact looked live.
//
// Expectations are hand-derived from the documented bands: fresh below 1x the
// cadence, old from 1x to 2x, stale from 2x, with the age formatted by ago()
// (s under a minute, m under an hour, h above). Timestamps are all fake — no
// clock, no payload — so the arithmetic is what is under test.
import { isolate } from './lib/isolate.mjs';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — got ' + JSON.stringify(got) : ''}`); }
};
const eq = (got, want, name) => chk(JSON.stringify(got) === JSON.stringify(want), name, got);

const P = await isolate('palette.js', { 'main.js': { DATA: {} }, 'views.js': { PROV: {} } });

// ---- the one cadence table --------------------------------------------
eq(P.CADENCE.probe, 5, 'the probe cadence is 5s');
eq(P.CADENCE.dashboard, 60, 'the dashboard build cadence is 60s');
eq([P.CADENCE.router, P.CADENCE.quota, P.CADENCE.rankings], [3600, 3600, 3600],
   'the hourly artifacts share one cadence');
eq(P.STALE_FACTOR, 2, 'stale begins at 2x the cadence');
chk(['live', 'logs', 'dashboard', 'probe', 'router', 'quota', 'rankings'].every(k => P.CADENCE[k] > 0),
    'every section the page shows has a cadence');

// The table must agree with the units that actually run the collectors.
const timerText = name => readFileSync(new URL(`../systemd/${name}`, import.meta.url), 'utf8');
// Some units repeat on an interval (OnUnitActiveSec), some on a calendar
// (OnCalendar=hourly); both mean the same cadence to the dashboard.
const timerCadence = name => {
  const txt = timerText(name);
  if (/OnCalendar=hourly/.test(txt)) return 3600;
  const m = txt.match(/OnUnitActiveSec=(\d+)(s|min|h)?/);
  return m ? Number(m[1]) * ({ s: 1, min: 60, h: 3600 }[m[2] || 's']) : null;
};
eq(P.CADENCE.probe, timerCadence('llm-telemetry-probe.timer'), 'the probe cadence matches its timer');
eq(P.CADENCE.dashboard, timerCadence('llm-telemetry-build.timer'), 'the dashboard cadence matches its timer');
eq(P.CADENCE.router, timerCadence('llm-telemetry-router.timer'), 'the router cadence matches its timer');
chk(/OnCalendar=hourly|OnUnitActiveSec=(3600|1h)/.test(timerText('llm-telemetry-quota.timer')),
    'the quota timer really is hourly', 'see systemd/llm-telemetry-quota.timer');
eq(P.CADENCE.quota, timerCadence('llm-telemetry-quota.timer'), 'the quota cadence matches its timer');
eq(P.CADENCE.rankings, timerCadence('llm-telemetry-rankings.timer'), 'the rankings cadence matches its timer');

// ---- the bands, at the boundaries -------------------------------------
const NOW = 1_700_000_000;
const at = (age, key = 'dashboard') => P.freshness(NOW - age, key, NOW);

eq(at(0).state, 'fresh', 'just-updated is fresh');
eq(at(59).state, 'fresh', 'just under 1x the cadence is still fresh');
eq(at(60).state, 'old', 'exactly at the cadence is late, not fresh');
eq(at(90).state, 'old', '1.5x the cadence is old');
eq(at(119).state, 'old', 'just under 2x is still only old');
eq(at(120).state, 'stale', '2x the cadence is stale');
eq(at(180).state, 'stale', '3x the cadence is stale');
eq(at(3000, 'router').state, 'fresh', '3000s old is fresh against an hourly cadence');
eq(at(5400, 'router').state, 'old', '1.5x an hourly cadence is old');
eq(at(10800, 'router').state, 'stale', '3x an hourly cadence is stale');
eq(at(6, 'probe').state, 'old', '6s is late for the 5s probe');
eq(at(9, 'probe').state, 'old', 'just under 2x the probe cadence is still only late');
eq(at(10, 'probe').state, 'stale', '10s is 2x the probe cadence');
eq(at(15, 'probe').state, 'stale', '15s is 3x the probe cadence');

// ---- the reported numbers ---------------------------------------------
eq([at(90).age, at(90).cadence], [90, 60], 'the age and cadence are reported');
eq(at(90).label, '2m old', 'the label formats the age through ago()');
eq(at(180).label, '3m old', 'a stale label is still a plain age');
eq(at(7200, 'router').label, '2h old', 'an hours-old section reads in hours');
chk(at(180).hint.includes('expected every 1m'), 'the hint states the expected cadence', at(180).hint);
chk(at(180).hint.includes('last update 3m ago'), 'the hint states the observed age', at(180).hint);
eq(at(90).hint === undefined, false, 'old and stale both carry a hint');

// ---- timestamps in every shape the payloads use ------------------------
eq(P.freshness(null, 'dashboard', NOW).state, 'unknown', 'a missing timestamp is unknown, not fresh');
eq(P.freshness('', 'dashboard', NOW).state, 'unknown', 'an empty timestamp is unknown');
eq(P.freshness('not a date', 'dashboard', NOW).state, 'unknown', 'an unparseable timestamp is unknown');
eq(P.freshness(null, 'dashboard', NOW).label, 'no timestamp', 'unknown says why');
eq(P.freshness(NOW - 10, 'nonsense-key', NOW).state, 'unknown', 'an unknown section key is unknown');
eq(P.freshness(NOW - 10, 'nonsense-key', NOW).cadence, null, 'an unknown section has no cadence');
const realNow = Math.floor(Date.now() / 1000);
eq(P.freshness(realNow - 10, 'dashboard').state, 'fresh', 'a missing now defaults to the real clock');
eq(P.freshness(realNow - 7200, 'dashboard').state, 'stale', 'the real clock agrees about an old payload');
eq(P.freshness('1700000000', 'dashboard', NOW).state, 'fresh', 'a numeric string is a unix second');
eq(P.freshness((NOW - 30) * 1000, 'dashboard', NOW).age, 30, 'a millisecond epoch is divided down');
eq(P.freshness(NOW + 500, 'dashboard', NOW).age, 0, 'a clock-skewed future timestamp clamps to zero');
eq(P.freshness(NOW + 500, 'dashboard', NOW).state, 'fresh', 'a future timestamp is fresh, not negative');
eq(P.freshness(NOW - 30.4, 'dashboard', NOW).age, 30, 'a fractional age is rounded');
// An ISO string with no zone is local time, which is how the payloads write it.
const iso = new Date(NOW * 1000).toISOString().replace('Z', '');
const isoAt = Math.floor(Date.parse(iso) / 1000);   // whatever zone the machine is in
eq(P.freshness(iso, 'dashboard', isoAt + 30).state, 'fresh',
   'an ISO string without a zone is parsed as local time, not discarded');
eq(P.freshness('2026-01-01T00:00:00Z', 'dashboard', Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 90).state,
   'old', 'an ISO string with a Z is honoured too');

// ---- writing the state onto an element --------------------------------
const mkStamp = (text = '') => {
  const cls = new Set();
  return { textContent: text, title: '', dataset: {}, _cls: cls,
    classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: c => cls.has(c) } };
};

const fresh = mkStamp('generated 2026-01-01 00:00:00 · auto-refresh every 1 min');
const r1 = P.stampFreshness(fresh, NOW - 10, 'dashboard', NOW);
eq(r1.state, 'fresh', 'a fresh section reports fresh');
eq([fresh._cls.size, fresh.dataset.stampState, fresh.dataset.stampKey], [0, 'fresh', 'dashboard'],
   'a fresh stamp carries no class and records its state');
eq(fresh.textContent, 'generated 2026-01-01 00:00:00 · auto-refresh every 1 min',
   'a fresh stamp leaves the text alone');
eq(fresh.title, '', 'a fresh stamp has no hint');

const late = mkStamp('live · updated 12:00:00');
P.stampFreshness(late, NOW - 90, 'dashboard', NOW);
eq([late.dataset.stampState, late._cls.has('old'), late._cls.has('stale')], ['old', true, false],
   'a late stamp gets .old and only .old');
eq(late.textContent, 'live · updated 12:00:00 · 2m old', 'the late stamp appends its age');
chk(late.title.includes('expected every 1m'), 'the late stamp explains itself in the title', late.title);

const stale = mkStamp('live · updated 12:00:00');
P.stampFreshness(stale, NOW - 180, 'dashboard', NOW);
eq([stale.dataset.stampState, stale._cls.has('stale')], ['stale', true], 'a 3x stamp is stale');
eq(stale.textContent, 'live · updated 12:00:00 · stale, 3m old', 'a stale stamp says so in words');
chk(stale.title.includes('last update 3m ago'), 'the stale title carries the age', stale.title);

// Recovering must not accumulate suffixes — the user asked for a section that
// looks live again after the next fresh poll.
const recovered = mkStamp('live · updated 12:00:00');
P.stampFreshness(recovered, NOW - 300, 'dashboard', NOW);
chk(recovered.textContent.includes('stale'), 'the section is stale before the poll');
P.stampFreshness(recovered, NOW - 1, 'dashboard', NOW);
eq([recovered.textContent, recovered._cls.size, recovered.title], ['live · updated 12:00:00', 0, ''],
   'a fresh poll clears the class, the suffix and the hint');

// A second late call updates the numbers without stacking text.
const twice = mkStamp('mine');
P.stampFreshness(twice, NOW - 90, 'dashboard', NOW);
P.stampFreshness(twice, NOW - 3600, 'dashboard', NOW);
eq(twice.textContent, 'mine · stale, 1h old', 'the suffix is recomputed, not appended twice');

// An element with nothing in it yet still reports, without a dangling space.
const blank = mkStamp('');
P.stampFreshness(blank, NOW - 180, 'logs', NOW);
eq(blank.textContent, 'stale, 3m old', 'a blank stamp does not start with a separator');
eq(blank.dataset.stampKey, 'logs', 'the section key is recorded');

// Defensive: no element, or an element without classList, is not a crash.
eq(P.stampFreshness(null, NOW, 'dashboard', NOW), null, 'a missing element returns null');
const bare = { textContent: '', dataset: {} };
chk(P.stampFreshness(bare, NOW - 180, 'dashboard', NOW).state === 'stale',
    'an element without classList still gets its text and state');

// ---- the shell carries the class and the CSS the state needs -----------
const html = readFileSync(new URL('../src/llm_telemetry/web/dashboard.html', import.meta.url), 'utf8');
for (const id of ['meta', 'livestamp', 'dstamp']) {
  const m = html.match(new RegExp(`<span[^>]*id="${id}"[^>]*>`));
  chk(m && /class="[^"]*\bstamp\b/.test(m[0]), `#${id} carries the stamp class`, m && m[0]);
}
const css = readFileSync(new URL('../src/llm_telemetry/web/css/dashboard.css', import.meta.url), 'utf8');
chk(css.includes('.stamp.old'), 'the stylesheet styles a late stamp');
chk(css.includes('.stamp.stale'), 'the stylesheet dims a stale stamp');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
