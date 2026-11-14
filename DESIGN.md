---
version: alpha
name: LLM-Telemetry (+ Hive)
description: Operations board for the Beinno LLM fleet — usage, cost, live sessions, task-queue jars and the Hive tab, dark-first, one self-contained HTML artifact.
colors:
  # ONE palette, declared in src/llm_telemetry/web/css/tokens.css (the only file allowed to
  # hold hex/rgb/hsl literals). Names match the CSS custom properties exactly (--bg -> colors.bg).
  # Dark theme = sibling tokens with a `-dark` suffix (Beinno convention); `-dark` reads the
  # `[data-theme="dark"]` value of the same `--<name>` (tokens.css:160-208).
  # ---------- Light (`:root, [data-theme="light"]`, tokens.css:58-131) ----------
  bg: "#fbfbf9"                          # --bg  page surface
  card: "#ffffff"                        # --card  raised surface
  fg: "#1a201c"                          # --fg  body text
  muted: "#6f746f"                       # --muted  secondary text
  border: "rgba(26,32,28,.12)"           # --border  decorative hairline (non-essential, exempt)
  border-input: "#6b6e78"                # --border-input  control boundaries (>=3:1 on card, WCAG 1.4.11)
  accent: "#1f62c9"                      # --accent  the one accent (Grafana blue)
  accent-ink: "#ffffff"                  # --accent-ink  text/icon on accent fills
  accent-wash: "rgba(31,98,201,.10)"     # --accent-wash
  accent2: "#7793a2"                     # --accent2  charts' secondary (see Accessibility: proposed AA change)
  border-strong: "rgba(26,32,28,.22)"    # --border-strong
  active-a: "#1f62c9"                    # --active-a  active glow pair
  active-b: "#1a7f3c"                    # --active-b
  live-dot: "#1a7f3c"                    # --live-dot  fresh-feed dot
  wash-indigo: "rgba(99,110,164,.12)"    # --wash-indigo  pastel washes on cards
  wash-rose: "rgba(178,105,122,.13)"     # --wash-rose
  wash-slate: "rgba(104,122,133,.13)"    # --wash-slate
  wash-amber: "rgba(178,138,88,.13)"     # --wash-amber
  wash-mint: "rgba(88,150,115,.12)"      # --wash-mint
  z-ok: "#39764f"                        # --z-ok  status: good (solid mark / text-on-surface)
  z-warn: "#7c6328"                      # --z-warn  status: warning
  z-bad: "#a14d47"                       # --z-bad  status: error
  z-ok-fg: "#e4f0e9"                     # --z-ok-fg  badge text ON a solid --z-ok fill ONLY
  z-warn-fg: "#f4ecd7"                   # --z-warn-fg  badge text ON --z-warn fill ONLY
  z-bad-fg: "#f7e4e4"                    # --z-bad-fg  badge text ON --z-bad fill ONLY
  pal-indigo: "#7c86b0"                  # --pal-indigo  solid chart pastels (Chart.js fills)
  pal-rose: "#b87383"                    # --pal-rose
  pal-slate: "#71868f"                   # --pal-slate
  pal-amber: "#ac895a"                   # --pal-amber
  pal-mint: "#5f9e78"                    # --pal-mint
  state-hover: "rgba(0,0,0,.04)"         # --state-hover  state layer
  state-pressed: "rgba(0,0,0,.08)"       # --state-pressed
  state-focus: "rgba(31,98,201,.25)"     # --state-focus
  # ---- task-queue jar material (tokens.css:112-130). Declared under `:root`, consumed only by
  # ---- the LIGHT jar restyle (`:root:not([data-theme="dark"])`, dashboard.css:2251-2292): the
  # ---- values are theme-independent but dark jars intentionally stay plain (mismatch 12).
  jar-glass: "hsl(220 20% 97%)"          # --jar-glass
  jar-edge: "hsl(220 18% 46%)"           # --jar-edge
  jar-ink: "hsl(225 25% 6%)"             # --jar-ink  jar count/label ink (>=4.5:1 on every marble, tests/check_jars_light.js)
  jar-label: "hsl(220 20% 20%)"          # --jar-label
  jar-label-soft: "hsl(220 12% 34%)"     # --jar-label-soft
  jar-lid-top: "hsl(0 0% 100%)"          # --jar-lid-top
  jar-lid-bot: "hsl(220 18% 90%)"        # --jar-lid-bot
  jar-shadow: "hsl(220 30% 20% / .34)"   # --jar-shadow
  jar-glow: "hsl(199 95% 38%)"           # --jar-glow  legend "glowing" swatch
  jar-ring: "hsl(28 95% 36%)"            # --jar-ring  legend "waiting" dashed ring
  jar-hermes: "hsl(199 90% 41%)"         # --jar-hermes  light-theme ball remap (kind identity)
  jar-pi: "hsl(265 70% 65%)"             # --jar-pi
  jar-claude: "hsl(18 88% 48%)"          # --jar-claude
  jar-codex: "hsl(152 75% 33%)"          # --jar-codex
  jar-wait: "hsl(215 30% 54%)"           # --jar-wait
  # ---- theme-independent semantic tokens (tokens.css:139-158, `:root` only) ----
  fb-surface: "#f6f6f6"                  # --fb-surface = color-mix(in srgb,var(--fg) 4%,var(--card)); resolved here per family rule
  fb-raise: "#eaebeb"                    # --fb-raise   = color-mix(in srgb,var(--fg) 9%,var(--card)) (light resolve)
  kind-hermes: "hsl(199 60% 56%)"        # --kind-hermes  agent-kind identity (the ONE source)
  kind-pi: "hsl(265 55% 64%)"            # --kind-pi
  kind-claude: "hsl(18 70% 60%)"        # --kind-claude
  kind-codex: "hsl(152 50% 52%)"         # --kind-codex
  # ---- Hive (LST-272/278): Hazem's neon head. Theme-independent (a lit head on its own dark
  # ---- fill, tokens.css:151). -N = anger keyframe 0, .25, .5, .75, 1.
  hv-fill: "#0a0a0a"                     # --hv-fill
  hv-feat: "#f4f1f2"                     # --hv-feat
  hv-teeth: "#ece2de"                    # --hv-teeth
  hv-halo: "#5a0f1c"                     # --hv-halo
  hv-rim-top-0: "#ff70b0"                # --hv-rim-top-0
  hv-rim-top-1: "#ff6a96"                # --hv-rim-top-1
  hv-rim-top-2: "#ff6854"                # --hv-rim-top-2
  hv-rim-top-3: "#ff6234"                # --hv-rim-top-3
  hv-rim-top-4: "#ff6026"                # --hv-rim-top-4
  hv-rim-bot-0: "#ff963c"                # --hv-rim-bot-0
  hv-rim-bot-1: "#ff8c34"                # --hv-rim-bot-1
  hv-rim-bot-2: "#ff7622"                # --hv-rim-bot-2
  hv-rim-bot-3: "#ff521c"                # --hv-rim-bot-3
  hv-rim-bot-4: "#ff2e1a"                # --hv-rim-bot-4
  hv-mouth-0: "#aa768c"                  # --hv-mouth-0
  hv-mouth-1: "#a0647a"                  # --hv-mouth-1
  hv-mouth-2: "#8c3742"                  # --hv-mouth-2
  hv-mouth-3: "#70161e"                  # --hv-mouth-3
  hv-mouth-4: "#5c0a10"                  # --hv-mouth-4
  hv-flame-0: "#ff5614"                  # --hv-flame-0
  hv-flame-1: "#ff841e"                  # --hv-flame-1
  hv-flame-2: "#ffc43c"                  # --hv-flame-2
  hv-flame-3: "#ffe482"                  # --hv-flame-3
  hv-flame-4: "#fffaee"                  # --hv-flame-4
  hv-fam-root: "#5cd0ff"                 # --hv-fam-root  Hive family colours (--hv-fam-<id>)
  hv-fam-pixelvent: "#ff5fc8"            # --hv-fam-pixelvent
  hv-fam-acasia: "#5dff9a"               # --hv-fam-acasia
  hv-fam-somethingpressing: "#ffc14d"    # --hv-fam-somethingpressing
  hv-gauge-lo: "{colors.z-ok}"           # --hv-gauge-lo:var(--z-ok)  pressure gauge zones
  hv-gauge-mid: "{colors.z-warn}"        # --hv-gauge-mid:var(--z-warn)
  hv-gauge-hi: "{colors.z-bad}"          # --hv-gauge-hi:var(--z-bad)
  # ---------- Dark (`[data-theme="dark"]`, tokens.css:160-208) ----------
  bg-dark: "#05060a"
  card-dark: "#0f1118"
  fg-dark: "#f5f5f5"
  muted-dark: "#8a8f9a"
  border-dark: "#1d2130"
  border-input-dark: "#6b6e78"           # same value in both themes
  accent-dark: "#88aaff"                 # Hive periwinkle blue, the single calm accent
  accent-ink-dark: "#05060a"
  accent-wash-dark: "rgba(136,170,255,.14)"
  accent2-dark: "#b877d9"                # muted violet, charts' secondary
  border-strong-dark: "#262a36"
  active-a-dark: "#88aaff"               # Hive active glow pair #8af / #5f8
  active-b-dark: "#55ff88"
  live-dot-dark: "#55ff88"
  wash-indigo-dark: "rgba(87,148,242,.14)"
  wash-rose-dark: "rgba(242,73,92,.14)"
  wash-slate-dark: "rgba(204,204,220,.08)"
  wash-amber-dark: "rgba(255,152,48,.14)"
  wash-mint-dark: "rgba(110,170,140,.14)"
  z-ok-dark: "#5f9e6e"
  z-warn-dark: "#c2a15c"
  z-bad-dark: "#c66a6a"
  z-ok-fg-dark: "#dff0e4"
  z-warn-fg-dark: "#f4ecda"
  z-bad-fg-dark: "#f7e3e3"
  pal-indigo-dark: "#5794f2"
  pal-rose-dark: "#f2495c"
  pal-slate-dark: "#8ab8ff"
  pal-amber-dark: "#ff9830"
  pal-mint-dark: "#6eaa8c"
  state-hover-dark: "rgba(255,255,255,.06)"
  state-pressed-dark: "rgba(255,255,255,.10)"
  state-focus-dark: "rgba(136,170,255,.40)"
  # jar material: theme-independent (same value in dark; the jar restyle simply does not run
  # in dark — see Shapes/Components, mismatch 12). Values duplicated so both themes are explicit.
  jar-glass-dark: "hsl(220 20% 97%)"
  jar-edge-dark: "hsl(220 18% 46%)"
  jar-ink-dark: "hsl(225 25% 6%)"
  jar-label-dark: "hsl(220 20% 20%)"
  jar-label-soft-dark: "hsl(220 12% 34%)"
  jar-lid-top-dark: "hsl(0 0% 100%)"
  jar-lid-bot-dark: "hsl(220 18% 90%)"
  jar-shadow-dark: "hsl(220 30% 20% / .34)"
  jar-glow-dark: "hsl(199 95% 38%)"
  jar-ring-dark: "hsl(28 95% 36%)"
  jar-hermes-dark: "hsl(199 90% 41%)"
  jar-pi-dark: "hsl(265 70% 65%)"
  jar-claude-dark: "hsl(18 88% 48%)"
  jar-codex-dark: "hsl(152 75% 33%)"
  jar-wait-dark: "hsl(215 30% 54%)"
  # fleet-bar surfaces resolve per theme through var(): dark resolves to the values below.
  fb-surface-dark: "#181a21"             # --fb-surface = color-mix(in srgb,var(--fg) 4%,var(--card)) at dark values
  fb-raise-dark: "#24262c"               # --fb-raise   = color-mix(in srgb,var(--fg) 9%,var(--card)) at dark values
  kind-hermes-dark: "hsl(199 60% 56%)"   # theme-independent
  kind-pi-dark: "hsl(265 55% 64%)"
  kind-claude-dark: "hsl(18 70% 60%)"
  kind-codex-dark: "hsl(152 50% 52%)"
  # Hive is theme-independent: identical in dark.
  hv-fill-dark: "#0a0a0a"
  hv-feat-dark: "#f4f1f2"
  hv-teeth-dark: "#ece2de"
  hv-halo-dark: "#5a0f1c"
  hv-rim-top-0-dark: "#ff70b0"
  hv-rim-top-1-dark: "#ff6a96"
  hv-rim-top-2-dark: "#ff6854"
  hv-rim-top-3-dark: "#ff6234"
  hv-rim-top-4-dark: "#ff6026"
  hv-rim-bot-0-dark: "#ff963c"
  hv-rim-bot-1-dark: "#ff8c34"
  hv-rim-bot-2-dark: "#ff7622"
  hv-rim-bot-3-dark: "#ff521c"
  hv-rim-bot-4-dark: "#ff2e1a"
  hv-mouth-0-dark: "#aa768c"
  hv-mouth-1-dark: "#a0647a"
  hv-mouth-2-dark: "#8c3742"
  hv-mouth-3-dark: "#70161e"
  hv-mouth-4-dark: "#5c0a10"
  hv-flame-0-dark: "#ff5614"
  hv-flame-1-dark: "#ff841e"
  hv-flame-2-dark: "#ffc43c"
  hv-flame-3-dark: "#ffe482"
  hv-flame-4-dark: "#fffaee"
  hv-fam-root-dark: "#5cd0ff"
  hv-fam-pixelvent-dark: "#ff5fc8"
  hv-fam-acasia-dark: "#5dff9a"
  hv-fam-somethingpressing-dark: "#ffc14d"
  hv-gauge-lo-dark: "{colors.z-ok-dark}"     # var(--z-ok) resolves per theme
  hv-gauge-mid-dark: "{colors.z-warn-dark}"
  hv-gauge-hi-dark: "{colors.z-bad-dark}"
