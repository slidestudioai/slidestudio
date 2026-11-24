"""Testlar uchun in-memory Supabase (faqat loyihada ishlatiladigan metodlar).

Haqiqiy bazaga ulanmaydi. user_usage / payment_events / tg_links ... jadvallari oddiy ro'yxatlarda saqlanadi.
SQL funksiyalari (apply_payment, transfer_paid_credits) SUPABASE_SCHEMA.sql dagi mantiq bilan bir xil yozilgan.
"""
from __future__ import annotations

import re
import threading
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional

UNIQUE_KEYS = {"payment_events": "order_id", "user_usage": "user_id", "tg_link_codes": "code",
               "referrals": "invitee_id", "referral_codes": "user_id", "tg_prefs": "tg_id",
               "tg_pending_refs": "tg_id"}


class FakeAPIError(Exception):
    pass


class _Res:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, db: "FakeSupabase", table: str):
        self.db, self.table, self.op = db, table, "select"
        self.filters: List[Callable[[dict], bool]] = []
        self.payload: Any = None
        self._limit: Optional[int] = None
        self._count = None

    # --- operatsiyalar ---
    def select(self, cols="*", count=None):
        self.op, self._count = "select", count
        return self

    def insert(self, row):
        self.op, self.payload = "insert", row
        return self

    def upsert(self, row, on_conflict=None):
        self.op, self.payload = "upsert", row
        return self

    def update(self, patch):
        self.op, self.payload = "update", patch
        return self

    def delete(self):
        self.op = "delete"
        return self

    # --- filtrlar ---
    @property
    def not_(self):                     # postgrest: q.not_.like(...) — keyingi filtr teskari
        self._neg = True
        return self

    def _add(self, fn):
        if getattr(self, "_neg", False):
            self._neg = False
            self.filters.append(lambda r, f=fn: not f(r))
        else:
            self.filters.append(fn)
        return self

    def eq(self, col, val):
        return self._add(lambda r: str(r.get(col)) == str(val))

    def like(self, col, pattern):
        rx = re.compile("^" + re.escape(pattern).replace("%", ".*") + "$")
        return self._add(lambda r: bool(rx.match(str(r.get(col) or ""))))

    def ilike(self, col, pattern):
        rx = re.compile("^" + re.escape(pattern).replace("%", ".*") + "$", re.I)
        return self._add(lambda r: bool(rx.match(str(r.get(col) or ""))))

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r.get(col) < val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))
        return self

    def is_(self, col, val):
        want = None if str(val).lower() == "null" else val
        self.filters.append(lambda r: r.get(col) is want if want is None else str(r.get(col)) == str(want))
        return self

    def or_(self, expr):                # postgrest: "a.ilike.%x%,b.eq.y" (faqat ilike / eq)
        parts = []
        for chunk in str(expr).split(","):
            col, op, val = chunk.split(".", 2)
            if op == "ilike":
                rx = re.compile("^" + re.escape(val).replace("%", ".*") + "$", re.I)
                parts.append(lambda r, c=col, rx=rx: bool(rx.match(str(r.get(c) or ""))))
            else:
                parts.append(lambda r, c=col, v=val: str(r.get(c)) == v)
        return self._add(lambda r: any(f(r) for f in parts))

    def in_(self, col, vals):
        vs = {str(v) for v in vals}
        return self._add(lambda r: str(r.get(col)) in vs)

    def range(self, a, b):
        self._range = (a, b)
        return self

    def order(self, col=None, desc=False, nullsfirst=None, **k):
        if col:
            self._orders = getattr(self, "_orders", []) + [(col, desc, nullsfirst)]
        return self

    def limit(self, n):
        self._limit = n
        return self

    def _match(self, r):
        return all(f(r) for f in self.filters)

    def execute(self):
        with self.db.lock:
            rows = self.db.tables.setdefault(self.table, [])
            self.db.calls.append((self.table, self.op))
            if self.table in self.db.fail_tables:
                raise FakeAPIError(f"forced failure on {self.table}")
            if self.op == "select":
                out = [dict(r) for r in rows if self._match(r)]
                for col, desc, nf in reversed(getattr(self, "_orders", [])):   # barqaror saralash: oxirgi kalit birinchi
                    if col in self.db.missing_columns.get(self.table, ()):
                        raise FakeAPIError(f"column {self.table}.{col} does not exist")
                    have = [r for r in out if r.get(col) is not None]
                    none = [r for r in out if r.get(col) is None]
                    have.sort(key=lambda r: str(r.get(col)), reverse=bool(desc))
                    out = (none + have) if (nf if nf is not None else not desc) else (have + none)
                total = len(out)
                if getattr(self, "_range", None):
                    a, b = self._range
                    out = out[a:b + 1]
                if self._limit is not None:
                    out = out[: self._limit]
                return _Res(out, total if self._count else None)
            if self.op in ("insert", "upsert"):
                items = self.payload if isinstance(self.payload, list) else [self.payload]
                key = UNIQUE_KEYS.get(self.table)
                for it in items:
                    if key:
                        ex = [r for r in rows if r.get(key) == it.get(key)]
                        if ex:
                            if self.op == "upsert":
                                ex[0].update(it)
                                continue
                            raise FakeAPIError("duplicate key value violates unique constraint (23505)")
                    rows.append(dict(it))
                return _Res([dict(i) for i in items])
            if self.op == "update":
                hit = [r for r in rows if self._match(r)]
                for r in hit:
                    r.update(self.payload)
                return _Res([dict(r) for r in hit])
            if self.op == "delete":
                hit = [r for r in rows if self._match(r)]
                self.db.tables[self.table] = [r for r in rows if not self._match(r)]
                return _Res([dict(r) for r in hit])
        raise AssertionError(self.op)


