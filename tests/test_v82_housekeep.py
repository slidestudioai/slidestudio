"""v82: Supabase limit guard — hourly public.housekeep(), emergency mode when the DB is near the free-plan limit."""
import asyncio
import pathlib
import re

import pytest

import main

pytestmark = pytest.mark.timeout(60)
ROOT = pathlib.Path(main.BASE_DIR)


class _R:
    def __init__(self, data):
        self._d = data

    def execute(self):
        return type("X", (), {"data": self._d})()


def _fake_rpc(seen, size):
    def rpc(name, params):
        seen.setdefault(name, []).append(dict(params))
        if name == "db_size_mb":
            return _R(size)
        if name == "housekeep":
            return _R({"emergency": params["p_emergency"], "ai_turn_results": 4, "tg_decks": 1, "db_size_mb": size})
        raise AssertionError(name)
    return rpc


@pytest.fixture(autouse=True)
def _reset():
    main._HOUSEKEEP.update(last=0.0, off=False, alerted=0.0)
    yield
    main._HOUSEKEEP.update(last=0.0, off=False, alerted=0.0)


def test_normal_mode_below_soft_limit(sb, monkeypatch):
    seen = {}
    monkeypatch.setattr(sb, "rpc", _fake_rpc(seen, 120.5))
    out = main.housekeep_db_once()
    assert out["emergency"] is False and out["size_before_mb"] == 120.5
    assert seen["housekeep"][0]["p_emergency"] is False
    assert seen["housekeep"][0]["p_deck_days"] == 180


def test_emergency_mode_above_soft_limit(sb, monkeypatch):
    seen = {}
    monkeypatch.setattr(sb, "rpc", _fake_rpc(seen, 455.0))
    monkeypatch.setenv("RETENTION_TG_DECKS_DAYS", "1")               # too small -> raised to the 7-day minimum
    out = main.housekeep_db_once()
    assert out["emergency"] is True and out["soft_limit_mb"] == 400
    assert seen["housekeep"][0] == {"p_emergency": True, "p_deck_days": 7, "p_batch": 5000}


def test_soft_limit_is_configurable(sb, monkeypatch):
    seen = {}
    monkeypatch.setattr(sb, "rpc", _fake_rpc(seen, 455.0))
    monkeypatch.setenv("DB_SOFT_LIMIT_MB", "7000")                    # paid plan: 455 MB is fine
    assert main.housekeep_db_once()["emergency"] is False


def test_switches_off_when_function_missing(sb):
    assert main.housekeep_db_once() is None                           # fake DB has no such RPC
    assert main._HOUSEKEEP["off"] is True


def test_emergency_alerts_admins_once(sb, monkeypatch):
    monkeypatch.setattr(sb, "rpc", _fake_rpc({}, 480.0))
    sent = []

    class _Bot:
        async def admin_send(self, tid, text):
            sent.append((tid, text))
    monkeypatch.setattr(main, "tgbot", _Bot())
    monkeypatch.setattr(main.admin_core, "admin_tg_ids", lambda: {111})
    asyncio.run(main._housekeep_db_and_alert())
    main._HOUSEKEEP["last"] = 0.0
    asyncio.run(main._housekeep_db_and_alert())                       # 2nd run within 6 h: no second message
    assert len(sent) == 1 and sent[0][0] == 111 and "480.0 MB" in sent[0][1]


def test_schema_section_19_never_touches_money():
    sql = (ROOT / "SUPABASE_SCHEMA.sql").read_text(encoding="utf-8")
    block = sql[sql.index("-- 19) v82: AVTOMATIK TOZALASH"):]
    assert re.search(r"\bdrop\b|\btruncate\b", block, re.I) is None
    body = block[block.index("create or replace function public.housekeep"):]
    assert "delete from public.payment_events" not in body
    assert "delete from public.user_usage" not in body
    assert "'purchase', 'refund', 'admin_credit'" in body                # money rows of the ledger are kept
    for needle in ("revoke all on function public.housekeep", "revoke all on function public.db_size_mb",
                   "grant execute on function public.housekeep(boolean, int, int) to service_role"):
        assert needle in block
