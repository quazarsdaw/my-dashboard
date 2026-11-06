#!/usr/bin/env python3
"""сверка списка команд и схем edge ↔ windows, без сети и credentials."""

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "integrations/hermes"))
from dashboard_write_protocol import EMPTY_SCHEMA, OPTIONS, tool_catalog


def main():
    run = subprocess.run([
        "deno", "eval",
        'import {commandSchemas} from "./supabase/functions/_shared/dashboard-write/commands.ts";'
        "console.log(JSON.stringify(commandSchemas))",
    ], cwd=ROOT, check=True, capture_output=True, text=True, timeout=10)
    expected = json.loads(run.stdout)
    expected[OPTIONS] = EMPTY_SCHEMA
    catalog = tool_catalog()
    if (len(catalog) != len(expected) or
        {tool["name"]: tool["inputSchema"] for tool in catalog} != expected or
        any(tool["annotations"]["readOnlyHint"] != (tool["name"] == OPTIONS) for tool in catalog)):
        print("схемы edge и коннектора расходятся", file=sys.stderr)
        return 1
    print(f"совпадают схемы {len(expected)} инструментов")
    return 0


if __name__ == "__main__":
    sys.exit(main())
