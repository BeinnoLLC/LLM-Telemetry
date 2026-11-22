/** Collector CLI skeleton — T-4 (LST-283), port of src/llm_telemetry/cli.py.
 *
 * `node packages/collectors/dist/cli.js <command>` mirrors the Python CLI's
 * subcommands one-to-one (migration plan §4 "Collectors as Node jobs"), so the
 * scheduler units can call either stack with only the interpreter swapped.
 *
 * T-4 is the platform, not the collectors: every collector command is a REGISTRY
 * STUB that exits non-zero with "not yet ported" and names the ticket that will
 * land it (T-6 live, T-15 analytics, T-16 router/quota/probe/logs/…, T-17
 * pricing/costs). Two commands work for real:
 *
 *   demo    — trivial end-to-end exercise of the artifact writer: a minimal
 *             `live` payload stamped and schema-checked through the exact write
 *             path every ported collector will use.
 *   config  — print the resolved configuration (the config port's CLI face).
 */

import * as fs from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { get as getConfig, resolveNodeReportsDir, type Config } from "./config.js";
import { assertSafeOutDir, writeArtifact } from "./artifactWriter.js";
import { buildLive } from "./collectLive.js";
import { collectAnalytics } from "./collectAnalytics.js";
import { collectRouter } from "./collectRouter.js";
import { collectLogs } from "./collectLogs.js";
import { collectProbeAsync, type CapsCache } from "./collectProbe.js";
import { writeSessionFiles } from "./collectSessionTimeline.js";
import { collectRankingsAsync, readPrevious } from "./collectRankings.js";
import { collectTranscripts } from "./collectTranscripts.js";
import { appendHistory, collectQuota, historySample, HISTORY_NAME } from "./collectQuota.js";
import { fetchCatalog } from "./pricingFetch.js";
import { build as buildCosts, writeCostsData } from "./collectCosts.js";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

const stdIo: CliIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

export type RunFn = (
  name: string,
  io: CliIo,
  args: string[],
  cfg: () => Config,
) => number | Promise<number>;

interface Command {
  summary: string;
  /** Ported = works today; stub = exits 1 "not yet ported" until its ticket. */
  status: "ported" | "stub";
  ticket?: string;
  run: RunFn;
}

function stub(summary: string, ticket: string): Command {
  return {
    summary,
    status: "stub",
    ticket,
    run: (name, io, args) => {
      const argv = args.length ? ` ${args.join(" ")}` : "";
      io.err(
        `llm-telemetry(node): '${name}' is not yet ported ` +
          `(${ticket}; T-4 ships the platform only). ` +
          `The Python CLI still runs it: .venv/bin/llm-telemetry ${name}${argv}`,
      );
      return 1;
    },
  };
}

/** The trivial demo payload: the minimal shape live.schema.json requires
 * (generated, profiles, errors, ollama, bytes_per_token, schema_version), so a
 * green `demo` proves stamp + schema-check + atomic write end to end. */
export function demoPayload(now = new Date()): Record<string, unknown> {
  return {
    generated: now.toISOString(),
    profiles: {},
    errors: [],
    ollama: { ts: now.getTime() / 1000, hosts: [], age: 0 },
    bytes_per_token: 0,
  };
}

