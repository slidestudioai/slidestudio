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


# ---------------------------------------------------------------------------------------------
# v66: /give, /take — bir email bilan bir nechta akkaunt, sayt bilan bir xil balans, parallel sarf
# ---------------------------------------------------------------------------------------------
def _quiet(monkeypatch):
    monkeypatch.setattr(admin_core, "_ledger", lambda *a, **k: None)
    monkeypatch.setattr(admin_core, "audit", lambda *a, **k: None)


def test_admin_same_email_two_accounts_always_same_target(sb, monkeypatch):
    _quiet(monkeypatch)
    U = mon.UNIT
    now = datetime.now(timezone.utc)
    sb.tables["user_usage"] = [
        {"user_id": "old", "email": "a@x.uz", "paid_credits": 0, "free_credits": 200,
         "last_reset_time": now.isoformat(), "last_active": (now - timedelta(days=5)).isoformat()},
        {"user_id": "main", "email": "a@x.uz", "paid_credits": 0, "free_credits": 0,
         "last_reset_time": now.isoformat(), "last_active": now.isoformat()},
    ]
    for _ in range(2):
        row = admin_core.resolve_target("A@x.uz")
        assert row["user_id"] == "main" and [d["user_id"] for d in row["_dupes"]] == ["old"]
        admin_core.user_action("t", {"user_id": row["user_id"], "action": "add_credits", "pages": 80})
        sb.tables["user_usage"].reverse()          # Postgres UPDATE dan keyin tartib o'zgarishi mumkin
    assert sb.usage("main")["paid_credits"] == 160 * U and sb.usage("old")["paid_credits"] == 0


def test_admin_tg_linked_account_wins(sb, monkeypatch):
    _quiet(monkeypatch)
    now = datetime.now(timezone.utc).isoformat()
    sb.tables["user_usage"] = [{"user_id": "web", "email": "a@x.uz", "last_active": now, "free_credits": 0, "paid_credits": 0},
                               {"user_id": "linked", "email": "a@x.uz", "last_active": "2020-01-01", "free_credits": 0, "paid_credits": 0}]
    sb.tables["tg_links"] = [{"tg_id": 5, "user_id": "linked", "email": "a@x.uz"}]
    assert admin_core.resolve_target("a@x.uz")["user_id"] == "linked"


def test_admin_take_reports_same_balance_as_site(sb, monkeypatch):
    _quiet(monkeypatch)
    U = mon.UNIT
    old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "u1@x.uz", "paid_credits": 80 * U, "free_credits": 195,
                                "last_reset_time": old}]
    res = admin_core.user_action("t", {"user_id": "u1", "action": "add_credits", "pages": -80})
    site = mon.apply_24h_reset(dict(sb.usage("u1")))
    shown = res["user"]["free_pages"] + res["user"]["paid_pages"]
    assert shown == (site["free_credits"] + site["paid_credits"]) / U == 10      # avval bot 9.75, sayt 10 derdi


def test_admin_sequence_from_bug_report(sb, monkeypatch):
    _quiet(monkeypatch)
    U = mon.UNIT
    old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "u1@x.uz", "paid_credits": 80 * U, "free_credits": 195,
                                "last_reset_time": old}]
    shown = []
    for p in (-80, -80, -80, 80, 80):
        b = admin_core.user_action("t", {"user_id": "u1", "action": "add_credits", "pages": p})["user"]
        shown.append(b["free_pages"] + b["paid_pages"])
    assert shown == [10, 0, 0, 80, 160]


def test_admin_give_does_not_lose_parallel_spend(sb, monkeypatch):
    """Admin o'qigandan keyin foydalanuvchi varaq sarflasa — sarf ham, admin qo'shgani ham saqlanadi."""
    _quiet(monkeypatch)
    U = mon.UNIT
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "u1@x.uz", "paid_credits": 50 * U, "free_credits": 0,
                                "last_reset_time": datetime.now(timezone.utc).isoformat()}]
    real = admin_core._cas_update_credits
    state = {"n": 0}

    def racing(uid, patch, row):
        if state["n"] == 0:                         # birinchi urinishdan oldin foydalanuvchi 5 varaq sarfladi
            sb.usage("u1")["paid_credits"] -= 5 * U
        state["n"] += 1
        return real(uid, patch, row)
    monkeypatch.setattr(admin_core, "_cas_update_credits", racing)
    admin_core.user_action("t", {"user_id": "u1", "action": "add_credits", "pages": 10})
    assert sb.usage("u1")["paid_credits"] == (50 - 5 + 10) * U and state["n"] == 2
