"""Static assets for the dashboard page: CSS, HTML shell and the JS modules.

P2-02 (#27): the page's JavaScript lives in real ES modules under ``web/js/``.
The shipped page stays ONE self-contained file (clone and open it, no bundler,
no network), so the modules are inlined at build time — imports dropped,
``export`` keywords stripped, blocks replayed in the original load order.

Load order matters and is not guessed: ``web/js/order.json`` records, for every
top-level block, which module owns it and at which line it starts. Replaying
that manifest reproduces the pre-split script byte for byte, which is what makes
the split safe — the emitted page is not merely "equivalent", it is identical.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CSS_PATH = os.path.join(HERE, "web", "css", "dashboard.css")
SHELL_PATH = os.path.join(HERE, "web", "dashboard.html")
JS_DIR = os.path.join(HERE, "web", "js")
ORDER_PATH = os.path.join(JS_DIR, "order.json")
# P2-04 (#28): the palette every page shares, declared exactly once. Both
# stylesheets are inlined behind this file, so the dashboard and the price
# sheet cannot drift apart.
TOKENS_PATH = os.path.join(HERE, "web", "css", "tokens.css")
COSTS_CSS_PATH = os.path.join(HERE, "web", "css", "costs.css")
COSTS_SHELL_PATH = os.path.join(HERE, "web", "costs.html")
COSTS_JS_PATH = os.path.join(JS_DIR, "costs.js")
# The modules, in dependency order (main boots last and is the only one that
# runs anything while loading).
JS_ORDER = ["palette.js", "charts.js", "views.js", "flow.js", "drawer.js",
            "live.js", "router.js", "main.js"]


def read_tokens():
    """The shared palette tokens, inlined ahead of every page's stylesheet."""
    with open(TOKENS_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_costs_css():
    """The price sheet's own styles (palette tokens come from read_tokens())."""
    with open(COSTS_CSS_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_costs_shell():
    """The price sheet's HTML with __COSTS_CSS__ / __COSTS_JS__ slots."""
    with open(COSTS_SHELL_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_costs_js():
    """The price sheet's calculator script."""
    with open(COSTS_JS_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_css():
    """The stylesheet, inlined into <style> so the page needs no sibling file."""
    with open(CSS_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_shell():
    """The HTML page with __PLACEHOLDER__ slots (including __DASHBOARD_JS__)."""
    with open(SHELL_PATH, encoding="utf-8") as fh:
        return fh.read()


def inline_js():
    """Return the page's JavaScript as one classic-script body."""
    with open(ORDER_PATH, encoding="utf-8") as fh:
        manifest = json.load(fh)

    per_mod = {}
    for entry in manifest["order"]:
        per_mod.setdefault(entry["mod"] + ".js", []).append(entry)

    src = {}
    for name in JS_ORDER:
        path = os.path.join(JS_DIR, name)
        if not os.path.exists(path):
            sys.exit(f"web/js: missing module {name} (expected by order.json)")
        with open(path, encoding="utf-8") as fh:
            src[name] = fh.read()

    # Every block runs from its start line to the next block in the same
    # module, or to end of file.
    ranges = {}
    for name, entries in per_mod.items():
        total = src[name].count("\n") + 1
        for i, entry in enumerate(entries):
            stop = entries[i + 1]["start"] if i + 1 < len(entries) else total + 1
            ranges.setdefault(name, {})[entry["name"]] = (entry["start"], stop)

    chunks = [manifest.get("prelude", "")]
    for entry in manifest["order"]:
        name = entry["mod"] + ".js"
        try:
            lo, hi = ranges[name][entry["name"]]
        except KeyError:
            sys.exit(f"web/js/order.json references '{entry['name']}' in {name}, "
                     f"but that module does not declare it")
        text = "".join(src[name].splitlines(True)[lo - 1:hi - 1])
        chunks.append(re.sub(r"^export\s+", "", text, flags=re.M))
    body = "".join(chunks)

    # Flattening modules into a single script scope must not collapse two
    # declarations onto one name; fail loudly rather than shadow silently.
    seen = set()
    for match in re.finditer(r"^(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)",
                             body, flags=re.M):
        if match.group(1) in seen:
            sys.exit(f"web/js: '{match.group(1)}' is declared twice — flattening "
                     f"the modules into one script scope would collide")
        seen.add(match.group(1))
    return body
