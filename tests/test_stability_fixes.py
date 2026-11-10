"""v53 stabillik tuzatishlari testlari: rate limit IP, proksi navbati, Telegram ulash, WebSocket, Lemon webhook."""
import asyncio
import hashlib
import hmac
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from starlette.websockets import WebSocketDisconnect

import main
from backend import telegram_bot as tg

pytestmark = pytest.mark.timeout(60)


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _usage_row(uid, email, paid=0, free=200):
    return {"user_id": uid, "email": email, "free_credits": free, "paid_credits": paid,
            "slide_credits": free + paid, "last_reset_time": _now_iso(), "blocked": False}


@pytest.fixture(autouse=True)
def _fresh_locks():
    main._user_locks.clear()
    yield
    main._user_locks.clear()


# ---------------------------------------------------------------------------------------------
# 1) Rate limit: soxta X-Forwarded-For bilan chetlab o'tib bo'lmaydi
# ---------------------------------------------------------------------------------------------
class _Req:
    def __init__(self, headers, host="10.0.0.1"):
        self.headers = {k.lower(): v for k, v in headers.items()}
        self.client = type("C", (), {"host": host})()


def test_client_ip_uses_proxy_added_value():
    assert main._client_ip(_Req({"X-Forwarded-For": "6.6.6.6, 9.9.9.9"})) == "9.9.9.9"
    assert main._client_ip(_Req({"X-Forwarded-For": "9.9.9.9"})) == "9.9.9.9"
    assert main._client_ip(_Req({})) == "10.0.0.1"


def test_cf_header_ignored_by_default(monkeypatch):
    r = _Req({"CF-Connecting-IP": "6.6.6.6", "X-Forwarded-For": "9.9.9.9"})
    assert main._client_ip(r) == "9.9.9.9"
    monkeypatch.setattr(main, "TRUST_CF_CONNECTING_IP", True)
    assert main._client_ip(r) == "6.6.6.6"


def test_fake_xff_does_not_bypass_rate_limit(sb, client):
    # Render: real IP (9.9.9.9) is appended by the proxy, the client controls only the left part
    codes = [client.get("/api/user/usage", headers={"X-Forwarded-For": f"1.2.3.{i}, 9.9.9.9"}).status_code
             for i in range(70)]
    assert codes.count(429) >= 10


# ---------------------------------------------------------------------------------------------
# 2) Proksi: parallel yuklashlar soni cheklangan
# ---------------------------------------------------------------------------------------------
def _slow_fetch(counter, delay=0.3):
    def fn(url):
        with counter["lock"]:
            counter["now"] += 1
            counter["max"] = max(counter["max"], counter["now"])
        time.sleep(delay)
        with counter["lock"]:
            counter["now"] -= 1
        return {"data": b"\x00\x00\x00\x18ftypmp42" + b"0" * 100, "content_type": "video/mp4"}
    return fn


async def _parallel_get(urls):
    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        return await asyncio.gather(*[c.get(u, headers={"X-Forwarded-For": f"5.5.5.{i}"}) for i, u in enumerate(urls)])


def test_proxy_video_concurrency_limited(monkeypatch):
    counter = {"now": 0, "max": 0, "lock": threading.Lock()}
    monkeypatch.setattr(main, "_fetch_video_sync", _slow_fetch(counter))
    monkeypatch.setattr(main, "_PROXY_VID_SEM", asyncio.Semaphore(1))
    rs = asyncio.run(_parallel_get([f"/api/proxy-video?url=https://e.com/{i}.mp4" for i in range(3)]))
    assert [r.status_code for r in rs] == [200, 200, 200]
    assert counter["max"] == 1


def test_proxy_queue_timeout_returns_503(monkeypatch):
    counter = {"now": 0, "max": 0, "lock": threading.Lock()}
    monkeypatch.setattr(main, "_fetch_video_sync", _slow_fetch(counter, delay=1.0))
    monkeypatch.setattr(main, "_PROXY_VID_SEM", asyncio.Semaphore(1))
    monkeypatch.setattr(main, "PROXY_QUEUE_TIMEOUT", 0.2)
    rs = asyncio.run(_parallel_get([f"/api/proxy-video?url=https://e.com/{i}.mp4" for i in range(2)]))
    assert sorted(r.status_code for r in rs) == [200, 503]


