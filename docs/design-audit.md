# LLM-Telemetry (+ Hive) design-system audit

Read-only code audit for the Beinno design-system rollout (step 1). Input for
`beinno-designer`, who writes the repo's `DESIGN.md`. Every number below was
measured on branch `design-system/design-md` merged with `origin/main` at
`f08f40f`; the exact commands and their outputs are in the appendix. Scope:
`src/llm_telemetry/web/css/` (4 files, 2,698 lines), `src/llm_telemetry/web/js/`
(18 files, 12,213 lines), `src/llm_telemetry/web/dashboard.html`,
`src/llm_telemetry/webassets.py`, `src/llm_telemetry/build_dashboard.py`,
lint configs, and the standalone Hive page at
`/home/hazemhagrass/workspace/beinno/hive/index.html` (read-only, not git).
No UI code was changed.

Comment-stripping note: all colour/font/spacing counts use a comment-stripped
projection of the sources (script in the appendix), because ticket references
like `#149` in comments otherwise match hex-colour patterns.

## 1. UI stack

Plain CSS and vanilla JS. No Tailwind, no shadcn, no MUI.

- **CSS**: 4 stylesheets — `src/llm_telemetry/web/css/tokens.css` (209 lines,
  the one token file), `dashboard.css` (2,296 lines), `hive.css` (74 lines),
  `utilities.css` (119 lines). Page-specific type/spacing metrics live in
  `dashboard.css:4`–`dashboard.css:16` (`:root`), deliberately outside
  `tokens.css` per `tokens.css:30`–`tokens.css:32`.
- **JS**: 18 ES modules in `src/llm_telemetry/web/js/` (`views.js` 3,684 lines
  is the largest), inlined into one classic script at build time by
  `src/llm_telemetry/webassets.py` (per `eslint.config.js:12`–`eslint.config.js:16`).
- **Build**: `src/llm_telemetry/build_dashboard.py` assembles the single
  `dashboard.html` artifact with `__DATA__`-style injections
  (`eslint.config.js:55`–`eslint.config.js:66`). Build entry:
  `.venv/bin/python -m llm_telemetry.build_dashboard OUT.html`.
- **Charts**: Chart.js from CDN, with a stub fallback if the CDN fails
  (`src/llm_telemetry/web/js/charts.js:12`, `charts.js:23`, `charts.js:25`);
  canvas reuse guard at `charts.js:46`–`charts.js:53`. Chart colours come from
  `PAL` at `src/llm_telemetry/web/js/palette.js:17` and the `--pal-*` tokens.

### Lint setup (quoted)

`package.json` scripts (`package.json:12`–`package.json:15`):

```json
"lint": "npm run lint:js && npm run lint:css && npm run lint:inline-sized",
"lint:js": "eslint src/llm_telemetry/web/js",
"lint:css": "stylelint \"src/llm_telemetry/web/css/*.css\"",
"lint:inline-sized": "node tests/check_inline_sized_elements.js"
```

Stylelint (`.stylelintrc.json`): 17 rules. The colour rule is

```json
"color-no-hex": true
```

with the single exemption

```json
"overrides": [{ "files": ["**/tokens.css"], "rules": { "color-no-hex": null } }]
```

(`.stylelintrc.json:21`, `.stylelintrc.json:24`–`.stylelintrc.json:31`).
Other rules: `color-no-invalid-hex`, `function-no-unknown`,
`declaration-property-value-no-unknown`, `no-duplicate-selectors`,
`block-no-empty`, `font-family-no-duplicate-names`, `unit-no-unknown`,
`no-descending-specificity` (warning), and more. This guard works: raw hex
outside `tokens.css` in CSS is measured at **0** (appendix A1). rgb/hsl is not
banned by stylelint and 66 such declarations exist in `dashboard.css` (item 6).

ESLint (`eslint.config.js`): flat config, `no-unused-vars`, `no-undef`,
`no-redeclare`, `no-dupe-keys`, `no-dupe-args`, `no-unreachable`,
`no-cond-assign`, `no-empty`, `eqeqeq` (`eslint.config.js:70`–`eslint.config.js:83`).
Exemptions: `src/llm_telemetry/web/js/order.json` (`eslint.config.js:48`), the
build-time injected globals `__DATA__`, `__POWER__`, `__LOCAL_HOSTS__`,
`__SCHEMA_VERSION__`, `__COSTS_DATA__`, `__RANKINGS_DATA__` and the CDN global
`Chart` (`eslint.config.js:55`–`eslint.config.js:68`), and the 19 named
cross-module write sites in `CROSS_MODULE_WRITES` (`eslint.config.js:31`–`eslint.config.js:40`),
ratcheted by `tools/check-module-graph.mjs`.

Inline-sized check (`tests/check_inline_sized_elements.js`): fails when a rule
sizes an inline-level element (i, span, em, b, small, code, a, strong, abbr,
sub, sup — `tests/check_inline_sized_elements.js:20`) without a display that
honours width/height; escape hatches are `display|float|position|flex|grid-area|contain`
(`tests/check_inline_sized_elements.js:23`). Ran clean: `2 passed, 0 failed`.

## 2. Every token in `src/llm_telemetry/web/css/tokens.css`

Three blocks: `:root, [data-theme="light"]` (`tokens.css:58`), `:root`
(theme-independent, `tokens.css:138`), `[data-theme="dark"]` (`tokens.css:160`).
"shared" = declared once, resolves per theme via `color-mix`/`var()`.

