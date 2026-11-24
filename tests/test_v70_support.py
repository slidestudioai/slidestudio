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
