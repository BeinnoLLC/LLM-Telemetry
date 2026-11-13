#!/usr/bin/env python3
"""Hive collector (LST-268, H-1): the data half of the standalone Hive app.

Ported from the read-only source of truth ``hive/server.py`` as pure, stdlib-only
functions. ``collect()`` returns one JSON-serialisable snapshot of every family
(assistant -> brains -> agents), the live sub-agent processes on this host (and
optional ssh hosts), derived pressure scores, recent assistant/brain
communication, and the Hazem<->assistant conversation state.

Everything is read-only and real: files, sqlite databases (``mode=ro``) and
/proc. A source that cannot be read is reported (``errors`` / offline host),
never simulated. No HTTP serving here; that is H-2.
"""
from __future__ import annotations

import collections
import glob
import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path

from .schema import stamp

ACTIVE = {"running", "ready", "todo", "blocked", "review", "scheduled", "triage"}
FAMILY_ORDER = ["root", "pixelvent", "acasia", "somethingpressing"]
COUNT_STATUSES = ("running", "todo", "ready", "blocked", "review", "done")
LABELS = {"nowinv": "NowInv", "llm-telemetry": "LLM Telemetry", "unraid-contributions": "Unraid",
          "beinno-launchpad": "Launchpad", "intelli-draft": "IntelliDraft", "groveos": "GroveOS",
          "pixelvent-launchpad": "PV Launchpad", "acasia": "HQ", "ai-compute": "AI Compute"}
COMM_WINDOW = 12 * 3600
SEND_WINDOW, REPLY_WINDOW, RECENT_USER, STREAM_FRESH = 8.0, 6.0, 120.0, 30.0
SCAN_TIMEOUT = 12.0

SECRET = re.compile(r"(?i)(sk-[\w-]{16,}|gh[pousr]_\w{20,}|AIza[\w-]{20,}|xox[bap]-[\w-]{10,}|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+)")
EVENT_KINDS = {"completed": "done", "blocked": "blocked", "crashed": "crashed", "gave_up": "gave_up",
               "timed_out": "timed_out", "worker_lost": "crashed", "spawned": "spawned", "unblocked": "unblocked"}
INJECT_RE = re.compile(r"^\s*\[(?:IMPORTANT:|CONTEXT COMPACTION|Cronjob|From |Message from|SYSTEM)")
CLARIFY_RE = re.compile(r"(?i)\b(shall i|do you want|would you like|should i|can you (?:confirm|check|proceed)"
                        r"|let me know|which (?:one|approach|option|route|plan|order)"
                        r"|need.{0,24}clarif|clarif\w* (?:on|about|before)|any (?:preference|objection))")


def default_home():
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")


# ---------------- roster: fleet specs ----------------

def pretty(name):
    if name in LABELS:
        return LABELS[name]
    n = name.replace("-brain", "").replace("acasia-", "").replace("pv-", "").replace("beinno-", "")
    return " ".join(w.capitalize() if len(w) > 2 else w.upper() for w in n.split("-"))


def _scalar(v):
    v = v.split(" #", 1)[0].strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        v = v[1:-1]
    return v


def _flow_pairs(body):
    """Split the inside of a ``{...}`` flow mapping into (key, value) pairs; commas and
    colons inside single/double quotes (or nested braces/brackets) do not split."""
    parts, buf, quote, depth = [], [], None, 0
    for ch in body:
        if quote:
            buf.append(ch)
            if ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            buf.append(ch)
        elif ch in "{[":
            depth += 1
            buf.append(ch)
        elif ch in "}]":
            depth -= 1
            buf.append(ch)
        elif ch == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
    parts.append("".join(buf))
    pairs = []
    for part in parts:
        quote, idx = None, -1
        for i, ch in enumerate(part):
            if quote:
                quote = None if ch == quote else quote
            elif ch in "'\"":
                quote = ch
            elif ch == ":" and (i + 1 == len(part) or part[i + 1] in " \t"):
                idx = i
                break
        if idx > 0:
            pairs.append((_scalar(part[:idx]), part[idx + 1:].strip()))
    return pairs


def _flow_map(line):
    """Parse ``{k: v, ...}`` into a dict, or None when ``line`` is not a flow mapping."""
    line = line.strip()
    if line.startswith("{") and "}" in line:
        line = line[:line.rindex("}") + 1]  # drop a trailing "# comment"
    if not (line.startswith("{") and line.endswith("}")):
        return None
    return {k: v for k, v in _flow_pairs(line[1:-1])}


def _typed(val):
    val = _scalar(val)
    return (val.lower() == "true") if val.lower() in ("true", "false") else val


def parse_fleet_spec(text):
    """Minimal reader for the fleet YAML subset Hive needs (no PyYAML): top-level scalars,
    the ``orchestrators:`` list of flat mappings, and ``bots:`` -> name -> display."""
    spec, orch, bots = {}, [], {}
    section, cur_bot = None, None
    for raw in text.splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip())
        line = raw.strip()
        if indent == 0:
            section, cur_bot = None, None
            k, _, v = line.partition(":")
            if k in ("orchestrators", "bots"):
                section = k
            elif v.strip():
                spec[k] = _scalar(v)
            continue
        if section == "orchestrators":
            if line.startswith("- "):
                orch.append({})
                line = line[2:].strip()
                flow = _flow_map(line)
                if flow is not None:
                    orch[-1].update({k: _typed(v) for k, v in flow.items() if v})
                    continue
            if orch and ":" in line and indent <= 4 + (2 if raw.lstrip().startswith("- ") else 0):
                k, _, v = line.partition(":")
                if v.strip() and not v.strip().startswith(("&", "|", ">")):
                    val = _scalar(v)
                    orch[-1][k.strip()] = (val.lower() == "true") if val.lower() in ("true", "false") else val
        elif section == "bots":
            if indent == 2 and line.endswith(":"):
                cur_bot = line[:-1].strip()
                bots[cur_bot] = {}
            elif indent == 4 and cur_bot and line.startswith("display:"):
                bots[cur_bot]["display"] = _scalar(line.split(":", 1)[1])
    spec["orchestrators"], spec["bots"] = orch, bots
    return spec