| Token | Light value | Dark value | Declared |
|---|---|---|---|
| `--bg` | `#fbfbf9` | `#05060a` | tokens.css:60 / tokens.css:162 |
| `--card` | `#ffffff` | `#0f1118` | tokens.css:61 / tokens.css:163 |
| `--fg` | `#1a201c` | `#f5f5f5` | tokens.css:62 / tokens.css:164 |
| `--muted` | `#6f746f` | `#8a8f9a` | tokens.css:63 / tokens.css:165 |
| `--border` | `rgba(26,32,28,.12)` | `#1d2130` | tokens.css:64 / tokens.css:166 |
| `--border-input` | `#6b6e78` | `#6b6e78` | tokens.css:65 / tokens.css:167 |
| `--accent` | `#1f62c9` | `#88aaff` | tokens.css:66 / tokens.css:169 |
| `--accent-ink` | `#ffffff` | `#05060a` | tokens.css:67 / tokens.css:170 |
| `--accent-wash` | `rgba(31,98,201,.10)` | `rgba(136,170,255,.14)` | tokens.css:68 / tokens.css:171 |
| `--accent2` | `#7793a2` | `#b877d9` | tokens.css:70 / tokens.css:178 |
| `--border-strong` | `rgba(26,32,28,.22)` | `#262a36` | tokens.css:71 / tokens.css:172 |
| `--active-a` | `#1f62c9` | `#88aaff` | tokens.css:72 / tokens.css:173 |
| `--active-b` | `#1a7f3c` | `#55ff88` | tokens.css:73 / tokens.css:174 |
| `--live-dot` | `#1a7f3c` | `#55ff88` | tokens.css:74 / tokens.css:175 |
| `--glow-live` | `0 0 0 2px rgba(26,127,60,.18)` | `0 0 8px 2px rgba(85,255,136,.55)` | tokens.css:75 / tokens.css:176 |
| `--glow-active` | `0 0 0 1px var(--active-a),0 0 10px rgba(31,98,201,.28)` | `0 0 0 1px var(--active-a),0 0 12px rgba(85,255,136,.35)` | tokens.css:76 / tokens.css:177 |
| `--grad-title` | `linear-gradient(90deg,#0b6fb3,#b0287a,#1a7f3c,#8a5a00,#0b6fb3)` | `linear-gradient(90deg,#66ccff,#ff66cc,#77ff99,#ffcc66,#66ccff)` | tokens.css:80 / tokens.css:179 |
| `--wash-indigo` | `rgba(99,110,164,.12)` | `rgba(87,148,242,.14)` | tokens.css:83 / tokens.css:182 |
| `--wash-rose` | `rgba(178,105,122,.13)` | `rgba(242,73,92,.14)` | tokens.css:84 / tokens.css:183 |
| `--wash-slate` | `rgba(104,122,133,.13)` | `rgba(204,204,220,.08)` | tokens.css:85 / tokens.css:184 |
| `--wash-amber` | `rgba(178,138,88,.13)` | `rgba(255,152,48,.14)` | tokens.css:86 / tokens.css:185 |
| `--wash-mint` | `rgba(88,150,115,.12)` | `rgba(110,170,140,.14)` | tokens.css:87 / tokens.css:186 |
| `--z-ok` | `#39764f` | `#5f9e6e` | tokens.css:89 / tokens.css:190 |
| `--z-warn` | `#7c6328` | `#c2a15c` | tokens.css:90 / tokens.css:191 |
| `--z-bad` | `#a14d47` | `#c66a6a` | tokens.css:91 / tokens.css:192 |
| `--z-ok-fg` | `#e4f0e9` | `#dff0e4` | tokens.css:92 / tokens.css:193 |
| `--z-warn-fg` | `#f4ecd7` | `#f4ecda` | tokens.css:93 / tokens.css:194 |
| `--z-bad-fg` | `#f7e4e4` | `#f7e3e3` | tokens.css:94 / tokens.css:195 |
| `--pal-indigo` | `#7c86b0` | `#5794f2` | tokens.css:97 / tokens.css:198 |
| `--pal-rose` | `#b87383` | `#f2495c` | tokens.css:98 / tokens.css:199 |
| `--pal-slate` | `#71868f` | `#8ab8ff` | tokens.css:99 / tokens.css:200 |
| `--pal-amber` | `#ac895a` | `#ff9830` | tokens.css:100 / tokens.css:201 |
| `--pal-mint` | `#5f9e78` | `#6eaa8c` | tokens.css:101 / tokens.css:202 |
| `--elev-0` | `none` | (not re-declared: light-only) | tokens.css:104 |
| `--elev-1` | `0 1px 2px rgba(0,0,0,.06),0 1px 1px rgba(0,0,0,.04)` | `0 1px 2px rgba(0,0,0,.30),0 1px 1px rgba(0,0,0,.20)` | tokens.css:104 / tokens.css:204 |
| `--elev-2` | `0 2px 6px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.05)` | `0 2px 6px rgba(0,0,0,.35),0 1px 2px rgba(0,0,0,.25)` | tokens.css:105 / tokens.css:205 |
| `--elev-3` | `0 6px 16px rgba(0,0,0,.10),0 2px 4px rgba(0,0,0,.06)` | `0 6px 16px rgba(0,0,0,.40),0 2px 4px rgba(0,0,0,.30)` | tokens.css:106 / tokens.css:206 |
| `--sp-1` | `4px` | shared | tokens.css:107 |
| `--sp-2` | `8px` | shared | tokens.css:107 |
| `--sp-3` | `12px` | shared | tokens.css:107 |
| `--sp-4` | `16px` | shared | tokens.css:107 |
| `--sp-5` | `20px` | shared | tokens.css:107 |
| `--sp-6` | `24px` | shared | tokens.css:107 |
| `--sp-7` | `32px` | shared | tokens.css:107 |
| `--sp-8` | `40px` | shared | tokens.css:107 |
| `--radius-sm` | `4px` | shared | tokens.css:108 |
| `--radius-md` | `8px` | shared | tokens.css:108 |
| `--radius-lg` | `12px` | shared | tokens.css:108 |
| `--motion-fast` | `120ms` | shared (unused, see item 13) | tokens.css:109 |
| `--motion-normal` | `200ms` | shared (unused, see item 13) | tokens.css:109 |
| `--state-hover` | `rgba(0,0,0,.04)` | `rgba(255,255,255,.06)` | tokens.css:110 / tokens.css:207 |
| `--state-pressed` | `rgba(0,0,0,.08)` | `rgba(255,255,255,.10)` | tokens.css:110 / tokens.css:207 |
| `--state-focus` | `rgba(31,98,201,.25)` | `rgba(136,170,255,.40)` | tokens.css:110 / tokens.css:207 |
| `--jar-glass` | `hsl(220 20% 97%)` | light-only (item 12) | tokens.css:116 |
| `--jar-edge` | `hsl(220 18% 46%)` | light-only | tokens.css:117 |
| `--jar-ink` | `hsl(225 25% 6%)` | light-only | tokens.css:118 |
| `--jar-label` | `hsl(220 20% 20%)` | light-only | tokens.css:119 |
| `--jar-label-soft` | `hsl(220 12% 34%)` | light-only | tokens.css:120 |
| `--jar-lid-top` | `hsl(0 0% 100%)` | light-only | tokens.css:121 |
| `--jar-lid-bot` | `hsl(220 18% 90%)` | light-only | tokens.css:122 |
| `--jar-shadow` | `hsl(220 30% 20% / .34)` | light-only | tokens.css:123 |
| `--jar-glow` | `hsl(199 95% 38%)` | light-only | tokens.css:124 |
| `--jar-ring` | `hsl(28 95% 36%)` | light-only | tokens.css:125 |
| `--jar-hermes` | `hsl(199 90% 41%)` | light-only | tokens.css:126 |
| `--jar-pi` | `hsl(265 70% 65%)` | light-only | tokens.css:127 |
| `--jar-claude` | `hsl(18 88% 48%)` | light-only | tokens.css:128 |
| `--jar-codex` | `hsl(152 75% 33%)` | light-only | tokens.css:129 |
| `--jar-wait` | `hsl(215 30% 54%)` | light-only | tokens.css:130 |
| `--radius-ctl` | `10px` | shared | tokens.css:140 |
| `--font` | `Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif` | shared | tokens.css:141 |
| `--num` | `tabular-nums` | shared | tokens.css:142 |
| `--fb-surface` | `color-mix(in srgb,var(--fg) 4%,var(--card))` | shared (resolves per theme) | tokens.css:143 |
| `--fb-raise` | `color-mix(in srgb,var(--fg) 9%,var(--card))` | shared | tokens.css:144 |
| `--fb-h` | `32px` | shared | tokens.css:145 |
| `--fb-r` | `var(--radius-ctl)` | shared | tokens.css:146 |
| `--kind-hermes` | `hsl(199 60% 56%)` | shared | tokens.css:147 |
| `--kind-pi` | `hsl(265 55% 64%)` | shared | tokens.css:148 |
| `--kind-claude` | `hsl(18 70% 60%)` | shared | tokens.css:149 |
| `--kind-codex` | `hsl(152 50% 52%)` | shared | tokens.css:150 |
| `--hv-fill` | `#0a0a0a` | shared (theme-independent) | tokens.css:152 |
| `--hv-feat` | `#f4f1f2` | shared | tokens.css:152 |
| `--hv-teeth` | `#ece2de` | shared | tokens.css:152 |
| `--hv-halo` | `#5a0f1c` | shared | tokens.css:152 |
| `--hv-rim-top-0..4` | `#ff70b0`, `#ff6a96`, `#ff6854`, `#ff6234`, `#ff6026` | shared | tokens.css:153 |
| `--hv-rim-bot-0..4` | `#ff963c`, `#ff8c34`, `#ff7622`, `#ff521c`, `#ff2e1a` | shared | tokens.css:154 |
| `--hv-mouth-0..4` | `#aa768c`, `#a0647a`, `#8c3742`, `#70161e`, `#5c0a10` | shared | tokens.css:155 |
| `--hv-flame-0..4` | `#ff5614`, `#ff841e`, `#ffc43c`, `#ffe482`, `#fffaee` | shared | tokens.css:156 |
| `--hv-fam-root` | `#5cd0ff` | shared | tokens.css:157 |
| `--hv-fam-pixelvent` | `#ff5fc8` | shared | tokens.css:157 |
| `--hv-fam-acasia` | `#5dff9a` | shared | tokens.css:157 |
| `--hv-fam-somethingpressing` | `#ffc14d` | shared | tokens.css:157 |
| `--hv-gauge-lo` | `var(--z-ok)` | shared | tokens.css:158 |
| `--hv-gauge-mid` | `var(--z-warn)` | shared | tokens.css:158 |
| `--hv-gauge-hi` | `var(--z-bad)` | shared | tokens.css:158 |

