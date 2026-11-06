import datetime as dt
import json
import pathlib
import queue
import sqlite3
import tempfile
import threading
import time
import unittest

from dashboard_write_client import WriteClientError
from dashboard_write_outbox import Outbox
from dashboard_write_protocol import serve_writer

DRAFT = "22222222-2222-4222-8222-222222222222"
GENERATION = "a" * 64


class Pipe:
    def __init__(self):
        self.items = queue.Queue()
        self.remainder = b""

    def readline(self, size):
        raw = self.remainder or self.items.get(timeout=4)
        self.remainder = raw[size:]
        return raw[:size]

    def write(self, value):
        self.items.put(value)

    def flush(self):
        pass


class FakeClient:
    def __init__(self):
        self.calls = []
        self.uncertain = False
        self.status_state = "prepared"
        self.last_request = None

    def prepare(self, request, op, args):
        self.calls.append(("prepare", request, op, args))
        self.last_request = request
        expiry = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=5)).isoformat()
        return {"state": "prepared", "draft": {"requestId": request, "draftId": DRAFT,
                "previewText": "перенести входящее в задачи", "expiresAt": expiry}}

    def commit(self, request, draft):
        self.calls.append(("commit", request, draft))
        if self.uncertain:
            raise WriteClientError("upstream_unavailable")
        return self.receipt(request)

    def receipt(self, request):
        return {"outcome": "committed", "requestId": request, "draftId": DRAFT,
                "operation": "route_inbox_to_task", "targetId": "id", "location": {"date": "2026-11-06"},
                "versions": {"inbox_v1": "2", "goals:2026-11-06": "1"},
                "committedAt": "2026-11-06T00:00:00Z"}

    def cancel(self, request, draft):
        self.calls.append(("cancel", request, draft))
        return "cancelled"

    def status(self, request):
        self.calls.append(("status", request))
        return {"state": self.status_state, "requestId": request, "draftId": DRAFT}


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.folder.name) / "outbox.sqlite3"
        self.client = FakeClient()
        self.offset = 0
        self.start()

    def start(self):
        self.stdin, self.stdout = Pipe(), Pipe()
        def run():
            outbox = Outbox(self.path, GENERATION)
            try:
                serve_writer(self.client, outbox, self.stdin, self.stdout, lambda: time.monotonic() + self.offset)
            finally:
                outbox.close()
        self.worker = threading.Thread(target=run, daemon=True)
        self.worker.start()

    def stop(self):
        self.stdin.items.put(b"")
        self.worker.join(timeout=3)
        self.assertFalse(self.worker.is_alive())

    def tearDown(self):
        if self.worker.is_alive():
            self.stop()
        self.folder.cleanup()

    def send(self, value):
        self.stdin.items.put((json.dumps({"jsonrpc": "2.0", **value}, ensure_ascii=False) + "\n").encode())

    def receive(self):
        return json.loads(self.stdout.items.get(timeout=2))

    def init(self, capability=True):
        self.send({"id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18",
                   "capabilities": {"elicitation": {}} if capability else {}}})
        self.assertEqual(self.receive()["result"]["protocolVersion"], "2025-06-18")

    def call(self, identifier=2, args=None):
        self.send({"id": identifier, "method": "tools/call", "params": {
            "name": "route_inbox_to_task",
            "arguments": args if args is not None else {"target": {"id": "in_1", "expectedRevision": "1"}, "date": "2026-11-06"},
        }})

    def ping(self, identifier=10):
        self.send({"id": identifier, "method": "ping"})
        self.assertEqual(self.receive(), {"jsonrpc": "2.0", "id": identifier, "result": {}})

    def test_only_matching_accept_commits_and_ping_remains_responsive(self):
        self.init()
        self.call()
        form = self.receive()
        self.assertEqual(form["method"], "elicitation/create")
        self.assertEqual(form["params"]["message"], "перенести входящее в задачи")
        self.assertEqual(form["params"]["requestedSchema"]["properties"], {})
        self.send({"id": "wrong", "result": {"action": "accept", "content": {}}})
        self.ping()
        self.assertEqual([c[0] for c in self.client.calls], ["prepare"])
        self.call(20)
        self.assertTrue(self.receive()["result"]["isError"])
        self.send({"id": form["id"], "result": {"action": "accept", "content": {}}})
        result = self.receive()
        self.assertEqual(result["id"], 2)
        self.assertEqual(result["result"]["structuredContent"]["outcome"], "committed")
        self.assertEqual([c[0] for c in self.client.calls], ["prepare", "commit"])

    def test_decline_and_wrong_or_late_responses_never_commit(self):
        self.init()
        self.call()
        form = self.receive()
        self.send({"id": form["id"], "result": {"action": "decline"}})
        self.assertTrue(self.receive()["result"]["isError"])
        self.call(3)
        next_form = self.receive()
        self.assertNotEqual(form["id"], next_form["id"])
        self.send({"id": form["id"], "result": {"action": "accept", "content": {}}})
        self.ping()
        self.assertNotIn("commit", [c[0] for c in self.client.calls])

    def test_missing_capability_or_fake_approval_argument_is_refused(self):
        self.init(False)
        self.call()
        self.assertTrue(self.receive()["result"]["isError"])
        self.assertEqual(self.client.calls, [])
        self.stop()
        self.start()
        self.init()
        self.call(args={"target": {"id": "in_1", "expectedRevision": "1"}, "date": "2026-11-06", "confirmed": True})
        self.assertTrue(self.receive()["result"]["isError"])
        self.assertEqual(self.client.calls, [])

    def test_timeout_and_cancellation_never_commit(self):
        self.init()
        self.call()
        first = self.receive()
        self.send({"method": "notifications/cancelled", "params": {"requestId": 2}})
        self.assertTrue(self.receive()["result"]["isError"])
        self.call(3)
        second = self.receive()
        self.offset = 301
        self.send({"id": second["id"], "result": {"action": "accept", "content": {}}})
        self.assertTrue(self.receive()["result"]["isError"])
        self.assertNotEqual(first["id"], second["id"])
        self.assertNotIn("commit", [c[0] for c in self.client.calls])

    def test_disconnect_and_oversized_frame_never_approve(self):
        self.init()
        self.call()
        self.receive()
        self.stdin.items.put(b"x" * 70000 + b"\n")
        self.ping()
        self.stop()
        self.assertNotIn("commit", [c[0] for c in self.client.calls])

    def test_unknown_commit_is_durable_and_restart_only_queries_status(self):
        self.client.uncertain = True
        self.init()
        self.call()
        form = self.receive()
        self.send({"id": form["id"], "result": {"action": "accept", "content": {}}})
        self.assertTrue(self.receive()["result"]["isError"])
        self.stop()
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute("select state from requests").fetchone()[0], "commit_sent")
        self.client.calls.clear()
        self.start()
        self.init()
        self.call()
        self.assertTrue(self.receive()["result"]["isError"])
        self.assertEqual([c[0] for c in self.client.calls], ["status"])

    def test_terminal_status_after_lost_reply_answers_original_call(self):
        self.client.uncertain = True
        self.client.status_state = "conflicted"
        self.init()
        self.call()
        form = self.receive()
        self.send({"id": form["id"], "result": {"action": "accept", "content": {}}})
        result = self.receive()
        self.assertEqual(result["id"], 2)
        self.assertTrue(result["result"]["isError"])
