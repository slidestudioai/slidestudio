"""
Slide Studio — scaling helpers (optional Redis).
Redis yo'q bo'lsa in-memory fallback ishlaydi.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
import threading
from typing import Any, Dict, Optional

def _env(*names, default=""):
    for n in names:
        v = os.environ.get(n)
        if v is not None and str(v).strip():
            return str(v).strip()
    return default

def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

DEEPSEEK_CONCURRENCY = _env_int("DEEPSEEK_CONCURRENCY", 2000)
MAX_WS = _env_int("MAX_WS", 2000)
REDIS_URL = _env("REDIS_URL", "SLIDE_STUDIO_REDIS_URL", default="")
import secrets as _secrets
HMAC_SECRET = _env("SLIDE_STUDIO_HMAC_SECRET", "HMAC_SECRET", default="") or _secrets.token_hex(32)

GEMINI_SEMAPHORE = asyncio.Semaphore(max(1, DEEPSEEK_CONCURRENCY))

_active_sessions: Dict[str, dict] = {}
_sessions_lock = threading.Lock()

_redis = None
_redis_checked = False

async def get_redis():
    global _redis, _redis_checked
    if _redis_checked:
        return _redis
    _redis_checked = True
    if not REDIS_URL:
        return None
    try:
        import redis.asyncio as aioredis
        client = aioredis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        await client.ping()
        _redis = client
        print(f"[REDIS] ✅ ulandi: {REDIS_URL.split('@')[-1]}")
        return _redis
    except Exception as e:
        print(f"[REDIS] ⚠️ ishlatilmaydi (fallback memory): {e}")
        _redis = None
        return None

def hash_user_id(uid: str) -> str:
    """AI user_id — HMAC, xom ID yuborilmaydi."""
    raw = (uid or "anon").encode("utf-8")
    return hmac.new(HMAC_SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()[:32]

def session_key(uid: str, email: str) -> str:
    return uid or email or f"anon-{int(time.time())}"

def register_session_memory(uid: str, email: str, model: str) -> str:
    key = session_key(uid, email)
    with _sessions_lock:
        s = _active_sessions.get(key)
        if not s:
            s = {
                "user_id": uid,
                "email": email or "?",
                "connected_at": time.time(),
                "message_count": 0,
                "blocked": False,
                "tokens_used": 0,
            }
            _active_sessions[key] = s
        s["last_active"] = time.time()
        s["model"] = model
    return key

async def register_session(uid: str, email: str, model: str) -> str:
    key = register_session_memory(uid, email, model)
    r = await get_redis()
    if r:
        try:
            payload = json.dumps({
                "user_id": uid,
                "email": email or "?",
                "model": model,
                "last_active": time.time(),
            })
            await r.hset("slide:sessions", key, payload)
            await r.expire("slide:sessions", 86400)
        except Exception:
            pass
    return key

def bump_msg_memory(key: str) -> int:
    with _sessions_lock:
        if key in _active_sessions:
            _active_sessions[key]["message_count"] += 1
            _active_sessions[key]["last_active"] = time.time()
            return _active_sessions[key]["message_count"]
    return 0

def bump_tokens_memory(key: str, n: int) -> None:
    with _sessions_lock:
        if key in _active_sessions:
            _active_sessions[key]["tokens_used"] = _active_sessions[key].get("tokens_used", 0) + n

def session_stats_memory():
    with _sessions_lock:
        active = len(_active_sessions)
        msgs = sum(s.get("message_count", 0) for s in _active_sessions.values())
        toks = sum(s.get("tokens_used", 0) for s in _active_sessions.values())
    return active, msgs, toks

_local_subscribers: Dict[str, list] = {}
_local_sub_lock = threading.Lock()

async def publish(channel: str, message: dict) -> None:
    r = await get_redis()
    payload = json.dumps(message, ensure_ascii=False)
    if r:
        try:
            await r.publish(f"slide:{channel}", payload)
            return
        except Exception:
            pass

    with _local_sub_lock:
        subs = list(_local_sub_subscribers(channel))
    for q in subs:
        try:
            q.put_nowait(message)
        except Exception:
            pass

def _local_sub_subscribers(channel: str):
    return _local_subscribers.get(channel, [])

def local_subscribe(channel: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    with _local_sub_lock:
        _local_subscribers.setdefault(channel, []).append(q)
    return q

def local_unsubscribe(channel: str, q: asyncio.Queue) -> None:
    with _local_sub_lock:
        lst = _local_subscribers.get(channel, [])
        if q in lst:
            lst.remove(q)

__all__ = [
    "DEEPSEEK_CONCURRENCY",
    "MAX_WS",
    "GEMINI_SEMAPHORE",
    "hash_user_id",
    "register_session",
    "register_session_memory",
    "bump_msg_memory",
    "bump_tokens_memory",
    "session_stats_memory",
    "get_redis",
    "publish",
    "local_subscribe",
    "local_unsubscribe",
    "session_key",
    "_active_sessions",
    "_sessions_lock",
]
