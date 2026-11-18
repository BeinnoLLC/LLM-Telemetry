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

import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { get as getConfig, resolveNodeReportsDir, type Config } from "./config.js";
import { assertSafeOutDir, writeArtifact } from "./artifactWriter.js";
import { buildLive } from "./collectLive.js";
import { collectAnalytics } from "./collectAnalytics.js";
import { fetchCatalog } from "./pricingFetch.js";

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
  costs: stub("costs — write costs-data.json", "T-17"),
  pricing: stub("pricing — refresh the OpenRouter price catalogue cache", "T-17"),
  rankings: stub("rankings — write rankings-data.json", "T-16"),
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
  transcripts: stub("transcripts — write transcripts.json", "T-16"),
  "session-timeline": stub("session-timeline — write sessions/<profile>/<id>.json", "T-16"),
  logs: stub("logs — write logs-data.json", "T-16"),
  probe: stub("probe — write ollama-data.json", "T-16"),
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
  router: stub("router — write router-data.json", "T-16"),
  quota: stub("quota — write quota-data.json + history", "T-16"),
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
