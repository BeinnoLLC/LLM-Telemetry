"""Runtime configuration for llm-telemetry.

Everything the collectors need to know about THIS machine lives here: which
agent profiles to read, which inference hosts to probe, where to write reports.
Nothing else in the codebase may hardcode a profile name, a home directory or
an IP address -- that was the main thing blocking this from being a shareable
project rather than one person's setup.

Resolution order (first hit wins):
  1. $LLM_TELEMETRY_CONFIG                     -- explicit path, for tests/CI
  2. $XDG_CONFIG_HOME/llm-telemetry/config.json
  3. ~/.config/llm-telemetry/config.json
  4. built-in defaults + autodiscovery

Autodiscovery exists so `pip install && run` does something useful on a stock
Hermes install without writing a config first: it finds the default profile at
~/.hermes and any profile under ~/.hermes/profiles/*. Custom display names
(the labels you actually recognise) still require a config file, because a
directory called "research-2" cannot tell us you label it "Research".
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field, asdict, fields
from pathlib import Path
from typing import Any


def _expand(p: str) -> str:
    return os.path.abspath(os.path.expanduser(os.path.expandvars(p)))


@dataclass
class Profile:
    """One agent profile: a display name plus the directory holding its state.

    `home` is the profile root, NOT the database path -- the collectors derive
    state.db, config.yaml and logs/errors.log from it, so a profile that is
    missing one of those still works for the others.
    """

    name: str
    home: str

    def __post_init__(self) -> None:
        self.home = _expand(self.home)

    @property
    def db(self) -> str:
        return os.path.join(self.home, "state.db")

    @property
    def config(self) -> str:
        return os.path.join(self.home, "config.yaml")

    @property
    def errors_log(self) -> str:
        return os.path.join(self.home, "logs", "errors.log")

    def exists(self) -> bool:
        return os.path.exists(self.db)


@dataclass
class Config:
    profiles: list[Profile] = field(default_factory=list)
    # Inference endpoints to probe. Several URLs may front the SAME physical
    # box; the probe fingerprints them and merges aliases, so listing every
    # alias is correct and gives better labelling, not double counting.
    inference_endpoints: list[str] = field(default_factory=list)
    # Substrings that mark a base_url as self-hosted. RFC1918 ranges cover most
    # LANs; add your own hostnames here (the author's boxes were once hardcoded,
    # which silently misclassified everyone else's hosts as remote/billable).
    local_host_patterns: list[str] = field(default_factory=lambda: [
        "127.0.0.1", "localhost", "::1",
        "192.168.", "10.", "172.16.", "172.17.", "172.18.", "172.19.",
        "172.2", "172.30.", "172.31.", ".local", ".internal", ".lan",
    ])
    reports_dir: str = "~/.local/share/llm-telemetry/reports"
    # Hostnames that resolve publicly but actually front a LAN box. A reverse
    # proxy on a real domain is still LAN traffic: the bytes never leave the
    # house, so counting them as metered overstates internet usage. Maps a host
    # to the LAN endpoint it fronts, which also merges the two into one row
    # instead of reporting the same machine twice under different names.
    # Keys are matched against the URL's hostname, exactly.
    endpoint_aliases: dict[str, str] = field(default_factory=dict)
    port: int = 8477
    bind: str = "0.0.0.0"
    # Used to turn local GPU wattage into a cost figure so self-hosted models
    # can be compared against metered APIs on the same axis.
    # The whole power model (P7-02, #66), read by energy.local_rates() and
    # nowhere else. USD throughout; the old `currency` key was never read by
    # anything, so it was removed rather than left as a dead setting.
    electricity_rate_kwh: float = 0.047
    gpu_draw_watts: float = 350
    host_overhead_watts: float = 90
    # Where the agent keeps its profiles (P5-03). Resolved in load():
    # $LLM_TELEMETRY_AGENT_HOME > this key > ~/.hermes.
    agent_home: str = ""
    # Profile names to leave out even though they exist on disk (P5-02).
    exclude: list[str] = field(default_factory=list)
    # How the profile list was arrived at (P5-04): discovered, configured,
    # excluded and unreadable, each with a reason. Filled by load().
    resolution: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # Path, not str: collectors compose report paths as `reports_dir / x`,
        # and mkdir here means no collector has to guard against a missing dir.
        self.reports_dir = Path(_expand(self.reports_dir))
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        self.profiles = [
            p if isinstance(p, Profile) else Profile(**p) for p in self.profiles
        ]

    def profile(self, name: str) -> Profile | None:
        return next((p for p in self.profiles if p.name == name), None)

    def live_profiles(self) -> list[Profile]:
        """Profiles that actually have a database on disk.

        A configured-but-absent profile is skipped rather than fatal: people
        copy a config between machines and a missing profile should degrade to
        "not shown", not crash the collector.
        """
        return [p for p in self.profiles if p.exists()]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["reports_dir"] = str(self.reports_dir)
        d["profiles"] = [{"name": p.name, "home": p.home} for p in self.profiles]
        return d


def _candidate_paths() -> list[str]:
    out = []
    env = os.environ.get("LLM_TELEMETRY_CONFIG")
    if env:
        out.append(_expand(env))
    xdg = os.environ.get("XDG_CONFIG_HOME")
    if xdg:
        out.append(_expand(f"{xdg}/llm-telemetry/config.json"))
    out.append(_expand("~/.config/llm-telemetry/config.json"))
    return out


def autodiscover_profiles(agent_home: str = "~/.hermes") -> list[Profile]:
    """Find agent profiles without being told where they are.

    The default profile lives at the agent home itself; named profiles live one
    level down under profiles/. Only directories containing a state.db count,
    which keeps stray folders (caches, backups) out of the list.
    """
    home = _expand(agent_home)
    found: list[Profile] = []
    if os.path.exists(os.path.join(home, "state.db")):
        found.append(Profile(name="default", home=home))
    pdir = os.path.join(home, "profiles")
    if os.path.isdir(pdir):
        for entry in sorted(os.listdir(pdir)):
            sub = os.path.join(pdir, entry)
            if os.path.exists(os.path.join(sub, "state.db")):
                found.append(Profile(name=entry, home=sub))
    return found


def resolve_agent_home(configured=None):
    """Where the agent keeps its profiles (P5-03, #52).

    Precedence: $LLM_TELEMETRY_AGENT_HOME, then config agent_home, then
    ~/.hermes. Relative paths resolve against the current directory and ~ is
    expanded, so the same value means the same place wherever it is read.
    """
    env = os.environ.get("LLM_TELEMETRY_AGENT_HOME")
    if env:
        return _expand(env)
    if configured:
        return _expand(configured)
    return _expand("~/.hermes")


def resolve_profiles(configured, agent_home, exclude=()):
    """Merge configured profiles with discovered ones (P5-01/02, #50 #51).

    configured is None when the config file has no "profiles" key: pure
    autodiscovery. An empty list is an explicit request for zero profiles and
    is honoured (the old truthiness check turned [] into "discover
    everything", which is how the sample build read the real ~/.hermes).

    A non-empty list is a MODIFIER on discovery, not a replacement: configured
    entries win on a name collision, discovered profiles not named are
    appended, and exclude is the only way to drop one. The tool never
    silently omits a profile that exists on disk.

    Returns (profiles, report); the report is what P5-04 renders.
    """
    report = {"agent_home": agent_home, "discovered": [], "configured": [],
              "excluded": [], "failed": [], "mode": ""}
    exclude = set(exclude or ())

    if configured is not None and len(configured) == 0:
        report["mode"] = "explicit-empty"
        return [], report

    discovered = autodiscover_profiles(agent_home)
    report["discovered"] = [p.name for p in discovered]

    if configured is None:
        report["mode"] = "discovered"
        merged = list(discovered)
    else:
        report["mode"] = "merged"
        conf = [p if isinstance(p, Profile) else Profile(**p) for p in configured]
        report["configured"] = [p.name for p in conf]
        names = {p.name for p in conf}
        merged = conf + [p for p in discovered if p.name not in names]

    out = []
    for p in merged:
        if p.name in exclude:
            report["excluded"].append({"name": p.name, "reason": "listed in config exclude"})
            continue
        out.append(p)
    return out, report


def load(path=None):
    """Load config from disk; profiles come from resolve_profiles()."""
    paths = [_expand(path)] if path else _candidate_paths()
    raw = {}
    src = None
    for p in paths:
        if os.path.exists(p):
            with open(p) as f:
                raw = json.load(f)
            src = p
            break
    # Drop comment keys and unknown fields rather than crashing with a bare
    # TypeError. A config file is hand-edited: users add "_comment" notes, and
    # a stale key from an older version must not make the whole tool
    # unstartable. Unknown keys are reported so a typo is still discoverable.
    known = {f.name for f in fields(Config)}
    unknown = [k for k in raw if k not in known]
    if unknown:
        print(f"config: ignoring unknown key(s) in {src}: "
              f"{', '.join(sorted(unknown))}", file=sys.stderr)
    # "profiles" absent -> None (discover); present -> honoured, even if [].
    configured = raw.get("profiles") if "profiles" in raw else None
    kwargs = {k: v for k, v in raw.items() if k in known and k != "profiles"}
    cfg = Config(**kwargs)
    cfg.agent_home = resolve_agent_home(raw.get("agent_home"))
    if not os.path.isdir(cfg.agent_home) and configured != []:
        # An explicit error naming the path, not an empty profile list that
        # looks like "no usage yet".
        print(f"config: agent home not found: {cfg.agent_home} "
              f"(set LLM_TELEMETRY_AGENT_HOME or agent_home in the config)",
              file=sys.stderr)
    cfg.profiles, cfg.resolution = resolve_profiles(
        configured, cfg.agent_home, raw.get("exclude"))
    cfg.resolution["config_file"] = src
    if configured == []:
        print(f"config: {src} sets \"profiles\": [] -- no profiles will be read",
              file=sys.stderr)
    return cfg


_cached: Config | None = None


def get() -> Config:
    """Process-wide config singleton."""
    global _cached
    if _cached is None:
        _cached = load()
    return _cached