Page-level tokens outside `tokens.css` (deliberate split, `tokens.css:30`):
`--fs:14px`, `--gap:8px`, `--pad:16px` (`dashboard.css:5`), the type scale
`--fs-xs:13px`, `--fs-sm:14px`, `--fs-md:clamp(14px,.75vw + 10.3px,15px)`,
`--fs-lg:clamp(15px,1.1vw + 11px,18px)`, `--fs-xl:clamp(17px,1.8vw + 11px,24px)`
(`dashboard.css:11`–`dashboard.css:15`), and a second `--sp-1:4px; --sp-2:6px`
at `dashboard.css:16` that drifts from `tokens.css:107` (item 15).

## 3. Raw values outside `tokens.css`

All counts from comment-stripped sources (appendix).

**Colours.**

| Kind | Count | Where (file:line examples) |
|---|---|---|
| hex in CSS excl. tokens.css | **0** | stylelint `color-no-hex` holds (`.stylelintrc.json:21`) |
| rgb/rgba/hsl in CSS | **66** | all `dashboard.css`, e.g. `dashboard.css:131`, `dashboard.css:606`, `dashboard.css:857`, `dashboard.css:1936` |
| hex in JS | **65** | `views.js` 29 (e.g. `views.js:88`), `routerview.js` 14, `palette.js` 13 (e.g. `palette.js:17`, `palette.js:230`), `drawer.js` 2 (`drawer.js:800`, `drawer.js:801`), `flow.js` 3 (`flow.js:125`, `flow.js:557`, `flow.js:560`), `live.js` 2 (`live.js:293`, `live.js:426`), `charts.js` 1 (`charts.js:355`), `main.js` 1 (`main.js:30`) |
| rgb/rgba/hsl in JS | **40** | `views.js` 22 (e.g. `views.js:1265` canvas `fillStyle:'rgba(148,163,184,0.35)'`), `palette.js` 7, `router.js` 3, `hive.js` 2 (`hive.js:32` generated `hsl(...)`, `hive.js:194` `hvRgb`), `flow.js` 2, `live.js` 2, `charts.js` 1, `drawer.js` 1 |
| inline `style="..."` colour strings in JS | present | `flow.js:125` (`style="fill:#5b6472"`), `flow.js:560` (`style="background:${...}"`), `views.js:865`, `views.js:326` |
| canvas `fillStyle`/`strokeStyle` | **2** | `views.js:1265`, `views.js:1266` |

**Font families** — 14 `font-family` declarations, all in `dashboard.css`, 5
distinct stacks: `ui-monospace,monospace` **7** (`dashboard.css:1630`,
`dashboard.css:1668`, `dashboard.css:1694`, `dashboard.css:1695`,
`dashboard.css:1742`, `dashboard.css:1778`, `dashboard.css:1797`),
`ui-monospace,SFMono-Regular,Menlo,monospace` **3** (`dashboard.css:438`,
`dashboard.css:1268`, `dashboard.css:1273`, plus one wrapped continuation at
`dashboard.css:1390`), `font-family:inherit` **2** (`dashboard.css:938`,
`dashboard.css:973`), `var(--mono,monospace)` **1** (`dashboard.css:1058` —
`--mono` is referenced but never declared anywhere in `web/`, the fallback
always wins). Body font rides the `font` shorthand: `body{font:var(--fs)/1.55
var(--font)` (`dashboard.css:29`).

**Font sizes (de-facto type scale).** Tokenised: `--fs-xs` 143 uses,
`--fs-sm` 56, `--fs-md` 20, `--fs-lg` 13, `--fs-2xs` 6 (declared where
`--fs-2xs` is set in `utilities.css`/`dashboard.css` metric block), `--dt-fs` 1.
Raw px values still used: **13px ×36, 14px ×21, 15px ×3, 18px ×3, 22px ×3,
16px ×2, 19px ×2, 28px ×1, 26px ×1, 24px ×1, 12px ×1, 10px ×1**, plus
`1.2rem ×1`, `.9em ×1`, `clamp(18px,2vw,26px) ×1` (`dashboard.css:224`),
`28px` in `font:600 28px/38px` (`dashboard.css:255`), and two JS-computed
sizes (`views.js` `Math.round(px*0.6)`, `Math.round(px*0.42)`). Full 14-value
histogram in appendix A5.

**Spacing not on `--sp-*`.** `padding|margin|gap` declarations carrying a raw
px value: **299** (`dashboard.css` 269, `hive.css` 14, `views.js` 12,
`drawer.js` 2, `live.js` 1, `router.js` 1). `--sp-*` token uses total **7**
(`--sp-2` ×1, `--sp-3` ×1, `--sp-4` ×3, `--sp-6` ×2). Distinct `gap` values:
**20+** (`8px` ×36, `6px` ×20, `4px` ×14, `2px` ×10, `.5rem` ×10, `3px` ×9,
`10px` ×9, `5px` ×7, `12px` ×6, `14px` ×4, `9px` ×3, `7px` ×3, plus `.15rem`–
`.75rem` steps). Distinct `padding` values ≥20 (`0` ×13, `0 6px` ×9,
`8px 10px` ×7, `12px 15px` ×6, `1rem` ×6, …). `margin-left` appears **35**
times (e.g. `dashboard.css:91` `padding:0 4px 0 8px` companion patterns,
`.stat-sub .kpi-kinds` `margin-left:0` at `dashboard.css:260`) vs
`margin-right` **6**.

**Border radius.** `var(--radius-ctl)` **74** uses (e.g. `dashboard.css:39`,
`dashboard.css:192`), `var(--fb-r)` 2. Raw values: `999px` ×24, `4px` ×18,
`2px` ×17, `3px` ×16, `50%` ×14, `99px` ×4, `6px` ×4, `5px` ×3, `9px` ×2,
`1px` ×2, `8px` ×1, `7px` ×1, `13px` ×1 (`dashboard.css:937`), `12px` ×1,
compound one-offs `9px 9px 5px 5px`, `14px 14px 0 0`, `12px 12px 0 0`,
`0 0 30px 30px`, `0 0 6px 6px` (jar silhouette, `dashboard.css:882` area).
Scale tokens `--radius-sm/md/lg` (4/8/12px, `tokens.css:108`) have **0** uses.

**Box shadows.** `var(--elev-*)` uses: **2** (`--elev-1` at `dashboard.css:39`,
`--elev-2` once). Raw shadow declarations: **21 distinct** values, e.g.
`0 8px 24px rgba(0,0,0,.45)` ×3 (`dashboard.css:843`),
`0 24px 70px rgba(0,0,0,.5)` ×3 (modals), `0 12px 32px rgba(0,0,0,.6),0 2px 6px rgba(0,0,0,.4)`
(`dashboard.css:977`), `inset 7px 0 9px -6px hsl(220 25% 45% / .22)`
(`dashboard.css:882`), `0 2px 14px #0008`-class values in Hive tooling.

**Z-index.** 27 distinct raw values (no `--z-layer-*` tokens exist): 0, 1 ×5,
2 ×2, 3 ×3, 4 ×3, 5 ×2, 30, 40 ×5, 41 ×2, 45, 50 ×2, 60 ×2, 63, 64, 65,
70 ×2, 75 ×3, 80 ×5, 85, 90 ×2, 100, 200 (`dashboard.css:229` skip link),
40+ computed (`dashboard.css:906` `calc(2 + var(--zr,0))`), 800-class hover
900 (`dashboard.css:914`), 950 (`dashboard.css:945` ghost), 1000
(`dashboard.css:937` overflow chip), and JS `z-index:100`/`80` inline
(`views.js:39`, `views.js:88`).

