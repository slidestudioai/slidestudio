"""v78: mustaqil Telegram akkaunti, Dodo to'lovi (telegram_id), bot va sayt uchun UMUMIY dizayn + krossvord yadrosi."""
import asyncio
import io
import json
import os
import shutil
import subprocess

import pytest

import main
from backend import telegram_bot as tb
from backend import tg_decks as decks
from backend.services import crossword as cw
from backend.services import design_system as ds
from tests_helpers_webhook import SECRET, _now_iso, _post

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CW_WORDS = [{"answer": "GERAKL", "clue": "Yarim xudo"}, {"answer": "ANUBIS", "clue": "Misr xudosi"},
            {"answer": "ZEUS", "clue": "Bosh xudo"}, {"answer": "ODIN", "clue": "Skandinav"},
            {"answer": "ATHENA", "clue": "Donolik"}, {"answer": "OSIRIS", "clue": "Narigi dunyo"},
            {"answer": "THOR", "clue": "Momaqaldiroq"}]
CW_UZ = [{"answer": "O'zbekiston", "clue": "1. Vatan"}, {"answer": "Toshkent", "clue": "Poytaxt"},
         {"answer": "Samarqand", "clue": "Qadimiy shahar"}, {"answer": "G'ijduvon", "clue": "Tuman"},
         {"answer": "Buxoro", "clue": "Shahar"}, {"answer": "Xiva", "clue": "Ichan qal'a"}]


# ------------------------------------------------------------------ 1) krossvord: sayt bilan 100% bir xil
def test_crossword_tokens_and_cleaning_like_site():
    assert cw.tokens("O'zbekiston") == ["O‘", "Z", "B", "E", "K", "I", "S", "T", "O", "N"]
    assert cw.tokens("g`ijduvon")[0] == "G‘"
    ws = cw.clean_words([{"answer": "Zevs", "clue": "3. Bosh xudo"}, "zevs", "A", {"word": "Afina"}])
    assert [w["answer"] for w in ws] == ["Zevs", "Afina"] and ws[0]["clue"] == "Bosh xudo"


def test_crossword_is_deterministic_and_numbered():
    a = cw.layout(CW_WORDS)
    b = cw.layout(list(reversed(CW_WORDS)))                       # tartib boshqacha — natija BIR XIL (saytdagi v73 qoidasi)
    assert a == b and not a["unplaced"] and len(a["words"]) == 7
    nums = [w["num"] for w in a["words"]]
    assert nums == sorted(nums) and nums[0] == 1
    starts = {(w["row"], w["col"]): w["num"] for w in a["words"]}
    for c in a["cells"]:
        assert c["n"] == starts.get((c["r"], c["c"]), 0)
    # har bir so'z kataklari to'rda to'g'ri harflar bilan turadi
    grid = {(c["r"], c["c"]): c["ch"] for c in a["cells"]}
    for w in a["words"]:
        t = cw.tokens(w["answer"])
        for k, ch in enumerate(t):
            pos = (w["row"], w["col"] + k) if w["dir"] == "across" else (w["row"] + k, w["col"])
            assert grid[pos] == ch


@pytest.mark.skipif(not shutil.which("node"), reason="node yo'q")
def test_crossword_matches_site_javascript_exactly(tmp_path):
    """js/56_crossword.js (tokens..layout) Node'da ishga tushiriladi va Python natijasi bilan solishtiriladi."""
    js = os.path.join(ROOT, "js", "56_crossword.js")
    lines = open(js, encoding="utf-8").read().split("\n")
    start = next(i for i, l in enumerate(lines) if "var MAX_WORDS" in l)
    end = next(i for i, l in enumerate(lines) if "3) ranglar" in l)
    script = tmp_path / "cw.js"
    script.write_text("const body = " + json.dumps("\n".join(lines[start:end])) + ";\n"
                      "const layout = new Function(body + '\\nreturn layout;')();\n"
                      "const cases = JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8'));\n"
                      "console.log(JSON.stringify(cases.map(c => layout(c))));\n", encoding="utf-8")
    cases = [CW_WORDS, CW_UZ, ["КОСМОС", "ЗВЕЗДА", "ПЛАНЕТА", "ЛУНА", "СОЛНЦЕ", "МАРС", "КОМЕТА", "ОРБИТА"],
             ["PYTHON", "JAVA", "RUST", "KOTLIN", "SWIFT", "GO", "HASKELL", "SCALA", "ELIXIR", "PERL", "RUBY", "LUA"]]
    data = tmp_path / "cases.json"
    data.write_text(json.dumps(cases), encoding="utf-8")
    out = subprocess.run(["node", str(script), str(data)], capture_output=True, text=True, timeout=60, check=True)
    assert json.loads(out.stdout) == [cw.layout(c) for c in cases]


