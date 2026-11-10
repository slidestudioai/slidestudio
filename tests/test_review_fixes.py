"""v53 qolgan tuzatishlar testlari: atomik balans (CAS), generate limiti, reklama media, referal, host keshi,
Chuqur AI qidiruv hisobi, SSRF peer tekshiruvi."""
import asyncio
import http.server
import json
import threading
import time
import urllib.error
from datetime import datetime, timedelta, timezone

import pytest

import main
from backend import community, monitoring
from backend import telegram_bot as tg

pytestmark = pytest.mark.timeout(60)


def _row(uid, email="a@x.com", paid=0, free=200):
    return {"user_id": uid, "email": email, "free_credits": free, "paid_credits": paid,
            "slide_credits": free + paid, "last_reset_time": datetime.now(timezone.utc).isoformat(), "blocked": False}


@pytest.fixture(autouse=True)
def _fresh_locks():
    main._user_locks.clear()
    yield
    main._user_locks.clear()


# ---------------------------------------------------------------------------------------------
# 4) Balans: optimistic lock — boshqa jarayon yozgan to'lov yo'qolmaydi
# ---------------------------------------------------------------------------------------------
def test_save_detects_concurrent_write(sb):
    sb.tables["user_usage"] = [_row("u1", paid=100)]
    u = main.get_or_create_user_usage("u1", "a@x.com")
    sb._apply_payment("order-x", "u1", 100, 2000, 1)            # boshqa server nusxasi to'lovni qo'shdi
    u = monitoring.deduct_credits(u, 20)
    assert main.save_user_credits("u1", u, 0) is False          # eski qiymat ustidan yozilMAdi
    assert sb.usage("u1")["paid_credits"] == 2100


def test_update_usage_atomic_retries_and_keeps_payment(sb):
    sb.tables["user_usage"] = [_row("u1", paid=0, free=40)]
    calls = {"n": 0}

    def charge(u):
        calls["n"] += 1
        if calls["n"] == 1:                                      # o'qishdan keyin, yozishdan oldin to'lov keldi
            sb._apply_payment("order-y", "u1", 100, 2000, 1)
        u2, ch, rs = monitoring.charge_for_ai_turn(u, 3, 0, "fast")   # 3 slayd = 60 birlik
        return u2, ch
    u, charged = main.update_usage_atomic("u1", "a@x.com", charge)
    row = sb.usage("u1")
    assert calls["n"] == 2 and charged == 60
    assert row["free_credits"] + row["paid_credits"] == 40 + 2000 - 60     # to'lov ham, yechim ham saqlandi


def test_sequential_saves_use_new_version(sb):
    sb.tables["user_usage"] = [_row("u1", paid=100)]
    u = main.get_or_create_user_usage("u1", "")
    u["paid_credits"] = 150
    assert main.save_user_credits("u1", u, 0) is True
    u["paid_credits"] = 50
    assert main.save_user_credits("u1", u, 0) is True           # o'sha dict bilan ikkinchi yozuv ham o'tadi
    assert sb.usage("u1")["paid_credits"] == 50


def test_bot_charge_uses_atomic_update(sb):
    sb.tables["user_usage"] = [_row("u1", paid=0, free=200)]
    usage, charged = asyncio.run(tg._charge("u1", "a@x.com", 2, 10, "fast", {"src": "test"}))
    assert charged == 40 and sb.usage("u1")["free_credits"] == 160


# ---------------------------------------------------------------------------------------------
# 6) generate rejimi: 1 varaqqa yetmasa slayd yaratilmaydi
# ---------------------------------------------------------------------------------------------
def test_generate_requires_full_page(sb, client, monkeypatch):
    monkeypatch.setenv("SLIDE_STUDIO_DEV_MODE", "1")
    monkeypatch.setenv("SLIDE_STUDIO_DEV_TOKEN", "devtok")
    low = monitoring.normalize_user_row({"user_id": "dev-user", "free_credits": 10, "paid_credits": 0,
                                         "last_reset_time": datetime.now(timezone.utc).isoformat()})
    monkeypatch.setattr(main, "get_or_create_user_usage", lambda uid, email: dict(low))
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "x", "token": "devtok", "mode": "generate",
                                 "plan_slides": [{"title": "a"}], "plan_index": 0}))
        r = ws.receive_json()
        assert r["code"] == "LIMIT_EXCEEDED"
        ws.send_text(json.dumps({"prompt": "salom", "token": "devtok"}))   # oddiy chat 10 birlik bilan mumkin
        assert "AI xizmati" in ws.receive_json()["message"]


# ---------------------------------------------------------------------------------------------
# 8) Reklama media: bot o'chiq bo'lsa 404, Range to'g'ri
# ---------------------------------------------------------------------------------------------
def test_parse_range():
    assert main._parse_range("", 100) is None
    assert main._parse_range("bytes=0-9", 100) == (0, 9)
    assert main._parse_range("bytes=90-", 100) == (90, 99)
    assert main._parse_range("bytes=-10", 100) == (90, 99)
    assert main._parse_range("bytes=0-500", 100) == (0, 99)
    assert main._parse_range("bytes=50-10", 100) == "invalid"
    assert main._parse_range("bytes=100-", 100) == "invalid"
    assert main._parse_range("bytes=0-1", 0) == "invalid"


def test_ads_media_without_bot(client, monkeypatch):
    monkeypatch.setattr(main.ads_mod, "get_row", lambda ad_id, with_media=True: {"id": 1, "active": True, "media_url": "tg:abc"})
    monkeypatch.setattr(main, "tgbot", None)
    assert client.get("/api/ads/media/1").status_code == 404


