# Agent instructions for LLM-Telemetry

## HARD UI RULE: jar balls show PROVIDER ICONS, NEVER LETTERS, permanent and user-mandated

- Every ball in the task-queue jars, Life view depot, on the line and yard, and the jar legend shows the provider brand SVG logo via `provLogoSvg` and `provOf` from `src/llm_telemetry/web/js/views.js`. Depot balls without a model show the Ollama logo. Unknown providers show a neutral generic icon. Never a letter, never a QT_GLYPH letter table.
- Regression history: `7f781a6` and `758549a` added the icons. Commit `b62a823`, jars now show family letters H, pi, C, X, O instead of provider icons, is a REVERTED REGRESSION. The user has asked about ten times. Never restore, cherry-pick or re-implement it.
- Guard test `tests/check_qt_ball_provider_icons.js` fails if any `.qt-ball` lacks a provider SVG or contains a single-letter glyph. Never delete, skip or loosen it. If it fails, fix the rendering.
- Legibility is no excuse. If a logo looks small at QT_MIN 18px, add a contrast disc behind it or raise QT_MIN. Do not switch to letters.

## Working in this repo

- Use `.venv/bin/python` since system python3 lacks `llm_telemetry`.
- Build with `.venv/bin/python -m llm_telemetry.build_dashboard OUT.html`.
- JS suite on Node 24 is `npm ci --prefix tests` then `NODE_PATH=tests/node_modules node tests/run-all.js`.
- Stage files by name, never `git add -A`.
