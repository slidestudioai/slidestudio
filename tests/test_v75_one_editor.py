"""v75: «Toza bot» — bitta kirish nuqtasi (Muharrir), Mini App telefonda fullscreen emas, fayl chatga keladi."""
import asyncio
import hashlib
import hmac
import json
import os
import time
from urllib.parse import urlencode

import main  # noqa: F401
from backend import telegram_bot as tb
from tests.test_v66_i18n import _bot, _cb, _msg, _texts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _init_data(uid=5551, token="123:TEST"):
    pairs = {"auth_date": str(int(time.time())), "user": json.dumps({"id": uid, "first_name": "Ali"})}
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    return urlencode(pairs)


# ------------------------------------------------------------------ bot: toza oqim
def test_big_reply_keyboard_is_gone():
    assert tb.kb_reply() == {"remove_keyboard": True}


def test_home_keyboard_one_primary_button(monkeypatch):
    monkeypatch.setattr(tb, "SITE_URL", "https://slidestudio.example")
    rows = tb.kb_home()["inline_keyboard"]
    assert len(rows[0]) == 1 and rows[0][0]["text"] == "✨ Muharrirni ochish" and "web_app" in rows[0][0]
    assert [b["callback_data"] for b in rows[1]] == ["bal", "about"]


def test_start_greets_short_and_sets_menu_button(sb, monkeypatch):
    monkeypatch.setattr(tb, "SITE_URL", "https://slidestudio.example")
    http = _bot(monkeypatch)
    tb._chats.pop(5551, None)                     # boshqa testlardan qolgan chat holati
    asyncio.run(tb.handle_update(_msg("/start")))
    http.calls.clear()
    asyncio.run(tb.handle_update(_cb("lang:en")))
    greet = [p for m, p in http.calls if m == "sendMessage" and "inline_keyboard" in (p.get("reply_markup") or {})][-1]
    assert "Open the editor" in greet["text"] and len(greet["text"]) < 200
    assert greet["reply_markup"]["inline_keyboard"][0][0]["text"] == "✨ Open the editor"
    menu = [p for m, p in http.calls if m == "setChatMenuButton"]
    assert menu and menu[-1]["menu_button"]["text"] == "✨ Editor" and "lang=en" in menu[-1]["menu_button"]["web_app"]["url"]
    # eski katta klaviatura yopiladi (yordamchi xabar o'chiriladi)
    assert any(m == "sendMessage" and p.get("reply_markup") == {"remove_keyboard": True} for m, p in http.calls)
    assert any(m == "deleteMessage" for m, p in http.calls)


def test_old_keyboard_buttons_still_work(sb, monkeypatch):
    http = _bot(monkeypatch)
    tb._lang_remember(5551, "uz")
    asyncio.run(tb.handle_update(_msg("ℹ️ Yordam")))
    assert any("Muharrirni ochish" in t for t in _texts(http))


# ------------------------------------------------------------------ Mini App → chatga fayl
def _send_setup(monkeypatch):
    monkeypatch.setattr(tb, "ENABLED", True)
    monkeypatch.setattr(tb, "BOT_TOKEN", "123:TEST")
    tb._send_hits.clear()
    tb._lang_cache[5551] = "uz"
    sent = []

    async def fake_doc(chat_id, filename, data, mime, caption=""):
        sent.append((chat_id, filename, data.read(), mime, caption))
        return True
    monkeypatch.setattr(tb, "tg_send_document", fake_doc)
    return sent


def test_send_file_goes_to_the_same_user(client, monkeypatch):
    sent = _send_setup(monkeypatch)
    body = b"PK\x03\x04" + b"x" * 100
    r = client.post("/api/telegram/send-file?name=Mavzu.pptx", content=body,
                    headers={"X-Tg-Init-Data": _init_data(), "Content-Type": "application/octet-stream"})
    assert r.status_code == 200 and r.json()["ok"]
    assert sent[0][0] == 5551 and sent[0][1] == "Mavzu.pptx" and sent[0][2] == body
    assert "Muharrirdan" in sent[0][4]


def test_send_file_rejects_bad_auth_type_and_fake_content(client, monkeypatch):
    sent = _send_setup(monkeypatch)
    h = {"X-Tg-Init-Data": _init_data()}
    assert client.post("/api/telegram/send-file?name=a.pptx", content=b"PK\x03\x04", headers={"X-Tg-Init-Data": "bad"}).status_code == 401
    assert client.post("/api/telegram/send-file?name=a.exe", content=b"MZ", headers=h).status_code == 415
    assert client.post("/api/telegram/send-file?name=a.pdf", content=b"<html>", headers=h).status_code == 415
    assert client.post("/api/telegram/send-file?name=a.pdf", content=b"", headers=h).status_code == 400
    assert not sent


def test_send_file_rate_limited(client, monkeypatch):
    _send_setup(monkeypatch)
    h = {"X-Tg-Init-Data": _init_data()}
    codes = [client.post("/api/telegram/send-file?name=a.pdf", content=b"%PDF-1.4", headers=h).status_code for _ in range(8)]
    assert codes[:6] == [200] * 6 and codes[-1] == 429


# ------------------------------------------------------------------ Mini App JS
def _read(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return f.read()


def test_phone_does_not_request_fullscreen():
    js = _read("js/33_v43_telegram.js")
    assert "isPhone" in js and "!isPhone && typeof tg.requestFullscreen" in js and "exitFullscreen" in js


def test_tg_send_module_loaded_and_exports_use_it():
    html = _read("index.html")
    assert "js/58_tg_send.js" in html
    assert "/api/telegram/send-file" in _read("js/58_tg_send.js")
    assert "(window.downloadBlob || downloadBlob)(outBlob" in _read("js/14_pptx_io.js")
    assert "doc.save(" not in _read("js/10_export_present.js")