def load_families(home=None):
    """[{id, label, assistant:{id,label}, brains:[(profile, board, label)], bots:[(id,label)]}]."""
    home = Path(home) if home else default_home()
    fleet, profiles = home / "fleet", home / "profiles"
    files = sorted(fleet.glob("*.yaml"),
                   key=lambda p: (FAMILY_ORDER.index(p.stem) if p.stem in FAMILY_ORDER else 99, p.stem))
    fams = []
    for f in files:
        try:
            spec = parse_fleet_spec(f.read_text())
        except Exception:
            continue
        orch = spec.get("orchestrators") or []
        asst = next((o for o in orch if o.get("assistant")), None)
        if not asst or not asst.get("name"):
            continue
        brains = []
        for o in orch:
            if o.get("assistant") or not o.get("name"):
                continue
            board = o.get("board") or o.get("project")
            brains.append((o["name"], board, o.get("display") or pretty(o.get("project") or o["name"])))
        pre = spec.get("prefix") or f.stem
        bots = [(f"{pre}-{k}", v.get("display") or k) for k, v in (spec.get("bots") or {}).items()
                if (profiles / f"{pre}-{k}").is_dir()]
        fid = spec.get("family") or f.stem
        fams.append({"id": fid, "bots": bots, "label": asst.get("family_title") or fid.capitalize(),
                     "assistant": {"id": asst["name"], "label": asst.get("display") or pretty(asst["name"])},
                     "brains": brains})
    return fams


# ---------------- kanban boards ----------------

def _ro(db, timeout=5):
    return sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=timeout)


def read_board(home, board):
    """Non-archived tasks of one board; [] if absent, None if unreadable."""
    db = Path(home) / "kanban" / "boards" / str(board) / "kanban.db"
    if not db.exists():
        return []
    try:
        c = _ro(db)
        try:
            rows = c.execute("select id, title, assignee, status from tasks where status != 'archived'").fetchall()
        finally:
            c.close()
        return [{"id": r[0], "title": r[1], "assignee": r[2], "status": r[3]} for r in rows]
    except Exception:
        return None


def clean(text, n=280):
    t = SECRET.sub("[redacted]", " ".join((text or "").split()))
    t = re.sub(r"^\[(?:From|Message from)[^\]]*\]\s*", "", t)
    return t[:n] + ("…" if len(t) > n else "")


# ---------------- communication feed ----------------

def _bot_chat(home, cut):
    out = []
    for f in glob.glob(str(Path(home) / "profiles" / "*" / "runtime" / "bot_live_delivery" / "*.json")):
        try:
            at = os.path.getmtime(f)
            if at < cut:
                continue
            d = json.loads(Path(f).read_text())
        except Exception:
            continue
        to = Path(d.get("profile_home") or f).name if d.get("profile_home") else Path(f).parents[2].name
        a = d.get("author") or {}
        frm = (a.get("name") if isinstance(a, dict) else None) or "hazem"
        msg = d.get("message") or ""
        if msg.startswith("[Cronjob") or msg.startswith("[IMPORTANT: Background"):
            frm = "cron" if msg.startswith("[Cronjob") else "system"
        cid = str(d.get("delivery_id", f))[:16]
        out.append({"id": "bc:" + cid, "at": at - 1, "from": frm, "to": to, "kind": "ask", "via": "bot chat", "text": clean(msg)})
        if d.get("reply"):
            out.append({"id": "bc:" + cid + ":r", "at": at, "from": to, "to": frm, "kind": "reply", "via": "bot chat", "text": clean(d["reply"])})
        elif d.get("status") not in ("settled", "failed", "cancelled"):
            out[-1]["pending"] = True
    return out


def _brain_lines(home, cut):
    lines = Path(home) / "state" / "brain-lines"
    out = []
    for q in glob.glob(str(lines / "*" / "runs" / "*.query.txt")):
        try:
            at = os.path.getmtime(q)
            if at < cut:
                continue
            asst = Path(q).parents[1].name
            stem = Path(q).name[:-len(".query.txt")]
            brain = re.sub(r"-\d{8}-\d{6}$", "", stem)
            out.append({"id": "bl:" + asst + ":" + stem, "at": at, "from": asst, "to": brain, "kind": "ask", "via": "line",
                        "text": clean(Path(q).read_text(errors="replace"))})
            log = Path(q[:-len(".query.txt")] + ".log")
            meta = {}
            try:
                meta = json.loads((lines / asst / f"{brain}.json").read_text())
            except Exception:
                pass
            running = meta.get("status") == "running" and meta.get("query") == q
            if log.exists() and not running:
                body = [ln for ln in log.read_text(errors="replace").splitlines()
                        if ln.strip() and not ln.startswith("↻ Resumed") and not ln.startswith("session_id:")]
                if body:
                    out.append({"id": "bl:" + asst + ":" + stem + ":r", "at": os.path.getmtime(log), "from": brain, "to": asst,
                                "kind": "reply", "via": "line", "text": clean(" ".join(body))})
            elif running:
                out[-1]["pending"] = True
        except Exception:
            continue
    return out


