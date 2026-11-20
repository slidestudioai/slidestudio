"""A request body over MAX_REQUEST_BODY_BYTES is refused before it is read (no login needed to send one)."""
import main


def test_big_body_refused(client):
    big = b"x" * (main.MAX_REQUEST_BODY_BYTES + 1)
    r = client.post("/api/analyze-images", content=big, headers={"content-type": "application/json"})
    assert r.status_code == 413 and r.json()["code"] == "TOO_LARGE"


def test_normal_body_ok(client):
    r = client.post("/api/analyze-images", json={"images": []})
    assert r.status_code == 200


def test_ad_media_is_sandboxed(client, monkeypatch):
    import base64
    svg = base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').decode()
    monkeypatch.setattr(main.ads_mod, "get_row", lambda i: {"id": i, "active": True, "media_url": "data:image/svg+xml;base64," + svg})
    r = client.get("/api/ads/media/7")
    assert r.status_code == 200 and "sandbox" in r.headers.get("content-security-policy", "")
