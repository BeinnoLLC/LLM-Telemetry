// UI pass U-2: the filter bar. Range = segmented radiogroup + Custom popover;
// Session/Provider/Model = searchable single-select comboboxes with removable
// chips and one Clear all; state mirrored in the hash; Transferred lives in
// Usage -> Bandwidth, not the filter bar.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'examples', 'reports', 'dashboard.html'), 'utf8');
let pass = 0, fail = 0;
const chk = (ok, l, x) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}${x !== undefined ? '  ' + x : ''}`); ok ? pass++ : fail++; };

function boot(hash) {
  return new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:8477/dashboard.html' + (hash || '#/home'),
    beforeParse(w) {
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => null;
      w.Element.prototype.scrollIntoView = () => {};
    },
  });
}
const key = (w, el, k) => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const typeInto = (w, el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const calls = w => w.eval(`(()=>{const p=DATA.profiles[current];const f=$('from').value,t=$('to').value;
  return p.rows.filter(r=>r.date>=f&&r.date<=t&&(!PROVIDER_FILTER||r.provider===PROVIDER_FILTER)&&(!MODEL_FILTER||r.model===MODEL_FILTER)&&(!PROJECT_FILTER||(r.project||'Unattributed')===PROJECT_FILTER)).length})()`);

const dom = boot();
setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    // ---- markup ----------------------------------------------------------
    const bar = d.getElementById('filterbar');
    chk(!!bar && !d.getElementById('rangebar') && !d.getElementById('projfilterbar'), 'one .filterbar replaces the range and filter cards');
    chk(!bar.querySelector('#xfercard') && !d.querySelector('.page > #xfercard'), 'Transferred is absent from the filter bar and from the Home level');
    const bw = d.querySelector('.view[data-view="Usage"] #bwpanel #xfercard');
    chk(!!bw && /↑/.test(bw.textContent + d.getElementById('xfertot').textContent), 'Transferred is present in Usage -> Bandwidth');

    // ---- segmented control: role + keyboard -------------------------------
    const seg = d.getElementById('presets');
    const radios = [...seg.querySelectorAll('[role=radio]')];
    chk(seg.getAttribute('role') === 'radiogroup' && radios.length === 8, 'presets are one radiogroup of 8 radios', radios.length);
    chk(radios.filter(r => r.getAttribute('aria-checked') === 'true').length === 1, 'exactly one radio is checked');
    chk(radios.filter(r => r.tabIndex === 0).length === 1, 'roving tabindex: one tab stop in the group');
    const checked = () => seg.querySelector('[aria-checked=true]').dataset.key;
    chk(checked() === 'all', 'default range is All', checked());
    radios[3].focus(); // 24h
    key(w, radios[3], 'ArrowRight');
    chk(checked() === '7d' && d.activeElement === radios[4], 'ArrowRight moves focus and selects the next preset', checked());
    chk(/range=7d/.test(w.location.hash), 'the choice is mirrored into the hash', w.location.hash);
    key(w, radios[4], 'ArrowLeft'); key(w, radios[3], 'ArrowLeft');
    chk(checked() === '12h' && w.eval('HOUR_RANGE') === 12, 'ArrowLeft goes back through the hour presets', checked());
    key(w, d.activeElement, 'End');
    chk(d.activeElement === radios[7] && checked() === '12h', 'End focuses Custom without selecting it (it opens a popover)', checked());
    key(w, d.activeElement, 'Home');
    chk(d.activeElement === radios[0] && checked() === '1h', 'Home jumps to the first preset');
    radios[7].focus(); key(w, radios[7], 'ArrowRight');
    chk(d.activeElement === radios[0], 'arrows wrap around');

    // ---- Custom reveals the date inputs -----------------------------------
    const pop = d.getElementById('rangepop');
    chk(pop.hidden, 'date popover is hidden until Custom is used');
    radios[7].click();
    chk(!pop.hidden && !!pop.querySelector('#from') && !!pop.querySelector('#to'), 'Custom reveals the From/To inputs');
    const a = w.eval(`$('from').min`), b = w.eval(`$('to').max`);
    d.getElementById('from').value = a; d.getElementById('to').value = a;
    d.getElementById('from').dispatchEvent(new w.Event('change'));
    chk(checked() === 'custom' && /range=\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}/.test(w.location.hash), 'a custom range checks Custom and writes from_to', w.location.hash);
    chk(/\d{4}-\d{2}-\d{2}/.test(radios[7].textContent), 'the Custom segment shows the active dates', radios[7].textContent);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    chk(pop.hidden, 'Escape closes the popover');
    radios[6].click(); // All
    chk(checked() === 'all' && !/range=/.test(w.location.hash), 'All clears the range param', w.location.hash);

    // ---- comboboxes -------------------------------------------------------
    const combos = [...d.querySelectorAll('.combo')];
    chk(combos.length === 3, 'Session, Provider and Model comboboxes exist', combos.length);
    const prov = combos[1], btn = prov.querySelector('.combo-btn'), inp = prov.querySelector('.combo-q');
    const list = () => [...prov.querySelectorAll('[role=option]')];
    chk(btn.getAttribute('aria-haspopup') === 'listbox' && btn.getAttribute('aria-expanded') === 'false', 'trigger advertises a listbox, closed');
    btn.click();
    chk(btn.getAttribute('aria-expanded') === 'true' && !prov.querySelector('.combo-pop').hidden, 'click opens it');
    chk(inp.getAttribute('role') === 'combobox' && inp.getAttribute('aria-controls') === prov.querySelector('[role=listbox]').id, 'search input is an ARIA combobox controlling the listbox');
    const all = list().map(o => o.dataset.v);
    chk(all.length >= 3, 'lists the providers present in the data', all.length);
    const needle = all[0].slice(1, 4).toLowerCase();
    typeInto(w, inp, needle);
    const hit = list().map(o => o.dataset.v);
    chk(hit.length > 0 && hit.every(v => v.toLowerCase().includes(needle)) && hit.length <= all.length, 'typing filters case-insensitively by substring', `${needle} -> ${hit.join(',')}`);
    chk(!!prov.querySelector('mark'), 'the match is highlighted');
    typeInto(w, inp, 'zzzz-no-such');
    chk(list().length === 0 && /No match/.test(prov.textContent), 'no match says so');
    typeInto(w, inp, '');
    key(w, inp, 'ArrowDown');
    chk(list()[1].classList.contains('act') && inp.getAttribute('aria-activedescendant') === list()[1].id, 'ArrowDown moves the active option (aria-activedescendant)');
    const want = list()[1].dataset.v;
    key(w, inp, 'Enter');
    chk(w.eval('PROVIDER_FILTER') === want, 'Enter applies the active option', w.eval('PROVIDER_FILTER'));
    chk(prov.querySelector('.combo-pop').hidden && d.activeElement === btn, 'the popup closes and focus returns to the trigger');
    chk(new w.URLSearchParams(w.location.hash.split('?')[1]).get('provider') === want, 'the choice is in the hash', w.location.hash);
    chk(btn.classList.contains('has') && /^Provider/.test(btn.textContent) && btn.textContent.includes(want), 'trigger shows the selection', btn.textContent);
    // Escape restores focus without changing anything
    btn.click(); key(w, prov.querySelector('.combo-q'), 'Escape');
    chk(prov.querySelector('.combo-pop').hidden && d.activeElement === btn && w.eval('PROVIDER_FILTER') === want, 'Escape closes and restores focus, selection unchanged');

    // ---- chips -------------------------------------------------------------
    const model = combos[2];
    model.querySelector('.combo-btn').click();
    key(w, model.querySelector('.combo-q'), 'Enter');
    const mval = w.eval('MODEL_FILTER');
    chk(!!mval, 'a model can be picked too', mval);
    const chips = () => [...d.querySelectorAll('#fbactive .fchip-on')];
    chk(chips().length === 2, 'each active selection shows as a chip', chips().length);
    chk(!!d.getElementById('projfilterclear') && /Clear all/.test(d.getElementById('projfilterclear').textContent), 'one Clear all appears');
    const n = calls(w);
    chips()[0].click();
    chk(chips().length === 1 && w.eval('PROVIDER_FILTER') === '', 'clicking a chip removes just that filter', chips().length);
    chk(!/provider=/.test(w.location.hash) && /model=/.test(w.location.hash), 'and updates the hash', w.location.hash);
    chk(calls(w) >= n, 'removing a filter widens (or keeps) the row set');
    d.getElementById('projfilterclear').click();
    chk(chips().length === 0 && !d.getElementById('projfilterclear') && w.eval('MODEL_FILTER') === '', 'Clear all resets every filter and hides itself');
    chk(!/provider=|model=|project=/.test(w.location.hash), 'Clear all empties the filter part of the URL', w.location.hash);

    // ---- filtering results unchanged ---------------------------------------
    const p0 = w.eval(`DATA.profiles[current].rows.filter(r=>r.provider===${JSON.stringify(want)}).length`);
    const sel = d.getElementById('provfiltersel'); sel.value = want; sel.dispatchEvent(new w.Event('change'));
    chk(w.eval('PROVIDER_FILTER') === want && p0 > 0, 'the underlying select still drives the same filter state', p0);
    sel.value = ''; sel.dispatchEvent(new w.Event('change'));

    // ---- URL round-trip ----------------------------------------------------
    w.eval(`setCrossFilter('provider', ${JSON.stringify(want)}); setHourRange(6)`);
    const shared = w.location.hash;
    chk(/range=6h/.test(shared) && /provider=/.test(shared), 'state serialises to the hash', shared);
    const d2 = boot(shared);
    setTimeout(() => {
      const w2 = d2.window, q = w2.document;
      chk(w2.eval('PROVIDER_FILTER') === want && w2.eval('HOUR_RANGE') === 6, 'a reload from that URL restores provider and range');
      chk(q.querySelector('#presets [aria-checked=true]').dataset.key === '6h', 'the segmented control shows the restored range');
      chk(q.querySelectorAll('#fbactive .fchip-on').length === 1, 'and the chip is back');
      d2.window.close();
      const d3 = boot('#/usage?range=2026-09-20_2026-09-22&model=' + encodeURIComponent(mval));
      setTimeout(() => {
        const w3 = d3.window;
        chk(w3.eval(`$('from').value`) === '2026-09-20' && w3.eval(`$('to').value`) === '2026-09-22', 'a custom from_to range round-trips');
        chk(w3.eval('rangeKey()') === 'custom', 'and is shown as Custom');
        d3.window.close();
        console.log(`\ncheck_ui_u2.js  ${pass} passed, ${fail} failed`);
        process.exit(fail ? 1 : 0);
      }, 900);
    }, 900);
  } catch (e) { chk(false, 'checks crashed', e.stack.split('\n').slice(0, 3).join(' | ')); console.log(`\ncheck_ui_u2.js  ${pass} passed, ${fail} failed`); process.exit(1); }
}, 900);
