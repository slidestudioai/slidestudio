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
    "free_daily_pages": mon.FREE_DAILY_PAGES,      # bepul kunlik (Tez-varaq)
    "pack_pages": mon.PAGES_PER_PACK,              # bitta paket (Tez-varaq)
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
INT_KEYS = {"free_daily_pages", "pack_pages", "daily_message_limit", "ad_bot_interval_min"}
BOOL_KEYS = {"ads_enabled", "ads_site", "ads_bot", "maintenance", "ad_purge_on_expire"}
STR_KEYS = {"maintenance_text", "announcement"}
_cache: Dict[str, Any] = dict(DEFAULTS)


def configure(supabase_getter: Callable[[], Any]) -> None:
    global _sb_getter
    _sb_getter = supabase_getter


def _coerce(key: str, val: Any) -> Any:
    if key in INT_KEYS:
        lo, hi = (0, 100000) if key != "ad_bot_interval_min" else (0, 1440)
        return max(lo, min(hi, int(float(val))))
    if key in BOOL_KEYS:
        if isinstance(val, str):
            return val.strip().lower() in ("1", "true", "yes", "on", "ha")
        return bool(val)
    if key in STR_KEYS:
        return str(val or "")[:600]
    raise KeyError(key)


def _apply_runtime() -> None:
    mon.set_runtime(free_daily_pages=_cache.get("free_daily_pages"),
                    pack_pages=_cache.get("pack_pages"))


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
            with _lock:
                for r in rows:
                    k = r.get("key")
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
