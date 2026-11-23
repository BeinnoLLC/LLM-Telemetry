/** Node-side producer — T-5 (LLMTELEMET-284).
 *
 * Runs the fixture through the REAL T-4 collector platform write path
 * (`packages/collectors/src/artifactWriter.ts`): schema_version stamp, schema
 * check at write time, atomic `<path>.tmp` + rename, Python-identical JSON
 * serialization. Every ported collector goes out through this exact function,
 * so a green parity run proves the shared write path, not a harness-local
 * imitation of it.
 */

import "./schemaDir.js"; // must load before the T-4 platform (see schemaDir.ts)
import { readFileSync } from "node:fs";
import { writeArtifact } from "../src/artifactWriter.js";
import { Config } from "../src/config.js";
import type { SchemaTag } from "../src/schemaCheck.js";

export interface ProduceResult {
  path: string;
  bytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CollectorFn = () => Record<string, unknown> | Promise<Record<string, unknown>>;

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>).then === "function";
}

/** Load `fixturePath`, stamp + schema-check + write it into `outDir` through
 * the T-4 platform. Collectors that must await I/O (buildCosts) go through the
 * Promise overload; existing sync cases keep the same sync signature. */
export function produce(
  fixturePath: string,
  outDir: string,
  artifact: string,
  tag: SchemaTag | null,
  collector?: () => Record<string, unknown>,
): ProduceResult;
export function produce(
  fixturePath: string,
  outDir: string,
  artifact: string,
  tag: SchemaTag | null,
  collector: () => Promise<Record<string, unknown>>,
): Promise<ProduceResult>;
export function produce(
  fixturePath: string,
  outDir: string,
  artifact: string,
  tag: SchemaTag | null,
  collector: CollectorFn | undefined,
): ProduceResult | Promise<ProduceResult>;
export function produce(
  fixturePath: string,
  outDir: string,
  artifact: string,
  tag: SchemaTag | null,
  collector?: CollectorFn,
): ProduceResult | Promise<ProduceResult> {
  const write = (parsed: unknown): ProduceResult => {
    if (!isRecord(parsed)) {
      throw new Error(`fixture root must be a JSON object: ${fixturePath}`);
    }
    // A bare Config has no filesystem side effects (T-4 port deliberately does
    // not mkdir) and keeps the single-writer guard pointed at the real Python
    // reports dirs while we write into parity/out/node/… .
    const cfg = new Config();
    return writeArtifact(artifact, parsed, { outDir, tag: tag ?? undefined, cfg });
  };
  if (!collector) return write(JSON.parse(readFileSync(fixturePath, "utf8")));
  const parsed = collector();
  return isPromise(parsed) ? parsed.then(write) : write(parsed);
}
