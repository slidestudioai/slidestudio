"""Audit (High) fixes:
H2  atomic SQL charge (public.charge_units): 1 call, idempotent, fallback, outage queue, no CAS-less write
H4  /api/user/usage cache + token cache + slower polling
"""
import asyncio
import json
import pathlib
import re
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest

import main
from backend import monitoring
from backend import telegram_bot as tg

pytestmark = pytest.mark.timeout(60)
U = monitoring.UNIT
ROOT = pathlib.Path(main.BASE_DIR)


def _row(uid, free=200, paid=0, email="a@x.com"):
    return {"user_id": uid, "email": email, "free_credits": free, "paid_credits": paid, "slide_credits": free + paid,
            "last_reset_time": datetime.now(timezone.utc).isoformat(), "blocked": False}


def _rpc_calls(sb, name="charge_units"):
    n = {"c": 0}
    orig = sb.rpc

    def counting(nm, params):
        if nm == name:
            n["c"] += 1
        return orig(nm, params)
    sb.rpc = counting
    return n


# ---- H2: atomic charge ------------------------------------------------------------------------
def test_charge_uses_single_rpc_and_writes_ledger(sb):
    sb.tables["user_usage"] = [_row("u1", free=200)]
    calls = _rpc_calls(sb)
    u, charged, reason = main.charge_turn_atomic("u1", "a@x.com", None, 3, 0, "fast", tokens=500,
                                                 details={"t": 1}, charge_id="c-1")
    assert calls["c"] == 1
    assert charged == 3 * U and reason == "slide_actions"
    assert sb.usage("u1")["free_credits"] == 200 - 3 * U
    assert sb.usage("u1")["total_tokens"] == 500
    led = sb.tables["usage_ledger"]
    assert len(led) == 1 and led[0]["charge_id"] == "c-1" and led[0]["amount"] == -3 * U
    assert u["spent_24h"] == 3 * U and u["free_credits"] == 200 - 3 * U


def test_charge_retry_with_same_id_is_not_double(sb):
    sb.tables["user_usage"] = [_row("u1", free=200)]
    main.charge_turn_atomic("u1", "", None, 2, 0, "fast", charge_id="same")
    _, charged, reason = main.charge_turn_atomic("u1", "", None, 2, 0, "fast", charge_id="same")
    assert charged == 0 and reason == "duplicate"
    assert sb.usage("u1")["free_credits"] == 200 - 2 * U


def test_charge_debt_bounded_in_sql_path(sb):
    sb.tables["user_usage"] = [_row("u1", free=U)]
    _, charged, reason = main.charge_turn_atomic("u1", "", None, 1000, 0, "fast")
    assert charged == U + monitoring.max_debt_units() and reason.endswith("+debt")
    assert sb.usage("u1")["paid_credits"] == -monitoring.max_debt_units()


def test_sql_and_python_rules_agree(sb):
    """Same input -> same balance, for the SQL copy and monitoring.charge_for_ai_turn."""
    for free, paid, pages, searches, mode in [(200, 0, 3, 0, "fast"), (20, 0, 5, 2, "fast"), (0, 500, 2, 1, "deep"),
                                              (200, 0, 0, 0, "fast"), (40, 300, 1, 0, "fast")]:
        sb.tables["user_usage"] = [_row("u1", free=free, paid=paid)]
        sb.tables["usage_ledger"] = []
        main._USAGE_CACHE.clear()
        u_py, ch_py, rs_py = monitoring.charge_for_ai_turn(monitoring.normalize_user_row(_row("u1", free, paid)),
                                                           pages, searches, mode)
        _, ch_sql, rs_sql = main.charge_turn_atomic("u1", "", None, pages, searches, mode)
        assert (ch_sql, rs_sql) == (ch_py, rs_py), (free, paid, pages)
        row = sb.usage("u1")
        assert (row["free_credits"], row["paid_credits"]) == (u_py["free_credits"], u_py["paid_credits"])


