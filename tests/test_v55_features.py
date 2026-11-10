"""v55 testlari: e'lon (reklamasiz), to'plamli rasm qidiruvi, bot slaydlarida tugma/havola/GIF/YouTube, bot AI balansni biladi."""
import asyncio
import io
import json
import time
from datetime import datetime, timezone

import pytest

import main
from backend import ads, tg_decks as decks
from backend import telegram_bot as tg

pytestmark = pytest.mark.timeout(60)


# ---------------------------------------------------------------------------------------------
# 1) E'lon: «Reklama» yozuvisiz, VIP ham ko'radi, saytda alohida endpoint
# ---------------------------------------------------------------------------------------------
def test_clean_ad_kind():
    row, err = ads.clean_ad({"title": "Yangilik", "kind": "notice"})
    assert not err and row["kind"] == "notice"
    row, _ = ads.clean_ad({"title": "X", "kind": "boshqa"})
    assert row["kind"] == "ad"


def _rows(monkeypatch, rows):
    monkeypatch.setattr(ads, "_load", lambda force=False: rows)
    monkeypatch.setattr(ads, "surface_enabled", lambda s: True)


def test_pick_separates_ads_and_notices(monkeypatch):
    _rows(monkeypatch, [{"id": 1, "active": True, "placement": "both", "kind": "ad"},
                        {"id": 2, "active": True, "placement": "both", "kind": "notice"}])
    assert ads.pick("site", False)["id"] == 1
    assert ads.pick("site", False, kind="notice")["id"] == 2
    assert ads.pick("site", True) is None                       # VIP reklama ko'rmaydi
    assert ads.pick("site", True, kind="notice")["id"] == 2     # e'lonni esa ko'radi


def test_old_rows_without_kind_are_ads(monkeypatch):
    _rows(monkeypatch, [{"id": 5, "active": True, "placement": "site"}])
    assert ads.pick("site", False)["id"] == 5
    assert ads.pick("site", False, kind="notice") is None


def test_public_label_only_for_ads():
    assert ads.public({"id": 1, "kind": "ad"}, "site")["label"] is True
    pub = ads.public({"id": 2, "kind": "notice"}, "site")
    assert pub["label"] is False and pub["kind"] == "notice"


def test_notice_endpoint(client, monkeypatch):
    _rows(monkeypatch, [{"id": 3, "active": True, "placement": "site", "kind": "notice", "title": "Salom"},
                        {"id": 7, "active": True, "placement": "both", "kind": "notice", "title": "Yangi"},
                        {"id": 9, "active": True, "placement": "site", "kind": "ad", "title": "Reklama"},
                        {"id": 11, "active": True, "placement": "bot", "kind": "notice", "title": "Faqat bot"}])
    monkeypatch.setattr(ads, "bump", lambda *a: None)
    j = client.get("/api/notice/next").json()
    assert j["notice"]["id"] == 7 and j["notice"]["label"] is False      # eng yangisi, reklama emas, bot uchun emas
    # v56: faqat ENG OXIRGI e'lon. Uni ko'rgan bo'lsa — eskisi (3) chiqmaydi
    j = client.get("/api/notice/next?exclude=7").json()
    assert j["notice"] is None and j["latest"] == 7
    assert client.get("/api/notice/next?exclude=3").json()["notice"]["id"] == 7
    assert client.get("/api/ads/next").json()["ad"]["id"] == 9              # reklama endpointida e'lon chiqmaydi


def test_bot_notice_has_no_ad_label(monkeypatch):
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append(text)
        return {"message_id": 1}
    monkeypatch.setattr(tg, "_send", fake_send)
    asyncio.run(tg._deliver_ad(1, "Yangilik", "Matn", "none", "", label=False))
    asyncio.run(tg._deliver_ad(1, "Chegirma", "Matn", "none", "", label=True))
    assert "Reklama" not in sent[0] and "Reklama" in sent[1]


# ---------------------------------------------------------------------------------------------
# 2) Rasm qidiruvi: hammasi BIR VAQTDA, topilmaganlari ham bitta to'plamda qayta qidiriladi
# ---------------------------------------------------------------------------------------------
class _WS:
    def __init__(self):
        self.events = []

    async def send_json(self, p):
        self.events.append((time.monotonic(), p))


def test_search_batch_runs_in_parallel(monkeypatch):
    def slow(q, kind, n):
        time.sleep(0.4)
        return [{"url": f"https://img.example/{q}.jpg"}]
    monkeypatch.setattr(main, "_search_images_sync", slow)
    ws = _WS()
    t0 = time.monotonic()
    res = asyncio.run(main._search_batch(ws, [(f"q{i}", "photo") for i in range(5)], stagger=0.01))
    took = time.monotonic() - t0
    assert took < 1.2, took                      # ketma-ket bo'lsa 2 soniyadan oshardi
    assert all(r and r[0]["url"].endswith(f"q{i}.jpg") for i, r in enumerate(res))
    # v57: qidiruvlar parallel, lekin foydalanuvchiga BIRMA-BIR: start1, done1, start2, done2, ...
    types = [p["type"] for _, p in ws.events]
    assert types == ["search_start", "search_done"] * 5
    assert [p["n"] for _, p in ws.events if p["type"] == "search_start"] == [1, 2, 3, 4, 5]


