// LLMTELEMET-313 (design-audit §10.8): ONE .modal + .scrim shell pair with
// size/anchor modifiers. Before this ticket every dialog carried its own
// near-identical fixed shell (#tmodal/#lnmodal/#sfmodal + #tscrim/#lnscrim/
// #sfscrim/#pdscrim — seven copies). This guard fails if a modal or scrim
// shell rule is ever duplicated again:
//   - the shell contract (position:fixed + opacity:0 + pointer-events:none
//     fade gate) may be declared only by .scrim and .modal — anything else
//     re-declaring it fails, and the seven migrated ids may not appear as
//     CSS selectors at all;
//   - the size/anchor modifiers (.modal-sm/md/lg, .modal-drop, .scrim-drop)
//     must exist, and every migrated element must ride them;
//   - the shells carry no colour literal — colours come from tokens.css vars
//     (--scrim-bg, --elev-modal), so light and dark keep one look.
// Known debt, outside this ticket's scope (audit items 7/9 own them): the
// logs-drawer #scrim and the nav #navscrim still keep their own shells.
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CSS = path.join(REPO, 'src', 'llm_telemetry', 'web', 'css', 'dashboard.css');
const TOKENS = path.join(REPO, 'src', 'llm_telemetry', 'web', 'css', 'tokens.css');
const HTML = path.join(REPO, 'src', 'llm_telemetry', 'web', 'dashboard.html');

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && got !== undefined ? ' — ' + got : ''}`);
  ok ? pass++ : fail++;
};

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

// Flatten stylesheet into {sel, decls, media} blocks; @keyframes and friends
// are skipped (their inner blocks are not real rules).
function parseBlocks(src, media) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) break;
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (/^@media|^@supports/.test(head)) out.push(...parseBlocks(body, head));
    else if (!head.startsWith('@')) out.push({ sel: head, decls: body, media: media || '' });
    i = j;
  }
  return out;
}

const declPairs = (body) => body.split(';').map(d => d.trim()).filter(Boolean).map(d => {
  const c = d.indexOf(':');
  return c === -1 ? [d, ''] : [d.slice(0, c).trim(), d.slice(c + 1).trim()];
});
const has = (pairs, prop, val) => pairs.some(([p, v]) => p === prop && v === val);

// The shell contract: a fixed surface hidden behind a fade gate. Re-declaring
// these three together outside .scrim/.modal IS the duplication this ticket
// removed. Pseudo-element tooltips match none of them (excluded belt+braces).
const isShell = (b) => {
  if (b.sel.includes('::')) return false;
  const p = declPairs(b.decls);
  return has(p, 'position', 'fixed') && has(p, 'opacity', '0') && has(p, 'pointer-events', 'none');
};

const css = stripComments(fs.readFileSync(CSS, 'utf8'));
const tokens = fs.readFileSync(TOKENS, 'utf8');
const html = fs.readFileSync(HTML, 'utf8');
const blocks = parseBlocks(css, '');

const selOf = (b) => b.sel.split(',').map(s => s.trim());
const bySel = (name) => blocks.filter(b => selOf(b).includes(name));

// ---- 1. exactly one .scrim shell and one .modal shell ------------------
const scrimShells = blocks.filter(b => selOf(b).includes('.scrim') && isShell(b));
chk(scrimShells.length === 1, `.scrim shell rule declared exactly once (${scrimShells.length})`);
chk(scrimShells.length === 1 && scrimShells[0].sel.trim() === '.scrim',
    'the scrim shell rule targets .scrim alone (no shared selector list)',
    scrimShells.length === 1 ? scrimShells[0].sel : '');
const modalShells = blocks.filter(b => selOf(b).includes('.modal') && isShell(b));
chk(modalShells.length === 1, `.modal shell rule declared exactly once (${modalShells.length})`);
chk(modalShells.length === 1 && modalShells[0].sel.trim() === '.modal',
    'the modal shell rule targets .modal alone (no shared selector list)',
    modalShells.length === 1 ? modalShells[0].sel : '');

// ---- 2. no shell rule duplicated anywhere else -------------------------
// Legacy debt owned by audit items 7/9 (drawer family), pre-dating this pair.
const LEGACY = ['#scrim', '#navscrim'];
// Single tooltip surface (LLMTELEMET-312, one-tooltip .qtip). It is a tooltip,
// not a modal or scrim, but its fade gate matches the shell heuristic.
const TOOLTIPS = ['.qtip'];
const shells = blocks.filter(isShell);
const rogue = shells.filter(b => !selOf(b).every(s => s === '.scrim' || s === '.modal' || LEGACY.includes(s) || TOOLTIPS.includes(s)));
chk(rogue.length === 0,
    `every modal/scrim shell rides the .scrim/.modal pair (${rogue.length} duplicated shells)`,
    rogue.map(r => r.sel + (r.media ? ` @${r.media}` : '')).join(' | '));
const legacyLeft = shells.filter(b => selOf(b).some(s => LEGACY.includes(s)));
chk(legacyLeft.length <= LEGACY.length,
    `legacy drawer scrims unchanged and un-duplicated (${legacyLeft.length}/${LEGACY.length})`);

// ---- 3. the migrated ids are JS/ARIA hooks only, never CSS selectors ---
const IDS = ['tmodal', 'lnmodal', 'sfmodal', 'tscrim', 'lnscrim', 'sfscrim', 'pdscrim'];
for (const id of IDS) {
  const re = new RegExp(`#${id}(?![\\w-])`);
  const hits = blocks.filter(b => selOf(b).some(s => re.test(s)));
  chk(hits.length === 0, `#${id} carries no CSS rule (shell lives on the shared pair)`,
      hits.map(h => h.sel).join(' | '));
}

