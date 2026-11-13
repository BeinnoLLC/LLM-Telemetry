# apps/web — Next.js dashboard (migration scaffold, T-0 / LST-281)

Next.js 15 (App Router) + TypeScript (`strict: true`) dashboard app from
`docs/plans/node-nextjs-migration.md` §4. Scaffold only: the shell, theme
tokens, nav, feeds, collectors and page ports arrive in T-1..T-28.

**The Python app is untouched and stays live** (`hermes-dash-http` on :8477)
until the plan §12 cutover with Hazem's explicit OK.

## Ports (plan §4)

| Port | What |
|---|---|
| 8477 | Python dashboard (deployed, unchanged) |
| 8480 | `npm run dev` — Next dev server |
| 8481 | `npm run start` — Next prod preview |
| 8790 | standalone Hive (outside this repo) |

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | dev server on :8480 |
| `npm run build` | `next build` |
| `npm run start` | prod preview on :8481 (needs a build first) |
| `npm run lint` | ESLint (flat config, `next/core-web-vitals` + `next/typescript`) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run test` | vitest (jsdom) unit tests |
| `npm run test:e2e` | Playwright smoke (system Chrome channel) |

This package is an npm workspace member of the repo root
(`npm ci` at the repo root installs it). New npm dependencies may only be
added inside `apps/web`, pinned exactly, with the root `package-lock.json`
committed. The `tests/` package stays standalone (`npm ci --prefix tests`).
