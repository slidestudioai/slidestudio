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
    monkeypatch.setattr(tb, "SMALLTALK_PAUSE", 0)
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
    assert i18n.guess("de") == "en" and i18n.guess(None) == "en"          # asosiy til — ingliz


# ------------------------------------------------------------------ /start oqimi
def test_first_start_uses_telegram_language_and_greets_at_once(sb, monkeypatch):
    """v78: birinchi /start da til SO'RALMAYDI — Telegram tilidan olinadi, saqlanadi va darhol 3 tugmali salom chiqadi."""
    http = _bot(monkeypatch)
    asyncio.run(tb.handle_update(_msg("/start", lang_code="ru")))
    assert i18n.PICK_TEXT not in _texts(http)
    assert sb.tables["tg_prefs"][0]["tg_id"] == 5551 and sb.tables["tg_prefs"][0]["lang"] == "ru"
    greet = [p for m, p in http.calls if m == "sendMessage" and "inline_keyboard" in (p.get("reply_markup") or {})][-1]
    assert "Напишите тему" in greet["text"] and "Google" not in greet["text"]
    labels = [b["text"] for row in greet["reply_markup"]["inline_keyboard"] for b in row]
    assert labels == ["🆕 Новые слайды", "🚀 Редактор", "💳 Баланс", "⚙️ Настройки", "ℹ️ О боте"]

    # /lang — til baribir o'zgartiriladi
    http.calls.clear()
    asyncio.run(tb.handle_update(_cb("lang:en")))
    assert any("Write a topic" in t for t in _texts(http))


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


def test_microphone_allowed_for_own_site(client):
    # avval microphone=() — brauzer ovozli yozishga ruxsat ham so'ramay rad etardi
    pp = client.get("/healthz").headers.get("permissions-policy", "")
    assert "microphone=(self)" in pp and "camera=()" in pp


def test_off_topic_refusal_is_multilingual_without_professional():
    p = main._read_default_system_prompt()
    assert "I can only help with creating and editing presentations and slides." in p
    assert "Men faqat taqdimot va slaydlar yaratish hamda tahrirlash bo'yicha yordam bera olaman." in p
    assert "professional taqdimot" not in p and "refuse with exactly:\n" not in p


def test_browser_translation_blocked_and_icons_protected(client):
    # Earlier (v66) the page was open to the browser translator. It garbled slide texts and button names, so the
    # page, the canvas and the presentation now say translate="no"; the site's own uz/ru/en switcher translates the UI.
    html = client.get("/").text
    assert 'translate="no"' in html.split("<head>")[0]
    assert '<meta name="google" content="notranslate">' in html
    js = open(os.path.join(ROOT, "js", "i18n.js"), encoding="utf-8").read()
    assert "protectIcons" in js and "setAttribute('translate', 'no')" in js


def test_welcome_is_not_an_ai_answer():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    assert 'class="ai-msg bot ss-welcome"' in html
    st = open(os.path.join(ROOT, "js", "01_state.js"), encoding="utf-8").read()
    assert "addWelcomeMessage(chatBody);" in st and "appendAiChatMessage('bot', 'Salom! Yangi suhbat" not in st
    ex = open(os.path.join(ROOT, "js", "10_export_present.js"), encoding="utf-8").read()
    assert "msgDiv.classList.contains('ss-welcome')" in ex
