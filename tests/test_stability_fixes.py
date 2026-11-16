"""v53 stabillik tuzatishlari testlari: rate limit IP, proksi navbati, Telegram ulash, WebSocket, Dodo webhook."""
import asyncio
import base64
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
# 7) Dodo Payments webhook (Standard Webhooks imzosi)
# ---------------------------------------------------------------------------------------------
SECRET = "whsec_" + base64.b64encode(b"test-dodo-secret-32-bytes-long!!").decode()


def _std_sign(raw, msg_id="msg_1", ts=None, secret=SECRET):
    ts = int(time.time()) if ts is None else ts
    key = base64.b64decode(secret[len("whsec_"):])
    sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.".encode() + raw, hashlib.sha256).digest()).decode()
    return {"webhook-id": msg_id, "webhook-timestamp": str(ts), "webhook-signature": f"v1,{sig}",
            "Content-Type": "application/json"}


def _signed_meta(user_id, package="pack", net_cents=None, credits=None):
    net_cents = main.pack_pages() if net_cents is None else net_cents
    credits = net_cents if credits is None else credits
    gross = main.topup_gross_cents(net_cents)
    return {"user_id": user_id, "product": "pack", "package": package, "net_cents": str(net_cents),
            "credits": str(credits), "gross_cents": str(gross),
            "sig": main._topup_sig(user_id, package, net_cents, credits, gross)}, gross


def _post(client, body, path="/webhooks", headers=None):
    raw = json.dumps(body).encode()
    return client.post(path, content=raw, headers=headers or _std_sign(raw))


def _paid(client, payment_id="pay_1", user_id="u1", email="a@x.com", meta=None, total=None, path="/webhooks", **extra):
    if meta is None:
        meta, gross = _signed_meta(user_id) if user_id else ({}, main.pack_pages())
    else:
        gross = total
    data = {"payload_type": "Payment", "payment_id": payment_id, "status": "succeeded",
            "total_amount": gross if total is None else total, "tax": 0, "currency": "USD",
            "metadata": meta, "customer": {"email": email, "customer_id": "cus_1"}, **extra}
    return _post(client, {"business_id": "bus_1", "type": "payment.succeeded", "timestamp": _now_iso(), "data": data}, path)


def _refund(client, payment_id="pay_1", refund_id="ref_1", amount=0, partial=False):
    data = {"payload_type": "Refund", "refund_id": refund_id, "payment_id": payment_id, "amount": amount,
            "currency": "USD", "is_partial": partial, "status": "succeeded"}
    return _post(client, {"business_id": "bus_1", "type": "refund.succeeded", "timestamp": _now_iso(), "data": data})


@pytest.fixture()
def dodo(monkeypatch):
    monkeypatch.setenv("DODO_WEBHOOK_SECRET", SECRET)


def test_webhook_purchase_and_duplicate(sb, client, dodo):
    assert _paid(client).status_code == 200
    assert _paid(client).json().get("duplicate") is True
    assert sb.usage("u1")["paid_credits"] == main.pack_pages() * main.UNIT


@pytest.mark.parametrize("path", ["/webhooks", "/webhoks", "/api/payment/dodo-webhook"])
def test_webhook_paths(sb, client, dodo, path):
    assert _paid(client, payment_id="pay_p" + path.replace("/", "_"), path=path).status_code == 200


def test_webhook_unknown_user_is_not_lost(sb, client, dodo):
    r = _paid(client, payment_id="pay_2002", user_id="", email="nobody@x.com")
    assert r.status_code == 500                                   # Dodo qayta yuboradi
    audit = sb.tables.get("admin_audit", [])
    assert audit and audit[0]["action"] == "payment_unmatched" and audit[0]["target"] == "pay_2002"


def test_webhook_unknown_user_found_on_retry(sb, client, dodo):
    assert _paid(client, payment_id="pay_3003", user_id="", email="late@x.com").status_code == 500
    sb.tables["user_usage"] = [_usage_row("late-u", "late@x.com")]
    assert _paid(client, payment_id="pay_3003", user_id="", email="late@x.com").status_code == 200
    assert sb.usage("late-u")["paid_credits"] == main.pack_pages() * main.UNIT


def test_webhook_missing_payment_id_rejected(sb, client, dodo):
    assert _paid(client, payment_id="").status_code == 400


