"""Settle #73 empirically: does the client gzip request bodies on the wire?

Absence of a grep hit is weak evidence. This starts a real HTTP server, sends a
large JSON body through the exact client stack the agent uses (httpx, and the
anthropic SDK's transport), and reports what actually arrived.
"""
import gzip
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

CAPTURED = []


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        CAPTURED.append({
            "content_encoding": self.headers.get("Content-Encoding"),
            "accept_encoding": self.headers.get("Accept-Encoding"),
            "bytes_on_wire": len(body),
            "starts_with_gzip_magic": body[:2] == b"\x1f\x8b",
        })
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# A realistic prompt payload: highly compressible repeated conversation text.
payload = {"messages": [{"role": "user", "content": "explain this code " * 400}] * 12}
raw = json.dumps(payload).encode()
print(f"payload raw          : {len(raw):,} bytes")
print(f"payload if gzipped   : {len(gzip.compress(raw)):,} bytes"
      f"  ({len(raw)/len(gzip.compress(raw)):.2f}x)")
print()

import httpx
httpx.post(f"http://127.0.0.1:{port}/v1/messages", json=payload, timeout=30)
c = CAPTURED[-1]
print("httpx (the agent's HTTP client):")
print(f"  Content-Encoding    : {c['content_encoding']}")
print(f"  bytes on the wire   : {c['bytes_on_wire']:,}")
print(f"  gzip magic bytes    : {c['starts_with_gzip_magic']}")
print(f"  VERDICT             : {'GZIPPED' if c['starts_with_gzip_magic'] else 'RAW — not compressed'}")
print()

try:
    from anthropic import Anthropic
    cl = Anthropic(api_key="probe-not-a-real-key", base_url=f"http://127.0.0.1:{port}")
    try:
        cl.messages.create(model="x", max_tokens=1,
                           messages=[{"role": "user", "content": "explain this code " * 400}])
    except Exception:
        pass
    if len(CAPTURED) > 1:
        c = CAPTURED[-1]
        print("anthropic SDK:")
        print(f"  Content-Encoding    : {c['content_encoding']}")
        print(f"  bytes on the wire   : {c['bytes_on_wire']:,}")
        print(f"  VERDICT             : "
              f"{'GZIPPED' if c['starts_with_gzip_magic'] else 'RAW — not compressed'}")
except ImportError:
    print("anthropic SDK not importable here")

srv.shutdown()