def _board_comms(home, board, brain, cut):
    db = Path(home) / "kanban" / "boards" / str(board) / "kanban.db"
    if not db.exists():
        return []
    out = []
    try:
        c = _ro(db)
        try:
            titles = dict(c.execute("select id, title from tasks"))
            who = dict(c.execute("select id, assignee from tasks"))
            for i, tid, author, body, at in c.execute(
                    "select id, task_id, author, body, created_at from task_comments where created_at > ? order by id desc limit 40", (cut,)):
                out.append({"id": f"cm:{board}:{i}", "at": at, "from": author, "to": brain if author != brain else "board",
                            "kind": "comment", "via": "kanban", "board": board, "task": (titles.get(tid) or tid)[:80], "text": clean(body)})
            kinds = tuple(EVENT_KINDS)
            for i, tid, kind, at in c.execute(
                    f"select id, task_id, kind, created_at from task_events where created_at > ? and kind in ({','.join('?' * len(kinds))}) order by id desc limit 40",
                    (cut, *kinds)):
                out.append({"id": f"ev:{board}:{i}", "at": at, "from": who.get(tid) or "?", "to": brain, "kind": "event",
                            "event": EVENT_KINDS[kind], "via": "kanban", "board": board, "task": (titles.get(tid) or tid)[:80],
                            "text": (titles.get(tid) or tid)[:120]})
        finally:
            c.close()
    except Exception:
        pass
    return out


def comms(fams, home=None, now=None, window=COMM_WINDOW):
    home = Path(home) if home else default_home()
    cut = (time.time() if now is None else now) - window
    items = _bot_chat(home, cut) + _brain_lines(home, cut)
    seen = set()
    for f in fams:
        for prof, board, _ in f["brains"]:
            if board in seen:
                continue
            seen.add(board)
            items += _board_comms(home, board, prof, cut)
    items.sort(key=lambda x: x["at"])
    return items[-400:]


# ---------------- Hazem <-> assistant conversation state ----------------

def _is_human_user(content, display_kind):
    return not (display_kind or "").strip() and not INJECT_RE.match(content or "")


def _is_question(text):
    t = " ".join((text or "").split())
    if not t:
        return False
    return t.endswith("?") or bool(CLARIFY_RE.search(t[-300:]))


def probe_profile(home, profile, now=None):
    """Real activity of one assistant: last_user_at, last_reply_at, reply_text, turn, sources, errors."""
    now = time.time() if now is None else now
    base = Path(home) / "profiles" / profile
    out = {"last_user_at": None, "last_reply_at": None, "reply_text": "", "turn": False,
           "turn_src": "", "newest_at": None, "sources": [], "errors": []}
    users, replies = [], []
    db = base / "state.db"
    if db.exists():
        try:
            c = _ro(db, 3)
            try:
                for ts, content, dk in c.execute(
                        "select timestamp, coalesce(content,''), coalesce(display_kind,'') from messages "
                        "where role='user' order by id desc limit 80"):
                    if ts and _is_human_user(content, dk):
                        users.append(float(ts))
                for ts, content in c.execute(
                        "select timestamp, coalesce(content,'') from messages "
                        "where role='assistant' and coalesce(content,'') != '' order by id desc limit 40"):
                    if ts:
                        replies.append((float(ts), content))
                newest = c.execute("select max(timestamp) from messages").fetchone()[0]
                lease = c.execute("select count(*) from session_turn_leases where expires_at > ?", (now,)).fetchone()[0]
            finally:
                c.close()
            out["sources"].append("state.db")
            out["newest_at"] = float(newest) if newest else None
            if lease:
                out["turn"], out["turn_src"] = True, "turn lease"
            elif out["newest_at"] and now - out["newest_at"] < STREAM_FRESH:
                out["turn"], out["turn_src"] = True, "rows streaming %ds ago" % round(now - out["newest_at"])
        except Exception as e:
            out["errors"].append("state.db: " + repr(e))
    else:
        out["errors"].append("state.db missing")
    bd = base / "runtime" / "bot_live_delivery"
    if bd.is_dir():
        hits = 0
        for f in sorted(bd.glob("*.json")):
            try:
                d = json.loads(f.read_text())
                at = os.path.getmtime(f)
            except Exception as e:
                out["errors"].append("bot chat %s: %r" % (f.name[:10], e))
                continue
            hits += 1
            a = d.get("author") or {}
            frm = (a.get("name") if isinstance(a, dict) else None) or "hazem"
            msg = d.get("message") or ""
            if frm in ("hazem", "user") and msg.strip() and not INJECT_RE.match(msg):
                users.append(at - 1)
            if d.get("reply"):
                replies.append((at, d["reply"]))
        if hits:
            out["sources"].append("bot chat (%d)" % hits)
    else:
        out["errors"].append("bot chat dir missing")
    if users:
        out["last_user_at"] = max(users)
    if replies:
        out["last_reply_at"], out["reply_text"] = max(replies, key=lambda r: r[0])
    return out


