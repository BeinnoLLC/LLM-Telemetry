// Calculator. Rates are baked in at build time — the sheet is static, so the
// arithmetic has to happen client-side.
const M = __CALCDATA__;
const $ = id => document.getElementById(id);
const sel = $('cm');
// Every model on the sheet, grouped by what its number means (P6-04, #62):
// local = your electricity, metered = a vendor's per-token price, free tier
// = genuinely $0, unpriced = no rate exists. Models you have used come first
// inside each group, so the common case is not buried in 470 names.
const KIND = m => m.s === 'local' ? 'local'
  : m.s === 'unpriced' ? 'unpriced'
  : m.s === 'free-tier' ? 'free' : 'metered';
const GROUPS = [['local', 'Local (electricity)'], ['metered', 'Metered (billed per token)'],
                ['free', 'Free tier ($0)'], ['unpriced', 'Unpriced (no rate)']];
GROUPS.forEach(([k, label]) => {
  const ms = M.map((m, i) => [m, i]).filter(([m]) => KIND(m) === k)
    .sort(([a], [b]) => (b.u - a.u) || a.n.localeCompare(b.n));
  if (!ms.length) return;
  const g = document.createElement('optgroup');
  g.label = label + ' · ' + ms.length;
  g.dataset.kind = k;
  ms.forEach(([m, i]) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = m.n + (m.u ? '  • used' : '');
    g.appendChild(o);
  });
  sel.appendChild(g);
});
// Start on the dearest model you actually use: a realistic first answer.
{
  const used = M.map((m, i) => [m, i]).filter(([m]) => m.u && KIND(m) === 'metered')
    .sort(([a], [b]) => b.o - a.o);
  if (used.length) sel.value = String(used[0][1]);
}

// Accept "100,000", "100k", "1.5m" — nobody wants to count zeros.
function parseTokens(s){
  s = String(s).trim().toLowerCase().replace(/[, _]/g,'');
  const mult = s.endsWith('m') ? 1e6 : s.endsWith('k') ? 1e3 : 1;
  const n = parseFloat(mult === 1 ? s : s.slice(0,-1));
  return isFinite(n) && n >= 0 ? n * mult : 0;
}
const money = v => v >= 1 ? '$' + v.toFixed(2)
                 : v >= 0.01 ? '$' + v.toFixed(3)
                 : v > 0 ? '$' + v.toFixed(5)
                 : '$0.00';

function calc(){
  const m = M[sel.value]; if(!m) return;
  const k = KIND(m);
  $('ctot').dataset.kind = k;
  if (k === 'unpriced'){
    // Never $0 for a model with no rate: that is the silent-zero bug.
    $('ctot').textContent = 'no rate available';
    $('ctot').style.color = '#f87171';
    $('cbrk').innerHTML = 'This model has no price in the catalogue or WEB_RATES, '
      + 'so a job on it cannot be costed.';
    return;
  }
  const i = parseTokens($('ci').value), o = parseTokens($('co').value);
  const runs = Math.max(1, Math.round(parseTokens($('cr').value) || 1));
  const cin = i / 1e6 * m.i, cout = o / 1e6 * m.o;
  const total = (cin + cout) * runs;
  const what = k === 'local' ? 'electricity' : k === 'free' ? 'free tier' : 'billed';
  $('ctot').textContent = (k === 'local' ? '≈ ' : '') + money(total) + ' ' + what;
  $('ctot').style.color = k === 'local' ? '#fbbf24' : 'inherit';
  const per = runs > 1 ? ` &times; ${runs} runs` : '';
  $('cbrk').innerHTML =
    `in ${money(cin)} + out ${money(cout)}${per}` +
    (k === 'local' ? '<br>your power cost, not billed by anyone'
     : k === 'free' ? '<br>OpenRouter free tier: $0 per token' : '');
}
['cm','ci','co','cr'].forEach(id => {
  $(id).addEventListener('input', calc);
  $(id).addEventListener('change', calc);
});
calc();
