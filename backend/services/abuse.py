"""Audit M2: limit free pages farmed with many new accounts from one network.

Every new Google account gets free daily pages. Making 20 accounts from one computer = 20x free pages.
When a NEW account (created in the last NEW_ACCOUNT_WINDOW) is seen for the first time, we store an HMAC hash of
its IP (the IP itself is never stored). If MAX_FREE_SIGNUPS_PER_IP_DAY other accounts were created from the same
IP hash in the last 24 h, this account gets no free daily pages (daily_units_override = 0). Buying pages still works,
and an admin can give free pages back in the admin panel (user -> daily limit).

Mobile networks put many people behind one IP (CGNAT), so the default limit is generous (3) and 0 turns it off.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

NEW_ACCOUNT_WINDOW = timedelta(minutes=15)
_checked: "OrderedDict[str, float]" = OrderedDict()
_lock = threading.Lock()
_state = {"ok": True, "checked": 0.0}
NOTE = "auto: bir IP'dan 24 soatda juda ko'p yangi akkaunt — bepul varaq berilmadi (Audit M2)"


def limit() -> int:
    try:
        return max(0, int(os.environ.get("MAX_FREE_SIGNUPS_PER_IP_DAY", "3")))
    except ValueError:
        return 3


def ip_hash(ip: str, secret: str) -> str:
    return hmac.new((secret or "ss").encode(), ("ip|" + (ip or "")).encode(), hashlib.sha256).hexdigest()[:32]


def _parse(ts: Any) -> Optional[datetime]:
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _missing_column(e: Exception) -> bool:
    m = str(e).lower()
    return "signup_ip_hash" in m and ("does not exist" in m or "could not find" in m or "column" in m)


def check_new_account(sb: Any, uid: str, row: Dict[str, Any], ip: str, secret: str) -> bool:
    """Call after the user's usage row is read. Returns True if the account was limited just now."""
    lim = limit()
    if not sb or not uid or not ip or ip == "?" or lim <= 0:
        return False
    if str(uid).startswith(("dev-", "anon-", "guest-")):
        return False
    if not _state["ok"] and time.time() - _state["checked"] < 3600:
        return False
    with _lock:
        if uid in _checked:
            return False
        _checked[uid] = time.time()
        while len(_checked) > 50000:
            _checked.popitem(last=False)
    if row.get("signup_ip_hash"):
        return False
    now = datetime.now(timezone.utc)
    created = _parse(row.get("created_at"))
    if created is not None and now - created > NEW_ACCOUNT_WINDOW:
        return False                                   # old account: not a fresh sign-up, nothing to do
    h = ip_hash(ip, secret)
    try:
        res = (sb.table("user_usage").select("user_id", count="exact").eq("signup_ip_hash", h)
               .gte("created_at", (now - timedelta(hours=24)).isoformat()).limit(1).execute())
        others = int(res.count or 0)
        patch: Dict[str, Any] = {"signup_ip_hash": h}
        limited = others >= lim and int(row.get("paid_credits") or 0) <= 0 and row.get("daily_units_override") in (None, "")
        if limited:
            note = (str(row.get("admin_note") or "") + "\n" + NOTE).strip()
            patch.update({"daily_units_override": 0, "free_credits": 0,
                          "slide_credits": int(row.get("paid_credits") or 0), "admin_note": note[:1000]})
        sb.table("user_usage").update(patch).eq("user_id", str(uid)).execute()
        if limited:
            print(f"[ABUSE] {str(uid)[:8]}: bir IP'dan 24 soatda {others} ta boshqa yangi akkaunt — bepul varaq berilmadi")
        return limited
    except Exception as e:
        if _missing_column(e):
            if _state["ok"]:
                print("[ABUSE] ⚠️ user_usage.signup_ip_hash ustuni yo'q — M2 himoyasi o'chiq (SUPABASE_SCHEMA.sql 14-bo'lim).")
            _state.update(ok=False, checked=time.time())
        else:
            print(f"[ABUSE] {str(e)[:160]}")
        return False


def ip_clusters(sb: Any, days: int = 7, min_accounts: int = 3) -> List[Dict[str, Any]]:
    """Admin view: IP hashes with many accounts in the last `days` days (most first)."""
    since = (datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))).isoformat()
    rows = (sb.table("user_usage").select("user_id,email,signup_ip_hash,created_at,paid_credits,daily_units_override")
            .gte("created_at", since).order("created_at", desc=True).limit(5000).execute().data or [])
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        h = r.get("signup_ip_hash")
        if h:
            groups.setdefault(h, []).append(r)
    out = []
    for h, accs in groups.items():
        if len(accs) >= max(2, int(min_accounts)):
            out.append({"ip_hash": h[:12], "accounts": len(accs),
                        "limited": sum(1 for a in accs if a.get("daily_units_override") == 0),
                        "paid": sum(1 for a in accs if int(a.get("paid_credits") or 0) > 0),
                        "last_at": max(str(a.get("created_at") or "") for a in accs),
                        "users": [{"user_id": a.get("user_id"), "email": a.get("email")} for a in accs[:20]]})
    out.sort(key=lambda x: (-x["accounts"], x["last_at"]))
    return out[:100]