def link_state(p, now):
    """(state, why) for one Hazem<->assistant link from real timestamps only."""
    u, r = p["last_user_at"], p["last_reply_at"]
    trig = None
    if r is not None and now - r < REPLY_WINDOW:
        trig = (now - r, "reply", "assistant replied %.1fs ago" % (now - r))
    if u is not None and now - u < SEND_WINDOW and (trig is None or now - u < trig[0]):
        trig = (now - u, "sending", "user message %.1fs ago" % (now - u))
    if trig:
        return trig[1], trig[2]
    if r is not None and (u is None or r > u) and _is_question(p["reply_text"]):
        return "question", "assistant asked a question; no newer user reply"
    if u is not None and (r is None or u > r):
        if p["turn"]:
            return "waiting", "user message newer than reply, turn active (%s)" % p["turn_src"]
        if now - u < RECENT_USER:
            return "waiting", "user message %ds ago, no reply and no turn observed yet" % round(now - u)
    if p["turn"]:
        return "waiting", "turn active (%s), last reply newer than user message" % p["turn_src"]
    return "idle", "no user message < 2 min and no active turn"


def user_state(fams, home=None, now=None):
    """{'state', 'at', 'links': [...]} for the Hazem node. Unreadable sources fall back to idle, never simulated."""
    home = Path(home) if home else default_home()
    now = time.time() if now is None else now
    links = []
    for f in fams:
        aid = f["assistant"]["id"]
        try:
            p = probe_profile(home, aid, now)
        except Exception as e:
            p = {"last_user_at": None, "last_reply_at": None, "reply_text": "", "turn": False,
                 "turn_src": "", "newest_at": None, "sources": [], "errors": ["probe crashed: " + repr(e)]}
        if p["sources"]:
            st, why = link_state(p, now)
        else:
            st, why = "idle", "no readable source"
        links.append({"assistant": aid, "label": f["assistant"].get("label") or aid, "state": st,
                      "last_user_at": p["last_user_at"], "last_reply_at": p["last_reply_at"],
                      "active_turn": p["turn"], "why": why, "sources": p["sources"], "errors": p["errors"]})
    g, best = "idle", None
    for lk in links:   # freshest transient wins, then question > waiting > idle
        if lk["state"] in ("sending", "reply"):
            age = now - (lk["last_user_at"] if lk["state"] == "sending" else lk["last_reply_at"])
            if best is None or age < best[0]:
                best = (age, lk["state"])
    if best:
        g = best[1]
    elif any(lk["state"] == "question" for lk in links):
        g = "question"
    elif any(lk["state"] == "waiting" for lk in links):
        g = "waiting"
    return {"state": g, "at": now, "links": links}


# ---------------- pressure ----------------

def score_to_pressure(score):
    if score <= 0:
        return 0.0
    if score <= 3:
        return score / 6
    if score <= 6:
        return 0.5 + (score - 3) * (0.4 / 3)
    return min(1.0, 0.9 + (score - 6) * 0.025)


def flame_level(p):
    for m, name in ((0.9, "full blaze"), (0.8, "medium"), (0.65, "small"), (0.5, "smoulder")):
        if p >= m:
            return name
    return "none"


def pressure(counts, workers):
    """Pressure for one node (same formula as the Hive UI): 2/running worker + 1.5/queued worker
    + 1.5/blocked task + 1/running task + a long-running-turn bonus (>15/30/60 min: 1/1.5/2)."""
    counts, workers = counts or {}, workers or []
    run = [w for w in workers if w.get("status") == "running"]
    q = len(workers) - len(run)
    max_age = max([w.get("secs") or 0 for w in run] or [0])
    long_run = 2 if max_age > 3600 else 1.5 if max_age > 1800 else 1 if max_age > 900 else 0
    score = 2 * len(run) + 1.5 * q + 1.5 * (counts.get("blocked") or 0) + (counts.get("running") or 0) + long_run
    p = score_to_pressure(score)
    return {"score": score, "pressure": p, "level": flame_level(p), "running_workers": len(run),
            "queued_workers": q, "blocked": counts.get("blocked") or 0, "running_tasks": counts.get("running") or 0,
            "max_age": max_age}


