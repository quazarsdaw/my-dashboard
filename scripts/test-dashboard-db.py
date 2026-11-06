#!/usr/bin/env python3
"""запуск настоящих sql-тестов только в проверенном изолированном окружении."""

import argparse
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "supabase/tests"))
import pg_harness


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", choices=("versions", "writer", "all"), default="all")
    parser.add_argument("--ci", action="store_true")
    parser.add_argument("--require-pgtap", action="store_true")
    args = parser.parse_args()
    db = pg_harness.PgHarness(args.ci)
    try:
        pg_harness.DB = db.start()
        suites = []
        names = ["document_versions"] if args.suite == "versions" else ["write_ledger"] if args.suite == "writer" else ["document_versions", "write_ledger"]
        for name in names:
            suites.append(unittest.defaultTestLoader.discover(str(pg_harness.ROOT / "supabase/tests"), pattern=f"test_{name}.py"))
        suite = unittest.TestSuite(suites)
        if suite.countTestCases() == 0:
            raise RuntimeError("не найдено тестов; пустой запуск не считается успешным")
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        if args.require_pgtap:
            db.pgtap()
        return 0 if result.wasSuccessful() else 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
