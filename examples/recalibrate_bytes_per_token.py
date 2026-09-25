#!/usr/bin/env python3
"""Re-derive BYTES_PER_TOKEN from a live agent DB.

The bandwidth figures in Phase 8 rest on one constant. This script reproduces it
so the number is checkable rather than folklore. Run it against any profile's
state.db:

    python3 examples/recalibrate_bytes_per_token.py ~/.hermes/state.db

Why a session-level join and not a per-message one: `messages.token_count` is
NULL for every row in practice, so bytes and tokens can only be paired at the
session grain, where `session_model_usage` has real counts.
"""
import sqlite3
import sys

Q_CALIBRATE = """
select s.id,
  (select sum(length(cast(coalesce(nullif(m.api_content,''),m.content) as blob))
              + coalesce(length(cast(m.tool_calls as blob)),0)
              + coalesce(length(cast(m.reasoning_content as blob)),0))
     from messages m where m.session_id = s.id) as body_bytes,
  (select sum(u.input_tokens)      from session_model_usage u where u.session_id = s.id) as inp,
  (select sum(u.output_tokens)     from session_model_usage u where u.session_id = s.id) as outp,
  (select sum(u.cache_read_tokens) from session_model_usage u where u.session_id = s.id) as cread
from sessions s
"""

Q_CACHE_MODE = """
select coalesce(nullif(billing_provider,''),'(none)') p,
       sum(cache_read_tokens), sum(cache_write_tokens), sum(api_call_count)
from session_model_usage
where cache_read_tokens > 0
group by p
order by sum(cache_read_tokens) desc
"""


def main(db: str) -> int:
    c = sqlite3.connect(db)
    rows = [r for r in c.execute(Q_CALIBRATE) if r[1] and (r[2] or r[3])]
    if not rows:
        print("no usable sessions in", db)
        return 1

    body = sum(r[1] for r in rows)
    inp = sum(r[2] or 0 for r in rows)
    outp = sum(r[3] or 0 for r in rows)
    cread = sum(r[4] or 0 for r in rows)

    # Calibrate against tokens whose text is actually STORED. cache_read is
    # re-sent context: it crosses the wire but was stored once, so including it
    # here would divide by a count the bytes never corresponded to.
    per_token = body / (inp + outp)

    print(f"sessions used        : {len(rows):>18,}")
    print(f"stored body bytes    : {body:>18,}")
    print(f"input tokens         : {inp:>18,}")
    print(f"output tokens        : {outp:>18,}")
    print(f"cache_read tokens    : {cread:>18,}")
    print()
    print(f"BYTES_PER_TOKEN      : {per_token:>18.2f}")
    print(f"  (sanity: ~4 expected for text; wild values mean the join is wrong)")
    print()
    share = 100 * cread / max(inp + cread, 1)
    print(f"cache_read share of prompt tokens : {share:5.1f}%")
    print(f"context re-sent                   : {(inp + cread) / max(inp, 1):5.1f}x")
    print()
    print("cache mode per provider (write>0 and large per-call => prefix caching,")
    print("i.e. the full prompt crosses the wire and counts as upload):")
    for p, cr, w, n in c.execute(Q_CACHE_MODE):
        print(f"  {p:<14} per_call={cr // max(n, 1):>10,}  cache_write={w:>15,}")
    return 0


if __name__ == "__main__":
    db = sys.argv[1] if len(sys.argv) > 1 else "~/.hermes/state.db"
    import os
    sys.exit(main(os.path.expanduser(db)))
