// LST-261: Home order (range + KPI above the jars), glass jars of balls, fly code path,
// reduced-motion, and the inert ?demoQueue=1 hook. Loads the BUILT dashboard.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, name, got) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); } };

function boot(query, reduce) {
  return new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://127.0.0.1:8477/dashboard.html' + (query || ''), pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = q => ({ matches: !!reduce && /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      function Stub() { this.destroy = () => {}; this.update = () => {}; this.data = {}; this.options = {}; this.scales = {}; this.getDatasetMeta = () => ({ data: [] }); }
      Stub.register = () => {}; Stub.defaults = { font: {}, color: '' }; Stub.getChart = () => null; Stub.registerables = [];
      w.Chart = Stub;
      const m = new Map();
      Object.defineProperty(w, 'localStorage', { value: { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: () => null, length: 0 }, configurable: true });
    },
  });
}

// ---- CSS: order on Home
const ord = sel => { const m = html.match(new RegExp(sel.replace(/[.#>\[\]="]/g, '\\$&') + '\\{order:(-?\\d+)\\}')); return m ? +m[1] : null; };
const head = ord('.page[data-pageview="Home"] > .pagehead'), rng = ord('.page[data-pageview="Home"] > #rangebar'),
  lk = ord('.page[data-pageview="Home"] > .view[data-view="Home"] > .lkpis'), kp = ord('.page[data-pageview="Home"] > #kpis'),
  qc = ord('.page[data-pageview="Home"] > .view[data-view="Home"] > #qcard'), lg = ord('.page[data-pageview="Home"] > .view[data-view="Home"] > .livegrid');
chk([head, rng, lk, kp, qc, lg].every(x => x !== null) && head < rng && rng < lk && lk < kp && kp < qc && qc < lg,
  'Home order: title < range < KPI cards < task queue < in progress', [head, rng, lk, kp, qc, lg].join(','));

// ---- CSS: glass + fill motion + reduced motion
chk(/\.qt-body\{[^}]*backdrop-filter:blur/.test(html), 'jar body has backdrop-filter blur');
chk(/\.qt-body\{[^}]*border-radius:0 0 30px 30px[^}]*clip-path:polygon\(/.test(html) && /\.qt-jar\{[^}]*drop-shadow\(0 0 \.7px rgba\(255,255,255,\.75\)\)/.test(html), 'curved shoulders into a neck (clip-path) with a bright outer rim');
chk(/\.qt-body\{[^}]*linear-gradient\(180deg,rgba\(255,255,255,\.07\),rgba\(255,255,255,\.02\)\)/.test(html) && /\.qt-body\{[^}]*inset 2px 0 0 rgba\(255,255,255,\.35\)/.test(html), 'jar body is a translucent glass gradient with bright wall edges');
chk(/\.qt-jar::after\{[^}]*filter:blur/.test(html), 'blurred specular streak on the jar');
chk(/\.qt-lid::after\{/.test(html) && !/\.qt-lid\{[^}]*justify-content:space-between/.test(html), 'lid + neck silhouette, no kanban header bar');
chk(/\.qt-body::before\{[^}]*transition:height \.8s cubic-bezier/.test(html), 'fill level eases on height');
chk(/\.qt-jar\.qt-splash \.qt-body::after\{[^}]*qt-splash/.test(html) && /@keyframes qt-splash\b/.test(html), 'yard splash keyframes exist');
chk(/@keyframes qt-wave\b/.test(html) && /@keyframes qt-bump\b/.test(html), 'wave and count-bump keyframes exist');
chk(/@keyframes qt-ball-in\{0%\{opacity:0;transform:translateY\(calc\(var\(--drop,60px\) \* -1\)\)\}/.test(html) && /\.qt-ball\.qt-arrive\{animation:qt-ball-in/.test(html), 'a new ball drops in from above with a bounce');
chk(/prefers-reduced-motion: reduce\)\{[^]*?\.qt-body::before,\.qt-body::after,[^{]*\{transition:none;animation:none\}/.test(html), 'reduced motion: instant fill, no wave');
chk(/prefers-reduced-motion: reduce\)\{[^]*?\.qt-ball\.qt-arrive,\.qt-ball\.qt-land\{animation:qt-ball-fade[^]*?\.qt-run \.qt-ball-g\{box-shadow:0 0 0 3px[^]*?\.qt-ghost\{display:none\}/.test(html), 'reduced motion: no bounce or flight, a static halo on running balls');

// ---- balls: material, no scrolling anywhere in a jar, hit target, popover shell
chk(/\.qt-ball\{[^}]*border-radius:50%[^}]*radial-gradient\(circle at 32% 26%[^}]*box-shadow:0 0 0 1px[^}]*inset 0 -2px 3px/.test(html), 'a ball is a glossy marble (specular dot, darker rim, core shadow, drop shadow)');
chk(/\.qt-ball\.qt-run\{[^}]*border-radius:999px/.test(html) && /\.qt-ball\.qt-run::after\{/.test(html) && /@keyframes qt-ball-pulse\b/.test(html), 'running = a glowing capsule clip with a pulsing halo');
chk(/\.qt-ball\.qt-warn\{[^}]*0 0 0 2px var\(--z-warn\)/.test(html), 'waiting/stuck = a thin ring');
chk(!/\.qt-(?:cars|body|jar|sec)\{[^}]*overflow(?:-y)?:(?:auto|scroll)/.test(html), 'no jar rule scrolls');
chk(/\.qt-overflow\{[^}]*font-size:14px/.test(html), 'the +N chip is 14px');
chk(/@media \(pointer:coarse\)\{\.qt-ball::before\{[^}]*inset:calc\(\(32px - 100%\) \/ -2\)/.test(html), 'touch screens get a 32px hit area on small balls');
chk(/\.qt-legend\{/.test(html) && /qt-sw-claude\{--k:var\(--kind-claude\)/.test(html), 'a legend names the ball colours');
chk(!/#[0-9a-fA-F]{3,8}\b/.test((html.match(/\.qt-ball\{[^}]*\}/) || [''])[0]), 'ball CSS has no hex colour literals');

// ---- LST-261 pass 2: ghost keeps the destination size (no scaled text), jar bottom padding, tooltip hides
chk(/qtFly[^]*?width:\$\{to\.width\}px/.test(html) && !/scale\(\$\{sx\}/.test(html), 'the flying ghost is a ball the size of its destination and only translates/rotates');
chk(/\.qt-body\{[^}]*padding:84px 8px 14px/.test(html), 'jar body keeps padding below the shoulders');
chk(/tr\.addEventListener\('mouseleave', hide\)/.test(html), 'ball tooltip hides when the pointer leaves the jars');
chk(/jr\.bottom \+ g/.test(html), 'ball tooltip prefers a spot outside the jar');

const dom = boot('');
setTimeout(() => {
  const w = dom.window, d = w.document, ev = s => w.eval(s);
  try {
    const FOLLOW = w.Node.DOCUMENT_POSITION_FOLLOWING;
    chk(d.querySelectorAll('.qt-jar').length === 3, 'three jars');
    chk([...d.querySelectorAll('.qt-jar')].every(j => j.querySelector('.qt-lid > .qt-n') && j.querySelector('.qt-body > .qt-cars')) && d.querySelectorAll('.qt-sec > .qt-name').length === 3, 'each jar: count on the lid, balls in the body, label under the jar');
    ev(`DATA.ollama={hosts:[]}; DATA.pi_live=null; DATA.agent_live=null; DATA.profiles[current].live=[]; DATA.profiles[current].recent_sessions=[]; renderQueue();`);
    ev(`paintTrain([], [], [])`);
    chk(d.getElementById('qt-done').closest('.qt-jar').style.getPropertyValue('--wv') === '0', 'empty jar has no wave');
    ev(`paintTrain([], [], [{key:'s:z1',kind:'d',label:'Z1',hue:10,last_ts:Date.now()/1000}])`);
    ev(`paintTrain([], [], [{key:'s:z1',kind:'d',label:'Z1',hue:10,last_ts:Date.now()/1000}])`);
    d.querySelector('.qt-yard .qt-jar').classList.remove('qt-splash');
    ev(`paintTrain([], [], [{key:'s:z1',kind:'d',label:'Z1',hue:10,last_ts:Date.now()/1000}])`);
    chk(!d.querySelector('.qt-yard .qt-jar').classList.contains('qt-splash'), 'no splash when the yard count did not rise');
    ev(`paintTrain([], [], [{key:'s:z1',kind:'d',label:'Z1',hue:10,last_ts:Date.now()/1000},{key:'s:z2',kind:'d',label:'Z2',hue:10,last_ts:Date.now()/1000}])`);
    chk(d.querySelector('.qt-yard .qt-jar').classList.contains('qt-splash'), 'yard splashes when a task lands');
    chk(ev('qtDemoOn()') === false, 'demo hook off without ?demoQueue=1');
    chk(ev('(()=>{const a=[1],b=[2],c=[3];const r=qtDemoApply(a,b,c);return r[0]===a&&r[1]===b&&r[2]===c})()'), 'demo hook is inert (lists untouched)');
    // stable ids + FLIP: a task moving jars keeps its key and flies (ghost created) when rects exist
    ev(`DATA.ollama={hosts:[]}; DATA.pi_live=null; DATA.agent_live=null; DATA.profiles[current].live=[]; DATA.profiles[current].recent_sessions=[]; renderQueue();`);
    ev(`paintTrain([], [{key:'s:x1',kind:'r',eng:'hermes',label:'T1',state:'running',idle_s:1,hue:10}], [])`);
    const rb = d.getElementById('qt-running'), db = d.getElementById('qt-done');
    chk(rb.querySelector('[data-key="s:x1"]'), 'running ball keyed by task id');
    chk(d.getElementById('qpop') && d.getElementById('qpop').getAttribute('role') === 'dialog', 'click popover shell exists');
    chk(rb.querySelector('[data-key="s:x1"]').tagName === 'BUTTON' && /running/.test(rb.querySelector('[data-key="s:x1"]').getAttribute('aria-label')), 'a ball is a focusable button with an aria-label');
    const rect = (l, t) => ({ left: l, top: t, width: 100, height: 50, right: l + 100, bottom: t + 50 });
    const calls = [];
    w.Element.prototype.getBoundingClientRect = function () { return this.classList && this.classList.contains('qt-ball') && this.parentNode === db ? rect(400, 10) : rect(10, 10); };
    const anims = [];
    w.Element.prototype.animate = function (kf, o) { calls.push({ kf, o, cls: this.className }); const a = {}; anims.push(a); return a; };
    const yardJar = d.querySelector('.qt-yard .qt-jar');
    yardJar.classList.remove('qt-splash');
    ev(`paintTrain([], [], [{key:'s:x1',kind:'d',label:'T1',hue:10,last_ts:Date.now()/1000}])`);
    const fly = calls.find(c => /qt-ghost/.test(c.cls));
    chk(!!fly && fly.kf.length === 3 && fly.o.duration >= 600 && fly.o.duration <= 1000, 'running->done flies a ghost along a 3-point arc', JSON.stringify(calls.map(c => c.cls)));
    chk(!!db.querySelector('[data-key="s:x1"]'), 'same key lands in the yard');
    chk(!yardJar.classList.contains('qt-splash'), 'no splash while the ball is still in the air');
    anims[0].onfinish();
    chk(yardJar.classList.contains('qt-splash'), 'the splash fires when the ball lands');
    chk(!db.querySelector('[data-key="s:x1"]').style.visibility, 'the real ball is revealed on landing');
    // six balls move at once: at most four fly, 70ms apart; the rest just appear
    calls.length = 0; anims.length = 0;
    const six = n => Array.from({ length: 6 }, (_, i) => `{key:'s:m${i}',kind:'${n}',eng:'hermes',label:'M${i}',state:'running',idle_s:1,last_ts:Date.now()/1000}`).join(',');
    ev(`paintTrain([], [${six('r')}], [])`);
    calls.length = 0; anims.length = 0;
    ev(`paintTrain([], [], [${six('d')}])`);
    const ghosts = calls.filter(c => /qt-ghost/.test(c.cls));
    chk(ghosts.length === 4, 'at most four balls fly at once', ghosts.length);
    chk(ghosts.map(g => g.o.delay).join() === '0,70,140,210', 'flights are staggered by 70ms', ghosts.map(g => g.o.delay).join());
    chk(ghosts.every(g => g.kf[2].transform.includes('rotate(220deg)')), 'balls tumble along the arc');
    chk(d.getElementById('qt-n-done').classList.contains('qt-bump'), 'yard count bumps');
  } catch (e) { fail++; console.log('  FAIL threw', e && e.stack); }

  // reduced motion: no flight
  const d2 = boot('', true);
  setTimeout(() => {
    try {
      const w2 = d2.window;
      w2.eval(`paintTrain([], [{key:'s:y',kind:'r',eng:'hermes',label:'Y',state:'running',idle_s:1,hue:1}], [])`);
      w2.Element.prototype.getBoundingClientRect = () => ({ left: 5, top: 5, width: 90, height: 40 });
      w2.Element.prototype.animate = () => ({});
      w2.eval(`window.__r = qtFly(document.getElementById('qtrain'), {left:0,top:0,width:50,height:20}, document.querySelector('.qt-ball'), 'x')`);
      chk(w2.__r === false, 'reduced motion: qtFly does not animate');
    } catch (e) { fail++; console.log('  FAIL threw2', e && e.stack); }
    // demo hook active
    const d3 = boot('?demoQueue=1');
    setTimeout(() => {
      try {
        const w3 = d3.window;
        chk(w3.eval('qtDemoOn()') === true, 'demo hook on with ?demoQueue=1');
        const ph = [0, 1, 2].map(s => w3.eval(`(QT_DEMO.step=${s}, qtDemoApply([],[],[]).map(a=>a.length))`).join());
        chk(ph.join('|') === '1,0,0|0,1,0|0,0,1', 'demo task cycles Depot -> Line -> Yard', ph.join('|'));
      } catch (e) { fail++; console.log('  FAIL threw3', e && e.stack); }
      console.log(`\n${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    }, 800);
  }, 800);
}, 1000);
