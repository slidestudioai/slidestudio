"""v80: yuklama — eksport server kuchiga moslashadi, navbat o'rni ko'rinadi, Telegram limiti (429) da xabar yo'qolmaydi."""
import asyncio
import time

import pytest

from backend import gunicorn_conf as g
from backend import telegram_bot as tb
from backend import tg_decks as decks
from backend.services import export_pool as xp
from test_v78_shared_pipeline import _rich_deck


# ------------------------------------------------------------------ eksport rejasi
@pytest.mark.parametrize("mem,cpu,want_procs", [
    (512, 0.5, 0), (512, 1, 0), (2048, 1, 0),        # kuchsiz: jarayon ochilmaydi (RAM tejaladi)
    (2048, 2, 2), (4096, 4, 4), (8192, 8, 6),        # kuchli: yadrolar soniga qarab (ko'pi bilan 6)
])
def test_export_plan_follows_server_size(monkeypatch, mem, cpu, want_procs):
    monkeypatch.delenv("TG_EXPORT_PROCS", raising=False)
    monkeypatch.delenv("TG_EXPORT_PARALLEL", raising=False)
    p = xp.plan(mem, cpu, g.pick_workers(mem, cpu))
    assert p["procs"] == want_procs
    assert 1 <= p["parallel"] <= 32
    if mem <= 512:
        assert p["parallel"] == 1                     # 512 MB: bir vaqtda bitta eksport (avval 3 — RAM to'lishi mumkin edi)


def test_export_plan_env_override(monkeypatch):
    monkeypatch.setenv("TG_EXPORT_PROCS", "0")
    monkeypatch.setenv("TG_EXPORT_PARALLEL", "5")
    p = xp.plan(8192, 8, 8)
    assert p["procs"] == 0 and p["parallel"] == 5


# ------------------------------------------------------------------ jarayonlar havzasi
def test_process_pool_gives_same_file_and_fills_cache(monkeypatch):
    monkeypatch.setattr(xp, "_PLAN", {"procs": 2, "parallel": 4, "mem_mb": 4096, "cpus": 2})
    monkeypatch.setattr(xp, "_POOL_BROKEN", False)
    monkeypatch.setitem(xp._ENABLED, "on", True)
    deck = _rich_deck("tech")
    deck["title"] = "Pool test " + str(time.time())
    decks.cache_clear()
    try:
        name, data, mime = asyncio.run(xp.export(deck, {}, "pdf"))
        assert not xp._POOL_BROKEN                    # haqiqatan alohida jarayonda yasaldi
        assert name.endswith(".pdf") and data[:4] == b"%PDF"
        assert decks.cache_peek(deck, "uz", "pdf")[1] == data          # ota jarayon keshida
        # boshqa format keshdagi yozuvdan (sahnasiz) to'g'ri yasaladi
        assert decks.export_cached(deck, {}, "pptx", "uz")[1][:2] == b"PK"
    finally:
        xp.shutdown()


def test_pool_only_in_bot_worker(monkeypatch):
    """Bot ishlamaydigan gunicorn worker'larida jarayon ochilmaydi (RAM byudjeti bitta havza uchun)."""
    monkeypatch.setattr(xp, "_PLAN", {"procs": 4, "parallel": 8, "mem_mb": 8192, "cpus": 4})
    monkeypatch.setitem(xp._ENABLED, "on", False)
    assert xp._pool() is None


def test_broken_pool_falls_back_to_threads(monkeypatch):
    class Broken:
        def submit(self, *a, **k):
            raise RuntimeError("pool died")

        def shutdown(self, **k):
            pass
    monkeypatch.setattr(xp, "_POOL_BROKEN", False)
    monkeypatch.setattr(xp, "_pool", lambda: Broken())
    deck = _rich_deck("ocean")
    deck["title"] = "Fallback " + str(time.time())
    name, data, _ = asyncio.run(xp.export(deck, {}, "pptx"))
    assert data[:2] == b"PK" and xp._POOL_BROKEN
    monkeypatch.setattr(xp, "_POOL_BROKEN", False)


# ------------------------------------------------------------------ navbat o'rni
def test_queue_position_is_shown_when_slots_are_full(monkeypatch):
    seen = []

    async def scenario():
        sem = asyncio.Semaphore(1)
        monkeypatch.setattr(tb, "_gen_sem", sem)
        await sem.acquire()                                        # hamma slot band

        async def on_wait(pos):
            seen.append(pos)
        waiter = asyncio.create_task(tb._AiSlot(on_wait).__aenter__())
        await asyncio.sleep(0.05)
        assert seen == [1] and not waiter.done()
        sem.release()
        await waiter
    asyncio.run(scenario())


# ------------------------------------------------------------------ Telegram limiti
def test_rate_limiter_spreads_requests():
    async def run():
        rl = tb._RateLimiter(rate=50, burst=5)
        t = time.monotonic()
        for _ in range(15):
            await rl.take()
        return time.monotonic() - t
    assert asyncio.run(run()) >= 0.18                              # 5 darhol, 10 tasi 50/s tezlikda


def test_429_waits_full_retry_after_and_message_is_not_lost(monkeypatch):
    calls = []

    class R:
        def __init__(self, code, js):
            self.status_code, self._js = code, js

        def json(self):
            return self._js

    class Http:
        async def post(self, url, json=None, **k):
            calls.append(url.rsplit("/", 1)[-1])
            if len(calls) == 1:
                return R(429, {"ok": False, "parameters": {"retry_after": 7}})
            return R(200, {"ok": True, "result": {"message_id": 9}})
    slept = []
    monkeypatch.setattr(tb, "ENABLED", True)
    monkeypatch.setattr(tb, "_http", lambda: Http())
    rl = tb._RateLimiter(rate=1000, burst=1000)
    monkeypatch.setattr(tb, "_tg_rate", rl)
    real_sleep = asyncio.sleep

    async def fast_sleep(sec):
        slept.append(sec)
        await real_sleep(0)
    monkeypatch.setattr(tb.asyncio, "sleep", fast_sleep)
    res = asyncio.run(tb.tg("sendMessage", chat_id=1, text="x"))
    assert res == {"message_id": 9} and calls == ["sendMessage", "sendMessage"]
    assert max(slept) >= 6.5                                       # Telegram aytgan 7 s kutildi (avval ko'pi bilan 5)


def test_chat_action_is_dropped_when_busy(monkeypatch):
    monkeypatch.setattr(tb, "ENABLED", True)
    rl = tb._RateLimiter(rate=0.001, burst=1)
    rl.tokens = 0
    monkeypatch.setattr(tb, "_tg_rate", rl)
    monkeypatch.setattr(tb, "_http", lambda: (_ for _ in ()).throw(AssertionError("chaqirilmasligi kerak")))
    assert asyncio.run(tb.tg("sendChatAction", chat_id=1, action="typing")) is None
