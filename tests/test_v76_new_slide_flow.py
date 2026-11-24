"""v76: botda slayd yaratish qoidasi.
1) v78: Google SHART EMAS — Telegram akkaunti ham darhol slayd yasaydi.
2) «🆕 Yangi slayd» bosilmagan / sessiya eskirgan — slayd yasalmaydi; matn eslab qolinadi va 1 bosishda boshlanadi.
3) «Yangi slayd» oldingi qoralama va qotib qolgan holatni tozalaydi; dizayn (uslub / rang) tanlanadi.
"""
import asyncio
import time

import pytest

from backend import telegram_bot as tb

_REAL_GENERATE = tb._run_generate


@pytest.fixture
def bot(monkeypatch):
    out = {"sent": [], "spawned": [], "tg": []}

    async def fake_send(cid, text, kb=None):
        out["sent"].append((cid, text, kb))
        return {"message_id": 1}

    async def fake_tg(method, **kw):
        out["tg"].append((method, kw))
        return True

    monkeypatch.setattr(tb, "_send", fake_send)
    monkeypatch.setattr(tb, "tg", fake_tg)
    def spawn(coro):
        if hasattr(coro, "close"):          # haqiqiy coroutine (masalan, _prewarm_files) — ishga tushirmaymiz
            coro.close()
            return
        out["spawned"].append(coro)

    monkeypatch.setattr(tb, "_spawn", spawn)
    monkeypatch.setattr(tb, "_run_new", lambda cid, u, t: ("new", t))
    monkeypatch.setattr(tb, "_run_edit", lambda cid, u, t: ("edit", t))
    monkeypatch.setattr(tb, "_run_generate", lambda cid, u, t, n: ("gen", t, n))
    monkeypatch.setattr(tb, "DEV_MODE", False)
    monkeypatch.setattr(tb, "_is_admin", lambda u: False)
    return out


def _linked(monkeypatch, yes: bool):
    async def ensure(user):
        return ("u-1", "ali@gmail.com" if yes else tb._tg_email(user["id"]))

    monkeypatch.setattr(tb, "_ensure_uid", ensure)


def _fresh(cid):
    tb._chats.pop(cid, None)
    tb._rl.pop(cid, None)
    return tb._state(cid)


def _cb(cid, data):
    return {"id": "q", "data": data, "from": {"id": cid}, "message": {"chat": {"id": cid}, "message_id": 5}}


def _buttons(kb):
    return [b.get("callback_data") or b.get("text") for row in (kb or {}).get("inline_keyboard", []) for b in row]


# ---- 1) v78: Telegram akkaunti (Google ulanmagan) — hech qanday to'siq yo'q ----
def test_telegram_account_text_makes_slides(bot, monkeypatch):
    _linked(monkeypatch, False)
    st = _fresh(7601)
    st.update(ui="new", ui_ts=time.time())
    asyncio.run(tb._handle_text(7601, {"id": 7601}, "Kosmos haqida slayd"))
    assert bot["spawned"] == [("new", "Kosmos haqida slayd")]
    assert not any("linkinfo" in _buttons(kb) for _c, _t, kb in bot["sent"])


def test_telegram_account_new_button_opens_session(bot, monkeypatch):
    _linked(monkeypatch, False)
    st = _fresh(7602)
    asyncio.run(tb._menu_action(7602, {"id": 7602}, "new"))
    assert st.get("ui") == "new" and "Google" not in bot["sent"][-1][1]
    assert "linkinfo" not in _buttons(bot["sent"][-1][2])


# ---- 2) «Yangi slayd» bosilmagan ----
def test_linked_text_without_new_asks_and_remembers(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7603)
    asyncio.run(tb._handle_text(7603, {"id": 7603}, "  Kosmos   haqida slayd "))
    assert bot["spawned"] == []
    assert st["pending"]["text"] == "Kosmos haqida slayd"
    assert _buttons(bot["sent"][-1][2]) == ["newgo", "new"]


def test_ask_offers_edit_when_deck_exists(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7604)
    st["deck"] = {"title": "AI", "slides": [{"layout": "title", "title": "AI"}]}
    asyncio.run(tb._handle_text(7604, {"id": 7604}, "3-slaydni qisqartir"))
    assert _buttons(bot["sent"][-1][2]) == ["newgo", "editgo", "new"]
    asyncio.run(tb._handle_callback(_cb(7604, "editgo")))
    assert bot["spawned"] == [("edit", "3-slaydni qisqartir")] and st["ui"] == "edit"


def test_newgo_one_click_starts_clean_session(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7605)
    st.update(deck={"title": "Old", "slides": []}, deck_id=11, topic="Old")
    asyncio.run(tb._handle_text(7605, {"id": 7605}, "Kosmos haqida slayd"))
    asyncio.run(tb._handle_callback(_cb(7605, "newgo")))
    assert bot["spawned"] == [("new", "Kosmos haqida slayd")]
    assert st["deck"] is None and st["deck_id"] is None and st["ui"] == "new" and st["pending"] is None


