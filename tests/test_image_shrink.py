"""Big search photos are resized on the server (max 1600 px) — the browser dropped 5000 px / 10 MB pictures."""
import io

from PIL import Image

import main
from backend.services import image_shrink


def _jpeg(w, h, noise=True):
    im = Image.effect_noise((w, h), 80).convert("RGB") if noise else Image.new("RGB", (w, h), (10, 20, 30))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=95)
    return b.getvalue()


def test_big_photo_is_resized():
    data = _jpeg(4000, 3000)
    out, ct = image_shrink.shrink(data, "image/jpeg")
    assert ct == "image/jpeg" and len(out) < len(data)
    assert max(Image.open(io.BytesIO(out)).size) == 1600
    assert Image.open(io.BytesIO(out)).size == (1600, 1200)          # aspect kept


def test_small_gif_and_broken_are_unchanged():
    small = _jpeg(800, 600)
    assert image_shrink.shrink(small, "image/jpeg") == (small, "image/jpeg")
    b = io.BytesIO()
    fr = [Image.new("RGB", (3000, 2000), c) for c in ((255, 0, 0), (0, 0, 255))]
    fr[0].save(b, "GIF", save_all=True, append_images=fr[1:])
    gif = b.getvalue() * 20
    assert image_shrink.shrink(gif, "image/gif") == (gif, "image/gif")
    junk = b"x" * (500 * 1024)
    assert image_shrink.shrink(junk, "image/png") == (junk, "image/png")


def test_transparent_png_stays_png():
    im = Image.effect_noise((3000, 2000), 80).convert("RGBA")
    b = io.BytesIO()
    im.save(b, "PNG")
    out, ct = image_shrink.shrink(b.getvalue(), "image/png")
    assert ct == "image/png" and Image.open(io.BytesIO(out)).mode == "RGBA"


def test_proxy_fetch_uses_it(monkeypatch):
    big = _jpeg(5000, 2500)
    monkeypatch.setattr(main, "_fetch_with_backoff", lambda u: {"data": big, "content_type": "image/jpeg", "final_url": u})
    res = main._fetch_image_sync("https://img.test/shrink-me.jpg")
    assert Image.open(io.BytesIO(res["data"])).size == (1600, 800)
