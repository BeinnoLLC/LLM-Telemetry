# Design audit — LLM-Telemetry (incl. Hive views)

Scope: read-only audit of UI stack, tokens, components, breakpoints, dark mode, RTL, accessibility, and rule violations. Worktree branch `design-system/design-md` @ origin/main (0be7ecb).

## 1. UI stack

- Plain CSS + vanilla JS. No Tailwind, no component library, no CSS-in-JS.
- Files: `src/llm_telemetry/web/css/tokens.css` (shared tokens), `dashboard.css` (2328 lines, main stylesheet), `hive.css` (46 lines, Hive tab), `utilities.css` (119 lines).
- JS: `src/llm_telemetry/web/js/*.js` (main, views, live, table, charts, drawer, palette, router, etc.), built into `dashboard.html` by `llm_telemetry.build_dashboard`.
- Hive tab is inside LLM-Telemetry (main branch) via `hive.js` + `hive.css`.
- Standalone Hive app: `/home/hazemhagrass/workspace/beinno/hive/index.html` (NOT git, read-only here). Its CSS is inline; server.py serves it. Tokens largely mirror tokens.css dark palette.

## 2. Tokens (source of truth)

`tokens.css` declares `:root,[data-theme="light"]` and `[data-theme="dark"]`. Key semantic tokens:
- Surfaces: `--bg`, `--card`, `--fg`, `--muted`, `--border`, `--border-input`, `--border-strong`.
- Accent: `--accent`, `--accent-ink`, `--accent-wash`, `--accent2`, `--active-a/b`, `--live-dot`, `--glow-*`, `--grad-title`.
- Status: `--z-ok/warn/bad` + `-fg` variants.
- Chart palette: `--pal-indigo/rose/slate/amber/mint`; washes `--wash-*`.
- Elevation: `--elev-0..3`; spacing `--sp-1..8` (4,8,12,16,20,24,32,40px); radius `--radius-sm/md/lg` (4,8,12); motion `--motion-fast 120ms`, `--motion-normal 200ms`; state `--state-hover/pressed/focus`.
- Fleet/kind: `--radius-ctl 10px`, `--font` (Inter stack), `--num` (tabular-nums), `--kind-hermes/pi/claude/codex`, `--fb-*`.
- Jar tokens: `--jar-*` (light only).
- Hive semantic: `--radius-ctl`, `--font`, `--grad-title`, `--live-dot`, `--glow-live`, `--glow-active`, `--border-strong`.

## 3. Colours in use

Primary palette two themes (light default-off; dark default-on since Grafana G1). Accent Grafana blue (#6e9fff dark / #1f62c9 light). Neutral surfaces Hive-derived. Contrast audited in tokens.css comments (WCAG 2.1 AA pass for fg/muted/accent; known exceptions documented).

## 4. Typography

- Family: Inter stack (`--font`). Monospace: ui-monospace/SFMono-Regular/Menlo (`--mono`).
- No web font @import beyond Inter (loaded via link in dashboard.html). Type scale lives in dashboard.css (not tokens.css) — page-specific. Need grep for font-size values.

## 5. Spacing / radius / shadow / z-index

- Spacing scale `--sp-1..8`; radius 4/8/12 + ctl 10; elevation 3 levels + none.
- Z-index: `--z-*` naming also used for status; semantic z-layers via `--z-*`? Check. (tokens only define `--z-ok` status hues, z-index layers are in dashboard.css.)

## 6. Breakpoints

Many ad-hoc breakpoints (max-width 359,390,400,479,480,520,560,599,600,639,640,700,720,899,900,960,1023,1100,1279; min-width 641,835,900,1280,1600; plus orientation/pointer/forced-colors/reduced-motion). No single canonical scale; inconsistent spacing (e.g. 599 vs 600, 639 vs 640).

## 7. Dark mode

`[data-theme="dark"]` on root; pre-paint script + main.js set unless saved pref 'light'. `:root` is light. Both themes fully tokenised. Standalone Hive: dark only (no light theme in hive/index.html? to verify).

## 8. RTL

No `dir="rtl"` handling found in dashboard JS/CSS grep. No Arabic font. No RTL support currently. Standing rule: RTL support required if app ships Arabic — LLM-Telemetry does not ship Arabic UI currently, so RTL absent (documented gap, not a violation unless Arabic is added).

## 9. Accessibility

- Focus rings: `--state-focus` + `:focus-visible` rules in dashboard.css (verify). 
- `aria-label` usage present on icon buttons (search needed).
- Contrast table in tokens.css. Known exception: `--z-*-fg` on solid fills in dark (2.68/2.09/3.01) — needs split tokens (follow-up).
- `prefers-reduced-motion: reduce` honoured in several media queries.

## 10. Core components

- App bar / nav: fleet bar (`.fb-*`), segmented tab strip replaced.
- KPI cards, tables (`.table-*`), chips/badges, buttons, inputs/comboboxes, toasts, modals/drawers, tooltips, charts (Chart.js), jars/queue balls (`QT_*`).
- Jars: provider SVG icons (AGENTS.md hard rule); `tests/check_qt_ball_provider_icons.js` guards.
- Tables: roomy (48-56px rows) per user preference.

## 11. Known mismatches (numbered)

1. Breakpoint scale fragmented (30+ ad-hoc max-width values, off-by-one pairs like 599/600, 639/640) — file: dashboard.css media queries; fix: define canonical breakpoints in tokens or docs and migrate.
2. `--z-*` tokens overloaded (status hues vs z-index layers name collision) — tokens.css + dashboard.css; fix: rename z-index layers to `--layer-*`.
3. Raw hex outside tokens: jar marble colours are declared as `--jar-*` tokens (OK), but some dashboard.css rules use raw hex for chart accents — grep needed; example `#38bdf8` (4 occurrences) in dashboard.css/js. Fix: tokenise.
4. `--z-*-fg` on solid fills fails contrast in dark (2.68/2.09/3.01) — tokens.css documented; fix: split into dedicated on-fill tokens (follow-up ticket).
5. Border decorative hairline 1.27:1 exempt but `--border-input` differs; consistent.
6. Standalone Hive has no light theme (dark only) while LLM-Telemetry supports both — acceptable if Hive is dark-only product, but document.
7. No RTL support in either surface — acceptable if no Arabic shipped; flag if Arabic added.
8. Type scale and spacing scale are page-specific (in dashboard.css, not tokens.css) — documented as deliberate; but means Hive tab and main dashboard may drift; hive.css 46 lines relies on tokens only.
9. Duplicate button styles: dashboard.css has multiple `.btn*` variants (verify counts) — consolidate.
10. One-off spacing values (`p-[13px]`-style) in JS inline styles — search `style=` in views.js/live.js.

## 12. Hive (standalone) notes

- `/home/hazemhagrass/workspace/beinno/hive/index.html` ~single file, inline CSS, dark-only, uses same Hive palette (#05060a etc.), provider icons, jar balls. No git; read-only audit. Shares token values with tokens.css dark block (good).

## 13. Accessibility contrast summary

See tokens.css LST-238 audit block. Light: fg 16.6, muted 4.77, accent 5.76 (pass). Dark: fg 10.9, muted 5.82 (6.25 on page bg), accent 6.64 (pass). Known exception documented (#4 above).

## 14. Screenshots

Not captured in this read-only audit pass (no running service touched per instructions). Recommend capturing desktop/mobile light+dark for dashboard, fleet bar, jars, Hive tab, and standalone Hive before DESIGN.md is written.
