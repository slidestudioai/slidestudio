"""Link preview (Telegram, WhatsApp, …): professional English title / description and an absolute preview image."""
import re

import main


def _page(client, monkeypatch, base):
    if base is None:
        monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
        monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    else:
        monkeypatch.setenv("PUBLIC_BASE_URL", base)
    main._index_cache["sig"] = None
    return client.get("/").text


def test_preview_tags_are_english_and_absolute(client, monkeypatch):
    html = _page(client, monkeypatch, "https://slidestudio.example")
    meta = dict(re.findall(r'<meta (?:property|name)="((?:og|twitter):[\w:]+)" content="([^"]*)"', html))
    assert meta["og:title"] == "SlideStudio — AI Presentation Maker"
    assert meta["og:description"].startswith("Describe your topic")
    assert meta["og:image"] == "https://slidestudio.example/og-image.png"
    assert meta["twitter:card"] == "summary_large_image"
    desc = re.search(r'<meta name="description" content="([^"]*)"', html).group(1)
    assert desc.startswith("SlideStudio (Slide Studio) yordamida")          # Google: Uzbek; link previews (og) stay English
    assert "__SS_BASE__" not in html


def test_bad_base_url_is_not_injected(client, monkeypatch):
    html = _page(client, monkeypatch, 'https://x.example"><script>alert(1)</script>')
    assert "<script>alert(1)" not in html and 'content="/og-image.png"' in html


def test_preview_image_is_served(client):
    r = client.get("/og-image.png")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n"
