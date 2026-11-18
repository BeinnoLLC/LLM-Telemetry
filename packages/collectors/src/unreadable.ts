/** Port of `collect_analytics.unreadable` (P5-04): why a profile's state.db
 * cannot be read, or null if it can. The text is `<PythonExceptionName>: <msg>`
 * so the failure report is identical to the Python producer's. */

import { DatabaseSync } from "node:sqlite";

/** Python's sqlite3 exception class for a primary SQLite result code
 * (Modules/_sqlite/util.c `_pysqlite_seterror`). Anything unlisted is
 * DatabaseError, as in CPython. */
export function pySqliteErrorName(errcode: number | undefined): string {
  const primary = (errcode ?? 1) & 0xff;
  switch (primary) {
    case 2: case 12: return "InternalError"; // INTERNAL, NOTFOUND
    case 7: return "MemoryError"; // NOMEM
    case 1: case 3: case 4: case 5: case 6: case 8: case 9: case 10: case 13:
    case 14: case 15: case 16: case 17: // ERROR..SCHEMA
      return "OperationalError";
    case 11: return "DatabaseError"; // CORRUPT
    case 18: return "DataError"; // TOOBIG
    case 19: case 20: return "IntegrityError"; // CONSTRAINT, MISMATCH
    case 21: return "ProgrammingError"; // MISUSE
    default: return "DatabaseError";
  }
}

export function unreadable(db: string): string | null {
  try {
    const con = new DatabaseSync(db, { readOnly: true });
    try {
      con.prepare("select 1 from session_model_usage limit 1").all();
    } finally {
      con.close();
    }
  } catch (e) {
    const err = e as { errcode?: number; message?: string };
    return `${pySqliteErrorName(err.errcode)}: ${err.message ?? String(e)}`;
  }
  return null;
}
