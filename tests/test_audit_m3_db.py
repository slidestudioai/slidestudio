"""Audit M3: retention purge, refund idempotency key, schema block."""
import json
import pathlib
import re

import pytest

import main
from tests_helpers_webhook import SECRET, _now_iso, _paid, _post, _std_sign  # noqa: F401

pytestmark = pytest.mark.timeout(60)
ROOT = pathlib.Path(main.BASE_DIR)


@pytest.fixture()
def dodo(monkeypatch):
    monkeypatch.setenv("DODO_WEBHOOK_SECRET", SECRET)


def _refund_no_id(client, amount, msg_id):
    data = {"payload_type": "Refund", "refund_id": "", "payment_id": "pay_1", "amount": amount,
            "currency": "USD", "is_partial": True, "status": "succeeded"}
    raw = json.dumps({"business_id": "bus_1", "type": "refund.succeeded", "timestamp": _now_iso(), "data": data}).encode()
    return client.post("/webhooks", content=raw, headers=_std_sign(raw, msg_id=msg_id))


def test_two_partial_refunds_same_amount_without_refund_id_both_count(sb, client, dodo):
    assert _paid(client).status_code == 200
    before = sb.usage("u1")["paid_credits"]
    assert _refund_no_id(client, 20, "msg_r1").json().get("pages", 0) > 0
    after1 = sb.usage("u1")["paid_credits"]
    assert _refund_no_id(client, 20, "msg_r2").json().get("pages", 0) > 0        # was dropped as "duplicate" before
    after2 = sb.usage("u1")["paid_credits"]
    assert before > after1 > after2
    # the SAME event retried by Dodo (same webhook-id) is still not applied twice
    assert _refund_no_id(client, 20, "msg_r2").json().get("duplicate") is True
    assert sb.usage("u1")["paid_credits"] == after2


def test_purge_calls_sql_with_safe_minimums(sb, monkeypatch):
    seen = {}

    class _R:
        def __init__(self, params):
            seen.update(params)

        def execute(self):
            return type("X", (), {"data": {"usage_ledger": 3}})()
    monkeypatch.setattr(sb, "rpc", lambda name, params: _R(params) if name == "purge_old_rows" else None)
    monkeypatch.setenv("RETENTION_LEDGER_DAYS", "1")          # too small -> raised to the 30-day minimum
    main._PURGE.update(last=0.0, off=False)
    assert main.purge_old_rows_once() == {"usage_ledger": 3}
    assert seen["p_ledger_days"] == 30 and seen["p_adsent_days"] >= 3


def test_purge_switches_off_when_function_missing(sb):
    main._PURGE.update(last=0.0, off=False)
    assert main.purge_old_rows_once() is None
    assert main._PURGE["off"] is True
    main._PURGE.update(off=False)


def test_schema_section_14_is_safe():
    sql = (ROOT / "SUPABASE_SCHEMA.sql").read_text(encoding="utf-8")
    block = sql[sql.index("-- 14) Audit H5 + M2 + M3"):]
    assert re.search(r"\bdrop\b|\btruncate\b", block, re.I) is None
    assert "payment_events" not in block.split("$$")[1]               # purge never touches payments
    for needle in ("create table if not exists public.ai_turn_results", "add column if not exists signup_ip_hash",
                   "usage_ledger_topup_idx", "create or replace function public.purge_old_rows",
                   "revoke all on function public.purge_old_rows", "revoke all on public.ai_turn_results"):
        assert needle in block
