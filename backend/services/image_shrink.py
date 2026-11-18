"""Big photos are made smaller before they go to the browser.

A slide is 960x540 px, but search results (Wikimedia, Pexels originals...) are often 4000-6000 px and 5-15 MB.
The browser got them as a base64 data URL: slow to download, slow to decode (the image was dropped after 6 s),
and heavy in the saved deck. Here a still photo larger than MAX_SIDE is resized and saved again as JPEG (or PNG
when it has transparency). GIF / SVG / WebP animations and small files are returned unchanged.
"""
import io

MAX_SIDE = 1600
MIN_BYTES = 350 * 1024          # smaller files are not worth the CPU


def shrink(data: bytes, content_type: str):
    """Returns (data, content_type). Never raises: on any problem the original is returned."""
    ct = (content_type or "").lower()
    if not data or len(data) < MIN_BYTES or not ct.startswith("image/"):
        return data, content_type
    if any(k in ct for k in ("gif", "svg", "icon")):
        return data, content_type
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(data))
        if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
            return data, content_type
        w, h = im.size
        if max(w, h) <= MAX_SIDE:
            return data, content_type
        im = ImageOps.exif_transpose(im)
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
        out = io.BytesIO()
        if alpha:
            im.convert("RGBA").save(out, "PNG", optimize=True)
            new_ct = "image/png"
        else:
            im.convert("RGB").save(out, "JPEG", quality=85, optimize=True, progressive=True)
            new_ct = "image/jpeg"
        new = out.getvalue()
        if len(new) >= len(data):
            return data, content_type
        return new, new_ct
    except Exception:
        return data, content_type
