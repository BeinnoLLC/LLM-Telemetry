#!/usr/bin/env python3
"""Phase 5 profile resolution (#50 P5-01, #51 P5-02, #52 P5-03).

Every case runs against a temporary fixture agent home, never the developer's
real ~/.hermes.
"""
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
from llm_telemetry import config as C  # noqa: E402

# The cases below set the env var themselves where they mean to; an inherited
# value (CI exports one for the sample build) must not leak into the rest.
os.environ.pop("LLM_TELEMETRY_AGENT_HOME", None)

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra else ''}")
    if ok:
        p += 1
    else:
        f += 1


def make_home(root, names=("default", "alpha", "beta")):
    home = os.path.join(root, "agent")
    os.makedirs(home, exist_ok=True)
    for n in names:
        d = home if n == "default" else os.path.join(home, "profiles", n)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "state.db"), "w").close()
    return home


def load_with(root, cfg, env_home=None):
    path = os.path.join(root, "cfg.json")
    cfg = dict(cfg)
    cfg.setdefault("reports_dir", os.path.join(root, "reports"))
    with open(path, "w") as fh:
        json.dump(cfg, fh)
    old = os.environ.pop("LLM_TELEMETRY_AGENT_HOME", None)
    if env_home:
        os.environ["LLM_TELEMETRY_AGENT_HOME"] = env_home
    try:
        return C.load(path)
    finally:
        os.environ.pop("LLM_TELEMETRY_AGENT_HOME", None)
        if old is not None:
            os.environ["LLM_TELEMETRY_AGENT_HOME"] = old


names = lambda cfg: [x.name for x in cfg.profiles]

with tempfile.TemporaryDirectory() as root:
    home = make_home(root)

    # ---- #50 P5-01: absent vs empty ---------------------------------------
    c = load_with(root, {"agent_home": home})
    chk(names(c) == ["default", "alpha", "beta"], "absent key autodiscovers", names(c))
    chk(c.resolution["mode"] == "discovered", "resolution says discovered")

    c = load_with(root, {"agent_home": home, "profiles": []})
    chk(names(c) == [], "\"profiles\": [] yields zero profiles", names(c))
    chk(c.resolution["mode"] == "explicit-empty", "resolution says explicit-empty")

    # ---- #51 P5-02: merge, collision, exclude -----------------------------
    custom = os.path.join(root, "elsewhere")
    os.makedirs(custom)
    c = load_with(root, {"agent_home": home,
                         "profiles": [{"name": "alpha", "home": custom},
                                      {"name": "extra", "home": custom}]})
    chk(names(c) == ["alpha", "extra", "default", "beta"],
        "configured first, undiscovered-by-config appended", names(c))
    chk(c.profile("alpha").home == os.path.abspath(custom),
        "config entry wins on a name collision", c.profile("alpha").home)

    c = load_with(root, {"agent_home": home, "exclude": ["beta"]})
    chk(names(c) == ["default", "alpha"], "exclude drops a profile", names(c))
    ex = c.resolution["excluded"]
    chk(ex and ex[0]["name"] == "beta" and ex[0]["reason"], "exclusion is reported with a reason", ex)

    # ---- #52 P5-03: agent home precedence ---------------------------------
    other = make_home(os.path.join(root, "o"), names=("default", "gamma"))
    c = load_with(root, {"agent_home": home}, env_home=other)
    chk(names(c) == ["default", "gamma"], "env var overrides config", names(c))
    c = load_with(root, {"agent_home": home})
    chk(c.agent_home == os.path.abspath(home), "config overrides the default", c.agent_home)

    cwd = os.getcwd()
    os.chdir(root)
    try:
        c = load_with(root, {"agent_home": "agent"})
    finally:
        os.chdir(cwd)
    chk(c.agent_home == os.path.abspath(home), "relative path resolves against cwd", c.agent_home)

    chk(C.resolve_agent_home("~/x") == os.path.join(os.path.expanduser("~"), "x"),
        "~ expands", C.resolve_agent_home("~/x"))

    import io
    import contextlib
    err = io.StringIO()
    missing = os.path.join(root, "nope")
    with contextlib.redirect_stderr(err):
        c = load_with(root, {"agent_home": missing})
    chk(missing in err.getvalue(), "missing agent home is an error naming the path", err.getvalue().strip()[:90])
    chk(names(c) == [], "missing home discovers nothing", names(c))

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
