"""
backend/support.py — Yordam (Support): foydalanuvchi adminga shaxsiy xabar yozadi, admin javob beradi.

Ommaviy «Fikrlar» (community.py) dan farqi: bu yozishma FAQAT foydalanuvchi va admin o'rtasida.

Foydalanuvchi (sayt):
  POST /api/support/send  {token, body}   — xabar yuborish (token Authorization: Bearer da ham bo'lishi mumkin)
  POST /api/support/my    {token}         — o'z yozishmasi (admin javoblari «o'qildi» bo'ladi)
Foydalanuvchi (Telegram bot): ⚙️ Sozlamalar → «💬 Adminga yozish» → user_send(..., source="tg") / user_thread()
Admin (admin/panel.html → admin_core._dispatch, va bot: «admin» → 💬 Yordam):
  support_list · support_thread {user_id} · support_reply {user_id, text}

Jadval (SUPABASE_SCHEMA.sql, 15-bo'lim):
  support_messages(id bigserial, user_id, email, author, body, source, from_admin, read_by_admin, read_by_user, created_at)
"""
import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

TABLE = "support_messages"
MSG_MIN_LEN = 2
MSG_MAX_LEN = 2000
SEND_COOLDOWN_SEC = 10          # bitta foydalanuvchi: ikki xabar orasida
MAX_PER_HOUR = 20               # spam himoyasi
THREAD_LIMIT = 100
NO_TABLE = "Yordam jadvali yaratilmagan — SUPABASE_SCHEMA.sql ni qayta ishga tushiring."

_sent: Dict[str, List[float]] = {}
_deps: Dict[str, Any] = {}


class SupportError(Exception):
    def __init__(self, msg: str, code: int = 400):
        super().__init__(msg)
        self.msg, self.code = msg, code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sb():
    fn = _deps.get("get_supabase")
    return fn() if fn else None


def _clean(text: Any) -> str:
    s = str(text or "").replace("\r\n", "\n").replace("\x00", "").strip()
    return s[:MSG_MAX_LEN]


def _rate_ok(uid: str, now: float) -> Optional[str]:
    hist = [t for t in _sent.get(uid, []) if now - t < 3600]
    if hist and now - hist[-1] < SEND_COOLDOWN_SEC:
        return "Iltimos, biroz kuting va qayta yuboring"
    if len(hist) >= MAX_PER_HOUR:
        return "Juda ko'p xabar yuborildi. Bir soatdan keyin urinib ko'ring"
    return None


def _remember(uid: str, now: float) -> None:
    hist = [t for t in _sent.get(uid, []) if now - t < 3600]
    hist.append(now)
    _sent[uid] = hist
    if len(_sent) > 5000:                       # eski yozuvlarni tozalash (faqat bir soatdan eskilar)
        for k in [k for k, v in list(_sent.items()) if not v or now - v[-1] > 3600]:
            _sent.pop(k, None)


def _public(row: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": row.get("id"), "body": row.get("body") or "", "from_admin": bool(row.get("from_admin")),
            "source": row.get("source") or "site", "created_at": row.get("created_at")}


def _insert(row: Dict[str, Any]) -> None:
    """Yozadi; bazada `source` ustuni hali bo'lmasa (eski SQL) — usiz qayta urinadi."""
    sb = _sb()
    try:
        sb.table(TABLE).insert(row).execute()
    except Exception as e:
        if "source" not in str(e).lower() or "source" not in row:
            raise
        sb.table(TABLE).insert({k: v for k, v in row.items() if k != "source"}).execute()


# ----------------------------------------------------------------------------------------------
# Foydalanuvchi amallari (sayt API va Telegram bot ikkalasi ham shulardan foydalanadi — sinxron)
# ----------------------------------------------------------------------------------------------
def user_send(uid: str, email: str, author: str, text: Any, source: str = "site") -> Dict[str, Any]:
    """Foydalanuvchi xabarini saqlaydi va adminlarga xabar beradi. Xato bo'lsa SupportError."""
    uid = str(uid or "").strip()
    if not uid:
        raise SupportError("Avval tizimga kiring", 401)
    if not _sb():
        raise SupportError("Server bazasi ulanmagan (Supabase).", 503)
    body = _clean(text)
    if len(body) < MSG_MIN_LEN:
        raise SupportError("Xabar juda qisqa", 400)
    now = time.time()
    wait = _rate_ok(uid, now)
    if wait:
        raise SupportError(wait, 429)
    email = str(email or "").strip().lower()
    row = {"user_id": uid, "email": email, "author": str(author or "")[:60] or "Foydalanuvchi", "body": body,
           "source": "tg" if source == "tg" else "site", "from_admin": False, "read_by_admin": False,
           "read_by_user": True, "created_at": _now_iso()}
    try:
        _insert(row)
    except Exception as e:
        print(f"[SUPPORT SEND] {str(e)[:200]}")
        raise SupportError(NO_TABLE, 503)
    _remember(uid, now)
    _schedule(_deps.get("notify_admins"), uid, email, body, row["source"])
    return _public(row)


