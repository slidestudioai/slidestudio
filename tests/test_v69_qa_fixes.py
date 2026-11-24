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


# ---------------------------------------------------------------------------------------------
# Live site under an ad campaign: the server must not run out of RAM, nothing may grow without a limit
# ---------------------------------------------------------------------------------------------
def test_worker_count_follows_ram_and_cpu():
    from backend.gunicorn_conf import pick_workers
    assert pick_workers(512, 0.1) == 2           # Render 512 MB: 2 workers (before: always 4 -> out of memory)
    assert pick_workers(256, 1) == 1
    assert pick_workers(2048, 1) == 2            # 1 CPU: no point in more
    assert pick_workers(4096, 2) == 4
    assert pick_workers(65536, 32) == 8          # upper cap


def test_web_concurrency_overrides(monkeypatch):
    import importlib
    from backend import gunicorn_conf
    monkeypatch.setenv("WEB_CONCURRENCY", "3")
    assert importlib.reload(gunicorn_conf).workers == 3
    monkeypatch.delenv("WEB_CONCURRENCY")
    importlib.reload(gunicorn_conf)


def test_sessions_in_ram_have_a_hard_cap(monkeypatch):
    monkeypatch.setattr(main, "MAX_SESSIONS_RAM", 1000)
    main.active_sessions.clear()
    for i in range(5000):
        main.register_session(f"u{i}", f"u{i}@x.com", "deepseek-chat")
    assert len(main.active_sessions) <= 1000
    assert "u4999" in main.active_sessions       # the newest is kept
    main.active_sessions.clear()


def test_bot_user_locks_never_drop_a_held_lock(monkeypatch):
    monkeypatch.setitem(tg._deps, "user_lock", None)
    tg._ulocks.clear()

    async def run():
        held = tg._ulock("busy-user")
        await held.acquire()
        for i in range(3500):                    # many other users -> eviction runs
            tg._ulock(f"u{i}")
        same = tg._ulock("busy-user")
        held.release()
        return same is held
    assert asyncio.run(run()) is True            # before: .clear() gave a NEW lock -> two writers at once
    assert len(tg._ulocks) <= 3001
    tg._ulocks.clear()


def test_invite_code_counts_at_once_for_telegram_account(sb, monkeypatch):
    """v78: a Telegram account is a full account — /start ref_CODE is counted at once (no Google link to wait for)."""
    claimed = []

    async def fake_send(*a, **k):
        return None

    async def ensure_uid(user):
        return ("tg-acc", "tg777@t.me")

    async def fake_claim(cid, user, code, quiet=False):
        claimed.append(code)
    monkeypatch.setattr(tg, "_send", fake_send)
    monkeypatch.setattr(tg, "_ensure_uid", ensure_uid)
    monkeypatch.setattr(tg, "_claim_ref", fake_claim)
    asyncio.run(tg._handle_ref_start(777, {"id": 777}, "ABCD2345"))
    assert claimed == ["ABCD2345"]
    assert not sb.tables.get("tg_pending_refs")  # nothing has to wait


def test_link_token_single_use_across_workers(sb, client, monkeypatch):
    """Another worker does not know this worker's RAM: the «used» mark is in the DB."""
    monkeypatch.setattr(tg, "ENABLED", True)
    tok = tg._make_token("L", 4343, 0, 600)

    async def me(request):
        return ("attacker-u", "evil@x.com")
    monkeypatch.setattr(tg, "_web_user", me)
    monkeypatch.setattr(tg, "_linked_sync", lambda tid: ("victim-u", "v@x.com"))
    assert tg._mark_link_used_sync(tok, "victim-u", "v@x.com") is True      # used by the owner on worker A
    tg._used_links.pop(tok, None)                                           # worker B: empty RAM
    r = client.post("/api/telegram/link-complete", json={"token": "t", "link": tok})
    assert r.status_code == 409


def test_like_on_deleted_post_is_404(sb, client, monkeypatch):
    import uuid as _uuid
    from types import SimpleNamespace

    class FK(Exception):
        pass
    monkeypatch.setattr(sb, "auth", SimpleNamespace(get_user=lambda t: SimpleNamespace(user=SimpleNamespace(id="u1", email="a@x.com"))), raising=False)
    real_table = sb.table

    def table(name):
        t = real_table(name)
        if name == "feedback_likes":
            orig = t.insert
            def ins(row):
                raise FK('insert or update on table "feedback_likes" violates foreign key constraint (23503)')
            t.insert = ins
        return t
    monkeypatch.setattr(sb, "table", table)
    r = client.post("/api/feedback/like", json={"token": "tok", "id": str(_uuid.uuid4())})
    assert r.status_code == 404


def test_proxy_image_error_is_not_200(client):
    r = client.get("/api/proxy-image?url=http://127.0.0.1/x.png")
    assert r.status_code == 400 and "error" in r.json()


def test_forbidden_proxy_url_does_not_wait_in_the_download_queue(client, monkeypatch):
    """All 6 download slots are busy (slow real downloads): a forbidden address must still be refused at once."""
    import time as _t
    sem = asyncio.Semaphore(0)                       # nothing free
    monkeypatch.setattr(main, "_PROXY_IMG_SEM", sem)
    monkeypatch.setattr(main, "PROXY_QUEUE_TIMEOUT", 5.0)
    t0 = _t.time()
    r = client.get("/api/proxy-image?url=http://10.0.0.5/secret.png")
    assert r.status_code == 400 and _t.time() - t0 < 2


def test_no_pause_between_requests_to_a_host_without_429():
    import time as _t
    main._HOST_429.pop("cdn.example.org", None)
    t0 = _t.time()
    for _ in range(10):
        main._host_slot("cdn.example.org").release()
    assert _t.time() - t0 < 0.5                       # before: 10 x 0.2 s = 2 s for every host
    main._HOST_429["cdn.example.org"] = _t.time()     # the host said 429 -> requests are spaced out again
    t0 = _t.time()
    for _ in range(3):
        main._host_slot("cdn.example.org").release()
    assert _t.time() - t0 >= 0.35
    main._HOST_429.pop("cdn.example.org", None)
