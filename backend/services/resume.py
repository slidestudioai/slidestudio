"""Audit H5: keep the result of an AI turn so a client that lost its connection can get the rest.

How it works
  * The browser sends `request_id` with every AI turn.
  * If the WebSocket breaks while the AI is still writing, the server does NOT stop at once: it finishes the turn
    in the background for at most RESUME_DETACH_SEC seconds (then it stops, like before = Audit C3) and keeps the
    result here (memory) and in public.ai_turn_results (DB, so a reconnect that lands on another worker also works).
  * On reconnect the browser sends {"type": "resume", "request_id"}: it gets `resume_pending` (still writing),
    `resume_result` (the full streamed text — the browser applies only the part it did not get) or `resume_none`.
  * Billing: what was delivered before the break is charged at the end of the turn; the rest (`extra_units`) is
    charged only when it is really delivered by a resume (charge_id = "resume:<request_id>", so never twice).
"""
from __future__ import annotations

import re
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, Optional

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
MEM_TTL = 15 * 60                 # detached turns (the client really lost the connection)
MEM_TTL_NORMAL = 120              # normal turns: only for the rare "end message lost" case
MEM_MAX = 500

_mem: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
_lock = threading.Lock()
_db_state = {"ok": True, "checked": 0.0}
_get_sb: Callable[[], Any] = lambda: None


def configure(supabase_getter: Callable[[], Any]) -> None:
    global _get_sb
    _get_sb = supabase_getter


def valid_request_id(rid: Any) -> Optional[str]:
    rid = str(rid or "").strip()
    return rid if REQUEST_ID_RE.match(rid) else None


def _db():
    sb = _get_sb()
    if not sb:
        return None
    if not _db_state["ok"] and time.time() - _db_state["checked"] < 600:
        return None
    return sb


def _db_error(e: Exception) -> None:
    m = str(e).lower()
    if "ai_turn_results" in m and ("does not exist" in m or "could not find" in m or "pgrst205" in m or "42p01" in m):
        if _db_state["ok"]:
            print("[RESUME] ⚠️ public.ai_turn_results jadvali yo'q — faqat xotira ishlatiladi "
                  "(SUPABASE_SCHEMA.sql 14-bo'lim).")
        _db_state.update(ok=False, checked=time.time())
    else:
        print(f"[RESUME] DB: {str(e)[:160]}")


def _prune_locked(now: float) -> None:
    for k in [k for k, v in _mem.items() if now - v["ts"] > v.get("ttl", MEM_TTL)]:
        _mem.pop(k, None)
    while len(_mem) > MEM_MAX:
        _mem.popitem(last=False)


def start(rid: str, uid: str) -> None:
    now = time.time()
    with _lock:
        _mem[rid] = {"uid": str(uid), "status": "running", "ts": now}
        _mem.move_to_end(rid)
        _prune_locked(now)


def detached(rid: str, uid: str) -> None:
    """The client is gone — make the 'running' state visible to other workers."""
    sb = _db()
    if not sb:
        return
    try:
        sb.table("ai_turn_results").upsert({"request_id": rid, "user_id": str(uid), "status": "running"},
                                           on_conflict="request_id").execute()
    except Exception as e:
        _db_error(e)


def finish(rid: str, uid: str, *, stream_text: str, end_payload: Dict[str, Any], extra_units: int,
           mode: str, was_detached: bool) -> None:
    now = time.time()
    entry = {"uid": str(uid), "status": "done", "ts": now, "stream_text": stream_text[:200000], "end": end_payload,
             "extra_units": int(extra_units), "mode": mode, "ttl": MEM_TTL if was_detached else MEM_TTL_NORMAL}
    with _lock:
        _mem[rid] = entry
        _mem.move_to_end(rid)
        _prune_locked(now)
    if not was_detached:
        return                                   # normal turns never touch the DB
    sb = _db()
    if not sb:
        return
    try:
        sb.table("ai_turn_results").upsert({
            "request_id": rid, "user_id": str(uid), "status": "done", "reply": stream_text[:200000],
            "end_payload": end_payload, "extra_units": int(extra_units), "mode": mode,
        }, on_conflict="request_id").execute()
    except Exception as e:
        _db_error(e)


def abort(rid: str, uid: str, was_detached: bool) -> None:
    with _lock:
        e = _mem.get(rid)
        if e and e["uid"] == str(uid):
            e.update(status="aborted", ts=time.time())
    if was_detached and _db():
        try:
            _get_sb().table("ai_turn_results").update({"status": "aborted"}).eq("request_id", rid).execute()
        except Exception as e:
            _db_error(e)


def lookup(rid: str, uid: str) -> Optional[Dict[str, Any]]:
    """{'status': running|done|aborted, ...} for THIS user only, or None."""
    with _lock:
        e = _mem.get(rid)
        if e and time.time() - e["ts"] <= e.get("ttl", MEM_TTL):
            return dict(e) if e["uid"] == str(uid) else None
    sb = _db()
    if not sb:
        return None
    try:
        rows = (sb.table("ai_turn_results").select("user_id,status,reply,end_payload,extra_units,mode,created_at")
                .eq("request_id", rid).eq("user_id", str(uid)).limit(1).execute().data or [])
    except Exception as e:
        _db_error(e)
        return None
    if not rows:
        return None
    r = rows[0]
    return {"uid": str(uid), "status": r.get("status") or "running", "stream_text": r.get("reply") or "",
            "end": r.get("end_payload") or {}, "extra_units": int(r.get("extra_units") or 0),
            "mode": r.get("mode") or "fast"}
