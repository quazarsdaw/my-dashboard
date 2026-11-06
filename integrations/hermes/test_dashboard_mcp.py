import base64
import datetime as dt
import hashlib
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import dashboard_mcp as m

PROJECT = "https://abcdefghijklmnopqrst.supabase.co"
ENDPOINT = PROJECT + "/functions/v1/dashboard-read"
OWNER = "11111111-1111-4111-8111-111111111111"
def public_key(role="anon"):
    payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return "eyJhbGciOiJIUzI1NiJ9." + payload + ".signature"
def config():
    return {"endpoint": ENDPOINT, "anon_key": public_key(), "token": "a" * 43}

class Response(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(body)
        self.status = status
        self.headers = {"content-type": "application/json"}

class ConnectorTests(unittest.TestCase):
    def test_config_rejects_unsafe_urls_admin_keys_and_extra_fields(self):
        self.assertEqual(m.validate_config(config())["endpoint"], ENDPOINT)
        for endpoint in [ENDPOINT.replace("https:", "http:"), ENDPOINT + "?token=secret", ENDPOINT + "#x",
                         "https://evil.example/functions/v1/dashboard-read", PROJECT + "/rest/v1/user_data",
                         "https://user:password@abcdefghijklmnopqrst.supabase.co/functions/v1/dashboard-read"]:
            with self.subTest(endpoint=endpoint), self.assertRaises(m.ConnectorError):
                m.validate_config({**config(), "endpoint": endpoint})
        for bad in [{**config(), "anon_key": public_key("service_role")}, {**config(), "token": "short"},
                    {**config(), "owner": OWNER}]:
            with self.assertRaises(m.ConnectorError): m.validate_config(bad)

    def test_tool_catalog_is_only_five_read_operations(self):
        tools = m.tool_catalog()
        self.assertEqual([t["name"] for t in tools], ["get_today_tasks", "list_tasks", "get_goals", "get_tracker", "get_dashboard_summary"])
        for tool in tools:
            self.assertTrue(tool["annotations"]["readOnlyHint"])
            self.assertFalse(tool["inputSchema"]["additionalProperties"])
        for name, args in [("update_task", {}), ("get_today_tasks", {"operation": "update_task"}),
                           ("get_goals", {"owner": OWNER}), ("list_tasks", {"from": "2026-02-30", "to": "2026-03-01"}),
                           ("get_tracker", {"from": "2026-10-01", "to": "2026-11-01"}),
                           ("get_goals", {"cursor": True}), ("get_goals", {"horizon": "week", "periodKey": "2026-10-06"})]:
            with self.subTest(name=name, args=args), self.assertRaises(m.ConnectorError): m.validate_arguments(name, args)

    def test_http_client_sends_scoped_post_and_keeps_credentials_out_of_result(self):
        client = m.DashboardClient(config())
        seen = []
        def send(request, timeout):
            seen.append(json.loads(request.data))
            self.assertEqual(request.full_url, ENDPOINT)
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.get_header("X-dashboard-token"), "a" * 43)
            self.assertEqual(request.get_header("Authorization"), "Bearer " + public_key())
            self.assertEqual(timeout, 20)
            return Response(b'{"meta":{"source":"last_synced_cloud"},"sources":[],"warnings":[],"data":{"items":[]}}')
        with mock.patch.object(client.opener, "open", send):
            result = client.call("list_tasks", {"from": "2026-10-25", "to": "2026-10-26"})
        self.assertEqual(seen, [{"operation": "list_tasks", "from": "2026-10-25", "to": "2026-10-26"}])
        self.assertEqual(result["data"], {"items": []})
        self.assertNotIn("token", result)

    def test_redirects_errors_and_large_responses_fail_without_leaking_body(self):
        client = m.DashboardClient(config())
        handler = next(h for h in client.opener.handlers if isinstance(h, m.NoRedirect))
        self.assertIsNone(handler.redirect_request(None, None, 302, "", {}, "https://evil.example"))
        for outcome in [urllib.error.HTTPError(ENDPOINT, 401, "secret-token", {}, io.BytesIO(b"private-body")),
                        OSError("private-key"), Response(b"x" * (1024 * 1024 + 1)), Response(b"{broken")]:
            def send(*_args, **_kwargs):
                if isinstance(outcome, Exception): raise outcome
                return outcome
            with mock.patch.object(client.opener, "open", send), self.assertRaises(m.ConnectorError) as caught:
                client.call("get_today_tasks", {})
            self.assertNotIn("private", str(caught.exception))
            self.assertNotIn("secret", str(caught.exception))

    def test_setup_exclusive_files_hash_and_windows_yaml_without_secret_stdout(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary) / "settings"
            win_python = r"C:\Users\serv\AppData\Local\hermes\hermes-agent\venv\Scripts\python.exe"
            with mock.patch.object(sys, "executable", win_python):
                paths = m.configure(directory, PROJECT, public_key(), OWNER, dt.datetime(2026, 10, 26, tzinfo=dt.timezone.utc))
            stored = json.loads(paths["config"].read_text(encoding="utf-8"))
            digest = hashlib.sha256(stored["token"].encode()).hexdigest()
            env = paths["env"].read_text(encoding="utf-8")
            self.assertIn("DASHBOARD_AGENT_TOKEN_SHA256=" + digest, env)
            self.assertIn("DASHBOARD_AGENT_EXPIRES_AT=2027-01-24T00:00:00Z", env)
            yaml = paths["yaml"].read_text(encoding="utf-8")
            command = next(line.strip().split(": ", 1)[1] for line in yaml.splitlines() if "command:" in line)
            self.assertEqual(json.loads(command), win_python)
            self.assertNotIn(stored["token"], yaml + env)
            self.assertEqual(m.load_config(paths["config"]), stored)
            before = paths["config"].read_bytes()
            with self.assertRaises(FileExistsError): m.configure(directory, PROJECT, public_key(), OWNER)
            self.assertEqual(paths["config"].read_bytes(), before)

    def test_real_stdio_negotiates_lists_tools_and_rejects_unknown_or_extra_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            config_path = pathlib.Path(temporary) / "config.json"
            config_path.write_text(json.dumps(config()), encoding="utf-8")
            messages = [
                {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}},
                {"jsonrpc": "2.0", "method": "notifications/initialized"},
                {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
                {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "delete_task", "arguments": {}}},
                {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "get_today_tasks", "arguments": {"owner": OWNER}}},
                {"jsonrpc": "2.0", "id": 5, "method": "ping"},
            ]
            result = subprocess.run([sys.executable, str(pathlib.Path(m.__file__)), "--config", str(config_path)],
                                    input="\n".join(map(json.dumps, messages)) + "\n{broken\n", text=True, capture_output=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            responses = list(map(json.loads, result.stdout.splitlines()))
            self.assertEqual(len(responses), 6)
            self.assertEqual(responses[0]["result"]["protocolVersion"], "2025-06-18")
            self.assertEqual(len(responses[1]["result"]["tools"]), 5)
            self.assertTrue(responses[2]["result"]["isError"])
            self.assertTrue(responses[3]["result"]["isError"])
            self.assertEqual(responses[4], {"jsonrpc": "2.0", "id": 5, "result": {}})
            self.assertEqual(responses[5]["error"]["code"], -32700)
            self.assertNotIn("a" * 43, result.stdout + result.stderr)

    def test_stdio_read_call_runs_real_client_and_returns_domain_data(self):
        client = m.DashboardClient(config())
        incoming = io.BytesIO((json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}}) + "\n" +
                              json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "get_today_tasks", "arguments": {}}}) + "\n").encode())
        outgoing = io.BytesIO()
        payload = {"meta": {"source": "last_synced_cloud"}, "sources": [], "warnings": [], "data": {"items": [{"title": "разобрать документы", "done": False}]}}
        with mock.patch.object(client.opener, "open", lambda *_a, **_kw: Response(json.dumps(payload).encode())):
            m.serve(client, incoming, outgoing)
        answers = list(map(json.loads, outgoing.getvalue().splitlines()))
        self.assertEqual(answers[0]["result"]["protocolVersion"], "2024-11-05")
        self.assertFalse(answers[1]["result"]["isError"])
        self.assertEqual(json.loads(answers[1]["result"]["content"][0]["text"])["data"], payload["data"])

    def test_oversized_frame_does_not_desynchronize_next_request(self):
        client = m.DashboardClient(config())
        incoming = io.BytesIO(b"x" * 70000 + b"\n" + b'{"jsonrpc":"2.0","id":2,"method":"ping"}\n')
        outgoing = io.BytesIO()
        m.serve(client, incoming, outgoing)
        answers = list(map(json.loads, outgoing.getvalue().splitlines()))
        self.assertEqual(answers[0]["error"]["code"], -32700)
        self.assertEqual(answers[1], {"jsonrpc": "2.0", "id": 2, "result": {}})

    def test_setup_refuses_git_directories_and_bad_owners(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            (directory / ".git").mkdir()
            with self.assertRaises(m.ConnectorError):
                m.configure(directory / "settings", PROJECT, public_key(), OWNER)
            self.assertFalse((directory / "settings").exists())
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaises(m.ConnectorError):
                m.configure(pathlib.Path(temporary) / "settings", PROJECT, public_key(), "another-user")

    def test_invalid_rpc_identifier_is_not_reflected_as_invalid_response_id(self):
        outgoing = io.BytesIO()
        m.serve(m.DashboardClient(config()), io.BytesIO(b'{"jsonrpc":"2.0","id":[],"method":"ping"}\n'), outgoing)
        response = json.loads(outgoing.getvalue())
        self.assertIsNone(response["id"])
        self.assertIn("error", response)

if __name__ == "__main__": unittest.main()
