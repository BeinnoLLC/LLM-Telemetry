// OpenRouter rankings payload contract (rankings-data.json, #113). Reads the
// committed sample ("sample": true), so every expected number is reproducible
// and no network is involved.
const fs = require('fs');
const path = require('path');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || path.join(__dirname, '..', 'examples', 'reports');
const dataFile = path.join(REPORTS, 'rankings-data.json');
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? '  (' + extra + ')' : ''}`);
  ok ? pass++ : fail++;
};
if (!fs.existsSync(dataFile)){
  console.log('FAIL rankings-data.json missing: run the collector first');
  process.exit(1);
}
// Data contract only: the page is gone (Rankings is an in-app view; the view
// side is checked by check_rankings_inapp.js against the real renderer).
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// per-window shape: top-10 sorted desc, ranks 1..10, one other row, label.
for (const name of ['day', 'week', 'month']){
  const view = data.views[name];
  chk(view.top.length === 10, `${name}: top-10 rows`, view.top.length);
  const toks = view.top.map(r => r.tokens);
  chk(toks.every((t, i) => i === 0 || toks[i - 1] >= t), `${name}: rows sorted by tokens desc`);
  chk(view.top.every((r, i) => r.rank === i + 1), `${name}: ranks 1..10`);
  chk(view.top.every(r => r.tokens + 0 > 0), `${name}: tokens parse to positives`);
  chk(view.other && view.other.tokens > 0, `${name}: other aggregate present`, view.other && view.other.tokens);
  chk(Math.abs(view.top.map(r => r.share).reduce((a, b) => a + b, 0) + view.other.share - 100) < 0.5,
    `${name}: shares sum to 100%`);
  chk(view.days > 0 && !!view.end, `${name}: window label days/end`, `${view.days}/${view.end}`);
}


chk(data.sample === true, 'sample payload is labelled as sample');
chk(!/OPENROUTER_API_KEY=|Bearer /.test(JSON.stringify(data)), 'no credential material in the payload');

console.log(fail ? `FAILED  (${pass} passed, ${fail} failed)` : `ALL PASS  (${pass} passed, 0 failed)`);
process.exit(fail ? 1 : 0);
