"""журнал восстановления: без токена, текстов, preview и автоматического commit."""

import hashlib
import json
import os
import pathlib
import re
import sqlite3
import sys
import uuid


class OutboxError(Exception):
    pass


def _exclusive_lease(path):
    if path.is_symlink():
        raise OutboxError("invalid_outbox")
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if sys.platform == "win32":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"\0")
            os.lseek(fd, 0, os.SEEK_SET)
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except OSError:
        os.close(fd)
        raise OutboxError("busy") from None


class Outbox:
    def __init__(self, path, generation):
        path = pathlib.Path(path)
        if not path.is_absolute() or path.is_symlink() or not re.fullmatch(r"[0-9a-f]{64}", generation):
            raise OutboxError("invalid_outbox")
        self._lease = _exclusive_lease(path.with_suffix(".lock"))
        self._db = None
        try:
            try:
                fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                os.close(fd)
            self._db = sqlite3.connect(path, timeout=3)
            self._db.row_factory = sqlite3.Row
            self._db.execute("pragma synchronous=full")
            self._db.executescript("""
                create table if not exists metadata(
                    singleton integer primary key check(singleton=1), generation text not null
                );
                create table if not exists requests(
                    request_id text primary key, singleton integer not null default 1 check(singleton=1),
                    operation text not null, fingerprint text not null, draft_id text,
                    state text not null, outcome text
                );
                create unique index if not exists one_pending_write on requests(singleton)
                  where state in ('allocated','prepared','commit_sent');
            """)
            with self._db:
                self._db.execute("insert or ignore into metadata values(1,?)", (generation,))
                stored = self._db.execute("select generation from metadata where singleton=1").fetchone()
                if stored is None or stored["generation"] != generation:
                    raise OutboxError("credential_changed")
        except (sqlite3.Error, OutboxError, OSError):
            self.close()
            raise

    def close(self):
        try:
            if self._db is not None:
                self._db.close()
        finally:
            os.close(self._lease)

    def allocate(self, operation, args):
        request = str(uuid.uuid4())
        raw = json.dumps({"operation": operation, "arguments": args},
                         ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"))
        fingerprint = hashlib.sha256(raw.encode()).hexdigest()
        try:
            with self._db:
                self._db.execute("insert into requests(request_id,operation,fingerprint,state) values(?,?,?,'allocated')",
                                 (request, operation, fingerprint))
        except sqlite3.IntegrityError:
            raise OutboxError("busy") from None
        return request

    def _transition(self, sql, args):
        with self._db:
            if self._db.execute(sql, args).rowcount != 1:
                raise OutboxError("outbox_state_changed")

    def mark_prepared(self, request, draft):
        self._transition("update requests set state='prepared',draft_id=? where request_id=? and state='allocated'", (draft, request))

    def mark_commit_sent(self, request):
        self._transition("update requests set state='commit_sent' where request_id=? and state='prepared'", (request,))

    def mark_terminal(self, request, outcome):
        self._transition("update requests set state='terminal',outcome=? where request_id=? and state<>'terminal'", (outcome, request))

    def unresolved(self):
        return [dict(row) for row in self._db.execute(
            "select request_id,operation,fingerprint,draft_id,state from requests where state<>'terminal'"
        )]