**Motion.** Distinct transition/animation durations: **39** (`.12s` ×16,
`.18s` ×7, `.2s` ×6, `.3s` ×5, `.22s` ×4, `.16s` ×4, `.14s` ×4, `.15s` ×3,
plus `.1s`, `.24s`, `.25s`, `.26s`, `.35s`, `.36s`, `.4s`, `.45s`, `.5s`,
`.55s`, `.6s`, `.65s`, `.7s`, `.8s`, `1s`, `1.05s`, `1.1s`, `1.3s`, `1.4s`,
`1.8s`, `2s`, `2.2s`, `3.2s`, `4s`, `5s`, `6s`, `12s`, and `180ms`, `240ms`).
Easings: `ease` ×38, `ease-out` ×8, `ease-in-out` ×6, `linear` ×5, `ease-in` ×3,
`cubic-bezier(.2,.8,.2,1)` ×1 (`dashboard.css` transition on `.qt-*` family).
`--motion-fast`/`--motion-normal` (`tokens.css:109`) have **0** uses. Keyframes:
`p` (`dashboard.css:237`), `bwpulse` (`dashboard.css:594`), `bb`
(`dashboard.css:619`), `loe-pulse` (`dashboard.css:625`), `arc-sweep`
(`dashboard.css:744`), `qt-wave` (`dashboard.css:896`), `qt-splash`
(`dashboard.css:897`), `qt-slosh` (`dashboard.css:899`), `qt-glow`
(`dashboard.css:900`), `qt-ball-pulse` (`dashboard.css:946`), `hv-flow`
(`hive.css:20`), `hv-bob` (`hive.css:32`), `hv-blink` (`hive.css:40`).

**Media-query breakpoints** (distinct expressions, counts):
`prefers-reduced-motion:reduce` ×15, `max-width:640px` ×8,
`min-width:641px` ×3, `max-width:600px` ×3, `max-width:900px` ×2,
`max-width:899px` ×2, `max-width:480px` ×2, `max-width:1279px` ×2,
`max-width:1100px` ×2, `max-width:1023px` ×2, `pointer:coarse` ×2, and
singles `max-width:960px`, `720px`, `700px`, `639px`, `599px`, `560px`,
`520px`, `479px`, `400px`, `390px`, `359px`, `min-width:1600px`,
`min-width:1280px`, `min-width:835px`, `max-height:820px`,
`forced-colors:active` ×1. That is **27 distinct expressions** with no shared
breakpoint scale.

## 4. Repeated components (selectors, file:line)

| Component | Selectors | Location |
|---|---|---|
| App bar (A) | `.appbar` sticky header | dashboard.css:670 |
| App bar (B) | `#appbar`, `body.hasnav #appbar` | dashboard.css:2166, dashboard.css:2168 — duplicate shell (item 10) |
| Nav | `#nav`, `#navscrim`, `.navitem`, `.navitem .nvico/.nvlabel/.nvbadge`, `#navcollapse`, `body.navcollapsed #navdrawer .navitem` | dashboard.css:635, dashboard.css:663, dashboard.css:647, dashboard.css:338–341, dashboard.css:497, dashboard.css:481 |
| Fleet bar | `.fleetbar`, `.fb-label`, `.fb-sep`, `.fb-kinds`, `.fb-strip`, `.fb-more`, `.fb-pbtn`, `.fb-pop`, `.fb-count`, `.fb-sheet` | dashboard.css:88, dashboard.css:91–137, dashboard.css:2141 |
| KPI cards | `.statgrid`, `.statgrid.live/.totals`, `.stat`, `.stat-label`, `.stat-value`, `.stat-unit`, `.stat-sub`, `.kpi`, `a.card.stat` | dashboard.css:245–250, dashboard.css:251–262, dashboard.css:224, dashboard.css:270 |
| Cards | `.card` | dashboard.css:39 |
| Tables | `table`, `.lmpanel table`, `.pv-tbl`, `.pv-tbl th`, `.dt th`, `.rt-matrix/.rt-authtbl/.rt-recent thead th`, live `.lvrow` grid | dashboard.css:222, dashboard.css:385, dashboard.css:1822–1823, dashboard.css:2005, dashboard.css:1624, dashboard.css:1904 |
| Buttons | `.btn` base + `.toast-actions .btn`, `.btn-apply`, `.btn-sm` (JS), plus bespoke: `.csvbtn` (dashboard.css:47), `.seg-btn` (dashboard.css:74), `.pk-btn` (dashboard.css:147), `.fb-more`/`.fb-pbtn` (dashboard.css:125), `.combo-btn` (dashboard.css:2109), `.lmbtn`, `.pchip`, `.kseg`, `.ttitlebtn` (views.js:1314) | variant counts: CSS `btn`-class rules **4** (`.btn` ×3 at dashboard.css:2073/2075/2232, `.btn-apply` ×1); JS emits `class="btn…"` in **7** template sites and `btn-sm` ×1; **10** bespoke button classes |
| Chips & badges | `.chip` (dashboard.css:192), `select.chip` (dashboard.css:203), `.lvrow .chip` override (dashboard.css:1950), `.fchip`/`.fchip-k/-on/-v` (dashboard.css:1076–1080, dashboard.css:2129–2131), `.pchip`, `.navbadge` (dashboard.css:341), provider badge `provBadge` (views.js:1166) | 7 chip-ish families (duplicates flagged, item 11) |
| Inputs | `input[type=date]` (dashboard.css:195, dashboard.css:2106), `select.chip` (dashboard.css:203), `.pk-q` (dashboard.css:146), `.hv-snd input` (hive.css:5) | dashboard.css:195, dashboard.css:146, hive.css:5 |
| Comboboxes | `.combo-btn`, `.combo-pop` | dashboard.css:2109, dashboard.css:2115 |
| Filter bar | `.fleetbar` + `.kseg` segmented range + `.fchip` chips + `.fb-sheet` mobile sheet | dashboard.css:88, dashboard.css:74, dashboard.css:1076, dashboard.css:2141 |
| Toasts | `.notices`, `.toast`, `[data-sev=info|ok|warn|error]`, `.toast-title/-text/-actions` | dashboard.css:2059–2075 |
| Drawers | `#drawer` (+`#scrim`), `#pdrawer` (+`#pdscrim`) | dashboard.css:1220/1226, dashboard.css:1338/1335 — duplicate (item 9) |
| Modals | `#tmodal` (+`#tscrim`), `#lnmodal` (+`#lnscrim`), `#sfmodal` (+`#sfscrim`), `#helpwrap` | dashboard.css:1243/1240, dashboard.css:1293/1290, dashboard.css:1304/1301, dashboard.css:790 |
| Menus/popovers | `#barmenu`, `.respop`, `.fb-pop` | dashboard.css:682, dashboard.css:606, dashboard.css:129 |
| Tooltips | `.qtip` (+`::before` arrow), `#lntip`, `.hv-tip` | dashboard.css:977–984, dashboard.css:1325, hive.css:13 — three implementations (item 7) |
| Charts | Chart.js factory `mk`/reuse guard, axis tinting; call sites `views.js:296` (bar), `views.js:752` (doughnut `cutout:'55%'`), `views.js:760` (stacked), sparkline `sparkSvg` (live.js:426); gauge `arc-sweep` | charts.js:2, charts.js:23, charts.js:46–53, views.js:296, views.js:752, views.js:760, dashboard.css:744 |
| Life view (flow.js) | jars/queue balls/depot/line/yard | markup `dashboard.html:185`–`dashboard.html:190`; `.qt-sec` (dashboard.css:853), `.qt-depot`/`.qt-line`/`.qt-yard` (dashboard.html:186–188, dashboard.css:855), `.qt-jar` (dashboard.css:856), `.qt-lid` (dashboard.css:860), `.qt-body` (dashboard.css:872), `.qt-cars` (dashboard.css:901), `.qt-ball` (dashboard.css:906), `.qt-ghost` (dashboard.css:945), `.qt-overflow` (dashboard.css:937), legend `.qt-legend`/`#qt-leg-ico` (dashboard.html:190, flow.js:130); ball factory `trainBall` (flow.js:91–97), icon `qtBallIcon` (flow.js:117–126), placement `paintTrain` (flow.js:356), splash `qtSplash` (flow.js:308). Note: the code has **no "oven" element** — the three jars are Depot (queued at an Ollama host, flow.js:14–15), On the line (running) and Yard (done) |
| Hive tab | `hive.js` (893 lines) + `hive.css` (74 lines), LST-278 semantic theme tokens `--hv-fill`, `--hv-feat`, `--hv-teeth`, `--hv-halo`, `--hv-rim-top-0..4`, `--hv-rim-bot-0..4`, `--hv-mouth-0..4`, `--hv-flame-0..4`, `--hv-fam-*`, `--hv-gauge-lo/mid/hi` | tokens.css:152–158; `.hv-head` (hive.css:2), `.hv-stage` (hive.css:11), `#hive-svg` (hive.css:12), `.hv-tip` (hive.css:13), `.hv-hex` node fill (hive.css:23), `.hv-crown` (hive.css:29), face parts `.hv-white/.hv-pupil/.hv-cheek` (hive.css:33), pressure gauge tokens `--hv-gauge-*` (tokens.css:158), colour generation `hive.js:32`, `hiveRgb` (hive.js:194) |

