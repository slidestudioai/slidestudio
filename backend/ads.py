"""
Slide Studio — reklama tizimi (v47).

* Reklama: rasm / video + matn + havola. Joylashuv: sayt (chap panel, slaydlar tagida), bot, yoki ikkalasi.
* Pro / VIP / admin / "cheksiz" foydalanuvchilarga reklama HECH QACHON ko'rsatilmaydi (server hal qiladi).
* Ko'rsatish: faol + muddati ichida + joylashuvga mos reklamalardan og'irlik (weight) bo'yicha tasodifiy.
* Hisob: ko'rsatilishlar (impressions) va bosishlar (clicks) — atomik `ad_bump` SQL funksiyasi orqali.
* Havola bosilganda server /api/ads/click/{id} orqali hisoblab, keyin yo'naltiradi (faqat http/https).
"""
from __future__ import annotations

import base64
import random
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend import appsettings

_sb_getter: Callable[[], Any] = lambda: None
_lock = threading.Lock()
_cache: Dict[str, Any] = {"t": 0.0, "rows": []}
CACHE_TTL = 20.0
MAX_DATA_URL = 1_600_000          # ~1.2 MB rasm (base64)
_DATA_IMG = re.compile(r"^data:image/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$")
_bot_last: Dict[str, float] = {}


def configure(supabase_getter: Callable[[], Any]) -> None:
    global _sb_getter
    _sb_getter = supabase_getter


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ts(v: Any) -> Optional[datetime]:
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def valid_http_url(u: str) -> bool:
    return bool(re.match(r"^https?://[^\s<>\"']{3,2000}$", (u or "").strip(), re.I))


