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
# ---- secrets never reach a title (review finding 1) ----
SECRETS = {
    "sk-": "use key sk-ant-api03-ABCDEFGHIJ1234567890 to deploy",
    "ghp_": "GH_TOKEN=ghp_abcdefghijklmnop1234567890 run release",
    "password": "login with password=hunter2secret please",
    "api_key": "set api_key=abc123XYZ now",
    "bearer": "curl -H 'Authorization: Bearer abcdef0123456789xyz' host",
    "url token": "open https://example.com/cb?token=SECRETVALUE123&x=1 now",
}
for k, msg in SECRETS.items():
    t = resolve_title("Bot Chat", msg)
    leaked = any(x in t for x in ("ABCDEFGHIJ", "abcdefghijklmnop", "hunter2", "abc123XYZ", "abcdef0123456789", "SECRETVALUE"))
    chk(not leaked and bool(t), f"secret redacted from title: {k} -> {t!r}")
chk(resolve_title("Bot Chat", "x" * 70 + " ghp_abcdefghijklmnop1234567890")[-6:] != "mnop12" and "ghp_" not in resolve_title("Bot Chat", "x" * 70 + " ghp_abcdefghijklmnop1234567890"),
    "secret straddling the truncation point is redacted before cutting")
chk(resolve_title("Token ghp_abcdefghijklmnop1234567890 fix", "") == "Token [REDACTED] fix", "a real title is scrubbed too")
chk(resolve_title("Bot Chat", "Refactor the token cache and the password form") == "Refactor the token cache and the password form",
    "negative control: ordinary text mentioning token/password is unchanged")

# ---- paths / URLs (finding 2) ----
chk(clean_title("edit /home/u/My Docs/x.txt now") == "edit x.txt now", "path with a space reduced to the file name")
chk(clean_title(r"open C:\Users\bob\My Docs\notes.md please") == "open notes.md please", "Windows path reduced to the file name")
chk(clean_title("see https://host.example.com/a/b?x=1#frag ok") == "see host.example.com ok", "URL reduced to its host, query dropped")
chk(clean_title("/a/b and then c/d") == "b and then c/d", "negative control: prose after a path is kept")

# ---- bot-relay envelope (finding 3) ----
chk(clean_title("Message from Bob (@bob): hi") == "Bob: hi", "envelope without emoji")
chk(clean_title("Message from Jane Doe (@jd): hi") == "Jane Doe: hi", "envelope with multi-word name")
chk(clean_title("Message from \U0001F916 Jane Doe (@jd): hi") == "Jane Doe: hi", "envelope with emoji and multi-word name")

# ---- real titles are not rewritten (finding 4) ----
chk(resolve_title("fix_ci_tests", "ignored") == "fix_ci_tests", "real title keeps its underscores")
chk(resolve_title("Bot Chat", "fix_ci_tests") == "fix ci tests", "negative control: first-message fallback is still cleaned")

print(f"\n{p} passed, {f} failed"); sys.exit(1 if f else 0)
