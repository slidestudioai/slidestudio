"""v70: Yordam (Support) — foydalanuvchi adminga yozadi, admin ko'radi va javob beradi."""
import pytest

from backend import admin_core, support


@pytest.fixture(autouse=True)
def _reset():
    support._sent.clear()
    saved = dict(support._deps)
    yield
    support._sent.clear()
    support._deps.clear()
    support._deps.update(saved)


def _users(sb):
    sb.add_user("t1", "u-1", "one@x.uz")
    sb.add_user("t2", "u-2", "two@x.uz")


def test_send_requires_login(sb, client):
    r = client.post("/api/support/send", json={"body": "salom"})
    assert r.status_code == 401
    r = client.post("/api/support/send", json={"token": "bad", "body": "salom"})
    assert r.status_code == 401


def test_send_and_read_own_thread(sb, client):
    _users(sb)
    r = client.post("/api/support/send", json={"token": "t1", "body": "  Yordam kerak  "})
    assert r.status_code == 200 and r.json()["ok"] is True
    rows = sb.tables["support_messages"]
    assert len(rows) == 1 and rows[0]["body"] == "Yordam kerak" and rows[0]["email"] == "one@x.uz"
    assert rows[0]["read_by_admin"] is False and rows[0]["from_admin"] is False
    # Bearer header orqali ham ishlaydi; boshqa foydalanuvchi birovning xabarini ko'rmaydi
    my = client.post("/api/support/my", json={}, headers={"Authorization": "Bearer t1"}).json()
    assert [m["body"] for m in my["messages"]] == ["Yordam kerak"]
    other = client.post("/api/support/my", json={"token": "t2"}).json()
    assert other["messages"] == []


def test_validation_and_rate_limit(sb, client):
    _users(sb)
    assert client.post("/api/support/send", json={"token": "t1", "body": " a "}).status_code == 400
    long = "x" * (support.MSG_MAX_LEN + 500)
    assert client.post("/api/support/send", json={"token": "t1", "body": long}).status_code == 200
    assert len(sb.tables["support_messages"][0]["body"]) == support.MSG_MAX_LEN
    r = client.post("/api/support/send", json={"token": "t1", "body": "yana bitta"})
    assert r.status_code == 429                   # cooldown
    assert client.post("/api/support/send", json={"token": "t2", "body": "boshqa odam"}).status_code == 200


def test_missing_table_gives_clear_error(sb, client):
    _users(sb)
    sb.fail_tables.add("support_messages")
    r = client.post("/api/support/send", json={"token": "t1", "body": "salom"})
    assert r.status_code == 503 and "SUPABASE_SCHEMA" in r.json()["error"]


def test_admin_sees_threads_and_replies(sb, client):
    _users(sb)
    client.post("/api/support/send", json={"token": "t1", "body": "birinchi savol"})
    support._sent.clear()
    client.post("/api/support/send", json={"token": "t2", "body": "ikkinchi savol"})

    lst = admin_core._dispatch("support_list", {}, "tg1")
    by = {t["user_id"]: t for t in lst["threads"]}
    assert set(by) == {"u-1", "u-2"} and by["u-1"]["unread"] == 1 and lst["unread_total"] == 2
    assert admin_core._dispatch("support_unread", {}, "tg1")["unread"] == 2

    th = admin_core._dispatch("support_thread", {"user_id": "u-1"}, "tg1")
    assert th["email"] == "one@x.uz" and [m["body"] for m in th["messages"]] == ["birinchi savol"]
    assert admin_core._dispatch("support_unread", {}, "tg1")["unread"] == 1     # ochildi = o'qildi

    assert admin_core._dispatch("support_reply", {"user_id": "u-1", "text": "Javob shu"}, "tg1")["ok"] is True
    # foydalanuvchi: o'qilmagan javob bor → ochganda o'qilgan bo'ladi
    assert client.post("/api/support/unread", json={"token": "t1"}).json()["unread"] == 1
    my = client.post("/api/support/my", json={"token": "t1"}).json()
    assert [(m["body"], m["from_admin"]) for m in my["messages"]] == [("birinchi savol", False), ("Javob shu", True)]
    assert my["unread"] == 1
    assert client.post("/api/support/unread", json={"token": "t1"}).json()["unread"] == 0
    # ikkinchi foydalanuvchi admin javobini ko'rmaydi
    assert client.post("/api/support/unread", json={"token": "t2"}).json()["unread"] == 0