def test_proxy_image_cache_hit_skips_queue(monkeypatch):
    url = "https://example.com/cached.png"
    main._cache_put(url, {"data": b"\x89PNG\r\n\x1a\n" + b"0" * 50, "content_type": "image/png"})
    sem = asyncio.Semaphore(1)
    monkeypatch.setattr(main, "_PROXY_IMG_SEM", sem)
    monkeypatch.setattr(main, "PROXY_QUEUE_TIMEOUT", 0.2)

    async def run():
        await sem.acquire()           # navbat to'liq band
        try:
            return await _parallel_get([f"/api/proxy-image?url={url}"])
        finally:
            sem.release()
    r = asyncio.run(run())[0]
    assert r.status_code == 200 and r.json()["data_url"].startswith("data:image/png;base64,")


# ---------------------------------------------------------------------------------------------
# 3) Telegram ulash: kod bir martalik, pullik varaqlar bir marta va atomik ko'chadi
# ---------------------------------------------------------------------------------------------
def _link_setup(sb, src_paid=400, dst_paid=100):
    sb.tables["user_usage"] = [_usage_row("tg-acc", "tg111@t.me", paid=src_paid),
                               _usage_row("site-u", "a@x.com", paid=dst_paid)]
    exp = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    sb.tables["tg_link_codes"] = [{"code": "ABCD2345", "user_id": "site-u", "email": "a@x.com", "expires_at": exp}]


def test_link_code_is_single_use(sb):
    _link_setup(sb)
    r1 = tg._link_consume_sync({"id": 111}, "abcd2345")
    r2 = tg._link_consume_sync({"id": 111}, "abcd2345")
    assert r1.get("ok") and r1["user_id"] == "site-u"
    assert r2 == {"error": "bad_code"}


def test_link_code_expired(sb):
    _link_setup(sb)
    sb.tables["tg_link_codes"][0]["expires_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    assert tg._link_consume_sync({"id": 111}, "ABCD2345") == {"error": "bad_code"}


@pytest.mark.parametrize("use_rpc", [True, False])
def test_link_moves_paid_credits_once(sb, use_rpc):
    _link_setup(sb)
    if not use_rpc:
        sb.missing_rpc.add("transfer_paid_credits")      # eski baza: zaxira yo'l + lock

    async def run():
        return await asyncio.gather(tg._link_apply(111, "site-u", "a@x.com"),
                                    tg._link_apply(111, "site-u", "a@x.com"))
    r1, r2 = asyncio.run(run())
    assert r1["ok"] and r2["ok"]
    assert sb.usage("site-u")["paid_credits"] == 500     # 100 + 400, ikki marta EMAS
    assert sb.usage("tg-acc")["paid_credits"] == 0
    assert sorted([r1["moved_pages"], r2["moved_pages"]]) == [0, 20]
    assert [r["tg_id"] for r in sb.tables["tg_links"]] == [111]


def test_link_fallback_rolls_back_when_source_save_fails(sb, monkeypatch):
    _link_setup(sb)
    sb.missing_rpc.add("transfer_paid_credits")
    real_save = tg._deps["save_usage"]

    def save(uid, u, tokens=0):
        if uid == "tg-acc":
            return False                                # manba yozilmadi
        return real_save(uid, u, tokens)
    monkeypatch.setitem(tg._deps, "save_usage", save)
    res = asyncio.run(tg._link_apply(111, "site-u", "a@x.com"))
    assert res["ok"] and res["moved_pages"] == 0
    assert sb.usage("site-u")["paid_credits"] == 100      # qaytarildi — varaq ikki akkauntda qolmadi
    assert sb.usage("tg-acc")["paid_credits"] == 400


# ---------------------------------------------------------------------------------------------
# 5) WebSocket: bitta xato butun ulanishni yopmaydi
# ---------------------------------------------------------------------------------------------
def test_ws_bad_json_keeps_connection(sb, client):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text("not json")
        assert ws.receive_json()["code"] == "bad_request"
        ws.send_text("[1, 2]")
        assert ws.receive_json()["code"] == "bad_request"
        ws.send_text(json.dumps({"prompt": "salom"}))
        assert ws.receive_json()["code"] == "auth_required"        # ulanish hali ishlayapti


def test_ws_internal_error_keeps_connection(sb, client, monkeypatch):
    monkeypatch.setenv("SLIDE_STUDIO_DEV_MODE", "1")
    monkeypatch.setenv("SLIDE_STUDIO_DEV_TOKEN", "devtok")
    real = main.get_or_create_user_usage
    calls = {"n": 0}

    def flaky(uid, email):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")
        return real(uid, email)
    monkeypatch.setattr(main, "get_or_create_user_usage", flaky)
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "salom", "token": "devtok"}))
        assert "Ichki xatolik" in ws.receive_json()["message"]
        ws.send_text(json.dumps({"prompt": "salom", "token": "devtok"}))
        assert "AI xizmati" in ws.receive_json()["message"]          # 2-xabar odatdagidek ishladi


