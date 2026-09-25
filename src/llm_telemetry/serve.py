#!/usr/bin/env python3
"""Static server for the analytics reports, with caching disabled.

Python's stock http.server sends only Last-Modified, so browsers happily serve a
stale dashboard.html from disk cache after a rebuild — which looks exactly like
"the feature was never shipped". Explicit no-store headers make every reload
fetch the current build.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from .config import get as _cfg

DIRECTORY = str(_cfg().reports_dir)


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # the journal does not need a line per poll


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8477
    handler = partial(NoCacheHandler, directory=DIRECTORY)
    with ThreadingHTTPServer(("0.0.0.0", port), handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
