#!/usr/bin/env python3
"""Log events for the full Logs page, with facets computed over the whole window.

The drawer answers "what is happening right now" from 80 live rows. This answers
"find me the thing that happened" across every session in the window, which is a
different query and needs its own payload.

THE SIZE PROBLEM, stated plainly: 24h of messages is ~180,000 rows and ~34 MB of
JSON. This project ships one self-contained HTML file (ADR 0001) with no server
API, so embedding the lot is not an option — it would be a 34 MB page that takes
seconds to parse.

So events are CAPPED at the newest `cap` rows, but every facet count (per tool,
per role, per session, per kind) is computed over the FULL window in SQL. The
filter chips therefore show true totals even when the event list is a slice, and
the payload records `events_total` vs `events_shown` so the UI can say so instead
of quietly implying the cap is the whole story.

Two sources are merged: `messages` (what the agent did) and errors.log via
`failures.parse` (what went wrong). Only the latter has a real severity — the
messages table carries no error signal, so nothing here guesses one from text.
"""
import os
import sqlite3
import time

from . import failures as F
from .schema import stamp

# A preview long enough to recognise a line, short enough that 5k of them stay
# under a megabyte. Measured: 120 chars -> ~0.83 MB at the default cap.
PREVIEW = 120
DEFAULT_WINDOW_H = 24
DEFAULT_CAP = 5000

EVENTS = """
select m.timestamp, m.session_id, coalesce(s.title, s.display_name, ''),
       m.role, coalesce(m.tool_name,''), coalesce(s.model,''),
       substr(coalesce(m.content,''), 1, ?)
from messages m left join sessions s on s.id = m.session_id
where m.timestamp > ?
order by m.timestamp desc
limit ?
"""
EVENT_COLS = "ts session title role tool model preview".split()

# Facets over the WHOLE window, not the capped slice.
FACETS = {
    "tool": "select coalesce(tool_name,''), count(*) from messages "
            "where timestamp > ? and coalesce(tool_name,'') <> '' group by 1 order by 2 desc",
    "role": "select role, count(*) from messages where timestamp > ? group by 1 order by 2 desc",
    "model": "select coalesce(s.model,''), count(*) from messages m "
             "left join sessions s on s.id = m.session_id "
             "where m.timestamp > ? and coalesce(s.model,'') <> '' group by 1 order by 2 desc",
}
SESSION_FACET = """
select m.session_id, coalesce(s.title, s.display_name, ''), count(*)
from messages m left join sessions s on s.id = m.session_id
where m.timestamp > ? group by 1, 2 order by 3 desc limit 200
"""


def _errors(cutoff, profile=None):
    """Failure lines from errors.log, newest first, as log events.

    These are the only entries with a genuine severity: failures.classify()
    reads the log's own wording. Message rows get level 'info' because the
    messages table records no outcome — inventing one from the text is exactly
    the mistake that made the tool-failure heuristic report 41% where the
    runtime measured 0.1%.
    """
    out = []
    for prof, path in F.LOGS.items():
        if profile and prof != profile:
            continue
        if not path or not os.path.exists(path):
            continue
        try:
            _stats, events = F.parse(path, since_days=7)
        except Exception:
            continue
        for e in events:
            try:
                ts = time.mktime(time.strptime(e["when"][:19], "%Y-%m-%d %H:%M:%S"))
            except (ValueError, TypeError):
                continue
            if ts < cutoff:
                continue
            out.append({
                "ts": ts, "session": "", "title": "", "role": "error",
                "tool": "", "model": e.get("model", ""), "level": "error",
                "kind": e.get("kind", ""), "preview": (e.get("msg") or "")[:PREVIEW],
            })
    return out


def collect(conn, window_h=DEFAULT_WINDOW_H, cap=DEFAULT_CAP, profile=None):
    """-> payload for the Logs page, or None when the window is empty."""
    cutoff = time.time() - window_h * 3600
    try:
        rows = conn.execute(EVENTS, (PREVIEW, cutoff, cap)).fetchall()
    except sqlite3.OperationalError as e:
        if "no such table" in str(e).lower():
            return None
        raise

    events = []
    for r in rows:
        d = dict(zip(EVENT_COLS, r))
        d["ts"] = float(d["ts"] or 0)
        # No severity is invented for message rows: the table has no outcome
        # column, so everything here is 'info' and errors come from errors.log.
        d["level"] = "info"
        d["kind"] = ""
        events.append(d)

    errs = _errors(cutoff, profile)
    events.extend(errs)
    events.sort(key=lambda e: e["ts"], reverse=True)

    total, = conn.execute(
        "select count(*) from messages where timestamp > ?", (cutoff,)).fetchone()

    facets = {}
    for name, sql in FACETS.items():
        facets[name] = [{"v": v, "n": n} for v, n in conn.execute(sql, (cutoff,)) if v]
    facets["session"] = [{"v": sid, "label": title or sid[:8], "n": n}
                         for sid, title, n in conn.execute(SESSION_FACET, (cutoff,))]
    if errs:
        kinds = {}
        for e in errs:
            kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
        facets["kind"] = [{"v": k, "n": n}
                          for k, n in sorted(kinds.items(), key=lambda x: -x[1]) if k]

    if not events:
        return None
    return {
        "events": events,
        "window_h": window_h,
        # events_total counts the window; len(events) is what shipped. The UI
        # must say "showing X of Y" rather than implying the cap is the truth.
        "events_total": total + len(errs),
        "events_shown": len(events),
        "errors_shown": len(errs),
        "capped": total > cap,
        "cap": cap,
        "facets": facets,
        "generated": time.time(),
    }


def build():
    """Every profile -> {profiles: {name: payload}}, for logs-data.json."""
    from .config import get as _cfg

    cfg = _cfg()
    out = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"), "profiles": {}}
    for prof in cfg.live_profiles():
        db = prof.db
        if not os.path.exists(db):
            continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            payload = collect(con, profile=prof.name)
        finally:
            con.close()
        if payload:
            out["profiles"][prof.name] = payload
    return stamp(out)


if __name__ == "__main__":
    import argparse
    import json

    from .config import get as _cfg

    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out",
                    default=str(_cfg().reports_dir / "logs-data.json"))
    a = ap.parse_args()
    data = build()
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    os.replace(tmp, a.out)
    n = sum(p["events_shown"] for p in data["profiles"].values())
    t = sum(p["events_total"] for p in data["profiles"].values())
    sz = os.path.getsize(a.out) / 1048576
    print(f"{a.out}  ({len(data['profiles'])} profiles, {n:,} of {t:,} events, {sz:.2f} MB)")
