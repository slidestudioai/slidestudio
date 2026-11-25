"""v82.4: a tap over the bot's rate limit gets a visible «too fast» answer instead of silence."""
import asyncio

import pytest

from backend import telegram_bot as tb
from backend import bot_i18n as i18n

pytestmark = pytest.mark.timeout(30)


def test_too_many_taps_get_a_visible_answer(monkeypatch):
    calls = []

    async def fake_tg(method, **kw):
        calls.append((method, kw))
        return {}
    monkeypatch.setattr(tb, "tg", fake_tg)
    monkeypatch.setattr(tb, "_cur_lang", lambda cid=None: "ru")
    cid = 987654321
    tb._rl.pop(cid, None)
    for _ in range(14):
        tb._limited(cid, 14)                                   # the limit is already used up
    cb = {"id": "q1", "data": "home", "from": {"id": cid}, "message": {"chat": {"id": cid}, "message_id": 5}}
    asyncio.run(tb._handle_callback(cb))
    assert calls == [("answerCallbackQuery", {"callback_query_id": "q1",
                                              "text": "⏳ Слишком быстро — нажмите ещё раз через 2–3 секунды."})]
    tb._rl.pop(cid, None)


def test_text_is_translated_for_all_languages():
    for lang in ("ru", "en"):
        assert i18n.translate(tb.TAP_TOO_FAST, lang) != tb.TAP_TOO_FAST
