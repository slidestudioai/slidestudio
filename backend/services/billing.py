"""Audit M5: billing service (moved from main.py) — atomic charge (H2), balance cache (H4), deferred charges."""
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

from backend.monitoring import (apply_24h_reset, charge_for_ai_turn, daily_units_for, deduct_credits, is_unlimited,
                                max_debt_units, raw_balance, total_credits, turn_cost)

# =============================================================================================
# Audit H4: short per-user cache of /api/user/usage (5-6 DB calls each) and of token -> user lookups.
# =============================================================================================
USAGE_CACHE_TTL = float(_env_int("USAGE_CACHE_TTL", 15))
USAGE_CACHE_FRESH_MIN = 2.0          # ?fresh=1 (payment watchers) is honoured only if the entry is older than this
_USAGE_CACHE: "OrderedDict[str, tuple]" = OrderedDict()
_USAGE_CACHE_LOCK = threading.Lock()


def usage_cache_get(uid: str, fresh: bool = False):
    with _USAGE_CACHE_LOCK:
        hit = _USAGE_CACHE.get(str(uid))
    if not hit:
        return None
    age = time.time() - hit[0]
    if age >= USAGE_CACHE_TTL or (fresh and age >= USAGE_CACHE_FRESH_MIN):
        return None
    return hit[1]


def usage_cache_put(uid: str, payload: dict) -> None:
    with _USAGE_CACHE_LOCK:
        _USAGE_CACHE[str(uid)] = (time.time(), payload)
        _USAGE_CACHE.move_to_end(str(uid))
        while len(_USAGE_CACHE) > 20000:
            _USAGE_CACHE.popitem(last=False)


def usage_cache_drop(uid: str) -> None:
    """Call after ANY balance change in this process (charge, payment, referral)."""
    with _USAGE_CACHE_LOCK:
        _USAGE_CACHE.pop(str(uid), None)


# =============================================================================================
# Audit H2: ATOMIC charge — SQL function public.charge_units (SUPABASE_SCHEMA.sql, section 13).
#   1 HTTP call instead of 4-8, row lock instead of CAS retries, ledger row in the same transaction,
#   idempotent by charge_id (safe to retry). If the function is not installed yet -> old CAS path.
#   If the DB is down -> the charge is queued in memory and retried (not given away for free).
# =============================================================================================
_CHARGE_RPC = {"ok": True, "checked": 0.0}
_PENDING_CHARGES: List[dict] = []
_PENDING_LOCK = threading.Lock()
PENDING_CHARGES_MAX = 10000


def _is_missing_rpc(err: Exception) -> bool:
    m = str(err).lower()
    return "pgrst202" in m or "could not find the function" in m or ("charge_units" in m and "does not exist" in m)


def _charge_rpc_call(job: dict) -> dict:
    r = _sb().rpc("charge_units", {
        "p_user_id": job["uid"], "p_units": int(job["units"]), "p_reason": job["reason"],
        "p_daily_units": int(job["daily"]), "p_max_debt": int(job["max_debt"]),
        "p_tokens": int(job["tokens"]), "p_searches": int(job["searches"]),
        "p_details": job["details"] or {}, "p_charge_id": job["charge_id"],
    }).execute()
    data = r.data
    if isinstance(data, list):
        data = data[0] if data else {}
    if not isinstance(data, dict):
        raise RuntimeError("charge_units: bad response")
    return data


def _charge_units_py(u: dict, units: int, reason: str) -> Tuple[dict, int, str]:
    """Charge an exact number of units (same debt rules as charge_for_ai_turn)."""
    u = apply_24h_reset(u)
    if is_unlimited(u):
        return u, 0, "unlimited"
    total0 = total_credits(u)
    take = max(0, min(int(units), raw_balance(u) + max_debt_units()))
    if take <= 0:
        return u, 0, "no_credits"
    u = deduct_credits(u, take, allow_debt=True)
    return u, take, reason + ("+debt" if take > total0 else "")


def _charge_legacy(uid: str, email: str, pages: int, searches: int, mode: str, tokens: int,
                   details: dict, kind_prefix: str, units_override: Optional[int] = None) -> Tuple[dict, int, str]:
    """Old path (CAS in Python) — used only until the SQL function is installed."""
    def _fn(u):
        u["total_tokens"] = (u.get("total_tokens") or 0) + max(0, tokens)
        u["daily_tokens"] = (u.get("daily_tokens") or 0) + max(0, tokens)
        if units_override is not None:
            u, ch, rs = _charge_units_py(u, units_override, "resume")
        else:
            u, ch, rs = charge_for_ai_turn(u, pages, searches, mode)
        return u, (ch, rs)
    usage, (charged, reason) = _d["update_atomic"](uid, email, _fn)
    if int(charged) > 0:
        _d["ledger_log"](uid, kind_prefix + str(reason), -int(charged), usage, searches, details)
    usage["spent_24h"] = _d["ledger_spent"](uid, usage.get("last_reset_time"))
    return usage, int(charged), str(reason)


