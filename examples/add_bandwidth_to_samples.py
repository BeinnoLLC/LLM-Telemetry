#!/usr/bin/env python3
"""Add bandwidth fields to the committed SAMPLE live payload.

Sample fixtures predate up_bytes/down_bytes/lan_*. Regenerating from a real DB
is not an option (that path reads the developer's real ~/.hermes - see #50/#55),
so the synthetic payload is extended in place, keeping the shape real data has:
upload dominated by re-sent context, and MIXED endpoints per session (all seven
live sessions in the real DB had both LAN and internet traffic).
"""
import json
import os
import random

random.seed(11)
HERE = os.path.dirname(os.path.abspath(__file__))
LIVE = os.path.join(HERE, "reports", "live-data.json")

BYTES_PER_TOKEN = 4.68
LOCAL_HINTS = ("qwen", "gpt-oss", "nemotron", "llama", "mistral", "phi", "gemma")

with open(LIVE) as f:
    d = json.load(f)

d["bytes_per_token"] = BYTES_PER_TOKEN

n = 0
for prof in d.get("profiles", {}).values():
    for L in prof.get("live", []):
        model = (L.get("model") or "").lower()
        url = (L.get("base_url") or "").lower()
        mostly_local = any(h in model for h in LOCAL_HINTS) or "internal" in url

        # Upload dominates because context is re-sent on every call; real ratio
        # is ~290:1, so the synthetic rows keep that shape.
        up_tok = random.randint(400_000, 40_000_000)
        down_tok = max(1, int(up_tok / random.uniform(180, 380)))

        # Every real live session used BOTH a local and a hosted endpoint, so the
        # sample must too - a fixture where the buckets never overlap would hide
        # exactly the misattribution bug this split exists to prevent.
        lan_share = 0.80 if mostly_local else 0.06
        lan_up = int(up_tok * lan_share)
        lan_down = int(down_tok * lan_share)

        L["up_bytes"] = int((up_tok - lan_up) * BYTES_PER_TOKEN)
        L["down_bytes"] = int((down_tok - lan_down) * BYTES_PER_TOKEN)
        L["lan_up_bytes"] = int(lan_up * BYTES_PER_TOKEN)
        L["lan_down_bytes"] = int(lan_down * BYTES_PER_TOKEN)
        # True only when every byte stayed on the LAN.
        L["bw_local"] = L["up_bytes"] == 0 and L["down_bytes"] == 0
        L.pop("up_tok", None)
        L.pop("down_tok", None)
        n += 1

with open(LIVE, "w") as f:
    json.dump(d, f, separators=(",", ":"))

print(f"added bandwidth fields to {n} live sessions in {LIVE}")
print(f"bytes_per_token = {BYTES_PER_TOKEN}")
