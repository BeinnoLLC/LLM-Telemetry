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
# ADR 0001: the page is ONE self-contained artifact, so it must not need a CDN
# at runtime for its layout. These are the Tailwind utility classes the markup
# actually uses, vendored at the values those class names mean — the CDN they
# used to come from is a browser-side JIT, and when it is blocked the entire
# dashboard lost its layout (flex/gap/padding all silently no-ops).
UTILITIES_PATH = os.path.join(HERE, "web", "css", "utilities.css")
# The rankings payload rides in-app too (#113): no standalone page, so the
# module list is just the SPA's, in dependency order (main boots last and is
# the only one that runs anything while loading).
JS_ORDER = ["palette.js", "table.js", "charts.js", "views.js", "flow.js", "drawer.js",
            "diffdom.js", "live.js", "arena.js", "routerview.js", "quotaview.js", "router.js",
            "main.js", "state.js"]
# A top-level declaration: the only thing that starts a block.
DECL_RE = re.compile(r"^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+"
                     r"([A-Za-z_$][\w$]*)")


# One left-to-right pass so a comment opener is only ever recognised OUTSIDE a
# string or url(...): those alternatives are matched first and kept verbatim.
_CSS_TOKEN_RE = re.compile(
    r"""(?P<keep>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\))"""
    r"""|(?P<comment>/\*.*?\*/)""", re.S | re.I)


def strip_css_comments(text):
    """Drop /* ... */ comments from shipped CSS; nothing else is minified.

    Strings and url(...) bodies are left untouched, and /*! ... */ (license)
    comments are kept. The source files keep their comments for maintainers.
    """
    def repl(m):
        c = m.group("comment")
        return c if c is not None and c.startswith("/*!") else (m.group("keep") or "")
    return _CSS_TOKEN_RE.sub(repl, text)


def read_tokens():
    """The shared palette tokens, inlined ahead of every page's stylesheet."""
    with open(TOKENS_PATH, encoding="utf-8") as fh:
        return strip_css_comments(fh.read())


def script_json(obj):
    """JSON safe to inline in a <script> block: no premature end tag."""
    return json.dumps(obj).replace("</", "<\\/")


def read_css():
    """The stylesheet, inlined into <style> so the page needs no sibling file."""
    with open(CSS_PATH, encoding="utf-8") as fh:
        return strip_css_comments(fh.read())


def read_utilities():
    """The vendored utility classes the markup uses (replaces the Tailwind CDN).

    Inlined BEFORE the page stylesheet so a component rule can still override a
    utility, and emitted in the same <style> block so the page ships as one
    file with no network dependency for layout.
    """
    with open(UTILITIES_PATH, encoding="utf-8") as fh:
        return strip_css_comments(fh.read())


def read_shell():
    """The HTML page with __PLACEHOLDER__ slots (including __DASHBOARD_JS__)."""
    with open(SHELL_PATH, encoding="utf-8") as fh:
        return re.sub(r"<!--(?!\[).*?-->\s*", "", fh.read(), flags=re.S)


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


_REGEX_PRECEDERS = "(,=:[!&|?{};+-*%<>~^"


def strip_js_line_comments(text):
    """Drop whole-line ``//`` comments from shipped JS (nothing else is minified).

    The source modules keep their comments for maintainers; the page does not
    need to ship ~100 KB of them. A small scanner tracks strings, template
    literals (with ``${}`` nesting), regex literals and ``/* */`` comments so a
    line that merely LOOKS like a comment inside a template literal or a block
    comment is kept verbatim, and ``/*! */`` licence comments survive.
    """
    out = []
    stack = []            # "`" when inside a template, "{" for a ${ } or plain brace
    in_block = False
    last = ""             # last significant code char, to tell regex from division
    for line in text.splitlines(True):
        in_tpl = bool(stack) and stack[-1] == "`"
        if not in_block and not in_tpl and line.lstrip().startswith("//"):
            continue
        out.append(line)
        i, n = 0, len(line)
        while i < n:
            c = line[i]
            if in_block:
                end = line.find("*/", i)
                if end < 0:
                    break
                in_block, i = False, end + 2
                continue
            if stack and stack[-1] == "`":
                if c == "\\":
                    i += 2
                elif c == "`":
                    stack.pop()
                    last, i = "`", i + 1
                elif c == "$" and line.startswith("${", i):
                    stack.append("{")
                    last, i = "{", i + 2
                else:
                    i += 1
                continue
            if c in "'\"":
                j = i + 1
                while j < n and line[j] != c:
                    j += 2 if line[j] == "\\" else 1
                last, i = c, j + 1
            elif c == "`":
                stack.append("`")
                i += 1
            elif c == "/" and line.startswith("//", i):
                break
            elif c == "/" and line.startswith("/*", i):
                in_block, i = True, i + 2
            elif c == "/" and (last == "" or last in _REGEX_PRECEDERS):
                j, cls = i + 1, False
                while j < n and (cls or line[j] != "/"):
                    if line[j] == "\\":
                        j += 1
                    elif line[j] == "[":
                        cls = True
                    elif line[j] == "]":
                        cls = False
                    j += 1
                last, i = "/", j + 1
            else:
                if c == "{":
                    stack.append("{")
                elif c == "}" and stack:
                    stack.pop()
                if not c.isspace():
                    last = c
                i += 1
    return "".join(out)


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
    body = strip_js_line_comments("".join(chunks))

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