Duplicate selectors within one stylesheet are banned (stylelint
`no-duplicate-selectors`, `.stylelintrc.json:8`); the duplicates above are
parallel implementations across feature areas, which the lint cannot see.

## 5. Dark mode

Mechanism: `data-theme` attribute on `<html>`, dark default.

- Pre-paint script in `<head>` of the built artifact (inlined at
  `examples/reports/dashboard.html:6`):
  `try{if(localStorage.getItem('hermes-dash-theme')!=='light')document.documentElement.setAttribute('data-theme','dark')}catch(e){...}`
  — sets dark before first paint unless the saved preference is `light`.
- Runtime: `main.js` reads `localStorage.getItem('hermes-dash-theme')`
  (`main.js:149`), mounts dark at `main.js:153`, toggles and re-persists at
  `main.js:155`–`main.js:160`, then `readTheme()` re-tints Chart.js.
- Theme blocks: `:root, [data-theme="light"]` (tokens.css:58) and
  `[data-theme="dark"]` (tokens.css:160); dark-only widget fixes use
  `[data-theme=dark] input[type=date]{color-scheme:dark}` (dashboard.css:197)
  and `dashboard.css:365`.

Components lacking dark values:

- **Jar material is light-only**: the 15 `--jar-*` tokens (tokens.css:116–130)
  are declared only in the light block; the entire jar restyle is gated on
  `:root:not([data-theme="dark"])` (dashboard.css:2254–2264), so dark mode gets
  none of the glass/lid/edge treatment and the `--jar-hermes/pi/claude/codex`
  remaps (dashboard.css:2254) never apply. Confirmed by design in the file's
  own comment (tokens.css:112–115), but it means the two themes render
  different component anatomy, not just different colours (item 12).
- `--elev-0` has no dark sibling (tokens.css:104 vs tokens.css:204–206).
- `--hv-*` are theme-independent (tokens.css:150–158) — intentional (a lit
  head on its own dark fill), documented at tokens.css:151.
- Light-only filter shim `:root:not([data-theme="dark"]) .lvmodel{filter:brightness(.5)}`
  (dashboard.css:1936).

## 6. RTL

No Arabic is shipped and the code carries **zero** RTL scaffolding:

- `dir` attributes in `web/` (css+js): **0** matches.
- Logical properties (`margin-inline-*`, `padding-inline-*`, `inset-inline-*`,
  `text-align:start|end`, `border-inline-*`): **0** matches.
- Physical properties: `left|right:` **51** declarations,
  `margin-left` **35** vs `margin-right` **6** (examples: `.fb-label`
  `padding:0 4px 0 8px` at `dashboard.css:91`, `#drawer{right:0}` at
  `dashboard.css:1220`, `.stat-sub .kpi-kinds{margin-left:0}` at
  `dashboard.css:260`, `.hv-views{margin-left:12px}` at `hive.css:3`,
  `.hv-snd{margin-left:auto}` at `hive.css:4`).
- Direction-sensitive UI exists and would need mirroring if Arabic ever ships:
  drawer slide `transform:translateX(100%)` family (dashboard.css:1224),
  chevron/arrow glyphs (`&#8594;` at `drawer.js:497`), `.qt-ghost` flight
  paths (flow.js:327).

Conclusion: RTL support = none. If the family rule "support Arabic RTL wherever
the app ships Arabic" applies, this app currently ships no Arabic and the gap
is future-facing (item 21).

## 7. Accessibility

Counts (comment-stripped `web/`):

- `focus-visible` rules/usages: **27** (dashboard.css:41, dashboard.css:51,
  dashboard.css:62, dashboard.css:80, dashboard.css:123, dashboard.css:137,
  dashboard.css:164, dashboard.css:272, dashboard.css:306, dashboard.css:497,
  dashboard.css:699 global `:where(a,button,input,select,summary,[tabindex]):focus-visible`,
  dashboard.css:916 ball focus ring, hive.js/view buttons etc.).
- `aria-label`: **38** occurrences in css+js. Of **43** `<button …>` template
  strings in `web/js`, **5** carry `aria-label` and **12** carry `title`
  (remaining buttons have visible text). Examples with labels:
  `dashboard.html:186`–`dashboard.html:188` jar sections (`aria-label="Depot:
  waiting"` etc.), `views.js:1314`.
- `prefers-reduced-motion` blocks: **15** (dashboard.css:2084 `toast{animation:none}`,
  plus blocks neutralising `qt-*`, drawer and chart animations).
- `forced-colors` blocks: **1** (dashboard.css only; Hive SVG fills in
  hive.css/hive.js are not covered).
- Skip link present (`.skip`, dashboard.css:229), `role=group`/`role=cell`
  usage in the jar and live grid (dashboard.html:186, live.js:426),
  `aria-hidden` on the decorative legend (dashboard.html:190).
- Hit targets: `min-height` floors at `--ctl-md`/`--ctl-lg`
  (dashboard.css:2039, dashboard.css:2041) and 44px on coarse pointers
  (dashboard.css:2159).

### WCAG contrast (computed, both themes)

Script: `/home/hazemhagrass/.hermes/profiles/llm-telemetry-brain/cache/scratch/contrast.py`
(sRGB relative-luminance formula, WCAG 2.1). Full output in appendix A9.

| Pair | Light | AA (4.5) | Dark | AA (4.5) |
|---|---|---|---|---|
| `--fg` on `--bg` | 15.99 | PASS | 18.58 | PASS |
| `--fg` on `--card` | 16.57 | PASS | 17.30 | PASS |
| `--muted` on `--bg` | 4.60 | PASS | 6.25 | PASS |
| `--muted` on `--card` | 4.77 | PASS | 5.82 | PASS |
| `--accent` on `--bg` | 5.55 | PASS | 8.91 | PASS |
| `--accent` on `--card` | 5.76 | PASS | 8.30 | PASS |
| `--accent2` on `--bg` | 3.13 | **FAIL** | 6.44 | PASS |
| `--accent2` on `--card` | 3.24 | **FAIL** | 6.00 | PASS |
| `--z-ok` on `--bg` | 5.23 | PASS | 6.37 | PASS |
| `--z-ok` on `--card` | 5.41 | PASS | 5.93 | PASS |
| `--z-warn` on `--bg` | 5.52 | PASS | 8.24 | PASS |
| `--z-warn` on `--card` | 5.72 | PASS | 7.67 | PASS |
| `--z-bad` on `--bg` | 5.53 | PASS | 5.47 | PASS |
| `--z-bad` on `--card` | 5.73 | PASS | 5.09 | PASS |
| `--z-ok-fg` on `--bg` | 1.13 | **FAIL** | 17.09 | PASS |
| `--z-ok-fg` on `--card` | 1.17 | **FAIL** | 15.91 | PASS |
| `--z-warn-fg` on `--bg` | 1.14 | **FAIL** | 17.22 | PASS |
| `--z-warn-fg` on `--card` | 1.18 | **FAIL** | 16.03 | PASS |
| `--z-bad-fg` on `--bg` | 1.18 | **FAIL** | 16.45 | PASS |
| `--z-bad-fg` on `--card` | 1.22 | **FAIL** | 15.31 | PASS |

