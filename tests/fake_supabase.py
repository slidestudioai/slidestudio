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
               "referrals": "invitee_id", "referral_codes": "user_id"}


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
    def eq(self, col, val):
        self.filters.append(lambda r: str(r.get(col)) == str(val))
        return self

    def like(self, col, pattern):
        rx = re.compile("^" + re.escape(pattern).replace("%", ".*") + "$")
        self.filters.append(lambda r: bool(rx.match(str(r.get(col) or ""))))
        return self

    def lt(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and r.get(col) < val)
        return self

    def gte(self, col, val):
        self.filters.append(lambda r: r.get(col) is not None and str(r.get(col)) >= str(val))
        return self

    def order(self, *a, **k):
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
                if self._limit is not None:
                    out = out[: self._limit]
                return _Res(out, len(out) if self._count else None)
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
