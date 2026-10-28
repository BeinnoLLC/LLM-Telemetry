# Roadmap

This repository contains **no roadmap document, milestone file or planned-work
list**. Planning is tracked outside the repo (`pyproject.toml`
`[project.urls]` lists a ClickUp URL for issues), and this documentation does
not reproduce it. What follows is only what can be read from the repo.
Nothing here is a commitment.

## Decisions on record

| Source | Decision | Status |
|---|---|---|
| `docs/adr/0001-language-and-runtime-split.md` | Keep Python for the data plane, move the front end into real `.js`/`.css` files, put a versioned schema between them. Rejected: full Node/TypeScript rewrite, Jinja2 templates, a dynamic server, a bundler. | ADR header says *proposed* (2026-09-25); the code follows it (`src/llm_telemetry/web/`, `schema/`) — whether the header should now read *accepted* is **to confirm** |
| `README.md` | Records as delivered: rankings view (#113), doctor (#143), session timeline (#94), transcripts (#79), ingest commands (LST-240/241). | Done |

## Delivered since the ADR (visible in the code and README)

Frontend extraction into ES modules, payload schemas and `schema_version`,
golden fixtures, lint/type gates, sample isolation, Home as the live board
(Phase 15, #173), Quota and Router views, Rankings, session timeline and
transcript modals, Session finder, alerts, PI and Claude/Codex live sessions,
subscription-covered cost display, Grafana-style theme, fleet bar and roomier live
table.

## Stated follow-ups in the code

These are written in the repo as known limits or next steps:

- **Full-text search over message content** is explicitly out of scope for the
  Session finder; `collect_session_index.py` names the existing
  `messages_fts` / `messages_fts_trigram` indexes as "the real follow-up".
- **Typing ratchet** (`pyproject.toml`): enable `disallow_untyped_defs` for new
  modules, then drop per-module exemptions, then `check_untyped_defs` repo-wide.
  (Planned as P3-01b in that comment.)
- **Project inference from prompt text** is deliberately out of scope
  (`projects.py`).
- **Repo/branch attribution** is forward-looking only; sessions recorded before
  the git-probe fix keep empty fields (`collect_repo_branch.py`).
- **Session timeline export** is capped to the newest 100 sessions; older ones
  show "not exported".

## Unknown / to confirm

- Which tickets are open or scheduled next: not in the repo.
- Whether durable-store ingest (`ingest`, `ingest-pi`) is intended to join the
  shipped timers: no timer exists for it today.
- Whether a screenshot asset is planned: the root README references
  `docs/screenshot.png`, which is absent.
- Release/versioning plan: `pyproject.toml` is `0.1.0`; no changelog or tags
  were inspected.
