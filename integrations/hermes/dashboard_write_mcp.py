"""отдельный запуск подтверждаемой записи для hermes на windows."""

import argparse
import datetime as dt
import getpass
import hashlib
import os
import pathlib
import re
import secrets
import sqlite3
import sys

from dashboard_write_client import (
    OPTIONS, SCHEMAS, WriteClient, WriteClientError, check_config, json_text, read_config,
)
from dashboard_write_outbox import Outbox, OutboxError


def outside_git(path):
    resolved = path.resolve()
    if not path.is_absolute() or any((parent / ".git").exists() for parent in (resolved, *resolved.parents)):
        raise WriteClientError("private_directory_required")
    return resolved


def exclusive_file(path, value):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())


def configure_write(directory, project_url, anon_key, owner_id, now=None):
    directory = outside_git(pathlib.Path(directory))
    if not re.fullmatch(r"[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-5][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}", owner_id):
        raise WriteClientError("invalid_config")
    token = secrets.token_urlsafe(32)
    config = check_config({"endpoint": project_url + "/functions/v1/dashboard-write", "anon_key": anon_key, "token": token})
    stamp = now or dt.datetime.now(dt.timezone.utc)
    expires = (stamp.astimezone(dt.timezone.utc) + dt.timedelta(days=30)).isoformat(timespec="seconds").replace("+00:00", "Z")
    generation = hashlib.sha256(token.encode()).hexdigest()
    paths = {
        "config": directory / "dashboard-write.json", "env": directory / "dashboard-write.env",
        "yaml": directory / "dashboard-write.hermes.yaml", "outbox": directory / "dashboard-write-outbox.sqlite3",
    }
    directory.mkdir(mode=0o700, exist_ok=False)
    exclusive_file(paths["config"], json_text(config) + "\n")
    exclusive_file(paths["env"], f"DASHBOARD_AGENT_WRITE_TOKEN_SHA256={generation}\n"
                   f"DASHBOARD_AGENT_WRITE_EXPIRES_AT={expires}\n")
    script = str(pathlib.Path(__file__).resolve())
    exclusive_file(paths["yaml"], "mcp_servers:\n  dashboard_write:\n"
                   f"    command: {json_text(sys.executable)}\n"
                   f"    args: {json_text([script, '--config', str(paths['config'])])}\n"
                   "    timeout: 360\n"
                   f"    tools:\n      include: {json_text([*SCHEMAS, OPTIONS])}\n"
                   "    resources: false\n    prompts: false\n"
                   "    elicitation:\n      enabled: true\n      timeout: 300\n")
    Outbox(paths["outbox"], generation).close()
    return paths


def main(argv=None):
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--configure-write", type=pathlib.Path)
    modes.add_argument("--config", type=pathlib.Path)
    args = parser.parse_args(argv)
    try:
        if args.configure_write:
            paths = configure_write(args.configure_write, input("project url: ").strip(),
                                    getpass.getpass("публичный legacy anon jwt: ").strip(),
                                    input("uuid владельца (как у читателя): ").strip())
            print("созданы отдельные файлы writer:", *(str(path) for path in paths.values()), sep="\n")
            return 0
        config_path = outside_git(args.config)
        client = WriteClient(read_config(config_path))
        outbox = Outbox(config_path.parent / "dashboard-write-outbox.sqlite3", client.generation)
        try:
            from dashboard_write_protocol import serve_writer
            serve_writer(client, outbox, sys.stdin.buffer, sys.stdout.buffer)
        finally:
            outbox.close()
        return 0
    except (WriteClientError, OutboxError, OSError, sqlite3.Error, EOFError):
        print("коннектор записи не запущен: проверь приватный конфиг и локальный журнал", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