def clean_ad(data: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Admin formasidan kelgan ma'lumotni tekshiradi. (row, xato)."""
    d = data or {}
    title = str(d.get("title") or "").strip()[:80]
    body = str(d.get("body") or "").strip()[:400]
    mtype = str(d.get("media_type") or "none").lower()
    if mtype not in ("none", "image", "video"):
        mtype = "none"
    murl = str(d.get("media_url") or "").strip()
    link = str(d.get("link_url") or "").strip()
    btn = (str(d.get("button_text") or "Batafsil").strip() or "Batafsil")[:24]
    place = str(d.get("placement") or "both").lower()
    if place not in ("both", "site", "bot"):
        place = "both"
    if not (title or body or murl):
        return None, "Sarlavha, matn yoki media kiriting"
    if link and not valid_http_url(link):
        return None, "Havola http:// yoki https:// bilan boshlanishi kerak"
    if mtype == "none":
        murl = ""
    else:
        if not murl:
            return None, "Media havolasi yoki rasm yuklang"
        if murl.startswith("tg:"):
            pass          # Telegram fayl: botga to'g'ridan-to'g'ri, saytga server orqali uzatiladi
        elif murl.startswith("data:"):
            if mtype != "image" or not _DATA_IMG.match(murl) or len(murl) > MAX_DATA_URL:
                return None, "Rasm juda katta yoki formati noto'g'ri (PNG/JPG/WEBP, ~1 MB gacha)"
        elif not valid_http_url(murl):
            return None, "Media havolasi http:// yoki https:// bilan boshlanishi kerak"
    try:
        weight = max(1, min(100, int(d.get("weight") or 1)))
    except (TypeError, ValueError):
        weight = 1
    row = {
        "title": title, "body": body, "media_type": mtype, "media_url": murl, "link_url": link,
        "button_text": btn, "placement": place, "active": bool(d.get("active", True)), "weight": weight,
        "starts_at": (str(d.get("starts_at")).strip() or None) if d.get("starts_at") else None,
        "ends_at": (str(d.get("ends_at")).strip() or None) if d.get("ends_at") else None,
        "updated_at": _now().isoformat(),
    }
    for k in ("starts_at", "ends_at"):
        if row[k] and not _ts(row[k]):
            return None, "Sana formati noto'g'ri"
    return row, None


def invalidate() -> None:
    with _lock:
        _cache["t"] = 0.0


def _load(force: bool = False) -> List[Dict[str, Any]]:
    now = time.time()
    with _lock:
        if not force and now - _cache["t"] < CACHE_TTL:
            return list(_cache["rows"])
    sb = _sb_getter()
    rows: List[Dict[str, Any]] = []
    if sb:
        try:
            # ro'yxat uchun og'ir `media_url` (base64) ni olmaymiz faqat data: bo'lganda ham kerak emas — media alohida endpointdan
            rows = sb.table("ads").select("id,title,body,media_type,media_url,link_url,button_text,placement,active,weight,starts_at,ends_at").eq("active", True).execute().data or []
        except Exception as e:
            print(f"[ADS] o'qilmadi (SUPABASE_SCHEMA.sql?): {str(e)[:100]}")
            rows = []
    with _lock:
        _cache["rows"] = rows
        _cache["t"] = now
    return list(rows)


def _eligible(row: Dict[str, Any], surface: str, now: datetime) -> bool:
    if not row.get("active"):
        return False
    if row.get("placement") not in ("both", surface):
        return False
    s, e = _ts(row.get("starts_at")), _ts(row.get("ends_at"))
    if s and s > now:
        return False
    if e and e < now:
        return False
    return True


def surface_enabled(surface: str) -> bool:
    if not appsettings.get("ads_enabled", True):
        return False
    return bool(appsettings.get("ads_site" if surface == "site" else "ads_bot", True))


def pick(surface: str, ad_free: bool, exclude_id: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Mos reklamani tanlaydi yoki None (Pro/VIP/admin, o'chirilgan, reklama yo'q)."""
    if ad_free or surface not in ("site", "bot") or not surface_enabled(surface):
        return None
    now = _now()
    pool = [r for r in _load() if _eligible(r, surface, now)]
    if exclude_id is not None and len(pool) > 1:
        pool = [r for r in pool if int(r["id"]) != int(exclude_id)] or pool
    if not pool:
        return None
    return random.choices(pool, weights=[max(1, int(r.get("weight") or 1)) for r in pool], k=1)[0]


def media_path(row: Dict[str, Any]) -> str:
    """Rasm/video manzili: data: bo'lsa — o'z serverimizdagi endpoint, aks holda tashqi havola."""
    u = str(row.get("media_url") or "")
    if row.get("media_type") == "none" or not u:
        return ""
    return f"/api/ads/media/{int(row['id'])}" if (u.startswith("data:") or u.startswith("tg:")) else u


def public(row: Dict[str, Any], surface: str) -> Dict[str, Any]:
    return {
        "id": int(row["id"]), "title": row.get("title") or "", "body": row.get("body") or "",
        "media_type": row.get("media_type") or "none", "media_url": media_path(row),
        "button_text": row.get("button_text") or "Batafsil",
        "has_link": bool(row.get("link_url")),
        "click_url": f"/api/ads/click/{int(row['id'])}?s={surface}",
    }


def bump(ad_id: int, kind: str) -> None:
    sb = _sb_getter()
    if not sb:
        return
    kind = "click" if kind == "click" else "impression"
    try:
        sb.rpc("ad_bump", {"p_id": int(ad_id), "p_kind": kind}).execute()
        return
    except Exception:
        pass
    try:   # zaxira: oddiy o'qib-yozish (kam aniq, lekin funksiya yo'q bo'lsa ham ishlaydi)
        col = "clicks" if kind == "click" else "impressions"
        r = sb.table("ads").select(col).eq("id", int(ad_id)).limit(1).execute().data
        if r:
            sb.table("ads").update({col: int(r[0].get(col) or 0) + 1}).eq("id", int(ad_id)).execute()
    except Exception as e:
        print(f"[ADS] bump xato: {str(e)[:80]}")


def get_row(ad_id: int, with_media: bool = True) -> Optional[Dict[str, Any]]:
    sb = _sb_getter()
    if not sb:
        return None
    try:
        r = sb.table("ads").select("*").eq("id", int(ad_id)).limit(1).execute().data
        return r[0] if r else None
    except Exception:
        return None


def decode_data_url(u: str) -> Optional[Tuple[bytes, str]]:
    m = re.match(r"^data:(image/[a-z0-9.+-]+);base64,(.+)$", u or "", re.S | re.I)
    if not m:
        return None
    try:
        return base64.b64decode(m.group(2)), m.group(1).lower()
    except Exception:
        return None


# ---------------- Bot uchun: foydalanuvchiga cheklov (spam bo'lmasin) ----------------
def bot_due(key: str) -> bool:
    """Bu foydalanuvchiga botda reklama vaqti keldimi (interval sozlamadan)."""
    gap = int(appsettings.get("ad_bot_interval_min", 15) or 0) * 60
    last = _bot_last.get(key, 0.0)
    return (time.time() - last) >= gap


def bot_mark(key: str) -> None:
    _bot_last[key] = time.time()
    if len(_bot_last) > 20000:
        for k in list(_bot_last.keys())[:5000]:
            _bot_last.pop(k, None)