# ---------------- live sub-agent scan ----------------
# SCANNER is self-contained so the very same source runs locally and, via
# `ssh host python3 -`, on other machines. Read-only /proc reporter.
SCANNER = r'''
import json, os, re, time, glob, socket

TICKET = re.compile(r"\b[A-Z][A-Z0-9]{1,14}-\d{1,6}\b")
WAIT_MARK = "already has 4 active"
SECRET = re.compile(r"(?i)(sk-[\w-]{16,}|gh[pousr]_\w{20,}|AIza[\w-]{20,}|xox[bap]-[\w-]{10,}|(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S+)")
ENGINES = {"claude": "claude", "claude-code": "claude", "codex": "codex", "opencode": "opencode", "pi": "pi",
           "gemini": "gemini", "aider": "aider", "cursor-agent": "cursor", "goose": "goose"}
NODEISH = {"node", "nodejs", "bun", "deno", "tsx", "npx"}
WRAP_PATHS = (("pi-coding-agent", "pi"), ("claude-code", "claude"), ("opencode", "opencode"),
              ("@openai/codex", "codex"), ("@anthropic-ai/claude", "claude"), ("/codex/", "codex"))
HERMES_MODS = (("hermes_cli.kanban_worker", "kanban"), ("agent.managed_worker", "delegate"), ("agent.managed", "delegate"))
VALUE_FLAGS = {"-m", "--model", "--model-id", "--resume", "--settings", "--output-format", "-o", "--input-format",
               "--permission-mode", "--allowedTools", "--disallowedTools", "--setting-sources", "--append-system-prompt",
               "--add-dir", "--plugin-dir", "--mcp-config", "--effort", "--session", "-s", "--agent", "-a", "--cwd", "--thinking-display"}
ENUMISH = {"stream-json", "json", "text", "default", "auto", "stdio", "user", "project", "local", "omit", "omitted", "true", "false", "none", "null"}


def clean(text, n=280):
    t = SECRET.sub("[redacted]", " ".join((text or "").split()))
    return t[:n] + ("\u2026" if len(t) > n else "")


def flag_value(argv, names):
    for i, x in enumerate(argv):
        for n in names:
            if x == n and i + 1 < len(argv):
                return argv[i + 1].strip()
            if x.startswith(n + "="):
                return x.split("=", 1)[1].strip()
    return ""


def cli_task(args):
    out, skip = [], False
    for x in args:
        if skip:
            skip = False
            continue
        if x.startswith("-"):
            if "=" not in x and x in VALUE_FLAGS:
                skip = True
            continue
        if x and x not in ENUMISH:
            out.append(x)
    return " ".join(out)


def board_of(cwd):
    if "/kanban/boards/" in (cwd or ""):
        return cwd.split("/kanban/boards/", 1)[1].split("/", 1)[0]
    return os.path.basename((cwd or "").rstrip("/"))


def strip_ctx(args):
    out, skip = [], False
    for x in args:
        if skip:
            skip = False
            continue
        if x == "--context-file":
            skip = True
            continue
        out.append(x)
    return out


def classify(argv, cwd):
    """(kind, engine, role, project, task, model) for a real sub-agent process, else None."""
    b0 = os.path.basename(argv[0])
    args = argv[1:]
    if "python" in b0:
        if args and os.path.basename(args[0]) in ("pi-worker", "agent-worker"):
            pi = os.path.basename(args[0]) == "pi-worker"
            r = strip_ctx(args[1:])   # <family> <role> <project> [--context-file x] "<task>"
            return {"kind": "worker", "engine": "pi" if pi else (r[0] if r else "agent"),
                    "role": r[1] if len(r) > 1 else "?", "project": r[2] if len(r) > 2 else "",
                    "task": " ".join(r[3:]) if len(r) > 3 else "", "model": ""}
        if args and args[0] == "-m" and len(args) > 1:   # hermes delegate children + kanban workers
            for pref, role in HERMES_MODS:
                if args[1].startswith(pref) and (".hermes" in argv[0] or ".hermes" in (cwd or "")):
                    return {"kind": "hermes", "engine": "hermes", "role": role,
                            "project": board_of(cwd), "task": "", "model": ""}
        return None
    eng = ENGINES.get(b0)   # bare coding-agent CLIs
    if not eng and b0 in NODEISH and args:   # node/bun wrappers around those CLIs
        low = args[0].lower()
        for key, e in WRAP_PATHS:
            if key in low:
                eng = e
                break
    if not eng or "claude-desktop" in argv[0] or "--type=" in " ".join(argv):
        return None   # desktop shells and Electron children are not sub-agents
    return {"kind": "cli", "engine": eng, "role": "cli", "project": board_of(cwd),
            "task": cli_task(args[1:] if b0 in NODEISH and args else args), "model": flag_value(argv, ("--model", "-m"))}


def run_model(home, task):
    """Model of a worker run from its state/worker-runs/*/ request/events files (else empty)."""
    if not home or not task:
        return ""
    key = " ".join(task.split())[:80]
    if len(key) < 12:
        return ""
    base = os.path.join(home, "state", "worker-runs") + "/"
    try:
        dirs = sorted(glob.glob(base + "*/"), key=lambda d: os.path.getmtime(d + "request.json")
                      if os.path.exists(d + "request.json") else 0, reverse=True)[:40]
    except Exception:
        return ""
    for d in dirs:
        try:
            req = json.load(open(d + "request.json"))
        except Exception:
            continue
        rt = " ".join((req.get("task") or "").split())
        if rt[:60] != key[:60]:
            continue
        for k in ("model", "model_id", "model_name", "models"):   # request files first
            v = req.get(k)
            if isinstance(v, list):
                v = v[0] if v else ""
            if v:
                return str(v)
        for fn in ("result.json", "events.jsonl"):   # then the run's result/events files
            try:
                txt = open(d + fn, errors="replace").read(65536)
            except Exception:
                continue
            m = re.search(r'"(?:model|models|model_id|model_name)"\s*:\s*(?:\[\s*)?"([^"]+)"', txt)
            if m:
                return m.group(1)
        return ""
    return ""


def scan():
    """All live sub-agents on this host. Read-only: /proc and the run folders, nothing else."""
    host = socket.gethostname() or "local"
    try:
        boot = time.time() - float(open("/proc/uptime").read().split()[0])
        hz = os.sysconf("SC_CLK_TCK")
    except Exception:
        return {"host": host, "agents": []}
    procs = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            argv = [a.decode("utf-8", "replace") for a in open("/proc/%s/cmdline" % d, "rb").read().split(b"\0") if a]
            if not argv:
                continue
            st = open("/proc/%s/stat" % d).read().rsplit(")", 1)[1].split()
            home = None
            try:
                for kv in open("/proc/%s/environ" % d, "rb").read().split(b"\0"):
                    if kv.startswith(b"HERMES_HOME="):
                        home = kv[12:].decode()
                        break
            except Exception:
                pass
            try:
                cwd = os.readlink("/proc/%s/cwd" % d)
            except Exception:
                cwd = ""
            procs[int(d)] = {"argv": argv, "ppid": int(st[1]), "home": home, "cwd": cwd,
                             "age": max(0.0, time.time() - (boot + int(st[19]) / hz))}
        except Exception:
            continue

    def parent_of(pid):   # HERMES_HOME of the process or its nearest ancestor; else unattributed
        seen, cur = 0, pid
        while cur in procs and seen < 40:
            h = procs[cur].get("home")
            if h:
                name = os.path.basename(h.rstrip("/")) or "hermes"
                return (name[1:] if name.startswith(".") else name)
            cur, seen = procs[cur]["ppid"], seen + 1
        return "unattributed"

    cand = []
    for pid, p in procs.items():
        c = classify(p["argv"], p["cwd"])
        if c:
            c["pid"], c["age"] = pid, p["age"]
            cand.append(c)
    cpid = {c["pid"] for c in cand}

    def agent_ancestor(pid):   # nearest ancestor that is itself a sub-agent run
        seen, cur = 0, pid
        while cur in procs and seen < 40:
            cur, seen = procs[cur]["ppid"], seen + 1
            if cur in cpid:
                return cur
        return None

    keep, nested = {}, []   # nested runs count once: an engine CLI folds into the face of the run
    for c in cand:          # that spawned it, while every pi-worker/agent-worker process is its own run
        anc = agent_ancestor(c["pid"]) if c["kind"] == "cli" else None
        if anc is None:
            keep[c["pid"]] = c
        else:
            nested.append((anc, c))
    for anc, c in nested:   # an engine child donates engine/model to its wrapper's kept face
        while anc is not None and anc not in keep:
            anc = agent_ancestor(anc)
        k = keep.get(anc)
        if k is not None:
            if c.get("model") and not k.get("model"):
                k["model"] = c["model"]
            if k.get("engine") in ("hermes", "agent"):
                k["engine"], k["role"] = c["engine"], k.get("role") or "cli"

    def loop_of(pid):   # nearest ancestor shell that is a slot-wait retry loop
        seen, cur = 0, pid
        while cur in procs and seen < 12:
            cur, seen = procs[cur]["ppid"], seen + 1
            p = procs.get(cur)
            if p and WAIT_MARK in " ".join(p["argv"]):
                return cur
        return None

    host_tag = re.sub(r"[^a-z0-9]+", "", host.lower())[-8:] or "host"
    out, busy_loops = [], set()

    def add(pid, parent, eng, role, project, task, model, status, age):
        m = TICKET.search(task or "")
        out.append({"id": "w%d-%s" % (pid, host_tag), "pid": pid, "engine": eng, "role": role or "?",
                    "model": model or "", "project": os.path.basename((project or "").rstrip("/")),
                    "ticket": m.group(0) if m else "", "task": clean(task, 140), "status": status,
                    "secs": round(age), "age": round(age), "parent": parent or "unattributed", "host": host})

    for c in keep.values():
        pid = c["pid"]
        lp = loop_of(pid) if c["kind"] == "worker" else None
        if lp and c["age"] < 20:
            continue   # being refused for a slot: the loop below reports it as queued
        if lp:
            busy_loops.add(lp)
        model = c.get("model") or run_model((procs.get(pid) or {}).get("home"), c.get("task", ""))
        add(pid, parent_of(pid), c["engine"], c.get("role"), c.get("project"), c.get("task"), model, "running", c["age"])
    for pid, p in procs.items():
        cmd = " ".join(p["argv"])
        if pid in busy_loops or WAIT_MARK not in cmd or "zsh" not in p["argv"][0] and "bash" not in p["argv"][0]:
            continue
        if procs.get(p["ppid"]) and WAIT_MARK in " ".join(procs[p["ppid"]]["argv"]):
            continue   # subshell of a loop already counted
        m = re.search(r"(?:pi-worker|\$PW)\s+(\S+)\s+(\S+)\s+(\S+)", cmd)
        t = re.search(r'T=\\?"(.{0,400})', cmd)
        add(pid, parent_of(pid), "pi", m.group(2) if m else "?", (m.group(3) if m else "").replace("$P", "").replace("$W", ""),
            t.group(1) if t else cmd[-300:], "", "queued", p["age"])
    return {"host": host, "agents": out}


if __name__ == "__main__":
    print(json.dumps(scan()))
'''