Every failure: 8 pairs. All six `--z-*-fg` light pairs fail even the 3:1
UI/large-text bar (~1.2:1) — these are badge tints that only work as text on
their solid `--z-*` fill, exactly the known split recorded in
`tokens.css:52`–`tokens.css:55`; the code still also uses them as text on the
card (item 4). `--accent2` light (3.13/3.24) is fine as a chart line (UI
graphic, 3:1) but fails body text (item 5).

## 8. Standalone Hive (`/home/hazemhagrass/workspace/beinno/hive/index.html`)

Not git, read-only, not edited; `beinno-hive` untouched. 2,455 lines, one
inline `<style>` (`hive/index.html:7`).

- **Palette**: `:root{--bg:#05060a;--fg:#f5f5f5;--mute:#8a8f9a;--card:#0f1118}`
  (`hive/index.html:8`). These match the LST-278 dark tokens exactly
  (`tokens.css:162`–`tokens.css:165`; note its `--mute` spelling vs
  `--muted`). Borders `#1d2130` (×8) and `#262a36` (button border,
  `hive/index.html:23`) match `--border`/`--border-strong` dark
  (tokens.css:166, tokens.css:172). But most colours are raw one-offs outside
  the four variables: `#fff` ×17, `#ffd23f` ×10 (shout), `#1a1e2a` ×7,
  `#aab` ×6, `#5f8` ×6, `#8af` ×5, `#ffb020` ×4, `#f55` ×4, `#0f1118ee` ×4,
  `#2a2f40` (gauge border, `hive/index.html:189`), `#9aa4b8` (gauge label,
  `hive/index.html:189`), `#9cf` (`hive/index.html:949`) — none of which
  appear in `tokens.css`.
- **Fonts**: body `Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif`
  at `15px/1.5` (`hive/index.html:10`) — close to `--font` (tokens.css:141)
  but drops `Roboto`; shout text uses `Impact,"Arial Black",sans-serif`
  (`hive/index.html:121`), a family that exists nowhere in the dashboard;
  gauge `Inter,system-ui,sans-serif` (`hive/index.html:189`).
- **Radii**: `10px` ×3 (matches `--radius-ctl`, tokens.css:140), plus one-offs
  `3px` ×2, `4px`, `6px`, `8px`, `9px`, `12px`, `14px`, `12px 0 0 12px`,
  `50%`, `0` — mirroring the dashboard's radius sprawl (item 16).
- **Light theme: none.** No `prefers-color-scheme`, no `data-theme`, one
  `:root` block only. The page is permanently dark.

## 9. HARD RULE: jar balls and jar legend show provider brand SVGs (compliant)

Confirmed compliant at `f08f40f`, with executed evidence:

- Ball factory attaches no text: `trainBall` builds `<button class="qt-ball
  qt-<kind>">` containing only the icon span (`flow.js:91`–`flow.js:97`).
- Every ball gets a brand SVG: `qtBallIcon` calls `provLogoSvg(model, 14,
  …)` from `views.js:236`, provider resolved by `provOf` (`views.js:173`);
  a depot ball with no model shows the Ollama logo via the `'local'` prov key
  (`flow.js:118`–`flow.js:120`); an unknown provider falls back to a neutral
  hexagon SVG, explicitly never a letter (`flow.js:123`–`flow.js:125`).
