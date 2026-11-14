"""
Slide Studio — ADMIN YADROSI (v47)

XAVFSIZLIK MODELI
  * Admin = Telegram ID (ADMIN_TG_IDS) VA unga ulangan Google email (ADMIN_EMAILS) — IKKALASI ham mos kelishi shart.
  * Panelga ochiq havola YO'Q. Botda faqat tasdiqlangan admin «admin» deb yozsa, imzolangan vaqtinchalik
    havola (Mini App tugmasi) beriladi. Saytda — faqat admin akkaunt kirgan bo'lsa sozlamalarda yashirin tugma chiqadi.
  * Panel manzili /_a/<imzolangan-token>; API /_a/api/<amal> — token yo'q/yaroqsiz bo'lsa HAR DOIM 404
    (panel mavjudligi ham sezilmaydi). Token 3 soat yashaydi va har so'rovda admin ro'yxati qayta tekshiriladi.
  * Admin akkauntlar (Google email va admin Telegram akkaunti) avtomatik VIP: cheksiz, reklamasiz.
  * Har bir admin amali `admin_audit` jurnaliga yoziladi.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from backend import ads, appsettings
from backend import monitoring as mon

router = APIRouter()
_deps: Dict[str, Any] = {}
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PANEL_FILE = os.path.join(BASE_DIR, "admin", "panel.html")
TOKEN_TTL = 3 * 3600
TG_EMAIL_RE = re.compile(r"^tg(\d+)@t\.me$", re.I)
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_RUNTIME_SECRET = secrets.token_hex(32)


class AdminError(Exception):
    def __init__(self, msg: str, code: int = 400):
        super().__init__(msg)
        self.msg, self.code = msg, code


def configure(**kw: Any) -> None:
    """main.py dan: supabase_getter, get_usage, ledger_log, tg_send, tg_notify, state (pause/ws), config ..."""
    _deps.update(kw)


def _sb():
    g = _deps.get("supabase_getter")
    return g() if g else None


# ----------------------------------------------------------------------------------------------
# Kimligi: adminlar (env) va VIP
# ----------------------------------------------------------------------------------------------
def _csv(name: str) -> List[str]:
    return [x.strip() for x in re.split(r"[,\s;]+", os.environ.get(name, "") or "") if x.strip()]


def admin_emails() -> set:
    return {e.lower() for e in _csv("ADMIN_EMAILS")}


def admin_tg_ids() -> set:
    out = set()
    for x in _csv("ADMIN_TG_IDS") + _csv("ADMIN_TELEGRAM_IDS") + _csv("ADMIN_TELEGRAM_ID"):
        try:
            out.add(int(x))
        except ValueError:
            pass
    return out


def is_tg_admin(tg_id: Any) -> bool:
    try:
        return int(tg_id) in admin_tg_ids()
    except (TypeError, ValueError):
        return False


_vip_cache: Dict[str, Tuple[bool, float]] = {}


def is_vip_account(uid: str, email: str) -> bool:
    """Admin akkauntlar (Google email yoki admin Telegram akkaunti) — VIP: cheksiz va reklamasiz."""
    e = (email or "").strip().lower()
    if e and e in admin_emails():
        return True
    m = TG_EMAIL_RE.match(e)
    if not m or int(m.group(1)) not in admin_tg_ids():
        return False
    # tg<ID>@t.me — faqat bot yaratgan (app_metadata.telegram_id mos) akkaunt; boshqa birov shu emailni egallay olmasin
    hit = _vip_cache.get(uid)
    if hit and time.time() - hit[1] < 600:
        return hit[0]
    ok = False
    sb = _sb()
    if sb and uid:
        try:
            u = sb.auth.admin.get_user_by_id(uid)
            meta = getattr(getattr(u, "user", None), "app_metadata", None) or {}
            ok = str(meta.get("telegram_id")) == m.group(1)
        except Exception:
            ok = False
    elif not sb and str(uid).startswith("dev-tg"):
        ok = True
    _vip_cache[uid] = (ok, time.time())
    if len(_vip_cache) > 2000:
        _vip_cache.clear()
    return ok


def _linked_row_by_tg(tg_id: int) -> Optional[Dict[str, Any]]:
    sb = _sb()
    if not sb:
        return None
    try:
        r = sb.table("tg_links").select("user_id,email").eq("tg_id", int(tg_id)).limit(1).execute().data
        return r[0] if r else None
    except Exception:
        return None


def _linked_row_by_uid(uid: str) -> Optional[Dict[str, Any]]:
    sb = _sb()
    if not sb:
        return None
    try:
        r = sb.table("tg_links").select("tg_id,email").eq("user_id", str(uid)).limit(1).execute().data
        return r[0] if r else None
    except Exception:
        return None


def check_admin_tg(tg_id: Any) -> Dict[str, Any]:
    """Bot uchun. {'ok':bool,'reason':'not_admin'|'not_configured'|'not_linked'|'email_mismatch'|'ok','email':str}"""
    if not is_tg_admin(tg_id):
        return {"ok": False, "reason": "not_admin"}
    if not admin_emails():
        return {"ok": False, "reason": "not_configured"}
    row = _linked_row_by_tg(int(tg_id))
    if not row:
        return {"ok": False, "reason": "not_linked"}
    email = str(row.get("email") or "").lower()
    if email not in admin_emails():
        return {"ok": False, "reason": "email_mismatch", "email": email}
    return {"ok": True, "reason": "ok", "email": email, "uid": str(row.get("user_id"))}


def check_admin_user(uid: str, email: str) -> Dict[str, Any]:
    """Sayt uchun: Google akkaunt admin emaili VA unga ulangan Telegram admin ID."""
    e = (email or "").strip().lower()
    if not e or e not in admin_emails():
        return {"ok": False, "reason": "not_admin"}
    row = _linked_row_by_uid(uid)
    if not row or not is_tg_admin(row.get("tg_id")):
        return {"ok": False, "reason": "not_linked"}
    return {"ok": True, "reason": "ok", "email": e, "tg_id": int(row["tg_id"])}


# ----------------------------------------------------------------------------------------------
# Imzolangan tokenlar
# ----------------------------------------------------------------------------------------------
def _secret() -> bytes:
    s = os.environ.get("SLIDE_STUDIO_HMAC_SECRET") or ""
    if not s:
        gk = _deps.get("secret_hint")
        s = (gk() if callable(gk) else "") or _RUNTIME_SECRET
    return ("ss-admin|" + s).encode()


def make_token(tg_id: int, email: str, ttl: int = TOKEN_TTL) -> str:
    body = base64.urlsafe_b64encode(json.dumps({"k": "adm", "t": int(tg_id), "e": email.lower(), "x": int(time.time()) + ttl},
                                               separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{body}.{sig}"


def verify_token(tok: str) -> Optional[Dict[str, Any]]:
    try:
        body, sig = (tok or "").split(".", 1)
        good = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()[:40]
        if not hmac.compare_digest(sig, good):
            return None
        p = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if p.get("k") != "adm" or int(p.get("x", 0)) < time.time():
            return None
        if int(p["t"]) not in admin_tg_ids() or str(p.get("e", "")).lower() not in admin_emails():
            return None
        return p
    except Exception:
        return None


def panel_url(base: str, tg_id: int, email: str) -> str:
    return f"{base.rstrip('/')}/_a/{make_token(tg_id, email)}"


# ----------------------------------------------------------------------------------------------
# Yordamchilar: jurnal, foydalanuvchi o'qish/yozish
# ----------------------------------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_z(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def audit(actor: str, action: str, target: str = "", details: Optional[dict] = None) -> None:
    sb = _sb()
    if not sb:
        return
    try:
        sb.table("admin_audit").insert({"actor": actor, "action": action, "target": str(target)[:120], "details": details or {}}).execute()
    except Exception as e:
        print(f"[ADMIN] audit yozilmadi: {str(e)[:80]}")


USER_COLS = "user_id,email,free_credits,paid_credits,plan,plan_until,unlimited,daily_units_override,blocked,admin_note,last_reset_time,last_active,total_tokens,created_at"
USER_COLS_CORE = "user_id,email,free_credits,paid_credits,blocked,last_reset_time,last_active,total_tokens,created_at"


def _select_users(q):
    """Yangi ustunlar (plan...) bo'lmasa ham ishlaydi (migratsiya hali ishga tushirilmagan bo'lsa)."""
    try:
        return q(USER_COLS).execute().data or [], True
    except Exception:
        try:
            return q(USER_COLS_CORE).execute().data or [], False
        except Exception as e:
            raise AdminError(f"Bazadan o'qib bo'lmadi: {str(e)[:120]}", 502)


def _tg_map(user_ids: List[str]) -> Dict[str, int]:
    sb = _sb()
    out: Dict[str, int] = {}
    if not sb or not user_ids:
        return out
    try:
        rows = sb.table("tg_links").select("user_id,tg_id").in_("user_id", [str(u) for u in user_ids]).execute().data or []
        for r in rows:
            out[str(r["user_id"])] = int(r["tg_id"])
    except Exception:
        pass
    return out


def _brief(row: Dict[str, Any], tgmap: Dict[str, int]) -> Dict[str, Any]:
    # Sayt va bot ko'rsatadigan HAQIQIY balans (24 soatlik bepul tiklanish hisobga olingan).
    # Avval xom qator ko'rsatilardi: bot «9.75» desa, sayt «10» ko'rsatardi.
    u = mon.apply_24h_reset(dict(row))
    uid = str(row.get("user_id"))
    email = str(row.get("email") or "")
    vip_rt = False
    try:
        vip_rt = is_vip_account(uid, email)
    except Exception:
        pass
    u["vip"] = vip_rt
    m = TG_EMAIL_RE.match(email)
    tg_id = tgmap.get(uid) or (int(m.group(1)) if m else None)
    plan = mon.plan_active(u)
    return {
        "user_id": uid, "email": email, "tg_id": tg_id, "linked": uid in tgmap, "tg_only": bool(m),
        "plan": plan, "plan_until": None,
        "unlimited": mon.is_unlimited(u), "unlimited_flag": bool(row.get("unlimited")), "vip_admin": vip_rt,
        "free_pages": round(int(u["free_credits"]) / mon.UNIT, 2), "paid_pages": round(int(u["paid_credits"]) / mon.UNIT, 2),
        "daily_override_pages": (None if row.get("daily_units_override") in (None, "") else round(int(row["daily_units_override"]) / mon.UNIT, 2)),
        "daily_pages": round(mon.daily_units_for(u) / mon.UNIT, 2),
        "blocked": bool(row.get("blocked")), "note": row.get("admin_note") or "",
        "last_active": row.get("last_active"), "created_at": row.get("created_at"), "total_tokens": row.get("total_tokens") or 0,
    }


def _find_users(q: str, flt: str, limit: int, offset: int) -> List[Dict[str, Any]]:
    sb = _sb()
    q = (q or "").strip()
    limit = max(1, min(100, int(limit or 30)))
    offset = max(0, int(offset or 0))

    def build(cols):
        qq = sb.table("user_usage").select(cols)
        if q:
            if UUID_RE.match(q):
                qq = qq.eq("user_id", q)
            elif q.lstrip("@").isdigit():
                qq = qq.eq("email", f"tg{int(q.lstrip('@'))}@t.me")
            else:
                safe = re.sub(r"[%,()*]", "", q)[:80]
                qq = qq.ilike("email", f"%{safe}%")
        if flt == "vip":
            qq = qq.eq("plan", "vip")
        elif flt == "unlimited":
            qq = qq.eq("unlimited", True)
        elif flt == "blocked":
            qq = qq.eq("blocked", True)
        elif flt == "tg":
            qq = qq.like("email", "tg%@t.me")
        return qq.order("last_active", desc=True).range(offset, offset + limit - 1)

    rows, _full = _select_users(build)
    tg_by_uid = _tg_map([r["user_id"] for r in rows])
    # tg_id orqali qidirilganda: ulangan Google akkauntni ham topamiz
    if q.lstrip("@").isdigit() and not rows:
        row = _linked_row_by_tg(int(q.lstrip("@")))
        if row:
            rows, _ = _select_users(lambda cols: sb.table("user_usage").select(cols).eq("user_id", str(row["user_id"])))
            tg_by_uid = _tg_map([r["user_id"] for r in rows])
    return [_brief(r, tg_by_uid) for r in rows]


def _get_user_row(uid: str) -> Dict[str, Any]:
    sb = _sb()
    rows, _ = _select_users(lambda cols: sb.table("user_usage").select(cols).eq("user_id", str(uid)).limit(1))
    if not rows:
        raise AdminError("Foydalanuvchi topilmadi", 404)
    return rows[0]


def resolve_target(q: str) -> Dict[str, Any]:
    """Bot admin buyruqlari uchun: Telegram ID / email / UUID -> user_usage qatori.
    Telegram ID ulangan Google akkauntga ishora qilsa, SHU akkaunt olinadi (bot balansni shu yerdan o'qiydi)."""
    q = (q or "").strip().lstrip("@")
    sb = _sb()
    if not q or not sb:
        raise AdminError("Foydalanuvchi ID/email kiriting")
    if q.isdigit():
        row = _linked_row_by_tg(int(q))
        if row:
            return _get_user_row(str(row["user_id"]))
        rows, _ = _select_users(lambda cols: sb.table("user_usage").select(cols).eq("email", f"tg{int(q)}@t.me").limit(1))
        if rows:
            return rows[0]
        raise AdminError("Topilmadi. Foydalanuvchi botga hali /start bosmagan.", 404)
    if UUID_RE.match(q):
        return _get_user_row(q)
    if "@" in q:
        em = q.lower()
        rows, _ = _select_users(lambda cols: sb.table("user_usage").select(cols).eq("email", em).limit(20))
        if len(rows) > 1:
            # 1 email = 1 balans: avval eski (Auth'da yo'q) akkaunt qoldiqlari birlashtiriladi
            try:
                res = merge_email_accounts("admin-lookup", em)
                if res.get("target"):
                    return _get_user_row(str(res["target"]))
            except AdminError:
                pass                                   # Auth tekshirilmadi — barqaror tanlov + ogohlantirish
        if rows:
            return _pick_account(rows)
    raise AdminError("Topilmadi. Telegram ID, email yoki UUID yozing.", 404)


def _pick_account(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Bir email bilan bir nechta user_usage qatori bo'lishi mumkin (masalan, ikki xil kirish usuli).
    Avval `.limit(1)` ishlatilardi: Postgres har safar BOSHQA qatorni qaytarishi mumkin (UPDATE dan keyin tartib
    o'zgaradi) — /give va /take navbatma-navbat turli akkauntlarga tushardi. Endi tanlov BARQAROR:
    Telegram'ga ulangan akkaunt > oxirgi faol > eng eski. Qolganlari `_dupes` da qaytadi (adminga ogohlantirish)."""
    if len(rows) == 1:
        return rows[0]
    linked = set(_tg_map([str(r.get("user_id")) for r in rows]).keys())

    def key(r):
        return (str(r.get("user_id")) in linked, str(r.get("last_active") or ""),
                "" if r.get("created_at") is None else str(r.get("created_at")))
    ordered = sorted(rows, key=key, reverse=True)
    best = dict(ordered[0])
    best["_dupes"] = [_brief(r, {}) for r in ordered[1:]]
    return best


# ----------------------------------------------------------------------------------------------
# v66: BIR EMAIL = BIR AKKAUNT = BIR BALANS
# Supabase Auth bitta email uchun bitta foydalanuvchi saqlaydi. user_usage da bir email bilan bir nechta qator
# bo'lsa — ortiqchalari ESKI (Auth'dan o'chirilgan) akkauntlar qoldig'i. Ularning pullik varaqlari,
# cheksiz/VIP belgisi va tokenlari HAQIQIY akkauntga ko'chiriladi, eski qator o'chiriladi, Telegram ulanishi
# haqiqiy akkauntga o'tkaziladi. Bepul (kunlik) varaqlar ko'chirilmaydi.
# ----------------------------------------------------------------------------------------------
def _auth_alive(uid: str) -> Optional[bool]:
    """True = Supabase Auth'da bor, False = yo'q (o'chirilgan), None = tekshirib bo'lmadi (hech narsa qilinmaydi)."""
    sb = _sb()
    try:
        res = sb.auth.admin.get_user_by_id(str(uid))
        return bool(getattr(res, "user", None))
    except Exception as e:
        m = str(e).lower()
        if "not found" in m or "user_not_found" in m or "404" in m or ("invalid" in m and "uuid" in m):
            return False
        return None


def _email_rows(email: str) -> List[Dict[str, Any]]:
    sb = _sb()
    rows, _ = _select_users(lambda cols: sb.table("user_usage").select(cols).eq("email", email).limit(50))
    return rows


def merge_email_accounts(actor: str, email: str, keep_uid: str = "") -> Dict[str, Any]:
    """Bir email'dagi barcha qatorlarni bitta (Auth'da mavjud) akkauntga birlashtiradi.
    keep_uid berilsa (foydalanuvchi hozir shu uid bilan kirgan) — o'sha saqlanadi."""
    email = (email or "").strip().lower()
    if not email or "@" not in email or TG_EMAIL_RE.match(email) or email.endswith("@slidestudio.local"):
        return {"ok": True, "merged": 0, "reason": "skip"}
    rows = _email_rows(email)
    if len(rows) <= 1:
        return {"ok": True, "merged": 0, "target": str(rows[0]["user_id"]) if rows else None}
    alive: Dict[str, Optional[bool]] = {}
    for r in rows:
        uid = str(r["user_id"])
        alive[uid] = True if keep_uid and uid == str(keep_uid) else _auth_alive(uid)
    if any(v is None for v in alive.values()):
        raise AdminError("Supabase Auth'ni tekshirib bo'lmadi — birlashtirish to'xtatildi (hech narsa o'zgarmadi).", 502)
    live = [r for r in rows if alive[str(r["user_id"])]]
    if keep_uid and any(str(r["user_id"]) == str(keep_uid) for r in rows):
        target = next(r for r in rows if str(r["user_id"]) == str(keep_uid))
    elif live:
        target = _pick_account(live)
    else:
        raise AdminError("Bu email uchun Supabase Auth'da faol akkaunt yo'q. Foydalanuvchi saytga Google bilan "
                         "bir marta kirsin, keyin qayta urinib ko'ring.", 409)
    tuid = str(target["user_id"])
    dead = [r for r in rows if not alive[str(r["user_id"])] and str(r["user_id"]) != tuid]
    sb = _sb()
    moved_units, merged = 0, 0
    for r in dead:
        ruid = str(r["user_id"])
        # 1) eski qatordagi pullik varaqlarni "olib qo'yamiz" (CAS: shu orada o'zgarmagan bo'lsa)
        for _ in range(5):
            cur = _get_user_row(ruid)
            units = int(cur.get("paid_credits") or 0)
            if units <= 0 or _cas_update_credits(ruid, {"paid_credits": 0, "slide_credits": int(cur.get("free_credits") or 0)}, cur):
                break
        else:
            raise AdminError("Eski akkaunt balansi o'zgarib turibdi, keyinroq urinib ko'ring.", 409)
        # 2) haqiqiy akkauntga qo'shamiz (CAS)
        if units > 0:
            for _ in range(5):
                trow = _get_user_row(tuid)
                tc = mon.normalize_user_row(trow)
                newp = int(tc["paid_credits"]) + units
                if _cas_update_credits(tuid, {"paid_credits": newp, "slide_credits": int(tc["free_credits"]) + newp}, trow):
                    break
            else:   # qaytaramiz — varaq yo'qolmasin
                _cas_update_credits(ruid, {"paid_credits": units}, {**cur, "paid_credits": 0})
                raise AdminError("Asosiy akkaunt balansi o'zgarib turibdi, keyinroq urinib ko'ring.", 409)
            moved_units += units
            _ledger(tuid, "account_merge_in", units, {**trow, "paid_credits": newp}, {"from": ruid, "by": actor})
        # 3) cheksiz / VIP / tokenlar
        flags: Dict[str, Any] = {}
        trow = _get_user_row(tuid)
        if r.get("unlimited") and not trow.get("unlimited"):
            flags["unlimited"] = True
        if str(r.get("plan") or "") == "vip" and str(trow.get("plan") or "free") != "vip":
            flags["plan"], flags["plan_until"] = "vip", r.get("plan_until")
        tok = int(r.get("total_tokens") or 0)
        if tok:
            flags["total_tokens"] = int(trow.get("total_tokens") or 0) + tok
        if flags:
            try:
                _update_user(tuid, flags)
            except AdminError:
                pass
        # 4) Telegram ulanishi eski akkauntda bo'lsa — haqiqiy akkauntga
        try:
            links = sb.table("tg_links").select("tg_id,user_id").eq("user_id", ruid).execute().data or []
            has_t = sb.table("tg_links").select("tg_id").eq("user_id", tuid).limit(1).execute().data or []
            for ln in links:
                if has_t:
                    sb.table("tg_links").delete().eq("tg_id", ln["tg_id"]).execute()
                else:
                    sb.table("tg_links").update({"user_id": tuid, "email": email}).eq("tg_id", ln["tg_id"]).execute()
                    has_t = [ln]
        except Exception:
            pass
        # 5) eski qatorni o'chiramiz (Auth'da yo'q — hech kim u bilan kira olmaydi)
        try:
            sb.table("user_usage").delete().eq("user_id", ruid).execute()
        except Exception:
            pass
        merged += 1
    left_alive = [str(r["user_id"]) for r in rows if alive[str(r["user_id"])] and str(r["user_id"]) != tuid]
    if merged or left_alive:
        audit(actor, "user.merge", tuid, {"email": email, "merged": merged, "moved_units": moved_units, "alive_others": left_alive})
    return {"ok": True, "target": tuid, "merged": merged, "moved_pages": round(moved_units / mon.UNIT, 2),
            "alive_others": left_alive}


def merge_all_duplicates(actor: str, limit: int = 500) -> Dict[str, Any]:
    """Bazadagi BARCHA takror emaillarni birlashtiradi (admin /merge all)."""
    sb = _sb()
    rows = sb.table("user_usage").select("email").limit(20000).execute().data or []
    cnt: Dict[str, int] = {}
    for r in rows:
        e = str(r.get("email") or "").strip().lower()
        if e and not TG_EMAIL_RE.match(e) and not e.endswith("@slidestudio.local"):
            cnt[e] = cnt.get(e, 0) + 1
    out = {"emails": 0, "merged": 0, "moved_pages": 0.0, "errors": []}
    for e in [e for e, n in cnt.items() if n > 1][:limit]:
        try:
            r = merge_email_accounts(actor, e)
            out["emails"] += 1
            out["merged"] += r.get("merged", 0)
            out["moved_pages"] += r.get("moved_pages", 0)
        except AdminError as ex:
            out["errors"].append(f"{e}: {ex.msg}")
    return out


def user_brief(uid: str) -> Dict[str, Any]:
    return _brief(_get_user_row(uid), _tg_map([uid]))


CORE_KEYS = {"free_credits", "paid_credits", "slide_credits", "last_reset_time", "blocked"}


def _update_user(uid: str, patch: Dict[str, Any]) -> None:
    sb = _sb()
    try:
        sb.table("user_usage").update(patch).eq("user_id", str(uid)).execute()
        return
    except Exception as e:
        extra = {k: v for k, v in patch.items() if k not in CORE_KEYS}
        core = {k: v for k, v in patch.items() if k in CORE_KEYS}
        if not extra:
            raise AdminError(f"Saqlanmadi: {str(e)[:120]}", 502)
        if core:
            try:
                sb.table("user_usage").update(core).eq("user_id", str(uid)).execute()
            except Exception:
                pass
        raise AdminError("Bu amal uchun SUPABASE_SCHEMA.sql (VIP/cheksiz ustunlari) ishga tushirilmagan. "
                         "Supabase → SQL Editor da shu faylni bir marta ishga tushiring.", 409)


def _cas_update_credits(uid: str, patch: Dict[str, Any], row: Dict[str, Any]) -> bool:
    """Faqat bazadagi free/paid hali `row` dagidek bo'lsa yozadi. True = yozildi, False = shu orada o'zgargan."""
    sb = _sb()
    q = sb.table("user_usage").update(patch).eq("user_id", str(uid))
    if row.get("free_credits") is not None:
        q = q.eq("free_credits", int(row["free_credits"]))
    if row.get("paid_credits") is not None:
        q = q.eq("paid_credits", int(row["paid_credits"]))
    try:
        res = q.execute()
    except Exception as e:
        raise AdminError(f"Saqlanmadi: {str(e)[:120]}", 502)
    return bool(res.data)


def _ledger(uid: str, kind: str, amount_units: int, row: Dict[str, Any], details: dict) -> None:
    fn = _deps.get("ledger_log")
    if fn and amount_units:
        try:
            fn(uid, kind, int(amount_units), mon.normalize_user_row(row), 0, details)
        except Exception:
            pass


def _num(v: Any, name: str, lo: float = -1e6, hi: float = 1e6) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise AdminError(f"{name}: raqam kiriting")
    if x != x or x < lo or x > hi:
        raise AdminError(f"{name}: qiymat chegaradan tashqarida")
    return x


def user_action(actor: str, body: Dict[str, Any]) -> Dict[str, Any]:
    uid = str(body.get("user_id") or "").strip()
    act = str(body.get("action") or "").strip()
    if not uid or not act:
        raise AdminError("user_id va action kerak")
    row = _get_user_row(uid)
    u = mon.normalize_user_row(row)
    patch: Dict[str, Any] = {}
    note = ""
    tg_text = ""
    units_delta = 0

    if act == "set_plan":
        plan = str(body.get("plan") or "free").lower()
        if plan not in ("free", "vip"):
            raise AdminError("plan: free | vip")
        days = body.get("days")
        patch["plan"] = plan
        if plan == "free":
            patch["plan_until"] = None
        elif days in (None, "", 0, "0"):
            patch["plan_until"] = None            # muddatsiz
        else:
            d = int(_num(days, "days", 1, 36500))
            patch["plan_until"] = (_now() + timedelta(days=d)).isoformat()
        note = f"reja → {plan}" + (f" ({patch['plan_until'][:10]} gacha)" if patch.get("plan_until") else "")
        if plan != "free":
            tg_text = f"👑 <b>VIP</b> rejasi faollashtirildi!" + (f"\nMuddat: <b>{patch['plan_until'][:10]}</b> gacha." if patch.get("plan_until") else "\nMuddat: <b>cheksiz</b>.") + "\nReklamasiz ishlang 🎉"
    elif act == "unlimited":
        on = bool(body.get("value"))
        patch["unlimited"] = on
        note = "cheksiz " + ("yoqildi" if on else "o'chirildi")
        tg_text = "♾ Sizga <b>cheksiz</b> foydalanish berildi!" if on else ""
    elif act == "add_credits":
        pages = _num(body.get("pages"), "pages", -100000, 100000)
        units = int(round(pages * mon.UNIT))
        # v66: OPTIMISTIC LOCK — foydalanuvchi shu payt varaq sarflasa (sayt/bot), uning yozuvi yoki admin
        # o'zgarishi yo'qolmasin: bazadagi free/paid o'qilgan qiymatda bo'lsagina yoziladi, aks holda qayta o'qiladi.
        for attempt in range(5):
            if attempt:
                row = _get_user_row(uid)
            cur = mon.apply_24h_reset(dict(row))            # sayt/bot ko'radigan balans
            paid, free = int(cur["paid_credits"]), int(cur["free_credits"])
            patch = {}
            tg_text = ""
            if units >= 0:
                newp, newf = paid + units, free
                units_delta = units
                note = f"paket varaq {pages:+g}"
                if units_delta > 0:
                    tg_text = f"🎁 Balansingizga <b>+{units_delta / mon.UNIT:g}</b> varaq qo'shildi."
            else:
                # v60: AYIRISH avval paket varaqlardan, yetmasa BUGUNGI bepul varaqlardan olinadi.
                # Bepul qismidan olinsa 24 soatlik oyna hozirdan boshlanadi — bepul varaq ertaga qaytadi.
                take = -units
                from_paid = min(paid, take)
                from_free = min(free, take - from_paid)
                newp, newf = paid - from_paid, free - from_free
                units_delta = -(from_paid + from_free)
                # v66: pullik balans kunlik limitdan katta bo'lsa bepul limit "to'xtatilgan" (balansda ko'rinmaydi).
                # Admin pullik varaqni olib, balans limitdan pastga tushsa — bepul limit DARHOL qaytmasin
                # (avval «hammasini olsam ham 10 varaq qoladi» bo'lardi). U 24 soatdan keyin qaytadi.
                was_suspended = mon.free_suspended(cur)
                now_suspended = mon.free_suspended({**cur, "paid_credits": newp})
                if from_free > 0 or (was_suspended and not now_suspended):
                    patch["last_reset_time"] = _now().isoformat()
                note = (f"varaq {pages:+g}: paketdan −{from_paid / mon.UNIT:g}"
                        + (f", bugungi bepuldan −{from_free / mon.UNIT:g} (24 soatdan keyin qaytadi)" if from_free else ""))
                if from_paid + from_free < take:
                    note += f" (balansda faqat {(from_paid + from_free) / mon.UNIT:g} bor edi)"
            if "last_reset_time" not in patch and cur.get("last_reset_time") != row.get("last_reset_time"):
                patch["last_reset_time"] = cur["last_reset_time"]   # 24 soatlik tiklanish ham saqlansin
            patch.update({"paid_credits": newp, "free_credits": newf, "slide_credits": newp + newf})
            if _cas_update_credits(uid, patch, row):
                break
        else:
            raise AdminError("Balans shu payt o'zgarib turibdi. Bir necha soniyadan keyin qayta urinib ko'ring.", 409)
        _ledger(uid, "admin_credit", units_delta, {**row, **patch}, {"by": actor, "act": act})
        units_delta = 0                                         # pastda ikkinchi marta yozilmasin
    elif act == "set_credits":
        fp = body.get("free_pages")
        pp = body.get("paid_pages")
        nf = int(u["free_credits"]) if fp in (None, "") else int(round(_num(fp, "free_pages", 0, 100000) * mon.UNIT))
        npd = int(u["paid_credits"]) if pp in (None, "") else int(round(_num(pp, "paid_pages", 0, 1000000) * mon.UNIT))
        units_delta = (nf + npd) - (int(u["free_credits"]) + int(u["paid_credits"]))
        patch.update({"free_credits": nf, "paid_credits": npd, "slide_credits": nf + npd})
        if fp not in (None, ""):
            # bepul qism aniq belgilandi — 24 soatlik oyna hozirdan boshlanadi (darhol qayta to'lib qolmasin)
            patch["last_reset_time"] = _now().isoformat()
        note = f"balans = {nf / mon.UNIT:g} bepul + {npd / mon.UNIT:g} pullik"
    elif act == "fill_free":
        daily = mon.daily_units_for(u)
        units_delta = max(0, daily - int(u["free_credits"]))
        patch.update({"free_credits": daily, "slide_credits": daily + int(u["paid_credits"]), "last_reset_time": _now().isoformat()})
        note = "bepul limit to'ldirildi"
    elif act == "daily_override":
        v = body.get("pages")
        patch["daily_units_override"] = None if v in (None, "") else int(round(_num(v, "pages", 0, 100000) * mon.UNIT))
        note = "shaxsiy kunlik limit " + ("olib tashlandi" if patch["daily_units_override"] is None else f"{v} varaq")
    elif act == "block":
        on = bool(body.get("value"))
        patch["blocked"] = on
        note = "bloklandi" if on else "blok ochildi"
    elif act == "note":
        patch["admin_note"] = str(body.get("text") or "")[:300]
        note = "izoh"
    else:
        raise AdminError("Noma'lum amal")

    if act != "add_credits":                                    # add_credits o'zi (CAS bilan) yozdi
        _update_user(uid, patch)
    merged = dict(row)
    merged.update(patch)
    if units_delta:
        _ledger(uid, "admin_credit", units_delta, merged, {"by": actor, "act": act})
    audit(actor, f"user.{act}", uid, {k: (v if k != "admin_note" else "…") for k, v in patch.items()})
    if tg_text and _deps.get("tg_notify") and _deps.get("loop"):
        try:
            asyncio.run_coroutine_threadsafe(_deps["tg_notify"](uid, tg_text), _deps["loop"])
        except Exception:
            pass
    tgmap = _tg_map([uid])
    return {"ok": True, "note": note, "user": _brief(merged, tgmap)}


# ----------------------------------------------------------------------------------------------
# Statistika va tizim
# ----------------------------------------------------------------------------------------------
def _count(table: str, build=None) -> Optional[int]:
    sb = _sb()
    if not sb:
        return None
    try:
        q = sb.table(table).select("*", count="exact").limit(1)
        if build:
            q = build(q)
        r = q.execute()
        return int(r.count) if getattr(r, "count", None) is not None else len(r.data or [])
    except Exception:
        return None


def stats() -> Dict[str, Any]:
    now = _now()
    day = _iso_z(now - timedelta(days=1))
    d7 = _iso_z(now - timedelta(days=7))
    d30 = _iso_z(now - timedelta(days=30))
    nowz = _iso_z(now)
    sb = _sb()
    out: Dict[str, Any] = {
        "users_total": _count("user_usage"),
        "users_24h": _count("user_usage", lambda q: q.gte("last_active", day)),
        "users_7d": _count("user_usage", lambda q: q.gte("last_active", d7)),
        "new_7d": _count("user_usage", lambda q: q.gte("created_at", d7)),
        "tg_users": _count("user_usage", lambda q: q.like("email", "tg%@t.me")),
        "linked": _count("tg_links"),
        "vip": _count("user_usage", lambda q: q.eq("plan", "vip")),
        "unlimited": _count("user_usage", lambda q: q.eq("unlimited", True)),
        "blocked": _count("user_usage", lambda q: q.eq("blocked", True)),
        "ads_active": _count("ads", lambda q: q.eq("active", True)),
        "purchases_30d": _count("usage_ledger", lambda q: q.eq("kind", "purchase").gte("created_at", d30)),
        "orders_total": _count("payment_events"),
    }
    imp = clk = 0
    if sb:
        try:
            for r in sb.table("ads").select("impressions,clicks").execute().data or []:
                imp += int(r.get("impressions") or 0)
                clk += int(r.get("clicks") or 0)
        except Exception:
            pass
    out["ad_impressions"], out["ad_clicks"] = imp, clk
    out["ad_ctr"] = round(clk * 100.0 / imp, 2) if imp else 0
    st = _deps.get("state")
    if callable(st):
        try:
            out.update(st())
        except Exception:
            pass
    return out


def _probe(table: str, cols: str = "*") -> bool:
    sb = _sb()
    if not sb:
        return False
    try:
        sb.table(table).select(cols).limit(1).execute()
        return True
    except Exception:
        return False


def system_info() -> Dict[str, Any]:
    cfg = (_deps.get("config") or (lambda: {}))()
    key = (cfg.get("api_key") or "").strip()
    return {
        "supabase": bool(_sb()),
        "ai_key": bool(key), "ai_key_hint": ("…" + key[-4:]) if len(key) > 8 else "",
        "model": cfg.get("model_name"),
        "telegram": bool((os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()),
        "lemon": {k: bool(os.environ.get(k)) for k in ("LEMON_SQUEEZY_API_KEY", "LEMON_SQUEEZY_STORE_ID", "LEMON_SQUEEZY_VARIANT_ID",
                                                         "LEMON_SQUEEZY_WEBHOOK_SECRET")},
        "public_base_url": os.environ.get("PUBLIC_BASE_URL") or "",
        "admin_tg_ids": len(admin_tg_ids()), "admin_emails": len(admin_emails()),
        "migration": {
            "plan_columns": _probe("user_usage", "plan,plan_until,unlimited,daily_units_override"),
            "ads": _probe("ads", "id"), "app_settings": _probe("app_settings", "key"),
            "admin_audit": _probe("admin_audit", "id"), "tg_links": _probe("tg_links", "tg_id"),
            "payment_events": _probe("payment_events", "order_id"), "usage_ledger": _probe("usage_ledger", "id"),
        },
        "settings_persisted": appsettings.persisted,
        "paused": bool((_deps.get("paused") or (lambda: False))()),
    }


# ----------------------------------------------------------------------------------------------
# Ommaviy xabar (broadcast): botdan foydalanuvchilarga
# ----------------------------------------------------------------------------------------------
_jobs: Dict[str, Dict[str, Any]] = {}


def _audience(kind: str) -> List[int]:
    sb = _sb()
    if not sb:
        return []
    tg_by_uid: Dict[str, int] = {}
    try:
        off = 0
        while True:
            rows = sb.table("tg_links").select("user_id,tg_id").range(off, off + 999).execute().data or []
            for r in rows:
                tg_by_uid[str(r["user_id"])] = int(r["tg_id"])
            if len(rows) < 1000:
                break
            off += 1000
    except Exception:
        pass
    ids: Dict[int, bool] = {}         # tg_id -> is_pro_or_better
    off = 0
    while off < 200000:
        try:
            rows, _ = _select_users(lambda cols: sb.table("user_usage").select(cols).order("created_at").range(off, off + 999))
        except AdminError:
            break
        for r in rows:
            u = mon.normalize_user_row(r)
            uid = str(r["user_id"])
            u["vip"] = is_vip_account(uid, str(r.get("email") or ""))
            pro = mon.is_ad_free(u)
            m = TG_EMAIL_RE.match(str(r.get("email") or ""))
            tid = tg_by_uid.get(uid) or (int(m.group(1)) if m else None)
            if tid:
                ids[tid] = ids.get(tid, False) or pro
        if len(rows) < 1000:
            break
        off += 1000
    for tid in tg_by_uid.values():
        ids.setdefault(tid, False)
    if kind == "pro":                 # eski kod bilan moslik: reklamasizlar (VIP/admin)
        return [t for t, p in ids.items() if p]
    if kind == "free":
        return [t for t, p in ids.items() if not p]
    if kind == "linked":
        return sorted(set(tg_by_uid.values()))
    return list(ids.keys())


async def _run_broadcast(job_id: str, text: str, tids: List[int]) -> None:
    send = _deps.get("tg_send")
    job = _jobs[job_id]
    for tid in tids:
        if job.get("cancel"):
            break
        try:
            ok = await send(tid, text)
        except Exception:
            ok = False
        job["sent" if ok else "failed"] += 1
        await asyncio.sleep(0.05)       # ~20 xabar/soniya (Telegram chegarasidan past)
    job["done"] = True


# ----------------------------------------------------------------------------------------------
# HTTP: panel sahifasi va API (HAR XATO — 404)
# ----------------------------------------------------------------------------------------------
def _nf() -> JSONResponse:
    return JSONResponse({"detail": "Not Found"}, status_code=404)


@router.get("/_a/{token}")
async def panel_page(token: str):
    if not verify_token(token) or not os.path.isfile(PANEL_FILE):
        return _nf()
    with open(PANEL_FILE, "r", encoding="utf-8") as f:
        html = f.read()
    return HTMLResponse(html, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
                                       "Referrer-Policy": "no-referrer"})


async def _body(request: Request) -> Dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


@router.post("/_a/api/{op}")
async def admin_api(op: str, request: Request):
    p = verify_token(request.headers.get("x-admin-token", ""))
    if not p:
        return _nf()
    actor = f"tg{p['t']}"
    body = await _body(request)
    try:
        if not _sb() and op not in ("system",):
            raise AdminError("Supabase ulanmagan", 503)
        return await asyncio.to_thread(_dispatch, op, body, actor)
    except AdminError as e:
        return JSONResponse({"error": e.msg}, status_code=e.code if e.code != 404 else 400)
    except Exception as e:
        print(f"[ADMIN] {op} xato: {e}")
        return JSONResponse({"error": "Ichki xatolik: " + str(e)[:160]}, status_code=500)


def _dispatch(op: str, body: Dict[str, Any], actor: str):
    if op == "ping":
        return {"ok": True, "actor": actor}
    if op == "stats":
        return stats()
    if op == "system":
        return system_info()
    if op == "users":
        return {"users": _find_users(body.get("q", ""), str(body.get("filter") or "all"), body.get("limit", 30), body.get("offset", 0))}
    if op == "user":
        uid = str(body.get("user_id") or "")
        row = _get_user_row(uid)
        brief = _brief(row, _tg_map([uid]))
        sb = _sb()
        led = []
        try:
            led = sb.table("usage_ledger").select("kind,amount,free_after,paid_after,created_at,details").eq("user_id", uid).order("created_at", desc=True).limit(25).execute().data or []
        except Exception:
            pass
        return {"user": brief, "ledger": led}
    if op == "user_action":
        return user_action(actor, body)
    # ---- reklamalar
    if op == "ads":
        sb = _sb()
        try:
            _cols = "id,title,body,media_type,link_url,button_text,placement,active,weight,starts_at,ends_at,impressions,clicks,created_at,media_url"
            try:
                rows = sb.table("ads").select(_cols + ",kind").order("id", desc=True).execute().data or []
            except Exception:
                rows = sb.table("ads").select(_cols).order("id", desc=True).execute().data or []
        except Exception:
            raise AdminError("ads jadvali yo'q — SUPABASE_SCHEMA.sql ni ishga tushiring", 409)
        for r in rows:       # ro'yxatda og'ir base64 yubormaymiz
            u = str(r.get("media_url") or "")
            r["media_preview"] = ads.media_path(r) if r.get("media_type") != "none" else ""
            r["media_url"] = "" if u.startswith("data:") else u
            r["media_is_upload"] = u.startswith("data:")
        return {"ads": rows}
    if op == "ad_save":
        sb = _sb()
        raw = dict(body.get("ad") or {})
        aid = raw.get("id")
        if aid and str(raw.get("media_type") or "none") != "none" and not str(raw.get("media_url") or "").strip():
            try:                                  # rasm o'zgartirilmagan: eskisi saqlanadi
                cur = sb.table("ads").select("media_url").eq("id", int(aid)).limit(1).execute().data
                if cur:
                    raw["media_url"] = cur[0].get("media_url") or ""
            except Exception:
                pass
        row, err = ads.clean_ad(raw)
        if err:
            raise AdminError(err)
        def _write(rw):
            if aid:
                sb.table("ads").update(rw).eq("id", int(aid)).execute()
                return aid
            r = sb.table("ads").insert(rw).execute().data
            return r[0]["id"] if r else None
        try:
            try:
                aid = _write(row)
            except Exception as e0:
                if "kind" not in str(e0).lower() or row.get("kind") != "ad":
                    raise
                aid = _write({k: v for k, v in row.items() if k != "kind"})     # eski baza: oddiy reklama baribir saqlansin
        except Exception as e:
            raise AdminError("Saqlanmadi: " + str(e)[:140] + " (SUPABASE_SCHEMA.sql ishga tushirilganmi?)", 502)
        ads.invalidate()
        audit(actor, "ad.save", str(aid), {"title": row["title"]})
        return {"ok": True, "id": aid}
    if op in ("ad_toggle", "ad_delete"):
        sb = _sb()
        aid = int(body.get("id") or 0)
        if not aid:
            raise AdminError("id kerak")
        if op == "ad_toggle":
            sb.table("ads").update({"active": bool(body.get("active")), "updated_at": _now().isoformat()}).eq("id", aid).execute()
        else:
            sb.table("ads").delete().eq("id", aid).execute()
        ads.invalidate()
        audit(actor, "ad." + op[3:], str(aid))
        return {"ok": True}
    # ---- sozlamalar
    if op == "settings":
        return {"settings": appsettings.load(True), "persisted": appsettings.persisted, "defaults": appsettings.DEFAULTS}
    if op == "settings_set":
        r = appsettings.set_many(body.get("values") or {})
        audit(actor, "settings.set", "", r.get("saved"))
        return {**r, "settings": appsettings.all_settings()}
    # ---- tizim
    if op == "pause":
        fn = _deps.get("set_paused")
        if fn:
            fn(bool(body.get("value")))
        audit(actor, "server.pause" if body.get("value") else "server.resume")
        return {"ok": True, "paused": bool(body.get("value"))}
    if op == "set_ai_key":
        key = str(body.get("key") or "").strip()
        if len(key) < 12 or re.search(r"\s", key):
            raise AdminError("Kalit noto'g'ri ko'rinadi")
        fn = _deps.get("set_ai_key")
        if not fn:
            raise AdminError("Bu amal qo'llab-quvvatlanmaydi", 501)
        fn(key)
        audit(actor, "ai.key", "", {"tail": key[-4:]})
        return {"ok": True, "note": "Kalit yangilandi (restartdan keyin AI_API_KEY env qiymati qaytadi — Render env'ni ham yangilang)."}
    # ---- jurnallar
    if op in ("ledger", "audit", "orders"):
        sb = _sb()
        tbl, cols, order = {"ledger": ("usage_ledger", "user_id,kind,amount,free_after,paid_after,created_at", "created_at"),
                            "audit": ("admin_audit", "actor,action,target,details,created_at", "created_at"),
                            "orders": ("payment_events", "order_id,user_id,pages,created_at", "created_at")}[op]
        q = sb.table(tbl).select(cols)
        if op == "ledger" and body.get("kind"):
            q = q.eq("kind", str(body["kind"])[:40])
        try:
            rows = q.order(order, desc=True).limit(int(min(200, body.get("limit", 60)))).execute().data or []
        except Exception:
            rows = []
        if op != "audit":
            uids = list({str(r.get("user_id")) for r in rows if r.get("user_id")})
            em = {}
            if uids:
                try:
                    for r in sb.table("user_usage").select("user_id,email").in_("user_id", uids).execute().data or []:
                        em[str(r["user_id"])] = r.get("email")
                except Exception:
                    pass
            for r in rows:
                r["email"] = em.get(str(r.get("user_id")), "")
        return {"rows": rows}
    # ---- ommaviy xabar
    if op == "broadcast_preview":
        return {"count": len(_audience(str(body.get("audience") or "all")))}
    if op == "broadcast":
        text = str(body.get("text") or "").strip()
        if len(text) < 2 or len(text) > 3500:
            raise AdminError("Xabar matni 2–3500 belgi bo'lsin")
        if not _deps.get("tg_send"):
            raise AdminError("Telegram bot yoqilmagan", 503)
        tids = _audience(str(body.get("audience") or "all"))
        if not tids:
            raise AdminError("Qabul qiluvchi topilmadi")
        jid = secrets.token_hex(5)
        _jobs[jid] = {"total": len(tids), "sent": 0, "failed": 0, "done": False}
        while len(_jobs) > 20:
            _jobs.pop(next(iter(_jobs)))
        loop = _deps.get("loop")
        if not loop:
            raise AdminError("Server hali tayyor emas, bir ozdan keyin urinib ko'ring", 503)
        asyncio.run_coroutine_threadsafe(_run_broadcast(jid, text, tids), loop)
        audit(actor, "broadcast", jid, {"audience": body.get("audience"), "n": len(tids)})
        return {"ok": True, "job": jid, "total": len(tids)}
    if op == "broadcast_status":
        return _jobs.get(str(body.get("job")), {"error": "topilmadi"})
    raise AdminError("Noma'lum amal", 400)