export const COMMANDS: Record<string, Command> = {
  // --- ported (T-4 platform) ---
  demo: {
    summary: "demo — write a minimal live-schema demo artifact through the writer",
    status: "ported",
    run: (_name, io, _args, cfg) => {
      const res = writeArtifact("demo-data.json", demoPayload(), {
        tag: "live",
        cfg: cfg(),
      });
      io.out(`${res.path}  (${res.bytes} bytes, live schema OK)`);
      return 0;
    },
  },
  config: {
    summary: "config — print the resolved configuration and exit",
    status: "ported",
    run: (_name, io, _args, cfg) => {
      io.out(JSON.stringify(cfg().toDict(), null, 2));
      return 0;
    },
  },
  // --- stubs: mirror cli.py one-to-one, land with their T-ticket ---
  dashboard: stub("dashboard — build dashboard.html (replaced by `next build`)", "T-20..T-25"),
  costs: {
    summary: "costs — write costs-data.json",
    status: "ported",
    run: async (_name, io, args, cfg) => {
      const outArg = args[0];
      const c = cfg();
      const d = await buildCosts();
      const out = outArg ?? (c.reports_dir + "/costs-data.json");
      const res = writeCostsData(d, process.env, c);
      io.out(`costs: ${d.models.length} models -> ${res}`);
      return 0;
    },
  },
  pricing: {
    summary: "pricing — refresh the OpenRouter price catalogue cache",
    status: "ported",
    run: async (_name, io, _args, cfg) => {
      const [catalog, src] = await fetchCatalog(cfg());
      io.out(`pricing: ${Object.keys(catalog).length} entries (${src})`);
      return 0;
    },
  },
  rankings: {
    summary: "rankings — write rankings-data.json [OUT]",
    status: "ported",
    run: async (_name, io, args, cfg) => {
      const outArg = args[0];
      const c = cfg();
      const nodeReports = resolveNodeReportsDir(c);
      const out = outArg ?? path.join(nodeReports, "rankings-data.json");
      const payload = await collectRankingsAsync({ previous: readPrevious(out) });
      const res = writeArtifact(path.basename(out), payload, { cfg: c, outDir: path.dirname(out) });
      const note = (payload["reason"] ?? (payload["last_error"] as { reason?: string } | undefined)?.reason) as
        string | undefined;
      io.out(`rankings: ${String(payload["status"])}${note ? ` (${note})` : ""} -> ${res.path}`);
      return 0;
    },
  },
  live: {
    summary: "live — write live-data.json",
    status: "ported",
    run: (_name, io, args, cfg) => {
      const outArg = args[0];
      const outDir = outArg ? path.dirname(outArg) : undefined;
      const filename = outArg ? path.basename(outArg) : "live-data.json";
      const payload = buildLive({ cfg: cfg() }) as unknown as Record<string, unknown>;
      const res = writeArtifact(filename, payload, {
        tag: "live",
        cfg: cfg(),
        ...(outDir ? { outDir } : {}),
      });
      const profiles = (payload["profiles"] ?? {}) as Record<string, { live?: unknown[] }>;
      const names = Object.keys(profiles);
      const n = names.reduce(
        (acc, name) => acc + (profiles[name]?.live?.length ?? 0),
        0,
      );
      io.out(`${res.path}  (${names.length} profiles, ${n} live sessions)`);
      return 0;
    },
  },
  transcripts: {
    summary: "transcripts — write transcripts.json [OUT]",
    status: "ported",
    run: (_name, io, args, cfg) => {
      const outArg = args[0];
      const c = cfg();
      const payload = collectTranscripts({ cfg: c });
      const outDir = outArg ? path.dirname(outArg) : undefined;
      const filename = outArg ? path.basename(outArg) : "transcripts.json";
      const res = writeArtifact(filename, payload, { cfg: c, ...(outDir ? { outDir } : {}) });
      const profiles = (payload["profiles"] ?? {}) as Record<string, Record<string, unknown[]>>;
      const n = Object.values(profiles).reduce(
        (acc, sess) => acc + Object.values(sess).reduce((a, m) => a + m.length, 0), 0);
      io.out(`${res.path}  (${Object.keys(profiles).length} profiles, ${n} messages windowed)`);
      return 0;
    },
  },
  "session-timeline": {
    summary: "session-timeline — write sessions/<profile>/<id>.json [OUT_DIR]",
    status: "ported",
    run: (_name, io, args, cfg) => {
      const c = cfg();
      const outDir = args[0] ?? path.join(resolveNodeReportsDir(c), "sessions");
      const n = writeSessionFiles(outDir, { cfg: c });
      io.out(`${outDir}  (${n} session timeline files written)`);
      return 0;
    },
  },
  logs: {
    summary: "logs — write logs-data.json [-o|--out PATH]",
    status: "ported",
    run: (_name, io, args, cfg) => {
      let outArg: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if ((a === "-o" || a === "--out") && i + 1 < args.length) outArg = args[++i];
        else if (a.startsWith("--out=")) outArg = a.slice("--out=".length);
        else {
          io.err(`usage: logs [-o OUT]\nlogs: error: unrecognized arguments: ${a}`);
          return 2;
        }
      }
      const c = cfg();
      const payload = collectLogs({ cfg: c });
      const outDir = outArg ? path.dirname(outArg) : undefined;
      const filename = outArg ? path.basename(outArg) : "logs-data.json";
      const res = writeArtifact(filename, payload, { cfg: c, ...(outDir ? { outDir } : {}) });
      const profiles = (payload["profiles"] ?? {}) as Record<string, { events_shown: number; events_total: number }>;
      const n = Object.values(profiles).reduce((a, p) => a + p.events_shown, 0);
      const t = Object.values(profiles).reduce((a, p) => a + p.events_total, 0);
      io.out(`${res.path}  (${Object.keys(profiles).length} profiles, ${n.toLocaleString("en-US")} of ${t.toLocaleString("en-US")} events, ${(res.bytes / 1048576).toFixed(2)} MB)`);
      return 0;
    },
  },
  probe: {
    summary: "probe — write ollama-data.json",
    status: "ported",
    run: async (_name, io, _args, cfg) => {
      const c = cfg();
      const nodeReports = resolveNodeReportsDir(c);
      assertSafeOutDir(nodeReports, c);
      // Capability lookups are static per model and cached for 24 h, like Python.
      const capsPath = path.join(nodeReports, ".ollama-caps.json");
      let cache: CapsCache = {};
      try {
        cache = JSON.parse(fs.readFileSync(capsPath, "utf8")) as CapsCache;
      } catch { /* no cache yet */ }
      const payload = await collectProbeAsync({ cfg: c, cache });
      const res = writeArtifact("ollama-data.json", payload, { tag: "ollama", cfg: c });
      try {
        fs.writeFileSync(capsPath, JSON.stringify(cache), "utf8");
      } catch { /* best effort, like the Python collector */ }
      const hosts = payload["hosts"] as Array<{ up: boolean }>;
      io.out(`${res.path}  (${String(payload["endpoints"])} endpoints -> ${hosts.length} hosts, ${hosts.filter((h) => h.up).length} up)`);
      return 0;
    },
  },
  analytics: {
    summary: "analytics — write analytics-data.json [-o|--out PATH]",
    status: "ported",
    run: async (_name, io, args, cfg) => {
      // argparse parity for `python -m llm_telemetry.collect_analytics`:
      // -o/--out PATH (also --out=PATH); anything else is a usage error (2).
      let outArg: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if ((a === "-o" || a === "--out") && i + 1 < args.length) outArg = args[++i];
        else if (a.startsWith("--out=")) outArg = a.slice("--out=".length);
        else if (a.startsWith("-o") && a.length > 2 && !a.startsWith("--")) outArg = a.slice(2);
        else {
          io.err(`usage: analytics [-o OUT]\nanalytics: error: unrecognized arguments: ${a}`);
          return 2;
        }
      }
      const c = cfg();
      // Every side file (price caches, bandwidth ledger) and the artifact go
      // to the Node reports dir, never cfg.reports_dir (single-writer rule).
      const nodeReports = resolveNodeReportsDir(c);
      assertSafeOutDir(nodeReports, c);
      const [models, source] = await fetchCatalog(c, { cacheDir: nodeReports });
      const payload = collectAnalytics({
        cfg: c, catalog: { models, source }, reportsDir: nodeReports,
      }) as unknown as Record<string, unknown>;
      const outDir = outArg ? path.dirname(outArg) : undefined;
      const filename = outArg ? path.basename(outArg) : "analytics-data.json";
      const res = writeArtifact(filename, payload, {
        tag: "analytics", cfg: c, ...(outDir ? { outDir } : {}),
      });
      const profiles = (payload["profiles"] ?? {}) as Record<string, { rows?: unknown[] }>;
      const names = Object.keys(profiles);
      const tot = names.reduce((acc, n) => acc + (profiles[n]?.rows?.length ?? 0), 0);
      io.out(`${res.path}  (${names.length} profiles, ${tot} day-rows)`);
      return 0;
    },
  },
  router: {
    summary: "router — write router-data.json [-o|--out PATH]",
    status: "ported",
    run: (_name, io, args, cfg) => {
      let outArg: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const a = args[i]!;
        if ((a === "-o" || a === "--out") && i + 1 < args.length) outArg = args[++i];
        else if (a.startsWith("--out=")) outArg = a.slice("--out=".length);
        else {
          io.err(`usage: router [-o OUT]\nrouter: error: unrecognized arguments: ${a}`);
          return 2;
        }
      }
      const c = cfg();
      const payload = collectRouter({ cfg: c });
      const outDir = outArg ? path.dirname(outArg) : undefined;
      const filename = outArg ? path.basename(outArg) : "router-data.json";
      const res = writeArtifact(filename, payload, {
        tag: "router", cfg: c, ...(outDir ? { outDir } : {}),
      });
      const profiles = (payload["profiles"] ?? {}) as Record<string, { tier_router?: { tiers?: unknown[] } | null }>;
      const names = Object.keys(profiles);
      const tiers = names.reduce((acc, n) => acc + (profiles[n]?.tier_router?.tiers?.length ?? 0), 0);
      io.out(`${res.path}  (${names.length} profiles, ${tiers} router tiers)`);
      return 0;
    },
  },
  quota: {
    summary: "quota — write quota-data.json + quota-history.json [OUT [HISTORY]]",
    status: "ported",
    run: (_name, io, args, cfg) => {
      // Positional like the Python CLI: non-dash args are OUT then HISTORY.
      const pos = args.filter((a) => !a.startsWith("-"));
      const c = cfg();
      const payload = collectQuota({ cfg: c });
      const outDir = pos[0] ? path.dirname(pos[0]) : undefined;
      const filename = pos[0] ? path.basename(pos[0]) : "quota-data.json";
      const res = writeArtifact(filename, payload, { cfg: c, ...(outDir ? { outDir } : {}) });
      const histPath = pos[1] ?? path.join(outDir ?? path.dirname(res.path), HISTORY_NAME);
      assertSafeOutDir(path.dirname(histPath), c);
      const now = Math.trunc(Date.now() / 1000);
      const kept = appendHistory(histPath, historySample(now, payload), now);
      const s = payload["summary"] as Record<string, number>;
      const n = Object.keys(payload["profiles"] as object).length;
      io.out(`${res.path}  (${n} profiles, ${s["providers"]} providers, ` +
        `${s["available"]} available, ${s["attention"]} near limit; history: ${kept} samples)`);
      return 0;
    },
  },
  serve: stub("serve — serve reports/ (replaced by the Next.js app)", "T-19"),
  doctor: stub("doctor — read-only preflight", "T-27"),
  ingest: stub("ingest — ingest PI and Hermes telemetry into the analytics store", "T-18"),
  "ingest-pi": stub("ingest-pi — ingest PI agent sessions into the analytics store", "T-18"),
};

const USAGE = `usage: node cli.js <command>

commands:
${Object.entries(COMMANDS)
  .map(
    ([name, c]) =>
      `  ${name.padEnd(16)} ${c.summary}${c.status === "stub" ? ` [not yet ported: ${c.ticket}]` : ""}`,
  )
  .join("\n")}
`;

/** Dispatch. Returns the process exit code (argparse parity: 2 for usage). */
export function runCli(
  argv: string[],
  io: CliIo = stdIo,
  cfg: () => Config = getConfig,
): number | Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === "-h" || name === "--help") {
    if (name) io.out(USAGE);
    else io.err(USAGE);
    return name ? 0 : 2;
  }
  const cmd = COMMANDS[name];
  if (!cmd) {
    io.err(`llm-telemetry(node): unknown command '${name}' (see --help)`);
    return 2;
  }
  return cmd.run(name, io, rest, cfg);
}

const self = fileURLToPath(import.meta.url);
const invoked = process.argv[1] ? resolvePath(process.argv[1]) : null;

if (invoked && invoked === self) {
  void Promise.resolve(runCli(process.argv.slice(2))).then((code) => process.exit(code));
}
