"""v79: admin panel (ulashsiz kirish, ism/@username, faollik tartibi, filtrlar), oxirgi faollik va «eng oxirgi taqdimot»."""
import asyncio
import os
from datetime import datetime, timedelta, timezone

import main
from backend import admin_core
from backend import telegram_bot as tb
from tests.test_v75_one_editor import _init_data

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _ago(h):
    return (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()


# ------------------------------------------------------------------ oxirgi faollik
def test_touch_user_updates_activity_and_names(sb):
    main._TOUCH_AT.clear()
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "tg5@t.me", "free_credits": 200, "paid_credits": 0,
                                "last_active": _ago(48)}]
    assert main.touch_user("u1", {"display_name": "Ali Valiyev", "tg_username": "ali_v"}) is True
    row = sb.usage("u1")
    assert row["display_name"] == "Ali Valiyev" and row["tg_username"] == "ali_v"
    assert row["last_active"] > _ago(0.01)
    assert row["free_credits"] == 200                              # balansga tegmaydi
    assert main.touch_user("u1", {"display_name": "Ali Valiyev", "tg_username": "ali_v"}) is False   # 5 daqiqa throttle
    assert main.touch_user("u1", {"display_name": "Ali V", "tg_username": "ali_v"}) is True          # ism o'zgardi — darhol


def test_new_user_row_starts_active(sb):
    u = main._get_or_create_user_usage_raw("fresh-1", "x@gmail.com")
    assert u is not None and sb.usage("fresh-1")["last_active"]


def test_bot_any_update_counts_as_activity(monkeypatch):
    touched = []
    monkeypatch.setitem(tb._deps, "touch", lambda uid, extra=None, force=False: touched.append((uid, extra)))
    tb._touch_at.pop(6060, None)
    tb._uids[6060] = ("acc-6060", "tg6060@t.me")
    tb._uid_ts[6060] = __import__("time").time()

    async def run():
        tb._activity({"id": 6060, "first_name": "Ali", "last_name": "V", "username": "aliv"})
        await asyncio.sleep(0.05)
    asyncio.run(run())
    assert touched == [("acc-6060", {"display_name": "Ali V", "tg_username": "aliv"})]
    asyncio.run(run())
    assert len(touched) == 1                                      # 5 daqiqada bir marta


# ------------------------------------------------------------------ admin ro'yxati
def _users(sb):
    sb.tables["user_usage"] = [
        {"user_id": "idle", "email": "idle@gmail.com", "free_credits": 200, "paid_credits": 0, "last_active": _ago(300), "created_at": _ago(400)},
        {"user_id": "tgu", "email": "tg42@t.me", "free_credits": 200, "paid_credits": 0, "last_active": _ago(0.1), "created_at": _ago(200),
         "telegram_id": 42, "tg_username": "jasur_dev", "display_name": "Jasur"},
        {"user_id": "g2", "email": "g2@gmail.com", "free_credits": 200, "paid_credits": 0, "last_active": _ago(5), "created_at": _ago(100)},
    ]
    sb.tables["tg_links"] = [{"tg_id": 77, "user_id": "g2", "email": "g2@gmail.com", "created_at": _ago(50)}]


def test_most_recently_active_user_is_on_top(sb):
    _users(sb)
    assert [u["user_id"] for u in admin_core._find_users("", "all", 30, 0)] == ["tgu", "g2", "idle"]


def test_telegram_user_shows_name_and_username_not_technical_email(sb):
    _users(sb)
    u = next(x for x in admin_core._find_users("", "all", 30, 0) if x["user_id"] == "tgu")
    assert u["label"] == "Jasur @jasur_dev" and u["username"] == "jasur_dev" and u["email"] == "" and u["tg_id"] == 42
    sb.tables["user_usage"][1].update(tg_username=None, display_name=None)
    u = next(x for x in admin_core._find_users("", "all", 30, 0) if x["user_id"] == "tgu")
    assert u["label"] == "Telegram 42"


def test_search_by_name_and_username(sb):
    admin_core._NAME_SEARCH["ok"] = True
    _users(sb)
    assert [u["user_id"] for u in admin_core._find_users("@jasur", "all", 30, 0)] == ["tgu"]
    assert [u["user_id"] for u in admin_core._find_users("Jasur", "all", 30, 0)] == ["tgu"]
    assert [u["user_id"] for u in admin_core._find_users("g2@", "all", 30, 0)] == ["g2"]


def test_linked_and_tg_filters_work_with_many_links(sb):
    """Avval barcha ulangan ID'lar bitta «in.(…)» URL'ga yozilardi — ko'p foydalanuvchida filtr xato berardi."""
    _users(sb)
    sb.tables["tg_links"] += [{"tg_id": 1000 + i, "user_id": f"ghost-{i}", "email": f"x{i}@gmail.com"} for i in range(450)]
    calls = []
    Q = type(sb.table("user_usage"))
    orig = Q.in_

    def spy(self, col, vals):
        vals = list(vals)
        if self.table == "user_usage":
            calls.append(len(vals))
        return orig(self, col, vals)
    Q.in_ = spy
    try:
        assert [u["user_id"] for u in admin_core._find_users("", "linked", 30, 0)] == ["g2"]
        assert [u["user_id"] for u in admin_core._find_users("", "tg", 30, 0)] == ["tgu", "g2"]
    finally:
        Q.in_ = orig
    assert calls and max(calls) <= 100


