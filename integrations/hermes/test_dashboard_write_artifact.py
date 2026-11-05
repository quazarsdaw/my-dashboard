import ast
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

from dashboard_write_protocol import tool_catalog
from dashboard_write_client import OPTIONS, SCHEMAS

ROOT = pathlib.Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "scripts/package-dashboard-write.py"
CHECK = ROOT / "scripts/check-dashboard-write-contracts.py"
MODULES = {"dashboard_mcp.py", "dashboard_write_mcp.py", "dashboard_write_client.py",
           "dashboard_write_outbox.py", "dashboard_write_protocol.py", "dashboard_write_schemas.json"}


class ArtifactTests(unittest.TestCase):
    def test_catalog_exposes_no_commit_or_rewards_and_schemas_match_edge(self):
        result = subprocess.run([sys.executable, str(CHECK)], cwd=ROOT, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        tools = tool_catalog()
        self.assertEqual({t["name"] for t in tools}, {*SCHEMAS, OPTIONS})
        self.assertEqual([t["name"] for t in tools if t["annotations"]["readOnlyHint"]], [OPTIONS])
        self.assertNotIn("commit", SCHEMAS)
        self.assertNotIn("complete_task", SCHEMAS)
        self.assertIn("route_inbox_to_goal", SCHEMAS)

    def test_bundle_contains_only_reviewable_code_and_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "writer.zip"
            command = [sys.executable, str(PACKAGE), "--output", str(path)]
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            original = path.read_bytes()
            with zipfile.ZipFile(path) as bundle:
                self.assertEqual(set(bundle.namelist()), MODULES | {"инструкция.md"})
                for name in MODULES:
                    data = bundle.read(name).decode("utf-8")
                    if name.endswith(".py"):
                        ast.parse(data, filename=name, feature_version=(3, 10))
                    else:
                        self.assertEqual(json.loads(data), SCHEMAS)
            self.assertNotEqual(subprocess.run(command, cwd=ROOT, capture_output=True, timeout=10).returncode, 0)
            self.assertEqual(path.read_bytes(), original)