def test_admin_reply_errors(sb, client):
    _users(sb)
    with pytest.raises(admin_core.AdminError):
        admin_core._dispatch("support_reply", {"user_id": "u-1", "text": "salom"}, "tg1")   # yozishma yo'q
    client.post("/api/support/send", json={"token": "t1", "body": "savol"})
    with pytest.raises(admin_core.AdminError):
        admin_core._dispatch("support_reply", {"user_id": "u-1", "text": " "}, "tg1")
    with pytest.raises(admin_core.AdminError):
        admin_core._dispatch("support_thread", {}, "tg1")


def test_admin_http_api_requires_token(sb, client):
    r = client.post("/_a/api/support_list", json={})
    assert r.status_code == 404


# ---------------------------------------------------------------- Telegram bot
import asyncio  # noqa: E402

from backend import telegram_bot as tb  # noqa: E402


def _bot(monkeypatch, sb):
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append((cid, text, kb))
        return {"message_id": 1}

    async def fake_tg(method, **kw):
        sent.append((kw.get("chat_id"), method, kw.get("reply_markup")))
        return True

    async def fake_uid(user):
        return ("u-tg", "tg555@t.me")

    monkeypatch.setattr(tb, "_send", fake_send)
    monkeypatch.setattr(tb, "_show", lambda cid, mid, text, kb=None: fake_send(cid, text, kb))
    monkeypatch.setattr(tb, "tg", fake_tg)
    monkeypatch.setattr(tb, "_ensure_uid", fake_uid)
    monkeypatch.setattr(tb, "ENABLED", True)
    return sent


def test_bot_user_writes_to_support(sb, monkeypatch):
    sent = _bot(monkeypatch, sb)
    cid = 555
    user = {"id": cid, "first_name": "Ali"}
    tb._chats.pop(cid, None)
    st = tb._state(cid)
    asyncio.run(tb._support_open(cid, user))
    assert st.get("sup_await") is True and "Adminga yozish" in sent[-1][1]
    asyncio.run(tb._handle_text(cid, user, "Botda PDF ochilmayapti"))
    rows = sb.tables["support_messages"]
    assert rows[-1]["body"] == "Botda PDF ochilmayapti" and rows[-1]["source"] == "tg" and rows[-1]["author"] == "Ali"
    assert "sup_await" not in st and "yuborildi" in sent[-1][1]
    # keyingi oddiy matn endi adminga ketmaydi
    calls = []
    monkeypatch.setattr(tb, "_run_new", lambda cid, u, t: ("new", t))
    monkeypatch.setattr(tb, "_spawn", lambda c: calls.append(c))
    st.update(ui="new", ui_ts=tb.time.time())            # v76: slayd faqat «🆕 Yangi slayd» bosilgandan keyin
    asyncio.run(tb._handle_text(cid, user, "Kosmos haqida slayd"))
    assert calls == [("new", "Kosmos haqida slayd")] and len(sb.tables["support_messages"]) == 1


def test_bot_menu_button_cancels_support_wait(sb, monkeypatch):
    _bot(monkeypatch, sb)
    cid = 556
    tb._chats.pop(cid, None)
    st = tb._state(cid)
    st["sup_await"] = True
    seen = []

    async def menu(c, u, a):
        seen.append(a)

    monkeypatch.setattr(tb, "_menu_action", menu)
    asyncio.run(tb._handle_text(cid, {"id": cid}, tb.BTN_BAL))
    assert seen == ["bal"] and "sup_await" not in st and "support_messages" not in sb.tables


def test_bot_admin_lists_and_replies(sb, client, monkeypatch):
    sent = _bot(monkeypatch, sb)
    sb.add_user("t1", "u-1", "one@x.uz")
    client.post("/api/support/send", json={"token": "t1", "body": "Saytdan savol"})
    monkeypatch.setenv("ADMIN_TG_IDS", "777")
    admin = {"id": 777}
    monkeypatch.setattr(tb, "_adm", lambda u: admin_core)
    asyncio.run(tb._admin_cb(777, 10, admin, "a:sup"))
    assert "one@x.uz" in sent[-1][1] and any("a:spt:u-1" == b["callback_data"] for r in sent[-1][2]["inline_keyboard"] for b in r)
    asyncio.run(tb._admin_cb(777, 10, admin, "a:spr:u-1"))
    st = tb._state(777)
    assert st["adm"] == {"await": "sup_reply", "uid": "u-1"}
    replied = []

    async def notify(uid, body):
        replied.append((uid, body))

    support._deps["notify_reply"] = notify
    done = asyncio.run(tb._admin_input(777, admin, {"text": "Botdan javob"}, st))
    assert done is True and "adm" not in st
    rows = sb.tables["support_messages"]
    assert rows[-1]["body"] == "Botdan javob" and rows[-1]["from_admin"] is True
    assert "Javob yuborildi" in sent[-1][1]