def test_unlimited_counts_tokens_only(sb):
    r = _row("u1", free=0)
    r["unlimited"] = True
    sb.tables["user_usage"] = [r]
    _, charged, reason = main.charge_turn_atomic("u1", "", None, 9, 0, "fast", tokens=77)
    assert charged == 0 and reason == "unlimited"
    assert sb.usage("u1")["total_tokens"] == 77 and sb.tables.get("usage_ledger", []) == []


def test_falls_back_when_sql_function_missing(sb):
    sb.tables["user_usage"] = [_row("u1", free=200)]
    sb.missing_rpc.add("charge_units")
    _, charged, reason = main.charge_turn_atomic("u1", "", None, 2, 0, "fast")
    assert charged == 2 * U and reason == "slide_actions"
    assert sb.usage("u1")["free_credits"] == 200 - 2 * U
    assert main._CHARGE_RPC["ok"] is False
    assert sb.tables["usage_ledger"][0]["amount"] == -2 * U


def test_db_outage_queues_charge_and_retries_once(sb, monkeypatch):
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    sb.tables["user_usage"] = [_row("u1", free=200)]
    sb.fail_rpc.add("charge_units")
    _, charged, reason = main.charge_turn_atomic("u1", "", None, 2, 0, "fast")
    assert reason == "charge_deferred" and charged == 2 * U          # estimate shown to the user
    assert sb.usage("u1")["free_credits"] == 200                     # not written yet
    assert len(main._PENDING_CHARGES) == 1
    assert main.retry_pending_charges() == 1                          # DB still down -> stays queued
    sb.fail_rpc.clear()
    assert main.retry_pending_charges() == 0
    assert main.retry_pending_charges() == 0
    assert sb.usage("u1")["free_credits"] == 200 - 2 * U              # charged exactly once (NOT free)


def test_update_usage_atomic_never_writes_without_cas(sb, monkeypatch):
    """Old bug: the last retry wrote with cas=False and could erase a payment that arrived in between."""
    monkeypatch.setattr(main.time, "sleep", lambda s: None)
    sb.tables["user_usage"] = [_row("u1", free=0, paid=0)]
    n = {"i": 0}

    def fn(u):
        n["i"] += 1
        sb._apply_payment(f"order-{n['i']}", "u1", 1, U, 1)          # a payment lands between every read and write
        return monitoring.deduct_credits(u, 0), None
    with pytest.raises(main.UsageConflict):
        main.update_usage_atomic("u1", "", fn, retries=4)
    assert sb.usage("u1")["paid_credits"] == 4 * U                    # every payment is still there


def test_bot_charge_uses_atomic_rpc(sb):
    sb.tables["user_usage"] = [_row("u1", free=200)]
    calls = _rpc_calls(sb)
    usage, charged = asyncio.run(tg._charge("u1", "a@x.com", 2, 10, "fast", {"src": "test"}))
    assert calls["c"] == 1 and charged == 2 * U
    assert sb.tables["usage_ledger"][0]["kind"] == "tg_slide_actions"


def _chunk(content=None, finish=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=None, tool_calls=None))],
              usage=None)


class _Stream:
    def __init__(self, chunks):
        self._it = iter(chunks)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


def test_ws_turn_charged_via_rpc_and_stream_closed(sb, client, monkeypatch):
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [_row("u1", free=U)]                   # 1 page left
    monkeypatch.setitem(main.config, "api_key", "test-key")
    monkeypatch.setattr(main, "_search_images_sync", None)
    acts = {"actions": [{"action": "insert_slide", "after": i, "elements": []} for i in range(3)]}
    reply = "Tayyor.\n```json\n" + json.dumps(acts) + "\n```"
    streams = []

    class _Completions:
        async def create(self, **kw):
            s = _Stream([_chunk(content=reply), _chunk(finish="stop")])
            streams.append(s)
            return s
    monkeypatch.setattr(main, "_deepseek_client", lambda *a, **k: NS(chat=NS(completions=_Completions())))
    calls = _rpc_calls(sb)
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "3 ta slayd", "token": "tok-1",
                                 "deck_state": json.dumps({"presentation": [{"slide": 1, "objects": []}]})}))
        for _ in range(30):
            m = ws.receive_json()
            if m.get("type") in ("end", "error"):
                break
    assert m["type"] == "end", m
    assert calls["c"] == 1
    assert m["units_charged"] == 3 * U                                 # full cost, not capped at 1 page
    assert m["debt_units"] == 2 * U and m["paid_credits"] == 0
    assert streams and all(s.closed for s in streams)                  # Audit C3
    assert main._AI_INFLIGHT == {}                                     # Audit C2 slot released


