import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Optional, Tuple

HTTP_TIMEOUT = 9
CACHE_TTL = 600
MAX_GIF_BYTES = 6 * 1024 * 1024
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 SlideStudio/18"

_cache: Dict[Tuple, Tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_tenor_cursors: Dict[Tuple, str] = {}
_inflight: Dict[Tuple, threading.Lock] = {}
_pool = ThreadPoolExecutor(max_workers=8)

def _key(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v and v.strip():
            return v.strip()
    return ""

def _get_json(url: str, headers: Optional[Dict[str, str]] = None) -> Any:
    hdrs = {"User-Agent": UA, "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        raw = r.read(6 * 1024 * 1024)
    return json.loads(raw.decode("utf-8", "replace"))

def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="")

def _to_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0

def _pexels(q: str, per: int, page: int) -> List[dict]:
    key = _key("PEXELS_API_KEY")
    if not key:
        return []
    if q:
        url = f"https://api.pexels.com/v1/search?query={_q(q)}&per_page={per}&page={page}"
    else:
        url = f"https://api.pexels.com/v1/curated?per_page={per}&page={page}"
    data = _get_json(url, {"Authorization": key})
    out = []
    for p in data.get("photos") or []:
        src = p.get("src") or {}
        full = src.get("large") or src.get("original")
        if full:
            out.append({"url": full, "thumbnail": src.get("medium") or full, "is_gif": False, "source": "pexels"})
    return out

def _pixabay(q: str, per: int, page: int) -> List[dict]:
    key = _key("PIXABAY_API_KEY")
    if not key:
        return []
    per = max(3, min(per, 200))
    url = (f"https://pixabay.com/api/?key={_q(key)}&q={_q(q)}&image_type=photo"
           f"&per_page={per}&page={page}&safesearch=true")
    if not q:
        url += "&order=popular"
    data = _get_json(url)
    out = []
    for h in data.get("hits") or []:
        full = h.get("largeImageURL") or h.get("webformatURL")
        if full:
            out.append({"url": full, "thumbnail": h.get("webformatURL") or full, "is_gif": False, "source": "pixabay"})
    return out

def _unsplash(q: str, per: int, page: int) -> List[dict]:
    key = _key("UNSPLASH_ACCESS_KEY")
    if not key:
        return []
    hdr = {"Authorization": f"Client-ID {key}", "Accept-Version": "v1"}
    if q:
        data = _get_json(f"https://api.unsplash.com/search/photos?query={_q(q)}&per_page={per}&page={page}", hdr)
        items = data.get("results") or []
    else:
        items = _get_json(f"https://api.unsplash.com/photos?per_page={per}&page={page}", hdr) or []
    out = []
    for p in items:
        u = p.get("urls") or {}
        full = u.get("regular") or u.get("full")
        if full:
            out.append({"url": full, "thumbnail": u.get("small") or full, "is_gif": False, "source": "unsplash"})
    return out

def _openverse(q: str, per: int, page: int, gif_only: bool = False) -> List[dict]:
    url = (f"https://api.openverse.org/v1/images/?q={_q(q or 'nature')}&page_size={min(per, 20)}"
           f"&page={page}&license_type=commercial,modification")
    if gif_only:
        url += "&extension=gif"
    data = _get_json(url)
    out = []
    for r in data.get("results") or []:
        u = r.get("url")
        if not u:
            continue
        is_gif = str(u).lower().split("?")[0].endswith(".gif")
        if gif_only and not is_gif:
            continue
        out.append({"url": u, "thumbnail": r.get("thumbnail") or u, "is_gif": is_gif, "source": "openverse"})
    return out

def _wikimedia(q: str, per: int, page: int, gif_only: bool = False) -> List[dict]:
    term = (q or "nature") + (" filetype:gif" if gif_only else " filetype:bitmap")
    url = ("https://commons.wikimedia.org/w/api.php?action=query&generator=search"
           f"&gsrsearch={_q(term)}&gsrnamespace=6&gsrlimit={min(per, 50)}&gsroffset={(page - 1) * per}"
           "&prop=imageinfo&iiprop=url|mime&iiurlwidth=400&format=json")
    data = _get_json(url)
    pages = ((data.get("query") or {}).get("pages")) or {}
    out = []
    for p in sorted(pages.values(), key=lambda x: x.get("index", 0)):
        info = (p.get("imageinfo") or [{}])[0]
        full = info.get("url")
        if not full:
            continue
        is_gif = str(info.get("mime", "")).endswith("gif") or full.lower().endswith(".gif")
        if gif_only != is_gif:
            continue
        out.append({"url": full, "thumbnail": info.get("thumburl") or full, "is_gif": is_gif, "source": "wikimedia"})
    return out

def _pexels_videos(q: str, per: int, page: int) -> List[dict]:
    key = _key("PEXELS_API_KEY")
    if not key:
        return []
    per = max(3, min(per, 40))
    if q:
        url = f"https://api.pexels.com/videos/search?query={_q(q)}&per_page={per}&page={page}"
    else:
        url = f"https://api.pexels.com/videos/popular?per_page={per}&page={page}"
    data = _get_json(url, {"Authorization": key})
    out = []
    for v in data.get("videos") or []:
        files = [f for f in (v.get("video_files") or []) if str(f.get("file_type", "")).endswith("mp4") and f.get("link")]
        if not files:
            continue
        ok = [f for f in files if (f.get("width") or 0) <= 1280] or files
        best = max(ok, key=lambda f: f.get("width") or 0)
        out.append({"url": best["link"], "thumbnail": v.get("image") or "", "is_gif": False, "is_video": True,
                    "duration": v.get("duration") or 0, "width": best.get("width") or 0, "height": best.get("height") or 0,
                    "source": "pexels"})
    return out

def _pixabay_videos(q: str, per: int, page: int) -> List[dict]:
    key = _key("PIXABAY_API_KEY")
    if not key:
        return []
    per = max(3, min(per, 100))
    url = f"https://pixabay.com/api/videos/?key={_q(key)}&q={_q(q)}&per_page={per}&page={page}&safesearch=true"
    data = _get_json(url)
    out = []
    for h in data.get("hits") or []:
        vids = h.get("videos") or {}
        pick = vids.get("medium") or vids.get("small") or vids.get("large") or vids.get("tiny") or {}
        u = pick.get("url")
        if not u:
            continue
        pid = h.get("picture_id")
        thumb = f"https://i.vimeocdn.com/video/{pid}_640x360.jpg" if pid else ""
        out.append({"url": u, "thumbnail": thumb, "is_gif": False, "is_video": True, "duration": h.get("duration") or 0,
                    "width": pick.get("width") or 0, "height": pick.get("height") or 0, "source": "pixabay"})
    return out

def _wikimedia_videos(q: str, per: int, page: int) -> List[dict]:
    term = (q or "nature") + " filetype:video"
    url = ("https://commons.wikimedia.org/w/api.php?action=query&generator=search"
           f"&gsrsearch={_q(term)}&gsrnamespace=6&gsrlimit={min(per, 30)}&gsroffset={(page - 1) * per}"
           "&prop=imageinfo&iiprop=url|mime&iiurlwidth=480&format=json")
    data = _get_json(url)
    pages = ((data.get("query") or {}).get("pages")) or {}
    out = []
    for p in sorted(pages.values(), key=lambda x: x.get("index", 0)):
        info = (p.get("imageinfo") or [{}])[0]
        full = info.get("url")
        mime = str(info.get("mime", ""))
        if not full or not (mime.endswith("webm") or mime.endswith("mp4")):
            continue
        out.append({"url": full, "thumbnail": info.get("thumburl") or "", "is_gif": False, "is_video": True, "source": "wikimedia"})
    return out

def _youtube_search(q: str, per: int, page: int) -> List[dict]:
    """Kalitsiz YouTube qidiruv: natijalar sahifasidan videoId larni oladi, har birini oEmbed bilan tekshiradi."""
    import re
    url = "https://www.youtube.com/results?search_query=" + _q(q or "nature") + "&hl=en&gl=US"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9",
                                               "Cookie": "CONSENT=YES+1; SOCS=CAI"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        html = r.read(3 * 1024 * 1024).decode("utf-8", "replace")
    ids: List[str] = []
    for m in re.finditer(r'"videoId":"([\w-]{11})"', html):
        vid = m.group(1)
        if vid not in ids:
            ids.append(vid)
        if len(ids) >= max(per, 8) * 2:
            break
    start = (page - 1) * per
    ids = ids[start:start + per + 4]

    def check(vid: str) -> Optional[dict]:
        try:
            d = _get_json("https://www.youtube.com/oembed?format=json&url=" + _q("https://www.youtube.com/watch?v=" + vid))
        except Exception:
            return None   # joylashtirish taqiqlangan / mavjud emas
        return {"url": "https://www.youtube.com/watch?v=" + vid,
                "thumbnail": d.get("thumbnail_url") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "title": d.get("title") or "", "is_gif": False, "is_video": True, "source": "youtube"}
    futs = [_pool.submit(check, v) for v in ids]
    out = []
    for f in futs:
        try:
            r = f.result(timeout=HTTP_TIMEOUT + 3)
            if r:
                out.append(r)
        except Exception:
            pass
    return out[:per]

def check_youtube(vid: str) -> bool:
    """AI bergan YouTube ID haqiqatan mavjud va embed qilinadimi."""
    try:
        _get_json("https://www.youtube.com/oembed?format=json&url=" + _q("https://www.youtube.com/watch?v=" + vid))
        return True
    except Exception:
        return False

Provider = Tuple[str, Callable[[str, int, int], List[dict]]]

def _active(kind: str) -> List[Provider]:
    provs: List[Provider] = []
    if kind == "video":
        if _key("PEXELS_API_KEY"):
            provs.append(("pexels", _pexels_videos))
        if _key("PIXABAY_API_KEY"):
            provs.append(("pixabay", _pixabay_videos))
        return provs
    if _key("PEXELS_API_KEY"):
        provs.append(("pexels", _pexels))
    if _key("PIXABAY_API_KEY"):
        provs.append(("pixabay", _pixabay))
    if _key("UNSPLASH_ACCESS_KEY"):
        provs.append(("unsplash", _unsplash))
    return provs

def _fallbacks(kind: str) -> List[Provider]:
    if kind == "video":
        return [("youtube", _youtube_search), ("wikimedia", _wikimedia_videos)]
    return [("openverse", _openverse), ("wikimedia", _wikimedia)]

def _run(provs: List[Provider], q: str, per: int, page: int) -> Tuple[List[List[dict]], Dict[str, str], bool]:
    futures = [(name, _pool.submit(fn, q, per, page)) for name, fn in provs]
    lists: List[List[dict]] = []
    errors: Dict[str, str] = {}
    more = False
    for name, fut in futures:
        try:
            res = fut.result(timeout=HTTP_TIMEOUT + 4)
            lists.append(res)
            if len(res) >= per:
                more = True
        except Exception as e:
            errors[name] = str(e)[:160]
            print(f"[MEDIA] {name} xatosi: {e}")
    return lists, errors, more

def _interleave(lists: List[List[dict]]) -> List[dict]:
    seen = set()
    out: List[dict] = []
    for i in range(max((len(l) for l in lists), default=0)):
        for l in lists:
            if i < len(l):
                u = l[i]["url"]
                if u not in seen:
                    seen.add(u)
                    out.append(l[i])
    return out

def search(kind: str, q: str, limit: int = 24, page: int = 1) -> dict:
    kind = kind if kind in ("gif", "video") else "image"
    if kind == "gif":
        from backend.gif_search import search_gif  # v22: Tenor yopilgan → KLIPY/GIPHY
        return search_gif(q, limit, page)
    q = " ".join((q or "").split())[:120]
    limit = max(1, min(int(limit or 24), 60))
    page = max(1, int(page or 1))
    ck = (kind, q.lower(), limit, page)
    with _cache_lock:
        flight = _inflight.setdefault(ck, threading.Lock())
    with flight:
        now = time.time()
        with _cache_lock:
            hit = _cache.get(ck)
            if hit and now - hit[0] < CACHE_TTL:
                return hit[1]
        try:
            return _search_uncached(kind, q, limit, page, ck, now)
        finally:
            with _cache_lock:
                _inflight.pop(ck, None)

def _search_uncached(kind: str, q: str, limit: int, page: int, ck: Tuple, now: float) -> dict:

    errors: Dict[str, str] = {}
    results: List[dict] = []
    more = False
    used: List[str] = []
    per = max(6, min(limit, 40))
    act = list(_active(kind))
    chain: List[Provider] = (act[:1] if (page > 1 and act) else act + list(_fallbacks(kind)))
    for name, fn in chain:
        lists, err2, m = _run([(name, fn)], q, per, page)
        errors.update(err2)
        results = _interleave(lists)
        if results:
            used = [name]
            more = m
            break

    payload = {"results": results, "page": page, "provider": "+".join(used) or "none",
               "has_more": bool(results) and more, "errors": errors}
    if results:
        with _cache_lock:
            _cache[ck] = (now, payload)
            if len(_cache) > 400:
                for k in sorted(_cache, key=lambda x: _cache[x][0])[:100]:
                    _cache.pop(k, None)
    return payload

def first_gif_url(q: str) -> str:
    try:
        res = search("gif", q or "animation", limit=6, page=1)
        for r in res["results"]:
            if r.get("url", "").startswith("http"):
                return r["url"]
    except Exception as e:
        print(f"[MEDIA] first_gif_url: {e}")
    return ""