def test_ads_media_range(client, monkeypatch):
    class Bot:
        async def fetch_ad_file(self, fid):
            return b"0123456789", "video/mp4"
    monkeypatch.setattr(main.ads_mod, "get_row", lambda ad_id, with_media=True: {"id": 1, "active": True, "media_url": "tg:abc"})
    monkeypatch.setattr(main, "tgbot", Bot())
    r = client.get("/api/ads/media/1", headers={"Range": "bytes=2-4"})
    assert r.status_code == 206 and r.content == b"234" and r.headers["content-range"] == "bytes 2-4/10"
    assert client.get("/api/ads/media/1", headers={"Range": "bytes=8-2"}).status_code == 416


# ---------------------------------------------------------------------------------------------
# 9) Bot matni narxni MODES dan oladi
# ---------------------------------------------------------------------------------------------
def test_deep_multiplier_matches_billing():
    assert tg._deep_mult() == monitoring.DEEP_MULT == monitoring.MODES["deep"]["page"] // monitoring.MODES["fast"]["page"]


# ---------------------------------------------------------------------------------------------
# 10) Referal: akkaunt sanasi noma'lum bo'lsa bonus berilmaydi
# ---------------------------------------------------------------------------------------------
def test_referral_fails_closed_when_age_unknown(sb):
    sb.tables["referral_codes"] = [{"user_id": "inviter", "code": "ABCDEF12"}]
    sb.tables["user_usage"] = [_row("inviter")]
    r = asyncio.run(community.api["claim"]("ghost-user", None, "ABCDEF12"))   # auth'da bunday user yo'q
    assert r.get("ok") is False and r.get("status") == 503
    assert sb.usage("inviter")["paid_credits"] == 0


def test_referral_new_account_gets_bonus(sb):
    sb.tables["referral_codes"] = [{"user_id": "inviter", "code": "ABCDEF12"}]
    sb.tables["user_usage"] = [_row("inviter")]
    r = asyncio.run(community.api["claim"]("new-user", datetime.now(timezone.utc).isoformat(), "ABCDEF12"))
    assert r.get("ok") is True
    assert sb.usage("inviter")["paid_credits"] == community.REFERRAL_BONUS_PAGES * monitoring.UNIT


def test_referral_old_account_rejected(sb):
    sb.tables["referral_codes"] = [{"user_id": "inviter", "code": "ABCDEF12"}]
    old = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    r = asyncio.run(community.api["claim"]("old-user", old, "ABCDEF12"))
    assert r.get("ok") is False and "yangi" in r["error"]


# ---------------------------------------------------------------------------------------------
# 11) Host semaforlari cheksiz o'smaydi
# ---------------------------------------------------------------------------------------------
def test_host_slots_are_pruned(monkeypatch):
    monkeypatch.setattr(main, "_HOST_MAX", 10)
    main._HOST_SEM.clear()
    main._HOST_LAST.clear()
    old = time.time() - 10_000
    for i in range(20):
        main._HOST_SEM[f"h{i}.com"] = threading.Semaphore(3)
        main._HOST_LAST[f"h{i}.com"] = old
    main._host_slot("fresh.com").release()
    assert len(main._HOST_SEM) <= 2 and "fresh.com" in main._HOST_SEM


# ---------------------------------------------------------------------------------------------
# 12) Chuqur AI oldindan qidiruvi sanaladi
# ---------------------------------------------------------------------------------------------
def test_deep_presearch_counts_searches(monkeypatch):
    class _Msg:
        content = json.dumps({"queries": ["solar panel", "wind turbine"]})

    class _Completions:
        async def create(self, **kw):
            return type("R", (), {"choices": [type("C", (), {"message": _Msg()})()]})()
    client = type("Cl", (), {"chat": type("Ch", (), {"completions": _Completions()})()})()
    monkeypatch.setattr(main, "_search_images_sync", lambda q, kind, n: [{"url": f"https://img.example/{q}.jpg"}])
    stats = {}
    txt = asyncio.run(main._deep_presearch(client, "energy", 3, None, stats))
    assert stats["searches"] == 2 and "img.example" in txt
    u = monitoring.normalize_user_row({"free_credits": 200, "paid_credits": 0})
    _, charged, _ = monitoring.charge_for_ai_turn(u, 1, stats["searches"], "deep")
    assert charged == monitoring.MODES["deep"]["page"] + 2 * monitoring.MODES["deep"]["search"]


# ---------------------------------------------------------------------------------------------
# 13) SSRF: ulanishdan keyin haqiqiy IP tekshiriladi (DNS rebinding)
# ---------------------------------------------------------------------------------------------
def test_ip_is_public():
    for bad in ("127.0.0.1", "10.1.2.3", "169.254.169.254", "0.0.0.0", "::1", "::ffff:127.0.0.1", "192.168.1.1"):
        assert not main._ip_is_public(bad), bad
    assert main._ip_is_public("8.8.8.8")


def test_safe_opener_blocks_private_peer():
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"secret")

        def log_message(self, *a):
            pass
    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        # _is_public_host tekshiruvi aylanib o'tilgan holat (DNS rebinding): to'g'ridan-to'g'ri opener chaqiriladi
        with pytest.raises(urllib.error.URLError):
            main._SAFE_OPENER.open(f"http://127.0.0.1:{srv.server_port}/", timeout=5)
    finally:
        srv.shutdown()


def test_fetch_json_rejects_private_host():
    assert "error" in main._fetch_json_sync("http://127.0.0.1:1/x")