_SCANNER_CODE = compile(SCANNER, "<hive-scanner>", "exec")


def scan_local():
    ns = {"__name__": "hive_scanner"}
    exec(_SCANNER_CODE, ns)
    return ns["scan"]()


def scan_host(spec, timeout=SCAN_TIMEOUT, now=None):
    """One host -> {name, addr, hostname, online, checked_at, agents}. Unreachable = offline, no agents."""
    now = time.time() if now is None else now
    local = spec in ("local", "127.0.0.1", "localhost")
    name = "local" if local else spec
    try:
        if local:
            data = scan_local()
        else:
            r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=4", spec, "python3 -"],
                               input=SCANNER.encode("utf-8"), capture_output=True, timeout=timeout)
            if r.returncode != 0:
                raise RuntimeError("ssh exit %s" % r.returncode)
            data = json.loads(r.stdout.decode("utf-8", "replace"))
        agents = data.get("agents") or []
        for a in agents:
            a["host"] = name
        return {"name": name, "addr": spec, "hostname": data.get("host", ""), "online": True,
                "checked_at": now, "agents": agents}
    except Exception:
        return {"name": name, "addr": spec, "hostname": "", "online": False, "checked_at": now, "agents": []}


def env_hosts():
    """Extra ssh hosts from $HIVE_HOSTS (comma/space separated); none by default."""
    return [h for h in re.split(r"[\s,]+", os.environ.get("HIVE_HOSTS", "")) if h]


