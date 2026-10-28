#!/usr/bin/env python3
"""collect_live title resolution: a surface name ('Bot Chat') is never the title
when the session has real content (Home feedback 2026-10-28)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
os.environ.setdefault("LLM_TELEMETRY_CONFIG",
                      os.path.join(os.path.dirname(__file__), "..", "examples", "sample-config.json"))
from llm_telemetry.collect_live import clean_title, is_generic_title, resolve_title, source_label

p = f = 0
def chk(ok, msg):
    global p, f
    print(("  OK   " if ok else "  FAIL ") + msg); p, f = (p + 1, f) if ok else (p, f + 1)

chk(resolve_title("Bot Chat", "Fix the login bug\n\nplease") == "Fix the login bug please",
    "generic 'Bot Chat' falls back to the cleaned first user message")
chk(resolve_title("  bot chat ", "hello") == "hello", "generic check is case/space-insensitive")
chk(resolve_title("File 12 GPU tickets", "ignored") == "File 12 GPU tickets", "a real title is kept")
chk(resolve_title("Bot Chat", None) == "(untitled)", "no first message: untitled, never the bare surface name")
chk(resolve_title("", "") == "(untitled)", "empty title and message: untitled")
long = resolve_title("Bot Chat", "word " * 60)
chk(len(long) <= 80 and long.endswith("…"), "long first message is trimmed to ~80 chars with an ellipsis")
chk(clean_title("```x``` **bold** # head") == "x bold head", "markdown chrome is stripped")
chk(is_generic_title("Bot Chat") and not is_generic_title("Deploy v2"), "generic detection, with a negative control")
chk(source_label("tui") == "TUI" and source_label("cli") == "CLI" and source_label("") == "Bot Chat"
    and source_label("kanban") == "Kanban", "source tags: TUI/CLI/Kanban; Bot Chat only when unknown")
chk(clean_title("Message from \U0001F916 PV Pulse (@pv-pulse): User approved") == "PV Pulse: User approved",
    "bot-relay envelope becomes 'Name: body'")
chk("/srv/" not in clean_title("@file: /srv/data/profiles/x/attachments/a.png look") and "a.png" in clean_title("@file: /srv/data/profiles/x/attachments/a.png look"),
    "absolute paths are reduced to the file name (no path leak)")
chk("/" in clean_title("use a/b ratio"), "negative control: a plain a/b is left alone")
print(f"\n{p} passed, {f} failed"); sys.exit(1 if f else 0)
