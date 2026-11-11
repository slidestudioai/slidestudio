"""GIF qidiruv va tavsiya moduli (v22).

MUHIM: Google Tenor API 2026-yil 30-iyunda butunlay yopilgan (yangi kalitlar 13-yanvardan
berilmagan). Shuning uchun Tenor butunlay olib tashlandi. Yangi manbalar:

  1. KLIPY  (KLIPY_API_KEY)  — bepul, Tenor'ga eng yaqin API
  2. GIPHY  (GIPHY_API_KEY)  — eng katta kutubxona
  3. Zaxira (kalit shart emas): GIPHY public-beta, Openverse, Wikimedia — faqat asosiy
     manbalar kam natija bersa yoki kalit umuman yo'q bo'lsa ishga tushadi.

Barcha manbalar PARALLEL so'raladi va natijalar aralashtirib (interleave) beriladi —
avvalgi versiyadagi "birinchi javob bergan manbada to'xta" xatosi (4-5 ta GIF) yo'q.
So'rov bo'sh bo'lsa — TAVSIYALAR (trending) qaytadi.
"""
import json
import math
import os
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, Dict, List, Tuple

TIMEOUT = 8
CACHE_TTL = 300
MAX_BYTES = 4 * 1024 * 1024
MIN_GOOD = 4  # shundan kam bo'lsa zaxira manbalar ham qo'shiladi
UA = "SlideStudio/24 (slide editor; contact: admin@localhost) python-urllib"
GIPHY_PUBLIC_BETA_KEY = "dc6zaTOxFJmzC"  # umumiy, tez-tez limitga uriladi — faqat zaxira

_pool = ThreadPoolExecutor(max_workers=12)
_tr_cache: Dict[str, str] = {}


