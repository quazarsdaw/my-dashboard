import pathlib
import tempfile
import unittest

from dashboard_write_outbox import Outbox, OutboxError

DRAFT = "11111111-1111-4111-8111-111111111111"


class OutboxTests(unittest.TestCase):
    def test_second_live_connector_cannot_recover_first_live_request(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "outbox.sqlite3"
            first = Outbox(path, "a" * 64)
            try:
                with self.assertRaises(OutboxError):
                    Outbox(path, "a" * 64)
            finally:
                first.close()

    def test_restart_preserves_commit_sent_and_prevents_duplicate_new_request(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "outbox.sqlite3"
            first = Outbox(path, "a" * 64)
            request = first.allocate("create_task", {"text": "не писать в локальный журнал"})
            first.mark_prepared(request, DRAFT)
            first.mark_commit_sent(request)
            first.close()
            second = Outbox(path, "a" * 64)
            self.assertEqual([(r["request_id"], r["draft_id"], r["state"]) for r in second.unresolved()],
                             [(request, DRAFT, "commit_sent")])
            with self.assertRaises(OutboxError):
                second.allocate("create_task", {"text": "дубль"})
            second.mark_terminal(request, "committed")
            self.assertEqual(second.unresolved(), [])
            second.close()
            self.assertNotIn("не писать".encode(), path.read_bytes())

    def test_rotated_credential_cannot_resume_old_outbox(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / "outbox.sqlite3"
            old = Outbox(path, "a" * 64)
            old.allocate("create_task", {"text": "синтетика"})
            old.close()
            with self.assertRaises(OutboxError):
                Outbox(path, "b" * 64)
