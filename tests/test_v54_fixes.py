"""v54 testlari: Pro (Chuqur) AI ham Tez AI kabi ishlaydi, Telegram botda balans ko'rinadi."""
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest

import main
from backend import telegram_bot as tg

pytestmark = pytest.mark.timeout(60)


# ---------------------------------------------------------------------------------------------
# 1) Pro AI: media turi so'rovdan aniqlanadi (avval faqat "photo" qidirilardi)
# ---------------------------------------------------------------------------------------------
@pytest.mark.parametrize("text,kind", [
    ("Sun'iy intellekt haqida 5 ta slayd", "photo"),
    ("3-slaydga mushuk GIF qo'sh", "gif"),
    ("animatsiyali fon qo'y", "gif"),
    ("orqa fonga video qo'y", "video"),
    ("add a short video clip", "video"),
    ("", "photo"),
])
def test_presearch_kind(text, kind):
    assert main._presearch_kind(text) == kind


def _fake_client(queries):
    class _Msg:
        content = json.dumps({"queries": queries})

    class _Completions:
        async def create(self, **kw):
            return NS(choices=[NS(message=_Msg())])
    return NS(chat=NS(completions=_Completions()))


def test_deep_presearch_uses_requested_kind(monkeypatch):
    seen = []

    def search(q, kind, n):
        seen.append(kind)
        return [{"url": f"https://media.example/{q}.gif"}]
    monkeypatch.setattr(main, "_search_images_sync", search)
    events = []

    class _WS:
        async def send_json(self, p):
            events.append(p)
    txt = asyncio.run(main._deep_presearch(_fake_client(["happy cat"]), "mushuk gif", 3, _WS(), {}, kind="gif"))
    assert seen == ["gif"]
    assert "gifUrl" in txt and "media.example" in txt
    assert {e["kind"] for e in events} == {"gif"}
    assert [e["type"] for e in events] == ["search_start", "search_done"]


# ---------------------------------------------------------------------------------------------
# 2) Pro AI: «o'ylash» paytida ham jonli holat (thinking) yuboriladi — sukut bo'lmaydi
# ---------------------------------------------------------------------------------------------
def _chunk(content=None, reasoning=None, finish=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=reasoning, tool_calls=None))],
              usage=None)


class _Stream:
    def __init__(self, chunks):
        self._it = iter(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


def test_ws_streams_thinking_for_deep_model(sb, client, monkeypatch):
    monkeypatch.setenv("SLIDE_STUDIO_DEV_MODE", "1")
    monkeypatch.setenv("SLIDE_STUDIO_DEV_TOKEN", "devtok")
    monkeypatch.setitem(main.config, "api_key", "test-key")
    monkeypatch.setattr(main, "_search_images_sync", None)
    chunks = [_chunk(reasoning="o'ylayapman " * 20), _chunk(reasoning="yana"), _chunk(content="Salom!"),
              _chunk(finish="stop")]

    class _Completions:
        async def create(self, **kw):
            assert kw["model"] == "deepseek-reasoner"
            return _Stream(chunks)
    monkeypatch.setattr(main, "_deepseek_client", lambda *a, **k: NS(chat=NS(completions=_Completions())))
    got = []
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "salom", "token": "devtok", "model": "deep"}))
        for _ in range(30):
            m = ws.receive_json()
            got.append(m)
            if m.get("type") in ("end", "error"):
                break
    types = [m.get("type") for m in got]
    assert "thinking" in types, types
    assert types.index("thinking") < types.index("chunk")
    th = next(m for m in got if m["type"] == "thinking")
    assert th["chars"] > 0 and "sec" in th
    assert "".join(m.get("text", "") for m in got if m["type"] == "chunk") == "Salom!"


# ---------------------------------------------------------------------------------------------
# 3) Telegram: oddiy savolga javob ostida balans ko'rinadi
# ---------------------------------------------------------------------------------------------
def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def test_balance_footer_linked_user():
    user = {"id": 555}
    usage = {"free_credits": 200, "paid_credits": 0, "last_reset_time": _now_iso()}
    foot = tg._balance_footer(usage, "fast", "real@gmail.com", user)
    assert "Qoldi" in foot and "varaq" in foot


def test_balance_footer_hidden_for_unlinked_user():
    user = {"id": 556}
    usage = {"free_credits": 200, "paid_credits": 0}
    assert tg._balance_footer(usage, "fast", tg._tg_email(556), user) == ""


def test_balance_footer_unlimited():
    user = {"id": 557}
    usage = {"free_credits": 0, "paid_credits": 0, "unlimited": True}
    assert "cheksiz" in tg._balance_footer(usage, "fast", "vip@gmail.com", user)


def test_welcome_sends_balance_later_when_db_slow(monkeypatch):
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append(text)
        return {"message_id": len(sent)}
    calls = {"n": 0}

    async def slow_then_ok(user):
        calls["n"] += 1
        if calls["n"] == 1:
            await asyncio.sleep(10)          # salomlashuvdagi 6 soniyalik chegaradan oshadi
        return {"linked": True, "free": 5, "paid": 0, "daily": 10, "wait": "", "suspended": False, "unlimited": False}
    monkeypatch.setattr(tg, "_send", fake_send)
    monkeypatch.setattr(tg, "_balance_info", slow_then_ok)
    spawned = []
    monkeypatch.setattr(tg, "_spawn", lambda coro: spawned.append(coro))

    real_wait_for = asyncio.wait_for

    async def fast_wait_for(aw, timeout):
        return await real_wait_for(aw, timeout=min(timeout, 0.05) if timeout == 6 else timeout)
    monkeypatch.setattr(tg.asyncio, "wait_for", fast_wait_for)

    async def run():
        await tg._send_welcome(1, {"id": 1, "first_name": "Ali"})
        assert len(spawned) == 1
        await spawned[0]
    asyncio.run(run())
    assert "Salom" in sent[0]
    assert any("Balans" in t and "5" in t for t in sent[1:]), sent