typography:
  # Families: --font (tokens.css:141) and --num (tokens.css:142). Mono stacks are raw literals
  # today (4 spellings, and var(--mono,monospace) at dashboard.css:1058 where --mono is declared
  # nowhere) — see Typography prose and mismatch 19. Theme-independent.
  fs:                                  # --fs (dashboard.css:5) — body base; body{font:var(--fs)/1.55 var(--font)}
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 14px
    lineHeight: 1.55
  fs-xs:                                 # --fs-xs (dashboard.css:11) — table/label floor
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 13px
  fs-sm:                                 # --fs-sm (dashboard.css:12) — body text floor (LST-261)
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 14px
  fs-md:                                 # --fs-md (dashboard.css:13) — fluid
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: "clamp(14px,.75vw + 10.3px,15px)"
  fs-lg:                                 # --fs-lg (dashboard.css:14) — fluid
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: "clamp(15px,1.1vw + 11px,18px)"
  fs-xl:                                 # --fs-xl (dashboard.css:15) — fluid display
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: "clamp(17px,1.8vw + 11px,24px)"
  stat-label:                            # .stat-label (dashboard.css:253) — KPI caption
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
    letterSpacing: "0.04em"
  stat-value:                            # .stat-value (dashboard.css:255) — KPI number
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 28px
    fontWeight: 600
    lineHeight: 38px
  stat-sub:                              # .stat-sub (dashboard.css:258) — KPI sub-line
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  kpi:                                   # .kpi (dashboard.css:224) — big inline KPI
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: "clamp(18px,2vw,26px)"
    fontWeight: 600
    letterSpacing: "-0.02em"
  lbl:                                   # .lbl (dashboard.css:232) — caps micro-label
    fontFamily: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'
    fontSize: 13px
    fontWeight: 500
    letterSpacing: "0.04em"
spacing:
  # Canonical spacing scale = tokens.css:107 (--sp-*). NOTE the conflict: dashboard.css:16
  # re-declares --sp-1:4px; --sp-2:6px (and dashboard.css:17-20 fluid --sp-3..--sp-6), which
  # drifts from this scale — single source is tokens.css (mismatch 15). Theme-independent.
  sp-1: 4px                             # --sp-1
  sp-2: 8px                             # --sp-2  (dashboard.css:16 says 6px — WRONG, see mismatch 15)
  sp-3: 12px                            # --sp-3
  sp-4: 16px                            # --sp-4
  sp-5: 20px                            # --sp-5
  sp-6: 24px                            # --sp-6
  sp-7: 32px                            # --sp-7
  sp-8: 40px                            # --sp-8
  gap: 8px                              # --gap  page rhythm (dashboard.css:5)
  pad: 16px                             # --pad  page padding (dashboard.css:5)
rounded:
  # Radius scale = tokens.css:108 + --radius-ctl (tokens.css:140). Theme-independent.
  radius-sm: 4px                        # --radius-sm (0 uses today, mismatch 16)
  radius-md: 8px                        # --radius-md (0 uses today)
  radius-lg: 12px                       # --radius-lg (0 uses today)
  radius-ctl: 10px                      # --radius-ctl  THE control/card radius (74 uses)
components:
  # One canonical mapping per repeated component (full spec in the Components prose).
  # Variants are sibling keys. Values reference tokens only. States live in the prose.
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
  app-bar:                               # #appbar, 56px (dashboard.css:2166) — canonical top bar
    height: 56px
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
  nav-item:                              # .navitem (dashboard.css:647)
    height: 40px
    textColor: "{colors.muted}"
    rounded: "{rounded.radius-ctl}"
  nav-item-active:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent}"
    rounded: "{rounded.radius-ctl}"
  fleet-bar:                             # .fleetbar (dashboard.css:88), 42px row = --fb-h (dashboard.css:22)
    height: 42px                         # --fb-h:42px
    backgroundColor: "{colors.fb-surface}"
    rounded: 14px                        # calc(var(--fb-r) + 4px) resolved
  kind-filter:                           # .kseg (dashboard.css:94)
    height: 32px
    textColor: "{colors.muted}"
    rounded: "{rounded.radius-ctl}"
  kind-filter-on:
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
  profile-chip:                          # .pchip (dashboard.css:108)
    height: 32px
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
  kpi-card:                              # .stat (dashboard.css:251), 138px grid row
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    height: 138px
    typography: "{typography.stat-value}"
  kpi-label:
    textColor: "{colors.muted}"
    typography: "{typography.stat-label}"
  kpi-sub:
    textColor: "{colors.muted}"
    typography: "{typography.stat-sub}"
  button:                                # canonical quiet/outline button (32px = --ctl-md)
    height: 32px
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    padding: 12px
  button-primary:                        # .btn-apply (dashboard.css:2107)
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.radius-ctl}"
    height: 32px
  button-quiet:                          # .csvbtn (dashboard.css:47) — table-adjacent quiet action
    textColor: "{colors.accent}"
    rounded: "{rounded.radius-ctl}"
    height: 28px
  segmented-button:                      # .seg-btn (dashboard.css:74) inside .seg pill
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
    height: 32px
  segmented-button-on:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  chip:                                  # .chip (dashboard.css:192) — base chip
    textColor: "{colors.muted}"
    rounded: "{rounded.radius-ctl}"
    height: 32px
  chip-select:                           # select.chip (dashboard.css:203) — native select restyled
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    height: 32px
  filter-chip:                           # .fchip (dashboard.css:1076) / .lgchip pill family
    textColor: "{colors.muted}"
    rounded: 999px
  input:                                 # text/search/date inputs (dashboard.css:195, .pk-q:146)
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    height: 32px
  input-date:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    height: 32px
  combo-box:                             # .combo-btn (dashboard.css:2109) + .combo-pop
    backgroundColor: "{colors.bg}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    height: 32px
  toast:                                 # .toast (dashboard.css:2061), 380px stack
    backgroundColor: "{colors.card}"
    textColor: "{colors.muted}"
    rounded: "{rounded.radius-ctl}"
    width: 380px
  toast-info:
    textColor: "{colors.accent}"
  toast-ok:
    textColor: "{colors.z-ok}"
  toast-warn:
    textColor: "{colors.z-warn}"
  toast-error:
    textColor: "{colors.z-bad}"
  drawer:                                # #drawer (dashboard.css:1220), right side
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    width: 460px
  drawer-detail:                         # #pdrawer (dashboard.css:1338) — same shell, detail size
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    width: 420px
  modal:                                 # #tmodal (dashboard.css:1243) — canonical centred modal
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    width: 760px
  modal-wide:                            # #lnmodal (dashboard.css:1293) timeline
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    width: 920px
  modal-command:                         # #sfmodal (dashboard.css:1304) session finder
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    width: 680px
  tooltip:                               # .qtip (dashboard.css:977) — the ONE tooltip
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    width: 300px                         # max-width:300px
  popover:                               # .fb-pop/.combo-pop/#barmenu/.respop family
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    width: 360px
  table-header:                          # .dt th (dashboard.css:2005) / .lvh (dashboard.css:1906)
    textColor: "{colors.muted}"
    typography: "{typography.lbl}"
  table-row:                             # .dt rows (LST-223)
    height: 52px
  table-row-compact:                     # :root[data-density=compact] (dashboard.css:2003)
    height: 36px
  table-row-hover:
    backgroundColor: "{colors.accent-wash}"
  badge:                                 # .navbadge (dashboard.css:654)
    backgroundColor: "{colors.border}"
    textColor: "{colors.fg}"
    rounded: 999px
  badge-alert:                           # .navbadge.alert (dashboard.css:657) — text-on-fill pair
    backgroundColor: "{colors.z-bad}"
    textColor: "{colors.z-bad-fg}"
    rounded: 999px
  status-pill:                           # .lvst (dashboard.css:1960) running/waiting/idle
    textColor: "{colors.fg}"
    rounded: 99px
  jar:                                   # .qt-jar/.qt-body (dashboard.css:856/872) Life view
    rounded: 12px
  jar-ball:                              # .qt-ball (dashboard.css:906); QT_MAX=28 (flow.js:111)
    size: 28px
  jar-ball-min:                          # QT_MIN=18 (flow.js:112) — legibility floor
    size: 18px
  jar-legend-swatch:                     # .qt-sw (dashboard.css:957)
    size: 18px
  hive-stage:                            # .hv-stage (hive.css:11) — the Hive canvas box
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.radius-ctl}"
  hive-tooltip:                          # .hv-tip (hive.css:13) — to be merged into tooltip (mismatch 7)
    backgroundColor: "{colors.card}"
    textColor: "{colors.fg}"
    rounded: "{rounded.radius-ctl}"
    width: 330px                         # max-width:330px
