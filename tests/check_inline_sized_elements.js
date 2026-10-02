// Custom lint: a sized inline element is a 0x0 element.
//
// P2-05 (#29). This is the check for a bug that actually shipped: an `<i>` icon
// was given a width/height while still `display:inline`. Inline boxes ignore
// width and height, so the icon rendered 0x0 — the CSS was "present and
// correct-looking", the element was invisible, and no existing tool said a
// word. Stylelint cannot catch it either: every declaration is valid CSS.
//
// The rule: any rule that sizes an inline-level element (i, span, em, b, small,
// code, a, strong, abbr) and does not set a display that honours width/height
// is an error, unless the selector escapes the element's inline nature (a
// float, a flex/grid parent, or position:absolute all make the box block-ish),
// in which case it is reported only when nothing in the rule accounts for it.
//
// Usage: node tests/check_inline_sized_elements.js [--quiet]
const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', 'src', 'llm_telemetry', 'web', 'css');
const INLINE_TAGS = ['i', 'span', 'em', 'b', 'small', 'code', 'a', 'strong', 'abbr', 'sub', 'sup'];
const SIZE_PROPS = /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|aspect-ratio)$/;
// Anything here lets an inline element honour a size, or makes it a block box.
const ESCAPES = /^(display|float|position|flex|grid-area|contain)$/;

let pass = 0, fail = 0;
const chk = (ok, name, got) => {
  if (ok) { pass++; if (!process.argv.includes('--quiet')) console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got !== undefined ? ' — ' + got : ''}`); }
};

const files = fs.readdirSync(CSS_DIR).filter(f => f.endsWith('.css'));
chk(files.length > 0, 'found stylesheets to check', files.join(','));

/** rules of a stylesheet: [{sel, body}] with comments stripped */
function rulesOf(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return (clean.match(/[^{}]+\{[^{}]*\}/g) || []).map(rule => {
    const at = rule.indexOf('{');
    return { sel: rule.slice(0, at).trim(), body: rule.slice(at + 1, -1) };
  });
}

/** the selector with its :pseudo-classes/:nth-child stripped — `.bars i:nth-child(2)`
    is sized by the same display as `.bars i`. */
const baseSelector = (s) => s.replace(/:{1,2}[\w-]+(\([^)]*\))?/g, '').trim();

/** selectors that already render as a box: display != inline, or a float/position */
const sizingSelectors = new Set();
for (const file of files) {
  for (const { sel, body } of rulesOf(fs.readFileSync(path.join(CSS_DIR, file), 'utf8'))) {
    const boxed = /display\s*:\s*(inline-block|inline-flex|block|flex|grid|inline-grid|flow-root|table)/.test(body) ||
                  /(float\s*:\s*(left|right))|(position\s*:\s*(absolute|fixed))/.test(body);
    if (boxed) sel.split(',').forEach(part => sizingSelectors.add(baseSelector(part)));
  }
}

let sizedInlineSelectors = 0;
for (const file of files) {
  const css = fs.readFileSync(path.join(CSS_DIR, file), 'utf8');
  // Strip comments so a commented-out rule is not reported.
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // Naive but adequate rule splitter: this stylesheet has no nested at-rule rules
  // other than media/supports blocks, whose inner rules we still want to see.
  const rules = clean.match(/[^{}]+\{[^{}]*\}/g) || [];
  for (const rule of rules) {
    const braceAt = rule.indexOf('{');
    const sel = rule.slice(0, braceAt).trim();
    const body = rule.slice(braceAt + 1, -1);
    const decls = body.split(';').map(d => d.trim()).filter(Boolean);
    const props = decls.map(d => d.split(':')[0].trim().toLowerCase());
    const sizes = decls.filter(d => SIZE_PROPS.test(d.split(':')[0].trim().toLowerCase()));
    if (!sizes.length) continue;
    // Does this selector target an inline-level element with no qualifying escape?
    const parts = sel.split(',').map(s => s.trim());
    const inlineParts = parts.filter(p => {
      const last = p.split(/[\s>+~]+/).filter(Boolean).pop() || '';
      const tag = last.replace(/[.#:\[].*$/, '').toLowerCase();
      return INLINE_TAGS.includes(tag);
    });
    if (!inlineParts.length) continue;
    if (props.some(p => ESCAPES.test(p))) continue;   // display/float/position given
    if (/position\s*:\s*(absolute|fixed)/.test(body)) continue;
    if (/float\s*:/.test(body)) continue;
    // A display declared for the same base selector in ANOTHER rule counts:
    // `.bars i{display:block}` is what makes `.bars i:nth-child(2){height:66%}`
    // work, and reporting the pair as broken would be a false alarm.
    if (baseSelector(sel).split(',').some(part => sizingSelectors.has(baseSelector(part)))) continue;
    sizedInlineSelectors++;
    fail++;
    console.log(`  FAIL ${file}: "${sel}" sizes an inline element without a display ` +
                `that honours it (${sizes.join('; ')}) — it will render 0x0`);
  }
}
chk(sizedInlineSelectors === 0, 'no rule sizes an inline element without a sizing display',
    `${sizedInlineSelectors} found`);

console.log(`\ncheck_inline_sized_elements.js  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
