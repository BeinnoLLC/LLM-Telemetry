"""LST-269 (H-2): /api/hive and /api/hive/stream on an ephemeral port.

Drives the real NoCacheHandler + HiveFeed with an injected collector (no /proc,
no ssh, no ~/.hermes); all timestamps are now-relative.
"""
import http.client
import json
import os
import sys
import threading
import time
from functools import partial
from http.server import ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from llm_telemetry import hive, serve  # noqa: E402
from llm_telemetry.schema import SCHEMA_VERSION, stamp  # noqa: E402


class Fake:
    """A collector whose task list the test mutates between ticks."""

    def __init__(self):
        self.tasks = {}
        self.comms = []
        self.user = {"state": "idle"}

    def __call__(self):
        return stamp({"kind": "hive", "at": time.time(),
                      "families": [{"id": "root", "label": "Root", "brains": [], "bots": []}],
                      "comms": list(self.comms), "hosts": [], "unattributed": [],
                      "user": dict(self.user), "pressure": {}, "tasks": dict(self.tasks)})


def task(status):
    return {"family": "root", "brain": "b", "board": "B", "agent": "a", "status": status, "title": "t"}


@pytest.fixture
def env(tmp_path, monkeypatch):
    fake = Fake()
    feed = hive.HiveFeed(fake, interval=3600, ring=8)   # ticks are driven by the test
    feed.tick()
    prev = serve.set_hive_feed(feed)
    monkeypatch.setattr(serve, "HIVE_HEARTBEAT_S", 0.3)
    handler = partial(serve.NoCacheHandler, directory=str(tmp_path))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    # feed.start() would spawn the poller; mark it started so tick() stays manual
    feed._thread = t
    yield httpd.server_address[1], fake, feed
    httpd.shutdown()
    httpd.server_close()
    serve.set_hive_feed(prev)


