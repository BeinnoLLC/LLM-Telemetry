/** Node-side DB sidecar for the ingest parity case — T-18 (LLMTELEMET-289).
 *
 * Runs the real `ingestAll.main` against the same synthetic HOME the Python
 * producer used, into a shadow `analytics-node.db`, then dumps every table
 * from sqlite_master: name, SQL text and all rows ordered by primary key.
 * The wall-clock `created_at` column is the only field removed — row payload
 * text is compared verbatim. No Python source is touched here.
 */

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { main as ingestMain } from "../src/ingestAll.js";

let run = 0;

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** SELECT * for every table, ordered by primary key (rowid when none), with
 * only the wall-clock created_at column dropped. */
export function dumpIngestDb(dbPath: string): Record<string, unknown> {
  const con = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const names = (
      con.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
    ).map((row) => row.name);
    const tables = names.map((name) => {
      const sqlRow = con.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(name) as { sql: string };
      const info = con.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as Array<{ name: string; pk: number }>;
      const pks = info.filter((col) => col.pk).map((col) => col.name);
      const orderBy = pks.length > 0 ? pks.map(quoteIdent).join(", ") : "rowid";
      const rows = (
        con.prepare(`SELECT * FROM ${quoteIdent(name)} ORDER BY ${orderBy}`).all() as Array<Record<string, unknown>>
      ).map((row) => {
        const copy = { ...row };
        delete copy["created_at"];
        return copy;
      });
      return { name, sql: sqlRow.sql, rows };
    });
    return { tables };
  } finally {
    con.close();
  }
}

/** Run the Node ingest main on the generated inputs; return its DB sidecar. */
export function runNodeIngest(inputsDir: string): Record<string, unknown> {
  const outDir = join(inputsDir, "node-db");
  mkdirSync(outDir, { recursive: true });
  // The global store is "first path wins"; a unique path means a repeated
  // parity run in the same process never reuses a stale connection.
  const dbPath = join(outDir, `analytics-node-${process.pid}-${++run}.db`);
  rmSync(dbPath, { force: true });

  const savedHome = process.env["HOME"];
  const lines: string[] = [];
  process.env["HOME"] = join(inputsDir, "home");
  try {
    const status = ingestMain(["--db", dbPath], { out: (line) => void lines.push(line), err: () => {} });
    if (status !== 0) {
      throw new Error(`node ingest main exited ${status}: ${lines.join("\n")}`);
    }
  } finally {
    if (savedHome === undefined) delete process.env["HOME"];
    else process.env["HOME"] = savedHome;
  }
  return dumpIngestDb(dbPath);
}