def scan_all(hosts=None, timeout=SCAN_TIMEOUT, now=None):
    specs = ["local"] + [h for h in (env_hosts() if hosts is None else hosts)
                         if h not in ("local", "127.0.0.1", "localhost")]
    return [scan_host(s, timeout, now) for s in specs]


def by_parent(hosts):
    out = {}
    for h in hosts:
        for a in h["agents"]:
            out.setdefault(a.get("parent") or "unattributed", []).append(a)
    return out


# ---------------- profile activity ----------------

def last_activity(home, profile, now=None):
    """Seconds since the newest session/state file of a profile changed (None if no files)."""
    now = time.time() if now is None else now
    base = Path(home) / "profiles" / profile
    best = 0.0
    for pat in ("state.db-wal", "state.db", "sessions/*", "runtime/active_sessions.json"):
        for f in glob.glob(str(base / pat)):
            try:
                best = max(best, os.path.getmtime(f))
            except OSError:
                pass
    return max(0, round(now - best)) if best else None


def open_sessions(home, profile):
    try:
        d = json.loads((Path(home) / "profiles" / profile / "runtime" / "active_sessions.json").read_text())
        return len(d.get("entries", []))
    except Exception:
        return 0


def _worker_title(w):
    return (f'{w.get("engine", "")} {w.get("role", "")}'.strip() + (f' · {w["model"]}' if w.get("model") else "") +
            (f' · {w["ticket"]}' if w.get("ticket") else "") + f' · {w.get("host", "")} · {(w.get("task") or "")[:70]}')


# ---------------- snapshot ----------------

def collect(home=None, now=None, hosts=None, scan=True, boards=None):
    """One JSON-serialisable Hive snapshot.

    home   Hermes home (default $HERMES_HOME or ~/.hermes)
    now    clock override for tests
    hosts  extra hosts: ssh specs (str, scanned) and/or pre-built host dicts (used as-is);
           default $HIVE_HOSTS
    scan   False skips the /proc + ssh scan; only pre-built host dicts then supply workers
    boards None reads every brain's kanban.db; or {board: [tasks]} to inject
    """
    home = Path(home) if home else default_home()
    now = time.time() if now is None else now
    fams = load_families(home)
    names = sorted({b for f in fams for _, b, _ in f["brains"] if b})
    cache = {}
    for b in names:
        r = boards[b] if boards is not None and b in boards else (read_board(home, b) if boards is None else [])
        cache[b] = r or []
    if scan:
        pre = [h for h in (hosts or []) if isinstance(h, dict)]
        specs = [h for h in (hosts or []) if not isinstance(h, dict)] if hosts is not None else None
        host_list = scan_all(specs, now=now) + pre
    else:
        host_list = [h for h in (hosts or []) if isinstance(h, dict)]
    workers = by_parent(host_list)
    claimed = {f["assistant"]["id"] for f in fams}
    for f in fams:
        claimed.update(b[0] for b in f["brains"])
        claimed.update(bt[0] for bt in f["bots"])
    stray = [w for h in host_list for w in h["agents"] if (w.get("parent") or "unattributed") not in claimed]

    families, tasks, pres = [], {}, {}
    for fam in fams:
        fid = fam["id"]
        brains = []
        for prof, board, label in fam["brains"]:
            lst = cache.get(board, [])
            agents = {}
            for t in lst:
                if t.get("status") in ACTIVE:
                    agents.setdefault(t.get("assignee") or "unassigned", []).append(
                        {"id": t["id"], "title": (t.get("title") or "")[:90], "status": t["status"]})
                if t.get("status") in ACTIVE or t.get("status") == "done":
                    tasks[f"{fid}:{t['id']}"] = {"family": fid, "brain": prof, "board": label, "agent": t.get("assignee") or "?",
                                                 "status": t["status"], "title": (t.get("title") or "")[:90]}
            counts = {s: sum(1 for t in lst if t.get("status") == s) for s in COUNT_STATUSES}
            ws = workers.get(prof, [])
            brains.append({"id": prof, "board": board, "label": label, "idle": last_activity(home, prof, now),
                           "sessions": open_sessions(home, prof), "counts": counts, "workers": ws,
                           "agents": [{"id": a, "tasks": v,
                                       "idle": last_activity(home, a, now) if (home / "profiles" / a).exists() else None}
                                      for a, v in sorted(agents.items())]})
            pres[f"b:{fid}:{prof}"] = {"kind": "brain", **pressure(counts, ws)}
        a = fam["assistant"]
        bots = [{"id": bid, "label": lb, "idle": last_activity(home, bid, now), "sessions": open_sessions(home, bid),
                 "workers": workers.get(bid, [])} for bid, lb in fam["bots"]]
        for bt in bots:
            pres[f"b:{fid}:{bt['id']}"] = {"kind": "bot", **pressure({}, bt["workers"])}
        pres[f"a:{fid}"] = {"kind": "assistant", **pressure({}, workers.get(a["id"], []))}
        for owner, ws in [(a["id"], workers.get(a["id"], []))] + [(b["id"], b["workers"]) for b in brains + bots]:
            lbl = next((x["label"] for x in brains + bots if x["id"] == owner), a["label"])
            for w in ws:
                tasks[f"{fid}:{owner}:{w['id']}"] = {"family": fid, "brain": owner, "board": lbl, "agent": w["id"],
                                                    "status": w["status"], "worker": True, "title": _worker_title(w)}
        families.append({"id": fid, "label": fam["label"],
                         "assistant": {**a, "idle": last_activity(home, a["id"], now),
                                       "sessions": open_sessions(home, a["id"]), "workers": workers.get(a["id"], [])},
                         "bots": bots, "brains": brains})
    for w in stray:
        tasks[f"root:unattributed:{w['id']}"] = {"family": "root", "brain": "unattributed", "board": "unattributed",
                                                "agent": w["id"], "status": w["status"], "worker": True,
                                                "title": _worker_title(w)}
        pres[f"w:{w['id']}"] = {"kind": "worker", **pressure({}, [w])}
    feed = comms(fams, home, now)
    return stamp({"kind": "hive", "at": now, "families": families, "comms": feed[-120:], "hosts": host_list,
                  "unattributed": stray, "user": user_state(fams, home, now), "pressure": pres, "tasks": tasks})


