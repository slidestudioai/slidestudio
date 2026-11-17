"""v68: yuklab olingan HTML (file://) ichidagi YouTube pleyeri — /embed-player sahifasi orqali (xato 153 bo'lmaydi)."""
import pytest

import main
from backend import tg_decks

pytestmark = pytest.mark.timeout(60)


def test_embed_player_youtube_can_be_framed_from_anywhere(client):
    r = client.get("/embed-player", params={"k": "youtube", "id": "dQw4w9WgXcQ", "au": 0, "mu": 0, "lp": 1, "st": 12})
    assert r.status_code == 200
    body = r.text
    assert 'src="https://www.youtube.com/embed/dQw4w9WgXcQ?' in body
    assert "autoplay=0" in body and "loop=1&playlist=dQw4w9WgXcQ" in body and "start=12" in body
    assert 'referrerpolicy="strict-origin-when-cross-origin"' in body
    csp = r.headers.get("content-security-policy", "")
    assert "frame-ancestors" not in csp          # file:// dan ochilgan HTML ichida ham ochilishi kerak
    assert "frame-src https://www.youtube.com" in csp
    assert "x-frame-options" not in {k.lower() for k in r.headers.keys()}


def test_embed_player_background_mode_and_vimeo(client):
    r = client.get("/embed-player", params={"k": "youtube", "id": "dQw4w9WgXcQ", "bg": 1, "au": 0})
    assert "autoplay=1" in r.text and "mute=1" in r.text and "controls=0" in r.text
    v = client.get("/embed-player", params={"k": "vimeo", "id": "76979871", "h": "abc123"})
    assert v.status_code == 200 and "player.vimeo.com/video/76979871?" in v.text and "&h=abc123" in v.text


@pytest.mark.parametrize("params", [
    {"k": "youtube", "id": "bad\"><script>"},
    {"k": "youtube", "id": ""},
    {"k": "evil", "id": "dQw4w9WgXcQ"},
    {"k": "vimeo", "id": "abc"},
])
def test_embed_player_rejects_bad_input(client, params):
    assert client.get("/embed-player", params=params).status_code == 400


def test_bot_html_uses_relay_when_site_url_known(monkeypatch):
    it = {"embed": {"kind": "youtube", "id": "dQw4w9WgXcQ"}}
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://slides.example.com/")
    html = tg_decks._html_embed(it, "")
    assert 'src="https://slides.example.com/embed-player?k=youtube&id=dQw4w9WgXcQ' in html
    monkeypatch.delenv("PUBLIC_BASE_URL")
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert 'src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"' in tg_decks._html_embed(it, "")


def test_prompt_lists_every_theme_and_free_action():
    """AI ko'rsatmasi dasturdagi HAR BIR mavzuni biladi; set_theme — bepul (balans yechilmaydi)."""
    import os
    import re
    from backend import monitoring
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    js = open(os.path.join(root, "js", "51_design_themes.js"), encoding="utf-8").read()
    ids = re.findall(r"^\s*\['([a-z_]+)', '", js, re.M)
    assert len(ids) >= 30
    prompt = main._read_default_system_prompt()
    assert '"action":"set_theme"' in prompt
    for i in ids:
        assert f'"{i}" (' in prompt, i
    assert "set_theme" in monitoring.FREE_ACTIONS


def test_prompt_has_no_contradictions_or_false_claims():
    """v68: prompt tozalandi — qarama-qarshi raqamlar, noto'g'ri da'volar va takrorlar qaytib kelmasin."""
    p = main._read_default_system_prompt()
    assert "use y >= 70 ALWAYS" not in p and "use y >= 100 ALWAYS" not in p      # sarlavha 40, kontent 140 (section 2)
    assert "1008" not in p                                                        # slayd kengligi 960
    assert "selectable text layer" not in p                                       # PDF sahifalari — rasm
    assert "wins on any conflict" not in p and "section 2 wins" not in p          # bitta RULE PRIORITY
    assert "RULE PRIORITY" in p
    assert "title 36–44" not in p                                                 # o'lchamlar faqat section 2 da
    assert 'default "Montserrat"' not in p and "Montserrat / Inter / Roboto by default" not in p   # PowerPoint-safe Arial
    assert "100% bilgan" not in p                                                 # YouTube ID ni o'ylab topmaslik
    assert '"height":56,"fill":"#2563eb"}' not in p                               # havola + fill qarama-qarshiligi
    assert p.count("STRICT CARD & PADDING ALIGNMENT RULE") == 0
