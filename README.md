# LLM Telemetry

Observability for a mixed LLM fleet — local Ollama boxes and hosted APIs on one
dashboard. Reads agent telemetry from SQLite, probes inference hosts, and
renders a single self-contained HTML page: live sessions, spend, failures,
routing, and a provider→model→task flow graph.

![dashboard](docs/screenshot.png)

## Why

If you run models across several providers and a couple of GPU boxes, the
questions that matter are annoying to answer: *what is running right now, which
host is saturated, what did last week cost, and why did that request fail?*
This answers them from data you already have — no agent instrumentation, no
sidecar, no external service.

## What you get

- **Live** — in-flight sessions, per-host GPU/CPU/VRAM/queue load, capability
  pills, model residency.
- **Flow** — force-directed provider → model → task tree, draggable, with the
  chats each node served.
- **Usage / Cost** — calls, tokens, cache hits, spend by model and task.
  Self-hosted models are costed from electricity, hosted ones from live rates.
- **Health** — success rate per model with failure kinds broken out.
- **Logs** — a live drawer of tool calls and failures, colour-coded.
- **Rankings** — `rankings.html`, OpenRouter's public top models by token
  usage for the last day / week / month (see [Rankings](#rankings)).

Every model, provider and tool has one stable colour across every chart,
verified perceptually (CIE76 ΔE) rather than by eye.

## Install

```bash
git clone git@github.com:BeinnoLLC/LLM-Telemetry.git
cd LLM-Telemetry
pip install -e .
```

Python 3.10+. Only dependency is PyYAML (to read agent configs).
`nvidia-smi` is used when present for GPU telemetry; absent is fine.

## Quick start

```bash
llm-telemetry config      # show what was autodiscovered
llm-telemetry dashboard   # collect + render
llm-telemetry serve       # http://localhost:8477/dashboard.html
```

Profiles are autodiscovered from `~/.hermes`. To point it somewhere else, write
`~/.config/llm-telemetry/config.json`:

```json
{
  "profiles": [
    {"name": "work", "home": "~/.hermes"},
    {"name": "personal", "home": "~/.hermes/profiles/personal"}
  ],
  "reports_dir": "~/.local/share/llm-telemetry/reports",
  "port": 8477,
  "electricity_rate_kwh": 0.047,
  "gpu_draw_watts": 350,
  "host_overhead_watts": 90,
  "local_host_patterns": ["192.168.", "10.", "gpu-01"]
}
```

`LLM_TELEMETRY_CONFIG=/path/to.json` overrides the location.

## Commands

| Command | Does |
|---|---|
| `llm-telemetry config` | Print the resolved configuration and exit |
| `llm-telemetry dashboard` | Collect + render `dashboard.html` |
| `llm-telemetry analytics` | Write `analytics-data.json` from the agent DBs |
| `llm-telemetry live` | Write `live-data.json` (fast, for polling) |
| `llm-telemetry logs` | Write `logs-data.json` (the full Logs page) |
| `llm-telemetry transcripts` | Write `transcripts.json` — windowed per-session chat for the transcript modal (#79) |
| `llm-telemetry session-timeline` | Write `sessions/<profile>/<id>.json` — one session's timeline (#94) |
| `llm-telemetry probe` | Probe inference hosts → `ollama-data.json` |
| `llm-telemetry costs` | Render the per-1M rate reference page |
| `llm-telemetry rankings` | Fetch OpenRouter's public rankings → `rankings-data.json` + `rankings.html` (#113) |
| `llm-telemetry router` | Export router config, tiers, auth and routing decisions (Router tab) |
| `llm-telemetry quota` | Export per-profile provider quota headroom from the Hermes quota cache (Quota tab) |
| `llm-telemetry serve` | Serve reports with caching disabled (`--port N`, `--bind ADDR`, `--dir PATH`, `--open`; `--port 0` picks a free port and prints it) |

## Continuous updates

`systemd/` has user units: a 1-minute dashboard rebuild, a 5-second host probe,
an hourly router refresh, an hourly quota refresh, an hourly rankings refresh,
and the HTTP server.
Install with:

```bash
cp systemd/*.service systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now llm-telemetry-build.timer llm-telemetry-probe.timer \
  llm-telemetry-router.timer llm-telemetry-quota.timer llm-telemetry-rankings.timer \
  llm-telemetry-serve
```

No systemd (e.g. a container)? Run `llm-telemetry router` and
`llm-telemetry quota` hourly from cron (`0 * * * * llm-telemetry router quota`).
If you skip the router one, the dashboard build re-collects router data whenever
`router-data.json` is more than 65 minutes old.

Quota headroom comes from the Hermes quota plugin's own cache — this repo never
holds a provider credential, so there is nothing here to re-authenticate. Run the
Hermes quota plugin's refresh first; a stale cache just means stale bars.

### Rankings

`rankings.html` shows OpenRouter's public model rankings (top models by token
usage, plus the long-tail `other` row) with a day / week / month chooser. Each
run makes ONE request to OpenRouter's `rankings-daily` dataset and writes
`rankings-data.json`; the page inlines it and fetches nothing. It needs
`OPENROUTER_API_KEY` in the environment of the build unit / cron job (only the
variable name is ever reported). Without the key, or when the request fails,
the payload records `status: "unavailable"` with the reason and the page says
so instead of guessing; a previous good snapshot is kept and marked stale. The
step runs in the 1-minute build cycle (a good payload younger than an hour is
reused) and has its own hourly `llm-telemetry-rankings.timer`.

Rankings data by OpenRouter, CC BY 4.0 — <https://openrouter.ai/docs>. The page
carries the same attribution line.

Host probing runs on its own fast timer because GPU residency and queue depth
change within a single request; the telemetry carries an `age` so a dead probe
shows as stale instead of silently serving a confident old snapshot.

## Development

```bash
python3 examples/make_sample_data.py   # synthetic payloads
node tests/run-all.js                  # DOM suites (jsdom)
for t in tests/test_*.py; do python3 "$t"; done   # Python suites
python3 examples/check_no_leaks.py     # nothing identifying in samples
```

### Rendering the samples without touching your real data

The committed dashboard under `examples/reports/` is rendered from committed
fixture payloads only. Build it like this, on any machine, whether or not you
have a real agent home:

```bash
LLM_TELEMETRY_NO_COLLECT=1 \
LLM_TELEMETRY_CONFIG=examples/sample-config.json \
LLM_TELEMETRY_AGENT_HOME=examples/agent-home \
python3 -m llm_telemetry.build_dashboard examples/reports/dashboard.html
```

The price sheet builds the same way, from a pinned sample catalogue so it
needs no network and does not churn when OpenRouter's prices move:

```bash
LLM_TELEMETRY_NO_COLLECT=1 \
LLM_TELEMETRY_CONFIG=examples/sample-config.json \
LLM_TELEMETRY_AGENT_HOME=examples/agent-home \
LLM_TELEMETRY_CATALOG=examples/reports/sample-catalog.json \
python3 -m llm_telemetry.build_costs examples/reports/costs.html
python3 -m llm_telemetry.build_rankings examples/reports/rankings.html
```

`examples/make_sample_catalog.py` regenerates that catalogue from a real
cache: the aliased models, one `:batch` SKU and every `-1` router sentinel,
so the edge cases stay covered.

- `LLM_TELEMETRY_NO_COLLECT=1` renders from the JSON already on disk; no
  collector runs.
- `examples/sample-config.json` sets `"profiles": []`, which now means **no
  profiles** (it used to mean "discover everything").
- `LLM_TELEMETRY_AGENT_HOME` points at an empty fixture directory, so nothing
  can be discovered even if a collector did run.

`tests/test_sample_isolation.py` enforces this: it builds the sample twice,
against an empty home and against a home holding a decoy profile, and fails
unless the two outputs are byte-identical. `tests/test_sample_artifacts.py`
closes the other half — it rebuilds every committed page from these same inputs
into a temporary directory and diffs it against the committed file, so a page
cannot silently fall behind the code. The only forgiven field is the
`Generated <date>` line, normalised in one place.

### Artifact weight

Every committed page carries a budget in `tests/test_page_weight.py`, just above
its current size, so growth is a decision rather than a surprise. Raise the
number here and in that file in the same commit, or trim the page:

| Artifact | Budget (bytes) |
|---|---|
| `examples/reports/dashboard.html` | 800,000 |
| `examples/reports/analytics-data.json` | 200,000 |
| `examples/reports/costs.html` | 90,000 |
| `examples/reports/rankings.html` | 25,000 |

### The payload contract

Every payload a collector writes has a schema in
`src/llm_telemetry/schema/<tag>.schema.json`, and the collector validates the
payload before it writes it — a payload the page cannot read is never written.
The subset is deliberately small: `type`, `required`, `properties`, `items`
and `additionalProperties`, implemented by a stdlib validator
(`schema_check.py`) with no dependency and no network. A keyword the validator
does not implement is an error, not a silent no-op, so a schema can never stop
enforcing something quietly.

Two rules keep it from being too tight or too loose:

- `required` means *every payload we have seen has the key and the page reads
  it*. Fields only some records carry are typed when present, not required, so
  adding a field is never a breaking change and the schema does not fail on a
  legitimate collection.
- Numbers are `number`, never `integer`. JSON has one number type, and a field
  that holds `12` in one payload holds `12.4` in the next.

A schema is derived from *real* payloads, so its property names are data too: a
dict keyed by data — profile, model, provider or route names — becomes
`additionalProperties` rather than a list of pinned names, and
`examples/check_no_leaks.py` scans the schema directory for the same identity
patterns it applies to the samples.

Check it from both ends:

```bash
python3 -m llm_telemetry.schema_check   # the committed samples
node tests/check_schema.js              # the same samples, consumer side
```

`tools/gen_schemas.py` re-derives the schemas from the committed sample plus a
payload from a real run — its header documents the rules and why each one is
there:

```bash
CUR_OUT=/dir/with/fresh/payloads python3 tools/gen_schemas.py
```

### Choosing which profiles are read

Profiles are discovered under the agent home (`$LLM_TELEMETRY_AGENT_HOME`, else
`agent_home` in the config, else `~/.hermes`). The config narrows or extends
that list, never silently replaces it:

| config | result |
|---|---|
| no `profiles` key | every discovered profile |
| `"profiles": []` | none |
| `"profiles": [{"name": "x", "home": "..."}]` | `x` from config, plus every other discovered profile |
| `"exclude": ["scratch"]` | drops `scratch`; the only way to omit one |

The header shows `N profiles · M excluded · K unreadable`; click it for the
full list. An unreadable `state.db` is shown as a warning, not dropped.

Tests run the real built HTML in jsdom and assert on the rendered DOM — colour
distinctness, bar geometry, tooltip contents, tree structure. They exist
because several bugs here were invisible to unit tests and only showed up in
pixels: bars rendering `0x0` because an inline `<i>` ignores `width`, grey
0%-success bars indistinguishable from the track, a palette that reshuffled
whenever a new tool appeared.

`reports/` is gitignored — real telemetry contains chat titles and spend.
`examples/reports/` holds synthetic equivalents so a fresh clone renders
something, and `check_no_leaks.py` runs in CI to keep it that way.

## Licence

MIT
