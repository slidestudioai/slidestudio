"""v83: the editor's last deck in the cloud — ONE per account, kept 3 days.

Before, the deck was saved only in this browser (IndexedDB). The Telegram Mini App, the phone browser and the
computer each had their own copy, so a deck made in one place was not there in the other. Now the editor also
uploads its auto-saved draft here; any device that signs in to the same account (Google on the site, or the
Telegram account in the Mini App / bot) opens the newest one automatically.

  POST /api/draft/save    {deck: {...}, saved_at: ms}   Authorization: Bearer <token>
  POST /api/draft/load    {}                             -> {deck, saved_at} or {deck: null}
  POST /api/draft/delete  {}

Table (SUPABASE_SCHEMA.sql, section 21): cloud_drafts(user_id pk, title, data, size_bytes, saved_ms, updated_at).
A draft older than DRAFT_TTL_DAYS is not returned and is deleted.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

TABLE = "cloud_drafts"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


DRAFT_TTL_DAYS = max(1, _env_int("DRAFT_TTL_DAYS", 3))
MAX_DRAFT_BYTES = max(1, _env_int("MAX_DRAFT_MB", 6)) * 1024 * 1024     # bigger decks stay on the device only
PURGE_EVERY_SEC = 600
NO_TABLE = "cloud_drafts jadvali yo'q — SUPABASE_SCHEMA.sql (21-bo'lim) ni Supabase SQL Editor'da ishga tushiring."

_deps: Dict[str, Callable[..., Any]] = {}
_state = {"purged": 0.0, "warned": False}


class DraftError(Exception):
    def __init__(self, msg: str, code: int = 400):
        super().__init__(msg)
        self.msg, self.code = msg, code


def _sb():
    fn = _deps.get("get_supabase")
    return fn() if fn else None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: Any) -> Optional[datetime]:
    try:
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _cloud_user(uid: str) -> bool:
    return bool(uid) and not str(uid).startswith(("dev-", "anon-", "guest-"))


def _no_table(e: Exception) -> bool:
    m = str(e).lower()
    return TABLE in m and ("does not exist" in m or "could not find" in m or "pgrst205" in m or "relation" in m)


def _db_error(e: Exception) -> DraftError:
    if _no_table(e):
        if not _state["warned"]:
            _state["warned"] = True
            print("[DRAFT] ⚠️ " + NO_TABLE)
        return DraftError(NO_TABLE, 503)
    return DraftError("Bazaga yozib/o'qib bo'lmadi: " + str(e)[:120], 502)


def purge_expired(force: bool = False) -> int:
    """Deletes drafts older than DRAFT_TTL_DAYS (at most every 10 minutes per process)."""
    now = time.time()
    if not force and now - _state["purged"] < PURGE_EVERY_SEC:
        return 0
    _state["purged"] = now
    sb = _sb()
    if not sb:
        return 0
    try:
        cut = (_now() - timedelta(days=DRAFT_TTL_DAYS)).isoformat()
        res = sb.table(TABLE).delete().lt("updated_at", cut).execute()
        return len(getattr(res, "data", None) or [])
    except Exception as e:
        print(f"[DRAFT] purge: {str(e)[:120]}")
        return 0


def save(uid: str, deck: Any, saved_ms: Any = None) -> Dict[str, Any]:
    if not _cloud_user(uid):
        raise DraftError("Avval tizimga kiring", 401)
    if not isinstance(deck, dict) or not isinstance(deck.get("slides"), list) or not deck["slides"]:
        raise DraftError("Slaydlar yo'q", 400)
    data = json.dumps(deck, ensure_ascii=False, separators=(",", ":"))
    size = len(data.encode("utf-8"))
    if size > MAX_DRAFT_BYTES:
        raise DraftError("too_large", 413)
    try:
        ms = int(saved_ms or 0)
    except (TypeError, ValueError):
        ms = 0
    now_ms = int(time.time() * 1000)
    ms = min(ms, now_ms) if ms > 0 else now_ms               # a wrong device clock cannot push a draft into the future
    sb = _sb()
    if not sb:
        raise DraftError("Server bazasi ulanmagan (Supabase).", 503)
    row = {"user_id": str(uid), "title": str(deck.get("title") or "")[:200], "data": data, "size_bytes": size,
           "saved_ms": ms, "updated_at": _now().isoformat()}
    try:
        prev = sb.table(TABLE).select("saved_ms").eq("user_id", str(uid)).limit(1).execute().data or []
        if prev and int(prev[0].get("saved_ms") or 0) > ms:
            # another device saved a NEWER deck meanwhile: do not overwrite it with this older one
            return {"ok": True, "saved_at": int(prev[0]["saved_ms"]), "kept_newer": True}
        sb.table(TABLE).upsert(row, on_conflict="user_id").execute()
    except Exception as e:
        raise _db_error(e)
    purge_expired()
    return {"ok": True, "saved_at": ms, "size": size}


def load(uid: str) -> Dict[str, Any]:
    if not _cloud_user(uid):
        return {"deck": None}
    sb = _sb()
    if not sb:
        return {"deck": None}
    try:
        rows = sb.table(TABLE).select("data,saved_ms,updated_at").eq("user_id", str(uid)).limit(1).execute().data or []
    except Exception as e:
        raise _db_error(e)
    if not rows:
        return {"deck": None}
    r = rows[0]
    upd = _parse(r.get("updated_at"))
    if upd is None or _now() - upd > timedelta(days=DRAFT_TTL_DAYS):
        remove(uid)                                          # 3 days passed: the draft is gone
        return {"deck": None, "expired": True}
    try:
        deck = json.loads(r.get("data") or "null")
    except Exception:
        return {"deck": None}
    return {"deck": deck, "saved_at": int(r.get("saved_ms") or 0), "ttl_days": DRAFT_TTL_DAYS}


def remove(uid: str) -> Dict[str, Any]:
    sb = _sb()
    if not sb or not _cloud_user(uid):
        return {"ok": True}
    try:
        sb.table(TABLE).delete().eq("user_id", str(uid)).execute()
    except Exception as e:
        raise _db_error(e)
    return {"ok": True}


def _bearer(request: Request, body: Dict[str, Any]) -> str:
    h = (request.headers.get("authorization") or "").strip()
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    return str(body.get("token") or "").strip()


def register_drafts(app: FastAPI, ctx: Dict[str, Any]) -> None:
    """ctx: get_supabase, auth_user (token -> (uid, email) | None)."""
    _deps.update({k: v for k, v in ctx.items() if v is not None})

    async def _uid(request: Request, body: Dict[str, Any]) -> Optional[str]:
        tok = _bearer(request, body)
        if not tok or tok == "dev-token":
            return None
        try:
            who = await asyncio.to_thread(_deps["auth_user"], tok)
        except Exception:
            return None
        return str(who[0]) if who else None

    async def _body(request: Request) -> Dict[str, Any]:
        try:
            b = await request.json()
            return b if isinstance(b, dict) else {}
        except Exception:
            return {}

    def _err(e: DraftError):
        return JSONResponse({"error": e.msg}, status_code=e.code)

    @app.post("/api/draft/save")
    async def draft_save(request: Request):
        body = await _body(request)
        uid = await _uid(request, body)
        if not uid:
            return JSONResponse({"error": "Avval tizimga kiring"}, status_code=401)
        try:
            return await asyncio.to_thread(save, uid, body.get("deck"), body.get("saved_at"))
        except DraftError as e:
            return _err(e)

    @app.post("/api/draft/load")
    async def draft_load(request: Request):
        body = await _body(request)
        uid = await _uid(request, body)
        if not uid:
            return {"deck": None}
        try:
            return JSONResponse(await asyncio.to_thread(load, uid), headers={"Cache-Control": "no-store"})
        except DraftError as e:
            return _err(e)

    @app.post("/api/draft/delete")
    async def draft_delete(request: Request):
        body = await _body(request)
        uid = await _uid(request, body)
        if not uid:
            return JSONResponse({"error": "Avval tizimga kiring"}, status_code=401)
        try:
            return await asyncio.to_thread(remove, uid)
        except DraftError as e:
            return _err(e)
