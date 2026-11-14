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


# ---------------------------------------------------------------------------------------------
# v66: 1 email = 1 akkaunt = 1 balans
# ---------------------------------------------------------------------------------------------
def _four_rows(sb):
    U = mon.UNIT
    now = datetime.now(timezone.utc).isoformat()
    sb.tables["user_usage"] = [
        {"user_id": "dead-linked", "email": "a@x.uz", "paid_credits": 80 * U, "free_credits": 200, "last_reset_time": now,
         "last_active": now, "total_tokens": 5},
        {"user_id": "dead-2", "email": "a@x.uz", "paid_credits": 90 * U, "free_credits": 0, "last_reset_time": now,
         "plan": "vip", "plan_until": None},
        {"user_id": "dead-3", "email": "a@x.uz", "paid_credits": 0, "free_credits": 200, "last_reset_time": now},
        {"user_id": "alive", "email": "a@x.uz", "paid_credits": 10 * U, "free_credits": 200, "last_reset_time": now,
         "last_active": "2020-01-01", "total_tokens": 7},
        {"user_id": "other", "email": "b@x.uz", "paid_credits": 5 * U, "free_credits": 0, "last_reset_time": now},
    ]
    sb.tables["tg_links"] = [{"tg_id": 77, "user_id": "dead-linked", "email": "a@x.uz"}]
    sb.add_user("tok-a", "alive", "a@x.uz")


def test_merge_moves_everything_into_the_live_account(sb, monkeypatch):
    _quiet(monkeypatch)
    _four_rows(sb)
    r = admin_core.merge_email_accounts("t", "A@x.uz")
    assert r["target"] == "alive" and r["merged"] == 3 and r["moved_pages"] == 170
    rows = [x for x in sb.tables["user_usage"] if x["email"] == "a@x.uz"]
    assert [x["user_id"] for x in rows] == ["alive"]
    a = sb.usage("alive")
    assert a["paid_credits"] == 180 * mon.UNIT and a["free_credits"] == 200          # bepul ko'chirilmaydi
    assert a["plan"] == "vip" and a["total_tokens"] == 12
    assert sb.tables["tg_links"] == [{"tg_id": 77, "user_id": "alive", "email": "a@x.uz"}]
    assert sb.usage("other")["paid_credits"] == 5 * mon.UNIT                          # boshqa email tegilmaydi
    assert admin_core.merge_email_accounts("t", "a@x.uz")["merged"] == 0              # takror chaqirish xavfsiz


def test_give_by_email_merges_first(sb, monkeypatch):
    _quiet(monkeypatch)
    _four_rows(sb)
    row = admin_core.resolve_target("a@x.uz")
    assert row["user_id"] == "alive" and not row.get("_dupes")
    admin_core.user_action("t", {"user_id": row["user_id"], "action": "add_credits", "pages": 80})
    assert sb.usage("alive")["paid_credits"] == 260 * mon.UNIT


def test_site_login_merges_old_accounts(sb, client, monkeypatch):
    _quiet(monkeypatch)
    _four_rows(sb)
    main._merge_checked.clear()
    d = client.get("/api/user/usage", params={"token": "tok-a"}).json()
    assert d["paid_credits"] == 180 * mon.UNIT
    assert len([x for x in sb.tables["user_usage"] if x["email"] == "a@x.uz"]) == 1


def test_merge_does_nothing_when_auth_unknown(sb, monkeypatch):
    _quiet(monkeypatch)
    _four_rows(sb)

    def boom(uid):
        raise RuntimeError("connection reset")
    monkeypatch.setattr(sb.auth.admin, "get_user_by_id", boom)
    import pytest
    with pytest.raises(admin_core.AdminError):
        admin_core.merge_email_accounts("t", "a@x.uz")
    assert len([x for x in sb.tables["user_usage"] if x["email"] == "a@x.uz"]) == 4


def test_merge_all(sb, monkeypatch):
    _quiet(monkeypatch)
    _four_rows(sb)
    r = admin_core.merge_all_duplicates("t")
    assert r["emails"] == 1 and r["merged"] == 3 and not r["errors"]


def test_telegram_without_google_has_no_free_pages():
    assert mon.daily_units_for({"email": "tg123@t.me"}) == 0
    assert mon.daily_units_for({"email": "a@x.uz"}) == mon.free_daily_units()
    u = mon.apply_24h_reset({"email": "tg123@t.me", "free_credits": 200, "paid_credits": 0})
    assert mon.total_credits(u) == 0
    from backend import telegram_bot as tb
    text, kb = tb._no_credit_reply("fast", {"email": "tg123@t.me"})
    assert text == tb.LINK_FIRST and kb["inline_keyboard"][0][0]["callback_data"] == "linkinfo"
