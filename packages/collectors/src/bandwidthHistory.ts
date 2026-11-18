/** Port of `bandwidth_history.py` (P8-04): persisted daily bandwidth ledger. */

import * as fs from "node:fs";
import { join } from "node:path";
import { BYTES_PER_TOKEN } from "./bandwidth.js";
import { SCHEMA_VERSION } from "./schema.js";
import { cmpStr, dumpsSorted } from "./pySort.js";

export const LEDGER_NAME = "bandwidth-history.json";
const KEY = ["profile", "date", "provider", "model"] as const;
const TOKEN_KEYS = ["input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "calls"] as const;

export type Row = Record<string, unknown>;

const str = (v: unknown): string => (v ? String(v) : "");
const int = (v: unknown): number => Math.trunc(Number(v || 0));
/** Python tuple-of-strings ordering. */
function cmpKey(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = cmpStr(a[i] as string, b[i] as string);
    if (d !== 0) return d;
  }
  return 0;
}
/** Group key. JSON of the tuple is unambiguous. */
const keyOf = (r: Row): string[] => KEY.map((k) => str(r[k]));
const sortedEntries = <T>(m: Map<string, [string[], T]>): T[] =>
  [...m.values()].sort((a, b) => cmpKey(a[0], b[0])).map((e) => e[1]);

export function rollup(profile: string, rows: Row[]): Row[] {
  const agg = new Map<string, [string[], Row]>();
  for (const r of rows) {
    const k = [profile, str(r["date"]), str(r["provider"]), str(r["model"])];
    const id = JSON.stringify(k);
    let e = agg.get(id);
    if (!e) {
      e = [k, {
        profile: k[0], date: k[1], provider: k[2], model: k[3],
        up_bytes: 0, down_bytes: 0, lan_up_bytes: 0, lan_down_bytes: 0,
        input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, calls: 0,
      }];
      agg.set(id, e);
    }
    const o = e[1];
    const add = (dst: string, src: string): void => { o[dst] = (o[dst] as number) + int(r[src]); };
    add("up_bytes", "up_bytes"); add("down_bytes", "down_bytes");
    add("lan_up_bytes", "lan_up_bytes"); add("lan_down_bytes", "lan_down_bytes");
    add("input_tokens", "inp"); add("cache_read_tokens", "cread");
    add("cache_write_tokens", "cwrite"); add("output_tokens", "outp"); add("calls", "calls");
  }
  return sortedEntries(agg);
}

/** Read the ledger rows; a missing/unreadable file is []; a schema mismatch
 * renames the file to `<path>.v<N>.bak` and returns []. */
export function load(path: string): Row[] {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(fs.readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (d["schema_version"] !== SCHEMA_VERSION) {
    try {
      fs.renameSync(path, `${path}.v${String(d["schema_version"] ?? "None")}.bak`);
    } catch {
      /* best effort, like Python */
    }
    return [];
  }
  return (d["rows"] as Row[] | undefined) || [];
}

export function merge(existing: Row[], fresh: Row[], today: string, bpt: number = BYTES_PER_TOKEN): Row[] {
  const out = new Map<string, [string[], Row]>();
  for (const r of existing) out.set(JSON.stringify(keyOf(r)), [keyOf(r), r]);
  for (const r of fresh) {
    const k = keyOf(r);
    const id = JSON.stringify(k);
    const old = out.get(id)?.[1];
    if (old !== undefined && old["frozen"]) {
      for (const tk of TOKEN_KEYS) if (!(tk in old) && tk in r) old[tk] = r[tk];
      continue;
    }
    out.set(id, [k, { ...r, bytes_per_token: bpt, frozen: (r["date"] as string) < today }]);
  }
  for (const [, r] of out.values()) {
    if (!r["frozen"] && str(r["date"]) < today) r["frozen"] = true;
  }
  return sortedEntries(out);
}

export function save(path: string, rows: Row[]): void {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, dumpsSorted({ schema_version: SCHEMA_VERSION, rows }), "utf8");
  fs.renameSync(tmp, path);
}

export function localToday(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function update(
  reportsDir: string,
  perProfileRows: Record<string, Row[]>,
  today: string = localToday(),
): Record<string, Row[]> {
  const path = join(reportsDir, LEDGER_NAME);
  const fresh = Object.entries(perProfileRows).flatMap(([name, rows]) => rollup(name, rows));
  const rows = merge(load(path), fresh, today);
  save(path, rows);
  const by: Record<string, Row[]> = {};
  for (const r of rows) {
    const { profile, ...rest } = r;
    (by[profile as string] ??= []).push(rest);
  }
  return by;
}