def test_bot_notifies_admins_with_reply_button(sb, monkeypatch):
    sent = _bot(monkeypatch, sb)
    monkeypatch.setenv("ADMIN_TG_IDS", "777,888")
    monkeypatch.setattr(tb, "_deps", dict(tb._deps, admin=admin_core))
    asyncio.run(tb.support_notify_admins("u-1", "one@x.uz", "<b>salom</b>", "tg"))
    assert {c for c, *_ in sent} == {777, 888}
    text, kb = sent[0][1], sent[0][2]
    assert "&lt;b&gt;salom&lt;/b&gt;" in text and "Telegram bot" in text
    assert kb["inline_keyboard"][0][0]["callback_data"] == "a:spr:u-1"


def test_rate_limit_also_counts_messages_from_other_workers(sb, monkeypatch):
    """v82.7: the RAM counter is per worker — the DB copy stops the limit from multiplying with workers."""
    support._deps["get_supabase"] = lambda: sb
    support.user_send("u-9", "n@x.uz", "N", "Birinchi xabar")
    support._sent.clear()                                      # the next request lands on another worker
    with pytest.raises(support.SupportError) as e:
        support.user_send("u-9", "n@x.uz", "N", "Ikkinchi xabar darhol")
    assert e.value.code == 429
    # hourly cap from the DB alone
    now = support.time.time()
    sb.tables["support_messages"] = [
        {"user_id": "u-8", "from_admin": False, "body": "x",
         "created_at": support.datetime.fromtimestamp(now - 60 - i * 60, support.timezone.utc).isoformat()}
        for i in range(support.MAX_PER_HOUR)]
    with pytest.raises(support.SupportError) as e2:
        support.user_send("u-8", "m@x.uz", "M", "Yana bitta")
    assert e2.value.code == 429 and "soat" in e2.value.msg


# ---------------------------------------------------------------- v83: media, message numbers, profile, delete
def _tg_user_row(sb):
    sb.tables.setdefault("user_usage", []).append({
        "user_id": "u-tg", "email": "tg555@t.me", "free_credits": 200, "paid_credits": 0, "telegram_id": 555,
        "tg_username": "ali_uz", "display_name": "Ali Valiyev", "created_at": "2026-11-01T00:00:00+00:00"})


def test_bot_support_photo_goes_to_admin_with_number_and_profile(sb, monkeypatch):
    sent = _bot(monkeypatch, sb)
    _tg_user_row(sb)
    monkeypatch.setenv("ADMIN_TG_IDS", "777")
    monkeypatch.setattr(tb, "_deps", dict(tb._deps, admin=admin_core))
    monkeypatch.setattr(tb, "_limited", lambda *a, **k: False)
    cid = 555
    tb._chats.pop(cid, None)
    user = {"id": cid, "first_name": "Ali"}
    asyncio.run(tb._support_open(cid, user))
    assert "rasm" in sent[-1][1] and "ovozli" in sent[-1][1]          # the user is told media is fine
    photo = {"update_id": 9001, "message": {"message_id": 42, "chat": {"id": cid, "type": "private"}, "from": user,
             "photo": [{"file_id": "small", "file_size": 10}, {"file_id": "big", "file_size": 99}],
             "caption": "Shu xato chiqyapti"}}

    async def run():
        await tb.handle_update(photo)
        await asyncio.sleep(0.05)                                    # admin notice runs in the background
    asyncio.run(run())
    row = sb.tables["support_messages"][-1]
    assert row["body"] == "📷 Rasm\nShu xato chiqyapti" and row["source"] == "tg" and row["id"] >= 1
    to_user = [t for c, t, *_ in sent if c == cid and isinstance(t, str) and "Murojaatingiz" in t]
    assert to_user and f"№{row['id']}" in to_user[-1]
    admin_text = [t for c, t, *_ in sent if c == 777 and isinstance(t, str) and "Yangi yordam" in t][-1]
    assert "Ali Valiyev" in admin_text and "@ali_uz" in admin_text and "TG 555" in admin_text and f"№{row['id']}" in admin_text
    assert any(c == 777 and m == "copyMessage" for c, m, *_ in sent)                     # the photo itself
    assert "sup_await" not in tb._state(cid) and not any(m == "copyMessage" and c == cid for c, m, *_ in sent)


def test_bot_support_voice_is_accepted(sb, monkeypatch):
    sent = _bot(monkeypatch, sb)
    monkeypatch.setattr(tb, "_limited", lambda *a, **k: False)
    cid = 557
    tb._chats.pop(cid, None)
    tb._state(cid)["sup_await"] = True
    voice = {"update_id": 9002, "message": {"message_id": 5, "chat": {"id": cid, "type": "private"},
             "from": {"id": cid, "first_name": "Vali"}, "voice": {"file_id": "v1", "duration": 3}}}
    asyncio.run(tb.handle_update(voice))
    assert sb.tables["support_messages"][-1]["body"] == "🎤 Ovozli xabar"


