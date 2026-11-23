#!/usr/bin/env python3
"""T-19 (LLMTELEMET-290) live static oracle.

Starts the REAL `llm_telemetry.serve.NoCacheHandler` on an ephemeral
127.0.0.1 port with `directory` pointed at the harness's temp reports dir.
The port is printed on stdout so the TypeScript harness never has to pick or
guess one. It serves only that temp directory; no production service, build
or config file is touched.
"""

import functools
import sys
from http.server import ThreadingHTTPServer


def main() -> None:
    src, directory = sys.argv[1:3]
    sys.path.insert(0, src)
    from llm_telemetry.serve import NoCacheHandler  # noqa: E402

    handler = functools.partial(NoCacheHandler, directory=directory)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    try:
        print(server.server_port, flush=True)
        server.serve_forever(poll_interval=0.05)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