- The legend uses the same icon path: `qtLegend()` fills `#qt-leg-ico` with
  `qtBallIcon({kind:'q'})` (`flow.js:129`–`flow.js:133`), wired from
  `paintTrain` (`flow.js:359`); legend markup `dashboard.html:190` ("Ball icon
  = LLM provider"). The monogram table `QT_GLYPH` is absent from `flow.js`.
- Guard test `tests/check_qt_ball_provider_icons.js` (header states the rule
  and that `b62a823` was a reverted regression,
  `tests/check_qt_ball_provider_icons.js:1`–`tests/check_qt_ball_provider_icons.js:5`).
  Ran it against the built `examples/reports/dashboard.html`:
  **13 passed, 0 failed** ("every .qt-ball contains an svg", "no .qt-ball
  shows a single-letter text glyph", "no-model depot balls get the Ollama
  logo", "the legend shows no letter glyph", …).
- Hive-side provider marks are also SVG: `provLogoSvg`-style inline SVG with
  `fill:var(--muted)` (`.hv-prov`, `hive.css:16`).

## 10. Numbered mismatch list (Plane tickets to be filed)

1. **Raw hex colours in JS (65)** — high — evidence: 65 hits across 8 files,
   e.g. `palette.js:17` (10-colour `PAL` array), `routerview.js` 14 hits,
   `views.js:88` (inline `z-index:80…` style string), `flow.js:557`
   (3 status hexes). Fix: read `PAL`/status hues through
   `getComputedStyle` (`main.js:30` `css()` helper already exists) and ban hex
   in `web/js` with one eslint `no-restricted-syntax` rule.
2. **Raw rgb/hsl in JS (40), incl. canvas and inline styles** — high —
   evidence: 40 hits; `views.js:1265` `ctx.fillStyle='rgba(148,163,184,0.35)'`,
   `views.js:1266`, `flow.js:125` `style="fill:#5b6472"`, `flow.js:560`
   inline `background`, `hive.js:32` generated `hsl(...)`, `palette.js` 7 hits.
   Fix: same `css()` reads; move canvas tints to `--pal-*`/`--state-*` lookups.
3. **Status token values duplicated as literals in 4 JS modules** — high —
   evidence: `#5f9e6e/#c4a06e/#c66a6a/#64748b` repeated at `charts.js:355`,
   `flow.js:557`, `flow.js:560`, `drawer.js:800`, `drawer.js:801`,
   `palette.js:230`, `palette.js:231` — these ARE `--z-ok/warn/bad` values
   copied out of `tokens.css:89`–`tokens.css:91`; 7 sites. Fix: one shared
   `Z = {ok: css('--z-ok'), …}` export in `state.js`/`palette.js`, delete the
   literals.
4. **`--z-*-fg` fails contrast on light surfaces** — high — evidence: 6 failing
   pairs at 1.13–1.22:1 (appendix A9), tokens.css:92–94, used as text on the
   card via `.navbadge.alert`-family rules; the split is already flagged in
   `tokens.css:52`–`tokens.css:55`. Fix: split into `--z-ok-text` (use
   `--z-ok`) for text-on-card and keep `--z-*-fg` strictly for text-on-fill;
   add the pair to `tests/check_hive_tokens.js`.
5. **`--accent2` light fails body-text AA** — med — evidence: 3.13:1 on `--bg`,
   3.24:1 on `--card` (appendix A9), `tokens.css:70`. Fix: darken light
   `--accent2` to ≥4.5:1 (e.g. `#5b7383` band) or restrict it to ≥3:1 chart
   strokes in the DESIGN.md rule.
6. **Raw rgb/hsl in dashboard.css (66)** — med — evidence: 66 declarations, e.g.
   `dashboard.css:131`, `dashboard.css:606` (`.respop` shadow),
   `dashboard.css:1936`. Fix: stylelint `function-no-unknown` sibling rule or
   a `declaration-property-value-allowed-list` for `color|background`
   restricted to `var()|color-mix()|transparent`, exemption for `tokens.css`.
7. **Three tooltip implementations** — med — evidence: `.qtip`
   (`dashboard.css:977`–`dashboard.css:984`), `#lntip` (`dashboard.css:1325`),
   `.hv-tip` (`hive.css:13`) — 3 shells, 3 positioning code paths
   (`flow.js:491`, `flow.js:511` place `.qtip`). Fix: keep `.qtip` as the one
   component; make `#lntip`/`.hv-tip` themeable instances of it.
8. **Three modal shells and four scrims** — med — evidence: `#tmodal`
   (`dashboard.css:1243`), `#lnmodal` (`dashboard.css:1293`), `#sfmodal`
   (`dashboard.css:1304`) with `#tscrim`/`#lnscrim`/`#sfscrim`/`#pdscrim`
   (`dashboard.css:1240`, `dashboard.css:1290`, `dashboard.css:1301`,
   `dashboard.css:1335`) — 7 near-identical fixed shells. Fix: one `.modal` +
   `.scrim` pair with size modifiers; migrate one modal per PR.
9. **Two drawers** — low — evidence: `#drawer` (`dashboard.css:1220`) vs
   `#pdrawer` (`dashboard.css:1338`), both fixed right-side panels with their
   own scrim. Fix: name `#pdrawer` a `.drawer.drawer-wide` variant of `#drawer`.
10. **Two app bars** — med — evidence: `.appbar` (`dashboard.css:670`) and
    `#appbar` (`dashboard.css:2166`, `dashboard.css:2168`) — both sticky top
    headers with different z (40 vs 30) and heights. Fix: delete the retired
    one (whichever markup no longer mounts, checked in `dashboard.html`) and
    keep a single `#appbar` spec.
11. **Two dropdown families (chips vs combo)** — low — evidence:
    `select.chip` native select (`dashboard.css:203`–`dashboard.css:211`)
    vs custom `.combo-btn`/`.combo-pop` (`dashboard.css:2109`,
    `dashboard.css:2115`) + `.chip` base (`dashboard.css:192`) overridden at
    `dashboard.css:1950`; 3 chip shapes total (`.chip`, `.fchip`, `.pchip`).
    Fix: document chips as one component with `select`/`button` variants and
    one height/radius spec.
12. **Jar material tokens are light-only** — med — evidence: 15 `--jar-*`
    declared only in the light block (`tokens.css:116`–`tokens.css:130`), all
    jar styling gated `:root:not([data-theme="dark"])` (`dashboard.css:2254`–
    `dashboard.css:2264`). Fix: add the dark block (`--jar-glass` etc. at Hive
    night values) so both themes share the jar anatomy, or record "dark jars
    intentionally plain" in DESIGN.md.
13. **Motion tokens defined but unused; 39 raw durations** — med — evidence:
    `--motion-fast`/`--motion-normal` at `tokens.css:109` with 0 uses; 39
    distinct durations incl. near-duplicates `.18s` vs `180ms` and `.24s`/
    `.25s`/`.26s`; easings 38×`ease` + 4 other curves. Fix: route transitions
    through `var(--motion-fast|normal)` and add `--motion-slow:300ms` for the
    drawer/modal family in the same PR as DESIGN.md.
14. **No z-index layer scale (27 raw values)** — med — evidence: histogram in
    section 3 (`dashboard.css:229` 200, `dashboard.css:937` 1000,
    `dashboard.css:945` 950, `dashboard.css:914` 900, `views.js:39` inline
    100). Fix: declare `--z-base:0/--z-sticky:10/--z-nav:60/--z-scrim:65/
    --z-drawer:70/--z-modal:80/--z-tip:90/--z-toast:100/--z-drag:900` and
    remap gradually.
15. **Spacing scale bypass + drifting `--sp-2`** — med — evidence: 299 raw
    px padding/margin/gap declarations vs 7 `--sp-*` uses; 20+ distinct gap
    values; and `dashboard.css:16` re-declares `--sp-2:6px` while
    `tokens.css:107` says `--sp-2:8px` (2 conflicting values for one name).
    Fix: delete the `dashboard.css:16` copies (single source in tokens.css),
    then lint raw px in spacing props like item 6.
16. **Radius one-offs (13 raw values off scale)** — low — evidence:
    `999px` ×24, `3px` ×16, `2px` ×17, `6px` ×4, `5px` ×3, `7px`, `9px` ×2,
    `13px` (`dashboard.css:937`), compounds like `0 0 30px 30px`;
    `--radius-sm/md/lg` (tokens.css:108) have 0 uses. Fix: adopt
    `--radius-ctl`/`--radius-sm/md/lg`, keep `999px`/`50%` as named
    `--radius-pill`/`--radius-full`.
17. **Shadows off the `--elev-*` scale** — low — evidence: only 2 `--elev-*`
    uses (`dashboard.css:39`) vs 21 distinct raw `box-shadow` values
    (`dashboard.css:843`, `dashboard.css:977`, `dashboard.css:1243`-area
    modal shadows). Fix: map popovers to `--elev-2`, modals/tooltips to
    `--elev-3`, add `--elev-4` only if 70px blur stays.
18. **Type-scale bypass** — med — evidence: 57 raw `font-size:13px|14px`
    declarations (36+21) alongside `--fs-xs`/`--fs-sm` (dashboard.css:11–12),
    plus one-off 28/26/24/22/19px values (appendix A5). Fix: replace literals
    with `--fs-*` tokens; add `--fs-2xl` for the 22-28px display sizes used by
    `.stat-value` (`dashboard.css:255`) and `.kpi` (`dashboard.css:224`).
19. **Mono stack drift and an undeclared `--mono`** — low — evidence: 4 mono
    spellings (7× `ui-monospace,monospace`, 3+1× full
    `ui-monospace,SFMono-Regular,Menlo,monospace` wrapped at
    `dashboard.css:1390`, 1× `var(--mono,monospace)` at `dashboard.css:1058`
    where `--mono` is declared nowhere). Fix: declare `--mono` once in
    tokens.css next to `--font` (tokens.css:141) and use `var(--mono)`
    everywhere.
20. **Breakpoint sprawl (27 expressions)** — low — evidence: histogram in
    section 3 — adjacent pairs `479/480`, `599/600`, `639/640/641`, `899/900`,
    `1023/1100/1279`. Fix: name 4 breakpoints (e.g. 480/640/900/1280) and
    snap the stragglers in one pass.
21. **No RTL scaffolding** — med — evidence: 0 `dir` attributes, 0 logical
    properties, 51 `left|right:` declarations, `margin-left` 35 vs
    `margin-right` 6 (section 6). Fix: record "LTR-only product" in DESIGN.md
    now; if Arabic ships later, convert the drawer/toast/nav edges to
    `inset-inline-*` first.
22. **Icon-only buttons missing `aria-label`** — med — evidence: of 43
    `<button>` template strings in `web/js`, 5 have `aria-label`, 12 have
    `title` (e.g. `live.js:1005` sound toggle renders only `&#128266;` glyph
    text with no label). Fix: add `aria-label` to the glyph-only set (sound,
    zoom, drawer close, overflow chip `dashboard.css:937`) in one PR; an
    eslint grep-check like `tests/check_inline_sized_elements.js`.
23. **Single `forced-colors` block** — low — evidence: 1 block
    (`dashboard.css`), none in `hive.css`; Hive SVG fills (`hive.css:23`–
    `hive.css:33`) would flatten in forced-colors. Fix: one
    `@media (forced-colors:active)` block for `.hv-hex`, `.hv-crown`, qt balls.
24. **Hive tab generates raw colours at runtime** — low — evidence:
    `hive.js:32` synthesises `hsl(<hash>,70%,62%)` per family and
    `hive.js:194` `hvRgb` builds `rgb()` strings; the sanctioned family tokens
    are `--hv-fam-*` (tokens.css:157). Fix: map the four families to
    `--hv-fam-*` and use the hash colour only as a documented fallback for
    unknown families.
25. **Standalone Hive drifts from tokens.css and has no light theme** — med —
    evidence: `#2a2f40` and `#9aa4b8` (hive/index.html:189), `Impact,"Arial
    Black"` (hive/index.html:121), 9 radius one-offs, font stack missing
    `Roboto` (hive/index.html:10 vs tokens.css:141), only 4 CSS variables
    (hive/index.html:8) vs 60+ tokens, no `prefers-color-scheme`/`data-theme`.
    Fix: during the Hive move (LLMTELEMET-267/H-9) point the page at
    `tokens.css` values and reuse `--hv-*`; a light theme is out of scope
    unless Hazem asks — say so in DESIGN.md.

## Appendix: measured grep runs

All run from `/home/hazemhagrass/workspace/beinno/LLM-Telemtry/.worktrees/design-md`
on `f08f40f`. `S` = the comment-stripped projection
(`/home/hazemhagrass/.hermes/profiles/llm-telemetry-brain/cache/scratch/nocomments.txt`,
built with `strip_comments.py` in the same directory: block comments blanked
keeping line numbers, `//` comments dropped keeping URLs). `PY` =
`/home/hazemhagrass/workspace/beinno/LLM-Telemtry/.venv/bin/python`.

A0. Projection:
`for f in src/llm_telemetry/web/css/*.css src/llm_telemetry/web/js/*.js; do $PY .../strip_comments.py "$f"; done > .../nocomments.txt`
→ 11,120 code lines.

A1. CSS hex outside tokens:
`grep 'web/css/' $S | grep -v tokens.css | grep -P '(?<!&)#[0-9a-fA-F]{3,8}\b' | wc -l`
→ **0** (the raw grep without comment stripping shows 15, all ticket refs like
`#149` in comments — `dashboard.css:43`, `dashboard.css:46`, `dashboard.css:244`).

A2. CSS rgb/hsl outside tokens:
`grep 'web/css/' $S | grep -v tokens.css | grep -cE '(rgba?|hsla?)\('`
→ **66**, all `dashboard.css`.

A3. JS hex:
`grep 'web/js/' $S | grep -P '(?<!&)#[0-9a-fA-F]{3,8}\b' | wc -l`
→ **65**; per file `awk -F: '{print $1}' | sort | uniq -c` →
views.js 29, routerview.js 14, palette.js 13, flow.js 3, drawer.js 2,
live.js 2, charts.js 1, main.js 1.

A4. JS rgb/hsl:
`grep 'web/js/' $S | grep -cE '(rgba?|hsla?)\('`
→ **40**; per file → views.js 22, palette.js 7, router.js 3, hive.js 2,
flow.js 2, live.js 2, charts.js 1, drawer.js 1.

A5. Font sizes:
`grep -oE 'font-size: *[0-9.]+(px|rem|em)' $S | sort | uniq -c | sort -rn`
→ 13px ×36, 14px ×21, 22px ×3, 18px ×3, 15px ×3, 19px ×2, 16px ×2, 28px ×1,
26px ×1, 24px ×1, 12px ×1, 10px ×1, 1.2rem ×1, .9em ×1. Tokenised sizes:
`grep -oE 'font-size:var\(--fs-[a-z0-9-]+'` → fs-xs 143, fs-sm 56, fs-md 20,
fs-lg 13, fs-2xs 6.

A6. Spacing:
`grep -v tokens.css $S | grep -cE '(padding|margin|gap)[a-z-]*: *[0-9.]+px'`
→ **299** (dashboard.css 269, hive.css 14, views.js 12, drawer.js 2, live.js 1,
router.js 1). `grep -oE 'var\(--sp-[0-9]\)' $S | sort | uniq -c` → sp-2 ×1,
sp-3 ×1, sp-4 ×3, sp-6 ×2 (total 7). `grep -oE 'gap: *[^;")}]+' | sort |
uniq -c` → 20+ distinct (top: 8px ×36, 6px ×20, 4px ×14, 2px ×10, .5rem ×10).

A7. Radius / shadow / z-index:
`grep -oE 'border-radius: *[^;")}]+' $S | sort | uniq -c | sort -rn` →
var(--radius-ctl) ×74, 999px ×24, 4px ×18, 2px ×17, 3px ×16, 50% ×14,
99px ×4, 6px ×4, 5px ×3, 9px ×2, 1px ×2, singles 7px/8px/12px/13px + 5
compound. `grep -oE 'box-shadow: *[^;")}]+' | sort | uniq -c` → 21 distinct
raw + var(--elev-1) ×1 + var(--elev-2) ×1 + var(--glow-*) ×6 +
color-mix rings ×7. `grep -oE 'z-index: *[^;")}]+' | sort | uniq -c` →
27 distinct values (histogram in section 3).

A8. Motion / media:
`grep -oE '(transition|animation)[a-z-]*: *[^;")}]+' $S | grep -oE '[0-9.]+m?s' | sort | uniq -c | sort -rn`
→ **39** distinct durations (top: .12s ×16, .18s ×7, .2s ×6, .3s ×5).
Easings `... | grep -oE 'ease[a-z-]*|linear|cubic-bezier\([^)]*\)' | sort | uniq -c`
→ ease ×38, ease-out ×8, ease-in-out ×6, linear ×5, ease-in ×3, cubic-bezier ×1.
`grep -c 'var(--motion-' $S` → **0**. Media:
`grep -oE '@media ?\([^)]*\)' $S | tr -d ' ' | sort | uniq -c | sort -rn` →
27 distinct expressions (histogram in section 3).
`grep -n '@keyframes' $S` → 13 keyframe blocks (listed in section 3).

A9. Contrast:
`$PY /home/hazemhagrass/.hermes/profiles/llm-telemetry-brain/cache/scratch/contrast.py`
→ 20 pairs printed (section 7 table), **8 failures** vs 4.5:1:
`--accent2` light 3.13/3.24, `--z-ok-fg` light 1.13/1.17, `--z-warn-fg` light
1.14/1.18, `--z-bad-fg` light 1.18/1.22.

A10. RTL:
`grep -rn 'dir=' src/llm_telemetry/web --include='*.js' --include='*.css' | wc -l`
→ **0**. `grep -oE '(margin|padding)-(inline|block)...' $S | uniq -c` → **0**.
`grep -cE '(^|[^-a-z])(left|right):' $S` → **51**. `grep -c 'margin-left' $S`
→ **35**; `margin-right` → **6**.

A11. A11y:
`grep -c 'focus-visible' $S` → **27**; `grep -c 'aria-label' $S` → **38**;
`grep -c 'prefers-reduced-motion' $S` → **19** strings / **15** `@media`
blocks (`grep -oE '@media ?\([^)]*\)'` above); `grep -c 'forced-colors' $S` →
**1**. Buttons: `grep -ohE '<button[^>]*>' src/llm_telemetry/web/js/*.js | wc -l`
→ **43**; with `aria-label` → **5**; with `title=` → **12**.

A12. Components:
`grep -n '\.appbar{\|#appbar{\|...' src/llm_telemetry/web/css/dashboard.css`
→ anchors in section 4. Button classes:
`grep -oE '\.btn[a-z0-9-]*' dashboard.css | sort | uniq -c` → `.btn` ×3,
`.btn-apply` ×1; `grep -ohE 'class="[^"]*\bbtn[a-z0-9-]*' web/js/*.js` → 7
sites. Chips: `grep -n '\.chip' dashboard.css` → 17 selector occurrences
across 4 blocks.

A13. Dark mode:
`grep -rn 'data-theme' src/llm_telemetry --include='*.py' --include='*.js' --include='*.css' -l`
→ main.js, views.js, hive.js, tokens.css, dashboard.css. `grep -n
'data-theme="dark"' dashboard.css` → 9 hits, jar family at
`dashboard.css:2254`–`dashboard.css:2264`. Pre-paint script confirmed in the
built artifact: `grep -n 'data-theme' examples/reports/dashboard.html` → line 6.

A14. Jar guard (executed):
`node tests/check_qt_ball_provider_icons.js` → **13 passed, 0 failed**.
`node tests/check_inline_sized_elements.js --quiet` → **2 passed, 0 failed**.

A15. Standalone Hive:
`grep -noE '#[0-9a-fA-F]{3,8}\b' /home/hazemhagrass/workspace/beinno/hive/index.html | … uniq -c`
→ #fff ×17, #ffd23f ×10, #feed ×8 (part of `#ffeedd`-class matches), #1d2130 ×8,
#1a1e2a ×7, #ffffff ×6, #aab ×6, #5f8 ×6, #8af ×5, #05060a ×5 … (top 30 kept).
`grep -oE 'border-radius:[^;}"]*' … | uniq -c` → 10px ×3, 3px ×2, 9 singles.
`grep -n 'prefers-color-scheme\|data-theme' …` → **0**. `grep -n ':root'` → 1
(hive/index.html:8). Fonts: `grep -noE 'font:[^;}"]*' …` → 3 stacks
(hive/index.html:10, hive/index.html:121, hive/index.html:189).
