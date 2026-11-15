"""v66: ko'p tillilik — Telegram bot (til tanlash, saqlash, tarjima) va saytdagi tarjima lug'ati."""
import asyncio
import json
import os
import re
import subprocess

import main  # noqa: F401  (bot _deps ni sozlaydi)
from backend import bot_i18n as i18n
from backend import telegram_bot as tb

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class _Resp:
    status_code = 200

    def json(self):
        return {"ok": True, "result": {"message_id": 1}}


class _Http:
    def __init__(self):
        self.calls = []

    async def post(self, url, json=None):
        self.calls.append((url.rsplit("/", 1)[-1], json or {}))
        return _Resp()


def _bot(monkeypatch):
    http = _Http()
    monkeypatch.setattr(tb, "ENABLED", True)
    monkeypatch.setattr(tb, "_http", lambda: http)
    monkeypatch.setattr(tb, "_limited", lambda *a, **k: False)
    tb._lang_cache.clear()

    async def no_balance(user):
        return None
    monkeypatch.setattr(tb, "_balance_info", no_balance)
    monkeypatch.setattr(tb, "_spawn", lambda coro: coro.close())
    return http


def _msg(text, uid=5551, lang_code="uz"):
    return {"update_id": abs(hash(text + str(uid))) % 10**9,
            "message": {"chat": {"id": uid, "type": "private"}, "from": {"id": uid, "language_code": lang_code}, "text": text}}


def _cb(data, uid=5551):
    return {"callback_query": {"id": "q1", "data": data, "from": {"id": uid},
                               "message": {"chat": {"id": uid}, "message_id": 77}}}


def _texts(http):
    return [p.get("text", "") for m, p in http.calls if m in ("sendMessage", "editMessageText")]


# ------------------------------------------------------------------ lug'at
def test_translate_text_and_buttons():
    assert i18n.translate(i18n.HELP_UZ, "ru") == i18n.HELP_RU
    assert i18n.translate(i18n.HELP_UZ, "en") == i18n.HELP_EN
    assert i18n.translate("😔 <b>Varaqlar tugadi.</b>\nDavom etish uchun varaq sotib oling 👇", "en") == \
        "😔 <b>You are out of pages.</b>\nBuy pages to continue 👇"
    assert i18n.translate("hello", "uz") == "hello"
    kb = {"keyboard": [[{"text": "💳 Balans"}, {"text": "⚙️ Sozlamalar"}]], "input_field_placeholder": "Slayd mavzusini yozing…"}
    out = i18n.translate_markup(kb, "ru")
    assert out["keyboard"][0][0]["text"] == "💳 Баланс" and out["input_field_placeholder"] == "Напишите тему слайдов…"
    assert kb["keyboard"][0][0]["text"] == "💳 Balans"                  # asl nusxa o'zgarmaydi


def test_menu_understands_all_languages():
    assert tb.MENU["💳 Баланс"] == tb.MENU["💳 Balance"] == tb.MENU["💳 Balans"] == "bal"
    assert tb.MENU["🎨 Create slides"] == "new"


def test_guess_from_telegram_language():
    assert i18n.guess("ru") == "ru" and i18n.guess("en-US") == "en" and i18n.guess("uz") == "uz"
    assert i18n.guess("de") == "uz" and i18n.guess(None) == "uz"


# ------------------------------------------------------------------ /start oqimi
def test_first_start_asks_language_then_saves_and_greets(sb, monkeypatch):
    http = _bot(monkeypatch)
    asyncio.run(tb.handle_update(_msg("/start")))
    first = http.calls[-1]
    assert first[0] == "sendMessage" and first[1]["text"] == i18n.PICK_TEXT
    assert [b[0]["callback_data"] for b in first[1]["reply_markup"]["inline_keyboard"]] == ["lang:uz", "lang:ru", "lang:en"]

    http.calls.clear()
    asyncio.run(tb.handle_update(_cb("lang:ru")))
    assert sb.tables["tg_prefs"][0]["tg_id"] == 5551 and sb.tables["tg_prefs"][0]["lang"] == "ru"
    sent = [p for m, p in http.calls if m == "sendMessage"]
    greet = sent[-1]
    assert "Напишите тему" in greet["text"]                              # salomlashuv ruscha
    labels = [b["text"] for row in greet["reply_markup"]["keyboard"] for b in row]
    assert "💳 Баланс" in labels and "⚙️ Настройки" in labels
    menu_btn = [p for m, p in http.calls if m == "setChatMenuButton"]
    assert not menu_btn or "lang=ru" in menu_btn[0]["menu_button"]["web_app"]["url"]

    # keyingi /start — til qayta so'ralmaydi
    http.calls.clear()
    tb._lang_cache.clear()                                               # bazadan o'qiladi
    asyncio.run(tb.handle_update(_msg("/start")))
    assert i18n.PICK_TEXT not in _texts(http)
    assert any("Напишите тему" in t for t in _texts(http))


def test_unknown_language_user_gets_telegram_language(sb, monkeypatch):
    http = _bot(monkeypatch)
    asyncio.run(tb.handle_update(_msg("/help", uid=7001, lang_code="en")))
    assert _texts(http)[-1] == i18n.HELP_EN


def test_lang_command_shows_picker(sb, monkeypatch):
    http = _bot(monkeypatch)
    asyncio.run(tb.handle_update(_msg("/lang", uid=7002)))
    assert _texts(http)[-1] == i18n.PICK_TEXT


def test_app_url_carries_language():
    tok = tb._ctx_lang.set("en")
    try:
        assert "lang=en" in tb._app_url() and "lang=en" in tb._app_url("AI")
    finally:
        tb._ctx_lang.reset(tok)


# ------------------------------------------------------------------ sayt lug'ati
def test_site_translations_are_complete():
    src = open(os.path.join(ROOT, "js", "translations.js"), encoding="utf-8").read()
    js = "global.window={};" + src + ";process.stdout.write(JSON.stringify(window.SS_I18N));"
    data = json.loads(subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout)
    assert set(data["names"]) == {"uz", "ru", "en"}
    for k, v in data["text"].items():
        assert isinstance(v, list) and len(v) == 2 and all(isinstance(x, str) and x for x in v), k
    for p in data["patterns"]:
        re.compile(p[0].replace("\\$", "\\$"))
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    for f in ("js/translations.js", "js/i18n.js", "js/voice.js", "js/slide_plus.js"):
        assert f in html
    assert "48_voice_plus" not in html
