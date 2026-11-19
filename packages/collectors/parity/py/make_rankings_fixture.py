#!/usr/bin/env python3
"""Generate the rankings parity fixture (T-16, LLMTELEMET-287).

Usage: make_rankings_fixture.py OUT_DIR

Writes OUT_DIR/rankings-response.json, a canned OpenRouter rankings-daily
response (30 days ending 2026-11-16: 14 models + the reserved 'other' row, a
model that only appears in the second half (trend None), string token counts,
an unparseable token count and a float one), which BOTH producers feed to the
real collector through an injected fetcher. No network, no key.
"""
import json
import os
import sys

DAYS = 30
END = "2026-11-16"
MODELS = ["m/alpha", "m/beta", "m/gamma", "m/delta", "m/eps", "m/zeta", "m/eta", "m/theta",
          "m/iota", "m/kappa", "m/lambda", "m/mu", "m/nu", "m/xi"]


def day(i):
    import datetime
    d = datetime.date.fromisoformat(END) - datetime.timedelta(days=DAYS - 1 - i)
    return d.isoformat()


def main(argv):
    if len(argv) != 1:
        sys.stderr.write("usage: make_rankings_fixture.py OUT_DIR\n")
        return 2
    out = os.path.abspath(argv[0])
    os.makedirs(out, exist_ok=True)
    rows = []
    for i in range(DAYS):
        for j, m in enumerate(MODELS):
            if m == "m/xi" and i < DAYS // 2:
                continue  # new model: no first-half history
            tokens = (1000 + 37 * i * (j + 1) + 100000 // (j + 1)) * (1 + (i % 3 == 0))
            rows.append({"date": day(i), "model_permaslug": m, "total_tokens": str(tokens)})
        rows.append({"date": day(i), "model_permaslug": "other", "total_tokens": str(5000 + i)})
    rows.append({"date": day(29), "model_permaslug": "m/bad", "total_tokens": "lots"})
    rows.append({"date": day(29), "model_permaslug": "m/float", "total_tokens": 5.0})
    rows.append({"date": day(28), "model_permaslug": "m/tie-b", "total_tokens": "7"})
    rows.append({"date": day(28), "model_permaslug": "m/tie-a", "total_tokens": "7"})
    resp = {"data": rows, "meta": {"as_of": "2026-11-17T00:00:00Z", "rows": len(rows)}}
    with open(os.path.join(out, "rankings-response.json"), "w", encoding="utf-8") as fh:
        json.dump(resp, fh)
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
