"""v69 QA review: wrong-type input must give a clear 4xx, never a 500; errors must not leak exception text."""
import main


def test_create_checkout_non_text_token_is_401_not_500(sb, client):
    for body in ({"token": 123, "amount": 5}, {"token": ["a"], "amount": 5}, {"token": {"x": 1}}):
        r = client.post("/api/create-checkout", json=body)
        assert r.status_code == 401, (body, r.status_code)


def test_create_checkout_list_body_is_rejected_cleanly(sb, client):
    assert client.post("/api/create-checkout", json=[1, 2]).status_code in (400, 401, 422)


def test_media_search_error_does_not_leak_exception_text(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret-internal-detail /srv/key=abc")
    monkeypatch.setattr(main, "media_search_impl", boom)
    r = client.get("/api/media-search?q=cats")
    assert r.status_code == 200
    assert "secret-internal-detail" not in r.text
    assert r.json()["results"] == []


# ---------------------------------------------------------------------------------------------
# Telegram linking must work on the FIRST try (user report: «sometimes I had to link twice»)
# ---------------------------------------------------------------------------------------------
import asyncio
from datetime import datetime, timedelta, timezone

from backend import telegram_bot as tg
from test_stability_fixes import _usage_row

_real_sleep = asyncio.sleep


async def _no_sleep(*_a, **_k):
    await _real_sleep(0)


def _code(sb, minutes=20):
    sb.tables["user_usage"] = [_usage_row("site-u", "a@x.com", paid=0)]
    exp = (datetime.now(timezone.utc) + timedelta(minutes=minutes)).isoformat()
    sb.tables["tg_link_codes"] = [{"code": "ABCD2345", "user_id": "site-u", "email": "a@x.com", "expires_at": exp}]


def test_link_lives_30_minutes():
    assert tg.LINK_TTL >= 1800


def test_failed_link_gives_the_code_back(sb, monkeypatch):
    """The DB failed while linking: the SAME code must still work (before it was already deleted)."""
    _code(sb)
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append(text)

    async def bad_apply(*a, **k):
        return {"error": "db"}
    monkeypatch.setattr(tg, "_send", fake_send)
    monkeypatch.setattr(tg, "_link_apply", bad_apply)
    monkeypatch.setattr(tg.asyncio, "sleep", _no_sleep)
    asyncio.run(tg._do_link(111, {"id": 111}, "ABCD2345"))
    assert [r["code"] for r in sb.tables["tg_link_codes"]] == ["ABCD2345"]
    assert "kod hali ishlaydi" in sent[-1]
    # second try with the same code now works
    res = tg._link_consume_sync({"id": 111}, "ABCD2345")
    assert res.get("ok") and res["user_id"] == "site-u"


def test_new_bot_user_is_linked_before_the_language_question(sb, monkeypatch):
    """/start link_CODE from a user who never picked a language: link at once (the code is not kept only in RAM)."""
    done = []

    async def no_lang(tid):
        return ""

    async def fake_link(cid, user, code):
        done.append(code)

    async def fake_send(*a, **k):
        return None
    monkeypatch.setattr(tg, "_saved_lang", no_lang)
    monkeypatch.setattr(tg, "_do_link", fake_link)
    monkeypatch.setattr(tg, "_send", fake_send)
    cid = 555000111
    tg._chats.pop(cid, None)
    asyncio.run(tg.handle_update({"update_id": 99011, "message": {"chat": {"id": cid, "type": "private"},
                                  "from": {"id": cid, "first_name": "A"}, "text": "/start link_ABCD2345"}}))
    assert done == ["ABCD2345"]
    assert not tg._state(cid).get("start_arg")


def test_link_complete_retry_after_lost_answer_is_ok(client, monkeypatch):
    """The site retries after a network error: the token is already used, but linked to THIS account -> ok, not 409."""
    monkeypatch.setattr(tg, "ENABLED", True)
    tok = tg._make_token("L", 4242, 0, 600)
    tg._used_links[tok] = 0.0

    async def me(request):
        return ("site-u", "a@x.com")
    monkeypatch.setattr(tg, "_web_user", me)
    monkeypatch.setattr(tg, "_linked_sync", lambda tid: ("site-u", "a@x.com") if tid == 4242 else None)
    r = client.post("/api/telegram/link-complete", json={"token": "t", "link": tok})
    assert r.status_code == 200 and r.json()["ok"] is True
    # someone else's account -> still refused
    monkeypatch.setattr(tg, "_linked_sync", lambda tid: ("other-u", "b@x.com"))
    assert client.post("/api/telegram/link-complete", json={"token": "t", "link": tok}).status_code == 409
    tg._used_links.pop(tok, None)


# ---------------------------------------------------------------------------------------------
# Big audience: the bot queue must not refuse people at 30 waiting; heavy export has its own small limit
# ---------------------------------------------------------------------------------------------
def test_bot_capacity_defaults():
    assert tg._GEN_PARALLEL >= 20
    assert tg.GEN_QUEUE_MAX >= 300
    assert tg.MAX_CHATS >= 2000
    assert tg._EXPORT_PARALLEL <= 8          # RAM-heavy work stays small


def test_300_waiting_users_are_queued_not_refused(monkeypatch):
    """300 people ask at once: nobody gets «busy»; only _GEN_PARALLEL run at the same time."""
    async def run():
        running = peak = 0
        refused = 0

        async def one():
            nonlocal running, peak, refused
            if tg._overloaded():
                refused += 1
                return
            async with tg._AiSlot():
                running += 1
                peak = max(peak, running)
                await asyncio.sleep(0.01)
                running -= 1
        await asyncio.gather(*[one() for _ in range(300)])
        return peak, refused
    monkeypatch.setattr(tg, "_gen_sem", None)
    async def wrap():
        tg._gen_sem = asyncio.Semaphore(tg._GEN_PARALLEL)
        return await run()
    peak, refused = asyncio.run(wrap())
    assert refused == 0
    assert peak <= tg._GEN_PARALLEL


def test_checkout_retries_once_on_dodo_5xx(monkeypatch):
    monkeypatch.setenv("DODO_PAYMENTS_API_KEY", "k")
    monkeypatch.setenv("DODO_PRODUCT_ID", "p")
    calls = []

    async def fake(method, path, key, base, body=None):
        calls.append(path)
        if len(calls) == 1:
            return {"status": 502, "error_body": "bad gateway"}
        return {"status": 200, "json": {"checkout_url": "https://pay.example/x", "session_id": "s"}}
    monkeypatch.setattr(main, "_dodo_request", fake)
    monkeypatch.setattr(main.asyncio, "sleep", _no_sleep)
    code, data = asyncio.run(main._build_checkout("u1", "a@x.com", "", "pack"))
    assert code == 200 and data["checkout_url"].startswith("https://") and len(calls) == 2
