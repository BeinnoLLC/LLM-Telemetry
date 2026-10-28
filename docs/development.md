# Development guide

## Repo layout

```
src/llm_telemetry/        Python package (stdlib + PyYAML)
  collect_*.py            15 collectors (see data-sources.md)
  build_dashboard.py      inline assets + payloads -> dashboard.html
  webassets.py            reads web/ and inlines JS modules in order.json order
  serve.py cli.py doctor.py config.py pricing.py alerts.py ...
  schema/*.schema.json    payload contracts (analytics, live, ollama, router)
  web/
    dashboard.html        HTML shell with __PLACEHOLDER__ slots
    css/tokens.css        the one shared palette (dark + light themes)
    css/dashboard.css     page styles
    js/*.js               11 ES modules + order.json (load order manifest)
examples/                 synthetic samples, sample config, generators, leak gate
  reports/                committed sample payloads and rendered dashboard.html
tests/                    JS suites (check_*, drive_*, unit_*), Python test_*.py, bless.js, fixtures/golden
tools/                    run_py_tests.py, gen_schemas.py, breakpoint_shots.py, probes, module-graph check
systemd/                  user units and timers
scripts/                  refresh-dashboard.sh (cron alternative), strip_comments.py
docs/                     this documentation, adr/, breakpoint-qa.md
shots/                    projfilter_overflow.py (no image files at present)
.github/workflows/ci.yml  CI pipeline
```

Counts at `087bc44`: 45 Python modules in `src/llm_telemetry/`; 114
`tests/check_*.js` + 1 `tests/drive_drawer.js` + 18 `tests/unit_*.mjs` JS
suites; 57 `tests/test_*.py` Python suites.

## Setup for development

```bash
pip install -e ".[dev]"            # pytest, ruff, mypy, playwright (dev-only)
npm ci                             # eslint, stylelint (root package.json)
npm ci --prefix tests              # pinned jsdom for the DOM suites
```

Use Node 24: jsdom 30 needs Node ^22.22.2, ^24.15 or >=26, and on Node 20
several suites crash (comment in `.github/workflows/ci.yml`). Borrowing another
project's `node_modules` produces false jsdom failures; use `tests/node_modules`.
`check_profile_resolution` and `check_schema_version` need `llm_telemetry`
installed (`pip install -e .`).

## Test suites and checks

| Check | Command |
|---|---|
| JS suites (jsdom on the built sample page) | `NODE_PATH=tests/node_modules node tests/run-all.js` |
| Python suites (fast local loop) | `python3 tools/run_py_tests.py` (`-v` for output) |
| Python suites via pytest (what CI runs) | `python3 -m pytest tests/test_pytest_wrapper.py -v` |
| Ruff | `ruff check src/` |
| mypy | `mypy src/` |
| Leak gate | `python3 examples/check_no_leaks.py` |
| Golden fixtures | `node tests/bless.js --check` (`--bless` accepts an intended shape change) |
| Schema check | `python3 -m llm_telemetry.schema_check` and `node tests/check_schema.js` |
| Web lint (ESLint + stylelint + inline-sized check) | `npm run lint` |
| Page weight | `tests/test_page_weight.py` (part of the Python suites) |
| Sample isolation / artifacts | `tests/test_sample_isolation.py`, `tests/test_sample_artifacts.py` |
| Quota layout probe (real Chrome) | `python3 tools/quota_layout_probe.py --chrome "$(which google-chrome-stable)"` |
| Breakpoint screenshots | `python3 tools/breakpoint_shots.py --out breakpoint-shots --file examples/reports/dashboard.html --chrome ...` |

Each Python test is a standalone script that prints a summary and exits
non-zero on failure; `tests/test_pytest_wrapper.py` runs them as subprocesses so
`pytest` is meaningful in CI. `tests/run-all.js` runs every
`check_*/drive_*.js` and `unit_*.mjs` in its own child process (200 s timeout
each) and sums the "N passed, M failed" lines.