def test_search_batch_reveals_one_by_one(monkeypatch):
    monkeypatch.setattr(main, "_search_images_sync", lambda q, k, n: [{"url": "https://img.example/" + q}])
    ws = _WS()
    asyncio.run(main._search_batch(ws, [(f"q{i}", "photo") for i in range(4)], stagger=0.15))
    done_t = [t for t, p in ws.events if p["type"] == "search_done"]
    gaps = [b - a for a, b in zip(done_t, done_t[1:])]
    assert all(g >= 0.12 for g in gaps), gaps                  # natijalar bir vaqtda «yopirilib» tushmaydi


def test_search_batch_retries_missing_together(monkeypatch):
    calls = []

    def search(q, kind, n):
        calls.append(q)
        if q in ("red sports car fast", "blue whale ocean deep"):
            return []                            # birinchi urinish — topilmadi
        return [{"url": f"https://img.example/{q.replace(' ', '_')}.jpg"}]
    monkeypatch.setattr(main, "_search_images_sync", search)
    res = asyncio.run(main._search_batch(None, [("red sports car fast", "photo"), ("cat", "photo"), ("blue whale ocean deep", "photo")], stagger=0))
    assert all(res), res
    assert "red sports" in calls and "blue whale" in calls     # soddaroq so'rov bilan qayta


def test_search_batch_gif_safe_pool(monkeypatch):
    monkeypatch.setattr(main, "_search_images_sync", lambda q, k, n: [])
    res = asyncio.run(main._search_batch(None, [("dancing robot", "gif")], stagger=0))
    assert res[0] and res[0][0]["source"] == "safe_pool"


def test_client_side_search_many_collects_all():
    class _ClientWS:
        def __init__(self):
            self.out, self.inbox = [], asyncio.Queue()

        async def send_json(self, p):
            self.out.append(p)
            if p["type"] == "search_request":           # brauzer javoblari teskari tartibda keladi
                await self.inbox.put(json.dumps({"type": "search_result", "id": p["id"], "results": [{"url": "https://c.example/" + p["query"]}]}))

        async def receive_text(self):
            return await self.inbox.get()
    ws = _ClientWS()
    got = asyncio.run(main._client_side_search_many(ws, [(0, "a", "photo"), (1, "b", "gif")], timeout=2))
    assert got[0][0]["url"].endswith("/a") and got[1][0]["url"].endswith("/b")
    assert len([p for p in ws.out if p["type"] == "search_request"]) == 2


def test_tool_search_kind():
    assert main._tool_search_kind("cat", "gif") == "gif"
    assert main._tool_search_kind("loading spinner", "photo") == "gif"
    assert main._tool_search_kind("ocean", None) == "photo"
    assert main._tool_search_kind("ocean", "video") == "video"


# ---------------------------------------------------------------------------------------------
# 3) Bot slaydlari: tugma / havola / GIF / YouTube / video
# ---------------------------------------------------------------------------------------------
def test_norm_url():
    assert decks.norm_url("example.org") == "https://example.org"
    assert decks.norm_url("t.me/kanal") == "https://t.me/kanal"
    assert decks.norm_url("https://a.uz/x?y=1") == "https://a.uz/x?y=1"
    for bad in ("javascript:alert(1)", "data:text/html,x", "ftp://a.b", "http://", "salom", 'https://a.uz/"><script>'):
        assert decks.norm_url(bad) == "", bad