// ---- 4. size + anchor modifiers exist and carry only deltas ------------
// .modal-md may carry one extra @media block (the phone sheet); the base
// declaration must stay a single width rule and never a shell.
for (const m of ['.modal-sm', '.modal-md', '.modal-lg']) {
  const all = bySel(m);
  const base = all.filter(b => !b.media);
  const width = base.length === 1 ? declPairs(base[0].decls).find(([p]) => p === 'width') : undefined;
  chk(!!width, `${m} base declared once with a width override`, all.map(x => x.sel + (x.media ? ' @media' : '')).join(' | '));
  chk(all.every(b => !has(declPairs(b.decls), 'position', 'fixed')),
      `${m} is a size modifier only — no shell re-declaration`);
}
const drop = bySel('.modal-drop');
chk(drop.length === 1 && has(declPairs(drop[0].decls), 'top', '12vh'),
    '.modal-drop carries the palette anchor (top:12vh)');
const dropBg = drop.length === 1
  ? declPairs(drop[0].decls).find(([p]) => p === 'background' || p === 'background-color') : undefined;
chk(!dropBg, '.modal-drop carries no surface colour');
const scrimDrop = bySel('.scrim-drop');
chk(scrimDrop.length === 1, '.scrim-drop declared once (finder stack layer)');
chk(bySel('.scrim.open').length === 1 && bySel('.modal.open').length === 1,
    'the .open states of both shells exist exactly once');

// ---- 5. shell colours come from tokens.css vars, never literals --------
const LIT = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/;
for (const b of [...scrimShells, ...modalShells]) {
  chk(!LIT.test(b.decls), `shell ${b.sel} has no colour literal (tokens.css vars only)`, b.decls.trim().slice(0, 80));
}
chk(/--scrim-bg\s*:/.test(tokens) && /--elev-modal\s*:/.test(tokens),
    'tokens.css declares --scrim-bg and --elev-modal (the shells read them)');

// ---- 6. every migrated element rides the pair in the template ----------
const tagFor = (id) => html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0] || '';
const classOf = (id) => tagFor(id).match(/class="([^"]*)"/)?.[1] || '';
for (const id of ['tscrim', 'lnscrim', 'sfscrim', 'pdscrim']) {
  const cls = classOf(id).split(/\s+/);
  chk(cls.includes('scrim'), `#${id} carries class="scrim" (scrim shell instance)`, tagFor(id));
}
for (const id of ['tmodal', 'lnmodal', 'sfmodal']) {
  const cls = classOf(id).split(/\s+/);
  const sizes = cls.filter(c => ['modal-sm', 'modal-md', 'modal-lg'].includes(c));
  chk(cls.includes('modal') && sizes.length === 1,
      `#${id} carries class="modal" + exactly one size modifier`, tagFor(id));
}
chk(classOf('sfmodal').includes('modal-drop') && classOf('sfscrim').includes('scrim-drop'),
    '#sfmodal/#sfscrim keep the finder anchor modifiers');

// ---- 7. the built page ships the same wiring ---------------------------
const built = fs.readFileSync(path.join(REPO, 'examples', 'reports', 'dashboard.html'), 'utf8');
chk(built.includes('id="tmodal" class="modal modal-md"') &&
    built.includes('id="lnmodal" class="modal modal-lg"') &&
    built.includes('id="sfmodal" class="modal modal-sm modal-drop"'),
    'the built sample page ships all three modals on the shared pair');
chk(built.includes('id="tscrim" class="scrim"') && built.includes('id="pdscrim" class="scrim"'),
    'the built sample page ships the scrims on the shared pair');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