def test_voice_outside_support_gets_a_clear_answer(sb, monkeypatch):
    sent = _bot(monkeypatch, sb)
    monkeypatch.setattr(tb, "_limited", lambda *a, **k: False)
    cid = 558
    tb._chats.pop(cid, None)
    asyncio.run(tb.handle_update({"update_id": 9003, "message": {"message_id": 6, "chat": {"id": cid, "type": "private"},
                                  "from": {"id": cid}, "voice": {"file_id": "v2"}}}))
    assert "Ovozli xabarni" in sent[-1][1] and "support_messages" not in sb.tables


def test_admin_support_list_shows_who_wrote_and_can_delete(sb, client, monkeypatch):
    _users(sb)
    _tg_user_row(sb)
    client.post("/api/support/send", json={"token": "t1", "body": "Saytdan savol"})
    support.user_send("u-tg", "tg555@t.me", "Ali", "Botdan savol", "tg")
    lst = admin_core._dispatch("support_list", {}, "tg1")
    by = {t["user_id"]: t for t in lst["threads"]}
    assert "Ali Valiyev" in by["u-tg"]["who"] and "@ali_uz" in by["u-tg"]["who"] and "tg555@t.me" not in by["u-tg"]["who"]
    th = admin_core._dispatch("support_thread", {"user_id": "u-tg"}, "tg1")
    assert th["profile"]["username"] == "ali_uz" and th["profile"]["tg_id"] == 555
    r = admin_core._dispatch("support_delete", {"user_id": "u-tg"}, "tg1")
    assert r["deleted"] == 1
    assert {m["user_id"] for m in sb.tables["support_messages"]} == {"u-1"}           # only that conversation


def test_site_send_returns_message_number(sb, client):
    _users(sb)
    r = client.post("/api/support/send", json={"token": "t1", "body": "Raqam kerak"}).json()
    assert r["message"]["id"] == sb.tables["support_messages"][-1]["id"]


def test_bot_admin_sees_name_not_tech_email_and_delete_button(sb, client, monkeypatch):
    sent = _bot(monkeypatch, sb)
    _tg_user_row(sb)
    support.user_send("u-tg", "tg555@t.me", "Ali", "Botdan savol", "tg")
    monkeypatch.setenv("ADMIN_TG_IDS", "777")
    monkeypatch.setattr(tb, "_adm", lambda u: admin_core)
    monkeypatch.setattr(tb, "_deps", dict(tb._deps, admin=admin_core))
    asyncio.run(tb._admin_cb(777, 10, {"id": 777}, "a:sup"))
    assert "Ali Valiyev" in sent[-1][1] and "tg555@t.me" not in sent[-1][1]
    asyncio.run(tb._admin_cb(777, 10, {"id": 777}, "a:spt:u-tg"))
    datas = [b["callback_data"] for r in sent[-1][2]["inline_keyboard"] for b in r]
    assert "a:spd:u-tg" in datas
    asyncio.run(tb._admin_cb(777, 10, {"id": 777}, "a:spD:u-tg"))
    assert "o'chirildi" in sent[-1][1] and not sb.tables["support_messages"]


def test_admin_stats_and_filters_know_free_paid_and_deep(sb):
    U = admin_core.mon.UNIT
    sb.tables["user_usage"] = [
        {"user_id": "f1", "email": "a@x.uz", "free_credits": 100, "paid_credits": 0},
        {"user_id": "p1", "email": "b@x.uz", "free_credits": 0, "paid_credits": 100 * U},
        {"user_id": "p2", "email": "tg5@t.me", "free_credits": 0, "paid_credits": 5 * U},
        {"user_id": "v1", "email": "c@x.uz", "free_credits": 0, "paid_credits": 0, "unlimited": True}]
    s = admin_core._dispatch("stats", {}, "t")
    assert (s["free_users"], s["paid_now"], s["deep_open"], s["deep_min_paid_pages"]) == (2, 2, 2, 10)
    ids = lambda f: sorted(u["user_id"] for u in admin_core._dispatch("users", {"filter": f}, "t")["users"])
    assert ids("free") == ["f1", "v1"] and ids("paid") == ["p1", "p2"] and ids("deep") == ["p1", "v1"]
    by = {u["user_id"]: u for u in admin_core._dispatch("users", {}, "t")["users"]}
    assert by["p1"]["deep_ok"] and by["v1"]["deep_ok"] and not by["p2"]["deep_ok"] and not by["f1"]["deep_ok"]
    assert "🔒" in by["f1"]["balance"]["text"]