def user_thread(uid: str, mark_read: bool = True, limit: int = THREAD_LIMIT) -> Dict[str, Any]:
    """Foydalanuvchining yozishmasi (eskidan yangiga). mark_read — admin javoblari «o'qildi» bo'ladi."""
    sb = _sb()
    if not sb:
        raise SupportError("Server bazasi ulanmagan (Supabase).", 503)
    try:
        rows = sb.table(TABLE).select("*").eq("user_id", uid).order("created_at", desc=True) \
            .limit(int(limit)).execute().data or []
    except Exception as e:
        print(f"[SUPPORT MY] {str(e)[:200]}")
        raise SupportError(NO_TABLE, 503)
    rows.reverse()
    unread = sum(1 for r in rows if r.get("from_admin") and not r.get("read_by_user"))
    if unread and mark_read:
        try:
            sb.table(TABLE).update({"read_by_user": True}).eq("user_id", uid).eq("from_admin", True) \
                .eq("read_by_user", False).execute()
        except Exception:
            pass
    return {"messages": [_public(r) for r in rows], "unread": unread, "max_len": MSG_MAX_LEN}


def user_unread(uid: str) -> int:
    sb = _sb()
    if not sb or not uid:
        return 0
    try:
        r = sb.table(TABLE).select("id", count="exact").eq("user_id", uid).eq("from_admin", True) \
            .eq("read_by_user", False).execute()
        return int(r.count or 0)
    except Exception:
        return 0


# ----------------------------------------------------------------------------------------------
# Admin amallari (admin_core._dispatch shulardan foydalanadi — sinxron, asyncio.to_thread ichida)
# ----------------------------------------------------------------------------------------------
def admin_list(limit: int = 200) -> Dict[str, Any]:
    """Har bir foydalanuvchi bo'yicha bitta qator: oxirgi xabar + o'qilmaganlar soni. Yangilari tepada."""
    sb = _sb()
    try:
        rows = sb.table(TABLE).select("user_id,email,author,body,from_admin,read_by_admin,created_at") \
            .order("created_at", desc=True).limit(max(50, min(2000, int(limit) * 10))).execute().data or []
    except Exception as e:
        raise SupportError(NO_TABLE + " (" + str(e)[:80] + ")", 409)
    threads: Dict[str, Dict[str, Any]] = {}
    for r in rows:                              # rows — yangidan eskiga
        uid = str(r.get("user_id") or "")
        if not uid:
            continue
        t = threads.get(uid)
        if t is None:
            t = threads[uid] = {"user_id": uid, "email": r.get("email") or "", "author": r.get("author") or "",
                                "last_body": (r.get("body") or "")[:160], "last_from_admin": bool(r.get("from_admin")),
                                "last_at": r.get("created_at"), "unread": 0}
        if not t["email"] and r.get("email"):
            t["email"] = r.get("email")
        if not r.get("from_admin") and not r.get("read_by_admin"):
            t["unread"] += 1
    items = list(threads.values())[: int(limit)]
    return {"threads": items, "unread_total": sum(t["unread"] for t in items)}


def admin_unread_count() -> int:
    sb = _sb()
    try:
        r = sb.table(TABLE).select("id", count="exact").eq("from_admin", False).eq("read_by_admin", False).execute()
        return int(r.count or 0)
    except Exception:
        return 0


def admin_thread(uid: str) -> Dict[str, Any]:
    uid = str(uid or "").strip()
    if not uid:
        raise SupportError("user_id kerak")
    sb = _sb()
    try:
        rows = sb.table(TABLE).select("*").eq("user_id", uid).order("created_at", desc=True) \
            .limit(THREAD_LIMIT).execute().data or []
    except Exception as e:
        raise SupportError(NO_TABLE + " (" + str(e)[:80] + ")", 409)
    rows.reverse()
    try:
        sb.table(TABLE).update({"read_by_admin": True}).eq("user_id", uid).eq("from_admin", False) \
            .eq("read_by_admin", False).execute()
    except Exception:
        pass
    email = next((r.get("email") for r in rows if r.get("email")), "")
    return {"user_id": uid, "email": email, "messages": [_public(r) for r in rows]}


