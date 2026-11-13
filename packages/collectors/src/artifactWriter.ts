/** Atomic artifact writer — T-4 (LST-283).
 *
 * Every collector payload goes out through here so the overlap guarantee of
 * docs/plans/node-nextjs-migration.md §4 holds: temp file + rename (same
 * `<path>.tmp` convention the Python collectors use, e.g. collect_live.py's
 * `__main__`), `schema_version` stamped, and schema-checked at write time so a
 * shape the page cannot read is never written (P1-02: Python's `check()` runs
 * before `os.replace`; this port refuses to write a failing payload and leaves
 * any previous artifact intact).
 *
 * Single-writer rule (plan §13): during the overlap the Node side writes to a
 * SEPARATE output dir (resolveNodeReportsDir, default `…/reports-node`) and
 * this module refuses the Python reports dir and `~/.hermes/reports` outright
 * unless LLM_TELEMETRY_SHARED_REPORTS=1 — the deliberate cutover switch (plan
 * §12 step 2). Nothing here ever overwrites a Python artifact by accident.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import { join, resolve } from "node:path";
import { expand, get as getConfig, resolveNodeReportsDir, type Config } from "./config.js";
import { check, type SchemaTag } from "./schemaCheck.js";
import { stamp } from "./schema.js";

export class ArtifactWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactWriteError";
  }
}

function samePath(a: string, b: string): boolean {
  return resolve(a) === resolve(b);
}

/** Refuse output dirs that belong to the Python stack. Checked BEFORE any
 * filesystem side effect, so a refused write touches nothing. */
export function assertSafeOutDir(outDir: string, cfg?: Config): void {
  if (process.env["LLM_TELEMETRY_SHARED_REPORTS"] === "1") return; // cutover switch
  const c = cfg ?? getConfig();
  const forbidden = [c.reports_dir, expand("~/.hermes/reports")];
  for (const dir of forbidden) {
    if (samePath(outDir, dir)) {
      throw new ArtifactWriteError(
        `refusing to write into ${resolve(outDir)}: that is a Python-stack ` +
          `reports dir (single-writer rule, migration plan §13). Point ` +
          `LLM_TELEMETRY_NODE_REPORTS_DIR at a separate dir; set ` +
          `LLM_TELEMETRY_SHARED_REPORTS=1 only at cutover (plan §12).`,
      );
    }
  }
}

export interface WriteOptions {
  /** Output dir; defaults to resolveNodeReportsDir() (non-production). */
  outDir?: string;
  /** When given, validate against this payload schema before writing. */
  tag?: SchemaTag;
  cfg?: Config;
}

export interface WriteResult {
  path: string;
  bytes: number;
}

/** Stamp `payload` (mutates in place, like Python's `stamp()`), optionally
 * schema-check it, and write it atomically. Returns the artifact path. */
export function writeArtifact(
  filename: string,
  payload: Record<string, unknown>,
  opts: WriteOptions = {},
): WriteResult {
  const outDir = opts.outDir ?? resolveNodeReportsDir(opts.cfg);
  assertSafeOutDir(outDir, opts.cfg);
  const stamped = stamp(payload);
  if (opts.tag) check(opts.tag, stamped); // before ANY write, like Python

  fs.mkdirSync(outDir, { recursive: true });
  const target = join(outDir, filename);
  const tmp = target + ".tmp"; // the Python collectors' convention
  try {
    // Compact separators + Date->string replacer: parity with the Python
    // collectors' json.dump(..., separators=(",", ":"), default=str).
    const text = JSON.stringify(stamped, (_k, v: unknown) =>
      v instanceof Date ? String(v) : v,
    );
    fs.writeFileSync(tmp, text, "utf8");
    fs.renameSync(tmp, target); // atomic on the same filesystem
    return { path: target, bytes: Buffer.byteLength(text) };
  } catch (err) {
    // A failed write must leave the previous artifact (and the dir) clean.
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* tmp never existed */
    }
    throw err;
  }
}

/** For tests: a scratch root that never lands in /tmp unless asked. */
export function testScratchRoot(): string {
  return (
    process.env["LLM_TELEMETRY_TEST_TMP"] ??
    join(os.tmpdir(), "llm-telemetry-collectors-tests")
  );
}
