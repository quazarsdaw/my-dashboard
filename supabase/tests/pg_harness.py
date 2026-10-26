"""настоящий postgres, отдельные psql sessions; без dotenv и production подключения."""

import concurrent.futures
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
DB = None


def literal(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def change(key, revision, value):
    return {"key": key, "expectedRevision": revision, "valueText": value}


def validate_ci_connection(url):
    parsed = urlsplit(url)
    if (parsed.scheme not in ("postgres", "postgresql")
            or parsed.hostname not in ("127.0.0.1", "localhost", "::1")
            or not re.fullmatch(r"/dashboard_write_test_[a-z0-9_]+", parsed.path)
            or parsed.query or parsed.fragment or not parsed.username):
        raise ValueError("разрешена только явная loopback test database без дополнительных параметров")
    return parsed


class PgHarness:
    def __init__(self, ci=False):
        self.ci = ci
        self.temp = None
        self.started = False
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
        self.psql = shutil.which("psql")
        if not self.psql:
            raise RuntimeError("нужен локальный psql")

    def start(self):
        if self.ci:
            url = os.environ.get("DASHBOARD_TEST_DB_URL", "")
            parsed = validate_ci_connection(url)
            self.connection = ["-h", parsed.hostname, "-p", str(parsed.port or 5432),
                               "-U", unquote(parsed.username), "-d", parsed.path[1:]]
            if parsed.password:
                self.env["PGPASSWORD"] = unquote(parsed.password)
            if self.sql("select value from public.dashboard_test_marker;") != "synthetic-dashboard-write-only":
                raise RuntimeError("синтетический marker отсутствует; база не изменялась")
        else:
            self.temp = tempfile.TemporaryDirectory(prefix="dashboard-write-test-", dir="/private/tmp" if Path("/private/tmp").exists() else None)
            directory = Path(self.temp.name)
            self.data = directory / "data"
            self.socket = directory / "socket"
            self.socket.mkdir()
            self.pg_ctl = shutil.which("pg_ctl")
            initdb = shutil.which("initdb")
            if not self.pg_ctl or not initdb:
                raise RuntimeError("нужны initdb и pg_ctl; docker на windows не требуется")
            self._command([initdb, "-D", str(self.data), "-U", "postgres", "--auth=trust", "--no-locale", "--encoding=UTF8"])
            self._command([self.pg_ctl, "-D", str(self.data), "-l", str(directory / "postgres.log"),
                           "-o", f"-c listen_addresses='' -c unix_socket_directories='{self.socket}'", "-w", "start"])
            self.started = True
            self.connection = ["-h", str(self.socket), "-U", "postgres", "-d", "postgres"]
        self.sql((ROOT / "supabase/tests/fixtures/dashboard_bootstrap.sql").read_text())
        for migration in sorted((ROOT / "supabase/migrations").glob("*.sql")):
            self.sql(migration.read_text())
        self.preserved_raw = self.json("select to_json(value) from public.user_data where key='legacy-preserved';")
        return self

    def _command(self, args, text=None):
        result = subprocess.run(args, input=text, text=True, capture_output=True, env=self.env, timeout=45)
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or "команда тестовой базы завершилась ошибкой")
        return result.stdout.strip()

    def sql(self, statement, role=None, claims=None):
        if role is not None and role not in ("anon", "authenticated", "service_role"):
            raise ValueError("неизвестная тестовая роль")
        prefix = "begin; set local statement_timeout='15s'; set local lock_timeout='8s';"
        if role:
            prefix += f"set local role {role};"
        if claims:
            prefix += f"set local \"request.jwt.claims\"={literal(json.dumps(claims))};"
        return self._command([self.psql, "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", *self.connection],
                             prefix + statement + "; commit;")

    def json(self, statement, role=None, claims=None):
        return json.loads(self.sql(statement, role, claims))

    def rpc(self, name, args, owner=OWNER, role="authenticated"):
        if not re.fullmatch(r"dashboard_[a-z_]+", name):
            raise ValueError("некорректное имя test rpc")
        arguments = []
        for key, value in args.items():
            if not re.fullmatch(r"p_[a-z_]+", key):
                raise ValueError("некорректный test argument")
            if isinstance(value, (list, dict)):
                encoded = literal(json.dumps(value, ensure_ascii=False)) + "::jsonb"
                if key == "p_keys":
                    encoded = "array[" + ",".join(literal(v) for v in value) + "]::text[]"
            elif isinstance(value, int):
                encoded = str(value)
            else:
                encoded = literal(value)
            arguments.append(key + " => " + encoded)
        return self.json(f"select public.{name}({','.join(arguments)})", role, {"sub": owner} if owner else None)

    def read(self, owner, key):
        rows = self.rpc("dashboard_read_user_data", {"p_after_key": None, "p_limit": 500}, owner)
        return next((row for row in rows if row["key"] == key),
                    {"key": key, "exists": False, "valueText": None, "revision": "0", "updatedAt": None})

    def reset(self):
        self.sql("truncate public.user_data")
        if self.sql("select to_regclass('private.dashboard_write_accounts') is not null") == "t":
            self.sql("truncate private.dashboard_write_accounts cascade")

    @staticmethod
    def parallel(calls):
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as executor:
            return list(executor.map(lambda call: call(), calls))

    def close(self):
        if self.started:
            self._command([self.pg_ctl, "-D", str(self.data), "-m", "immediate", "-w", "stop"])
            self.started = False
        if self.temp:
            self.temp.cleanup()

    def pgtap(self):
        for name in ("user_data_rls.sql", "school_mutation_locks.sql"):
            output = self.sql((ROOT / "supabase/tests" / name).read_text())
            if re.search(r"^(?:not ok|Bail out!)", output, re.MULTILINE):
                raise AssertionError(output)
            print(f"pgtap {name}: ok")
