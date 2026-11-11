"""v60: izohni admin pin qiladi, admin boshqaning izohini o'chira oladi, admin balansni ayirsa bugungi bepul varaq ham ayiriladi."""
from datetime import datetime, timedelta, timezone

import main
from backend import admin_core
from backend import monitoring as mon


def _setup_feedback(sb, monkeypatch):
    sb.add_user("adm", "u-admin", "boss@x.uz")
    sb.add_user("usr", "u-user", "user@x.uz")
    monkeypatch.setenv("ADMIN_EMAILS", "boss@x.uz")
    t0 = datetime(2026, 11, 1, tzinfo=timezone.utc)
    sb.tables["feedback_posts"] = [
        {"id": f"00000000-0000-0000-0000-00000000000{i}", "user_id": "u-user", "author": "a", "body": f"post {i}",
         "parent_id": None, "created_at": (t0 + timedelta(hours=i)).isoformat()} for i in range(1, 4)
    ]
    sb.tables["feedback_posts"].append({"id": "00000000-0000-0000-0000-000000000009", "user_id": "u-user", "author": "a",
                                        "body": "javob", "parent_id": "00000000-0000-0000-0000-000000000003",
                                        "created_at": (t0 + timedelta(hours=5)).isoformat()})
    sb.tables["feedback_likes"] = []


def test_admin_pins_post_to_top(sb, client, monkeypatch):
    _setup_feedback(sb, monkeypatch)
    oldest = "00000000-0000-0000-0000-000000000001"
    r = client.get("/api/feedback/list?token=adm").json()
    assert [p["body"] for p in r["posts"]] == ["post 3", "post 2", "post 1"]
    assert r["is_admin"] is True
    assert r["posts"][0]["replies"][0]["body"] == "javob"
    assert client.post("/api/feedback/pin", json={"token": "adm", "id": oldest, "pinned": True}).json()["pinned"] is True
    r = client.get("/api/feedback/list?token=usr").json()
    assert r["posts"][0]["body"] == "post 1" and r["posts"][0]["pinned"] is True
    assert r["is_admin"] is False
    client.post("/api/feedback/pin", json={"token": "adm", "id": oldest, "pinned": False})
    assert client.get("/api/feedback/list").json()["posts"][0]["body"] == "post 3"


def test_non_admin_cannot_pin_and_reply_cannot_be_pinned(sb, client, monkeypatch):
    _setup_feedback(sb, monkeypatch)
    r = client.post("/api/feedback/pin", json={"token": "usr", "id": "00000000-0000-0000-0000-000000000001"})
    assert r.status_code == 403
    r = client.post("/api/feedback/pin", json={"token": "adm", "id": "00000000-0000-0000-0000-000000000009"})
    assert r.status_code == 400


def test_list_works_without_pinned_column(sb, client, monkeypatch):
    _setup_feedback(sb, monkeypatch)
    sb.missing_columns["feedback_posts"] = {"pinned_at"}     # SQL hali qayta ishga tushirilmagan baza
    r = client.get("/api/feedback/list")
    assert r.status_code == 200 and len(r.json()["posts"]) == 3


def test_admin_can_delete_any_post(sb, client, monkeypatch):
    _setup_feedback(sb, monkeypatch)
    pid = "00000000-0000-0000-0000-000000000003"
    assert client.post("/api/feedback/delete", json={"token": "adm", "id": pid}).json()["ok"] is True
    ids = {p["id"] for p in sb.tables["feedback_posts"]}
    assert pid not in ids and "00000000-0000-0000-0000-000000000009" not in ids


def _usage_row(sb, paid_pages, free_pages):
    U = mon.UNIT
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "u1@x.uz", "paid_credits": paid_pages * U, "free_credits": free_pages * U,
                                "slide_credits": (paid_pages + free_pages) * U,
                                "last_reset_time": datetime.now(timezone.utc).isoformat(), "plan": "free"}]


def test_admin_subtract_takes_paid_then_today_free(sb, monkeypatch):
    monkeypatch.setattr(admin_core, "_ledger", lambda *a, **k: None)
    monkeypatch.setattr(admin_core, "audit", lambda *a, **k: None)
    daily = mon.daily_units_for({}) // mon.UNIT
    _usage_row(sb, 100, daily)
    admin_core.user_action("t", {"user_id": "u1", "action": "add_credits", "pages": -200})
    row = sb.usage("u1")
    assert row["paid_credits"] == 0 and row["free_credits"] == 0
    # keyingi so'rovda kunlik bepul limit DARHOL qaytib kelmaydi (24 soat kutiladi)
    assert mon.total_credits(mon.apply_24h_reset(dict(row))) == 0


def test_admin_subtract_small_amount_keeps_free(sb, monkeypatch):
    monkeypatch.setattr(admin_core, "_ledger", lambda *a, **k: None)
    monkeypatch.setattr(admin_core, "audit", lambda *a, **k: None)
    _usage_row(sb, 100, 0)
    admin_core.user_action("t", {"user_id": "u1", "action": "add_credits", "pages": -30})
    assert sb.usage("u1")["paid_credits"] == 70 * mon.UNIT


def test_admin_add_positive_unchanged(sb, monkeypatch):
    monkeypatch.setattr(admin_core, "_ledger", lambda *a, **k: None)
    monkeypatch.setattr(admin_core, "audit", lambda *a, **k: None)
    _usage_row(sb, 5, 0)
    admin_core.user_action("t", {"user_id": "u1", "action": "add_credits", "pages": 10})
    assert sb.usage("u1")["paid_credits"] == 15 * mon.UNIT
