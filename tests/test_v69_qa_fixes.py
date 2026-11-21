"""v69 QA review: wrong-type input must give a clear 4xx, never a 500; errors must not leak exception text."""
import main


def test_create_checkout_non_text_token_is_401_not_500(sb, client):
    for body in ({"token": 123, "amount": 5}, {"token": ["a"], "amount": 5}, {"token": {"x": 1}}):
        r = client.post("/api/create-checkout", json=body)
        assert r.status_code == 401, (body, r.status_code)


def test_create_checkout_list_body_is_rejected_cleanly(sb, client):
    assert client.post("/api/create-checkout", json=[1, 2]).status_code in (400, 401, 422)


def test_media_search_error_does_not_leak_exception_text(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret-internal-detail /srv/key=abc")
    monkeypatch.setattr(main, "media_search_impl", boom)
    r = client.get("/api/media-search?q=cats")
    assert r.status_code == 200
    assert "secret-internal-detail" not in r.text
    assert r.json()["results"] == []