# ------------------------------------------------------------------ admin kirishi (ulash shart emas)
def test_admin_panel_token_for_telegram_admin_without_google(sb, client, monkeypatch):
    monkeypatch.setenv("ADMIN_TG_IDS", "4242")
    monkeypatch.setenv("ADMIN_EMAILS", "")
    sb.tables["tg_links"] = []
    assert admin_core.check_admin_tg(4242)["ok"] is True
    tok = admin_core.make_token(4242, "")
    assert client.get(f"/_a/{tok}").status_code == 200
    r = client.post("/_a/api/ping", headers={"X-Admin-Token": tok}, json={})
    assert r.status_code == 200 and r.json()["actor"] == "tg4242"


def test_admin_entry_endpoint_for_google_admin_without_telegram(sb, client, monkeypatch):
    monkeypatch.setenv("ADMIN_TG_IDS", "")
    monkeypatch.setenv("ADMIN_EMAILS", "boss@gmail.com")
    sb.add_user("tok-boss", "u-boss", "boss@gmail.com")
    r = client.post("/api/me/admin-entry", json={"token": "tok-boss"})
    assert r.status_code == 200 and r.json()["url"].startswith("/_a/")
    tok = r.json()["url"].split("/_a/")[1]
    assert client.post("/_a/api/ping", headers={"X-Admin-Token": tok}, json={}).json()["actor"] == "g:boss@gmail.com"
    sb.add_user("tok-x", "u-x", "someone@gmail.com")
    assert client.post("/api/me/admin-entry", json={"token": "tok-x"}).status_code == 404


# ------------------------------------------------------------------ eng oxirgi taqdimot (bot + muharrir)
def test_latest_deck_endpoint_returns_only_own_newest(sb, client, monkeypatch):
    monkeypatch.setattr(tb, "ENABLED", True)
    monkeypatch.setattr(tb, "BOT_TOKEN", "123:TEST")
    sb.tables["tg_decks"] = [
        {"id": 1, "tg_id": 5551, "title": "Eski", "updated_at": _ago(10), "deck": {}},
        {"id": 2, "tg_id": 5551, "title": "Yangi", "updated_at": _ago(1), "deck": {}},
        {"id": 3, "tg_id": 9999, "title": "Begona", "updated_at": _ago(0), "deck": {}},
    ]
    r = client.post("/api/telegram/latest-deck", json={"init_data": _init_data()})
    d = r.json()["deck"]
    assert d["id"] == 2 and d["title"] == "Yangi" and d["updated_ms"] > 0
    assert tb._check_token("D", d["token"]) == (2, 5551)
    assert client.post("/api/telegram/latest-deck", json={"init_data": "fake"}).status_code == 401


def test_opening_saved_deck_makes_it_latest(sb, monkeypatch):
    sb.tables["tg_decks"] = [{"id": 5, "tg_id": 31, "title": "A", "updated_at": _ago(50), "deck": {}}]
    tb._deck_bump_sync(5, 31)
    assert sb.tables["tg_decks"][0]["updated_at"] > _ago(0.01)
    tb._deck_bump_sync(5, 32)                                     # begona tg_id — tegmaydi
    assert len(sb.tables["tg_decks"]) == 1


def test_restored_deck_is_not_changed_by_answer_key_rule():
    from backend import tg_decks as decks
    words = [{"answer": "ZEVS", "clue": "a"}, {"answer": "AFINA", "clue": "b"}, {"answer": "OLIMP", "clue": "c"}]
    raw = {"title": "X", "theme": "office", "slides": [{"layout": "title", "title": "X"},
                                                         {"layout": "crossword", "title": "K", "words": words}]}
    assert len(decks.normalize_deck(raw, 30, answer_keys=False)["slides"]) == 2
    assert len(decks.normalize_deck(raw, 30)["slides"]) == 3


def test_editor_never_saves_one_account_into_another():
    """js/30_v40_present_persist.js: qoralama egasi eslanadi; akkaunt almashayotganda (03_auth_project.js) saqlash yo'q."""
    src = open(os.path.join(ROOT, "js", "30_v40_present_persist.js"), encoding="utf-8").read()
    assert "ownerKey !== key && ownerKey !== draftKey('')" in src and "__ssAcctSwitch" in src
    auth = open(os.path.join(ROOT, "js", "03_auth_project.js"), encoding="utf-8").read()
    i = auth.index("window.__ssAcctSwitch = true")
    assert i < auth.index("location.reload()", i)


