# Parity harness v1 — T-5 (LLMTELEMET-284)

Migration plan §7 (`docs/plans/node-nextjs-migration.md`): *"same inputs, same
numbers"*. For every fixture set the harness runs the **Python producer** and
the **Node producer** on the identical input, **normalizes** both artifacts and
**diffs them structurally**; any value mismatch prints a field-level diff and
exits non-zero.

```
npm run parity                # all cases (the CI gate)
npm run parity -- live        # one case
npm run parity -- --self-test # seeded-mismatch self-test (exit 0 = detected)
```

Build first (`npm run build -w @llm-telemetry/collectors`); the CLI runs from
`parity/dist/parity/cli.js`.

## Cases

| case | fixture (byte-identical copy of `examples/reports/`) | schema tag |
|------|------------------------------------------------------|------------|
| live | `live-data.json` | `live` |
| analytics | `analytics-data.json` | `analytics` |
| ollama | `ollama-data.json` | `ollama` |
| router | `router-data.json` | `router` |

## Producers

- **Python** — `py/produce.py`, executed with `.venv/bin/python` **of the main
  checkout** (read-only; resolve order `$LLM_TELEMETRY_PARITY_PYTHON`, then
  `$LLM_TELEMETRY_MAIN_REPO` / git-common-dir + `.venv/bin/python`). It runs the
  real Python write-path pieces: `llm_telemetry.schema.stamp()`, the write-time
  `schema_check.check()` gate and the collectors' atomic-write/serialization
  convention (`<path>.tmp` + `os.replace`, `json.dump(separators=(",",":"))`).
- **Node** — `nodeProducer.ts` calls the T-4 collector platform's
  `writeArtifact()` (`packages/collectors/src/artifactWriter.ts`): same
  `schema_version` stamp, same schema checked at write time, same atomic
  rename, Python-identical JSON serialization.

When T-6/T-15/T-16/T-17 land their collectors, each case swaps these generic
fixture producers for the real `python -m llm_telemetry.collect_*` /
`node cli.js <cmd>` pair without touching normalize/diff/CLI.

## Normalize (`normalize.ts`) — the documented rules

1. **Strip run-stamp timestamps** (`RUN_STAMP_KEYS`, case-insensitive, at every
   depth): `generated`, `generated_at`, `collected_at`, `updated_at`,
   `written_at`, `as_of`, `at`, `ts`, `timestamp`, `now`, `fetched`, `age`,
   `reset_at`, `expires_at`, `seen_at`, `last_seen`, `started_at`,
   `finished_at`. Only these keys — fixture-derived values under any other key
   (dates, windows, model names) are compared exactly.
2. **Ordering**: object keys sorted lexicographically at every depth (Python
   dict order vs Node object order cannot fake a diff). Array order is
   preserved — inside an array ordering is data, and a reordering producer is a
   parity failure.
3. **Float rounding** (the one documented formatting tolerance of §7.3):
   non-integer numbers round to `FLOAT_DIGITS = 6` decimals; **integers (tokens,
   counts, USD) are compared exactly**; `-0` folds to `0`.
4. Everything else is copied verbatim; the input is never mutated.

## Diff (`diff.ts`)

Structural, exact, RFC 6901 JSON Pointer paths. One entry per differing scalar
(`value`), key only in py (`missing`), key only in node (`extra`) or type
change (`type`). `formatDiffs()` renders the field-level report:

```
~ /profiles/work/active: py=2 node=3
- /errors/1: in py only ("boom")
+ /extra: in node only (true)
~ /ollama/hosts: type py=array node=object
```

Python is the reference (`expected`) per §7; Node is `actual`.

## Self-testing (T-5 acceptance)

`npm run parity -- --self-test` (also covered by `parity/tests/e2e.test.ts`)
seeds a deliberate `+1` perturbation at one numeric field of the node artifact
and requires the harness to report **exactly that field** — a harness that
cannot see a seeded mismatch cannot be trusted to see a real one.

## Tests

`parity/tests/` (vitest, run with the collectors suite):

- `normalize.test.ts` — the three documented rules plus purity.
- `diff.test.ts` — value/missing/extra/type entries, pointer escaping, readable
  formatting, exact numbers.
- `e2e.test.ts` — real py+node producers on the live/ollama fixtures
  (`.venv/bin/python` from the main checkout), shared `schema_version` on both
  artifacts, seeded-mismatch detection, CLI exit codes (0 parity, 1 diff,
  2 usage). Skips only when no `llm_telemetry` interpreter is available; the
  `npm run parity` CLI hard-fails in that case and is the CI gate.

## Follow-ups (later T-tickets)

- Swap the generic fixture producers for the real collectors as T-6/T-15/T-16/
  T-17 land (registry entries in `cases.ts`).
- HTTP cassettes (§7.4) for live sources — recorded replay belongs with the
  first live-source port (T-17 pricing/`probe`).
- UI parity check (§7.5, Playwright) with the page ports (T-20…T-25).
