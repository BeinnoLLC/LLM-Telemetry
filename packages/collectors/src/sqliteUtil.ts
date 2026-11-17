import { DatabaseSync } from "node:sqlite";

/** Row values in column order, like Python's tuple rows. */
export function tuples(con: DatabaseSync, sql: string, ...params: (string | number)[]): unknown[][] {
  const stmt = con.prepare(sql);
  stmt.setReturnArrays(true);
  return stmt.all(...params) as unknown as unknown[][];
}
