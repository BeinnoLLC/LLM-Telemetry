// Hidden-tab polls with sound on still run the critical-alert check (no repaint),
// so the tone the toggle promises plays in the background. Mocked audio.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = process.env.LLM_TELEMETRY_REPORTS || path.join(__dirname, '..', 'examples', 'reports');
const html = fs.readFileSync(path.join(R, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(R, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(R, 'analytics-data.json'), 'utf8'));

let p = 0, f = 0;
const chk = (c, m) => { c ? (p++, console.log('  ok  ' + m)) : (f++, console.log('FAIL ' + m)); };

let notes = [];
function FakeAudioContext() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
FakeAudioContext.prototype.resume = function () {};
FakeAudioContext.prototype.createOscillator = function () {
  const o = { connect() {}, type: 'sine', frequency: { value: 0 }, start() { notes.push(o.frequency.value); }, stop() {} };
  return o;
};
FakeAudioContext.prototype.createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} });

let current = JSON.parse(JSON.stringify(live));
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/dashboard.html',
  beforeParse(w) {
    w.AudioContext = FakeAudioContext;
    w.fetch = u => Promise.resolve({ ok: true, json: () => Promise.resolve(String(u).includes('live-data.json') ? current : analytics) });
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: {}, options: {} }; };
    w.Chart.register = () => {}; w.Chart.getChart = () => null;
    w.Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } };
    w.URL.createObjectURL = () => 'blob:stub'; w.URL.revokeObjectURL = () => {};
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  },
});
const w = dom.window;
const setHidden = v => Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => v });

const withAlert = (id, sev) => {
  const c = JSON.parse(JSON.stringify(live));
  Object.values(c.profiles).forEach(pr => { pr.recent_ended = []; pr.recent_delegations = []; pr.alerts = []; });
  const first = Object.keys(c.profiles)[0];
  c.profiles[first].alerts = [{ id, severity: sev, message: 'boom ' + id }];
  return c;
};

(async () => {
  await new Promise(r => setTimeout(r, 60));
  chk(w.soundOn === true, 'sound is on');
  setHidden(true);
  current = withAlert('a0', 'warning');
  await w.pollLive();                      // hidden baseline for the alert checker
  await new Promise(r => setTimeout(r, 2100));
  notes = [];

  current = withAlert('crit1', 'critical');
  await w.pollLive();
  await new Promise(r => setTimeout(r, 2100));
  chk(notes.length === 1 && notes[0] === 220, `hidden poll plays the critical (fail) tone (${notes})`);
  notes = [];
  await w.pollLive();
  await new Promise(r => setTimeout(r, 2100));
  chk(notes.length === 0, 'the same critical alert does not sound twice');

  current = withAlert('warn2', 'warning');
  await w.pollLive();
  await new Promise(r => setTimeout(r, 2100));
  chk(notes.length === 0, 'negative control: a non-critical new alert stays silent');

  w.soundOn = false;
  current = withAlert('crit3', 'critical');
  await w.pollLive();
  await new Promise(r => setTimeout(r, 2100));
  chk(notes.length === 0, 'negative control: sound off, hidden tab does not even poll');
  console.log(`\n${p} passed, ${f} failed`);
  process.exit(f ? 1 : 0);
})();