def test_normalize_buttons_and_media():
    s = decks.normalize_slide({"layout": "bullets", "title": "T", "bullets": ["a", "b"],
                               "buttons": [{"text": "Sayt", "url": "example.com"}, {"url": "javascript:x"}, "t.me/a", "https://b.uz", "https://c.uz"],
                               "media": {"type": "youtube", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10"}})
    assert [b["url"] for b in s["buttons"]] == ["https://example.com", "https://t.me/a", "https://b.uz"]      # max 3, yomoni tashlandi
    assert s["media"] == {"type": "youtube", "id": "dQw4w9WgXcQ", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    assert decks.media_key(s) == "yt:dQw4w9WgXcQ"
    g = decks.normalize_slide({"layout": "bullets", "title": "T", "bullets": ["a"], "media": {"type": "gif", "query": "happy cat"}})
    assert decks.media_key(g) == "gifq:happy cat"
    c = decks.normalize_slide({"layout": "cards", "title": "T", "cards": ["a", "b"], "media": {"type": "gif", "query": "x"}})
    assert "media" not in c                       # rasm joyi yo'q maketda media yo'q


def _gif():
    from PIL import Image
    fr = [Image.new("RGB", (400, 300), c) for c in ((0, 0, 255), (255, 255, 0))]
    b = io.BytesIO()
    fr[0].save(b, "GIF", save_all=True, append_images=fr[1:], duration=200, loop=0)
    return b.getvalue()


def _deck():
    return decks.normalize_deck({"title": "Test", "slides": [
        {"layout": "title", "title": "Salom", "media": {"type": "youtube", "url": "https://youtu.be/dQw4w9WgXcQ"},
         "buttons": [{"text": "Sayt", "url": "https://example.com"}]},
        {"layout": "bullets", "title": "GIF", "bullets": ["a", "b"], "media": {"type": "gif", "url": "https://x.example/a.gif"}},
        {"layout": "bullets", "title": "Video", "bullets": ["a"], "media": {"type": "video", "url": "https://x.example/v.mp4"}},
        {"layout": "cards", "title": "C", "cards": ["a", "b"], "buttons": ["https://t.me/x"]},
        {"layout": "closing", "title": "Rahmat"}]}, 5)


def test_pptx_has_links_and_animated_gif():
    from pptx import Presentation
    deck = _deck()
    gif = _gif()
    _, data, _ = decks.export(deck, {1: gif}, "pptx")
    prs = Presentation(io.BytesIO(data))
    links = []
    for s in prs.slides:
        for sh in s.shapes:
            try:
                if sh.click_action.hyperlink.address:
                    links.append(sh.click_action.hyperlink.address)
            except Exception:
                pass
    assert "https://example.com" in links and "https://t.me/x" in links
    assert "https://x.example/v.mp4" in links                          # video o'rinbosari bosiladi
    pics = [sh for sh in prs.slides[1].shapes if sh.shape_type == 13]
    assert pics and pics[0].image.content_type == "image/gif"            # GIF animatsiyasi saqlangan


def test_html_embeds_players_and_gif():
    _, data, _ = decks.export(_deck(), {1: _gif()}, "html")
    h = data.decode()
    assert "youtube.com/embed/dQw4w9WgXcQ" in h
    assert '<video src="https://x.example/v.mp4"' in h
    assert "data:image/gif;base64" in h
    assert 'class="btn" href="https://example.com"' in h


def test_pdf_has_link_annotations():
    _, data, _ = decks.export(_deck(), {}, "pdf")
    assert b"/URI" in data and b"example.com" in data


# ---------------------------------------------------------------------------------------------
# 4) Bot AI foydalanuvchi balansini biladi
# ---------------------------------------------------------------------------------------------
def test_account_context_has_real_balance():
    usage = {"free_credits": 200, "paid_credits": 0, "last_reset_time": datetime.now(timezone.utc).isoformat()}
    ctx = tg._account_context(usage, "real@gmail.com", {"id": 99})
    assert "Balance" in ctx and "pages" in ctx
    assert str(tg._fmt_pages(tg._pages_left(usage, "fast"))) in ctx


def test_account_context_unlinked():
    ctx = tg._account_context({"free_credits": 200}, tg._tg_email(98), {"id": 98})
    assert "NOT linked" in ctx


def test_new_mode_sends_balance_to_ai(sb, monkeypatch):
    seen = {}

    async def fake_ai(system, user, mode):
        seen["user"] = user
        return {"intent": "chat", "reply": "Sizda 10 varaq bor"}, 5
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append(text)
        return {"message_id": 1}
    monkeypatch.setattr(tg, "_ai_json", fake_ai)
    monkeypatch.setattr(tg, "_send", fake_send)
    monkeypatch.setattr(tg, "tg", lambda *a, **k: asyncio.sleep(0))
    uid = "u-bal"
    sb.tables["user_usage"] = [{"user_id": uid, "email": "bal@gmail.com", "free_credits": 200, "paid_credits": 0,
                                "last_reset_time": datetime.now(timezone.utc).isoformat()}]

    async def fake_uid(user):
        return uid, "bal@gmail.com"
    monkeypatch.setattr(tg, "_ensure_uid", fake_uid)
    asyncio.run(tg._run_new(777, {"id": 777}, "balansim qancha?"))
    assert "[ACCOUNT" in seen["user"] and "Balance" in seen["user"]
    assert any("10 varaq" in t for t in sent)


def test_notice_only_latest_and_cancel(client, monkeypatch):
    """3 ta e'lon ketma-ket yuborilgan, odam hech birini ko'rmagan — faqat oxirgisi. Hammasi bekor qilinsa — hech narsa."""
    rows = [{"id": i, "active": True, "placement": "both", "kind": "notice", "title": f"E'lon {i}"} for i in (10, 11, 12)]
    _rows(monkeypatch, rows)
    monkeypatch.setattr(ads, "bump", lambda *a: None)
    assert client.get("/api/notice/next").json()["notice"]["id"] == 12
    assert client.get("/api/notice/next?exclude=12").json() == {"notice": None, "latest": 12}   # ko'rgan — eskilari chiqmaydi
    for r in rows:
        r["active"] = False                                    # bekor qilindi
    assert client.get("/api/notice/next?exclude=12").json() == {"notice": None}
