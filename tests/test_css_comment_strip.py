#!/usr/bin/env python3
"""Step 0a: CSS comments are stripped at build time, nothing else changes.

Comments stay in the source files for maintainers but must not ship inside
dashboard.html. The stripper must never touch a '/*' that lives inside a string
or a url(...), and must keep /*! ... */ comments.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
from llm_telemetry import webassets  # noqa: E402

failed = 0
total = 0


def chk(cond, label, extra=""):
    global failed, total
    total += 1
    print(("  OK   " if cond else "  FAIL ") + label + (f"  ({extra})" if extra else ""))
    if not cond:
        failed += 1


s = webassets.strip_css_comments
chk(s("a{color:red}/* gone */b{x:y}") == "a{color:red}b{x:y}", "a comment is removed")
chk(s("a{/* one\nmulti-line */color:red}") == "a{color:red}", "a multi-line comment is removed")
chk(s("/* a */x/* b */") == "x", "several comments are removed")
chk(s('a::after{content:"/* keep */"}') == 'a::after{content:"/* keep */"}', "'/*' in a double-quoted string survives")
chk(s("a::after{content:'/* keep */'}") == "a::after{content:'/* keep */'}", "'/*' in a single-quoted string survives")
chk(s("a{background:url(data:image/svg+xml;x=/*k*/)}") == "a{background:url(data:image/svg+xml;x=/*k*/)}", "'/*' in url() survives")
chk(s('a{content:"\\"/* k */"}/* x */') == 'a{content:"\\"/* k */"}', "an escaped quote does not end the string early")
chk(s("/*! license */a{b:c}/* x */") == "/*! license */a{b:c}", "/*! */ comments are kept")
chk(s("a { b : c ; }\n") == "a { b : c ; }\n", "no other minification (whitespace untouched)")

css = webassets.read_css()
tok = webassets.read_tokens()
chk("/*" not in tok and "*/" not in tok, "shipped tokens.css has no comments")
raw = open(webassets.CSS_PATH, encoding="utf-8").read()
chk(len(css) < len(raw) - 10_000, "shipped dashboard.css is much smaller than the source", f"{len(raw)} -> {len(css)}")

print()
print(f"{total - failed} passed, {failed} failed")
sys.exit(1 if failed else 0)
