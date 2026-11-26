"""v82.5: refunds go through SQL public.apply_refund (one transaction, original payment row locked)."""
import json
import pathlib

import pytest

import main
from tests_helpers_webhook import SECRET, _now_iso, _paid, _std_sign  # noqa: F401

pytestmark = pytest.mark.timeout(60)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("DODO_WEBHOOK_SECRET", SECRET)
    main._REFUND_RPC["off"] = False
    yield
    main._REFUND_RPC["off"] = False


def _refund(client, amount, rid, partial=True):
    data = {"payload_type": "Refund", "refund_id": rid, "payment_id": "pay_1", "amount": amount,
            "currency": "USD", "is_partial": partial, "status": "succeeded"}
    raw = json.dumps({"business_id": "bus_1", "type": "refund.succeeded", "timestamp": _now_iso(), "data": data}).encode()
    return client.post("/webhooks", content=raw, headers=_std_sign(raw, msg_id="msg_" + rid))


def test_full_refunds_never_take_more_than_was_bought(sb, client):
    assert _paid(client).status_code == 200
    bought = [r for r in sb.tables["payment_events"] if r["order_id"] == "dodo-pay_1"][0]["pages"]
    before = sb.usage("u1")["paid_credits"]
    # 4 full refunds one after another (the same-time case is proven on real PostgreSQL in the v82.5 commit:
    # TestClient is not safe to call from several threads — it could hang the test run)
    res = [_refund(client, 0, f"rf_{i}", partial=False).json() for i in range(4)]
    taken = sum(r.get("pages", 0) for r in res)
    assert taken == bought
    assert sb.usage("u1")["paid_credits"] == max(0, before - bought * main.UNIT)
    assert sum(1 for r in res if r.get("duplicate")) == 3


def test_same_refund_retried_is_applied_once(sb, client):
    assert _paid(client).status_code == 200
    first = _refund(client, 20, "rf_same").json()
    assert first.get("pages", 0) > 0
    assert _refund(client, 20, "rf_same").json().get("duplicate") is True


def test_old_path_when_sql_function_missing(sb, client):
    sb.missing_rpc.add("apply_refund")
    assert _paid(client).status_code == 200
    assert _refund(client, 20, "rf_old").json().get("pages", 0) > 0
    assert main._REFUND_RPC["off"] is True


def test_schema_section_20():
    sql = (pathlib.Path(main.BASE_DIR) / "SUPABASE_SCHEMA.sql").read_text(encoding="utf-8")
    block = sql[sql.index("-- 20) v82.5: ATOMIK refund"):]
    assert "for update" in block
    assert "revoke all on function public.apply_refund" in block
