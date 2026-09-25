# llm-telemetry

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

Every model, provider and tool has one stable colour across every chart,
verified perceptually (CIE76 ΔE) rather than by eye.

## Install

```bash
git clone git@github.com:BeinnoLLC/LLM-Telemtry.git
cd LLM-Telemtry
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
  "local_host_patterns": ["192.168.", "10.", "gpu-01"]
}
```

`LLM_TELEMETRY_CONFIG=/path/to.json` overrides the location.

## Commands

| Command | Does |
|---|---|
| `llm-telemetry collect` | Write `analytics-data.json` from the agent DBs |
| `llm-telemetry live` | Write `live-data.json` (fast, for polling) |
| `llm-telemetry probe` | Probe inference hosts → `ollama-data.json` |
| `llm-telemetry dashboard` | Collect + render `dashboard.html` |
| `llm-telemetry costs` | Render the per-1M rate reference page |
| `llm-telemetry router` | Export routing/fallback config |
| `llm-telemetry serve` | Serve reports with caching disabled |

## Continuous updates

`systemd/` has user units: a 1-minute dashboard rebuild, a 5-second host probe,
and the HTTP server. Install with:

```bash
cp systemd/*.service systemd/*.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now llm-telemetry-probe.timer llm-telemetry-serve
```

Host probing runs on its own fast timer because GPU residency and queue depth
change within a single request; the telemetry carries an `age` so a dead probe
shows as stale instead of silently serving a confident old snapshot.

## Development

```bash
python3 examples/make_sample_data.py   # synthetic payloads
node tests/run-all.js                  # 213 checks, 16 suites
python3 examples/check_no_leaks.py     # nothing identifying in samples
```

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
