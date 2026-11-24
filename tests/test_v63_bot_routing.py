"""v63/v76: botda matn yo'naltirish. v76 dan: «🆕 Yangi slayd» bosilmasa slayd YASALMAYDI (avval tugma so'raladi);
«Yangi slayd» rejimida — yangi/suhbat; «Tahrirlash» rejimida — AI slaydni ko'rib turadi."""
import asyncio

from backend import telegram_bot as tb


def _run(monkeypatch, st_extra, text):
    calls = []

    monkeypatch.setattr(tb, "_run_edit", lambda cid, u, t: ("edit", t))
    monkeypatch.setattr(tb, "_run_new", lambda cid, u, t: ("new", t))
    monkeypatch.setattr(tb, "_run_chat", lambda cid, u, t: ("chat", t))
    monkeypatch.setattr(tb, "_spawn", lambda coro: calls.append(coro))

    async def fake_send(cid, text, kb=None):
        calls.append(("ask", text))

    monkeypatch.setattr(tb, "_send", fake_send)
    cid = 987654321
    st = tb._state(cid)
    for k in ("deck", "ui", "busy"):
        st.pop(k, None)
    st.update(st_extra)
    asyncio.run(tb._handle_text(cid, {"id": cid}, text))
    return calls


def test_free_text_without_new_button_asks_first(monkeypatch):
    # v76: «Yangi slayd» bosilmagan — slayd yasalmaydi, avval tugma so'raladi
    calls = _run(monkeypatch, {}, "Sun'iy intellekt haqida 5 ta slayd")
    assert len(calls) == 1 and calls[0][0] == "ask"


def test_new_mode_goes_to_new(monkeypatch):
    st = {"ui": "new", "ui_ts": tb.time.time()}
    assert _run(monkeypatch, st, "Sun'iy intellekt haqida 5 ta slayd") == [("new", "Sun'iy intellekt haqida 5 ta slayd")]


def test_main_menu_does_not_see_old_deck(monkeypatch):
    # bosh menyuda (Tahrirlash bosilmagan) eski slayd tahrirlanmaydi va yangi slayd ham tasodifan yasalmaydi
    deck = {"title": "AI", "slides": [{"layout": "title", "title": "AI"}]}
    calls = _run(monkeypatch, {"deck": deck}, "Kosmos haqida taqdimot")
    assert len(calls) == 1 and calls[0][0] == "ask"


def test_edit_mode_sees_deck(monkeypatch):
    deck = {"title": "AI", "slides": [{"layout": "title", "title": "AI"}]}
    assert _run(monkeypatch, {"deck": deck, "ui": "edit"}, "3-slaydni qisqartir") == [("edit", "3-slaydni qisqartir")]


def test_edit_prompt_handles_mixed_requests():
    assert "MIXED REQUESTS" in tb.EDIT_SYSTEM and "Muharrirda ochish" in tb.EDIT_SYSTEM


def test_edit_prompt_knows_start_over():
    assert "boshidan qil" in tb.EDIT_SYSTEM and '"topic"' in tb.EDIT_SYSTEM
