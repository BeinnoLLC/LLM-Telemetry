#!/usr/bin/env python3
"""Python-side producer for the ingest parity case (T-18, LLMTELEMET-289).

Usage: produce_ingest.py INPUTS_DIR OUT_DIR ARTIFACT

Points HOME at the generated synthetic tree, runs the real Python
`llm_telemetry.ingest_all.main` into a scratch SQLite database, then dumps
every table to a sidecar artifact: table name, `sqlite_master.sql` and all
rows from `SELECT *` ordered by primary key. The wall-clock `created_at`
column is the only field removed; row payload text is compared verbatim.
"""
import json
import os
import sqlite3
import sys


def quote_ident(name):
    return '"' + name.replace('"', '""') + '"'


def dump_tables(db_path):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        names = [
            row["name"]
            for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
            ).fetchall()
        ]
        tables = []
        for name in names:
            sql = con.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)
            ).fetchone()["sql"]
            info = con.execute("PRAGMA table_info(%s)" % quote_ident(name)).fetchall()
            pks = [row["name"] for row in info if row["pk"]]
            if pks:
                order_by = ", ".join(quote_ident(col) for col in pks)
            else:
                order_by = "rowid"
            rows = [
                {key: value for key, value in dict(row).items() if key != "created_at"}
                for row in con.execute(
                    "SELECT * FROM %s ORDER BY %s" % (quote_ident(name), order_by)
                ).fetchall()
            ]
            tables.append({"name": name, "sql": sql, "rows": rows})
        return {"tables": tables}
    finally:
        con.close()


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: produce_ingest.py INPUTS_DIR OUT_DIR ARTIFACT\n")
        return 2
    inputs, out_dir, artifact = (os.path.abspath(argv[0]), argv[1], argv[2])
    os.environ["HOME"] = os.path.join(inputs, "home")

    from llm_telemetry.ingest_all import main as ingest_main
    from llm_telemetry.schema import stamp

    os.makedirs(out_dir, exist_ok=True)
    db_path = os.path.join(out_dir, "analytics.db")
    if os.path.exists(db_path):
        os.remove(db_path)
    status = ingest_main(["--db", db_path])
    if status != 0:
        return status

    data = stamp(dump_tables(db_path))
    target = os.path.join(out_dir, artifact)
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"), default=str)
    os.replace(tmp, target)
    sys.stdout.write(target + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