def admin_reply(uid: str, text: Any) -> Dict[str, Any]:
    uid = str(uid or "").strip()
    body = _clean(text)
    if not uid:
        raise SupportError("user_id kerak")
    if len(body) < MSG_MIN_LEN:
        raise SupportError("Javob matni juda qisqa")
    sb = _sb()
    try:
        prev = sb.table(TABLE).select("email").eq("user_id", uid).limit(1).execute().data or []
    except Exception as e:
        raise SupportError(NO_TABLE + " (" + str(e)[:80] + ")", 409)
    if not prev:
        raise SupportError("Bu foydalanuvchi bilan yozishma yo'q")
    row = {"user_id": uid, "email": prev[0].get("email") or "", "author": "Admin", "body": body,
           "from_admin": True, "read_by_admin": True, "read_by_user": False, "created_at": _now_iso()}
    try:
        _insert(dict(row, source="admin"))
        # javob berildi — demak foydalanuvchi xabarlari ko'rilgan
        sb.table(TABLE).update({"read_by_admin": True}).eq("user_id", uid).eq("from_admin", False).execute()
    except Exception as e:
        raise SupportError("Saqlanmadi: " + str(e)[:140], 502)
    _schedule(_deps.get("notify_reply"), uid, body)      # Telegram ulangan bo'lsa — javob matni botga ham boradi
    return {"ok": True}


def _schedule(fn: Optional[Callable], *args) -> None:
    """Telegram xabarini fon rejimida yuborish (xato bo'lsa — jim)."""
    getter = _deps.get("get_loop")
    loop = (getter() if getter else None) or _deps.get("loop")
    if not fn or not loop or loop.is_closed() or not loop.is_running():
        return
    try:
        coro = fn(*args)
        if asyncio.iscoroutine(coro):
            asyncio.run_coroutine_threadsafe(coro, loop)
    except Exception as e:
        print(f"[SUPPORT] notify: {str(e)[:120]}")


def _bearer_token(request: Request, fallback: str = "") -> str:
    h = (request.headers.get("authorization") or "").strip()
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    return (fallback or "").strip()


async def _payload(request: Request) -> Dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


# ----------------------------------------------------------------------------------------------
# Foydalanuvchi API
# ----------------------------------------------------------------------------------------------
def register_support(app: FastAPI, ctx: Dict[str, Any]) -> None:
    """ctx: get_supabase, get_loop, notify_admins (async uid, email, body, source), notify_reply (async uid, body)."""
    _deps.update({k: v for k, v in ctx.items() if v is not None})

    def auth(token: str):
        sb = _sb()
        if not sb or not token:
            return None
        try:
            r = sb.auth.get_user(token)
            return r.user if r and r.user else None
        except Exception as e:
            print(f"[SUPPORT AUTH] {str(e)[:120]}")
            return None

    def _err(msg: str, code: int):
        return JSONResponse({"error": msg}, status_code=code)

    async def _uid(request: Request, p: Dict[str, Any]):
        user = await asyncio.to_thread(auth, _bearer_token(request, str(p.get("token") or "")))
        return user

    @app.post("/api/support/send")
    async def support_send(request: Request):
        _deps["loop"] = asyncio.get_running_loop()
        p = await _payload(request)
        if not _sb():
            return _err("Server bazasi ulanmagan (Supabase).", 503)
        user = await _uid(request, p)
        if not user:
            return _err("Avval tizimga kiring", 401)
        meta = getattr(user, "user_metadata", None) or {}
        email = str(getattr(user, "email", "") or "").strip().lower()
        author = str(meta.get("full_name") or meta.get("name") or (email.split("@")[0] if email else ""))
        try:
            msg = await asyncio.to_thread(user_send, str(user.id), email, author, p.get("body"), "site")
        except SupportError as e:
            return _err(e.msg, e.code)
        return {"ok": True, "message": msg}

    @app.post("/api/support/my")
    async def support_my(request: Request):
        p = await _payload(request)
        if not _sb():
            return _err("Server bazasi ulanmagan (Supabase).", 503)
        user = await _uid(request, p)
        if not user:
            return _err("Avval tizimga kiring", 401)
        try:
            return await asyncio.to_thread(user_thread, str(user.id), True)
        except SupportError as e:
            return _err(e.msg, e.code)

    @app.post("/api/support/unread")
    async def support_unread(request: Request):
        """Sozlamalar tugmasidagi belgi uchun: admin javoblaridan nechtasi o'qilmagan."""
        p = await _payload(request)
        if not _sb():
            return {"unread": 0}
        user = await _uid(request, p)
        if not user:
            return {"unread": 0}
        return {"unread": await asyncio.to_thread(user_unread, str(user.id))}
