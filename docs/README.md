# LLM Telemetry — documentation

LLM Telemetry is a single-page observability dashboard for people who run AI
agents across a mix of local GPU boxes (Ollama) and hosted providers. It reads
the data your agents already write — Hermes SQLite databases, PI worker session
files, Claude Code and Codex transcripts, the Ollama API, the router config and
the provider quota cache — and turns it into one self-contained
`dashboard.html`: what is running right now, which host is saturated, what the
fleet cost, which model or tool is failing, and how work is routed. It needs no
agent instrumentation, no sidecar and no external service; the only runtime
dependency is PyYAML.

**Who it is for:** an individual or small team operating several agent
profiles and inference hosts who needs to answer "what is running, what does it
cost, why did it fail?" without opening five tools.

## Contents

| Document | Read it for |
|---|---|
| [overview.md](overview.md) | Feature list: every page and tab, and what it shows |
| [architecture.md](architecture.md) | Components, data flow, Mermaid diagram, payload contract |
| [data-sources.md](data-sources.md) | Each collector: input, output, cadence, time window |
| [dashboard-guide.md](dashboard-guide.md) | How to read each page, KPI and column; cost policy; alerts; sounds; shortcuts |
| [setup-and-deploy.md](setup-and-deploy.md) | Install, config, env vars, CLI, systemd units, deploy after merge |
| [development.md](development.md) | Repo layout, test suites, lint, page-weight budget, design system |
| [glossary.md](glossary.md) | Terms used across the project |
| [roadmap.md](roadmap.md) | Decisions on record and what is known/unknown about future work |
| [artifact-brief.md](artifact-brief.md) | One-page fact sheet for building a presentation or explainer |

Existing documents (kept as they were):

- [adr/0001-language-and-runtime-split.md](adr/0001-language-and-runtime-split.md) — why Python collects and plain ES modules render.
- [breakpoint-qa.md](breakpoint-qa.md) — manual responsive QA checklist (five widths, two themes).

The project README is at [../README.md](../README.md); it remains the quick
start and carries the long-form notes on rankings, the payload contract and
sample builds.

## Conventions used in these docs

- Every claim was checked against the code at commit `087bc44` (main). File
  paths are relative to the repo root.
- "**to confirm**" marks something that could not be verified from the repo
  alone (for example, how a particular machine is deployed).
- Numbers that come from the code (cadences, windows, thresholds) are quoted
  with the file that defines them so they can be re-checked.
