#!/usr/bin/env python3
"""Host auto-detection: loopback endpoints are probed, not silently dropped.

probe_hosts' own contract is that several URLs can be the SAME machine
(module docstring: "an alias hostname and the box's LAN IP both resolving to
one host ... reporting them as separate servers would triple-count VRAM").
A profile config that happens to spell that machine as localhost used to be
excluded from discovery entirely ("same interface as the LAN IP on this box;
keep them out so one machine is not listed twice"), which also hid the box
from the Live tab whenever no config spelled it by its LAN address.

Acceptance locked here:
  * a loopback base_url is discovered under its own name, and additionally
    under each of this box's live IPv4 identities with the port preserved --
    identities come from local_ips() at runtime, never a literal address in
    the source (the project rule: nothing hardcodes a profile name, a home
    directory or an IP address);
  * a non-Ollama remote URL is still ignored;
  * a non-loopback LAN spelling is passed through untouched (no expansion);
  * discovery never emits a bare IPv6 address or a 169.254.* link-local --
    neither is usable as a URL host, and both produced phantom down cards;
  * _collapse_loopback_twins() folds a fully-down card whose every URL is an
    alternate spelling of a machine already up under another card, while a
    genuinely different down machine keeps its own card.

Env points at throwaway temp dirs BEFORE import, because probe_hosts reads
its Config at import time.
"""
import json
import os
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

tmp = tempfile.mkdtemp(prefix="probe-hosts-")
agent_home = os.path.join(tmp, "agent-home")
os.makedirs(agent_home)
open(os.path.join(agent_home, "state.db"), "w").close()  # live_profiles() needs it
with open(os.path.join(agent_home, "config.yaml"), "w") as fh:
    fh.write(
        "providers:\n"
        "  ollama_local:\n    base_url: http://localhost:11434/v1\n"
        "  hosted_api:\n    base_url: http://api.example.com:8080/v1\n"
        "  remote_ollama:\n    base_url: http://192.0.2.44:11434/v1\n"
    )
with open(os.path.join(tmp, "config.json"), "w") as fh:
    json.dump({"reports_dir": os.path.join(tmp, "reports")}, fh)
os.environ["LLM_TELEMETRY_CONFIG"] = os.path.join(tmp, "config.json")
os.environ["LLM_TELEMETRY_AGENT_HOME"] = agent_home

sys.path.insert(0, os.path.join(ROOT, "src"))
from llm_telemetry import probe_hosts as PH  # noqa: E402

p = f = 0


def chk(ok, label, extra=None):
    global p, f
    print(f"  {'OK  ' if ok else 'FAIL'} {label}{('  ' + str(extra)) if extra is not None else ''}")
    if ok:
        p += 1
    else:
        f += 1


found = PH.discover()
lan = {ip for ip in PH.local_ips()
       if ip.count(".") == 3 and not ip.startswith("169.254.") and ip != "127.0.0.1"}

chk("http://localhost:11434" in found,
    "a loopback base_url is discovered, not silently dropped", found)
chk({f"http://{ip}:11434" for ip in lan} <= set(found),
    "every live IPv4 identity of this box is probed, same port, from local_ips() "
    "at runtime -- no literal address in the source", sorted(lan))
chk("http://api.example.com:8080" not in found,
    "a non-Ollama remote URL is still ignored", found)
chk("http://192.0.2.44:11434" in found
    and not any(b.startswith("http://192.0.2.") and b != "http://192.0.2.44:11434" for b in found),
    "a non-loopback spelling passes through untouched -- expansion only applies to loopback", found)
chk(not any("::" in b or "://169.254." in b for b in found),
    "no bare-IPv6 or link-local spellings (both are unusable as a URL host and "
    "made phantom down cards)", found)

hosts = [
    {"up": True, "urls": [{"base": "http://127.0.0.1:11434"}]},
    {"up": False, "urls": [{"base": "http://192.0.2.9:11434"}]},   # same box, down LAN spelling
    {"up": False, "urls": [{"base": "http://192.0.2.77:11434"}]},  # genuinely another box, down
]
orig = PH.local_ips
PH.local_ips = lambda: {"127.0.0.1", "localhost", "192.0.2.9"}
try:
    kept = PH._collapse_loopback_twins(hosts)
finally:
    PH.local_ips = orig

chk(len(kept) == 2,
    "the down twin of a machine that is up is folded away, the unrelated down box survives",
    [h["urls"][0]["base"] for h in kept])
chk(any(h["up"] and h["urls"][0]["base"] == "http://127.0.0.1:11434" for h in kept)
    and any(h["urls"][0]["base"] == "http://192.0.2.77:11434" for h in kept),
    "the surviving pair is the up loopback card plus the genuinely-down box", kept)

print(f"\n{p} passed, {f} failed")
sys.exit(1 if f else 0)
