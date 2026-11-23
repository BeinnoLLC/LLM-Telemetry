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
| `npm run test:parity` | T-19 serve.py response/status diff harness (Python oracle) |
| `npm run test:e2e` | Playwright smoke (system Chrome channel) |

## Loopback-only write endpoints

`POST /api/settings` and `POST /api/refresh` are guarded by a loopback peer
check. Next route handlers cannot see the TCP socket peer, so the app assumes
peer `127.0.0.1` unless `LLM_TELEMETRY_PEER_IP` is set. Bind the Next app to
loopback when it is not behind a trusted proxy:

```sh
npm run start -- -H 127.0.0.1   # next start -p 8481 -H 127.0.0.1
```

Client-supplied `x-forwarded-for` and `x-real-ip` headers are ignored by
default, so a spoofed loopback value cannot pass the guard. Only when the app
really runs behind a trusted reverse proxy, set `LLM_TELEMETRY_TRUST_PROXY=1`
(`true`, `yes` and `on` are also accepted, case-insensitively). In that mode
the rightmost `x-forwarded-for` hop is treated as the trusted proxy and the
address immediately to its left is used as the peer; `x-real-ip` is consulted
only in this mode. Set `LLM_TELEMETRY_PEER_IP` to the proxy's address when the
route cannot otherwise derive a reliable direct peer.

This package is an npm workspace member of the repo root
(`npm ci` at the repo root installs it). New npm dependencies may only be
added inside `apps/web`, pinned exactly, with the root `package-lock.json`
committed. The `tests/` package stays standalone (`npm ci --prefix tests`).
