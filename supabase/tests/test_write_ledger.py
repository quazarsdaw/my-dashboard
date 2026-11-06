"""подтверждённая запись на настоящем изолированном postgres."""

import hashlib
import json
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pg_harness import OWNER, OTHER, change, literal
import pg_harness

SOURCE = "inbox_v1"
DESTINATION = "goals:2026-11-06"
CREDENTIAL = "a" * 64
HASH = "b" * 64


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class WriteLedger(unittest.TestCase):
    def setUp(self):
        self.db = pg_harness.DB
        self.db.reset()
        self.db.sql(f"insert into private.dashboard_write_accounts(owner_id, guard_enabled, write_enabled) values({literal(OWNER)}, true, true)")
        self.request = str(uuid.uuid4())
        self.draft = None
        self.expiry = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        self.db.rpc("dashboard_save_documents", {"p_changes": [
            change(SOURCE, "0", '[{"id":"in_1","text":"синтетика"}]'),
        ]})
        self.documents = [
            change(SOURCE, "1", "[]"),
            change(DESTINATION, "0", '[{"id":"target","text":"синтетика"}]'),
        ]

    def rpc(self, suffix, *, owner=OWNER, credential=CREDENTIAL, request=None, role="service_role", **args):
        return self.db.rpc("dashboard_agent_" + suffix, {
            "p_owner": owner, "p_credential": credential,
            "p_request": request or self.request, **args,
        }, role=role)

    def payload(self):
        return {
            "resolved": {"operation": "route_inbox_to_task", "arguments": {"target": {"id": "in_1", "expectedRevision": "1"},
                         "date": "2026-11-06"}, "context": {"effectiveDate": "2026-11-06",
                         "targetId": "11111111-1111-4111-8111-111111111111", "createdAt": "2026-11-06T10:00:00Z"}},
            "previewText": "будет создана задача, запись уйдёт из входящих",
            "dependencies": [{k: c[k] for k in ("key", "expectedRevision")} for c in self.documents],
            "afterHashes": {c["key"]: digest(c["valueText"]) for c in self.documents},
            "targetId": "target",
            "changedFields": ["text", "date", "source"],
            "location": {"date": "2026-11-06"},
            "credentialExpiresAt": self.expiry,
        }

    def prepare(self, **kwargs):
        outcome = self.rpc("prepare", p_command_hash=kwargs.pop("hash", HASH), p_payload=kwargs.pop("payload", self.payload()), **kwargs)
        if outcome["ok"] and outcome["data"]["state"] == "prepared":
            self.draft = outcome["data"]["draft"]["draftId"]
        return outcome

    def commit(self, **kwargs):
        return self.rpc("commit", p_draft=kwargs.pop("draft", self.draft), p_documents=kwargs.pop("documents", self.documents), **kwargs)

    def test_same_request_commits_once_under_concurrency(self):
        prepared = self.prepare()
        self.assertTrue(prepared["ok"])
        results = self.db.parallel([self.commit, self.commit])
        self.assertTrue(all(r["ok"] for r in results))
        self.assertEqual(results[0], results[1])
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "2")
        self.assertEqual(self.db.read(OWNER, SOURCE)["valueText"], "[]")
        self.assertEqual(self.db.read(OWNER, DESTINATION)["revision"], "1")
        self.assertEqual(results[0]["data"]["location"], {"date": "2026-11-06"})

    def test_same_request_prepares_once_and_rejects_different_command(self):
        a, b = self.db.parallel([self.prepare, self.prepare])
        self.assertEqual(a, b)
        self.assertEqual(self.prepare(hash="c" * 64)["error"]["code"], "request_mismatch")
        self.assertEqual(self.prepare(payload=None), a)
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")

    def test_move_conflict_persists_without_half_transfer(self):
        self.prepare()
        self.db.rpc("dashboard_save_documents", {"p_changes": [change(DESTINATION, "0", "[1]")]})
        outcome = self.commit()
        self.assertEqual(outcome["error"]["code"], "conflict")
        self.assertEqual(self.rpc("status")["data"]["state"], "conflicted")
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")
        self.assertEqual(self.db.read(OWNER, DESTINATION)["valueText"], "[1]")

    def test_commit_rejects_changed_text_or_extra_key_without_mutating_documents(self):
        self.prepare()
        for changes in ([*self.documents[:1], change(DESTINATION, "0", "[]")], [*self.documents, change("coins_v1", "0", "{}")]):
            with self.subTest(changes=changes):
                self.assertEqual(self.commit(documents=changes)["error"]["code"], "invalid_change")
                self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")
                self.assertFalse(self.db.read(OWNER, DESTINATION)["exists"])

    def test_rotation_disable_expiry_and_other_owner_are_refused(self):
        self.prepare()
        self.assertEqual(self.commit(credential="c" * 64)["error"]["code"], "unauthorized_or_expired")
        self.assertEqual(self.commit(owner=OTHER)["error"]["code"], "write_disabled")
        self.db.sql("update private.dashboard_write_accounts set write_enabled=false")
        self.assertEqual(self.commit()["error"]["code"], "write_disabled")
        self.db.sql("update private.dashboard_write_accounts set write_enabled=true")
        self.db.sql("update private.dashboard_write_requests set expires_at=clock_timestamp() - interval '1 second'")
        self.assertEqual(self.commit()["error"]["code"], "draft_expired")
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")

    def test_cancel_is_terminal_and_browser_cannot_call_writer(self):
        self.prepare()
        with self.assertRaisesRegex(RuntimeError, "permission denied"):
            self.commit(role="authenticated")
        self.assertEqual(self.rpc("cancel", p_draft=self.draft)["data"]["state"], "cancelled")
        self.assertEqual(self.commit()["error"]["code"], "draft_cancelled")
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")

    def test_cleanup_keeps_request_identity_and_redacts_payload(self):
        self.prepare()
        self.assertTrue(self.commit()["ok"])
        self.db.sql("update private.dashboard_write_requests set terminal_at=clock_timestamp()-interval '31 days'")
        self.db.json("select private.dashboard_write_cleanup()")
        self.assertEqual(self.prepare()["error"]["code"], "request_retired")
        self.assertEqual(self.commit()["error"]["code"], "request_retired")
        status = self.rpc("status")["data"]
        self.assertEqual(status["state"], "committed")
        self.assertTrue(status["receipt_expired"])
        self.assertNotIn("previewText", str(status))
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "2")

    def test_active_draft_limit_counts_new_requests_not_replays(self):
        first = self.prepare()
        for _ in range(19):
            self.assertTrue(self.prepare(request=str(uuid.uuid4()))["ok"])
        self.assertEqual(self.prepare(request=str(uuid.uuid4()))["error"]["code"], "rate_limited")
        self.assertEqual(self.prepare(), first)

    def seed_window(self, count, state):
        self.db.sql(
            "insert into private.dashboard_write_requests(owner_id,request_id,credential_generation,credential_expires_at,"
            "command_hash,operation,target_id,state,prepared_at,expires_at,terminal_at) "
            f"select {literal(OWNER)},gen_random_uuid(),{literal(CREDENTIAL)},now()+interval '1 day',"
            f"{literal(HASH)},'create_task','synthetic',{literal(state)},now()-interval '500 seconds',"
            f"now()-interval '200 seconds',now()-interval '499 seconds' from generate_series(1,{count})"
        )

    def test_prepare_window_rolls_and_replays_do_not_consume_quota(self):
        first = self.prepare()
        self.seed_window(119, "cancelled")
        self.assertEqual(self.prepare(request=str(uuid.uuid4()))["error"]["code"], "rate_limited")
        self.assertEqual(self.prepare(), first)
        self.db.sql("update private.dashboard_write_requests set prepared_at=now()-interval '601 seconds' "
                    "where request_id=(select request_id from private.dashboard_write_requests where state='cancelled' limit 1)")
        self.assertTrue(self.prepare(request=str(uuid.uuid4()))["ok"])

    def test_commit_window_rolls_and_receipt_replays_do_not_consume_quota(self):
        self.prepare()
        self.seed_window(60, "committed")
        self.assertEqual(self.commit()["error"]["code"], "rate_limited")
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")
        self.db.sql("update private.dashboard_write_requests set terminal_at=now()-interval '601 seconds' "
                    "where request_id=(select request_id from private.dashboard_write_requests where state='committed' limit 1)")
        outcome = self.commit()
        self.assertTrue(outcome["ok"])
        self.assertEqual(self.commit(), outcome)

    def test_sql_exception_at_second_document_rolls_back_first_and_receipt(self):
        self.prepare()
        with self.assertRaisesRegex(RuntimeError, "synthetic_fail_second"):
            self.db.sql(
                "alter table public.user_data add constraint synthetic_fail_second check (key <> 'inbox_v1' or value <> '[]');"
                "set local role service_role;"
                f"select public.dashboard_agent_commit({literal(OWNER)},{literal(CREDENTIAL)},{literal(self.request)},"
                f"{literal(self.draft)},{literal(json.dumps(self.documents, ensure_ascii=False))}::jsonb)"
            )
        self.assertEqual(self.db.read(OWNER, SOURCE)["revision"], "1")
        self.assertFalse(self.db.read(OWNER, DESTINATION)["exists"])
        self.assertEqual(self.rpc("status")["data"]["state"], "prepared")
