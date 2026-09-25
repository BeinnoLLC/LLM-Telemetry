#!/usr/bin/env python3
"""Probe every configured Ollama endpoint and summarise load + capabilities.

Output: reports/ollama-data.json, consumed by the dashboard's Live tab.

WHY A SEPARATE COLLECTOR
------------------------
collect_live.py runs every 5s. Probing four endpoints (two of them over HTTPS at
~450ms each) inside that loop would make the live panel stall on network I/O, so
this runs on its own slower timer and collect_live.py just reads the cached file.

PHYSICAL HOSTS vs URLS
----------------------
Several URLs can be the SAME machine (an alias hostname and the box's LAN IP
both resolving to one host). Reporting them as separate servers would
triple-count VRAM and hide the fact that "spreading load across endpoints" is
really hammering one GPU. Endpoints are therefore fingerprinted and grouped:
identical (model list + loaded-model expiry) == same box.

OLLAMA JSON IS NOT ALWAYS VALID
-------------------------------
/api/show embeds the prompt template with RAW newlines inside a JSON string, so
json.loads() rejects it (even strict=False). Capabilities are pulled with jq,
which tolerates it, and cached — they are static per model.
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

from .config import get as _cfg

CFG = _cfg()


def _named_local(url: str) -> bool:
    """A configured local host that is not on the default Ollama port."""
    return any(h in (url or "") for h in CFG.local_host_patterns)
OUT = str(CFG.reports_dir / "ollama-data.json")
CAPS_CACHE = str(CFG.reports_dir / ".ollama-caps.json")
TIMEOUT = 6
CAPS_TTL = 24 * 3600

# Endpoints are discovered from the configs so a new host appears here the
# moment it is routed to, instead of needing this list kept in sync by hand.
CONFIGS = [str(p.config) for p in CFG.live_profiles()]


def discover():
    """Every distinct Ollama base URL mentioned in any profile config."""
    seen, out = set(), []
    pat = re.compile(r"https?://[\w.\-]+(?::\d+)?(?=/v1|/?\s*$)")
    for cfg in CONFIGS:
        try:
            txt = open(cfg).read()
        except OSError:
            continue
        for line in txt.splitlines():
            if "base_url" not in line and "api:" not in line:
                continue
            for m in pat.findall(line):
                base = m.rstrip("/")
                # Only Ollama-shaped endpoints: :11434 or a configured local host.
                if ":11434" not in base and not _named_local(base):
                    continue
                # localhost and 127.0.0.1 are the same interface as the LAN IP on
                # this box; keep them out so one machine is not listed twice.
                if "localhost" in base or "127.0.0.1" in base:
                    continue
                if base not in seen:
                    seen.add(base)
                    out.append(base)
    return out


def get(url, timeout=TIMEOUT):
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "hermes-dash"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8", "replace")
    return body, (time.time() - t0) * 1000


def jget(url, timeout=TIMEOUT):
    body, ms = get(url, timeout)
    return json.loads(body), ms


def caps_for(base, model, cache):
    """Model capabilities via jq (see module docstring on invalid JSON)."""
    key = model
    now = time.time()
    hit = cache.get(key)
    if hit and now - hit.get("ts", 0) < CAPS_TTL:
        return hit.get("caps", [])
    try:
        p = subprocess.run(
            ["curl", "-s", "-m", str(TIMEOUT), f"{base}/api/show",
             "-d", json.dumps({"model": model})],
            capture_output=True, text=True, timeout=TIMEOUT + 3)
        q = subprocess.run(["jq", "-c", ".capabilities // []"],
                           input=p.stdout, capture_output=True, text=True, timeout=10)
        caps = json.loads(q.stdout or "[]")
    except Exception:
        caps = []
    cache[key] = {"ts": now, "caps": caps}
    return caps


def probe(base, cache):
    """One endpoint: liveness, latency, loaded models, installed catalogue."""
    e = {"base": base, "up": False, "err": None, "ms": None, "version": None,
         "loaded": [], "installed": 0, "catalog": [], "vram": 0, "spill": 0}
    try:
        v, ms = jget(f"{base}/api/version")
        e["up"], e["version"], e["ms"] = True, v.get("version"), round(ms)
    except urllib.error.URLError as ex:
        e["err"] = str(getattr(ex, "reason", ex))[:80]
        return e
    except Exception as ex:
        e["err"] = str(ex)[:80]
        return e

    try:
        ps, ps_ms = jget(f"{base}/api/ps")
        e["ps_ms"] = round(ps_ms)
        for m in ps.get("models", []):
            size = m.get("size", 0) or 0
            vram = m.get("size_vram", 0) or 0
            e["loaded"].append({
                "name": m.get("name") or m.get("model"),
                "size": size, "vram": vram,
                # Residency < 100% means Ollama spilled layers to system RAM and
                # the model is running partly on CPU — the single most useful
                # "why is this host slow" signal Ollama exposes.
                "res": round(vram / size * 100) if size else 0,
                "ctx": m.get("context_length"),
                "expires": m.get("expires_at"),
                "caps": caps_for(base, m.get("name") or "", cache),
            })
        e["vram"] = sum(x["vram"] for x in e["loaded"])
        e["spill"] = sum(max(0, x["size"] - x["vram"]) for x in e["loaded"])
    except Exception as ex:
        e["err"] = f"ps: {str(ex)[:60]}"

    try:
        tags, _ = jget(f"{base}/api/tags")
        models = tags.get("models", [])
        e["installed"] = len(models)
        e["catalog"] = sorted(
            [{"name": m["name"], "size": m.get("size", 0),
              "par": (m.get("details") or {}).get("parameter_size"),
              "quant": (m.get("details") or {}).get("quantization_level")}
             for m in models], key=lambda x: -x["size"])
        e["fp"] = ",".join(sorted(m["name"] for m in models))
    except Exception:
        e["fp"] = ""
    return e


def group(endpoints):
    """Collapse endpoints that are demonstrably the same machine.

    Fingerprint = installed model list + the loaded models' exact expiry
    timestamps. Two genuinely separate boxes will not share a keep-alive expiry
    down to the second, so this does not over-merge; when nothing is loaded it
    falls back to the model list alone.
    """
    hosts = {}
    for e in endpoints:
        exp = "|".join(sorted(str(m.get("expires")) for m in e["loaded"]))
        key = f"{e.get('fp','')}##{exp}" if e["up"] else f"down::{e['base']}"
        h = hosts.setdefault(key, {"urls": [], **{k: v for k, v in e.items()}})
        h["urls"].append({"base": e["base"], "ms": e["ms"], "up": e["up"]})
        # Prefer the fastest URL's latency as the host's response time.
        if e["up"] and (h.get("ms") is None or (e["ms"] or 9e9) < h["ms"]):
            h["ms"] = e["ms"]
    out = []
    for h in hosts.values():
        h.pop("base", None)
        h["urls"].sort(key=lambda u: (not u["up"], u["ms"] if u["ms"] is not None else 9e9))
        h["label"] = short_label(h["urls"])
        out.append(h)
    out.sort(key=lambda h: (not h["up"], h["label"]))
    return out


def short_label(urls):
    """Human name for a host: the LAN IP if we have one, else the hostname."""
    for u in urls:
        m = re.search(r"//(\d+\.\d+\.\d+\.\d+)", u["base"])
        if m:
            return m.group(1)
    m = re.search(r"//([\w.\-]+)", urls[0]["base"])
    return m.group(1).split(".")[0] if m else urls[0]["base"]


def local_work():
    """Recent local task volume per base URL, straight from the usage tables.

    Answers "what has actually been done locally", which /api/ps cannot: Ollama
    keeps no history once a model unloads.
    """
    import sqlite3
    out = {}
    dbs = [(str(p.db), p.name) for p in CFG.live_profiles()]
    q = """
    select u.billing_base_url, coalesce(nullif(u.task,''),'main') task, u.model,
           sum(u.api_call_count), sum(u.input_tokens+u.output_tokens),
           max(u.last_seen)
    from session_model_usage u
    where u.billing_base_url != '' and u.last_seen > strftime('%s','now') - 86400
    group by u.billing_base_url, task, u.model
    """
    for db, prof in dbs:
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=4)
            for url, task, model, calls, toks, last in con.execute(q):
                host = re.sub(r"/v1/?$", "", (url or "").rstrip("/"))
                if ":11434" not in host and not _named_local(host):
                    continue
                d = out.setdefault(host, {"calls": 0, "tokens": 0, "last": 0,
                                          "tasks": {}, "models": {}, "profiles": set()})
                d["calls"] += calls or 0
                d["tokens"] += toks or 0
                d["last"] = max(d["last"], last or 0)
                d["tasks"][task] = d["tasks"].get(task, 0) + (calls or 0)
                d["models"][model] = d["models"].get(model, 0) + (calls or 0)
                d["profiles"].add(prof)
            con.close()
        except Exception:
            continue
    for d in out.values():
        d["profiles"] = sorted(d["profiles"])
    return out


def inflight():
    """Requests currently in flight per host, from Hermes's own session tables.

    Ollama exposes NO queue depth (/api/ps lists resident models, /metrics is
    404), so the earlier "queue" bar had no data source at all and was pinned
    to zero forever. Hermes knows what it dispatched and has not finished, so
    the depth is derived here instead of invented.
    """
    import sqlite3
    out = {}
    dbs = [str(p.db) for p in CFG.live_profiles()]
    q = """
    select u.billing_base_url, count(*)
    from session_model_usage u join sessions s on s.id = u.session_id
    where s.ended_at is null and u.billing_base_url != ''
      and u.last_seen > strftime('%s','now') - 90
    group by u.billing_base_url
    """
    for db in dbs:
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=4)
            for url, n in con.execute(q):
                host = re.sub(r"/v1/?$", "", (url or "").rstrip("/"))
                out[host] = out.get(host, 0) + (n or 0)
            con.close()
        except Exception:
            continue
    return out


def local_ips():
    """IPs of THIS machine, so a host we can measure directly is recognised."""
    ips = {"127.0.0.1", "localhost"}
    try:
        r = subprocess.run(["hostname", "-I"], capture_output=True, text=True, timeout=4)
        ips.update(r.stdout.split())
    except Exception:
        pass
    return ips


def machine_load():
    """CPU + GPU utilisation for the LOCAL box only.

    Remote Ollama hosts expose no telemetry, so rather than guess, they simply
    carry no cpu/gpu fields and the UI omits those bars for them.
    """
    out = {}
    try:
        with open("/proc/loadavg") as f:
            la = float(f.read().split()[0])
        ncpu = os.cpu_count() or 1
        out["cpu"] = round(min(100.0, la / ncpu * 100), 1)
        out["load1"] = la
        out["ncpu"] = ncpu
    except Exception:
        pass
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,name,utilization.gpu,memory.used,"
             "memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=6)
        gpus = []
        for line in r.stdout.strip().splitlines():
            parts = [x.strip() for x in line.split(",")]
            if len(parts) < 6:
                continue
            gpus.append({"i": int(parts[0]), "name": parts[1],
                         "util": float(parts[2]), "used": float(parts[3]),
                         "total": float(parts[4]), "temp": float(parts[5])})
        if gpus:
            out["gpus"] = gpus
            out["gpu"] = round(sum(g["util"] for g in gpus) / len(gpus), 1)
            tot = sum(g["total"] for g in gpus) or 1
            out["gpu_mem"] = round(sum(g["used"] for g in gpus) / tot * 100, 1)
    except Exception:
        pass
    return out


def main():
    try:
        cache = json.load(open(CAPS_CACHE))
    except Exception:
        cache = {}

    eps = [probe(b, cache) for b in discover()]
    hosts = group(eps)
    work = local_work()

    # Attach recorded work to whichever host serves that URL.
    for h in hosts:
        agg = {"calls": 0, "tokens": 0, "last": 0, "tasks": {}, "models": {}, "profiles": []}
        for u in h["urls"]:
            w = work.get(u["base"])
            if not w:
                continue
            agg["calls"] += w["calls"]
            agg["tokens"] += w["tokens"]
            agg["last"] = max(agg["last"], w["last"])
            for k, v in w["tasks"].items():
                agg["tasks"][k] = agg["tasks"].get(k, 0) + v
            for k, v in w["models"].items():
                agg["models"][k] = agg["models"].get(k, 0) + v
            agg["profiles"] = sorted(set(agg["profiles"]) | set(w["profiles"]))
        h["work"] = agg

    # Real queue depth + machine load. Both are attached per host: the queue is
    # derived from what Hermes dispatched to that host's URLs, and cpu/gpu are
    # only attached to the box we are actually running on (a remote Ollama
    # exposes no telemetry, so those bars are omitted rather than faked).
    flying = inflight()
    mine = local_ips()
    load = machine_load()
    for h in hosts:
        h["queue"] = sum(flying.get(u["base"], 0) for u in h["urls"])
        is_local = any(
            re.sub(r"^https?://", "", u["base"]).split(":")[0] in mine
            for u in h["urls"])
        h["is_self"] = is_local
        if is_local and load:
            h["load"] = load

    data = {"ts": int(time.time()), "hosts": hosts,
            "endpoints": len(eps), "physical": len(hosts)}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"), default=str)
    os.replace(tmp, OUT)
    try:
        json.dump(cache, open(CAPS_CACHE, "w"))
    except OSError:
        pass
    up = sum(1 for h in hosts if h["up"])
    print(f"{OUT}  ({len(eps)} endpoints -> {len(hosts)} hosts, {up} up)")


if __name__ == "__main__":
    sys.exit(main())