# ---- H4: cache ----------------------------------------------------------------------------------
def test_usage_endpoint_is_cached_and_dropped_on_charge(sb, client, monkeypatch):
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [_row("u1", free=200)]
    auth_calls = {"n": 0}
    orig = sb.auth.get_user

    def counting(t):
        auth_calls["n"] += 1
        return orig(t)
    monkeypatch.setattr(sb.auth, "get_user", counting)
    h = {"Authorization": "Bearer tok-1"}
    d1 = client.get("/api/user/usage", headers=h).json()
    sb.usage("u1")["free_credits"] = 100                              # changed by "another server"
    d2 = client.get("/api/user/usage", headers=h).json()
    assert d2["free_credits"] == d1["free_credits"] == 200            # served from cache
    assert auth_calls["n"] == 1                                       # token checked once (60 s cache)
    main.charge_turn_atomic("u1", "", None, 1, 0, "fast")             # a charge in THIS process drops the cache
    d3 = client.get("/api/user/usage", headers=h).json()
    assert d3["free_credits"] == 100 - U


def test_fresh_flag_bypasses_cache_after_2s(sb, client, monkeypatch):
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [_row("u1", free=200)]
    h = {"Authorization": "Bearer tok-1"}
    client.get("/api/user/usage", headers=h)
    sb.usage("u1")["paid_credits"] = 2000                              # webhook on another worker
    assert client.get("/api/user/usage?fresh=1", headers=h).json()["paid_credits"] == 0   # < 2 s: still cached
    uid = "u1"
    ts, payload = main._USAGE_CACHE[uid]
    main._USAGE_CACHE[uid] = (ts - 3, payload)                         # pretend 3 s passed
    assert client.get("/api/user/usage?fresh=1", headers=h).json()["paid_credits"] == 2000


def test_cache_is_dropped_by_ledger_writes(sb):
    main.usage_cache_put("u1", {"x": 1})
    main.ledger_log("u1", "admin_credit", 100, {"free_credits": 0, "paid_credits": 100})
    assert main.usage_cache_get("u1") is None


def test_frontend_polls_less_and_payment_watch_asks_fresh():
    tglink = (ROOT / "js/35_v45_tglink.js").read_text(encoding="utf-8")
    assert "120000 * Math.pow" in tglink and "now - last < 30000" in tglink
    assert "loadUserStats(true)" in (ROOT / "js/46_topup.js").read_text(encoding="utf-8")
    assert "loadUserStats(true)" in (ROOT / "js/11_monitoring.js").read_text(encoding="utf-8")
    assert "fresh === true ? '?fresh=1'" in (ROOT / "js/03_auth_project.js").read_text(encoding="utf-8")


# ---- schema ---------------------------------------------------------------------------------------
def test_schema_has_safe_charge_units_block():
    sql = (ROOT / "SUPABASE_SCHEMA.sql").read_text(encoding="utf-8")
    i = sql.index("13) Audit H2")
    block = sql[i:]
    assert "create or replace function public.charge_units(" in block
    assert re.search(r"\bdrop\b", block, re.I) is None and re.search(r"\btruncate\b", block, re.I) is None
    assert "revoke all on function public.charge_units" in block
    # parameter names in SQL == names sent by main._charge_rpc_call
    sql_params = set(re.findall(r"\b(p_[a-z_]+)\s+(?:text|int|bigint|jsonb)", block.split("returns jsonb")[0]))
    import inspect
    py_params = set(re.findall(r'"(p_[a-z_]+)"', inspect.getsource(main._charge_rpc_call)))
    assert sql_params == py_params
