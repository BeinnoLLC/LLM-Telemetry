// LLMTELEMET-271: faces, orbit rings and the egg are polygons: no <circle>, no triangles anywhere on the Hive stage.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'src/llm_telemetry/web');
const js = fs.readFileSync(path.join(dir, 'js/hive.js'), 'utf8'), css = fs.readFileSync(path.join(dir, 'css/hive.css'), 'utf8');
let p = 0, f = 0; const chk = (ok, l) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l}`); ok ? p++ : f++; };
chk(!/<circle|'circle'|"circle"|<ellipse|'ellipse'/.test(js), 'hive.js never creates a circle or ellipse');
chk(!/r="\d|border-radius:\s*50%/.test(js + css), 'no round shapes in markup or css');
chk(!/hvNgon\([^)]*,\s*3\)|hvNgon\([^)]*,\s*[12]\)/.test(js), 'no ngon below 6 sides (no triangles)');
chk(/hvNgon\(0, 0, it\.r \* 1\.5, it\.r \* 1\.5, 26\)/.test(js) && /hvHex = r => hvNgon\(0, 0, r, r, 6\)/.test(js), 'orbit ring is a polygon, node body is a hexagon');
console.log(`${p} passed, ${f} failed`); process.exit(f ? 1 : 0);