---

# LLM-Telemetry (+ Hive) DESIGN.md

## Overview

LLM-Telemetry is Beinno's internal operations board for its LLM fleet: token usage,
cost, live agent sessions, Ollama host load, router/quota state, logs, and the two
signature set-pieces — the Life view's task-queue glass jars and the Hive tab. It is
built as **one self-contained HTML artifact** (ADR 0001) that must open from `file://`.

Who uses it: Hazem and the Beinno ops flow, often on an always-on screen across the
room — so numbers must read at a glance and colour is reserved for state, not
decoration. Tone: calm Grafana-ops density. A dense monitoring board, not a marketing
page (dashboard.css:33-38).

Stack: plain CSS + vanilla ES modules (no Tailwind/shadcn/MUI at runtime),
inlined into one classic script at build time by `src/llm_telemetry/webassets.py`.
Charts are Chart.js from a CDN with a stub fallback (`web/js/charts.js:12-25`).
Build entry: `.venv/bin/python -m llm_telemetry.build_dashboard OUT.html` (see HARD RULES).

Token sources (the only places values may be declared):

- `src/llm_telemetry/web/css/tokens.css` — the ONE shared palette (both themes + Hive + jars).
- `src/llm_telemetry/web/css/dashboard.css:4`-`25` — page metrics: type scale `--fs-*`,
  `--fs`/`--gap`/`--pad`, gauge/nav/rail/bar sizes, `--ctl-sm/md/lg`. This split is
  deliberate (tokens.css:30-32).
- `src/llm_telemetry/web/css/utilities.css` — vendored utility subset (no colours).
- `src/llm_telemetry/web/css/hive.css` — Hive component styling only, colours via `--hv-*`.
- Code audit with every measured value and file:line: `docs/design-audit.md`.

## Colors

Roles (every value below is the exact `tokens.css` value; dark values are the
`[data-theme="dark"]` siblings, named `*-dark` here per the Beinno convention):

| Token (code name) | Role | Light | Dark |
|---|---|---|---|
| `--bg` (`colors.bg`) | page surface | `#fbfbf9` | `#05060a` |
| `--card` (`colors.card`) | raised surface | `#ffffff` | `#0f1118` |
| `--fg` (`colors.fg`) | body text | `#1a201c` | `#f5f5f5` |
| `--muted` (`colors.muted`) | secondary text | `#6f746f` | `#8a8f9a` |
| `--border` (`colors.border`) | decorative hairline (non-essential, contrast-exempt) | `rgba(26,32,28,.12)` | `#1d2130` |
| `--border-input` (`colors.border-input`) | control boundaries, 3:1 (WCAG 1.4.11) | `#6b6e78` | `#6b6e78` |
| `--border-strong` (`colors.border-strong`) | emphasized hairline | `rgba(26,32,28,.22)` | `#262a36` |
| `--accent` (`colors.accent`) | the one accent | `#1f62c9` | `#88aaff` |
| `--accent-ink` (`colors.accent-ink`) | text/icon on accent fills | `#ffffff` | `#05060a` |
| `--accent-wash` (`colors.accent-wash`) | accent tint surface | `rgba(31,98,201,.10)` | `rgba(136,170,255,.14)` |
| `--accent2` (`colors.accent2`) | charts' secondary | `#7793a2` | `#b877d9` |
| `--active-a` / `--active-b` | active glow pair | `#1f62c9` / `#1a7f3c` | `#88aaff` / `#55ff88` |
| `--live-dot` (`colors.live-dot`) | fresh-feed dot | `#1a7f3c` | `#55ff88` |
| `--wash-indigo/-rose/-slate/-amber/-mint` | pastel family washes on cards | `rgba(99,110,164,.12)` etc. | `rgba(87,148,242,.14)` etc. |
| `--z-ok` (`colors.z-ok`) | status good (solid mark / text on surfaces) | `#39764f` | `#5f9e6e` |
| `--z-warn` (`colors.z-warn`) | status warning | `#7c6328` | `#c2a15c` |
| `--z-bad` (`colors.z-bad`) | status error | `#a14d47` | `#c66a6a` |
| `--z-ok-fg` (`colors.z-ok-fg`) | badge text ON solid `--z-ok` fill ONLY | `#e4f0e9` | `#dff0e4` |
| `--z-warn-fg` (`colors.z-warn-fg`) | badge text ON solid `--z-warn` fill ONLY | `#f4ecd7` | `#f4ecda` |
| `--z-bad-fg` (`colors.z-bad-fg`) | badge text ON solid `--z-bad` fill ONLY | `#f7e4e4` | `#f7e3e3` |
| `--pal-indigo/-rose/-slate/-amber/-mint` | solid chart fills (Chart.js) | `#7c86b0`, `#b87383`, `#71868f`, `#ac895a`, `#5f9e78` | `#5794f2`, `#f2495c`, `#8ab8ff`, `#ff9830`, `#6eaa8c` |
| `--state-hover/-pressed/-focus` | state layers | `rgba(0,0,0,.04)` / `rgba(0,0,0,.08)` / `rgba(31,98,201,.25)` | `rgba(255,255,255,.06)` / `rgba(255,255,255,.10)` / `rgba(136,170,255,.40)` |
| `--fb-surface` / `--fb-raise` | fleet-bar surfaces (resolve per theme) | `color-mix(in srgb,var(--fg) 4%,var(--card))` / `…9%…` | same expressions at dark values |
| `--kind-hermes/-pi/-claude/-codex` | agent-kind identity, ONE source | `hsl(199 60% 56%)`, `hsl(265 55% 64%)`, `hsl(18 70% 60%)`, `hsl(152 50% 52%)` | theme-independent (same) |
| `--jar-glass/-edge/-ink/-label/-label-soft/-lid-top/-lid-bot/-shadow/-glow/-ring` | light-theme jar material | `hsl(220 20% 97%)`, `hsl(220 18% 46%)`, `hsl(225 25% 6%)`, `hsl(220 20% 20%)`, `hsl(220 12% 34%)`, `hsl(0 0% 100%)`, `hsl(220 18% 90%)`, `hsl(220 30% 20% / .34)`, `hsl(199 95% 38%)`, `hsl(28 95% 36%)` | same values (restyle off in dark, mismatch 12) |
| `--jar-hermes/-pi/-claude/-codex/-wait` | light-theme ball identity | `hsl(199 90% 41%)`, `hsl(265 70% 65%)`, `hsl(18 88% 48%)`, `hsl(152 75% 33%)`, `hsl(215 30% 54%)` | same values |
| `--hv-fill/-feat/-teeth/-halo` | Hive head body/feature/teeth/halo | `#0a0a0a`, `#f4f1f2`, `#ece2de`, `#5a0f1c` | theme-independent (same) |
| `--hv-rim-top-0..4` / `--hv-rim-bot-0..4` | Hive rim gradient per anger level 0→1 | `#ff70b0`,`#ff6a96`,`#ff6854`,`#ff6234`,`#ff6026` / `#ff963c`,`#ff8c34`,`#ff7622`,`#ff521c`,`#ff2e1a` | theme-independent (same) |
| `--hv-mouth-0..4` | Hive mouth per anger level | `#aa768c`,`#a0647a`,`#8c3742`,`#70161e`,`#5c0a10` | theme-independent (same) |
| `--hv-flame-0..4` | Hive flame ramp | `#ff5614`,`#ff841e`,`#ffc43c`,`#ffe482`,`#fffaee` | theme-independent (same) |
| `--hv-fam-root/-pixelvent/-acasia/-somethingpressing` | Hive family colours (`--hv-fam-<id>`) | `#5cd0ff`, `#ff5fc8`, `#5dff9a`, `#ffc14d` | theme-independent (same) |
| `--hv-gauge-lo/-mid/-hi` | Hive pressure-gauge zones | `var(--z-ok)`, `var(--z-warn)`, `var(--z-bad)` (resolve per theme) | resolves to the dark `--z-*` |