The CI order (`.github/workflows/ci.yml`): install → ruff + mypy → `npm run lint`
→ leak gate → schema check → render sample dashboard → leak gate on rendered
pages → `bless.js --check` → DOM suites → Python suites → quota layout probe
(plus two control runs that must fail/pass as designed) → non-blocking
breakpoint screenshots.

There is no markdown linter configured and no test that covers `docs/`; the
docs are checked by review. `npm run lint` does not lint Markdown.

### Time-windowed fixtures

Collectors use rolling windows (for example 30 days). Test fixtures must not use
fixed epochs: they age out and start failing. Use "now minus an offset"
(this caused `test_context_compaction_collector.py` and
`test_cost_attribution_collector.py` to fail until fixtures were shifted).

## Page-weight budget

Every committed artifact has a byte budget in `tests/test_page_weight.py`, just
above its size, so growth is a decision:

| Artifact | Budget (bytes) |
|---|---|
| `examples/reports/dashboard.html` | **960,000** |
| `examples/reports/analytics-data.json` | 200,000 |
| `examples/reports/rankings-data.json` | 2,000,000 |

To raise a budget, change the number in the test and in `README.md` in the same
commit, or trim the page. `examples/reports/dashboard.html` is rebuilt from the
sample inputs and compared to the committed copy by
`tests/test_sample_artifacts.py`, so rebuild and commit it after changing any
web asset (command in [setup-and-deploy.md](setup-and-deploy.md#samples-without-touching-real-data)).

## Design system

- **Theme:** Grafana-style. Dark is the default, accent Grafana blue
  (`#6e9fff` dark / `#1f62c9` light); light mounts without the attribute. Set
  by a pre-paint script (key `hermes-dash-theme`) and `main.js`.
  Hairline borders, no gradients, no glow.
- **Tokens:** `web/css/tokens.css` is the only place the shared palette is
  declared (`--bg`, `--card`, accent, semantic `--z-*` and per-kind `--kind-hermes/pi/claude/codex`).
  Page-specific scales (type, spacing, gauge sizing) stay in `dashboard.css`.
- **Colour identity:** one stable colour per model, provider and tool across
  every chart, verified perceptually (CIE76 ΔE) in `palette.js` and
  `tests/check_colors.js` / `check_distinct.js`.
- **Layout preferences:** readable over dense. The live session table uses
  roomy rows (about 48–56 px, text 14 px or larger, two-line cells).
- **Self-contained:** inline SVG for marks, Web Audio for sounds (no asset
  files). The page loads Tailwind (CDN) and Chart.js (jsDelivr) via `<script>`
  tags in the shell.
- **Responsive:** QA at 375 / 768 / 1024 / 1440 / 1920 px in both themes per
  [breakpoint-qa.md](breakpoint-qa.md).

## Conventions

- **Python:** stdlib first; PyYAML is the only dependency. Ruff selects
  `E4, E7, E9, F`, line length 100; mypy non-strict with a written ratchet plan
  in `pyproject.toml`.
- **Payload changes:** a shape change means a `SCHEMA_VERSION` bump
  (`schema.py`) and a consumer guard, not a silent rename. Regenerate schemas
  with `tools/gen_schemas.py` (`CUR_OUT=/dir/with/fresh/payloads`).
  Property names that are data (profile, model, route names) go under
  `additionalProperties`.
- **Privacy:** no credentials, no message text in payloads; whitelist fields,
  never blacklist. Samples must pass `check_no_leaks.py`.
- **Front end:** ES modules only, no bundler. Cross-module mutation of imported
  bindings is allowed only at sites recorded by `tools/check-module-graph.mjs`.
  No external runtime fetches for the app's own code.
- **Additive fields:** fields only some records carry are typed when present,
  never `required`; numbers are `number`, not `integer`.
- **Sample data:** generated by `examples/make_sample_data.py` and the
  `add_*_to_samples.py` scripts; the committed dashboard must be reproducible
  from them with `LLM_TELEMETRY_NO_COLLECT=1`.
- **Decisions:** architecture decisions go in `docs/adr/`.
- **Git:** work on a branch, PR into `main`; after a merge, deploy (see
  [setup-and-deploy.md](setup-and-deploy.md)).
