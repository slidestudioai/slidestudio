"""Pictures given to the AI must really open: dead links are removed from search results, good ones go first."""
import asyncio
import time

import main


def test_dead_links_removed_slow_ones_kept_after_good(monkeypatch):
    monkeypatch.setattr(main, "SEARCH_VERIFY_IMAGES", True)
    monkeypatch.setattr(main, "SEARCH_VERIFY_WAIT", 0.5)
    monkeypatch.setattr(main, "_VERIFY_SEM", None)

    def fake_fetch(url):
        if "slow" in url:
            time.sleep(1.5)
        return {"error": "HTTP Error 404"} if "dead" in url else {"data": b"x", "content_type": "image/jpeg"}
    monkeypatch.setattr(main, "_fetch_image_sync", fake_fetch)
    res = [{"url": f"https://p.test/{n}.jpg"} for n in ("dead1", "slow1", "ok1", "dead2", "ok2", "ok3", "late7", "late8")]
    out = asyncio.run(main._verify_image_results(res, "photo"))
    assert [x["url"].rsplit("/", 1)[1] for x in out] == ["ok1.jpg", "ok2.jpg", "ok3.jpg", "slow1.jpg", "late7.jpg", "late8.jpg"]


def test_all_dead_gives_nothing_unknown_hosts_kept_gifs_not_checked(monkeypatch):
    monkeypatch.setattr(main, "SEARCH_VERIFY_IMAGES", True)
    monkeypatch.setattr(main, "_VERIFY_SEM", None)
    calls = []
    monkeypatch.setattr(main, "_fetch_image_sync", lambda u: calls.append(u) or {"error": "Rasm olinmadi: HTTP Error 500"})
    res = [{"url": "https://p.test/a.jpg"}, {"url": "https://p.test/b.jpg"}]
    assert asyncio.run(main._verify_image_results(res, "photo")) == []          # dead links never reach a slide
    # a host the proxy may not fetch (private / local) cannot be checked here -> kept
    monkeypatch.setattr(main, "_fetch_image_sync", lambda u: {"error": "Bu manzilga ruxsat yo'q"})
    assert asyncio.run(main._verify_image_results(res, "photo")) == res
    calls.clear()
    assert asyncio.run(main._verify_image_results(res, "gif")) == res and calls == []


def test_search_batch_uses_the_check(monkeypatch):
    monkeypatch.setattr(main, "SEARCH_VERIFY_IMAGES", True)
    monkeypatch.setattr(main, "_VERIFY_SEM", None)
    monkeypatch.setattr(main, "_search_images_sync", lambda q, k, n: [{"url": "https://p.test/dead.jpg"}, {"url": "https://p.test/ok.jpg"}])
    monkeypatch.setattr(main, "_fetch_image_sync", lambda u: {"error": "404"} if "dead" in u else {"data": b"x"})
    out = asyncio.run(main._search_batch(None, [("cat", "photo")], stagger=0))
    assert [x["url"] for x in out[0]] == ["https://p.test/ok.jpg"]


def test_all_dead_then_simpler_words_are_searched(monkeypatch):
    monkeypatch.setattr(main, "SEARCH_VERIFY_IMAGES", True)
    monkeypatch.setattr(main, "_VERIFY_SEM", None)
    asked = []

    def search(q, k, n):
        asked.append(q)
        return [{"url": f"https://p.test/{'dead' if len(asked) == 1 else 'ok'}-{len(asked)}.jpg"}]
    monkeypatch.setattr(main, "_search_images_sync", search)
    monkeypatch.setattr(main, "_fetch_image_sync", lambda u: {"error": "500"} if "dead" in u else {"data": b"x"})
    out = asyncio.run(main._search_batch(None, [("Menkes disease kinky hair infant", "photo")], stagger=0))
    assert len(asked) >= 2 and out[0] and "ok-" in out[0][0]["url"]


def test_no_loremflickr_fallback(monkeypatch):
    from backend import image_search as isr
    for name in ("_pexels", "_unsplash", "_pixabay", "_duckduckgo", "_openverse", "_wikimedia"):
        monkeypatch.setattr(isr, name, lambda q, n: [])
    assert isr.search_images("Menkes disease", "photo", 6) == []
