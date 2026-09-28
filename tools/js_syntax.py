#!/usr/bin/env python3
"""Syntax-check the dashboard's emitted JS by simulating the build's template
substitution, then running `node --check` on the generated script."""
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "src", "llm_telemetry", "build_dashboard.py")

s = open(SRC).read()
# The JS block opens at `JS = r"""` and closes at its own terminator — which is
# followed by module code, so a non-greedy .*? to the LAST """ is correct here,
# but the emitted page keeps `</script></body></html>` on the closing line.
m = re.search(r'JS = r"""(.*?)"""', s, re.S)
if not m:
    print("JS block not found"); sys.exit(1)
js = m.group(1)
# strip the surrounding script tags and the page tail the block legitimately ends with
js = js.replace("<script>", "").replace("</script>", "")
js = re.sub(r"</body></html>\s*$", "", js)
js = js.replace("__DATA__", "{}")
js = re.sub(r"__LOCAL_HOSTS__", "[]", js)
js = re.sub(r"__SCHEMA_VERSION__", "3", js)
js = re.sub(r"__[A-Z_]+__", "null", js)

with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
    f.write(js)
    path = f.name
r = subprocess.run(["node", "--check", path], capture_output=True, text=True)
os.unlink(path)
if r.returncode:
    print("SYNTAX ERROR:")
    print(r.stderr[:1200])
    sys.exit(1)
print("emitted JS parses OK,", len(js), "chars")
