"""Audit (Critical) fixes:
C1  full charge with bounded debt (no free slides when the AI makes more than the balance allows)
C2  one AI turn at a time per user
C4  auth token accepted from the Authorization header
C5  gunicorn worker limits WebSocket frame size
"""
from datetime import datetime, timezone

import pytest

import main
from backend import monitoring

pytestmark = pytest.mark.timeout(60)
U = monitoring.UNIT


def _user(free=0, paid=0):
    return monitoring.normalize_user_row({
        "user_id": "u1", "email": "a@x.com", "free_credits": free, "paid_credits": paid,
        "last_reset_time": datetime.now(timezone.utc).isoformat(),
    })


# ---- C1 ---------------------------------------------------------------------------------------
def test_charge_is_not_capped_at_balance():
    # 1 page left, AI produced 5 slides -> 5 pages charged, 4 pages become debt
    u, charged, reason = monitoring.charge_for_ai_turn(_user(free=U), 5, 0, "fast")
    assert charged == 5 * U
    assert "debt" in reason
    assert monitoring.raw_balance(u) == -4 * U
    assert monitoring.total_credits(u) == 0
    assert not monitoring.can_afford(u, "fast")          # blocked until the debt is repaid


def test_debt_is_bounded():
    cap = monitoring.max_debt_units()
    u, charged, _ = monitoring.charge_for_ai_turn(_user(free=U), 1000, 0, "fast")
    assert charged == U + cap
    assert monitoring.raw_balance(u) == -cap
    # a second (parallel) turn cannot push the debt any deeper
    u, charged2, reason2 = monitoring.charge_for_ai_turn(u, 50, 0, "fast")
    assert charged2 == 0 and reason2 == "no_credits"
    assert monitoring.raw_balance(u) == -cap


def test_normal_charge_unchanged():
    u, charged, reason = monitoring.charge_for_ai_turn(_user(free=10 * U), 3, 0, "fast")
    assert charged == 3 * U and reason == "slide_actions"
    assert monitoring.raw_balance(u) == 7 * U


def test_debt_repaid_by_purchase_and_shown_without_negative_numbers():
    u, _, _ = monitoring.charge_for_ai_turn(_user(free=U), 3, 0, "fast")      # debt 2 pages
    p = monitoring.usage_payload(u)
    assert p["paid_credits"] == 0 and p["free_credits"] >= 0
    assert p["debt_units"] == 2 * U
    u = monitoring.add_paid_credits(u, 100)
    assert monitoring.raw_balance(u) == 98 * U


def test_debt_survives_daily_free_reset():
    u, _, _ = monitoring.charge_for_ai_turn(_user(free=U), 3, 0, "fast")      # debt 2 pages
    u["last_reset_time"] = "2000-01-01T00:00:00+00:00"
    u = monitoring.apply_24h_reset(u)
    assert monitoring.raw_balance(u) == monitoring.free_daily_units() - 2 * U


def test_unlimited_users_never_charged():
    u = _user(free=0)
    u["unlimited"] = True
    _, charged, reason = monitoring.charge_for_ai_turn(u, 50, 0, "fast")
    assert charged == 0 and reason == "unlimited"


# ---- C2 ---------------------------------------------------------------------------------------
def test_inflight_guard_one_turn_per_user():
    main._AI_INFLIGHT.clear()
    assert main._ai_inflight_acquire("u1")
    assert not main._ai_inflight_acquire("u1")           # second tab / spam click is refused
    assert main._ai_inflight_acquire("u2")               # other users are not affected
    main._ai_inflight_release("u1")
    assert main._ai_inflight_acquire("u1")
    main._ai_inflight_release("u1")
    main._ai_inflight_release("u2")
    assert main._AI_INFLIGHT == {}


# ---- C4 ---------------------------------------------------------------------------------------
def test_usage_endpoint_reads_bearer_header(sb, client, monkeypatch):
    seen = {}

    class _Auth:
        def get_user(self, token):
            seen["token"] = token
            return None

    monkeypatch.setattr(sb, "auth", _Auth(), raising=False)
    r = client.get("/api/user/usage", headers={"Authorization": "Bearer abc.def"})
    assert r.status_code == 200
    assert seen.get("token") == "abc.def"


def test_frontend_does_not_put_token_in_urls():
    import pathlib
    root = pathlib.Path(main.BASE_DIR) / "js"
    for f in ("04_websocket_stream.js", "03_auth_project.js", "35_v45_tglink.js", "13_community.js"):
        src = (root / f).read_text(encoding="utf-8")
        assert "?token=" not in src and "&token=" not in src, f


# ---- C5 ---------------------------------------------------------------------------------------
def test_gunicorn_worker_limits_ws_frames():
    from backend.worker import SlideStudioWorker
    assert SlideStudioWorker.CONFIG_KWARGS["ws_max_size"] <= 8 * 1024 * 1024
    import pathlib
    root = pathlib.Path(main.BASE_DIR)
    # v69: both start gunicorn with backend/gunicorn_conf.py, which sets the worker class (and the worker count)
    assert "backend/gunicorn_conf.py" in (root / "Dockerfile").read_text()
    assert "backend/gunicorn_conf.py" in (root / "render.yaml").read_text()
    from backend import gunicorn_conf
    assert gunicorn_conf.worker_class == "backend.worker.SlideStudioWorker"


def test_debt_is_repaid_once_not_every_day():
    # Bug: the debt stayed in paid_credits for ever, so EVERY next day the free pool was smaller by the debt.
    u, _, _ = monitoring.charge_for_ai_turn(_user(free=U), 3, 0, "fast")      # debt 2 pages
    daily = monitoring.free_daily_units()
    for _ in range(3):
        u["last_reset_time"] = "2000-01-01T00:00:00+00:00"
        u = monitoring.apply_24h_reset(u)
        u = monitoring.deduct_credits(u, monitoring.total_credits(u))         # the user spends the whole day
    u["last_reset_time"] = "2000-01-01T00:00:00+00:00"
    u = monitoring.apply_24h_reset(u)
    assert u["paid_credits"] == 0
    assert monitoring.raw_balance(u) == daily                                # full free pool again


def test_debt_repaid_once_in_sql_charge_path():
    from datetime import timedelta
    from tests.fake_supabase import FakeSupabase
    sb = FakeSupabase()
    old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    sb.tables["user_usage"] = [{"user_id": "u1", "free_credits": 0, "paid_credits": -2 * U, "last_reset_time": old}]
    daily = monitoring.free_daily_units()
    sb._charge_units("u1", U, "chat", daily, monitoring.max_debt_units(), p_charge_id="c1")
    row = sb.usage("u1")
    assert row["paid_credits"] == 0 and row["free_credits"] == daily - 3 * U
    sb.tables["user_usage"][0]["last_reset_time"] = old
    sb._charge_units("u1", U, "chat", daily, monitoring.max_debt_units(), p_charge_id="c2")
    assert sb.usage("u1")["free_credits"] == daily - U                       # no second cut the next day