# ------------------------------------------------------------------ v81: yagona ulash, Mini App akkaunti, sayt — oxirgi taqdimot
def test_miniapp_account_follows_the_google_link(sb, client, monkeypatch):
    """Mini App har ochilishda so'raydi: Google ulangan bo'lsa — Google akkaunt bilan kirish kerak."""
    monkeypatch.setattr(tb, "ENABLED", True)
    monkeypatch.setattr(tb, "BOT_TOKEN", "123:TEST")
    sb.tables["tg_links"] = []
    r = client.post("/api/telegram/account", json={"init_data": _init_data()})
    assert r.json() == {"email": "tg5551@t.me", "linked": False}
    sb.tables["tg_links"] = [{"tg_id": 5551, "user_id": "g-1", "email": "Ali@Gmail.com"}]
    assert client.post("/api/telegram/account", json={"init_data": _init_data()}).json() == {"email": "ali@gmail.com", "linked": True}
    assert client.post("/api/telegram/account", json={"init_data": "fake"}).status_code == 401


def test_site_google_user_gets_the_bot_latest_deck(sb, client, monkeypatch):
    """Saytda Google bilan kirgan, Telegram'i ulangan foydalanuvchi — o'sha Telegram'ning oxirgi bot taqdimoti."""
    monkeypatch.setattr(tb, "ENABLED", True)
    sb.add_user("tok-g", "g-1", "ali@gmail.com")
    sb.add_user("tok-x", "x-1", "other@gmail.com")
    sb.tables["tg_links"] = [{"tg_id": 5551, "user_id": "g-1", "email": "ali@gmail.com"}]
    sb.tables["user_usage"] = [{"user_id": "g-1", "email": "ali@gmail.com"}, {"user_id": "x-1", "email": "other@gmail.com"}]
    sb.tables["tg_decks"] = [{"id": 7, "tg_id": 5551, "title": "Bot", "updated_at": _ago(1), "deck": {}},
                             {"id": 8, "tg_id": 6000, "title": "Begona", "updated_at": _ago(0), "deck": {}}]
    d = client.post("/api/telegram/latest-deck", json={"token": "tok-g"}).json()["deck"]
    assert d["id"] == 7 and tb._check_token("D", d["token"]) == (7, 5551)
    assert client.post("/api/telegram/latest-deck", json={"token": "tok-x"}).json() == {"deck": None}     # ulanmagan
    assert client.post("/api/telegram/latest-deck", json={"token": "bad"}).status_code == 401


def test_old_link_unlink_endpoints_and_buttons_are_back():
    """Avvalgi ishlagan ulash / uzish tizimi qaytarildi (sayt, Mini App, bot, Supabase tg_link_codes)."""
    import glob
    js = "".join(open(f, encoding="utf-8").read() for f in glob.glob(os.path.join(ROOT, "js", "*.js")))
    for need in ("window.ssTgLink", "window.ssGoogleLink", "/api/telegram/link-code", "/api/telegram/unlink", "/api/telegram/miniapp-link"):
        assert need in js, need
    paths = {getattr(r, "path", "") for r in tb.router.routes}
    for need in ("/api/telegram/link-code", "/api/telegram/link-status", "/api/telegram/unlink",
                 "/api/telegram/miniapp-link", "/api/telegram/link-complete", "/api/telegram/account"):
        assert need in paths, need
    sql = open(os.path.join(ROOT, "SUPABASE_SCHEMA.sql"), encoding="utf-8").read()
    assert "create table if not exists public.tg_link_codes" in sql


def test_presentation_sees_every_edit_and_reuses_loaded_media():
    """js/30_v40_present_persist.js: imzo — to'liq xesh (avval ~400 belgi tanlanib, kichik tahrir sezilmasdi);
    GIF/rasm muharrir xotirasidan (MediaRAM) beriladi — namoyish ularni qayta yuklamaydi."""
    src = open(os.path.join(ROOT, "js", "30_v40_present_persist.js"), encoding="utf-8").read()
    assert "Math.floor(n / 400)" not in src and "function jsonHash" in src
    assert "mediaFromRam(parsed)" in src and "R.peek(v)" in src


def test_schema_v78_backfill_survives_duplicate_telegram_rows():
    """SUPABASE_SCHEMA.sql: bitta Telegram ID uchun bir nechta eski qator bo'lsa — telegram_id FAQAT bittasiga yoziladi
    (avval hammasiga yozilib, unikal indeks yaratilmay fayl xato bilan to'xtardi). PostgreSQL 16 da qo'lda tekshirilgan."""
    sql = open(os.path.join(ROOT, "SUPABASE_SCHEMA.sql"), encoding="utf-8").read()
    i = sql.index("create unique index if not exists user_usage_telegram_id_uq")
    before = sql[:i]
    assert "select distinct on (s.tid)" in before[-1500:]
    assert "tg_decks_tg_updated_idx" in sql
    assert "c.relkind <> 'v'" in sql                    # public.users jadval bo'lsa — ko'rinish yaratilmaydi
