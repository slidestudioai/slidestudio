"""Audit M5: auth service (moved from main.py) — token -> user with local JWT check (H3) and caches (H4)."""
from __future__ import annotations

import asyncio
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional, Tuple

from backend.services.obs import metrics as _metrics

_d: Dict[str, Callable[..., Any]] = {}


def configure(**deps: Callable[..., Any]) -> None:
    """Wired from main.py with late-bound lambdas (tests can still monkeypatch main.*)."""
    _d.update(deps)


def _sb():
    return _d["supabase"]()


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

from backend import jwt_auth

# ---- token -> foydalanuvchi keshi (har xabarda Supabase Auth'ga HTTP so'rov ketmasin) ----
_TOK_CACHE: "OrderedDict[str, tuple]" = OrderedDict()
_TOK_LOCK = threading.Lock()          # accessed from the thread pool (HTTP) and the event loop (WS)
TOK_TTL = 60.0

AUTH_REVALIDATE_SEC = float(_env_int("AUTH_REVALIDATE_SEC", 600))
_SESSION_OK: "OrderedDict[str, float]" = OrderedDict()   # "uid|session_id" -> last time Supabase Auth confirmed it
_TOK_BAD: "OrderedDict[str, float]" = OrderedDict()      # token hash -> time it was found invalid (negative cache)
_AUTH_DEGRADED = {"last_log": 0.0}


def _auth_error_is_invalid(e: Exception) -> bool:
    """Supabase Auth said "this token is bad" (vs. network error / rate limit / outage)."""
    st = getattr(e, "status", None) or getattr(e, "status_code", None)
    try:
        st = int(st) if st is not None else None
    except (TypeError, ValueError):
        st = None
    if st is not None:
        return st in (400, 401, 403, 404, 422)
    m = str(e).lower()
    return any(w in m for w in ("invalid jwt", "jwt expired", "token is expired", "session_not_found",
                                "session from session_id", "user_not_found", "user from sub claim"))


def _server_get_user(token: str):
    """(uid, email) | None (invalid). Raises on network errors."""
    try:
        r = _sb().auth.get_user(token)
    except Exception as e:
        if _auth_error_is_invalid(e):
            return None
        raise
    if not r or not r.user:
        return None
    return str(r.user.id), r.user.email or ""


def _mark_token_bad(tk: str) -> None:
    with _TOK_LOCK:
        _TOK_CACHE.pop(tk, None)
        _TOK_BAD[tk] = time.time()
        while len(_TOK_BAD) > 5000:
            _TOK_BAD.popitem(last=False)


def auth_user_cached(token: str):
    """Audit H3/H4: token -> (uid, email), or None for an invalid token. Raises only if it cannot decide.
    1) 60 s cache. 2) Signature/exp/aud/iss checked LOCALLY (backend/jwt_auth.py) — junk and expired tokens are
    rejected with no network call. 3) Supabase Auth is still asked once per session every AUTH_REVALIDATE_SEC
    (catches logout / ban / deleted user). If Supabase Auth is down, a token with a valid signature is accepted.
    Without SUPABASE_URL / keys (or JWT_LOCAL_VERIFY=0) it works like before: one Supabase Auth call per 60 s."""
    tk = _d["hash_user_id"](token)
    now = time.time()
    with _TOK_LOCK:
        hit = _TOK_CACHE.get(tk)
        bad = _TOK_BAD.get(tk)
    if bad and now - bad < TOK_TTL:
        return None
    if hit and now - hit[2] < TOK_TTL:
        return hit[0], hit[1]
    try:
        claims = jwt_auth.verify(token)
        local = True
    except jwt_auth.Unavailable:
        claims, local = None, False
    if local and claims is None:
        _mark_token_bad(tk)
        return None
    if local:
        uid, email = str(claims["sub"]), str(claims.get("email") or "")
        sk = f"{uid}|{claims.get('session_id') or tk}"
        with _TOK_LOCK:
            last_ok = _SESSION_OK.get(sk, 0.0)
        if now - last_ok >= AUTH_REVALIDATE_SEC:
            try:
                who = _server_get_user(token)
            except Exception as e:
                who = (uid, email)                              # Auth outage: trust the valid signature
                _metrics.inc("auth_degraded_total", help="Logins accepted by local JWT check while Supabase Auth was down")
                if now - _AUTH_DEGRADED["last_log"] > 60:
                    _AUTH_DEGRADED["last_log"] = now
                    print(f"[AUTH] ⚠️ Supabase Auth javob bermadi, lokal JWT tekshiruvi ishlatildi: {str(e)[:120]}")
            else:
                if not who or who[0] != uid:
                    with _TOK_LOCK:
                        _SESSION_OK.pop(sk, None)
                    _mark_token_bad(tk)
                    return None
                with _TOK_LOCK:
                    _SESSION_OK[sk] = now
                    _SESSION_OK.move_to_end(sk)
                    while len(_SESSION_OK) > 50000:
                        _SESSION_OK.popitem(last=False)
    else:
        who = _server_get_user(token)
        if not who:
            _mark_token_bad(tk)
            return None
        uid, email = who
    with _TOK_LOCK:
        _TOK_CACHE[tk] = (uid, email, now)
        while len(_TOK_CACHE) > 5000:
            _TOK_CACHE.popitem(last=False)
    return uid, email
