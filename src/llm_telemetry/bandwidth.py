"""Wire-bandwidth estimation, defined once.

Every bandwidth number in this project is DERIVED, never measured. The agent DB
records tokens, not bytes: there are no byte counters in the schema and
`messages.token_count` is NULL in all 425,427 rows. So bytes are estimated as
`tokens x BYTES_PER_TOKEN`, and every figure built on that must be labelled as
an estimate wherever a user can read it.

This module exists so the constant and the classification rule have exactly one
home. They were previously inlined in the live collector, which meant the
dashboard tables and the live view could silently disagree.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from .config import get as _get_config

# Calibrated against real data: 269 sessions, 560 MB of stored message bodies
# against 121M in+out tokens. Reproduce with examples/recalibrate_bytes_per_token.py
# (it drifts as the DB grows — it read 4.62 once and 4.68 later), which is why
# P8-04 stores the constant alongside each persisted row rather than assuming
# today's value applies to history.
BYTES_PER_TOKEN = 4.68

# Request bodies are NOT gzipped. Settled empirically in #73 by capturing a real
# request on loopback: an 86,810-byte payload that gzips to 326 bytes went out
# at 86,762 bytes with no Content-Encoding, through both httpx and the Anthropic
# SDK. Reproduce with examples/probe_request_gzip.py. Do not reintroduce a
# compression factor without re-running that probe.
REQUEST_BODIES_COMPRESSED = False


def estimate_bytes(tokens: float | int | None) -> int:
    """Tokens to estimated wire bytes. The one place the constant is applied."""
    return int((tokens or 0) * BYTES_PER_TOKEN)


def upload_tokens(input_tokens, cache_read, cache_write=None) -> int:
    """Tokens that cross the wire on the way OUT, per request.

    cache_read is included deliberately. Every provider here uses PREFIX
    caching, not handle caching: the client re-sends the whole prompt and the
    server charges less for the matched prefix. Confirmed from live data —
    Anthropic reports cache_write > 0 alongside ~146k cache_read tokens per
    call, which only happens if the text was actually transmitted.

    This is why the traffic is upload-dominated (~290:1): 97.6% of prompt
    tokens are cache reads, so context is re-sent roughly 42x per unique byte.
    """
    total = (input_tokens or 0) + (cache_read or 0)
    if cache_write:
        # Written-to-cache tokens were also sent; they are usually a subset of
        # input_tokens, so only count any excess to avoid double counting.
        total = max(total, (cache_write or 0))
    return int(total)


def is_lan(base_url: str | None) -> bool:
    """True when an endpoint is self-hosted, so its traffic never leaves the LAN.

    Classification is per ENDPOINT, not per session. Measured on the live DB,
    all 7 active sessions used both a local and a hosted endpoint, so a
    per-session flag misattributed 4.6 GB of metered traffic as free LAN bytes.

    Matching is against the parsed HOSTNAME, never the raw URL. The configured
    patterns are host fragments like "10." and ".local"; substring-matching them
    against a full URL classifies `https://api.openai.com/v1/model-10.2` as LAN
    and silently hides metered traffic. Anchoring also matters: a trailing-dot
    prefix ("10.") must match the start of the host, and a leading-dot suffix
    (".local") must match the end.
    """
    if not base_url:
        return False
    host = urlsplit(base_url if "//" in base_url else "//" + base_url).hostname
    if not host:
        return False
    host = host.lower()
    for raw in _get_config().local_host_patterns:
        p = raw.lower()
        if p.startswith("."):
            if host.endswith(p):
                return True
        elif p.endswith("."):
            if host.startswith(p):
                return True
        elif host == p or host.startswith(p + "."):
            return True
    return False


def split_row(base_url, input_tokens, output_tokens, cache_read, cache_write=None):
    """Estimated (up, down) bytes for one usage row, bucketed by destination.

    Returns a 4-tuple: (up, down, lan_up, lan_down). Exactly one bucket is
    non-zero for a given row, because a row belongs to a single endpoint.
    """
    up = estimate_bytes(upload_tokens(input_tokens, cache_read, cache_write))
    down = estimate_bytes(output_tokens)
    if is_lan(base_url):
        return 0, 0, up, down
    return up, down, 0, 0