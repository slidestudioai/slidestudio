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
    assert "<title>SlideStudio</title>" in head          # v83: only the brand name (owner's choice)
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
    nodes = {n["@type"]: n for n in ld["@graph"]}
    app_ = nodes["SoftwareApplication"]
    assert app_["name"] == "SlideStudio" and app_["url"] == BASE + "/"
    assert "Slide Studio" in app_["alternateName"]
    # WebSite node -> the site name Google shows above the result (instead of "Render")
    site = nodes["WebSite"]
    assert site["name"] == "SlideStudio" and site["url"] == BASE + "/"
    assert set(site["alternateName"]) >= {"Slide Studio", "SlideStudio AI"}
    assert nodes["Organization"]["logo"]["url"] == BASE + "/icon-512.png"


def test_site_name_meta_and_seo_headings(client, monkeypatch):
    html = _home(client, monkeypatch).text
    head, body = html.split("</head>", 1)
    assert '<meta property="og:site_name" content="SlideStudio">' in head
    assert '<meta name="application-name" content="SlideStudio">' in head
    h1 = re.findall(r"<h1>(.*?)</h1>", body)
    assert len(h1) == 1 and "SlideStudio" in h1[0] and "AI yordamida slayd yasash" in h1[0]
    assert "online taqdimot yasash" in h1[0].lower()
    assert "Avtomatik prezentatsiya tayyorlash" in body
    assert 'href="/about.html"' in body


def test_favicons_linked_and_served(client, monkeypatch):
    from PIL import Image
    import io
    head = _home(client, monkeypatch).text.split("</head>")[0]
    for tag in ('<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">',
                '<link rel="shortcut icon" href="/favicon.ico">',
                '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
                '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
                '<link rel="manifest" href="/manifest.json">'):
        assert tag in head, tag
    # Google needs a square icon of at least 48x48 (a multiple of 48)
    for path, size in (("/favicon-96x96.png", 96), ("/favicon-48x48.png", 48), ("/apple-touch-icon.png", 180),
                       ("/icon-192.png", 192), ("/icon-512.png", 512)):
        r = client.get(path)
        assert r.status_code == 200 and r.headers["content-type"] == "image/png", path
        assert Image.open(io.BytesIO(r.content)).size == (size, size), path
    r = client.get("/favicon.ico")
    assert r.status_code == 200
    assert (48, 48) in Image.open(io.BytesIO(r.content)).ico.sizes()
    r = client.get("/favicon.svg")
    assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
    for path in ("/favicon-96x96.png", "/favicon.ico", "/", "/robots.txt", "/sitemap.xml", "/about.html"):
        assert client.head(path).status_code == 200, path          # crawlers often check with HEAD first
    m = client.get("/manifest.json").json()
    assert m["short_name"] == "SlideStudio" and any(i["sizes"] == "512x512" for i in m["icons"])


def test_robots_does_not_block_icons_or_pages(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", BASE)
    rules = [l.split(":", 1)[1].strip() for l in client.get("/robots.txt").text.splitlines() if l.startswith("Disallow:")]
    for p in ("/favicon.ico", "/favicon-96x96.png", "/favicon.svg", "/apple-touch-icon.png", "/icon-512.png",
              "/manifest.json", "/og-image.png", "/about.html", "/", "/js/i18n.js", "/styles.css"):
        assert not any(r and p.startswith(r) for r in rules), p


def test_about_page_with_faq(client, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", BASE)
    r = client.get("/about.html")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    html = r.text
    assert "__SS_BASE__" not in html
    assert f'<link rel="canonical" href="{BASE}/about.html">' in html
    assert len(re.findall(r"<h1>", html)) == 1
    ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S).group(1))
    assert ld["@type"] == "FAQPage" and len(ld["mainEntity"]) >= 4
    for q in ld["mainEntity"]:          # FAQ rich results: every question/answer must be VISIBLE on the page
        assert q["@type"] == "Question" and f"<summary>{q['name']}</summary>" in html
        assert q["acceptedAnswer"]["text"] in html
    assert client.get("/about", follow_redirects=False).headers["location"] == "/about.html"


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
    assert BASE + "/terms.html" in locs and BASE + "/privacy.html" in locs and BASE + "/about.html" in locs
    for loc in locs:                     # every sitemap URL really opens
        assert client.get(loc.replace(BASE, "")).status_code == 200, loc
    for u in root.findall("s:url", ns):
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", u.find("s:lastmod", ns).text)


def test_address_from_the_request_when_no_env(client, monkeypatch):
    monkeypatch.delenv("PUBLIC_BASE_URL", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    r = client.get("/robots.txt", headers={"host": "my.domain.uz", "x-forwarded-proto": "https"})
    assert "Sitemap: https://my.domain.uz/sitemap.xml" in r.text
    r = client.get("/robots.txt", headers={"host": "evil<x>"})        # a bad Host header is not echoed
    assert "evil" not in r.text
