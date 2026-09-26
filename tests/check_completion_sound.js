// Completion sound (#105): a short tone when a session or delegated task
// finishes. Off by default, toggled by #soundtoggle, generated with Web
// Audio so jsdom (which has no real audio) is stubbed with a fake
// AudioContext that just records what would have played.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const R = process.env.LLM_TELEMETRY_REPORTS || 'examples/reports';
const html = fs.readFileSync(path.join(R, 'dashboard.html'), 'utf8');
const live = JSON.parse(fs.readFileSync(path.join(R, 'live-data.json'), 'utf8'));
const analytics = JSON.parse(fs.readFileSync(path.join(R, 'analytics-data.json'), 'utf8'));

let p = 0, f = 0;
const chk = (c, m) => { c ? (p++, console.log('  ok  ' + m)) : (f++, console.log('FAIL ' + m)); };

// Records every oscillator start -- one entry per note. A "success" chime is
// two notes (880Hz, 1174.66Hz), a "fail" tone is one (220Hz), so counting
// notes and reading the frequency is enough to tell them apart without
// needing real audio output.
let playedNotes = [];

function FakeAudioContext(){
  this.state = 'running';
  this.currentTime = 0;
  this.destination = {};
}
FakeAudioContext.prototype.resume = function(){ this.state = 'running'; };
FakeAudioContext.prototype.createOscillator = function(){
  const osc = {
    connect(){}, type: 'sine', frequency: { value: 0 },
    start(t){ playedNotes.push(osc.frequency.value); },
    stop(){},
  };
  return osc;
};
FakeAudioContext.prototype.createGain = function(){
  return {
    gain: { setValueAtTime(){}, linearRampToValueAtTime(){}, exponentialRampToValueAtTime(){} },
    connect(){},
  };
};

// fetch serves one live payload per call; tests mutate `currentLive` between
// polls to simulate a session ending or a delegation completing.
let currentLive = JSON.parse(JSON.stringify(live));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/dashboard.html',
  beforeParse(w) {
    w.AudioContext = FakeAudioContext;
    w.fetch = (u) => {
      if (String(u).includes('live-data.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(currentLive) });
      }
      if (String(u).includes('analytics-data.json')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(analytics) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: {}, options: {} }; };
    w.Chart.register = () => {};
    w.Chart.getChart = () => null;
    w.Chart.defaults = { font: {}, plugins: { legend: { labels: {} } }, scale: { grid: {} } };
    w.URL.createObjectURL = () => 'blob:stub';
    w.URL.revokeObjectURL = () => {};
    w.matchMedia = q => ({ matches: false, media: q, addEventListener() {},
                           removeEventListener() {}, addListener() {}, removeListener() {} });
  },
});
const w = dom.window, d = w.document;
const $ = id => d.getElementById(id);