# ------------------------------------------------------------------ 2) dizayn: saytdagi mavzular, kontrast
def test_site_themes_are_the_single_source():
    rows = ds.load_site_themes()
    assert len(rows) >= 30 and rows[0][0] == "clean"
    src = open(ds.SITE_THEMES_JS, encoding="utf-8").read()
    for r in rows:
        assert f"'{r[0]}'" in src and r[2] in src                 # id va fon rangi aynan saytdagi
    for k in ("tech", "academic", "spring", "midnight"):
        assert k in decks.THEMES                                   # bot rendereri ham ko'radi
    assert decks.THEMES["ocean"]["primary"] == "#1D4ED8"          # eski bot mavzusi o'zgarmadi (saqlangan slaydlar)


def test_every_theme_has_readable_text():
    for k, th in decks.THEMES.items():
        assert ds.contrast(th["text"], th["bg"]) >= 4.5, k
        assert ds.contrast(th.get("title") or th["primary"], th["bg"]) >= 4.5, k
        assert ds.contrast(th["text"], th["card"]) >= 3.0, k
        assert ds.contrast(th.get("on_primary", "#FFFFFF"), th["primary"]) >= 2.5, k
        assert ds.contrast("#FFFFFF", th["dark"]) >= 4.5, k        # titul / yakuniy slaydlar oq matn


def test_theme_follows_topic_and_user_choice():
    assert ds.pick_theme("Kosmos va galaktikalar") in ("space", "midnight")
    assert ds.pick_theme("Sun'iy intellekt kelajagi") in ("tech", "midnight", "ion")
    assert ds.pick_theme("Amir Temur tarixi") in ("retro", "academic", "coffee")
    assert ds.pick_theme("Kosmos", prefer="gold") == "gold"
    d = decks.normalize_deck({"title": "Ekologiya", "theme": "noma'lum", "slides": [{"layout": "title", "title": "Ekologiya"}]},
                             3, "Ekologiya va iqlim")
    assert d["theme"] in ("leaf", "mint", "facet")


# ------------------------------------------------------------------ 3) yangi maketlar + eksport
def _rich_deck(theme="tech"):
    raw = {"title": "Yunon mifologiyasi", "theme": theme, "slides": [
        {"layout": "title", "title": "Yunon mifologiyasi", "subtitle": "Mustaqil ish"},
        {"layout": "compare", "title": "Yunon va Rim", "left": {"heading": "Yunon", "bullets": ["Zevs", "Afina"]},
         "right": {"heading": "Rim", "bullets": ["Yupiter", "Minerva"]}},
        {"layout": "image", "title": "Olimp tog'i", "image": "mount olympus", "caption": "Xudolar maskani"},
        {"layout": "table", "title": "Xudolar", "rows": [["Xudo", "Soha"], ["Zevs", "Osmon"], ["Afina", "Donolik"]]},
        {"layout": "chart", "title": "Manbalar", "chart": "bar", "labels": ["A", "B"], "series": [{"values": [3, 5]}]},
        {"layout": "crossword", "title": "Krossvord", "words": CW_WORDS},
        {"layout": "closing", "title": "Rahmat"}]}
    return decks.normalize_deck(raw, 9, "Yunon mifologiyasi")


def test_crossword_answer_key_added_like_site():
    d = _rich_deck()
    lays = [s["layout"] for s in d["slides"]]
    assert lays == ["title", "compare", "image", "table", "chart", "crossword", "crossword", "closing"]
    q, a = d["slides"][5], d["slides"][6]
    assert q["show_clues"] and not q["show_answers"]
    assert a["show_answers"] and not a["show_clues"] and a["words"] == q["words"] and a["title"] == "Javoblar"
    # joy yo'q (n = slaydlar soni) — kalit qo'shilmaydi, javoblar ma'ruzachi izohida
    full = decks.normalize_deck({"title": "X", "slides": [{"layout": "title", "title": "X"},
                                                          {"layout": "crossword", "title": "K", "words": CW_WORDS}]}, 2)
    assert len(full["slides"]) == 2 and "GERAKL" in full["slides"][1]["notes"]