def test_ws_closes_after_many_errors(sb, client, monkeypatch):
    monkeypatch.setenv("SLIDE_STUDIO_DEV_MODE", "1")
    monkeypatch.setenv("SLIDE_STUDIO_DEV_TOKEN", "devtok")
    monkeypatch.setattr(main, "get_or_create_user_usage", lambda *a: (_ for _ in ()).throw(RuntimeError("x")))
    with client.websocket_connect("/ws/chat") as ws:
        for _ in range(5):
            ws.send_text(json.dumps({"prompt": "salom", "token": "devtok"}))
            assert ws.receive_json()["type"] == "error"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


# ---------------------------------------------------------------------------------------------
# 7) Lemon webhook
# ---------------------------------------------------------------------------------------------
SECRET = "whsec-test"


def _hook(client, event, order_id="1001", user_id="u1", email="a@x.com", **attrs):
    body = {"meta": {"event_name": event, "custom_data": {"user_id": user_id, "product": "pack"} if user_id else {}},
            "data": {"id": order_id, "attributes": {"status": "paid", "total": 158, "user_email": email,
                                                     "first_order_item": {"variant_id": 1, "quantity": 1}, **attrs}}}
    raw = json.dumps(body).encode()
    sig = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return client.post("/api/payment/lemon-webhook", content=raw,
                       headers={"X-Signature": sig, "X-Event-Name": event, "Content-Type": "application/json"})


@pytest.fixture()
def lemon(monkeypatch):
    monkeypatch.setenv("LEMON_SQUEEZY_WEBHOOK_SECRET", SECRET)
    monkeypatch.delenv("LEMON_SQUEEZY_VARIANT_ID", raising=False)


def test_webhook_purchase_and_duplicate(sb, client, lemon):
    assert _hook(client, "order_created").status_code == 200
    assert _hook(client, "order_created").json().get("duplicate") is True
    assert sb.usage("u1")["paid_credits"] == main.pack_pages() * main.UNIT


def test_webhook_unknown_user_is_not_lost(sb, client, lemon):
    r = _hook(client, "order_created", order_id="2002", user_id="", email="nobody@x.com")
    assert r.status_code == 500                                   # Lemon qayta yuboradi
    audit = sb.tables.get("admin_audit", [])
    assert audit and audit[0]["action"] == "payment_unmatched" and audit[0]["target"] == "2002"


def test_webhook_unknown_user_found_on_retry(sb, client, lemon):
    assert _hook(client, "order_created", order_id="3003", user_id="", email="late@x.com").status_code == 500
    sb.tables["user_usage"] = [_usage_row("late-u", "late@x.com")]
    assert _hook(client, "order_created", order_id="3003", user_id="", email="late@x.com").status_code == 200
    assert sb.usage("late-u")["paid_credits"] == main.pack_pages() * main.UNIT


def test_webhook_missing_order_id_rejected(sb, client, lemon):
    assert _hook(client, "order_created", order_id="").status_code == 400


def test_webhook_partial_refunds(sb, client, lemon):
    full = main.pack_pages() * main.UNIT
    _hook(client, "order_created", order_id="4004")
    assert _hook(client, "order_refunded", order_id="4004", refunded_amount=79).status_code == 200
    assert sb.usage("u1")["paid_credits"] == full // 2               # yarmi qaytarildi -> yarmi olindi
    assert _hook(client, "order_refunded", order_id="4004", refunded_amount=158).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 0                        # qolgan yarmi
    assert _hook(client, "order_refunded", order_id="4004", refunded_amount=158).json().get("duplicate") is True
    assert sb.usage("u1")["paid_credits"] == 0


def test_webhook_full_refund_without_amount(sb, client, lemon):
    _hook(client, "order_created", order_id="5005")
    _hook(client, "order_refunded", order_id="5005")
    assert sb.usage("u1")["paid_credits"] == 0
