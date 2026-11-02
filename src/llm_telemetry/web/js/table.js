/**
 * Table: one helper for every data table (LST-223/224).
 *
 *   enhanceTable(tbl, id)  after a render has written the rows: header cells
 *       become sort buttons (aria-sort, Enter/Space), numeric columns are
 *       right-aligned with tabular figures, a density toggle is added, and the
 *       user's sort for `id` is re-applied (a refresh never resets it).
 *   sortValues / parseNum  pure helpers, also used to sort non-table lists.
 *   getDensity / setDensity  'comfortable' (default) or 'compact', kept in
 *       localStorage so the choice survives a reload.
 */
export const DENSITY_KEY = 'llmt.density';
export const TABLE_SORT = {};

export function getDensity(){
  try { return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'; }
  catch (e) { return 'comfortable'; }
}

export function applyDensity(){
  const v = getDensity();
  if (typeof document === 'undefined') return v;
  if (document.documentElement) document.documentElement.dataset.density = v;
  document.querySelectorAll('.dt-dens button').forEach(b => {
    const on = b.dataset.dens === v;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('on', on);
  });
  return v;
}

export function setDensity(d){
  const v = d === 'compact' ? 'compact' : 'comfortable';
  try { localStorage.setItem(DENSITY_KEY, v); } catch (e) { /* private mode: not persisted */ }
  return applyDensity() || v;
}

const NUM_RE = /^([+\-−])?\$?(\d[\d,]*\.?\d*|\.\d+)(K|M|B|T)?(?:\s?(KB|MB|GB|TB|B))?\s*(%|pp)?(?:\s[A-Za-z][A-Za-z ]*)?$/;
const MULT = {K: 1e3, M: 1e6, B: 1e9, T: 1e12, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776};

export function parseNum(s){
  let t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim().replace(/^[~≈]\s*/, '');
  let sign = 1;
  const arrow = t.charAt(0);
  if (arrow === '↑' || arrow === '↓'){ sign = arrow === '↓' ? -1 : 1; t = t.slice(1).trim(); }
  const m = NUM_RE.exec(t);
  if (!m) return null;
  let n = parseFloat(m[2].replace(/,/g, ''));
  if (!isFinite(n)) return null;
  n *= MULT[m[4] || m[3]] || 1;
  if (m[1] === '-' || m[1] === '−') sign = -sign;
  return sign * n;
}

export function sortValues(a, b, numeric){
  const ea = a == null || a === '', eb = b == null || b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (numeric) return a - b;
  return String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: 'base'});
}

function cellValue(td){
  if (!td) return null;
  if (td.dataset && td.dataset.v != null) return td.dataset.v;
  return (td.textContent || '').replace(/\s+/g, ' ').trim();
}

function isRightAligned(th){
  const c = th.className || '';
  return /(^|\s)(num|text-right)(\s|$)/.test(c) || /text-align:\s*right/.test(th.getAttribute('style') || '');
}

function headerAndRows(tbl){
  let head = tbl.querySelector('thead tr');
  let rows;
  if (head) rows = Array.from(tbl.querySelectorAll('tbody tr'));
  else {
    const all = Array.from(tbl.querySelectorAll('tr'));
    head = all[0];
    rows = all.slice(1);
  }
  return {head, rows};
}

function densityBar(){
  const v = getDensity();
  const b = (k, label) =>
    `<button type="button" data-dens="${k}" class="${v === k ? 'on' : ''}" aria-pressed="${v === k}">${label}</button>`;
  return `<span class="dt-dens" role="group" aria-label="Row density">${b('comfortable', 'Comfortable')}${b('compact', 'Compact')}</span>`;
}

function sortGlyph(state){
  return state === 'ascending' ? '▲' : state === 'descending' ? '▼' : '↕';
}

export function applySort(tbl, id){
  const {head, rows} = headerAndRows(tbl);
  if (!head || !rows.length) return;
  const ths = Array.from(head.children);
  const st = TABLE_SORT[id];
  const col = st ? ths.findIndex(th => th.dataset.dtLabel === st.label) : -1;
  ths.forEach((th, i) => {
    if (!th.dataset.dtSortable) return;
    const state = i === col ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    th.setAttribute('aria-sort', state);
    const g = th.querySelector('.dt-ar');
    if (g) g.textContent = sortGlyph(state);
  });
  if (col < 0) return;
  const numeric = ths[col].dataset.dtNum === '1';
  const pinned = rows.filter(r => r.dataset.pin === 'end');
  const body = rows.filter(r => r.dataset.pin !== 'end');
  const keyed = body.map((r, i) => {
    const raw = cellValue(r.children[col]);
    return {r, i, v: numeric ? parseNum(raw) : raw};
  });
  const sign = st.dir === 'asc' ? 1 : -1;
  keyed.sort((x, y) => {
    const xe = x.v == null || x.v === '', ye = y.v == null || y.v === '';
    if (xe || ye) return sortValues(x.v, y.v, numeric) || x.i - y.i;
    return sign * sortValues(x.v, y.v, numeric) || x.i - y.i;
  });
  const parent = body.length ? body[0].parentNode : null;
  if (!parent) return;
  const anchor = pinned.length ? pinned[0] : null;
  keyed.forEach(k => parent.insertBefore(k.r, anchor));
}

export function sortBy(tbl, id, label){
  const cur = TABLE_SORT[id];
  TABLE_SORT[id] = {label, dir: cur && cur.label === label && cur.dir === 'asc' ? 'desc' : 'asc'};
  applySort(tbl, id);
  return TABLE_SORT[id];
}

export function enhanceTable(tbl, id){
  if (!tbl || !tbl.querySelectorAll) return;
  tbl.classList.add('dt');
  const {head, rows} = headerAndRows(tbl);
  if (head){
    Array.from(head.children).forEach((th, i) => {
      const label = (th.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label || th.dataset.nosort != null) return;
      const vals = rows.map(r => cellValue(r.children[i])).filter(v => v != null && v !== '');
      const numeric = isRightAligned(th) || (vals.length > 0 && vals.every(v => parseNum(v) != null));
      th.dataset.dtLabel = label;
      th.dataset.dtSortable = '1';
      th.dataset.dtNum = numeric ? '1' : '0';
      th.setAttribute('aria-sort', 'none');
      if (numeric){
        th.classList.add('num');
        rows.forEach(r => { if (r.children[i]) r.children[i].classList.add('num'); });
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dt-sort';
      while (th.firstChild) btn.appendChild(th.firstChild);
      const ar = document.createElement('span');
      ar.className = 'dt-ar';
      ar.setAttribute('aria-hidden', 'true');
      ar.textContent = sortGlyph('none');
      btn.appendChild(ar);
      const fire = () => sortBy(tbl, id, label);
      btn.addEventListener('click', fire);
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fire(); }
      });
      btn.addEventListener('keyup', e => { if (e.key === ' ') e.preventDefault(); });
      th.appendChild(btn);
    });
  }
  let cap = tbl.querySelector('caption.dt-cap');
  if (!cap){
    cap = document.createElement('caption');
    cap.className = 'dt-cap';
    tbl.insertBefore(cap, tbl.firstChild);
  }
  cap.innerHTML = densityBar();
  cap.querySelectorAll('button').forEach(b => b.addEventListener('click', () => setDensity(b.dataset.dens)));
  applySort(tbl, id);
  applyDensity();
}
