import datetime as dt
import hashlib
import json
import pathlib
import tempfile
import unittest
from unittest import mock

from dashboard_write_client import WriteClient, WriteClientError
from dashboard_write_mcp import configure_write
from test_dashboard_mcp import OWNER, PROJECT, Response, public_key

REQUEST = "11111111-1111-4111-8111-111111111111"
DRAFT = "22222222-2222-4222-8222-222222222222"
TOKEN = "a" * 43
CONFIG = {"endpoint": PROJECT + "/functions/v1/dashboard-write", "anon_key": public_key(), "token": TOKEN}


class WriteClientTests(unittest.TestCase):
    def test_writer_only_sends_fixed_routes_and_no_patch_at_commit(self):
        client = WriteClient(CONFIG)
        def send(req, timeout):
            self.assertEqual(req.full_url, CONFIG["endpoint"] + "/commit")
            self.assertEqual(timeout, 20)
            self.assertEqual(req.get_header("X-dashboard-write-token"), TOKEN)
            self.assertEqual(json.loads(req.data), {"requestId": REQUEST, "draftId": DRAFT})
            return Response(json.dumps({"outcome": "committed", "requestId": REQUEST, "draftId": DRAFT,
                                        "operation": "move_task", "targetId": "id",
                                        "committedAt": "2026-11-06T00:00:00Z", "versions": {"goals:2026-11-06": "2"}}).encode())
        with mock.patch.object(client.opener, "open", send):
            self.assertEqual(client.commit(REQUEST, DRAFT)["outcome"], "committed")

    def test_admin_credentials_and_wrong_endpoint_are_refused(self):
        for patch in ({"anon_key": public_key("service_role")}, {"endpoint": PROJECT + "/rest/v1/user_data"},
                      {"endpoint": CONFIG["endpoint"] + "?x=secret"}, {"endpoint": "https://evil.test/functions/v1/dashboard-write"}):
            with self.subTest(patch=patch), self.assertRaises(WriteClientError):
                WriteClient({**CONFIG, **patch})

    def test_oversized_response_and_unknown_outcome_do_not_look_successful(self):
        client = WriteClient(CONFIG)
        for body in (b"x" * (1024 * 1024 + 1), b'{"outcome":"committed","requestId":"other"}', b"broken"):
            with mock.patch.object(client.opener, "open", return_value=Response(body)), self.assertRaises(WriteClientError):
                client.commit(REQUEST, DRAFT)

    def test_configuration_is_separate_exclusive_and_only_hash_goes_to_env(self):
        with tempfile.TemporaryDirectory() as folder:
            base = pathlib.Path(folder)
            old = base / "dashboard-read.json"
            old.write_bytes(b"existing reader")
            paths = configure_write(base / "writer", PROJECT, public_key(), OWNER,
                                    now=dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc))
            raw = json.loads(paths["config"].read_text(encoding="utf-8"))
            token = raw["token"]
            env = paths["env"].read_text(encoding="utf-8")
            yaml = paths["yaml"].read_text(encoding="utf-8")
            self.assertIn(hashlib.sha256(token.encode()).hexdigest(), env)
            self.assertIn("2026-12-06T00:00:00Z", env)
            self.assertIn("route_inbox_to_task", yaml)
            self.assertNotIn(token, env + yaml)
            self.assertEqual(old.read_bytes(), b"existing reader")
            with self.assertRaises(FileExistsError):
                configure_write(base / "writer", PROJECT, public_key(), OWNER)
            (base / ".git").mkdir()
            with self.assertRaises(WriteClientError):
                configure_write(base / "inside", PROJECT, public_key(), OWNER)