@pytest.mark.parametrize("theme", ["tech", "spring", "ocean"])
def test_all_layouts_export_in_every_format(theme):
    d = _rich_deck(theme)
    for fmt in ("pptx", "pdf", "html"):
        name, data, _mime = decks.export(d, {}, fmt)
        assert data and len(data) > 2000, (theme, fmt)
    from pptx import Presentation
    prs = Presentation(io.BytesIO(decks.export(d, {}, "pptx")[1]))
    texts = ["".join(r.text for p in sh.text_frame.paragraphs for r in p.runs)
             for sh in prs.slides[6].shapes if sh.has_text_frame]
    grid = cw.layout(CW_WORDS)
    letters = [t for t in texts if len(t) == 1 and t.isalpha()]
    assert len(letters) == len(grid["cells"])                     # javoblar slaydida har katakda harf
    assert any(t.startswith("ENIGA") for t in texts) and any("1. " in t for t in texts)   # javoblar ro'yxati (saytdagidek)
    assert any("Rim" in t for sh in prs.slides[1].shapes if sh.has_text_frame
               for t in [sh.text_frame.text])


def test_bot_prompt_knows_all_site_layouts_and_themes():
    for need in ('"layout":"crossword"', '"layout":"compare"', '"layout":"image"', "Javoblar", "mustaqil ish"):
        assert need in tb.GEN_SYSTEM
    assert "__THEMES__" not in tb.GEN_SYSTEM and "academic" in tb.GEN_SYSTEM and "academic" in tb.EDIT_SYSTEM


# ------------------------------------------------------------------ 4) akkaunt / UX
def test_no_google_gate_left_in_bot():
    src = open(os.path.join(ROOT, "backend", "telegram_bot.py"), encoding="utf-8").read()
    assert "_google_ok" not in src and "LINK_FIRST" not in src and '"linkinfo")]' not in src
    assert '"command": "link"' not in src


def test_provision_marks_telegram_account(sb):
    sb.tables.setdefault("user_usage", []).append({"user_id": "tg-uid-1", "email": "tg42@t.me", "free_credits": 200})
    tb._mark_tg_account_sync("tg-uid-1", 42)
    row = sb.tables["user_usage"][-1]
    assert row["telegram_id"] == 42 and row["auth_provider"] == "telegram"


def test_balance_screen_has_buy_for_telegram_account(monkeypatch):
    async def info(user):
        return {"free": 10, "paid": 0, "unlimited": False, "email": tb._tg_email(user["id"])}
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append((text, kb))
    monkeypatch.setattr(tb, "_balance_info", info)
    monkeypatch.setattr(tb, "_send", fake_send)
    asyncio.run(tb._show_balance(1, {"id": 1}))
    text, kb = sent[-1]
    assert "10" in text and "Google" not in text
    assert [b["callback_data"] for row in kb["inline_keyboard"] for b in row] == ["buy", "glink", "new"]   # v81: yagona ulash


def test_one_google_link_button_and_no_unlink(monkeypatch):
    """v81: «Google ulash» (eski tugma ham), /link — YAGONA ulash yo'li; uzish tugmalari / /unlink — balans / bosh menyu."""
    seen = []

    async def offer(cid, user):
        seen.append("offer")

    async def bal(cid, user):
        seen.append("bal")

    async def welcome(cid, user):
        seen.append("home")

    async def fake_tg(*a, **k):
        return True
    monkeypatch.setattr(tb, "_google_link_offer", offer)
    monkeypatch.setattr(tb, "_show_balance", bal)
    monkeypatch.setattr(tb, "_send_welcome", welcome)
    monkeypatch.setattr(tb, "tg", fake_tg)
    monkeypatch.setattr(tb, "_saved_lang", lambda tid: asyncio.sleep(0, "uz"))
    cb = lambda d: {"id": "q", "data": d, "from": {"id": 31}, "message": {"chat": {"id": 31}, "message_id": 1}}  # noqa: E731
    msg = lambda t, n: {"update_id": n, "message": {"chat": {"id": 31, "type": "private"}, "from": {"id": 31}, "text": t}}  # noqa: E731
    for d in ("glink", "linkinfo", "unl_yes"):
        tb._rl.pop(31, None)
        asyncio.run(tb._handle_callback(cb(d)))
    asyncio.run(tb.handle_update(msg("/link", 99031)))
    asyncio.run(tb.handle_update(msg("/unlink", 99032)))
    assert seen == ["offer", "offer", "bal", "offer", "home"]
    for name in ("_link_code_sync", "_link_consume_sync", "_do_link", "_unlink_sync", "_mark_link_used_sync"):
        assert not hasattr(tb, name), name


