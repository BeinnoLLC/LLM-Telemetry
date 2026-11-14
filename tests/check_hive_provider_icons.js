// LLMTELEMET-271: provider marks on the Hive page are brand SVGs (or a neutral polygon), never letters.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/llm_telemetry/web/js/hive.js'), 'utf8');
let p = 0, f = 0; const chk = (ok, l) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}`); ok ? p++ : f++; };
chk(/import \{[^}]*provLogoSvg[^}]*\} from '\.\/views\.js'/.test(src) && /import \{[^}]*provOf[^}]*\}/.test(src), 'hive.js imports provOf + provLogoSvg from views.js');
chk(/provLogoSvg\(/.test(src), 'tooltip marks go through provLogoSvg');
chk(!/QT_GLYPH|\.mono\b/.test(src), 'no glyph table, no mono-letter fallback');
chk(/svg\.startsWith\('<svg'\) \? svg : '<svg/.test(src), 'a span (letter) result from provLogoSvg is replaced by a neutral svg polygon');
chk(!/textContent\s*=\s*[^;]*\[0\]|charAt\(0\)|\.slice\(0, ?1\)/.test(src), 'no first-letter rendering');
console.log(`${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
