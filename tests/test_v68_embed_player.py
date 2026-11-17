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