def test_expired_new_session_asks_again(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7606)
    st.update(ui="new", ui_ts=time.time() - tb.NEW_TTL - 5)
    asyncio.run(tb._handle_text(7606, {"id": 7606}, "Kosmos"))
    assert bot["spawned"] == [] and st["ui"] is None
    assert tb.EXPIRED_TEXT in bot["sent"][-1][1]


def test_new_mode_generates(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7607)
    asyncio.run(tb._menu_action(7607, {"id": 7607}, "new"))
    assert st["ui"] == "new" and "sty:modern" in _buttons(bot["sent"][-1][2])
    asyncio.run(tb._handle_text(7607, {"id": 7607}, "Kosmos"))
    assert bot["spawned"] == [("new", "Kosmos")]


# ---- 3) Qotib qolgan holat ----
def test_stale_busy_is_cleared_fresh_busy_kept():
    st = {"busy": True, "busy_ts": time.time()}
    assert tb._is_busy(st) is True
    st["busy_ts"] = time.time() - tb.BUSY_STALE - 1
    assert tb._is_busy(st) is False and st["busy"] is False


def test_new_button_resets_stuck_state(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7608)
    st.update(busy=True, busy_ts=time.time() - tb.BUSY_STALE - 1, deck={"title": "x", "slides": []}, awaiting="x")
    asyncio.run(tb._menu_action(7608, {"id": 7608}, "new"))
    assert st["busy"] is False and st["deck"] is None and st["awaiting"] is None and st["ui"] == "new"


# ---- Dizayn va natija tugmalari ----
def test_design_buttons_toggle(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7609)
    asyncio.run(tb._handle_callback(_cb(7609, "sty:business")))
    asyncio.run(tb._handle_callback(_cb(7609, "pth:leaf")))            # v78: sayt mavzulari (js/51_design_themes.js)
    assert st["style"] == "business" and st["theme_pref"] == "leaf"
    kb = bot["tg"][-1][1]["reply_markup"]
    labels = [b["text"] for row in kb["inline_keyboard"] for b in row]
    assert "✅ 💼 Biznes" in labels and any(x.startswith("✅ ") and "Yashil barg" in x for x in labels)
    asyncio.run(tb._handle_callback(_cb(7609, "pth:auto")))
    asyncio.run(tb._handle_callback(_cb(7609, "sty:business")))       # qayta bosish — bekor qiladi
    assert st["theme_pref"] is None and st["style"] is None


def test_done_keyboard_has_ux_buttons():
    btns = _buttons(tb.kb_done({"deck_id": 1, "cid": 2}))
    for need in ("dl:pptx", "dl:pdf", "theme", "edit", "regen", "new", "✏️ Muharrirda tahrirlash"):
        assert need in btns
    assert btns[0] == "✏️ Muharrirda tahrirlash"                       # v78: birinchi tugma


def test_regen_uses_same_topic(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7610)
    st.update(topic="Kosmos", deck={"title": "K", "slides": [{}] * 6})
    asyncio.run(tb._handle_callback(_cb(7610, "regen")))
    assert bot["spawned"] == [("gen", "Kosmos", 6)]


def test_linked_message_offers_new_slide():
    assert "new" in _buttons(tb.kb_linked())


def test_new_texts_are_translated():
    from backend import bot_i18n as i18n
    for t in (tb.NEW_TEXT, tb.ASK_NEW_TEXT, tb.EXPIRED_TEXT):
        assert i18n.translate(t, "en") != t and i18n.translate(t, "ru") != t


def test_generate_applies_chosen_style_and_colour(bot, monkeypatch):
    _linked(monkeypatch, True)
    st = _fresh(7611)
    st.update(style="minimal", theme_pref="rose", mode="fast")
    seen = {}

    async def ai(system, prompt, mode):
        seen["prompt"] = prompt
        return {"title": "Kosmos", "theme": "ocean", "slides": [{"layout": "title", "title": "Kosmos"},
                {"layout": "bullets", "title": "A", "bullets": ["b1", "b2"]}, {"layout": "bullets", "title": "B", "bullets": ["c"]}]}, 10

    async def none(*a, **k):
        return 0

    async def imgs(*a, **k):
        return {}

    async def charge(*a, **k):
        return {}, 3

    async def edit(*a, **k):
        seen["card"] = a

    monkeypatch.setattr(tb, "_ai_json", ai)
    monkeypatch.setattr(tb, "_ensure_image_queries", none)
    monkeypatch.setattr(tb, "_fetch_images", imgs)
    monkeypatch.setattr(tb, "_charge", charge)
    monkeypatch.setattr(tb, "_edit", edit)
    monkeypatch.setattr(tb, "_maybe_ad", none)
    monkeypatch.setattr(tb, "_usage_now_sync", lambda uid, email: {})
    monkeypatch.setattr(tb, "_deck_insert_sync", lambda *a: 5)
    monkeypatch.setattr(tb, "_pages_left", lambda *a: 10)
    monkeypatch.setitem(tb._deps, "total_credits", lambda u: 100)
    monkeypatch.setattr(tb, "_page_units", lambda m, usage=None: 1)
    asyncio.run(_REAL_GENERATE(7611, {"id": 7611}, "Kosmos", 3))
    assert "MINIMALIST" in seen["prompt"]
    assert st["deck"]["theme"] == "rose" and st["ui"] is None