def test_google_link_offer_gives_site_link_or_shows_linked(monkeypatch):
    sent = []

    async def fake_send(cid, text, kb=None):
        sent.append((text, kb))
    monkeypatch.setattr(tb, "_send", fake_send)
    monkeypatch.setattr(tb, "SITE_URL", "https://s.example")
    monkeypatch.setattr(tb, "_linked_sync", lambda tid: None)
    asyncio.run(tb._google_link_offer(77, {"id": 77}))
    url = sent[-1][1]["inline_keyboard"][0][0]["url"]
    assert url.startswith("https://s.example/?tglink=") and tb._check_token("L", url.split("tglink=")[1]) == (77, 0)
    monkeypatch.setattr(tb, "_linked_sync", lambda tid: ("g-1", "ali@gmail.com"))
    asyncio.run(tb._google_link_offer(77, {"id": 77}))
    assert "ulangan" in sent[-1][0] and sent[-1][1] is None


def test_generation_sends_file_then_editor_card(monkeypatch):
    """v78: slayd tayyor — avval PPTX fayl, keyin «✏️ Muharrirda tahrirlash» tugmali karta."""
    order = []
    tb._chats.pop(4242, None)
    st = tb._state(4242)
    st.update(mode="fast")
    deck = _rich_deck("office")

    async def ensure(user):
        return ("u-42", "tg4242@t.me")

    async def ai_json(system, prompt, mode):
        return ({"title": deck["title"], "theme": "office", "images": False, "slides": deck["slides"]}, 100)

    async def fake_send(cid, text, kb=None):
        order.append(("send", text[:20], kb))
        return {"message_id": 5}

    async def fake_edit(cid, mid, text, kb=None):
        order.append(("edit", text[:20], kb))

    async def fake_files(cid, fmt, followup=True):
        order.append(("file", fmt, followup))
        return True

    async def charge(*a, **k):
        return ({"free_credits": 2000, "paid_credits": 0}, 8 * 20)

    async def noop(*a, **k):
        return None
    monkeypatch.setattr(tb, "_ensure_uid", ensure)
    monkeypatch.setattr(tb, "_usage_now_sync", lambda uid, email: {"free_credits": 4000, "paid_credits": 0, "email": email})
    monkeypatch.setattr(tb, "_ai_json", ai_json)
    monkeypatch.setattr(tb, "_send", fake_send)
    monkeypatch.setattr(tb, "_edit", fake_edit)
    monkeypatch.setattr(tb, "_send_files", fake_files)
    monkeypatch.setattr(tb, "_charge", charge)
    monkeypatch.setattr(tb, "_maybe_ad", noop)
    monkeypatch.setattr(tb, "tg", noop)
    monkeypatch.setattr(tb, "_spawn", lambda c: c.close() if hasattr(c, "close") else None)
    monkeypatch.setattr(tb, "_deck_insert_sync", lambda *a: 77)

    async def no_imgs(deck, have, enabled):
        return {}
    monkeypatch.setattr(tb, "_fetch_images", no_imgs)
    monkeypatch.setattr(tb, "_ensure_image_queries", lambda deck, topic: asyncio.sleep(0, 0))
    warns = []
    monkeypatch.setattr(tb, "_warn", lambda k, m: warns.append(m))
    monkeypatch.setattr(tb, "_deps", {**tb._deps, "total_credits": lambda u: 4000,
                                       "MODES": {"fast": {"page": 20, "chat": 1}, "deep": {"page": 60, "chat": 3}}})
    monkeypatch.setattr(tb, "_page_units", lambda mode, usage=None: 20)
    monkeypatch.setattr(tb, "AUTO_SEND_FMT", "pptx")
    asyncio.run(tb._run_generate(4242, {"id": 4242}, "Yunon mifologiyasi", 8))
    assert not warns, warns
    kinds = [o[0] for o in order]
    fi = kinds.index("file")
    assert order[fi][1:] == ("pptx", False)
    card = order[-1]
    assert card[0] == "send" and fi < len(order) - 1
    first_btn = card[2]["inline_keyboard"][0][0]
    assert first_btn["text"] == "✏️ Muharrirda tahrirlash" and "tgdeck=" in (first_btn.get("url") or first_btn["web_app"]["url"])
    assert st["deck_id"] == 77