# ---------------- live feed (LST-269, H-2) ----------------

def diff_tasks(old, new):
    """Real status changes between two ``tasks`` maps (port of hive/server.py diff)."""
    ev = []
    for tid, t in new.items():
        o = old.get(tid)
        if o is None:
            if t["status"] != "done":
                ev.append({"kind": "new", "id": tid, **t})
        elif o["status"] != t["status"]:
            ev.append({"kind": "status", "id": tid, "from": o["status"], **t})
    for tid, o in old.items():   # a worker process that ended
        if o.get("worker") and tid not in new:
            ev.append({"kind": "status", "id": tid, **o, "from": o["status"], "status": "finished"})
    return ev


def _user_sig(usr):
    return json.dumps({k: v for k, v in (usr or {}).items() if k != "at"}, sort_keys=True, default=str)


class HiveFeed:
    """Polls ``collect`` on a background thread and keeps a bounded ring of
    sequenced frames, so SSE streams and ``?since=`` polling share one source.

    Snapshot at seq N is the state after frame N. ``since(n)`` replays exactly
    frames > n, or answers ``reset`` with a fresh snapshot when n is outside the
    ring (too old, or from a previous server run).
    """

    def __init__(self, collect_fn=None, interval=3.0, ring=512):
        self._collect = collect_fn or collect
        self.interval = interval
        self._cond = threading.Condition()
        self._ring = collections.deque(maxlen=ring)
        self._seq = 0
        self._snap = None
        self._tasks = {}
        self._seen = set()
        self._user = None
        self._thread = None
        self._stop = threading.Event()
        self.errors = 0
        self.last_error = None

    def start(self):
        """Lazy start: the first request spawns the collector thread."""
        with self._cond:
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name="hive-feed", daemon=True)
                self._thread.start()

    def stop(self):
        self._stop.set()
        with self._cond:
            self._cond.notify_all()

    def _run(self):
        while not self._stop.is_set():
            self.tick()
            self._stop.wait(self.interval)

    def tick(self):
        t0 = time.time()
        try:
            snap = self._collect()
        except Exception as e:  # keep serving the last good snapshot
            with self._cond:
                self.errors += 1
                self.last_error = repr(e)
            return
        took = round(time.time() - t0, 3)
        tasks = snap.get("tasks") or {}
        comms = snap.get("comms") or []
        with self._cond:
            first = self._snap is None
            at = snap.get("at") or time.time()
            frames = [] if first else [{"type": "event", "at": at, **e} for e in diff_tasks(self._tasks, tasks)]
            fresh = [c for c in comms if c.get("id") not in self._seen]
            self._seen.update(c.get("id") for c in comms)
            if not first:
                frames += [{"type": "comm", **c} for c in fresh[-25:]]
                if _user_sig(snap.get("user")) != self._user:
                    frames.append({"type": "user", "at": at, "user": snap.get("user")})
            self._user = _user_sig(snap.get("user"))
            for fr in frames:
                self._seq += 1
                self._ring.append({"seq": self._seq, **fr})
            self._tasks = tasks
            self._snap = {**snap, "type": "snapshot", "seq": self._seq, "collect_s": took}
            self._cond.notify_all()

    def wait_ready(self, timeout):
        with self._cond:
            return self._cond.wait_for(lambda: self._snap is not None, timeout)

    def snapshot(self):
        with self._cond:
            return self._snap

    def since(self, n):
        """-> delta frame, or a reset carrying a fresh snapshot. None before the first collect."""
        with self._cond:
            if self._snap is None:
                return None
            cur = self._seq
            oldest = self._ring[0]["seq"] if self._ring else cur + 1
            if n > cur or n < oldest - 1:
                return {"type": "reset", "snapshot": self._snap}
            return {"type": "delta", "from": n, "to": cur,
                    "events": [f for f in self._ring if f["seq"] > n]}

    def wait_after(self, n, timeout):
        """Block up to ``timeout`` for frames newer than seq ``n``.
        -> (frames, snapshot_or_None); snapshot set when ``n`` fell out of the ring."""
        with self._cond:
            self._cond.wait_for(lambda: self._seq > n or self._stop.is_set(), timeout)
            if self._seq <= n:
                return [], None
            oldest = self._ring[0]["seq"] if self._ring else self._seq + 1
            if n < oldest - 1:
                return [], self._snap
            return [f for f in self._ring if f["seq"] > n], None


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    out = collect()
    text = json.dumps(out, indent=2)
    if argv:
        Path(argv[0]).write_text(text)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