class _Rpc:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return _Res(self.fn())


class _Auth:
    def __init__(self, db):
        self.db = db
        self.admin = SimpleNamespace(get_user_by_id=self._by_id)

    def get_user(self, token):
        u = self.db.users.get(token)
        return SimpleNamespace(user=u) if u else None

    def _by_id(self, uid):
        for u in self.db.users.values():
            if u.id == uid:
                return SimpleNamespace(user=u)
        return SimpleNamespace(user=None)


class FakeSupabase:
    def __init__(self):
        self.tables: Dict[str, List[dict]] = {}
        self.users: Dict[str, Any] = {}
        self.calls: list = []
        self.fail_tables: set = set()
        self.missing_rpc: set = set()
        self.fail_rpc: set = set()
        self.missing_columns: Dict[str, set] = {}
        self.lock = threading.RLock()
        self.auth = _Auth(self)

    def add_user(self, token: str, uid: str, email: str, created_at: str = "2026-11-01T00:00:00+00:00"):
        self.users[token] = SimpleNamespace(id=uid, email=email, created_at=created_at, user_metadata={}, app_metadata={})

    def table(self, name):
        return _Query(self, name)

    def usage(self, uid) -> Optional[dict]:
        for r in self.tables.get("user_usage", []):
            if r["user_id"] == uid:
                return r
        return None

    def rpc(self, name, params):
        if name in self.missing_rpc:
            raise FakeAPIError(f"Could not find the function public.{name} (PGRST202)")
        if name == "apply_payment":
            return _Rpc(lambda: self._apply_payment(**params))
        if name == "transfer_paid_credits":
            return _Rpc(lambda: self._transfer(**params))
        if name == "charge_units":
            if "charge_units" in self.fail_rpc:
                raise FakeAPIError("connection reset (simulated outage)")
            return _Rpc(lambda: self._charge_units(**params))
        raise FakeAPIError(f"Could not find the function public.{name} (PGRST202)")

    # --- SUPABASE_SCHEMA.sql dagi funksiyalar nusxasi ---
    def _apply_payment(self, p_key, p_user_id, p_pages, p_units, p_sign, p_event=None):
        with self.lock:
            ev = self.tables.setdefault("payment_events", [])
            if any(r["order_id"] == p_key for r in ev):
                return {"duplicate": True}
            u = self.usage(p_user_id)
            if not u:
                raise FakeAPIError("user_not_found")
            ev.append({"order_id": p_key, "user_id": p_user_id, "pages": p_pages, "units": p_units, "event_name": p_event})
            u["paid_credits"] = max(0, int(u.get("paid_credits") or 0) + p_sign * p_units)
            u["slide_credits"] = int(u.get("free_credits") or 0) + u["paid_credits"]
            return {"duplicate": False, "paid_credits": u["paid_credits"], "free_credits": u["free_credits"]}

    def _charge_units(self, p_user_id, p_units, p_reason, p_daily_units, p_max_debt, p_tokens=0, p_searches=0,
                      p_details=None, p_charge_id=None):
        """Copy of public.charge_units (SUPABASE_SCHEMA.sql, section 13)."""
        from datetime import datetime, timedelta, timezone
        with self.lock:
            u = self.usage(p_user_id)
            if not u:
                raise FakeAPIError("user_not_found")
            led = self.tables.setdefault("usage_ledger", [])
            if p_charge_id and any(r.get("charge_id") == p_charge_id for r in led):
                return {"duplicate": True, "charged": 0, "reason": "duplicate", "free_credits": u["free_credits"],
                        "paid_credits": u["paid_credits"], "last_reset_time": u.get("last_reset_time")}
            now = datetime.now(timezone.utc)
            free, paid = int(u.get("free_credits") or 0), int(u.get("paid_credits") or 0)
            lr = u.get("last_reset_time")
            last = datetime.fromisoformat(str(lr).replace("Z", "+00:00")) if lr else None
            day = timedelta(hours=24)
            susp = paid > 0                              # v76: pullik balans > 0 -> bepul limit ishlamaydi
            if susp:
                free = 0
                if last is None or now - last < day:
                    last = now - day
            elif last is None or now - last >= day:
                free, last = p_daily_units, now
            else:
                free = min(free, p_daily_units)
            take, reason = 0, (p_reason or "chat")
            if p_units > 0:
                if not susp and free >= p_daily_units:
                    last = now
                total0 = max(0, free + paid)
                take = max(0, min(p_units, free + paid + p_max_debt))
                if take > 0:
                    tf = min(max(0, free), take)
                    free -= tf
                    paid -= take - tf
                    if take > total0:
                        reason += "+debt"
                else:
                    reason = "no_credits"
                if susp and paid <= 0:
                    last = now - day
            else:
                reason = "tokens_only"
            u.update({"free_credits": free, "paid_credits": paid, "slide_credits": free + paid,
                      "last_reset_time": last.isoformat(),
                      "total_tokens": int(u.get("total_tokens") or 0) + max(0, int(p_tokens or 0)),
                      "daily_tokens": int(u.get("daily_tokens") or 0) + max(0, int(p_tokens or 0))})
            if take > 0:
                led.append({"user_id": p_user_id, "kind": reason, "amount": -take, "free_after": free, "paid_after": paid,
                            "searches": int(p_searches or 0), "details": p_details or {}, "charge_id": p_charge_id,
                            "created_at": now.isoformat()})
            spent = sum(-int(r["amount"]) for r in led if r["user_id"] == p_user_id and int(r["amount"]) < 0
                        and datetime.fromisoformat(str(r.get("created_at") or now.isoformat()).replace("Z", "+00:00")) >= last)
            return {"duplicate": False, "charged": take, "reason": reason, "free_credits": free, "paid_credits": paid,
                    "last_reset_time": last.isoformat(), "spent_units": spent}

    def _transfer(self, p_from, p_to):
        with self.lock:
            src, dst = self.usage(p_from), self.usage(p_to)
            paid = max(0, int((src or {}).get("paid_credits") or 0))
            if not paid:
                return {"moved": 0}
            if not dst:
                raise FakeAPIError("user_not_found")
            src["paid_credits"] = 0
            dst["paid_credits"] = int(dst.get("paid_credits") or 0) + paid
            return {"moved": paid}
