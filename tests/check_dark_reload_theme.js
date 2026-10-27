// Gap #12 (Step 0b): after a RELOAD in dark mode the chart colours (gridlines,
// ticks, live-row borders) must be the DARK values. readTheme() runs while the
// modules load, before main.js applies the saved data-theme, so without the
// re-read in main.js they keep the light palette until the user toggles twice.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const REPORTS = process.env.LLM_TELEMETRY_REPORTS
  || require('path').join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(REPORTS + '/dashboard.html', 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
const live = JSON.parse(fs.readFileSync(REPORTS + '/live-data.json', 'utf8'));

function boot(theme) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html',
    beforeParse(w) {
      if (theme) w.localStorage.setItem('hermes-dash-theme', theme);
      w.Chart = function () { return { destroy() {}, update() {} }; };
      w.Chart.defaults = { color: '', borderColor: '', font: {} };
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(live) });
    },
  });
}
const light = boot('light'), dark = boot(null);  // dark is the default (no saved theme)
let pass = 0, fail = 0;
const chk = (ok, label, extra) => {
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};
setTimeout(() => {
  const L = light.window.Chart.defaults, D = dark.window.Chart.defaults;
  chk(dark.window.document.documentElement.getAttribute('data-theme') === 'dark', 'dark (the default) is applied on load');
  chk(!!L.borderColor && !!D.borderColor, 'gridline colour is read in both themes', `light=${L.borderColor} dark=${D.borderColor}`);
  chk(D.borderColor !== L.borderColor, 'dark reload gridlines use the dark border, not the light one');
  chk(D.color !== L.color, 'dark reload tick colour uses the dark muted, not the light one');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}, 400);