Colour rules:

- Hex/rgb/hsl literals live **only** in `tokens.css` (HARD RULE 3). Everything else reads
  `var(--token)` / `color-mix()`. Known debt: 66 rgb/hsl declarations in `dashboard.css`
  and 65 hex + 40 rgb/hsl in `web/js` (mismatches 1, 2, 6).
- `--z-*-fg` is badge text **on its solid `--z-*` fill only**. Never on `--bg`/`--card`
  (it is ~1.2:1 there in light — see Accessibility and mismatch 4).
- Status colour is judgement, not decoration: green/amber/red only for good/warn/bad
  readings (dashboard.css:1025-1026), and "no reading" is `--muted`, never green
  (dashboard.css:1641-1646).

### Dark theme (data-theme mechanism)

- Mechanism: `data-theme` attribute on `<html>`, **dark by default**. A pre-paint script in
  `<head>` sets `data-theme="dark"` before first paint unless
  `localStorage['hermes-dash-theme'] === 'light'`. Runtime toggle + persistence:
  `web/js/main.js:149-160`, then `readTheme()` re-tints Chart.js.
- Blocks: `:root, [data-theme="light"]` (tokens.css:58) and `[data-theme="dark"]`
  (tokens.css:160). Light naming is explicit so it resolves to the default values.
- Dark-only widget fixes exist and stay minimal (e.g. `input[type=date]{color-scheme:dark}`,
  dashboard.css:197).
- Known theme gaps: the jar material restyle is light-only (`:root:not([data-theme="dark"])`,
  dashboard.css:2251-2292 — mismatch 12), `--elev-0` has no dark sibling (mismatch 17 note),
  and the light-only `filter:brightness(.5)` shim on `.lvmodel` (dashboard.css:1936).
- Any new component must render in BOTH themes through semantic tokens. Never bake a
  colour that only reads on one surface.

## Typography

| Family | Value | Where |
|---|---|---|
| `--font` (body/UI) | `Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif` | tokens.css:141, `body{font:var(--fs)/1.55 var(--font)}` dashboard.css:29 |
| mono (4 raw spellings today) | `ui-monospace,SFMono-Regular,Menlo,monospace` (canonical full stack; short form `ui-monospace,monospace` ×7 and `var(--mono,monospace)` ×1 where `--mono` is **declared nowhere**) | dashboard.css:438, 1268, 1273, 1390, 1630, 1668, 1694-1695, 1742, 1778, 1797, 1058 |
| `--num` | `tabular-nums` — all numbers, always | tokens.css:142 |
| Arabic font | **none** — the product ships no Arabic (see Layout → RTL) | — |

Type scale (page-level tokens, dashboard.css:5-15; theme-independent):

| Token | Value | Use |
|---|---|---|
| `--fs` | `14px` | body base |
| `--fs-xs` | `13px` | labels, tables, meta (143 uses) |
| `--fs-sm` | `14px` | body text floor, LST-261 (56 uses) |
| `--fs-md` | `clamp(14px,.75vw + 10.3px,15px)` | section titles (20 uses) |
| `--fs-lg` | `clamp(15px,1.1vw + 11px,18px)` | sub-heads (13 uses) |
| `--fs-xl` | `clamp(17px,1.8vw + 11px,24px)` | display |
| `.stat-label` / `.stat-value` / `.stat-sub` | `500 13px/18px` / `600 28px/38px` / `400 13px/18px` | KPI anatomy (dashboard.css:253-259) |
| `.kpi` | `600 clamp(18px,2vw,26px)`, `-0.02em` | big inline KPI (dashboard.css:224) |

Rules:

- Body text never drops below `--fs-sm` (14px); meta text never below `--fs-xs` (13px).
- Numbers use `font-variant-numeric: var(--num)` (tabular). No exceptions for tables/KPIs.
- Weights in real use: 400 / 500 / 600 / 650 / 700. Do not introduce new weights or fonts.
- Mono is for timestamps, ids, install snippets and code only.
- `--fs-2xs` is referenced 6 times (utilities.css:113, dashboard.css:1825, 1843, 1848, 1857)
  but **declared nowhere** — same undeclared-token problem as `--mono` (mismatches 18/19).
- 57 raw `font-size:13px|14px` declarations bypass the scale (mismatch 18). New code uses
  `--fs-*` only.

## Layout

Spacing (canonical scale = tokens.css:107, theme-independent):

`--sp-1:4px` `--sp-2:8px` `--sp-3:12px` `--sp-4:16px` `--sp-5:20px` `--sp-6:24px`
`--sp-7:32px` `--sp-8:40px`, plus page rhythm `--gap:8px`, `--pad:16px` (dashboard.css:5).

- **Known conflict (mismatch 15):** `dashboard.css:16` re-declares `--sp-1:4px; --sp-2:6px`
  (and `dashboard.css:17-20` fluid `--sp-3..--sp-6` clamps). The `--sp-2` **6px vs 8px**
  drift means one name carries two values depending on stylesheet order. The single source
  is `tokens.css`; the `dashboard.css` copies are to be deleted (ticket below).
- 299 raw px spacing declarations and 20+ distinct `gap` values bypass the scale
  (mismatch 15). New work uses `--sp-*`/`--gap`/`--pad`.

Shell and containers:

- Full viewport width, no max-width cap (`.page`, dashboard.css:31-32); page padding `--pad`.
- Nav rail reserves space via `--rail-now` and `.page`'s padding reads the SAME variable
  (dashboard.css:454-489): expanded `--nav-w:240px`, collapsed `--rail-w:60px` (default),
  forced icon rail `48px` at `<=1023px`, bottom tab bar `--tabbar-h:52px` at `<=639px`.
  Related shell tokens: `--shell-pad:var(--nav-w)` (dashboard.css:30) pushes `.shell`
  content (`.shell{padding-left:var(--shell-pad)}`, dashboard.css:667) when the drawer is
  pinned open. App bar `--bar-h:52px` page-level; the shipped `#appbar` is 56px
  (dashboard.css:2166).
- Grid helpers: `.statgrid` 12 columns, `grid-auto-rows:138px`, 8px gap (KPI cards);
  `.grid-auto` `minmax(min(300px,100%),1fr)`; `.grid-2` `minmax(min(340px,100%),1fr)`;
  `.grid-home` 4 columns at desktop, 3 at `<=1100px`, 2 at `<=700px`/`<=480px`.
- Control size scale (dashboard.css:24-25, 2037-2042): `--ctl-sm:28px`, `--ctl-md:32px`,
  `--ctl-lg:44px` (touch floors at `<=600px` / coarse pointers).

Breakpoints — the named scale to use from now on (mismatch 20 tracks the snap):

| Name | Width | Anchored behaviour |
|---|---|---|
| `xs` | `<=480px` | phones: KPI rows wrap, 2-col Explore, `.stat` two-line labels |
| `sm` | `<=640px` | drawers become bottom sheets, toasts drop to bottom, `#tmodal` full-screen |
| `md` | `<=900px` | jars stack to one column (`.qtrain`), Hive panels single column |
| `lg` | `<=1280px` | live table scrolls inside its panel; `>=1280px` header sticks to page scroll |

Today the code carries **27 distinct media expressions** with adjacent stragglers
(`479/480`, `599/600`, `639/640/641`, `899/900`, `1023/1100/1279`…) — snap new work to the
four names above; the stragglers are mismatch 20.

RTL stance (mismatch 21):

- **LTR-only product.** The app ships no Arabic and has zero RTL scaffolding: 0 `dir`
  attributes, 0 logical properties, 51 `left|right:` declarations, `margin-left` ×35 vs
  `margin-right` ×6.
- The family rule "support Arabic RTL wherever the app ships Arabic" therefore does not
  bite yet. If Arabic ever ships, convert the drawer/toast/nav edges to `inset-inline-*`
  first (drawer `translateX(100%)` family, dashboard.css:1220-1225; chevrons `drawer.js:497`;
  `.qt-ghost` flight paths, flow.js:327). Logos and numbers never mirror.

## Elevation & Depth

Shadows (tokens.css:104-106 / 204-206; theme values below):

| Token | Light | Dark | Use |
|---|---|---|---|
| `--elev-0` | `none` | *(not re-declared; mismatch 17 note)* | flat |
| `--elev-1` | `0 1px 2px rgba(0,0,0,.06),0 1px 1px rgba(0,0,0,.04)` | `0 1px 2px rgba(0,0,0,.30),0 1px 1px rgba(0,0,0,.20)` | card at rest |
| `--elev-2` | `0 2px 6px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.05)` | `0 2px 6px rgba(0,0,0,.35),0 1px 2px rgba(0,0,0,.25)` | card hover, popovers |
| `--elev-3` | `0 6px 16px rgba(0,0,0,.10),0 2px 4px rgba(0,0,0,.06)` | `0 6px 16px rgba(0,0,0,.40),0 2px 4px rgba(0,0,0,.30)` | modals, tooltips, drawers |

Glow tokens (box-shadow strings, theme-varying — both values listed):

| Token | Light | Dark |
|---|---|---|
| `--glow-live` | `0 0 0 2px rgba(26,127,60,.18)` | `0 0 8px 2px rgba(85,255,136,.55)` |
| `--glow-active` | `0 0 0 1px var(--active-a),0 0 10px rgba(31,98,201,.28)` | `0 0 0 1px var(--active-a),0 0 12px rgba(85,255,136,.35)` |

Title gradient `--grad-title` (background-clip text, dashboard.css:2237-2247):
light `linear-gradient(90deg,#0b6fb3,#b0287a,#1a7f3c,#8a5a00,#0b6fb3)`;
dark `linear-gradient(90deg,#66ccff,#ff66cc,#77ff99,#ffcc66,#66ccff)`. Text stays real
text (labels preserved); under reduced motion it freezes at `background-size:100%`;
under `forced-colors` it falls back to `currentColor` (dashboard.css:2248-2249).

Depth rules:

- Cards rest at `--elev-1`, lift to `--elev-2` on hover only if interactive (`.card-hover`/
  `.xcard`); static text cards never lift (dashboard.css:33-38).
