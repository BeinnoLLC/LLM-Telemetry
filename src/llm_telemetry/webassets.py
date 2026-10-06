"""Static assets for the dashboard page: CSS, HTML shell and the JS modules.

P2-02 (#27): the page's JavaScript lives in real ES modules under ``web/js/``.
The shipped page stays ONE self-contained file (clone and open it, no bundler,
no network), so the modules are inlined at build time — imports dropped,
``export`` keywords stripped, blocks replayed in the original load order.

Load order matters and is not guessed: ``web/js/order.json`` records the order of
every top-level block and the module that owns it. Blocks are located by NAME at
build time, not by a stored line number: a stored offset silently slices the
wrong text the moment anyone edits a module (every later block in that file
shifts), and a wrong slice is a corrupted page rather than an error. The name
scan below is the same rule the split used, so the manifest only has to get the
ORDER right — the thing that cannot be inferred.
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
# The row/box/KPI markup build_costs.py fills; the Python keeps only shaping.
COSTS_FRAGMENTS_PATH = os.path.join(HERE, "web", "costs-fragments.html")
# #113: the OpenRouter rankings page — a standalone page like the price sheet
# (not an SPA module, so it is deliberately absent from JS_ORDER).
RANKINGS_CSS_PATH = os.path.join(HERE, "web", "css", "rankings.css")
RANKINGS_SHELL_PATH = os.path.join(HERE, "web", "rankings.html")
RANKINGS_JS_PATH = os.path.join(JS_DIR, "rankings.js")
RANKINGS_FRAGMENTS_PATH = os.path.join(HERE, "web", "rankings-fragments.html")
# The modules, in dependency order (main boots last and is the only one that
# runs anything while loading).
JS_ORDER = ["palette.js", "charts.js", "views.js", "flow.js", "drawer.js",
            "live.js", "routerview.js", "quotaview.js", "router.js", "main.js"]
# A top-level declaration: the only thing that starts a block.
DECL_RE = re.compile(r"^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+"
                     r"([A-Za-z_$][\w$]*)")


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


_FRAG_RE = re.compile(r"<!-- @frag ([a-z_][a-z0-9_]*) -->\n(.*?)\n<!-- @end -->", re.S)
_SLOT_RE = re.compile(r"\{([a-z_][a-z0-9_]*)\}")
_frags = None


def read_fragments(path):
    """name -> template, parsed from one ``<!-- @frag name -->`` file."""
    with open(path, encoding="utf-8") as fh:
        found = _FRAG_RE.findall(fh.read())
    names = [n for n, _ in found]
    dupes = sorted({n for n in names if names.count(n) > 1})
    if dupes:
        raise ValueError(f"duplicate fragments in {path}: {dupes}")
    return dict(found)


def read_costs_fragments():
    """name -> template, parsed from web/costs-fragments.html."""
    return read_fragments(COSTS_FRAGMENTS_PATH)


def read_rankings_css():
    """The rankings page's own styles (palette tokens come from read_tokens())."""
    with open(RANKINGS_CSS_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_rankings_shell():
    """The rankings page's HTML with __PLACEHOLDER__ slots."""
    with open(RANKINGS_SHELL_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_rankings_js():
    """The rankings page's window-chooser script."""
    with open(RANKINGS_JS_PATH, encoding="utf-8") as fh:
        return fh.read()


_rank_frags = None


def _fill(name, tpl, slots):
    def fill(m):
        key = m.group(1)
        if key not in slots:
            raise KeyError(f"fragment {name!r} needs slot {key!r}")
        return str(slots[key])
    return _SLOT_RE.sub(fill, tpl)


def rankings_frag(name, /, **slots):
    """Fill one rankings-page fragment (same contract as frag())."""
    global _rank_frags
    if _rank_frags is None:
        _rank_frags = read_fragments(RANKINGS_FRAGMENTS_PATH)
    return _fill(name, _rank_frags[name], slots)


def frag(name, /, **slots):
    """Fill one price-sheet fragment. Values go in verbatim: escape first.

    One pass, so a value that itself contains "{x}" is not re-expanded. A slot
    the template names but the caller omits is an error, not a blank.
    """
    global _frags
    if _frags is None:
        _frags = read_costs_fragments()
    tpl = _frags[name]

    def fill(m):
        key = m.group(1)
        if key not in slots:
            raise KeyError(f"fragment {name!r} needs slot {key!r}")
        return str(slots[key])
    return _SLOT_RE.sub(fill, tpl)


def script_json(obj):
    """JSON safe to inline in a <script> block: no premature end tag."""
    return json.dumps(obj).replace("</", "<\\/")


def read_css():
    """The stylesheet, inlined into <style> so the page needs no sibling file."""
    with open(CSS_PATH, encoding="utf-8") as fh:
        return fh.read()


def read_shell():
    """The HTML page with __PLACEHOLDER__ slots (including __DASHBOARD_JS__)."""
    with open(SHELL_PATH, encoding="utf-8") as fh:
        return fh.read()


def split_blocks(text):
    """{block name: [lines]} for one module, by top-level declaration."""
    lines = text.splitlines(True)
    starts = []                                    # (index, declared name)
    for i, line in enumerate(lines):
        match = DECL_RE.match(line)
        if match:
            starts.append((i, match.group(1)))
    blocks = {}
    for n, (i, name) in enumerate(starts):
        stop = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        if name in blocks:
            sys.exit(f"web/js: module declares '{name}' twice")
        blocks[name] = lines[i:stop]
    return blocks


def inline_js():
    """Return the page's JavaScript as one classic-script body."""
    with open(ORDER_PATH, encoding="utf-8") as fh:
        manifest = json.load(fh)

    blocks = {}
    for name in JS_ORDER:
        path = os.path.join(JS_DIR, name)
        if not os.path.exists(path):
            sys.exit(f"web/js: missing module {name} (expected by order.json)")
        with open(path, encoding="utf-8") as fh:
            blocks[name] = split_blocks(fh.read())

    chunks = [manifest.get("prelude", "")]
    for entry in manifest["order"]:
        name = entry["mod"] + ".js"
        try:
            text = "".join(blocks[name][entry["name"]])
        except KeyError:
            sys.exit(f"web/js/order.json references '{entry['name']}' in {name}, "
                     f"but that module does not declare it")
        chunks.append(re.sub(r"^export\s+", "", text, flags=re.M))
    body = "".join(chunks)

    # Flattening modules into a single script scope must not collapse two
    # declarations onto one name; fail loudly rather than shadow silently.
    seen = set()
    for match in re.finditer(r"^(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)",
                             body, flags=re.M):
        if match.group(1) in seen:
            sys.exit(f"web/js: '{match.group(1)}' is declared twice — flattening "
                     f"the modules into one script scope would collide")
        seen.add(match.group(1))
    return body
