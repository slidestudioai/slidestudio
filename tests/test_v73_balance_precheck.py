"""v73: balans 1 varaqdan kam bo'lsa slayd so'rovi AI'ga yetib bormaydi (avval AI 6–7 ta pullik rasm qidiruvidan keyin
«balans yo'q» derdi). Oddiy savol-javob esa ishlayveradi."""
import json
from datetime import datetime, timezone

import main
from backend import monitoring
from backend.services import prompt_builder as pb


def _low(monkeypatch, units=10):
    monkeypatch.setenv("SLIDE_STUDIO_DEV_MODE", "1")
    monkeypatch.setenv("SLIDE_STUDIO_DEV_TOKEN", "devtok")
    low = monitoring.normalize_user_row({"user_id": "dev-user", "free_credits": units, "paid_credits": 0,
                                         "last_reset_time": datetime.now(timezone.utc).isoformat()})
    monkeypatch.setattr(main, "get_or_create_user_usage", lambda uid, email: dict(low))
    calls = []
    monkeypatch.setattr(main, "_run_ai_turn", lambda *a, **k: calls.append(1))
    return calls


def test_slide_request_with_low_balance_is_refused_before_ai(sb, client, monkeypatch):
    calls = _low(monkeypatch)
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "Kosmos haqida 5 ta slayd qilib ber", "token": "devtok"}))
        r = ws.receive_json()
    assert r["code"] == "LIMIT_EXCEEDED" and "kamida 1 varaq" in r["message"]
    assert calls == []


def test_wants_slide_work_detection():
    yes = ["Kosmos haqida 5 ta slayd qilib ber", "3-slaydga rasm qo'sh", "make a presentation about AI", "сделай презентацию",
           "krossvord yasab ber"]
    no = ["salom", "rahmat", "nima qila olasan?", "slayd nima?", "varaq qancha qoldi?"]
    assert all(main._wants_slide_work(t) for t in yes)
    assert not any(main._wants_slide_work(t) for t in no)


def test_ai_rule_forbids_search_at_zero_balance():
    usage = monitoring.normalize_user_row({"user_id": "u", "free_credits": 10, "paid_credits": 0,
                                           "last_reset_time": datetime.now(timezone.utc).isoformat()})
    assert "search_images ni CHAQIRMANG" in pb.ai_balance_rules(usage, "fast")


# ---------------------------------------------------------------- v73: qidiruv qatorlari bir-birini kutmaydi
import asyncio  # noqa: E402
import time  # noqa: E402


class _WS:
    def __init__(self):
        self.events = []

    async def send_json(self, p):
        self.events.append((time.monotonic(), p))


def test_search_rows_finish_independently(monkeypatch):
    def search(q, kind, n):
        time.sleep(0.6 if q == "slow" else 0.05)
        return [{"url": "https://img.example/" + q + ".jpg"}]
    monkeypatch.setattr(main, "_search_images_sync", search)
    monkeypatch.setattr(main, "SEARCH_VERIFY_IMAGES", False)
    ws = _WS()
    res = asyncio.run(main._search_batch(ws, [("slow", "photo"), ("a", "photo"), ("b", "photo")], stagger=0))
    types = [p["type"] for _, p in ws.events if p["type"].startswith("search_")]
    assert types[:3] == ["search_start"] * 3                    # hammasi birdan ko'rinadi
    done = [p["query"] for _, p in ws.events if p["type"] == "search_done"]
    assert done[-1] == "slow" and set(done) == {"slow", "a", "b"}  # sekini boshqalarni ushlab turmaydi
    assert [r[0]["url"] for r in res] == ["https://img.example/slow.jpg", "https://img.example/a.jpg", "https://img.example/b.jpg"]


# ---------------------------------------------------------------- v73: Mini App (tg<ID>@t.me sessiyasi) — admin kirishi
from backend import admin_core  # noqa: E402


def test_admin_entry_without_linking(sb, monkeypatch):
    """v79: admin bo'lish uchun Google va Telegram'ni bir-biriga ULASH SHART EMAS:
    Telegram akkaunti — ID ADMIN_TG_IDS da bo'lsa; Google akkaunti — email ADMIN_EMAILS da bo'lsa."""
    monkeypatch.setenv("ADMIN_EMAILS", "boss@x.uz")
    monkeypatch.setenv("ADMIN_TG_IDS", "777")
    admin_core._vip_cache.clear()
    sb.add_user("t1", "u-tg", "tg777@t.me")
    sb.users["t1"].app_metadata = {"telegram_id": 777}                 # bot yaratgan haqiqiy Telegram akkaunti
    sb.tables["tg_links"] = []
    r = admin_core.check_admin_user("u-tg", "tg777@t.me")
    assert r["ok"] is True and r["tg_id"] == 777
    assert admin_core.check_admin_user("u-tg", "tg888@t.me")["ok"] is False        # admin emas
    sb.add_user("t2", "u-fake", "tg777@t.me")                                       # begona akkaunt shu emailni egallasa
    admin_core._vip_cache.clear()
    assert admin_core.check_admin_user("u-fake", "tg777@t.me")["ok"] is False
    g = admin_core.check_admin_user("u-google", "boss@x.uz")                          # Google admin — ulashsiz
    assert g["ok"] is True and g["tg_id"] == 0
    assert admin_core.check_admin_user("u-x", "other@x.uz")["ok"] is False
    # panel tokeni ikkala holatda ham ishlaydi, admin ro'yxatdan chiqarilsa — darhol yaroqsiz
    assert admin_core.verify_token(admin_core.make_token(777, ""))
    assert admin_core.verify_token(admin_core.make_token(0, "boss@x.uz"))
    monkeypatch.setenv("ADMIN_TG_IDS", "")
    assert not admin_core.verify_token(admin_core.make_token(777, ""))
    assert admin_core.check_admin_tg(777)["ok"] is False


def test_search_rows_default_one_by_one(monkeypatch):
    """Standart: qatorlar AI tartibida BIRMA-BIR (start1, done1, start2, done2 …), hech biri bir zumda yopirilmaydi."""
    monkeypatch.setattr(main, "_search_images_sync", lambda q, k, n: [{"url": "https://img.example/" + q + ".jpg"}])
    monkeypatch.setattr(main, "SEARCH_VERIFY_IMAGES", False)
    ws = _WS()
    asyncio.run(main._search_batch(ws, [(f"q{i}", "photo") for i in range(4)]))
    ev = [(t, p) for t, p in ws.events if p["type"].startswith("search_")]
    assert [p["type"] for _, p in ev] == ["search_start", "search_done"] * 4
    assert [p["query"] for _, p in ev if p["type"] == "search_done"] == ["q0", "q1", "q2", "q3"]
    done_t = [t for t, p in ev if p["type"] == "search_done"]
    assert all(b - a >= main.SEARCH_STAGGER * 0.8 for a, b in zip(done_t, done_t[1:]))