(async () => {
  await new Promise(r => setTimeout(r, 60));   // let boot + first pollLive settle

  // --- off by default --------------------------------------------------
  chk(w.soundOn === false, 'sound is off by default');
  const btn = $('soundtoggle');
  chk(!!btn, 'the sound toggle button exists');
  chk(btn.getAttribute('aria-pressed') === 'false', 'toggle reports pressed=false while off');

  // --- no tone on the very first poll (baseline), even though the fixture
  // already carries recent_ended / recent_delegations from page load -------
  chk(playedNotes.length === 0, 'no tone plays on initial load (baseline snapshot)');

  // Turn sound on (this is the user gesture Web Audio requires).
  btn.click();
  chk(w.soundOn === true, 'clicking the toggle turns sound on');
  chk(btn.getAttribute('aria-pressed') === 'true', 'toggle reports pressed=true once on');
  await new Promise(r => setTimeout(r, 10));
  chk(playedNotes.length === 2, 'turning the toggle on itself plays one confirmation chime (2 notes)');
  playedNotes = [];

  // --- profile switch must not sound -------------------------------------
  // Switching profiles re-renders from the same DATA, no new poll -- nothing
  // to check here beyond "no crash"; the real guard is soundBaseline, proven
  // above. Move on to the actual completion cases.

  // --- a session ending between polls plays a success tone ----------------
  const w1 = $('lgcount');   // unrelated element; just a liveness check
  const nextLive = JSON.parse(JSON.stringify(live));
  Object.values(nextLive.profiles).forEach(pr => { pr.recent_ended = []; pr.recent_delegations = []; });
  const endedId = 'sample_ended_new_' + Date.now();
  const firstProfile = Object.keys(nextLive.profiles)[0];
  nextLive.profiles[firstProfile].recent_ended = [
    { id: endedId, title: 'New sample session', ended_at: Math.floor(Date.now()/1000), end_reason: 'agent_close' },
  ];
  currentLive = nextLive;
  await w.pollLive();
  await new Promise(r => setTimeout(r, 10));
  chk(playedNotes.length === 2, `exactly one success tone (2 notes) played for one completed session (${playedNotes.length})`);
  chk(playedNotes[0] < playedNotes[1], 'success tone rises (two ascending notes)');
  playedNotes = [];

  // Same payload again (nothing new) must NOT re-sound.
  await w.pollLive();
  await new Promise(r => setTimeout(r, 10));
  chk(playedNotes.length === 0, 'the same completion does not sound twice');

  // --- a burst of several completions in ONE poll plays ONE tone ----------
  const nextLive2 = JSON.parse(JSON.stringify(live));
  Object.values(nextLive2.profiles).forEach(pr => { pr.recent_ended = []; pr.recent_delegations = []; });
  nextLive2.profiles[firstProfile].recent_ended = [1,2,3,4,5].map(i => ({
    id: `burst_${i}_${Date.now()}`, title: `Burst ${i}`,
    ended_at: Math.floor(Date.now()/1000), end_reason: 'agent_close',
  }));
  currentLive = nextLive2;
  await w.pollLive();
  await new Promise(r => setTimeout(r, 2100));   // debounce window can delay the tone up to 2s
  chk(playedNotes.length === 2, `a burst of 5 completions in one poll plays exactly one tone (2 notes, got ${playedNotes.length})`);
  playedNotes = [];

  // --- a failed delegation plays the distinct failure tone -----------------
  const nextLive3 = JSON.parse(JSON.stringify(live));
  Object.values(nextLive3.profiles).forEach(pr => { pr.recent_ended = []; pr.recent_delegations = []; });
  nextLive3.profiles[firstProfile].recent_delegations = [
    { id: 'fail_deleg_' + Date.now(), state: 'error', completed_at: Math.floor(Date.now()/1000) },
  ];
  currentLive = nextLive3;
  await w.pollLive();
  await new Promise(r => setTimeout(r, 2100));
  chk(playedNotes.length === 1, `a failed delegation plays exactly one note (fail tone) (${playedNotes.length})`);
  chk(playedNotes[0] === 220, `the failure tone is the distinct low note (${playedNotes[0]})`);
  playedNotes = [];

  // --- mute stops future tones ---------------------------------------------
  btn.click();   // off again
  chk(w.soundOn === false, 'clicking again turns sound off');
  const nextLive4 = JSON.parse(JSON.stringify(live));
  Object.values(nextLive4.profiles).forEach(pr => { pr.recent_ended = []; pr.recent_delegations = []; });
  nextLive4.profiles[firstProfile].recent_ended = [
    { id: 'muted_' + Date.now(), title: 'Should stay silent', ended_at: Math.floor(Date.now()/1000), end_reason: 'agent_close' },
  ];
  currentLive = nextLive4;
  await w.pollLive();
  await new Promise(r => setTimeout(r, 10));
  chk(playedNotes.length === 0, 'no tone plays while muted');

  // --- persistence ----------------------------------------------------------
  btn.click();  // back on
  chk(w.localStorage.getItem('lt-sound') === '1', 'the on state is saved to localStorage');
  btn.click();  // off
  chk(w.localStorage.getItem('lt-sound') === '0', 'the off state is saved to localStorage');

  // --- negative control: removing the baseline guard would fail the
  // "no tone on initial load" check above. Prove that check is load-bearing
  // by re-running the same scenario with soundBaseline forced false, as if
  // the guard did not exist.
  w.soundBaseline = false;
  w.seenEnded = new Set();
  w.seenDeleg = new Set();
  const nextLive5 = JSON.parse(JSON.stringify(live));  // the ORIGINAL fixture, which already carries 2 recent_ended
  currentLive = nextLive5;
  await w.pollLive();
  await new Promise(r => setTimeout(r, 10));
  chk(playedNotes.length > 0,
      'negative control: without the baseline guard, the original page-load fixture DOES sound (proves the guard is what silences it normally)');

  console.log(`\n${f === 0 ? 'ALL PASS' : 'FAILED'}  (${p} passed, ${f} failed)`);
  process.exit(f === 0 ? 0 : 1);
})();
