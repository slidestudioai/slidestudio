"""Audit M2: free pages farmed with many new accounts from one network."""
from datetime import datetime, timedelta, timezone

import pytest

import main
from backend import admin_core
from backend.services import abuse

pytestmark = pytest.mark.timeout(60)
SECRET = main._SCALING_HMAC_SECRET


def _iso(minutes_ago=0):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat()


def _row(uid, created_min_ago=1, h=None, paid=0, free=200):
    return {"user_id": uid, "email": f"{uid}@x.com", "free_credits": free, "paid_credits": paid,
            "slide_credits": free + paid, "last_reset_time": _iso(), "created_at": _iso(created_min_ago),
            "signup_ip_hash": h}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    abuse._checked.clear()
    abuse._state.update(ok=True, checked=0.0)
    monkeypatch.setenv("MAX_FREE_SIGNUPS_PER_IP_DAY", "3")
    yield
    abuse._checked.clear()


def _farm(sb, ip, n):
    h = abuse.ip_hash(ip, SECRET)
    sb.tables["user_usage"] = [_row(f"old{i}", 30, h) for i in range(n)]
    return h


def test_fourth_new_account_from_same_ip_gets_no_free_pages(sb):
    h = _farm(sb, "9.9.9.9", 3)
    new = _row("new1")
    sb.tables["user_usage"].append(new)
    assert abuse.check_new_account(sb, "new1", dict(new), "9.9.9.9", SECRET) is True
    r = sb.usage("new1")
    assert r["signup_ip_hash"] == h and r["daily_units_override"] == 0 and r["free_credits"] == 0
    assert "Audit M2" in r["admin_note"]
    assert "9.9.9.9" not in str(sb.tables)                      # raw IP is never stored


def test_below_limit_only_records_hash(sb):
    _farm(sb, "9.9.9.9", 2)
    sb.tables["user_usage"].append(_row("new1"))
    assert abuse.check_new_account(sb, "new1", _row("new1"), "9.9.9.9", SECRET) is False
    r = sb.usage("new1")
    assert r["signup_ip_hash"] and r["free_credits"] == 200 and r.get("daily_units_override") is None


def test_old_accounts_and_other_ips_untouched(sb):
    _farm(sb, "9.9.9.9", 5)
    sb.tables["user_usage"] += [_row("old_user", created_min_ago=60 * 24 * 30), _row("other_ip")]
    assert abuse.check_new_account(sb, "old_user", sb.usage("old_user"), "9.9.9.9", SECRET) is False
    assert abuse.check_new_account(sb, "other_ip", sb.usage("other_ip"), "1.1.1.1", SECRET) is False
    assert sb.usage("old_user").get("signup_ip_hash") is None
    assert sb.usage("other_ip")["free_credits"] == 200


def test_paying_or_admin_overridden_accounts_not_limited(sb):
    _farm(sb, "9.9.9.9", 5)
    sb.tables["user_usage"].append(_row("payer", paid=2000))
    assert abuse.check_new_account(sb, "payer", sb.usage("payer"), "9.9.9.9", SECRET) is False


def test_checked_once_per_user(sb):
    _farm(sb, "9.9.9.9", 3)
    sb.tables["user_usage"].append(_row("new1"))
    abuse.check_new_account(sb, "new1", _row("new1"), "9.9.9.9", SECRET)
    sb.usage("new1").update(free_credits=200, daily_units_override=None)        # admin gave pages back
    assert abuse.check_new_account(sb, "new1", sb.usage("new1"), "9.9.9.9", SECRET) is False
    assert sb.usage("new1")["free_credits"] == 200


def test_disabled_with_zero(sb, monkeypatch):
    monkeypatch.setenv("MAX_FREE_SIGNUPS_PER_IP_DAY", "0")
    _farm(sb, "9.9.9.9", 10)
    sb.tables["user_usage"].append(_row("new1"))
    assert abuse.check_new_account(sb, "new1", _row("new1"), "9.9.9.9", SECRET) is False


def test_missing_column_switches_feature_off_quietly(sb):
    sb.tables["user_usage"] = [_row("new1")]
    sb.missing_columns["user_usage"] = {"created_at"}               # select with order -> error in the fake
    orig = sb.table

    def failing(name):
        q = orig(name)
        if name == "user_usage":
            def boom(*a, **k):
                raise Exception("column user_usage.signup_ip_hash does not exist")
            q.eq = boom
        return q
    sb.table = failing
    assert abuse.check_new_account(sb, "new1", _row("new1"), "9.9.9.9", SECRET) is False
    assert abuse._state["ok"] is False


def test_usage_endpoint_applies_limit(sb, client, monkeypatch):
    _farm(sb, "9.9.9.9", 3)
    sb.add_user("tok-n", "new1", "new1@x.com")
    sb.tables["user_usage"].append(_row("new1"))
    d = client.get("/api/user/usage", headers={"Authorization": "Bearer tok-n", "X-Forwarded-For": "9.9.9.9"}).json()
    assert d["free_credits"] == 0


def test_admin_ip_clusters(sb, monkeypatch):
    monkeypatch.setattr(admin_core, "_sb", lambda: sb)
    _farm(sb, "9.9.9.9", 4)
    sb.tables["user_usage"].append(_row("solo", 5, abuse.ip_hash("1.1.1.1", SECRET)))
    c = abuse.ip_clusters(sb, 7, 3)
    assert len(c) == 1 and c[0]["accounts"] == 4 and len(c[0]["ip_hash"]) == 12