def _translate(q: str) -> str:
    """GIF manbalari faqat inglizcha tushunadi: o'zbekcha/ruscha so'rovni 1-4 inglizcha kalit so'zga aylantiradi.
    Xato yoki kalit yo'q bo'lsa — so'rov o'zgarmaydi."""
    key = _env("AI_API_KEY") or _env("DEEPSEEK_API_KEY") or _env("API_KEY")
    k = q.lower()
    if not q or not key:
        return q
    if k in _tr_cache:
        return _tr_cache[k]
    body = json.dumps({"model": "deepseek-chat", "max_tokens": 24, "temperature": 0, "messages": [
        {"role": "system", "content": "Convert a GIF search query (in ANY language) into 1-4 short English "
                                      "search keywords. If it is already English, return it unchanged. Output ONLY the keywords."},
        {"role": "user", "content": q}]}).encode()
    req = urllib.request.Request((_env("AI_BASE_URL") or _env("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/") + "/chat/completions", data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            out = json.loads(r.read().decode("utf-8", "replace"))["choices"][0]["message"]["content"]
        out = " ".join(out.strip().strip("\"'`.").split())[:80]
        if out:
            if len(_tr_cache) > 500:
                _tr_cache.clear()
            _tr_cache[k] = out
            return out
    except Exception as e:
        print(f"[GIF] tarjima xatosi: {e}")
    return q
_cache: Dict[Tuple, Tuple[float, dict]] = {}
_lock = threading.Lock()

Result = Tuple[List[dict], bool]  # (natijalar, yana_bormi)
Provider = Tuple[str, Callable[[str, int, int], Result]]


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _q(s: str) -> str:
    return urllib.parse.quote(s, safe="")


def _int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _get_json(url: str) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read(6 * 1024 * 1024)
    return json.loads(raw.decode("utf-8", "replace"))


# ───────────────────────── KLIPY ─────────────────────────
def _klipy(q: str, per: int, page: int) -> Result:
    key = _env("KLIPY_API_KEY")
    if not key:
        return [], False
    per = max(8, min(per, 50))
    ep = "search" if q else "trending"
    url = (f"https://api.klipy.com/api/v1/{_q(key)}/gifs/{ep}"
           f"?page={page}&per_page={per}&customer_id=slidestudio&rating=pg-13")
    if q:
        url += f"&q={_q(q)}"
    d = _get_json(url)
    body = d.get("data") or {}
    out: List[dict] = []
    for it in body.get("data") or []:
        if not isinstance(it, dict) or it.get("type") == "ad":
            continue
        files = it.get("files") or {}

        def pick(tiers):
            for t in tiers:
                g = (files.get(t) or {}).get("gif") or {}
                if g.get("url"):
                    return g
            return {}

        full = pick(("md", "hd", "sm"))
        thumb = pick(("sm", "xs", "md"))
        if not full.get("url"):
            continue
        out.append({"url": full["url"], "thumbnail": thumb.get("url") or full["url"], "is_gif": True,
                    "width": _int(full.get("width")), "height": _int(full.get("height")),
                    "source": "klipy"})
    return out, bool(body.get("has_next")) or len(out) >= per


# ───────────────────────── GIPHY ─────────────────────────
def _giphy_call(q: str, per: int, page: int, key: str, source: str) -> Result:
    per = max(8, min(per, 50))
    ep = "search" if q else "trending"
    url = (f"https://api.giphy.com/v1/gifs/{ep}?api_key={_q(key)}&limit={per}"
           f"&offset={(page - 1) * per}&rating=pg&bundle=messaging_non_clips")
    if q:
        url += f"&q={_q(q)}&lang=en"
    d = _get_json(url)
    out: List[dict] = []
    for it in d.get("data") or []:
        imgs = it.get("images") or {}
        orig = imgs.get("original") or {}
        full = orig.get("url") if _int(orig.get("size")) <= MAX_BYTES else ""
        if not full:
            for k in ("downsized_medium", "downsized", "fixed_height"):
                full = (imgs.get(k) or {}).get("url")
                if full:
                    break
        thumb = ((imgs.get("fixed_width") or {}).get("url")
                 or (imgs.get("fixed_height_small") or {}).get("url") or full)
        if full:
            out.append({"url": full, "thumbnail": thumb, "is_gif": True,
                        "width": _int(orig.get("width")), "height": _int(orig.get("height")),
                        "source": source})
    return out, len(out) >= per


def _giphy(q: str, per: int, page: int) -> Result:
    key = _env("GIPHY_API_KEY")
    return _giphy_call(q, per, page, key, "giphy") if key else ([], False)


def _giphy_beta(q: str, per: int, page: int) -> Result:
    return _giphy_call(q, per, page, GIPHY_PUBLIC_BETA_KEY, "giphy-beta")


# ─────────────── Kalitsiz zaxira: Openverse / Wikimedia ───────────────
def _openverse(q: str, per: int, page: int) -> Result:
    url = (f"https://api.openverse.org/v1/images/?q={_q(q or 'animation')}&page_size={min(per, 20)}"
           f"&page={page}&extension=gif")
    out = []
    hdrs = {"User-Agent": UA, "Accept": "application/json"}
    req = urllib.request.Request(url, headers=hdrs)
    with urllib.request.urlopen(req, timeout=18) as r:
        raw = r.read(6 * 1024 * 1024)
    d = json.loads(raw.decode("utf-8", "replace"))
    for r in d.get("results") or []:
        u = str(r.get("url") or "")
        if u.lower().split("?")[0].endswith(".gif"):
            out.append({"url": u, "thumbnail": r.get("thumbnail") or u, "is_gif": True, "source": "openverse"})
    return out, len(out) >= 8


def _wikimedia(q: str, per: int, page: int) -> Result:
    """Kalitsiz ishonchli manba.
    MUHIM: 'filetype:gif' 0 natija beradi — 'filemime:image/gif' ishlatiladi.
    """
    terms = (q or "animation").strip() or "animation"
    queries = [
        f"{terms} filemime:image/gif",
        f"{terms} gif",
    ]
    out = []
    seen = set()
    for gsr in queries:
        url = ("https://commons.wikimedia.org/w/api.php?action=query&generator=search"
               f"&gsrsearch={_q(gsr)}&gsrnamespace=6"
               f"&gsrlimit={min(max(per, 12), 50)}&gsroffset={(page - 1) * per}"
               "&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=400&format=json&origin=*")
        try:
            pages = ((_get_json(url).get("query") or {}).get("pages")) or {}
        except Exception:
            pages = {}
        for p in sorted(pages.values(), key=lambda x: x.get("index", 0)):
            info = (p.get("imageinfo") or [{}])[0]
            u = info.get("url") or ""
            mime = str(info.get("mime") or "")
            if not u:
                continue
            if not (mime.endswith("gif") or u.lower().split("?")[0].endswith(".gif")):
                continue
            if u in seen:
                continue
            seen.add(u)
            out.append({
                "url": u,
                "thumbnail": info.get("thumburl") or u,
                "is_gif": True,
                "width": _int(info.get("width")),
                "height": _int(info.get("height")),
                "source": "wikimedia",
            })
            if len(out) >= per:
                break
        if len(out) >= max(4, per // 2):
            break
    return out, len(out) >= per


# ───────────── Tenor (eski demo kalit; ba'zi tarmoqlarda hali ishlaydi) ─────────────
_tenor_pos: Dict[Tuple, str] = {}


def _tenor(q: str, per: int, page: int) -> Result:
    key = _env("TENOR_API_KEY") or "LIVDSRZULELA"
    per = max(8, min(per, 50))
    ep = "search" if q else "featured"
    url = f"https://tenor.googleapis.com/v2/{ep}?key={_q(key)}&client_key=slidestudio&limit={per}&media_filter=gif,tinygif&contentfilter=medium"
    if q:
        url += f"&q={_q(q)}"
    if page > 1:
        pos = _tenor_pos.get((q.lower(), page))
        if not pos:
            return [], False
        url += f"&pos={_q(pos)}"
    d = _get_json(url)
    nxt = d.get("next") or ""
    if nxt:
        _tenor_pos[(q.lower(), page + 1)] = nxt
    out = []
    for it in d.get("results") or []:
        mf = it.get("media_formats") or {}
        full = (mf.get("gif") or {}).get("url") or (mf.get("tinygif") or {}).get("url")
        thumb = (mf.get("tinygif") or {}).get("url") or full
        dims = (mf.get("gif") or {}).get("dims") or [0, 0]
        if full:
            out.append({"url": full, "thumbnail": thumb, "is_gif": True, "width": _int(dims[0]), "height": _int(dims[1]), "source": "tenor"})
    return out, bool(nxt)


# ───────────────────────── Qidiruv mantig'i ─────────────────────────
def _keyed() -> List[Provider]:
    p: List[Provider] = []
    if _env("KLIPY_API_KEY"):
        p.append(("klipy", _klipy))
    if _env("GIPHY_API_KEY"):
        p.append(("giphy", _giphy))
    return p


def _fallbacks() -> List[Provider]:
    # wikimedia birinchi: kalitsiz ishlaydi; tenor/giphy-beta ko'pincha 400/403
    return [("wikimedia", _wikimedia), ("openverse", _openverse), ("tenor", _tenor), ("giphy-beta", _giphy_beta)]


def _run(provs: List[Provider], q: str, per: int, page: int, errors: Dict[str, str]) -> Tuple[List[List[dict]], bool]:
    futs = [(n, _pool.submit(fn, q, per, page)) for n, fn in provs]
    lists: List[List[dict]] = []
    more = False
    for n, f in futs:
        try:
            items, hm = f.result(timeout=TIMEOUT + 3)
            lists.append(items)
            more = more or hm
        except Exception as e:
            errors[n] = str(e)[:140]
            print(f"[GIF] {n} xatosi: {e}")
    return lists, more


def _merge(lists: List[List[dict]]) -> List[dict]:
    seen, out = set(), []
    for i in range(max((len(l) for l in lists), default=0)):
        for l in lists:
            if i < len(l) and l[i]["url"] not in seen:
                seen.add(l[i]["url"])
                out.append(l[i])
    return out


def _variants(q: str) -> List[str]:
    """To'liq so'rov → birinchi 2 so'z → eng uzun so'z (natija kam bo'lsa ketma-ket sinaladi)."""
    words = q.split()
    v = [q]
    if len(words) > 2:
        v.append(" ".join(words[:2]))
    if len(words) > 1:
        v.append(max(words, key=len))
    return list(dict.fromkeys(v))


def search_gif(q: str, limit: int = 24, page: int = 1) -> dict:
    q = " ".join((q or "").split())[:120]
    limit = max(1, min(int(limit or 24), 60))
    page = max(1, int(page or 1))
    ck = (q.lower(), limit, page)
    with _lock:
        hit = _cache.get(ck)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return hit[1]

    qt = _translate(q) if q else ""
    errors: Dict[str, str] = {}
    keyed = _keyed()
    results: List[dict] = []
    more = False
    vs = ([""] if not q else _variants(qt) + ([q] if q.lower() != qt.lower() else []))
    for v in vs:
        if keyed:
            per = max(10, math.ceil(limit / max(len(keyed), 1)))
            lists, m = _run(keyed, v, per, page, errors)
            results, more = _merge(lists), m
        if len(results) >= MIN_GOOD:
            break
        # 1) Wikimedia avvalo (kalitsiz, tez) — boshqa sekin manbalarni kutmasdan
        try:
            w_items, w_more = _wikimedia(v or "animation", limit, page)
            if w_items:
                results = _merge([results, w_items])
                more = more or w_more
        except Exception as e:
            errors["wikimedia"] = str(e)[:140]
            print(f"[GIF] wikimedia xatosi: {e}")
        if len(results) >= MIN_GOOD:
            break
        # 2) qolgan fallback (openverse/tenor/giphy-beta) — parallel, lekin natija yetarli bo'lsa kutmaymiz
        rest = [("openverse", _openverse), ("tenor", _tenor), ("giphy-beta", _giphy_beta)]
        lists2, m2 = _run(rest, v, limit, page, errors)
        results, more = _merge([results] + lists2), more or m2
        if len(results) >= 1:
            break

    payload: Dict[str, Any] = {
        "results": results[:limit], "page": page, "query_en": qt, "has_more": bool(results) and more, "errors": errors,
        "provider": "+".join(sorted({r.get("source", "") for r in results if r.get("source")})) or "none",
    }
    if not keyed and results:
        payload["hint"] = "Kalitsiz manba (Wikimedia). Yaxshiroq sifat: .env ga KLIPY_API_KEY yoki GIPHY_API_KEY."
    if not keyed and not results:
        payload["setup_needed"] = True
        payload["hint"] = "GIF topilmadi. .env ga KLIPY_API_KEY yoki GIPHY_API_KEY qo'shing (bepul)."
    print(f"[GIF] q={q!r} en={qt!r} p{page} -> {len(results)} ta ({payload['provider']}) xato={list(errors)}")
    if results:
        with _lock:
            _cache[ck] = (time.time(), payload)
            if len(_cache) > 400:
                for k in sorted(_cache, key=lambda x: _cache[x][0])[:100]:
                    _cache.pop(k, None)
    return payload