- Popovers/menus → `--elev-2` class. Modals/drawers/tooltips → `--elev-3` class.
  The 21 raw `box-shadow` values are mismatch 17; do not add a 22nd.

Z-index: today 27 raw values (skip link 200, toasts 60, nav 63/64, drawer 70, modals 75-90,
`.qt-ball` hover 900, `.qt-ghost` 950, `.qt-overflow` 1000, JS inline 80/100). **Proposed**
layer scale (mismatch 14 — not in code yet):

`--z-base:0` / `--z-sticky:10` / `--z-nav:60` / `--z-scrim:65` / `--z-drawer:70` /
`--z-modal:80` / `--z-tip:90` / `--z-toast:100` / `--z-drag:900`

## Shapes

| Token | Value | Use |
|---|---|---|
| `--radius-ctl` | `10px` | THE radius: cards, buttons, chips, inputs, popovers (74 uses) |
| `--radius-sm` | `4px` | fine elements (declared, 0 uses today) |
| `--radius-md` | `8px` | medium (declared, 0 uses) |
| `--radius-lg` | `12px` | modal panels, bottom-sheet corners (declared, 0 uses) |

- Raw radii in code: `999px` ×24, `4px` ×18, `2px` ×17, `3px` ×16, `50%` ×14, `99px` ×4,
  `6px` ×4, plus one-offs (`13px`, `7px`, jar silhouette compounds like `0 0 30px 30px`).
  This sprawl is mismatch 16.
- **Proposed** (mismatch 16, not in code): name `--radius-pill:999px` and
  `--radius-full:50%` in `tokens.css` and migrate the pills/circles to them.
- The jar silhouette (`clip-path` quarter-ellipse shoulders + `0 0 30px 30px` bottom,
  dashboard.css:870-874) is artwork, not the radius scale — keep it.

## Components

### App bar

Canonical: `#appbar` (dashboard.css:2164-2177), 56px sticky, `--card` background,
`.ab-title` (650 weight, `--grad-title` painted text) + tab name + freshness pill
(`.ab-fresh`, `data-fresh-state=fresh|old|stale`) + spacer + 36px icon buttons
(`#refresh`, `#theme`, `#soundtoggle`, `#helpbtn`, 44px at `<=640px`).
States: `.scrolled` gains `border-bottom-color:var(--border)`; freshness pill colours
from `--z-warn`/`--z-bad` on old/stale.
Do: one bar owns global actions; clear the nav rail with
`padding-left:calc(var(--rail-now) + var(--pad))` (dashboard.css:2168).
Don't: resurrect the retired `.appbar` shell (dashboard.css:670) — two app bars is
mismatch 10; delete the one nothing mounts before adding a second spec.

### Nav

