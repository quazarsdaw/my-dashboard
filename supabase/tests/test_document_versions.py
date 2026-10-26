"""регрессии lost update: выполняются настоящие rpc/rls/triggers, не sql mocks."""

import unittest
import pg_harness
from pg_harness import OWNER, OTHER, change, literal

KEY = "goals:2026-10-27"
NEXT = "goals:2026-10-28"


class DocumentVersions(unittest.TestCase):
    def setUp(self):
        self.db = pg_harness.DB
        self.db.reset()

    def save(self, changes, owner=OWNER):
        return self.db.rpc("dashboard_save_documents", {"p_changes": changes}, owner)

    def guard(self, owner=OWNER, enabled=True):
        self.db.sql(f"insert into private.dashboard_write_accounts (owner_id,guard_enabled) values ({literal(owner)}, {str(enabled).lower()}) on conflict (owner_id) do update set guard_enabled=excluded.guard_enabled")

    def test_stale_update_does_not_replace_saved_value(self):
        first = self.save([change(KEY, "0", "[]")])
        stale = self.save([change(KEY, "0", "[1]")])
        self.assertTrue(first["ok"])
        self.assertEqual(stale["error"]["code"], "conflict")
        self.assertEqual(self.db.read(OWNER, KEY)["valueText"], "[]")

    def test_two_first_inserts_have_one_winner(self):
        values = ["[1]", "[2]"]
        results = self.db.parallel([lambda value=v: self.save([change(KEY, "0", value)]) for v in values])
        self.assertEqual(sum(r["ok"] for r in results), 1)
        winner = values[next(i for i, result in enumerate(results) if result["ok"])]
        self.assertEqual(self.db.read(OWNER, KEY)["valueText"], winner)
        self.assertEqual(self.db.read(OWNER, KEY)["revision"], "1")

    def test_tombstone_prevents_stale_resurrection(self):
        self.save([change(KEY, "0", "[]")])
        self.assertTrue(self.save([change(KEY, "1", None)])["ok"])
        row = self.db.read(OWNER, KEY)
        self.assertEqual((row["exists"], row["valueText"], row["revision"]), (True, None, "2"))
        self.assertFalse(self.save([change(KEY, "0", "[9]")])["ok"])

    def test_batch_conflict_rolls_back_other_key(self):
        self.save([change(KEY, "0", "[1]")])
        result = self.save([change(NEXT, "0", "[2]"), change(KEY, "0", "[]")])
        self.assertFalse(result["ok"])
        self.assertFalse(self.db.read(OWNER, NEXT)["exists"])
        self.assertEqual(self.db.read(OWNER, KEY)["valueText"], "[1]")

    def test_move_is_atomic_and_opposite_order_does_not_deadlock(self):
        self.save([change(KEY, "0", "[1]"), change(NEXT, "0", "[2]")])
        first = [change(KEY, "1", "[]"), change(NEXT, "1", "[1,2]")]
        second = [change(NEXT, "1", "[]"), change(KEY, "1", "[2,1]")]
        results = self.db.parallel([lambda: self.save(first), lambda: self.save(second)])
        self.assertEqual(sum(r["ok"] for r in results), 1)
        self.assertEqual(self.db.read(OWNER, KEY)["revision"], "2")
        self.assertEqual(self.db.read(OWNER, NEXT)["revision"], "2")

    def test_owner_is_derived_from_auth_not_arguments(self):
        self.save([change(KEY, "0", "[1]")])
        self.assertTrue(self.save([change(KEY, "0", "[2]")], OTHER)["ok"])
        self.assertEqual(self.db.read(OWNER, KEY)["valueText"], "[1]")
        rows = self.db.rpc("dashboard_read_user_data", {"p_after_key": None, "p_limit": 500}, OTHER)
        self.assertEqual([r["valueText"] for r in rows], ["[2]"])

    def test_expected_owner_mismatch_never_creates_document_in_new_account(self):
        result = self.db.rpc("dashboard_save_documents", {"p_changes": [change(KEY, "0", "[1]")], "p_expected_owner": OWNER}, OTHER)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "owner_changed")
        self.assertFalse(self.db.read(OTHER, KEY)["exists"])
        self.assertFalse(self.db.read(OWNER, KEY)["exists"])

    def test_expected_owner_mismatch_cannot_bind_read_to_another_account(self):
        for name, args in [("dashboard_sync_capabilities", {}), ("dashboard_read_user_data", {"p_after_key": None, "p_limit": 500})]:
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "owner_changed"):
                self.db.rpc(name, {**args, "p_expected_owner": OWNER}, OTHER)

    def test_anon_cannot_execute_browser_or_service_rpc(self):
        for name, arguments in [("dashboard_sync_capabilities", {}), ("dashboard_save_documents", {"p_changes": [change(KEY, "0", "[]")]}),
                                ("dashboard_read_agent_documents", {"p_owner": OWNER, "p_keys": [KEY]})]:
            with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, "permission denied"):
                self.db.rpc(name, arguments, owner=None, role="anon")

    def test_capabilities_default_disabled_and_cannot_be_enabled_by_browser(self):
        caps = self.db.rpc("dashboard_sync_capabilities", {})
        self.assertEqual(caps, {"protocol": 2, "guardEnabled": False, "writeEnabled": False})
        with self.assertRaisesRegex(RuntimeError, "permission denied"):
            self.db.sql(f"insert into private.dashboard_write_accounts(owner_id,guard_enabled) values ({literal(OWNER)},true)", "authenticated", {"sub": OWNER})

    def test_guard_rejects_legacy_upsert_and_physical_delete(self):
        self.save([change(KEY, "0", "[]")])
        self.guard()
        for statement in [f"insert into public.user_data(user_id,key,value) values ({literal(OWNER)},{literal(KEY)},'[9]') on conflict(user_id,key) do update set value=excluded.value",
                          f"delete from public.user_data where key={literal(KEY)}"]:
            with self.subTest(statement=statement), self.assertRaisesRegex(RuntimeError, "version_required"):
                self.db.sql(statement, "authenticated", {"sub": OWNER})
        self.assertEqual(self.db.read(OWNER, KEY)["valueText"], "[]")
        self.assertTrue(self.save([change(KEY, "1", "[2]")])["ok"])
        self.assertEqual(self.db.sql(f"select write_base_revision is null from public.user_data where key={literal(KEY)}"), "t")

    def test_guard_does_not_block_other_owner_or_nonprotected_key(self):
        self.guard()
        for owner, key in [(OTHER, KEY), (OWNER, "tracker_v1")]:
            self.db.sql(f"insert into public.user_data(user_id,key,value) values ({literal(owner)},{literal(key)},'[]')", "authenticated", {"sub": owner})
            self.db.sql(f"delete from public.user_data where key={literal(key)}", "authenticated", {"sub": owner})

    def test_guard_requires_zero_base_on_first_insert(self):
        self.guard()
        with self.assertRaisesRegex(RuntimeError, "version_required"):
            self.db.sql(f"insert into public.user_data(user_id,key,value) values ({literal(OWNER)},{literal(KEY)},'[]')", "authenticated", {"sub": OWNER})
        self.assertTrue(self.save([change(KEY, "0", "[]")])["ok"])

    def test_document_identity_is_immutable(self):
        self.save([change(KEY, "0", "[]")])
        for assignments in [f"key={literal(NEXT)}", f"user_id={literal(OTHER)}"]:
            with self.assertRaisesRegex(RuntimeError, "identity_immutable"):
                self.db.sql(f"update public.user_data set {assignments} where key={literal(KEY)}")

    def test_owner_transfer_keeps_authorization_error_contract(self):
        self.save([change(KEY, "0", "[]")])
        with self.assertRaises(RuntimeError) as error:
            self.db.sql(f"\n\\set VERBOSITY verbose\nupdate public.user_data set user_id={literal(OTHER)} where key={literal(KEY)}", "authenticated", {"sub": OWNER})
        self.assertIn("42501", str(error.exception))

    def test_revision_is_string_above_javascript_safe_range(self):
        self.save([change(KEY, "0", "[]")])
        self.db.sql(f"set local session_replication_role=replica; update public.user_data set revision=9007199254740993 where key={literal(KEY)}")
        self.assertEqual(self.db.read(OWNER, KEY)["revision"], "9007199254740993")
        result = self.save([change(KEY, "9007199254740993", "[1]")])
        self.assertEqual(result["data"][0]["revision"], "9007199254740994")

    def test_original_text_is_not_reserialized_by_migration(self):
        self.assertEqual(self.db.preserved_raw, ' [ {"text":"привет 😀", "n":9007199254740993} ]\n')

    def test_batch_schema_and_scope_limits_fail_without_partial_writes(self):
        invalid = [[change(KEY, "0", "[]"), change("tracker_v1", "0", "[]")],
                   [change(KEY, "0", "[]"), change(KEY, "0", "[1]")],
                   [change(KEY, 0, "[]")], [dict(change(KEY, "0", "[]"), force=True)],
                   [change(KEY, "01", "[]")], [change(KEY, "-1", "[]")],
                   [change(KEY, "9223372036854775808", "[]")],
                   [change(KEY, "0", {})], [], [change(KEY, "0", "x" * (4 * 1024 * 1024 + 1))]]
        for batch in invalid:
            with self.subTest(kind=str(type(batch[0])) if batch else "empty"):
                result = self.save(batch)
                self.assertFalse(result["ok"])
                self.assertFalse(self.db.read(OWNER, KEY)["exists"])

    def test_bounded_read_paginates_without_leaking_other_owner(self):
        self.save([change(KEY, "0", "[]"), change(NEXT, "0", "[]")])
        self.save([change(KEY, "0", "[99]")], OTHER)
        first = self.db.rpc("dashboard_read_user_data", {"p_after_key": None, "p_limit": 1})
        second = self.db.rpc("dashboard_read_user_data", {"p_after_key": first[0]["key"], "p_limit": 1})
        self.assertEqual([first[0]["key"], second[0]["key"]], [KEY, NEXT])
        self.assertEqual(second[0]["valueText"], "[]")

    def test_service_reader_is_allowlisted_and_browser_cannot_call_it(self):
        self.save([change(KEY, "0", "[]")])
        with self.assertRaisesRegex(RuntimeError, "permission denied"):
            self.db.rpc("dashboard_read_agent_documents", {"p_owner": OWNER, "p_keys": [KEY]})
        rows = self.db.rpc("dashboard_read_agent_documents", {"p_owner": OWNER, "p_keys": [KEY, NEXT]}, role="service_role")
        self.assertEqual(rows[0]["revision"], "1")
        self.assertFalse(rows[1]["exists"])
        with self.assertRaisesRegex(RuntimeError, "invalid_keys"):
            self.db.rpc("dashboard_read_agent_documents", {"p_owner": OWNER, "p_keys": ["coins"]}, role="service_role")


class HarnessSafety(unittest.TestCase):
    def test_auth_stub_accepts_legacy_claim_used_by_existing_pgtap(self):
        result = pg_harness.DB.sql(f"set local \"request.jwt.claim.sub\"={literal(OWNER)}; select auth.uid()")
        self.assertEqual(result, OWNER)

    def test_ci_refuses_remote_or_ambiguous_connection_before_io(self):
        for url in ["postgresql://u:p@db.live.supabase.co/dashboard_write_test_a", "postgresql://u:p@localhost/postgres", "postgresql://u:p@localhost/dashboard_write_test_a?host=remote", "postgresql://u:p@localhost/dashboard_write_test_a#x", ""]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                pg_harness.validate_ci_connection(url)
