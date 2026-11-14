// LLMTELEMET-273 (H-6): Hive sound + voice. SFX graph structure, unlock wiring (nothing plays before the
// first gesture), voice hash stability, project-name prefix, real-data-only triggering.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src/llm_telemetry/web');
const src = fs.readFileSync(path.join(dir, 'js/hive.js'), 'utf8');
let p = 0, f = 0; const chk = (ok, l, x) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${!ok && x !== undefined ? ' — ' + JSON.stringify(x) : ''}`); ok ? p++ : f++; };

(async () => {
  const { isolate } = await import('./lib/isolate.mjs');
  const mkCtx = () => {
    const ctx = { state: 'running', currentTime: 0, sampleRate: 8000, destination: {}, osc: 0, noise: 0, gains: 0 };
    const node = () => ({ connect() {}, start() {}, stop() {}, gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: {} });
    ctx.createOscillator = () => { ctx.osc++; return node(); };
    ctx.createGain = () => { ctx.gains++; return node(); };
    ctx.createBiquadFilter = node; ctx.createDynamicsCompressor = node;
    ctx.createBuffer = (c, n) => ({ getChannelData: () => new Float32Array(n) });
    ctx.createBufferSource = () => { ctx.noise++; return node(); };
    return ctx;
  };
  const ctx = mkCtx(); let ensured = 0;
  const H = await isolate('hive.js', {
    'palette.js': { $: () => null, esc: s => String(s == null ? '' : s), ago: s => s + 's' },
    'views.js': { provOf: () => 'cloud', provLogoSvg: () => '<svg class="x"></svg>' },
    'zoom.js': { attachZoom: () => ({}) },
    'live.js': { ensureAudioCtx: () => { ensured++; return ctx; } },
  });
  const S = H.hvSnd, noon = 12;
  const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [2026, 10, 14, noon, 0, 0])); } static now() { return RealDate.now(); } };

  // ---- SFX inventory: every cue exists and builds a real audio graph ----
  const names = ['launch', 'arrive', 'newTask', 'done', 'blocked', 'running', 'whoosh', 'click', 'blast', 'casings', 'hit', 'shatter', 'charge', 'dizzy', 'grumble', 'boom', 'rage', 'calm', 'kettle'];
  chk(names.every(n => typeof H.HV_SFX[n] === 'function'), 'SFX inventory complete (F23/F24 + calm + kettle)');
  chk(!/a_aah|\.mp3|refs\//.test(src), 'no a_aah.mp3, audio files or reference material');
  S.ctx = ctx; S.m = ctx.createGain(); S.on = true; S.show = true;
  for (const n of names) { const before = ctx.osc + ctx.noise; S.k = 1; S.pv = 1; H.HV_SFX[n](n === 'rage' ? 2 : n === 'kettle' ? 3 : 'root'); chk(ctx.osc + ctx.noise > before, `${n} creates oscillators/noise`); }
  const o0 = ctx.osc; H.HV_SFX.rage(1); const o1 = ctx.osc; H.HV_SFX.rage(3); const o2 = ctx.osc;
  chk(o1 - o0 < o2 - o1, '3-level rage escalates (level 3 adds stomps)', [o1 - o0, o2 - o1]);
  const k0 = ctx.osc; H.HV_SFX.kettle(0); const k1 = ctx.osc; H.HV_SFX.kettle(3);
  chk(ctx.osc - k1 > k1 - k0, 'kettle band 3 (klaxon) is fuller than band 0 (steam)');

  // ---- unlock wiring: nothing before a gesture ----
  S.ctx = null; S.m = null; S.last = {};
  const realSI = globalThis.setInterval; let intervals = 0; globalThis.setInterval = () => { intervals++; return 1; };
  chk(H.hvPlay('done', 'root') === false && ensured === 0, 'no sound and no AudioContext before the first gesture');
  const listeners = {}; globalThis.window = { addEventListener: (e, fn) => { listeners[e] = fn; }, removeEventListener: e => { delete listeners[e]; } };
  S.show = false;
  globalThis.localStorage = { _: {}, getItem(k) { return k in this._ ? this._[k] : null; }, setItem(k, v) { this._[k] = String(v); } };
  H.hvSndInit();
  chk(ensured === 0 && ['pointerdown', 'keydown', 'touchend'].every(e => listeners[e]), 'init arms Hive\'s own gesture listeners only (no second armAudioUnlock), still no AudioContext');
  chk(intervals === 0 && !/setInterval/.test(src.slice(src.indexOf('export function hvSndInit'), src.indexOf('Comms, events, replay'))), 'sound init starts no timer (no timed narrator)', intervals);
  chk(S.on && S.voice, 'sound and voice default to on');
  listeners.pointerdown();
  chk(ensured === 1 && S.ctx === ctx && S.m, 'first gesture resumes the shared context and builds the master chain');
  chk(!listeners.pointerdown && !listeners.keydown, 'unlock disarms the gesture listeners');
  chk(H.hvPlay('done', 'root') === true, 'after the gesture a cue plays');
  chk(H.hvPlay('done', 'root') === false, 'per-event cooldown drops an immediate repeat');
  S.on = false; S.last = {}; chk(H.hvPlay('done', 'root') === false, 'master mute silences cues');
  S.on = true;
  // leaving Hive: nothing plays or speaks, listeners removed, hum stopped
  S.last = {}; S.show = false; chk(H.hvPlay('done', 'root') === false, 'nothing plays when the Hive tab is not showing'); S.show = true;

  // ---- persistence ----
  chk(src.includes("'hiveSound'") && src.includes("'hiveVoice'") && src.includes("'hiveAmb'") && src.includes("'hiveVol'"), 'toggles + volume persist in localStorage');
  chk(/ambient|hvAmbient/.test(src) && typeof H.hvAmbient === 'function', 'ambient hum toggle present');

  // ---- voice ----
  const a = H.hvVoice('beinno-donna', 0, '', 7), b = H.hvVoice('beinno-donna', 0, '', 7), c = H.hvVoice('llm-telemetry-brain', 0, '', 7);
  chk(JSON.stringify(a) === JSON.stringify(b) && a.vi === H.hvHash('beinno-donna') % 7, 'voice hash is stable per profile', a);
  chk(a.vi !== c.vi || a.pitch !== c.pitch, 'different profiles get different voices');
  const calm = H.hvVoice('x', 0), mad = H.hvVoice('x', 3);
  chk(mad.pitch < calm.pitch && mad.rate > calm.rate && mad.volume >= calm.volume, 'anger lowers pitch and raises rate');
  chk(H.hvVoice('x', 0, 'happy').pitch > calm.pitch, 'happy mood raises pitch');
  chk(H.hvLine('LLM Telemetry', 'Task finished.') === 'On LLM Telemetry. Task finished.', 'line names the project');
  chk(H.hvLine('', 'Hi.') === 'Hi.', 'no project, no prefix');
  chk(H.hvLine('P', 'Task blocked.', 3) === 'On P. Task blocked!', 'level 3 ends with "!"');
  const said = []; globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  globalThis.speechSynthesis = { pending: false, speaking: false, getVoices: () => [{ lang: 'en-US' }, { lang: 'en-GB' }], speak: u => said.push(u), cancel() {} };
  chk(H.hvSay('b1', 'Task finished.', 'Proj') && said[0].text === 'On Proj. Task finished.' && !!said[0].voice, 'say() speaks the project-prefixed line with a voice');
  S.voice = false; chk(H.hvSay('b1', 'x', 'Proj') === false, 'voice toggle off silences speech'); S.voice = true;
  let vl = []; globalThis.speechSynthesis.getVoices = () => vl; S.vs = null; said.length = 0;
  chk(H.hvSay('b1', 'x', 'Proj') === false && !said.length, 'no voice list yet: silent instead of using the default voice');
  vl = [{ lang: 'en-US', n: 1 }, { lang: 'en-GB', n: 2 }, { lang: 'en-AU', n: 3 }]; H.hvSay('b1', 'x', 'Proj'); const v1 = said[0].voice;
  vl = [{ lang: 'en-US', n: 9 }]; H.hvSay('b1', 'x', 'Proj');
  chk(said.length === 2 && said[1].voice === v1, 'voice is cached once the list exists and never changes mid-session', said.map(u => u.voice));
  vl = [{ lang: 'en-US' }, { lang: 'en-GB' }];

  // ---- real data only: baseline is silent, changes sound ----
  const snapOf = (k, p = 0, a = 0) => ({ snap: { families: [{ id: 'root', brains: [{ id: 'b1', label: 'Proj', counts: { running: 0, blocked: 0, todo: 0, ready: 0, done: 0, ...k } }] }] }, model: { sys: { p, a }, counts: { running: 0, queued: 0, blocked: 0 } } });
  S.prev = null; S.last = {}; let n0 = ctx.osc;
  let x = snapOf({ done: 3 }); H.hvSoundDiff(x.snap, x.model);
  chk(ctx.osc === n0, 'first snapshot is a baseline: no sound for what already happened');
  x = snapOf({ done: 3 }); H.hvSoundDiff(x.snap, x.model); chk(ctx.osc === n0, 'an unchanged snapshot is silent (no fake events)');
  x = snapOf({ done: 4 }); H.hvSoundDiff(x.snap, x.model); chk(ctx.osc > n0, 'a real done increment plays a cue');
  n0 = ctx.osc; x = snapOf({ done: 4 }, .95, .9); H.hvSoundDiff(x.snap, x.model);
  chk(ctx.osc > n0 && S.lv === 3, 'pressure/anger rise plays kettle + rage level 3');

  // steady pressure: kettle at most once across several snapshots; only a rising band plays again
  S.prev = null; S.last = {}; S.pb = -1; S.lv = 0; S.show = true;
  let kc = 0; const KS = H.HV_SFX.kettle; H.HV_SFX.kettle = b => { kc++; KS(b); };
  for (let i = 0; i < 6; i++) { x = snapOf({ done: 4 }, .75, 0); H.hvSoundDiff(x.snap, x.model); S.last = {}; }
  chk(kc === 0, 'first snapshot at high pressure is a silent baseline', kc);
  S.prev = null; S.pb = -1; kc = 0;
  for (let i = 0; i < 6; i++) { x = snapOf({ done: 4 }, i ? .75 : .1, 0); H.hvSoundDiff(x.snap, x.model); S.last = {}; }
  chk(kc === 1, 'steady 75% pressure over six snapshots plays the kettle exactly once', kc);
  x = snapOf({ done: 4 }, .95, 0); H.hvSoundDiff(x.snap, x.model); S.last = {};
  chk(kc === 2, 'a higher band plays it again', kc);
  x = snapOf({ done: 4 }, .3, 0); H.hvSoundDiff(x.snap, x.model); x = snapOf({ done: 4 }, .3, 0); H.hvSoundDiff(x.snap, x.model);
  chk(kc === 2, 'falling pressure is silent', kc);
  H.HV_SFX.kettle = KS;

  // ---- hvStop: nothing left running or armed ----
  S.amb = true; S.a = null; S.m = S.m || ctx.createGain(); H.hvAmbient(true); chk(!!S.a, 'ambient hum starts at noon');
  S.prev = {}; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [2026, 10, 14, 23, 0, 0])); } static now() { return RealDate.now(); } };
  x = snapOf({ done: 4 }); H.hvSoundDiff(x.snap, x.model); chk(!S.a, 'hum stops when quiet hours begin');
  chk(H.hvAmbient(true) === undefined && !S.a, 'hum does not start during quiet hours');

  // ---- quiet hours (23:00): only done/dizzy, speech muted ----
  S.last = {}; chk(H.hvPlay('blocked') === false && H.hvPlay('launch', 'root') === false && H.hvPlay('kettle', 0) === false && H.hvPlay('rage', 2) === false, 'quiet hours mute blocked, launch, kettle and rage');
  chk(H.hvPlay('done', 'root') === true && H.hvPlay('dizzy') === true, 'quiet hours still allow done and dizzy');
  chk(S.k === .35, 'quiet cues are softer', S.k);
  said.length = 0; chk(H.hvSay('b1', 'x', 'Proj') === false && !said.length, 'speech is muted in quiet hours');
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [2026, 10, 14, noon, 0, 0])); } static now() { return RealDate.now(); } };

  // ---- prefers-reduced-motion mutes the loud cues ----
  globalThis.matchMedia = q => ({ matches: /reduce/.test(q) }); S.last = {};
  chk(H.hvPlay('shatter') === false && H.hvPlay('blast', 'root') === false && H.hvPlay('boom') === false && H.hvPlay('charge') === false, 'reduced motion mutes shatter, blast, boom, charge');
  chk(H.hvPlay('kettle', 2) === false && H.hvPlay('kettle', 0) === true, 'reduced motion mutes kettle above steam, keeps the soft steam');
  S.last = {}; H.hvPlay('done', 'root'); chk(S.k === .5, 'reduced motion halves cue volume', S.k);
  delete globalThis.matchMedia; S.last = {};

  // ---- hvStop: no timers, listeners disarmed, hum stopped, speech cancelled ----
  let cancelled = 0; globalThis.speechSynthesis.cancel = () => cancelled++;
  H.hvAmbient(true); H.hvSndInit(); chk(S.show && (S.m ? true : !!listeners.pointerdown), 'returning to Hive re-arms until unlocked');
  S.m = null; S.unl = []; H.hvSndInit(); chk(!!listeners.pointerdown, 'listeners re-armed while locked');
  H.hvStop(); chk(!listeners.pointerdown && !listeners.keydown && !listeners.touchend && !S.show && !S.a && cancelled === 1, 'hvStop disarms listeners, stops the hum, cancels speech', [S.show, !!S.a, cancelled]);
  chk(intervals === 0, 'no setInterval was created by the sound module', intervals);
  globalThis.setInterval = realSI;
  globalThis.Date = RealDate;

  // ---- source-level rules ----
  chk(/hvHooks|hvSoundDiff\(snap, model\)/.test(src) && /if \(fresh\) hvSoundDiff/.test(src), 'hvRender drives sound only from fresh snapshots');
  chk(!/#[0-9a-fA-F]{3,6}\b/.test(src.slice(src.indexOf('// ---- Sound + voice'))), 'sound section has no hard-coded colours (--hv-* tokens only)');
  console.log(`${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
})().catch(e => { console.log('  FAIL ' + (e && e.stack || e)); console.log(`${p} passed, ${f + 1} failed`); process.exit(1); });
