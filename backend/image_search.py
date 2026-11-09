"""
backend/image_search.py — AI uchun internetdan rasm / GIF qidirish ("search_images" tool).

Manbalar (kalit bo'lsa ustuvor, bo'lmasa ochiq manbalar):
  PEXELS_API_KEY, PIXABAY_API_KEY, UNSPLASH_ACCESS_KEY  → yuqori sifatli stok foto
  Openverse + Wikimedia Commons                          → kalitsiz zaxira
  Tenor (TENOR_API_KEY)                                  → GIF
Natija: [{"url","thumb","title","width","height","source"}] — to'g'ridan-to'g'ri rasm havolalari.
"""
import json
import os
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List

_UA = {"User-Agent": "SlideStudio/1.0 (image search)", "Accept": "application/json"}
_BAD_EXT = re.compile(r"\.(svg|tiff?|bmp|ico|pdf|webm|mp4)(\?|#|$)", re.I)
_BAD_WORDS = re.compile(r"\b(logo|icon|watermark|stock photo preview|shutterstock|alamy|dreamstime|istock)\b", re.I)

def _get_json(url: str, headers: Dict[str, str] = None, timeout: float = 8.0):
    req = urllib.request.Request(url, headers={**_UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(2_000_000).decode("utf-8", "replace"))

def _words(q: str) -> List[str]:
    return [w for w in re.findall(r"[a-zA-Z0-9]{3,}", (q or "").lower())]

def _score(item: Dict[str, Any], qwords: List[str]) -> float:
    text = " ".join(str(item.get(k) or "") for k in ("title", "tags", "url")).lower()
    hit = sum(1 for w in qwords if w in text)
    s = hit / max(1, len(qwords))
    w, h = int(item.get("width") or 0), int(item.get("height") or 0)
    if w and h:
        if w >= 1200:
            s += 0.35
        elif w >= 800:
            s += 0.2
        elif w < 500:
            s -= 0.4
        ratio = w / h
        if 1.2 <= ratio <= 2.1:
            s += 0.2
    if item.get("source") in ("pexels", "unsplash", "pixabay"):
        s += 0.25
    return s

def _pexels(q: str, n: int) -> List[dict]:
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if not key:
        return []
    d = _get_json(f"https://api.pexels.com/v1/search?query={urllib.parse.quote(q)}&per_page={n}&orientation=landscape",
                  {"Authorization": key})
    return [{"url": p["src"].get("large2x") or p["src"].get("large") or p["src"]["original"],
             "thumb": p["src"].get("medium"), "title": p.get("alt") or q, "width": p.get("width"),
             "height": p.get("height"), "source": "pexels"} for p in (d.get("photos") or [])]

def _unsplash(q: str, n: int) -> List[dict]:
    key = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
    if not key:
        return []
    d = _get_json(f"https://api.unsplash.com/search/photos?query={urllib.parse.quote(q)}&per_page={n}&orientation=landscape",
                  {"Authorization": f"Client-ID {key}"})
    out = []
    for p in (d.get("results") or []):
        u = (p.get("urls") or {})
        out.append({"url": (u.get("regular") or u.get("full")), "thumb": u.get("small"),
                    "title": p.get("alt_description") or p.get("description") or q,
                    "width": p.get("width"), "height": p.get("height"), "source": "unsplash"})
    return out

def _pixabay(q: str, n: int) -> List[dict]:
    key = os.environ.get("PIXABAY_API_KEY", "").strip()
    if not key:
        return []
    d = _get_json(f"https://pixabay.com/api/?key={key}&q={urllib.parse.quote(q)}&image_type=photo&orientation=horizontal"
                  f"&per_page={max(3, n)}&safesearch=true")
    return [{"url": p.get("largeImageURL") or p.get("webformatURL"), "thumb": p.get("previewURL"),
             "title": p.get("tags") or q, "tags": p.get("tags"), "width": p.get("imageWidth"),
             "height": p.get("imageHeight"), "source": "pixabay"} for p in (d.get("hits") or [])]

def _openverse(q: str, n: int) -> List[dict]:
    d = _get_json(f"https://api.openverse.org/v1/images/?q={urllib.parse.quote(q)}&page_size={n}"
                  f"&license_type=commercial&aspect_ratio=wide&mature=false")
    out = []
    for r in (d.get("results") or []):
        if r.get("url"):
            out.append({"url": r["url"], "thumb": r.get("thumbnail"), "title": r.get("title") or q,
                        "tags": " ".join(t.get("name", "") for t in (r.get("tags") or [])[:8]),
                        "width": r.get("width"), "height": r.get("height"), "source": "openverse"})
    return out

def _wikimedia(q: str, n: int) -> List[dict]:
    d = _get_json("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6"
                  f"&gsrsearch={urllib.parse.quote(q + ' filetype:bitmap')}&gsrlimit={n}"
                  "&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=1280&format=json")
    out = []
    for p in ((d.get("query") or {}).get("pages") or {}).values():
        info = (p.get("imageinfo") or [{}])[0]
        mime = info.get("mime") or ""
        if mime not in ("image/jpeg", "image/png", "image/webp"):
            continue
        out.append({"url": info.get("thumburl") or info.get("url"), "thumb": info.get("thumburl"),
                    "title": re.sub(r"^File:|\.\w+$", "", p.get("title") or q),
                    "width": info.get("thumbwidth") or info.get("width"),
                    "height": info.get("thumbheight") or info.get("height"), "source": "wikimedia"})
    return out

def _tenor(q: str, n: int) -> List[dict]:
    key = os.environ.get("TENOR_API_KEY", "").strip() or "LIVDSRZULELA"
    out = []

    try:

        d = _get_json(f"https://tenor.googleapis.com/v2/search?q={urllib.parse.quote(q)}&key={key}&limit={max(n, 12)}"
                      "&media_filter=gif,tinygif&contentfilter=medium")
        for r in (d.get("results") or []):
            mf = r.get("media_formats") or {}
            g = (mf.get("gif") or {})
            if g.get("url"):
                dims = g.get("dims") or [0, 0]
                out.append({"url": g["url"], "thumb": (mf.get("tinygif") or {}).get("url"),
                            "title": r.get("content_description") or r.get("title") or q,
                            "width": dims[0], "height": dims[1], "source": "tenor"})
    except Exception as e:
        print(f"[IMG-SEARCH] tenor v2: {str(e)[:100]}")
    if out:
        return out

    try:
        d = _get_json(f"https://g.tenor.com/v1/search?q={urllib.parse.quote(q)}&key={key}&limit={n}&media_filter=minimal")
        for r in (d.get("results") or []):
            media = r.get("media") or []
            if not media:
                continue
            m0 = media[0] if isinstance(media, list) else media
            gif = ((m0.get("gif") or {}).get("url")
                   or (m0.get("tinygif") or {}).get("url")
                   or (m0.get("mediumgif") or {}).get("url"))
            if gif:
                out.append({"url": gif, "thumb": gif, "title": r.get("title") or q,
                            "width": 0, "height": 0, "source": "tenor_v1"})
    except Exception as e:
        print(f"[IMG-SEARCH] tenor v1: {str(e)[:100]}")
    return out

def _giphy(q: str, n: int) -> List[dict]:
    key = os.environ.get("GIPHY_API_KEY", "").strip() or "dc6zaTOxFJmzC"
    out = []
    try:
        d = _get_json(f"https://api.giphy.com/v1/gifs/search?api_key={key}"
                      f"&q={urllib.parse.quote(q)}&limit={n}&rating=g")
        items = d.get("data") if isinstance(d.get("data"), list) else []
        for r in items:
            imgs = (r.get("images") or {})
            gif = ((imgs.get("original") or {}).get("url")
                   or (imgs.get("downsized") or {}).get("url")
                   or (imgs.get("fixed_height") or {}).get("url"))
            if gif:
                out.append({"url": gif, "thumb": (imgs.get("fixed_height_small") or {}).get("url") or gif,
                            "title": r.get("title") or q, "width": 0, "height": 0, "source": "giphy"})
    except Exception as e:
        print(f"[IMG-SEARCH] giphy: {str(e)[:100]}")
    return out

def _wikimedia_gif(q: str, n: int) -> List[dict]:
    out = []
    try:
        d = _get_json("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6"
                      f"&gsrsearch={urllib.parse.quote(q + ' filetype:gif')}&gsrlimit={n}"
                      "&prop=imageinfo&iiprop=url|size|mime&iiurlwidth=400&format=json")
        for p in ((d.get("query") or {}).get("pages") or {}).values():
            info = (p.get("imageinfo") or [{}])[0]
            u = info.get("url") or info.get("thumburl")
            if u and str(u).lower().split("?")[0].endswith(".gif"):
                out.append({"url": u, "thumb": info.get("thumburl") or u,
                            "title": re.sub(r"^File:|\.\w+$", "", p.get("title") or q),
                            "width": info.get("width") or 0, "height": info.get("height") or 0,
                            "source": "wikimedia"})
    except Exception as e:
        print(f"[IMG-SEARCH] wikimedia gif: {str(e)[:100]}")
    return out

_GIF_SAFE_POOL = [
    "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif",
    "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    "https://media.giphy.com/media/26BRv0ThxKQihlNO0/giphy.gif",
    "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif",
    "https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif",
    "https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif",
    "https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif",
    "https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif",
    "https://media.giphy.com/media/3o6Zt6ML6BklmajxsI/giphy.gif",
    "https://media.giphy.com/media/l0HlNQ03J5JxX6lva/giphy.gif",
]

def _gif_safe_pool(q: str, n: int) -> List[dict]:
    """API ishlamasa ham har doim natija."""
    import hashlib
    h = int(hashlib.md5((q or "x").encode()).hexdigest()[:8], 16)
    pool = list(_GIF_SAFE_POOL)

    start = h % len(pool)
    rotated = pool[start:] + pool[:start]
    out = []
    for i, u in enumerate(rotated[:max(n, 4)]):
        out.append({"url": u, "thumb": u, "title": f"gif:{q or 'animation'}",
                    "width": 480, "height": 270, "source": "safe_pool"})
    return out

def _duckduckgo(q: str, n: int) -> List[dict]:
    """Kalitsiz rasm qidiruv (DuckDuckGo Instant Answer / i.js)."""
    out = []
    try:

        req = urllib.request.Request(
            f"https://duckduckgo.com/?q={urllib.parse.quote(q)}&iax=images&ia=images",
            headers={**_UA, "Accept": "text/html"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            html = r.read(400_000).decode("utf-8", "replace")
        m = re.search(r"vqd=['\"]([^'\"]+)['\"]", html)
        vqd = m.group(1) if m else ""
        if not vqd:
            return out
        url = (
            "https://duckduckgo.com/i.js?"
            + urllib.parse.urlencode({"l": "us-en", "o": "json", "q": q, "vqd": vqd, "f": ",,,,,", "p": "1"})
        )
        d = _get_json(url, timeout=10.0)
        for r in (d.get("results") or [])[: max(n, 8)]:
            u = r.get("image") or r.get("url")
            if not u or not str(u).startswith("http"):
                continue
            if _BAD_EXT.search(u):
                continue
            out.append({
                "url": u,
                "thumb": r.get("thumbnail") or u,
                "title": r.get("title") or q,
                "width": r.get("width") or 0,
                "height": r.get("height") or 0,
                "source": "duckduckgo",
            })
    except Exception as e:
        print(f"[IMG-SEARCH] duckduckgo: {str(e)[:100]}")
    return out

def _loremflickr(q: str, n: int) -> List[dict]:
    """Zaxira: mavzuga yaqin stok (loremflickr taglari)."""
    tags = re.sub(r"[^a-zA-Z0-9,\s]", "", q or "nature").strip().replace(" ", ",")[:60] or "nature"
    out = []
    for i in range(max(n, 4)):

        u = f"https://loremflickr.com/1280/720/{urllib.parse.quote(tags)}?lock={i + 1}"
        out.append({"url": u, "thumb": u, "title": q or tags, "width": 1280, "height": 720, "source": "loremflickr"})
    return out

def search_images(query: str, kind: str = "photo", limit: int = 12) -> List[dict]:
    """Sinxron (asyncio.to_thread ichida chaqiring). Eng mos `limit` ta natija.
    GIF uchun: Tenor → Giphy → Wikimedia → SAFE POOL (hech qachon bo'sh emas).
    """
    query = re.sub(r"\s+", " ", (query or "").strip())[:120]
    if not query:
        query = "animation" if kind == "gif" else "nature"
    limit = max(1, min(int(limit or 12), 16))

    if kind == "video":
        try:
            from backend.media_search import search as _ms_search
            res = _ms_search("video", query, limit=limit, page=1).get("results", [])
        except Exception as e:
            print(f"[IMG-SEARCH] video: {str(e)[:100]}")
            res = []
        return [{"url": r["url"], "thumb": r.get("thumbnail") or "", "title": query,
                 "width": r.get("width", 0), "height": r.get("height", 0), "source": r.get("source", "video")}
                for r in res if r.get("url")][:limit]

    if kind == "gif":
        pool: List[dict] = []
        try:  # v22: KLIPY + GIPHY (Tenor yopilgan)
            from backend.gif_search import search_gif
            for r in search_gif(query, limit=max(limit, 12), page=1).get("results", []):
                pool.append({"url": r["url"], "thumb": r.get("thumbnail") or r["url"], "title": query,
                             "width": r.get("width", 0), "height": r.get("height", 0), "source": r.get("source", "gif")})
        except Exception as e:
            print(f"[IMG-SEARCH] gif_search: {str(e)[:100]}")

        for fn in ((_giphy, _wikimedia_gif) if len(pool) < limit else ()):
            try:
                pool.extend(fn(query, 12))
            except Exception as e:
                print(f"[IMG-SEARCH] {fn.__name__}: {str(e)[:100]}")
            if len(pool) >= limit:
                break

        if len(pool) < 2:
            words = query.split()
            short = " ".join(words[:2]) if len(words) > 1 else (words[0] if words else "funny")
            if short.lower() != query.lower():
                for fn in (_giphy,):
                    try:
                        pool.extend(fn(short, 8))
                    except Exception:
                        pass
                    if len(pool) >= limit:
                        break

        if len(pool) < 2:
            for alt in ("funny", "animation", "happy", "nature", "loop"):
                try:
                    pool.extend(_giphy(alt, 6))
                except Exception:
                    pass
                if len(pool) >= limit:
                    break

        if not pool:
            pool = _gif_safe_pool(query, limit)
        else:

            if len(pool) < limit:
                pool.extend(_gif_safe_pool(query, limit - len(pool)))

        seen, clean = set(), []
        for it in pool:
            u = it.get("url")
            if not u or not str(u).startswith("https://") or u in seen:
                continue
            seen.add(u)
            clean.append(it)

        if not clean:
            clean = _gif_safe_pool(query, limit)
        return [{k: v for k, v in it.items() if k in ("url", "thumb", "title", "width", "height", "source")}
                for it in clean[:limit]]

    providers = [_pexels, _unsplash, _pixabay, _duckduckgo, _openverse, _wikimedia]
    pool = []
    for fn in providers:
        try:
            pool.extend(fn(query, max(12, limit)))
        except Exception as e:
            print(f"[IMG-SEARCH] {fn.__name__}: {str(e)[:100]}")

        if len([p for p in pool if p.get("source") in ("pexels", "unsplash", "pixabay")]) >= limit:
            break
        if len(pool) >= limit * 2:
            break

    if len(pool) < 3:
        try:
            pool.extend(_loremflickr(query, max(limit, 6)))
        except Exception as e:
            print(f"[IMG-SEARCH] loremflickr: {str(e)[:100]}")
    qw = _words(query)
    seen, clean = set(), []
    for it in pool:
        u = it.get("url")
        if not u or not str(u).startswith("http") or u in seen:
            continue
        if _BAD_EXT.search(u) or _BAD_WORDS.search(str(it.get("title") or "")):
            continue
        seen.add(u)
        it["score"] = round(_score(it, qw), 3)
        clean.append(it)
    clean.sort(key=lambda x: x["score"], reverse=True)

    if len(clean) < max(3, limit // 2):
        words = query.split()
        short = " ".join(words[:2]) if len(words) > 1 else query
        if short.lower() != query.lower():
            for fn in (_pexels, _unsplash, _pixabay, _duckduckgo, _openverse):
                try:
                    for it in fn(short, 8):
                        u = it.get("url")
                        if not u or u in seen or not str(u).startswith("http"):
                            continue
                        if _BAD_EXT.search(u):
                            continue
                        seen.add(u)
                        it["score"] = round(_score(it, _words(short)), 3)
                        clean.append(it)
                except Exception:
                    pass
            clean.sort(key=lambda x: x["score"], reverse=True)
    if not clean:
        clean = _loremflickr(query, limit)
    return [{k: v for k, v in it.items() if k in ("url", "thumb", "title", "width", "height", "source")}
            for it in clean[:limit]]