def test_webhook_other_events_ignored(sb, client, dodo):
    r = _post(client, {"type": "payment.failed", "data": {"payment_id": "pay_x", "metadata": {"user_id": "u1"}}})
    assert r.status_code == 200 and r.json()["ignored"] == "payment.failed"
    assert sb.usage("u1") is None or sb.usage("u1")["paid_credits"] == 0


def test_webhook_partial_and_full_refund(sb, client, dodo):
    pages = main.pack_pages()
    _paid(client, payment_id="pay_4004")
    assert _refund(client, "pay_4004", "ref_a", amount=pages // 2, partial=True).status_code == 200
    assert sb.usage("u1")["paid_credits"] == (pages - pages // 2) * main.UNIT
    assert _refund(client, "pay_4004", "ref_a", amount=pages // 2, partial=True).json().get("duplicate") is True
    assert _refund(client, "pay_4004", "ref_b", amount=pages, partial=False).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 0
    assert _refund(client, "pay_4004", "ref_c", amount=pages).json().get("duplicate") is True


def test_refund_unknown_payment_ignored(sb, client, dodo):
    r = _refund(client, "pay_nope", "ref_x", amount=100)
    assert r.status_code == 200 and r.json()["ignored"] == "unknown_payment"


# ---------------------------------------------------------------------------------------------
# 8) Kredit to'ldirish: 1 cent = 1 kredit, paket bonusi imzolangan metadata orqali
# ---------------------------------------------------------------------------------------------
def test_topup_gross_equals_net():
    for c in (100, 500, 750, 2000):
        assert main.topup_gross_cents(c) == c


def test_topup_quote_presets_and_custom():
    q, err = main._topup_quote_from_payload({"package": "popular"})
    assert not err and q["credits"] == 550 and q["net_cents"] == 500 and q["gross_cents"] == 500
    q, err = main._topup_quote_from_payload({"package": "custom", "net_amount": 7.5, "credits": 999999})
    assert not err and q["credits"] == 750 and q["gross_cents"] == 750  # mijoz yuborgan credits e'tiborsiz
    assert main._topup_quote_from_payload({"net_amount": 0.99})[1]
    assert main._topup_quote_from_payload({"net_amount": "abc"})[1]
    assert main._topup_quote_from_payload({"net_amount": "nan"})[1]
    assert main._topup_quote_from_payload({"package": "gold"})[1]


def test_webhook_preset_bonus_credits(sb, client, dodo):
    meta, gross = _signed_meta("u1", "business", 2000, 2600)
    assert _paid(client, payment_id="pay_6006", meta=meta, total=gross).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 2600 * main.UNIT


def test_webhook_tampered_metadata_falls_back_to_amount(sb, client, dodo):
    meta, gross = _signed_meta("u1", "custom", 100, 100)
    meta["credits"] = "100000"                                          # soxtalashtirilgan
    assert _paid(client, payment_id="pay_7007", meta=meta, total=gross).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 100 * main.UNIT


@pytest.mark.parametrize("paid_cents", [100, 500, 1999])
def test_webhook_underpaid_signed_order_uses_amount(sb, client, dodo, paid_cents):
    meta, _ = _signed_meta("u1", "business", 2000, 2600)
    assert _paid(client, payment_id=f"pay_8{paid_cents}", meta=meta, total=paid_cents).status_code == 200
    assert sb.usage("u1")["paid_credits"] == paid_cents * main.UNIT      # bonus berilmaydi


def test_webhook_tax_is_not_credited(sb, client, dodo):
    meta, _ = _signed_meta("u1", "custom", 500, 500)
    assert _paid(client, payment_id="pay_tax", meta=meta, total=600, tax=100).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 500 * main.UNIT


def test_webhook_rejects_bad_or_missing_signature(sb, client, dodo):
    body = json.dumps({"type": "payment.succeeded", "data": {"payment_id": "pay_9001", "total_amount": 5000,
                                                             "metadata": {"user_id": "u1"}}}).encode()
    wrong = "whsec_" + base64.b64encode(b"another-secret-another-secret-xx").decode()
    bad_headers = [
        {"Content-Type": "application/json"},
        {**_std_sign(body), "webhook-signature": "v1,AAAA"},
        _std_sign(body, secret=wrong),
        _std_sign(body, ts=int(time.time()) - 3600),                  # eskirgan (replay)
        {**_std_sign(body), "webhook-id": "msg_other"},               # imzolangan id boshqa
    ]
    for h in bad_headers:
        assert client.post("/webhooks", content=body, headers=h).status_code == 401
    assert sb.usage("u1") is None or sb.usage("u1")["paid_credits"] == 0


def test_webhook_multiple_signatures_header(sb, client, dodo):
    body = {"type": "payment.succeeded", "data": {"payment_id": "pay_ms", "status": "succeeded", "total_amount": 300,
                                                  "currency": "USD", "metadata": {"user_id": "u1"}}}
    raw = json.dumps(body).encode()
    h = _std_sign(raw)
    h["webhook-signature"] = "v1,AAAA " + h["webhook-signature"]
    assert client.post("/webhooks", content=raw, headers=h).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 300 * main.UNIT


def test_webhook_without_secret_is_refused(sb, client, monkeypatch):
    monkeypatch.delenv("DODO_WEBHOOK_SECRET", raising=False)
    assert _paid(client).status_code == 503


def test_webhook_same_payment_twice_counts_once(sb, client, dodo):
    meta, gross = _signed_meta("u1", "popular", 500, 550)
    for _ in range(3):
        assert _paid(client, payment_id="pay_9100", meta=meta, total=gross).status_code == 200
    assert sb.usage("u1")["paid_credits"] == 550 * main.UNIT


def test_create_checkout_body(monkeypatch):
    captured = {}
    monkeypatch.setenv("DODO_PAYMENTS_API_KEY", "k")
    monkeypatch.setenv("DODO_PRODUCT_ID", "pdt_test")
    monkeypatch.setenv("DODO_WEBHOOK_SECRET", SECRET)

    async def fake(method, path, api_key, base, body=None):
        captured.update(method=method, path=path, key=api_key, base=base, body=body)
        return {"status": 200, "json": {"session_id": "cks_1", "checkout_url": "https://test.checkout.dodopayments.com/s/cks_1"}}

    monkeypatch.setattr(main, "_dodo_request", fake)
    code, data = asyncio.run(main._build_checkout("u1", "a@x.com", "https://app.test", "pack",
                                                  quote=main._topup_quote("popular", 500, 550)))
    assert code == 200 and data["checkout_url"].endswith("cks_1") and data["session_id"] == "cks_1"
    assert data["quote"] == {"package": "popular", "credits": 550, "net_usd": 5.0, "fee_usd": 0.0, "gross_usd": 5.0}
    assert captured["method"] == "POST" and captured["path"] == "/checkouts"
    assert captured["base"] == "https://test.dodopayments.com" and captured["key"] == "k"
    b = captured["body"]
    assert b["product_cart"] == [{"product_id": "pdt_test", "quantity": 1, "amount": 500}]
    assert b["return_url"] == "https://app.test/?payment=success"
    assert b["customer"]["email"] == "a@x.com"
    md = b["metadata"]
    assert all(isinstance(v, str) for v in md.values())
    assert md["user_id"] == "u1" and md["credits"] == "550"
    assert main._topup_verified_credits(md, "u1", 500) == 550
    assert main._topup_verified_credits(md, "someone-else", 500) is None


def test_live_mode_base_url(monkeypatch):
    monkeypatch.setenv("DODO_PAYMENTS_ENV", "live")
    assert main._dodo_env()["api_base"] == "https://live.dodopayments.com"
    monkeypatch.setenv("DODO_PAYMENTS_ENV", "LIVE ")
    assert main._dodo_env()["mode"] == "live"
    monkeypatch.setenv("DODO_PAYMENTS_ENV", "bogus")
    assert main._dodo_env()["api_base"] == "https://test.dodopayments.com"


def test_create_checkout_shows_dodo_reason(monkeypatch):
    monkeypatch.setenv("DODO_PAYMENTS_API_KEY", "k")
    monkeypatch.setenv("DODO_PRODUCT_ID", "pdt_x")

    async def fake(*a, **k):
        return {"status": 422, "error_body": json.dumps({"code": "INVALID_REQUEST", "message": "amount below minimum"})}

    monkeypatch.setattr(main, "_dodo_request", fake)
    code, data = asyncio.run(main._build_checkout("u1", "", "", "pack", quote=main._topup_quote("starter", 100, 100)))
    assert code == 502 and data["dodo_status"] == 422 and "amount below minimum" in data["error"]


def test_create_checkout_not_configured(monkeypatch):
    monkeypatch.delenv("DODO_PAYMENTS_API_KEY", raising=False)
    code, data = asyncio.run(main._build_checkout("u1", "", "", "pack"))
    assert code == 503


def test_create_checkout_endpoint_requires_login(sb, client):
    assert client.post("/api/create-checkout", json={"amount": 5}).status_code == 401
