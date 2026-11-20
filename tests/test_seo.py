"""SEO: Google Search Console verification, meta tags, structured data, robots.txt, sitemap.xml."""
import json
import re
import xml.etree.ElementTree as ET

import main

BASE = "https://slidestudio.example"


def _home(client, monkeypatch, base=BASE):
    monkeypatch.setenv("PUBLIC_BASE_URL", base)
    main._index_cache["sig"] = None
    r = client.get("/")
    assert r.status_code == 200
    return r


def test_google_verification_and_meta(client, monkeypatch):
    r = _home(client, monkeypatch)
    html = r.text
    head = html.split("</head>")[0]
    assert '<meta name="google-site-verification" content="faIm498mQA0y-NhL6pXWpqVHeNM6nTfn1pwpH7PDlk8" />' in head
    assert "<title>SlideStudio — AI bilan onlayn slayd va prezentatsiya yasash | AI Slide Maker</title>" in head
    assert 'name="description" content="SlideStudio (Slide Studio) yordamida sun&#39;iy intellekt (AI) orqali' in head
    kw = re.search(r'name="keywords" content="([^"]*)"', head).group(1)
    for w in ("SlideStudio", "Slide Studio", "SlideStudio AI", "slayd yasash", "AI bilan slayd yasash", "AI slayd",
              "taqdimot yasash", "prezentatsiya yasash", "AI slide maker", "AI presentation maker", "создать слайды с ИИ",
              "ИИ презентация", "сделать презентацию онлайн", "генератор презентаций", "create slides with AI"):
        assert w in kw, w
    assert 'name="robots" content="index, follow' in head
    assert f'<link rel="canonical" href="{BASE}/">' in head
    assert "noindex" not in head and "noindex" not in r.headers.get("x-robots-tag", "")


def test_structured_data_is_valid_json(client, monkeypatch):
    html = _home(client, monkeypatch).text
    ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S).group(1))
    assert ld["@type"] == "SoftwareApplication" and ld["name"] == "SlideStudio" and ld["url"] == BASE + "/"
    assert "Slide Studio" in ld["alternateName"]


def test_robots_txt(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", BASE)
    r = client.get("/robots.txt")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain")
    t = r.text
    assert "User-agent: *" in t and "Allow: /" in t
    for p in ("/api/", "/_a/", "/ws/"):
        assert f"Disallow: {p}" in t
    assert f"Sitemap: {BASE}/sitemap.xml" in t


def test_sitemap_xml(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", BASE)
    r = client.get("/sitemap.xml")
    assert r.status_code == 200 and "xml" in r.headers["content-type"]
    root = ET.fromstring(r.content)
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locs = [u.find("s:loc", ns).text for u in root.findall("s:url", ns)]
    assert locs[0] == BASE + "/"
    assert BASE + "/terms.html" in locs and BASE + "/privacy.html" in locs
    for u in root.findall("s:url", ns):
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", u.find("s:lastmod", ns).text)


def test_address_from_the_request_when_no_env(client, monkeypatch):
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    r = client.get("/robots.txt", headers={"host": "my.domain.uz", "x-forwarded-proto": "https"})
    assert "Sitemap: https://my.domain.uz/sitemap.xml" in r.text
    r = client.get("/robots.txt", headers={"host": "evil<x>"})        # a bad Host header is not echoed
    assert "evil" not in r.text
