"""
Slide Studio — umumiy sozlamalar (v47).

Admin paneldan o'zgartiriladi, Supabase `app_settings` jadvalida saqlanadi (restartdan keyin ham qoladi).
Jadval yo'q bo'lsa — faqat xotirada ishlaydi (`persisted=False`), hech narsa buzilmaydi.
Limitlar (bepul/paket) darhol `monitoring.set_runtime` orqali qo'llanadi.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Optional

from backend import monitoring as mon

_lock = threading.Lock()
_sb_getter: Callable[[], Any] = lambda: None
_loaded_at = 0.0
persisted = False
TTL = 60.0

DEFAULTS: Dict[str, Any] = {
    # v76: tarif — kodda qotirilgan son yo'q, hammasi shu yerdan (admin panel → Sozlamalar → Tarif)
    "slides_per_dollar": mon.PAGES_PER_PACK,       # $1 netto -> shuncha birlik (Tez-varaq) pullik balansga
    "fast_ai_cost": 1,                             # 1 Tez slayd = shuncha birlik
    "deep_ai_cost": mon.DEEP_MULT,                 # 1 Chuqur slayd = shuncha birlik ($1=100 -> 50 Chuqur)
    "free_daily_fast_limit": mon.FREE_DAILY_PAGES,  # bepul kunlik Tez limit
    "free_daily_deep_limit": mon.FREE_DAILY_PAGES // mon.DEEP_MULT,   # bepul kunlik Chuqur limit
    "daily_message_limit": 200,                    # bitta foydalanuvchining kunlik AI xabarlari
    "ads_enabled": True,                           # umumiy reklama kaliti
    "ads_site": True,                              # saytda (chap panel)
    "ads_bot": True,                               # Telegram botda
    "ad_purge_on_expire": False,                    # muddati tugaganda botdagi xabarlarni ham o'chirish (standart: yo'q)
    "ad_bot_interval_min": 15,                     # botda bir foydalanuvchiga reklama oralig'i (daqiqa)
    "maintenance": False,                          # texnik ishlar rejimi (adminlardan boshqasiga AI yopiladi)
    "maintenance_text": "Texnik ishlar olib borilmoqda. Birozdan keyin urinib ko'ring.",
    "announcement": "",                            # saytda tepada ko'rinadigan e'lon (bo'sh = yo'q)
}
INT_KEYS = {"slides_per_dollar", "free_daily_fast_limit", "free_daily_deep_limit", "daily_message_limit", "ad_bot_interval_min"}
FLOAT_KEYS = {"fast_ai_cost", "deep_ai_cost"}
ALIASES = {"free_daily_pages": "free_daily_fast_limit", "pack_pages": "slides_per_dollar"}   # v75 gacha bo'lgan kalitlar
TARIFF_KEYS = ("slides_per_dollar", "fast_ai_cost", "deep_ai_cost", "free_daily_fast_limit", "free_daily_deep_limit")
BOOL_KEYS = {"ads_enabled", "ads_site", "ads_bot", "maintenance", "ad_purge_on_expire"}
STR_KEYS = {"maintenance_text", "announcement"}
_cache: Dict[str, Any] = dict(DEFAULTS)


def configure(supabase_getter: Callable[[], Any]) -> None:
    global _sb_getter
    _sb_getter = supabase_getter


def _coerce(key: str, val: Any) -> Any:
    if key in INT_KEYS:
        lo, hi = {"ad_bot_interval_min": (0, 1440), "slides_per_dollar": (1, 1000000)}.get(key, (0, 100000))
        x = float(val)
        if x != x:
            raise ValueError(key)
        return max(lo, min(hi, int(x)))
    if key in FLOAT_KEYS:
        x = float(val)
        if x != x or x <= 0:
            raise ValueError(key)               # narx 0 yoki manfiy bo'lmaydi (aks holda AI tekin bo'lib qoladi)
        return round(max(0.05, min(1000.0, x)), 2)
    if key in BOOL_KEYS:
        if isinstance(val, str):
            return val.strip().lower() in ("1", "true", "yes", "on", "ha")
        return bool(val)
    if key in STR_KEYS:
        return str(val or "")[:600]
    raise KeyError(key)


def _apply_runtime() -> None:
    mon.set_runtime(free_daily_pages=_cache.get("free_daily_fast_limit"),
                    pack_pages=_cache.get("slides_per_dollar"),
                    fast_ai_cost=_cache.get("fast_ai_cost"),
                    deep_ai_cost=_cache.get("deep_ai_cost"),
                    free_daily_deep_limit=_cache.get("free_daily_deep_limit"))


def load(force: bool = False) -> Dict[str, Any]:
    """DB dan o'qiydi (TTL bilan). Xatoda xotiradagi qiymatlar qoladi."""
    global _loaded_at, persisted
    now = time.time()
    if not force and now - _loaded_at < TTL:
        return dict(_cache)
    sb = _sb_getter()
    if sb:
        try:
            rows = sb.table("app_settings").select("key,value").execute().data or []
            have = {r.get("key") for r in rows}
            with _lock:
                for r in rows:
                    k = r.get("key")
                    if k in ALIASES and ALIASES[k] not in have:      # eski kalit: yangisi hali saqlanmagan bo'lsa
                        k = ALIASES[k]
                    if k in DEFAULTS:
                        try:
                            _cache[k] = _coerce(k, r.get("value"))
                        except Exception:
                            pass
            persisted = True
        except Exception as e:
            persisted = False
            print(f"[SETTINGS] app_settings o'qilmadi (SUPABASE_SCHEMA.sql ishga tushirilganmi?): {str(e)[:100]}")
    _loaded_at = now
    _apply_runtime()
    return dict(_cache)


def get(key: str, default: Any = None) -> Any:
    load()
    return _cache.get(key, DEFAULTS.get(key, default))


def all_settings() -> Dict[str, Any]:
    return load()


def set_many(values: Dict[str, Any]) -> Dict[str, Any]:
    """Qiymatlarni tekshirib saqlaydi. Qaytaradi: {'saved': {...}, 'persisted': bool, 'error': str|None}."""
    clean: Dict[str, Any] = {}
    for k, v in (values or {}).items():
        k = ALIASES.get(k, k)
        if k not in DEFAULTS:
            continue
        try:
            clean[k] = _coerce(k, v)
        except Exception:
            continue
    with _lock:
        _cache.update(clean)
    _apply_runtime()
    err: Optional[str] = None
    ok = False
    sb = _sb_getter()
    if sb and clean:
        try:
            sb.table("app_settings").upsert([{"key": k, "value": v} for k, v in clean.items()]).execute()
            ok = True
        except Exception as e:
            err = "app_settings jadvali yo'q — SUPABASE_SCHEMA.sql ni ishga tushiring (hozircha faqat xotirada)"
            print(f"[SETTINGS] saqlanmadi: {str(e)[:100]}")
    global persisted
    persisted = ok or (persisted and not clean)
    return {"saved": clean, "persisted": ok, "error": err}