def get(port, path, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("GET", path, headers=headers or {})
    r = c.getresponse()
    return r, r.read()


class Stream:
    """close() hangs up the socket; http.client hands it to the response."""

    def __init__(self, resp):
        self.resp = resp

    def close(self):
        self.resp.close()


def open_stream(port, path="/api/hive/stream", headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("GET", path, headers=headers or {})
    r = c.getresponse()
    return Stream(r), r


def read_frame(r):
    """One SSE block (up to the blank line) -> dict of fields; comments under '#'."""
    out = {}
    while True:
        line = r.fp.readline().decode()
        if line in ("\n", "\r\n"):
            if out:
                return out
            continue
        assert line, "stream closed"
        if line.startswith(":"):
            return {"#": line[1:].strip()}
        k, _, v = line.rstrip("\n").partition(": ")
        out[k] = v


def wait_for(cond, t=3.0):
    end = time.time() + t
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def test_snapshot_is_schema_stamped(env):
    port, _, _ = env
    r, body = get(port, "/api/hive")
    d = json.loads(body)
    assert r.status == 200 and r.getheader("Content-Type") == "application/json"
    assert d["schema_version"] == SCHEMA_VERSION and d["type"] == "snapshot"
    assert d["seq"] == 0 and d["families"][0]["id"] == "root"
    assert abs(d["at"] - time.time()) < 30 and "collect_s" in d


def test_since_replays_exactly_the_missed_frames(env):
    port, fake, feed = env
    fake.tasks = {"root:1": task("running")}
    feed.tick()                      # seq 1: new
    fake.tasks = {"root:1": task("done")}
    feed.tick()                      # seq 2: status
    d = json.loads(get(port, "/api/hive?since=0")[1])
    assert d["type"] == "delta" and (d["from"], d["to"]) == (0, 2)
    assert [e["seq"] for e in d["events"]] == [1, 2]
    assert [e["kind"] for e in d["events"]] == ["new", "status"]
    d = json.loads(get(port, "/api/hive?since=1")[1])
    assert [e["seq"] for e in d["events"]] == [2] and d["events"][0]["from"] == "running"
    d = json.loads(get(port, "/api/hive?since=2")[1])
    assert d["type"] == "delta" and d["events"] == []


def test_since_outside_ring_resets(env):
    port, fake, feed = env
    for i in range(12):              # ring holds 8; seq runs to 12
        fake.tasks = {f"root:{i}": task("running")}
        feed.tick()
    d = json.loads(get(port, "/api/hive?since=1")[1])
    assert d["type"] == "reset" and d["snapshot"]["seq"] == feed.snapshot()["seq"]
    d = json.loads(get(port, "/api/hive?since=99999")[1])   # from a previous server run
    assert d["type"] == "reset"
    assert get(port, "/api/hive?since=x")[0].status == 400


def test_first_tick_emits_no_events_and_comms_are_deduped(env):
    port, fake, feed = env
    assert json.loads(get(port, "/api/hive?since=0")[1])["events"] == []
    fake.comms = [{"id": "bc:1", "from": "hazem", "to": "donna", "text": "hi"}]
    feed.tick()
    feed.tick()                      # same comm again: no second frame
    ev = json.loads(get(port, "/api/hive?since=0")[1])["events"]
    assert [e["type"] for e in ev] == ["comm"] and ev[0]["id"] == "bc:1"


def test_stream_framing_snapshot_then_delta(env):
    port, fake, feed = env
    c, r = open_stream(port)
    assert r.status == 200
    assert r.getheader("Content-Type") == "text/event-stream"
    assert "no-store" in r.getheader("Cache-Control")
    f = read_frame(r)
    assert f["event"] == "snapshot" and f["id"] == "0"
    assert json.loads(f["data"])["schema_version"] == SCHEMA_VERSION
    fake.tasks = {"root:1": task("running")}
    feed.tick()
    f = read_frame(r)
    assert f["event"] == "delta" and f["id"] == "1"
    assert json.loads(f["data"])["kind"] == "new"
    c.close()


def test_stream_heartbeat(env):
    port, _, _ = env
    c, r = open_stream(port)
    read_frame(r)
    t0 = time.time()
    f = read_frame(r)
    assert f == {"#": "heartbeat"} and time.time() - t0 < 2
    c.close()


def test_last_event_id_resume(env):
    port, fake, feed = env
    for i in range(3):
        fake.tasks = {f"root:{i}": task("running")}
        feed.tick()
    c, r = open_stream(port, headers={"Last-Event-ID": "1"})
    got = [read_frame(r), read_frame(r)]
    assert [g["id"] for g in got] == ["2", "3"] and {g["event"] for g in got} == {"delta"}
    c.close()
    c, r = open_stream(port, "/api/hive/stream?last=99999")   # gap -> fresh snapshot
    f = read_frame(r)
    assert f["event"] == "snapshot" and f["id"] == "3"
    c.close()


def test_stream_cap_then_503_and_slot_freed_on_disconnect(env):
    port, _, _ = env
    held = []
    for _ in range(serve.HIVE_MAX_STREAMS):
        c, r = open_stream(port)
        assert r.status == 200
        read_frame(r)
        held.append(c)
    assert serve.hive_streams() == serve.HIVE_MAX_STREAMS
    r, _ = get(port, "/api/hive/stream")
    assert r.status == 503 and r.getheader("Retry-After")
    held.pop().close()               # broken client frees its slot (and thread)
    assert wait_for(lambda: serve.hive_streams() == serve.HIVE_MAX_STREAMS - 1)
    c, r = open_stream(port)
    assert r.status == 200
    c.close()
    for c in held:
        c.close()
    assert wait_for(lambda: serve.hive_streams() == 0)


def test_abrupt_disconnect_does_not_crash_server(env):
    port, fake, feed = env
    c, r = open_stream(port)
    read_frame(r)
    c.close()
    fake.tasks = {"root:1": task("running")}
    feed.tick()
    assert wait_for(lambda: serve.hive_streams() == 0)
    assert get(port, "/api/hive")[0].status == 200
    assert get(port, "/api/settings")[0].status == 200


def test_other_routes_unchanged(env):
    port, _, _ = env
    r, body = get(port, "/api/settings")
    assert r.status == 200 and "values" in json.loads(body)
    assert get(port, "/nope.html")[0].status == 404
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    c.request("POST", "/api/refresh")   # no header: guard still rejects
    assert c.getresponse().status == 403