# ------------------------------------------------------------------ 5) Dodo: telegram_id metadata va webhook
def test_checkout_metadata_has_telegram_id_and_no_internal_email(monkeypatch):
    seen = {}

    async def fake_req(method, path, api_key, base, body=None):
        seen["body"] = body
        return {"status": 200, "json": {"checkout_url": "https://pay.example/x", "session_id": "s1"}}
    monkeypatch.setenv("DODO_PAYMENTS_API_KEY", "k")
    monkeypatch.setenv("DODO_PRODUCT_ID", "p")
    monkeypatch.setattr(main, "_dodo_request", fake_req)
    res = asyncio.run(main._checkout_for_bot("uid-7", "tg7@t.me", "https://s.example", "pack", telegram_id=7))
    assert res["url"] == "https://pay.example/x"
    meta = seen["body"]["metadata"]
    assert meta["user_id"] == "uid-7" and meta["telegram_id"] == "7" and meta["source"] == "telegram"
    assert "customer" not in seen["body"]                          # Dodo to'lov oynasi emailni o'zi so'raydi
    asyncio.run(main._checkout_for_bot("uid-7", "real@mail.uz", "", "pack", telegram_id=7))
    assert seen["body"]["customer"]["email"] == "real@mail.uz"


@pytest.fixture()
def dodo(monkeypatch):
    monkeypatch.setenv("DODO_WEBHOOK_SECRET", SECRET)


def _tg_payment(client, payment_id, meta, email="buyer@mail.uz"):
    gross = main.topup_gross_cents(main.pack_pages())
    data = {"payload_type": "Payment", "payment_id": payment_id, "status": "succeeded", "total_amount": gross, "tax": 0,
            "currency": "USD", "metadata": meta, "customer": {"email": email, "customer_id": "cus_1"}}
    return _post(client, {"business_id": "bus_1", "type": "payment.succeeded", "timestamp": _now_iso(), "data": data})


def test_webhook_credits_telegram_account_by_telegram_id(sb, client, dodo):
    sb.tables.setdefault("user_usage", []).append({"user_id": "tg-acc-9", "email": "tg9@t.me", "telegram_id": 9,
                                                   "auth_provider": "telegram", "free_credits": 0, "paid_credits": 0,
                                                   "last_reset_time": _now_iso()})
    r = _tg_payment(client, "pay_tg_9", {"product": "pack", "telegram_id": "9"})
    assert r.status_code == 200 and r.json()["user_id"] == "tg-acc-9"
    row = sb.usage("tg-acc-9")
    assert row["paid_credits"] > 0
    assert row["contact_email"] == "buyer@mail.uz"                 # chek emaili keyingi to'lov uchun saqlandi
    assert row["email"] == "tg9@t.me"                              # login identifikatori o'zgarmaydi


def test_webhook_user_id_wins_over_telegram_id(sb, client, dodo):
    meta = dict(main.__dict__["_topup_quote"]("pack", main.pack_pages(), main.pack_pages()))
    signed = {"user_id": "tg-acc-10", "product": "pack", "package": meta["package"], "net_cents": str(meta["net_cents"]),
              "credits": str(meta["credits"]), "gross_cents": str(meta["gross_cents"]), "telegram_id": "999",
              "sig": main._topup_sig("tg-acc-10", meta["package"], meta["net_cents"], meta["credits"], meta["gross_cents"])}
    r = _tg_payment(client, "pay_tg_10", signed)
    assert r.status_code == 200 and r.json()["user_id"] == "tg-acc-10"