Canonical: `#navdrawer` rail (dashboard.css:454-558) + `#nav` overlay family
(dashboard.css:627-667). Modes: expanded 240px / collapsed 60px icon-only (default,
`body.navcollapsed`, tooltips via `data-tip`) / forced 48px at `<=1023px` /
bottom tab bar at `<=639px`.
Items: `.navitem` (min-height 40px, `--fs-sm`, 16px icon slot `.nvico`, `.nvlabel`,
optional `.nvbadge` count hidden at 0), `.navgroup-h` uppercase cluster labels,
`.navsep` hairlines. Active: `.navitem.on` / `[aria-current="page"]` — accent text +
accent left bar + 13% accent wash (never colour alone: the bar carries it).
States: hover 9% accent wash; `:focus-visible` 2px `--accent`; badge `.navbadge.alert`
is the one solid `--z-bad`/`--z-bad-fg` pair.
Do: real anchors (middle-click opens a tab). Don't: a third nav implementation
(mismatch 10 covers the `#nav` vs `#navdrawer` pair — pick `#navdrawer` for new work;
`#nav`'s z/height variants are the mismatch).

### Fleet bar (and filter bar)

Canonical: `.fleetbar` (dashboard.css:84-137) — ONE 42px row: label | `#nav`-style
`.kseg` kind filters | scrolling `.pchip` profile chips | `.fb-count` `N/M on` |
`.fb-more`/`.fb-pbtn` + `.fb-pop`. Surfaces `--fb-surface`/`--fb-raise`; radius
`calc(var(--fb-r) + 4px)` = 14px.
The U-2 filter bar (`.filterbar`, dashboard.css:2094-2149) is the same grammar for data
pages: `.kseg`-style segmented range (`#presets`) + `.combo-btn`/`.combo-pop` searchable
comboboxes + removable `.fchip-on` chips + `N filters active` badge (`#lgcountbadge`);
at `<=600px` it collapses into the `.fb-sheet` bottom sheet with `.fb-done`.
Identity colour lives only on the chip avatar and the kind glyph — always paired with a
glyph + label. `data-off="1"` chips: muted, greyscale avatar, struck-through name.
Do: one row, horizontal scroll with edge fade (`.fb-strip` mask). Don't: build a second
filter strip (the Logs facets `.lgrow`/`.lgchip` are the same component in list form;
consolidation rides mismatch 11).

### KPI cards

Canonical: `.stat` inside `.statgrid` (dashboard.css:241-289) — fixed `grid-template-rows:
18px 38px 18px 28px`, `padding:12px 16px`, 138px cards: `.stat-label` (caps, muted) /
`.stat-value` (28px tabular, optional `.stat-unit`) / `.stat-sub` / `.stat-viz` (28px
sparkline or meter, slot always reserved).
States: `data-state=ok|warn|bad` on the card colours the value (`--z-*`); `a.stat`
interactive cards add `--state-hover` and a focus ring. Per-tab tiles (`.dkpi`, `.qv-kpi`)
wear the same recipe (dashboard.css:2086-2093).
Do: colour is state only — the number carries the weight. Don't: free-height KPI cards;
a missing viz keeps its empty slot.

### Cards

Canonical: `.card` (dashboard.css:39) — `--card` bg, `1px solid --border`,
`--radius-ctl`, `--elev-1`. `a.card` is a block link; `.card-hover`/`.xcard` may lift
(`--elev-2`, `translateY(-1px)`), press `--state-pressed`. Empty cards collapse to one
line (dashboard.css:2043-2046).

### Tables

Canonical: `.dt` data table (LST-223, dashboard.css:2000-2029): `--dt-row:52px`,
`--dt-fs:14px`; compact density `:root[data-density=compact]` → 36px/13px. Sticky
`.dt th` (`--card`, muted caps), zebra `color-mix(var(--fg) 3.5%)`, hover `--accent-wash`,
numeric columns right-aligned tabular (`.num`), sortable `.dt-sort` with `aria-sort` +
`.dt-ar` arrow. Wrap in `.dt-wrap` (max-height 70vh) inside a `.card`.
The live board `.lvrow` grid (dashboard.css:1884-1998) is the same table specialised:
52-64px two-line rows, `--lvcols` tracks, wrap-with-line-clamp instead of widening,
whole row is the tap target (44px floor lifted inside tables).
Also in family: `.lmpanel table`, `.pv-tbl`, `.rt-matrix/.rt-authtbl/.rt-recent`.
Do: `font-variant-numeric` everywhere; two-line cells clamp, full text in `title=`.
Don't: a second row height; wide tables scroll inside their own panel (never widen the page).

### Buttons

Canonical: `.btn` — 32px (`--ctl-md`), `--radius-ctl`, `1px solid --border`, `--fg` text;
hover `--state-hover`; `:focus-visible` 2px `--accent`.
Variants (one family — mismatch 11 tracks the ten bespoke classes):
`button-primary` (`.btn-apply`, dashboard.css:2107 — `--accent` fill, `--accent-ink`),
`button-quiet` (`.csvbtn`, dashboard.css:47 — accent text, transparent, table-adjacent),
segmented `.seg`/`.seg-btn` (32px joined pill, `.on` = accent fill + `--glow-active`),
`.pk-btn` (dialog rows), `.combo-btn` (see Inputs), `.fb-more`/`.fb-pbtn` (fleet bar),
`.toast-actions .btn` (accent text), `.ttitlebtn` (inline title link-button),
`.pp-open` (ball popover action), `.lmbtn` (dotted-underline inline button).
Touch: `min-height:44px` at `<=600px` (and `<=480px` min-width 44px for `button,a`).
Do: one height per tier (28/32/44); icon-only buttons carry `aria-label` (mismatch 22).
Don't: invent an 11th button class — extend `.btn` with a variant.

### Chips & badges

Canonical: `.chip` (dashboard.css:192) — `--radius-ctl`, 6px 12px, `--fs-md`, muted text,
hover accent border; `select.chip` strips native chrome and adds the masked chevron
(`.selwrap`, theme-tracking `--muted`). Variants: `.fchip` (compact filter chip,
`--fs-xs`, line-height 1.7), `.lgchip`/`.lgactivechip` (Logs pill family, `999px`),
`.pchip` (profile chip, fleet bar), `.navbadge` (count pill) and `.navbadge.alert`
(`--z-bad` fill + `--z-bad-fg` text — text-on-fill only), provider badge `provBadge`
(views.js:1166), `.lvst` status pill (99px, `--sc` dot per state), `.pv-badge`, `.lvtag`,
`.olcap` capability pills. This chip sprawl is mismatch 11.
Do: one chip spec (height floor `--ctl-md`, radius `--radius-ctl` or pill) with variants.
Don't: use `--z-*-fg` as chip text on `--card` (fails contrast — mismatch 4).

### Inputs & filter controls

Canonical: text/search/date inputs — `--bg` fill, `1px solid --border`, `--radius-ctl`,
32px, `--fg` text (`input[type=date]`, dashboard.css:195-197; `.pk-q` dashboard.css:146;
`.combo-q` dashboard.css:2117; `.setin input` dashboard.css:1203). Invalid:
`border-color:var(--z-bad)`. Focus: 2px `--accent` outline. `color-scheme` flips with theme.
Combobox: `.combo` → `.combo-btn` (label `.combo-l`, value `.combo-v` ellipsized, chevron
`.combo-chev`) + `.combo-pop` (search `.combo-q`, `.combo-list`, `.combo-opt` rows with
`.combo-tick`, `.combo-foot` clear). Checkboxes: `.pk-on` (16px, checked = accent fill +
`--accent-ink` tick, indeterminate = accent wash + bar, dashboard.css:165-171).
Do: every input has a label (`.lbl`/`.setl` or `aria-label`); 32px desktop / 44px touch.
Don't: leave OS-native select chrome (use `select.chip` + `.selwrap`).

### Toasts

Canonical: `.notices` + `.toast` (dashboard.css:2056-2084) — fixed top-right stack under
the app bar (`min(380px, 100vw - 32px)`), never takes layout space. Anatomy: 20px icon
(`.toast-ico`, coloured `--sev`), `.toast-title` (600 14px/20px), `.toast-text` (muted),
optional `.toast-actions`, 32px `.toast-x` close. Severity via `data-sev`:
`info→--accent`, `ok→--z-ok`, `warn→--z-warn`, `error→--z-bad` (the `--sev` custom
property drives border/icon). Enter: `toast-in .18s ease-out` (off under reduced motion).
At `<=599px` the stack moves to the bottom, full width.
Do: severity colour + icon + text (never colour alone). Don't: stack more than one
dismissible action; don't animate layout shifts.

### Drawers

Canonical: `#drawer` (dashboard.css:1217-1236) — fixed right, `min(460px,92vw)`, `--card`,
`border-left`, slide `translateX(100%)` ↔ `.open`, `--elev-3`-class shadow, `#scrim`
(`z-index:65`, 45% black). Header `.dhead` + filter tabs `.dtabs`/`.dtab` (`.on` =
accent fill). Responsive: 641-1024px → `60vw`; `<=640px` → bottom sheet (92dvh, top
corners `14px`, drag handle).
`#pdrawer` (dashboard.css:1329-1366) is the same shell as `.drawer-detail` (420px;
`<=640px` bottom sheet, `12px` top corners) — mismatch 9 wants it named as a variant of
`#drawer` rather than a parallel implementation.
Do: one drawer component with size variants; scrim + focus trap + Esc. Don't: add a third
drawer shell.

### Modals & scrims

Canonical: one centered modal + one scrim pattern. Shipped shells: `#tmodal` (760px,
transcript), `#lnmodal` (920px, timeline), `#sfmodal` (680px, session finder, top-anchored
12vh) with scrims `#tscrim`/`#lnscrim`/`#sfscrim`/`#pdscrim` — 7 near-identical fixed
shells = mismatch 8; migrate one modal per PR to `.modal` + `.scrim` with size modifiers
(`modal` 760 / `modal-wide` 920 / `modal-command` 680). Shared behaviour: `--radius-ctl`,
`.thead`/`.pdhead` headers, body scroll region, `transform:translate(-50%,-50%) scale(.96)`
→ open, 160ms, `<=640px` full-screen for `#tmodal`. `#helpwrap`/`#helppanel` is the large
overlay (900px, 88vh) variant of the same grammar.
Do: native `<dialog>` where possible (`.fbdlg` gets focus trap + Esc free,
dashboard.css:138-143). Don't: a modal without a scrim or without Esc.

### Menus & popovers

Canonical: `.popover` shell — `--card`, `1px --border`, `--radius-ctl`, `--elev-2`-class
shadow. Instances: `#barmenu` (app-bar overflow, min-width 172px, dashboard.css:682),
`.fb-pop` (fleet "more", `min(640px,86vw)`), `.combo-pop` (360px), `.respop` (profile
resolution, 300-440px), `.rangepop` (custom date range). All: `top:calc(100% + 6px)`,
`[hidden]` when closed, `aria-expanded` on the trigger (`.fb-more[aria-expanded=true]`
gains accent border + wash ring).
Do: one placement grammar (below-start, flip inside viewport). Don't: raw shadows.

### Tooltips

Canonical: `.qtip` (dashboard.css:977-984) — `position:fixed`, max-width 300px, 14px text,
`--card` with accent-tinted border, 10px rotated-square arrow keyed by `data-side`
(top/bottom/left/right) and `--ax/--ay` anchor vars, `--elev-3`-class shadow.
Content grammar: `.ft-h` title + `.ft-r` key/value rows (`carTip`, flow.js:275-295).
Placement: `qtPlace` (flow.js:453-471) — below the jar, else above, else beside; first
fit that avoids the lid and the viewport edge.
`#lntip` (dashboard.css:1325) and `.hv-tip` (hive.css:13) are themeable instances of this
one component — the three-shell drift is mismatch 7; new tooltips are `.qtip`.
Do: hover AND focus both open it (keyboard parity). Don't: a fourth tooltip shell.

### Charts

Stack: Chart.js (CDN) with a stub fallback when offline (`charts.js:12-25`); canvas reuse
guard (`charts.js:46-53`). Colours come from `PAL` (`web/js/palette.js:17`) and the
`--pal-*`/`--wash-*` tokens; axes/ticks tint per theme on `readTheme()`.
Grammar: bar (`views.js:296`), doughnut with `cutout:'55%'` (`views.js:752`), stacked
(`views.js:760`), sparkline `sparkSvg` (`live.js:426`, 28px in KPI slots), gauge `.loe`
(single SVG component, `--gauge-size` presets 56/84/132px, `arc-sweep .6s
cubic-bezier(.22,1,.36,1)` on refresh, `cost-pulse` on danger), activity heatmap
(`.hm-*`, accent intensity ramp l0-l5), force graph `#flow` (SVG, no d3).
Every data view carries loading / empty / error states (see below); empty charts hide
their box and keep a one-line message (dashboard.css:2043-2046).
Do: `--pal-*` for series colour, `--z-*` for state, `--muted` for axes. Don't: new hex
series colours (read tokens through `css('--pal-indigo')`, `main.js:30` — mismatches 1-3).

### Life view — task-queue jars (`web/js/flow.js`)

Anatomy (`dashboard.html:185-190`, dashboard.css:849-993): `.qtrain` = three glass jars
in a 3-column grid (1 column at `<=900px`), each `.qt-sec` = `.qt-lid` + `.qt-name` +
`.qt-n` count + `.qt-body` (glass silhouette, liquid `--fill` with wave) + `.qt-cars`
(ball pit) + legend.

- The three jars are **Depot** (requests queued at an Ollama host), **On the line**
  (running sessions) and **Yard** (finished sessions). There is **no "oven" element** in
  the code — Depot / On the line / Yard are the canonical names (`flow.js:14-17`,
  `aria-label="Depot: waiting"` etc. `dashboard.html:186-188`).
- Per-jar accent `--jc` (dashboard.css:853-855) drives the lid border, name tint and
  liquid: Depot `var(--muted)` (light: `color-mix(in srgb,var(--jar-edge) 70%,var(--muted))`,
  dashboard.css:2255), On the line `var(--z-ok)`, Yard `var(--accent)`. It is the ONLY
  per-jar colour knob — the liquid is tinted from it via `color-mix()`.
- One task = one ball (`.qt-ball`, keyed DOM reused across 5s polls). Ball size steps
  `QT_MAX:28px` → `QT_MIN:18px` (`flow.js:111-112`) until the pile fits `QT_FILL:0.5`;
  overflow goes to a `.qt-overflow` `+N` chip (opens the session finder). Jars never scroll.
- **HARD RULE (see below): every ball and the jar legend show the PROVIDER BRAND SVG** via
  `qtBallIcon` → `provLogoSvg(model,14,…)` / `provOf` (`flow.js:117-126`, `views.js:173/236`).
  A depot ball with no model shows the Ollama logo (`'local'`); an unknown provider gets a
  neutral hexagon — **never a letter**. The white contrast disc `.qt-gl::before`
  (dashboard.css:922-928) keeps the mark legible at `QT_MIN 18px`; if legibility bites,
  raise `QT_MIN` or thicken the disc — never letters. Legend `#qt-leg-ico` uses the same
  icon path (`flow.js:129-133`).
- Ball states: `.qt-q` waiting (`--qk-wait` / `--jar-wait`), `.qt-run` capsule with pulse
  ring + glow, `.qt-warn` ring (`--z-warn`/`--jar-ring`) for waiting-on-approval, `.qt-ghost`
  flight copy, `.qt-arrive`/`.qt-land`/`.qt-leaving` transitions. Ball hue: profile hue for
  Hermes (`profileHue`), `--kind-*` for fleet agents, kind remaps `--jar-hermes/pi/claude/codex`
  in light (`dashboard.css:2254`).
- Motion: ghost flights Depot→Line (paired by count) and Line→Yard (exact session id),
  600-900ms arcs, 70ms stagger, max 4 concurrent (`qtFly`, flow.js:319-354); splash on
  landing (`qtSplash`, flow.js:308-313); slosh on count change; whole-train sway while
  running. All of it dies under `prefers-reduced-motion` (dashboard.css:987-993) and
  `qtFly` no-ops.
- A11y: balls are `<button>`s with `aria-label` (`waiting|running|finished: … · model · meta`,
  `paintBalls` flow.js:235), focus ring 2px `--accent`, legend decorative (`aria-hidden`),
  jar sections `role="group"` with labels.
- `?demoQueue=1` cycles one synthetic task Depot→Line→Yard every 3s for motion preview
  ONLY (`flow.js:66-89`) — it must never run against real traffic displays.
- Light/dark: dark jars use the base glass treatment; light jars restyle from `--jar-*`
  (`:root:not([data-theme="dark"])`, dashboard.css:2251-2292). Each marble keeps
  ≥3:1 vs `--jar-glass` and its icon ink ≥4.5:1 (`tests/check_jars_light.js`).

Do: provider SVGs only; keyed DOM; splash on landing (not on poll). Don't: letters on
balls (b62a823 regression), scrolling jars, half-hidden balls.

### Hive tab (`web/js/hive.js` + `web/css/hive.css`)

The Hive is the fleet's living map: hex nodes per worker/agent, animated edges for real
comms, Hazem's neon head as the emotional centrepiece, and a pressure gauge.

- Data: real activity only, from the collector (`/api/hive`, `/api/hive/stream`). **No
  invented events, ever.** No scream audio (banned: `v/a_aah.mp3`); the high-pressure
  sound is `pressure_kettle.mp3` (HARD RULE 2).
- Colours: ONLY `--hv-*` semantic tokens and family colours `--hv-fam-<id>`
  (`colors.hv-fam-*`). Node stroke = family colour `--c`; fills `--card`; states
  `.hot` (glow + `2.4` stroke), `.idle`, `.blocked` (`--z-bad` dashed), `.nodata` (dotted).
  No hex literals in `hive.js`/`hive.css` (mismatch 24: `hive.js:32` still synthesises
  `hsl(<hash>,70%,62%)` and `hive.js:194` `hvRgb` builds `rgb()` strings — map the four
  families to `--hv-fam-*`; hash colour only as a documented fallback for unknown families).
- Hazem's head (`.hv-hz-*`, LST-272): `--hv-fill` egg, `--hv-feat` eyes/brows, `--hv-teeth`,
  rim gradient `--hv-rim-top-0..4` / `--hv-rim-bot-0..4` and mouth `--hv-mouth-0..4`
  selected per anger level 0→1 by `hive.js`; flame ramp `--hv-flame-0..4`; halo `--hv-halo`.
  Theme-independent: a lit head on its own dark fill in both themes.
- Pressure gauge (`.hv-gauge`, hive.css:52-57): 200px card, `.hv-g-bar` fill coloured
  `--hv-gauge-lo/mid/hi` (= `--z-ok/warn/bad`) by `data-level=lo|mid|hi`.
- Comms (LLMTELEMET-274): speech bubbles (`.hv-bubble`), packets (`.hv-pk`, `.hv-p`),
  waves (`.hv-wave.ok/.bad`), flash/shake FX — all semantic tokens only. Panels
  `.hv-panels` (3fr/2fr, single column at `<=900px`): comms list `#hive-clist`
  (`.hv-cm.good/.bad`) and feed `#hive-feed` (`.hv-st-done`/`.hv-st-blocked`).
- Motion: `hv-flow` edge dashes, `hv-bob`, `hv-blink`, `hv-look`, `hv-talk` — all off
  under `prefers-reduced-motion` (hive.css:46, 74).
- Tooltip `.hv-tip` (fixed, 330px, `--border-strong`) merges into the canonical `.qtip`
  (mismatch 7).

Do: real events, `--hv-*` colours, per-family `--hv-fam-<id>`. Don't: fabricated activity,
scream audio, raw colours, letters as provider marks.

### Standalone Hive page (read-only reference)

`/home/hazemhagrass/workspace/beinno/hive/index.html` (2,455 lines, one inline `<style>`,
not in git) is the standalone `beinno-hive` page. **READ ONLY — never edit it and never
restart the `beinno-hive` service.** It is reference material for the in-app Hive tab only.

- Its `:root` (`--bg:#05060a; --fg:#f5f5f5; --mute:#8a8f9a; --card:#0f1118`, note the
  `--mute` spelling vs `--muted`) matches the dark tokens exactly; borders `#1d2130` /
  `#262a36` match `--border`/`--border-strong` dark.
- Drift to be reconciled during the Hive move (LLMTELEMET-267/H-9, mismatch 25): raw
  one-off colours (`#fff`, `#ffd23f` shout, `#2a2f40` gauge border, `#9aa4b8` gauge label,
  …), `Impact,"Arial Black"` shout face, 9 radius one-offs, font stack missing `Roboto`,
  only 4 CSS variables vs 60+ tokens, permanently dark (no `data-theme`).
- A light theme for the standalone page is **out of scope unless Hazem asks**.

### Loading, empty & error states

Every data view designs all four states (family rule):

- Loading: `.state-skeleton` shimmer lines (`.skel-line`, `skel-shimmer 1.4s`, frozen under
  reduced motion; state.js renderers, dashboard.css:2210-2214).
- Empty: `.empty` (icon `.e-ico`, `.e-msg`, `.e-hint`) or the `state-empty` renderer; cards
  collapse to one line; jars show `data-empty` text at the pit floor.
- Error: `.state-error` with `.state-lasterr` + `.state-action` retry; failing feeds show
  the real error text — never a fake healthy state.
- Success/freshness: `.stamp` with `data-stamp-state=fresh|old|stale` — green pulse only
  while the feed is actually live, amber `--z-warn` old, `--z-bad` stale with a real link
  to Health (dashboard.css:43-68). "No reading" is `--muted`, never green.

## Do's and Don'ts

Do:

- Read DESIGN.md before any visible change; reuse the components above (search first —
  a second Button, Modal, Toast or Tooltip is a bug).
- Use named tokens exactly as named here (`var(--bg)`, `colors.bg` maps to `--bg`).
- Check contrast in BOTH themes: text 4.5:1, large text/UI 3:1.
- Give every icon-only control an `aria-label`; keep hit targets 28/32px desktop and 44px
  touch.
- Respect `prefers-reduced-motion` for every new animation.
- Design loading / empty / error / success for every data view.

Don't:

- Add raw colours, font families, or one-off spacing/radius/shadow/z-index values outside
  `tokens.css` (HARD RULE 3). The scale lacks a step? Add a token to `tokens.css` and to
  this file in the same PR.
- Use `--z-*-fg` as text on `--bg`/`--card`; use the `--z-*` value itself (or the
  **proposed** `--z-*-text`, below) for text on surfaces.
- Bake theme-specific colours (`bg-white`/`text-black` behaviour); semantic tokens only.
- Rename tokens to look nicer — agents grep these names.
- Fix unrelated code-vs-spec drift in a feature PR: report it (Known mismatches → Plane).

## Motion

Tokens (tokens.css:109, theme-independent): `--motion-fast:120ms`,
`--motion-normal:200ms`. **Proposed** with mismatch 13: `--motion-slow:300ms` for the
drawer/modal family (not in code yet).

| Interaction | Duration | Easing | Where |
|---|---|---|---|
| hover/press state layers | `.12s` | `ease` | chips, nav, rows (×16) |
| drawer slide | `.22s` | `ease` | `#drawer` (dashboard.css:1222) |
| modal open | `.16s` | `ease` | `#tmodal`/`#lnmodal` |
| command modal | `.12s` | `ease` | `#sfmodal` |
| toast in | `.18s` | `ease-out` | `toast-in` |
| ball settle | `.14s` | `cubic-bezier(.2,.8,.2,1)` | `.qt-ball` |
| ball flight | `600-900ms` (distance-scaled) | `cubic-bezier(.32,0,.67,0)` → `cubic-bezier(.33,1,.68,1)` | `qtFly` (flow.js:337-341) |
| splash / slosh | `1s` / `.65s` | `ease-out` | `qtSplash`/`qt-slosh` |
| gauge arc sweep | `.6s` | `cubic-bezier(.22,1,.36,1)` | `.gval` |
| title gradient | `12s` | `linear` | `hive-title` |
| pulses (dot, cost, ball ring) | `1.1s-2s` infinite | `ease-in-out`/`ease-out` | `.dot`, `cost-pulse`, `qt-ball-pulse` |

Current debt: 39 distinct raw durations (`.12s` ×16, `.18s` ×7, `.2s` ×6, `.3s` ×5, …) and
5 easings, while `--motion-fast/normal` have **0** uses (mismatch 13). Route new transitions
through `var(--motion-*)`.

Reduced motion (`prefers-reduced-motion: reduce`, 15 blocks): all jar/train animation and
transitions off (arrivals become a `.12s` fade, ghosts hidden), toast entrance none, drawer
transitions none, nav transitions none, title gradient freezes, skeleton shimmer off,
gauge/pulse/dot animations off, `qtFly` refuses to run. Any new animation must join one of
these kill switches.

## Accessibility

Focus: global `:where(a,button,input,select,summary,[tabindex]):focus-visible` →
`2px solid var(--accent)`, offset 2px (dashboard.css:699-700); variants use
`--state-focus` or inset offsets on dense rows. Skip link `.skip` (z-index 200,
dashboard.css:229-230).

Labels: 38 `aria-label` uses. Of 43 `<button>` template strings in `web/js`, 5 carry
`aria-label` and 12 `title` — the glyph-only remainder (sound toggle `live.js:1005`, zoom,
drawer close, overflow chip) is **mismatch 22**. Jar sections, balls and the legend carry
real labels (Life view above). Form fields pair with `.lbl`/`.setl` labels.

Target sizes: `--ctl-sm:28px` / `--ctl-md:32px` floors; `--ctl-lg:44px` at `<=600px`,
coarse pointers (`pointer:coarse`) and `<=480px` for `button,a,[role=button],.btn,.chip,.tab`
(dashboard.css:2037-2042, 2159, 2231-2236). Inside dense tables the whole row is the target.

Motion & forced colors: `prefers-reduced-motion` covered above (15 blocks);
`forced-colors:active` currently has **one** block (gradient title → `currentColor`,
dashboard.css:2248-2249). Hive SVG fills and qt balls are not covered — **mismatch 23**
(one `@media (forced-colors:active)` block for `.hv-hex`, `.hv-crown`, qt balls).

### Contrast (computed WCAG 2.1, sRGB relative luminance, both themes)

| Pair | Light | AA 4.5 | Dark | AA 4.5 |
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

Support pairs (UI graphics, 3:1 bar): `--border-input` on `--card` 5.09 light / 3.71 dark —
PASS. `--accent-ink` on `--accent` 5.76 light / 8.91 dark — PASS. `--border` is a
decorative hairline (1.27:1), exempt as non-essential. Badge text on its own solid fill
(`--z-*-fg` on `--z-*`): light 4.63 / 4.85 / 4.68 PASS; dark 2.68 / 2.09 / 3.01 FAIL (see
proposals).

### Proposed AA fixes (PROPOSED — not in code; docs-only, audit §10 items 4-5)

| Failing pair | Current | Proposed replacement | New ratio | Notes |
|---|---|---|---|---|
| `--accent2` on `--bg` (light) | 3.13 | `--accent2` light = **`#5b7383`** (proposed) | 4.80 | also ≥3:1 as chart stroke |
| `--accent2` on `--card` (light) | 3.24 | `#5b7383` (proposed) | 4.97 | dark `--accent2:#b877d9` unchanged (6.00-6.44) |
| `--z-ok-fg` on `--bg` (light) | 1.13 | text-on-surface uses **`--z-ok` `#39764f`** via new `--z-ok-text` (proposed) | 5.23 | keep `--z-ok-fg` for text on the solid fill only |
| `--z-ok-fg` on `--card` (light) | 1.17 | `--z-ok-text` = `#39764f` (proposed) | 5.41 | e.g. `.dkpi-n.ok`, `.lgtag.assistant`, `.qv-keysum b` today misuse `--z-ok-fg` on card (dashboard.css:312, 443, 1715) |
| `--z-warn-fg` on `--bg` (light) | 1.14 | **`--z-warn-text` = `#7c6328`** (proposed) | 5.52 | same split |
| `--z-warn-fg` on `--card` (light) | 1.18 | `--z-warn-text` = `#7c6328` (proposed) | 5.72 | |
| `--z-bad-fg` on `--bg` (light) | 1.18 | **`--z-bad-text` = `#a14d47`** (proposed) | 5.53 | same split |
| `--z-bad-fg` on `--card` (light) | 1.22 | `--z-bad-text` = `#a14d47` (proposed) | 5.73 | dark `--z-*-text` = the dark `--z-*` values (5.09-8.24, already AA) |

Two dark-theme pairs fail even though audit §7's measured eight are light-side: `--z-*-fg`
badge text on the dark solid fills (ok 2.68 / warn 2.09 / bad 3.01). **Proposed** (same
ticket as item 4): badge ink on dark fills = `#05060a` (computed 6.37 / 8.24 / 5.47), or
enlarge to the 3:1 large-text bar only where the badge is ≥18.66px bold. Tokens.css's own
comment (tokens.css:52-56) already records this split as needing dedicated tokens.

## HARD RULES

1. Jar balls and the jar legend show the PROVIDER BRAND SVG icon via
   `provLogoSvg`/`provOf` (views.js) — NEVER letters. `b62a823` (family letter glyphs
   H/pi/C/X/O) was a reverted regression and must never return, be restored or be
   re-implemented. Guard: `tests/check_qt_ball_provider_icons.js` — never delete, skip or
   loosen it. Legibility at `QT_MIN 18px` is fixed with the contrast disc or a bigger
   `QT_MIN`, not with letters.
2. Hive shows real activity only: no invented events; no scream audio (banned:
   `v/a_aah.mp3`; the high-pressure sound is `pressure_kettle.mp3`). Hive colours come
   only from the `--hv-*` tokens (family colour via `--hv-fam-<id>`).
3. Hex/rgb/hsl colour literals are allowed only in `src/llm_telemetry/web/css/tokens.css`
   (stylelint `color-no-hex` enforces hex everywhere else; `.stylelintrc.json:21-31`).
4. Builds and scripts use `.venv/bin/python` — system `python3` lacks `llm_telemetry`.
   Build entry: `.venv/bin/python -m llm_telemetry.build_dashboard OUT.html`.
5. Never add a second Button, Modal, Drawer, Toast or Tooltip — extend the canonical
   component in this file first.
6. Text ≥4.5:1, large text/UI ≥3:1, in BOTH themes. `--z-*-fg` is for text on its solid
   `--z-*` fill only.
7. Every icon-only control gets an `aria-label`; every animation respects
   `prefers-reduced-motion`.
8. `AGENTS.md`/`CLAUDE.md` are protected agent-instruction files — headless runs must not
   write them; leave that to an approved interactive pass.
9. When code and this file disagree and your change doesn't need to settle it, do not fix
   it in your PR — report it for a Plane ticket (plane.beinno.com is the ONLY ticket system).

## Known mismatches

Code vs. spec gaps from `docs/design-audit.md` §10. Plane tickets are filed separately
(via beinno-plane); IDs get added here once filed. Until then: **ticket: pending**.

1. **Raw hex colours in JS (65)** — high — `palette.js:17` `PAL`, `routerview.js` ×14,
   `views.js:88`, `flow.js:557`; fix: `css()` reads + eslint hex ban. *ticket: pending*
2. **Raw rgb/hsl in JS (40)** — high — `views.js:1265-1266` canvas fills, `flow.js:125/560`
   inline styles, `hive.js:32/194`. *ticket: pending*
3. **Status token values duplicated as literals in 4 JS modules** — high —
   `#5f9e6e/#c4a06e/#c66a6a/#64748b` at `charts.js:355`, `flow.js:557/560`,
   `drawer.js:800-801`, `palette.js:230-231`; fix: one shared `Z` export. *ticket: pending*
4. **`--z-*-fg` fails contrast on light surfaces** — high — 6 pairs at 1.13-1.22:1
   (dashboard.css:312-313, 322-323, 441-443, 1715); fix per Accessibility proposals:
   `--z-*-text` for text-on-surface, `--z-*-fg` strictly text-on-fill (dark fill pairs
   also need the proposed dark badge ink). *ticket: pending*
5. **`--accent2` light fails body-text AA** — med — 3.13/3.24:1 (tokens.css:70); proposed
   `#5b7383`. *ticket: pending*
6. **Raw rgb/hsl in dashboard.css (66)** — med — e.g. dashboard.css:131, 606, 1936; fix:
   stylelint value allow-list (`var()|color-mix()|transparent`). *ticket: pending*
7. **Three tooltip implementations** — med — `.qtip` (dashboard.css:977-984), `#lntip`
   (1325), `.hv-tip` (hive.css:13); unify on `.qtip`. *ticket: pending*
8. **Three modal shells and four scrims** — med — `#tmodal`/`#lnmodal`/`#sfmodal` +
   `#tscrim`/`#lnscrim`/`#sfscrim`/`#pdscrim`; one `.modal` + `.scrim`. *ticket: pending*
9. **Two drawers** — low — `#drawer` (1220) vs `#pdrawer` (1338); name `#pdrawer` the
   detail-size variant. *ticket: pending*
10. **Two app bars** — med — `.appbar` (670) vs `#appbar` (2166-2168); delete the retired
    one, keep `#appbar`. *ticket: pending*
11. **Two dropdown families + 3 chip shapes** — low — `select.chip` (203-211) vs
    `.combo-btn/.combo-pop` (2109-2116), `.chip`/`.fchip`/`.pchip`; one chip spec with
    select/button variants. *ticket: pending*
12. **Jar material tokens are light-only** — med — 15 `--jar-*` (tokens.css:116-130) with
    the restyle gated `:root:not([data-theme="dark"])` (dashboard.css:2254-2264); either add
    a dark block or record "dark jars intentionally plain" (recorded here as the current
    spec). *ticket: pending*
13. **Motion tokens defined but unused; 39 raw durations** — med — `--motion-fast/normal`
    0 uses (tokens.css:109); route transitions through them, add `--motion-slow:300ms`
    (**proposed**). *ticket: pending*
14. **No z-index layer scale (27 raw values)** — med — proposed `--z-base…--z-drag` scale
    (Elevation & Depth). *ticket: pending*
15. **Spacing scale bypass + drifting `--sp-2`** — med — 299 raw px spacing declarations
    vs 7 `--sp-*` uses; and **`dashboard.css:16` re-declares `--sp-2:6px` while
    `tokens.css:107` says `--sp-2:8px`** (two conflicting values for one name; the fluid
    `--sp-3..6` overrides at dashboard.css:17-20 drift too). Fix: delete the `dashboard.css`
    copies — single source `tokens.css`. *ticket: pending*
16. **Radius one-offs (13 raw values off scale)** — low — `999px` ×24, `3px` ×16, `2px` ×17,
    `50%` ×14…; `--radius-sm/md/lg` 0 uses. Proposed: `--radius-pill:999px`,
    `--radius-full:50%` (**proposed** names). *ticket: pending*
17. **Shadows off the `--elev-*` scale** — low — 2 `--elev-*` uses vs 21 raw `box-shadow`
    values; map popovers to `--elev-2`, modals/tooltips to `--elev-3`; `--elev-0` has no
    dark sibling. *ticket: pending*
18. **Type-scale bypass** — med — 57 raw `font-size:13px|14px` declarations; replace with
    `--fs-*`, add `--fs-2xl` for the 22-28px display sizes (**proposed**). Also:
    `--fs-2xs` is used 6× but declared nowhere (utilities.css:113, dashboard.css:1825,
    1843, 1848, 1857) — declare it or drop it. *ticket: pending*
19. **Mono stack drift + undeclared `--mono`** — low — 4 spellings;
    `var(--mono,monospace)` at dashboard.css:1058 where `--mono` is declared nowhere;
    declare `--mono` once next to `--font` (tokens.css:141). *ticket: pending*
20. **Breakpoint sprawl (27 expressions)** — low — snap stragglers to the named scale
    480/640/900/1280 (Layout). *ticket: pending*
21. **No RTL scaffolding** — med — 0 `dir`/logical properties, 51 `left|right:`; stance
    recorded: LTR-only product today; if Arabic ships, convert edges to `inset-inline-*`
    first. *ticket: pending*
22. **Icon-only buttons missing `aria-label`** — med — 5 of 43 `<button>` strings labelled
    (e.g. sound toggle `live.js:1005`); label the glyph-only set + a grep-check like
    `tests/check_inline_sized_elements.js`. *ticket: pending*
23. **Single `forced-colors` block** — low — only dashboard.css:2248-2249; add coverage for
    `.hv-hex`, `.hv-crown`, qt balls. *ticket: pending*
24. **Hive tab generates raw colours at runtime** — low — `hive.js:32` `hsl(<hash>,…)` and
    `hive.js:194` `hvRgb`; map the four families to `--hv-fam-<id>`, hash colour only as a
    documented fallback. *ticket: pending*
25. **Standalone Hive drifts from tokens.css, no light theme** — med —
    `/home/hazemhagrass/workspace/beinno/hive/index.html`: `#2a2f40`/`#9aa4b8` (line 189),
    `Impact,"Arial Black"` (line 121), 9 radius one-offs, font stack missing `Roboto`,
    4 variables vs 60+ tokens, permanently dark. Reconcile during the Hive move
    (LLMTELEMET-267/H-9); light theme out of scope unless Hazem asks. *ticket: pending*