def charge_turn_atomic(uid: str, email: str, usage: Optional[dict], pages: int, searches: int, mode: str,
                       tokens: int = 0, details: Optional[dict] = None, kind_prefix: str = "",
                       charge_id: Optional[str] = None, units_override: Optional[int] = None) -> Tuple[dict, int, str]:
    """Charge one AI turn. Returns (usage_after, charged_units, reason). Sync — run it with asyncio.to_thread.
    `usage` = row read earlier (for VIP/daily-limit info); None -> it is read here."""
    import uuid as _uuid
    details = details or {}
    if usage is None:
        usage = _d["get_usage"](uid, email)
    if not _sb() or not uid or str(uid).startswith(("dev-", "anon-", "guest-")):
        if units_override is not None:                                              # dev / guest: memory only
            return _charge_units_py(dict(usage), units_override, "resume")
        u, ch, rs = charge_for_ai_turn(dict(usage), pages, searches, mode)
        return u, ch, rs
    unlimited = is_unlimited(usage)
    if unlimited:
        units, reason = 0, "unlimited"
    elif units_override is not None:
        units, reason = max(0, int(units_override)), "resume"
    else:
        units, reason = turn_cost(pages, searches, mode)
    job = {"uid": str(uid), "email": email or "", "units": units, "reason": kind_prefix + reason,
           "daily": daily_units_for(usage), "max_debt": max_debt_units(), "tokens": max(0, int(tokens or 0)),
           "searches": max(0, int(searches or 0)), "details": details,
           "charge_id": charge_id or _uuid.uuid4().hex, "pages": pages, "mode": mode, "kind_prefix": kind_prefix,
           "units_override": units_override,
           "tries": 0, "first": time.time()}
    usage_cache_drop(uid)
    if units_override is not None and units <= 0 and not unlimited:
        return dict(usage), 0, "none"
    if not _CHARGE_RPC["ok"] and time.time() - _CHARGE_RPC["checked"] < 600:
        return _charge_legacy(uid, email, pages, searches, mode, tokens, details, kind_prefix, units_override)
    last_err = None
    for attempt in range(3):
        try:
            res = _charge_rpc_call(job)
            _CHARGE_RPC["ok"] = True
            out = dict(usage)
            for k in ("free_credits", "paid_credits", "last_reset_time"):
                if k in res:
                    out[k] = res[k]
            out["slide_credits"] = int(out.get("free_credits") or 0) + int(out.get("paid_credits") or 0)
            out["total_tokens"] = int(out.get("total_tokens") or 0) + job["tokens"]
            out["daily_tokens"] = int(out.get("daily_tokens") or 0) + job["tokens"]
            if "spent_units" in res:
                out["spent_24h"] = int(res["spent_units"] or 0)
            _d["cas_version"](out, out.get("free_credits"), out.get("paid_credits"))
            charged = int(res.get("charged") or 0)
            rs = "unlimited" if unlimited else str(res.get("reason") or reason)
            if rs.startswith(kind_prefix) and kind_prefix:
                rs = rs[len(kind_prefix):]
            return out, charged, rs
        except Exception as e:
            if _is_missing_rpc(e):
                if _CHARGE_RPC["ok"]:
                    print("[CHARGE] ⚠️ SQL funksiya public.charge_units yo'q — eski (CAS) yo'l ishlatiladi. "
                          "SUPABASE_SCHEMA.sql 13-bo'limini Supabase SQL Editor'da ishga tushiring.")
                _CHARGE_RPC.update(ok=False, checked=time.time())
                return _charge_legacy(uid, email, pages, searches, mode, tokens, details, kind_prefix, units_override)
            if "user_not_found" in str(e).lower():
                raise
            last_err = e
            time.sleep(0.2 * (attempt + 1))
    # DB is unreachable: do NOT give the turn away for free — queue it and retry in the background
    _queue_pending_charge(job, last_err)
    if units_override is not None:
        u, ch, _ = _charge_units_py(dict(usage), units_override, "resume")
    else:
        u, ch, _ = charge_for_ai_turn(dict(usage), pages, searches, mode)           # best estimate for the UI
    return u, ch, "charge_deferred"


def _queue_pending_charge(job: dict, err: Optional[Exception]) -> None:
    _metrics.inc("charges_deferred_total", help="Charges queued because the DB did not answer")
    with _PENDING_LOCK:
        if len(_PENDING_CHARGES) >= PENDING_CHARGES_MAX:
            print(f"[CHARGE] ❌ navbat to'la — yechim yo'qoldi user={job['uid'][:8]} units={job['units']}")
            return
        _PENDING_CHARGES.append(job)
    print(f"[CHARGE] ⚠️ baza javob bermadi, yechim navbatga qo'yildi user={job['uid'][:8]} "
          f"units={job['units']} id={job['charge_id']} err={str(err)[:120]}")


def retry_pending_charges() -> int:
    """Retries queued charges (same charge_id -> never charged twice). Returns how many are still waiting."""
    with _PENDING_LOCK:
        jobs = list(_PENDING_CHARGES)
        _PENDING_CHARGES.clear()
    keep = []
    for job in jobs:
        try:
            if _CHARGE_RPC["ok"]:
                _charge_rpc_call(job)
            else:
                _charge_legacy(job["uid"], job["email"], job["pages"], job["searches"], job["mode"],
                               job["tokens"], job["details"], job["kind_prefix"], job.get("units_override"))
            usage_cache_drop(job["uid"])
        except Exception as e:
            if _is_missing_rpc(e):
                _CHARGE_RPC.update(ok=False, checked=time.time())
            job["tries"] += 1
            if job["tries"] < 60 and time.time() - job["first"] < 86400:
                keep.append(job)
            else:
                print(f"[CHARGE] ❌ yechim bekor qilindi (60 urinish) user={job['uid'][:8]} units={job['units']}")
    with _PENDING_LOCK:
        _PENDING_CHARGES[:0] = keep
        return len(_PENDING_CHARGES)


async def _pending_charges_loop():
    while True:
        await asyncio.sleep(60)
        try:
            if _PENDING_CHARGES:
                left = await asyncio.to_thread(retry_pending_charges)
                if left:
                    print(f"[CHARGE] navbatda hali {left} ta yechim")
        except Exception as e:
            print(f"[CHARGE] retry loop: {str(e)[:120]}")
