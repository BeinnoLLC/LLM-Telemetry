"""Payload schema version (P1-01, #23).

Every JSON payload the collectors write carries ``schema_version``. The page
compares it against the same constant (baked in at build time) and refuses to
render a shape it does not understand, instead of drawing an empty dashboard.

Bump SCHEMA_VERSION whenever a payload's shape changes in a way an older page
(or an older collector) would misread.
"""

SCHEMA_VERSION = 1


def stamp(payload):
    """Return ``payload`` with ``schema_version`` set; mutates in place."""
    payload["schema_version"] = SCHEMA_VERSION
    return payload
