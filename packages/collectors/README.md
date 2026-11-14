# @llm-telemetry/collectors

Node port of the LLM-Telemetry collectors — **T-4 (LST-283)** of
[`docs/plans/node-nextjs-migration.md`](../../docs/plans/node-nextjs-migration.md).
This ticket lands the *platform*: CLI skeleton, atomic artifact writer with
`schema_version` + schema-check parity, the config port, and scheduler unit
templates. The collectors themselves stay stubs and land one ticket at a time
(T-6 live, T-15 analytics, T-16 router/quota/probe/logs/…, T-17 pricing/costs,
T-18 ingest).

## CLI

```bash
npm run build          # tsc -> dist/
node dist/cli.js --help
node dist/cli.js demo    # writes demo-data.json through the real writer path
node dist/cli.js config  # print the resolved configuration
node dist/cli.js live    # exits 1: "not yet ported (T-6 …)"
```

The registry mirrors `src/llm_telemetry/cli.py`'s subcommands one-to-one, so
scheduler units can call either stack with only the interpreter swapped.

## Artifact contract (the overlap guarantee)

- `schema_version` stamped via `src/schema.ts` — the SAME constant as
  `src/llm_telemetry/schema.py`. Bump both together.
- Atomic write: `<path>.tmp` + rename (the Python collectors' convention), so
  readers never see a partial artifact.
- Schema-check at write time against the shared `src/llm_telemetry/schema/
  *.schema.json` — a faithful port of `schema_check.py` (same small JSON Schema
  subset, same messages, unknown keywords are errors). A failing payload is
  never written and leaves any previous artifact intact.
- **Single-writer rule**: Node artifacts go to `LLM_TELEMETRY_NODE_REPORTS_DIR`
  (config key `node_reports_dir`, default `~/.local/share/llm-telemetry/
  reports-node` — a non-production path). The writer REFUSES the Python
  `reports_dir` and `~/.hermes/reports`, and any path inside either (subdirs
  like `sessions/` hold Python artifacts too); `LLM_TELEMETRY_SHARED_REPORTS=1` is
  the deliberate cutover switch (plan §12) and nothing else.

## Config port

`src/config.ts` mirrors `src/llm_telemetry/config.py`: same discovery order
(`$LLM_TELEMETRY_CONFIG` → `$XDG_CONFIG_HOME` → `~/.config`), same profile
autodiscovery and P5 merge/exclude rules, same resolved `reports_dir`
(plan §14.6). Differences: construction never mkdir's the (production) Python
reports dir, and `node_reports_dir` selects the Node-only output dir.

## Scheduler

`scheduler/` holds systemd user unit + crontab **templates** (files only —
never installed/enabled by this project's tickets without the user's OK). See
`scheduler/README.md`.

## Tests

`npm test` — vitest (node env): writer atomicity + single-writer guard,
schema-check pass/fail parity (including the four committed samples that the
Python `schema_check` validates in CI), CLI dispatch (stub exit codes, demo,
config, usage codes).
