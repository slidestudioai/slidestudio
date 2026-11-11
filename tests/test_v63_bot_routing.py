"""v63: botda tugma bosilmasa ham topshiriq bajariladi — slayd bo'lsa tahrirlash (AI ko'rib turadi), bo'lmasa yangi/suhbat."""
import asyncio

from backend import telegram_bot as tb


def _run(monkeypatch, st_extra, text):
    calls = []

    async def ok(*a, **k):
        return True

    monkeypatch.setattr(tb, "_google_ok", ok)
    monkeypatch.setattr(tb, "_run_edit", lambda cid, u, t: ("edit", t))
    monkeypatch.setattr(tb, "_run_new", lambda cid, u, t: ("new", t))
    monkeypatch.setattr(tb, "_run_chat", lambda cid, u, t: ("chat", t))
    monkeypatch.setattr(tb, "_spawn", lambda coro: calls.append(coro))
    cid = 987654321
    st = tb._state(cid)
    for k in ("deck", "ui", "busy"):
        st.pop(k, None)
    st.update(st_extra)
    asyncio.run(tb._handle_text(cid, {"id": cid}, text))
    return calls


def test_free_text_without_deck_goes_to_new(monkeypatch):
    assert _run(monkeypatch, {}, "Sun'iy intellekt haqida 5 ta slayd") == [("new", "Sun'iy intellekt haqida 5 ta slayd")]


def test_free_text_with_deck_goes_to_edit(monkeypatch):
    deck = {"title": "AI", "slides": [{"layout": "title", "title": "AI"}]}
    assert _run(monkeypatch, {"deck": deck}, "3-slaydni qisqartir") == [("edit", "3-slaydni qisqartir")]


def test_edit_prompt_knows_start_over():
    assert "boshidan qil" in tb.EDIT_SYSTEM and '"topic"' in tb.EDIT_SYSTEM
