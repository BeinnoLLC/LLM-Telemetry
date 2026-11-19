# Design system

## Tokens (LST-213)

All design tokens live in `src/llm_telemetry/web/css/tokens.css`. It is the only
file permitted to contain hex colour values (enforced by the `color-no-hex`
stylelint rule).

### Elevation
`--elev-1` … `--elev-3` — layered box-shadows for light and dark themes.

### Spacing scale (4 px)
`--sp-1` (4 px) … `--sp-6` (24 px).

### State layers
`--state-hover`, `--state-pressed`, `--state-focus` overlay colours.

### Palette
Theme tokens (`--bg`, `--card`, `--fg`, `--accent`, `--z-*`, `--pal-*`,
`--wash-*`) are declared in the same file and flipped by `[data-theme]`.

## Live sheet
See `examples/design-system.html` for a rendered token sheet.
