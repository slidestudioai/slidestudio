"""
Slide Studio — Telegram bot (v45).  FastAPI ichida ishlaydi (aiogram shart emas: to'g'ridan-to'g'ri Bot API, kam RAM).

Oqim:
  1) Foydalanuvchi mavzuni yozadi (yoki «🎨 Yangi slayd yaratish») -> AI darhol slaydlarni yozadi -> PPTX + PDF + HTML birdan yuboriladi.
  2) Tayyor slaydni matn bilan tahrirlash: «3-slaydni qisqartir» — AI faqat kerakli slaydlarni o'zgartiradi (ops), yangi fayllar qaytariladi.
  3) Fayllar FAQAT RAM'da yasaladi, yuborilgach darhol tashlanadi. Bazada (Supabase) faqat foydalanuvchi, balans va qisqa slayd JSON.
  4) Bir baza: balans `user_usage` jadvalida — bot, Mini App va sayt bir xil raqamni ko'radi. Google akkaunt `/link KOD` bilan ulanadi.

Ulanish usullari (TELEGRAM_MODE):  auto (standart) | webhook | polling
Kerakli env:  TELEGRAM_BOT_TOKEN (majburiy), PUBLIC_BASE_URL (https://...), TELEGRAM_WEBHOOK_SECRET (ixtiyoriy)
Jadvallar: SUPABASE_SCHEMA.sql
"""
from __future__ import annotations

import asyncio
import base64
import gc
import hashlib
import hmac
import html
import io
import json
import os
import re
import secrets
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, quote

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

try:
    from backend import tg_decks as decks
except Exception as _e:  # pragma: no cover
    decks = None
    print(f"[TG] tg_decks yuklanmadi (python-pptx / reportlab / pillow o'rnatilganmi?): {_e}")


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


BOT_TOKEN = _env("TELEGRAM_BOT_TOKEN").strip("\"'")
ENABLED = bool(BOT_TOKEN) and ":" in BOT_TOKEN
SITE_URL = (_env("PUBLIC_BASE_URL") or _env("RENDER_EXTERNAL_URL") or "http://localhost:8080").rstrip("/")
WEBHOOK_PATH = "/telegram-webhook"
MODE = (_env("TELEGRAM_MODE", "auto") or "auto").lower()
# Telegram secret_token faqat [A-Za-z0-9_-] (1..256) ni qabul qiladi. Render "generateValue" esa + / = belgili qiymat beradi
# -> setWebhook rad etilib, bot JIM qolardi. Shuning uchun har qanday kirish HEX ga aylantiriladi.
SECRET = hashlib.sha256(("ss-tg-secret|" + (_env("TELEGRAM_WEBHOOK_SECRET") or BOT_TOKEN)).encode()).hexdigest()[:48]
API = f"https://api.telegram.org/bot{BOT_TOKEN}"
TG_EMAIL_DOMAIN = "t.me"
DEV_MODE = _env("SLIDE_STUDIO_DEV_MODE") == "1"

router = APIRouter()
_deps: Dict[str, Any] = {}


def configure(**kw: Any) -> None:
    """main.py dan bog'lanadi (supabase, kredit funksiyalari, AI sozlamalari)."""
    _deps.update(kw)


# ----------------------------------------------------------------------------------------------
# Yordamchilar: log (kam), HTTP klient, Telegram API
# ----------------------------------------------------------------------------------------------
_warned: "OrderedDict[str, float]" = OrderedDict()


def _warn(key: str, msg: str) -> None:
    now = time.time()
    if now - _warned.get(key, 0) < 60:
        return
    _warned[key] = now
    while len(_warned) > 100:
        _warned.popitem(last=False)
    print(f"[TG] {msg}"[:400])


_client: Optional[httpx.AsyncClient] = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(15.0, connect=6.0),
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20, keepalive_expiry=30),   # v59: ko'p foydalanuvchi — har xabarga yangi TLS ulanish ochilmasin
        )
    return _client


async def tg(method: str, **payload: Any) -> Optional[Any]:
    """Telegram Bot API chaqiruvi. Xato bo'lsa None (exception ko'tarmaydi)."""
    if not ENABLED:
        return None
    for attempt in range(2):
        try:
            r = await _http().post(f"{API}/{method}", json=payload)
            data = r.json()
            if data.get("ok"):
                return data.get("result", True)
            if r.status_code == 429 and attempt == 0:
                wait = int((data.get("parameters") or {}).get("retry_after", 1))
                await asyncio.sleep(min(max(wait, 1), 5))
                continue
            desc = str(data.get("description", ""))
            if not any(x in desc.lower() for x in ("blocked", "chat not found", "deactivated", "message is not modified", "query is too old")):
                _warn(f"api:{method}", f"{method}: {desc}")
            return None
        except Exception as e:
            if attempt == 1:
                _warn(f"net:{method}", f"{method} tarmoq xatosi: {type(e).__name__}")
            else:
                await asyncio.sleep(0.6)
    return None


async def tg_send_document(chat_id: int, filename: str, data: Any, mime: str, caption: str = "") -> bool:
    """Faylni Telegram'ga yuboradi. `data` — bytes yoki io.BytesIO (RAM'da, diskka yozilmaydi). BytesIO oqim sifatida
    multipart ichiga uzatiladi (qo'shimcha nusxa olinmaydi); qayta urinishda boshiga qaytariladi."""
    if not ENABLED:
        return False
    stream = data if hasattr(data, "read") else io.BytesIO(data)
    for attempt in range(2):
        try:
            try:
                stream.seek(0)
            except Exception:
                pass
            r = await _http().post(
                f"{API}/sendDocument",
                data={"chat_id": str(chat_id), "caption": caption[:900], "parse_mode": "HTML"},
                files={"document": (filename, stream, mime.split(";")[0])},
                timeout=httpx.Timeout(90.0, connect=8.0),
            )
            j = r.json()
            if j.get("ok"):
                return True
            _warn("doc", f"sendDocument: {str(j.get('description'))[:150]}")
            if r.status_code != 429:
                return False
            await asyncio.sleep(min(int((j.get("parameters") or {}).get("retry_after", 2)), 6))
        except Exception as e:
            _warn("doc-net", f"sendDocument tarmoq xatosi: {type(e).__name__}")
            await asyncio.sleep(1)
    return False


def esc(s: Any) -> str:
    return html.escape(str(s or ""), quote=False)


# ----------------------------------------------------------------------------------------------
# Matnlar
# ----------------------------------------------------------------------------------------------
BTN_NEW = "🎨 Yangi slayd yaratish"
BTN_MY = "📂 Mening slaydlarim"
BTN_BAL = "💳 Balans"
BTN_SITE = "🌐 Saytga o'tish"
BTN_SET = "⚙️ Sozlamalar"
BTN_INV = "🎁 Do'st taklif qilish"
BTN_ABOUT = "ℹ️ Yordam"
MENU = {BTN_NEW: "new", BTN_MY: "my", BTN_BAL: "bal", BTN_SITE: "site", BTN_SET: "set", BTN_ABOUT: "about", BTN_INV: "inv",
        # eski klaviaturalar foydalanuvchilarda turgan bo'lishi mumkin (Pro tugmasi endi balansga olib boradi):
        "👑 Pro": "bal", "🎨 Yangi slayd": "new", "📂 Slaydlarim": "my", "📂 Slaydlarim / Tozalash": "my", "💳 Balans / To'ldirish": "bal", "ℹ️ Bot haqida": "about"}
LINE = "━━━━━━━━━━━━━━━━━━"
DEFAULT_SLIDES = 8

HELP = (
    "<b>Qanday ishlaydi</b>\n"
    "1. <b>🎨 Yangi slayd</b> ni bosing va mavzuni yozing — bot slayd tayyorlaydi.\n"
    "2. Tayyor bo'lgach <b>PPTX / PDF / HTML</b> tugmalaridan birini bosing — fayl yuboriladi.\n"
    "3. O'zgartirish uchun <b>✏️ Tahrirlash</b> ni bosing va yozing: <i>«3-slaydni qisqartir»</i>.\n"
    "4. Eski slaydlaringiz — <b>📂 Slaydlarim</b> da.\n"
    "5. 1 slayd = 1 varaq. Varaq tugasa — «💳 Balans» orqali sotib oling.\n"
    "6. <b>🎁 Do'st taklif qilish</b> — har bir do'st uchun +15 varaq.\n\n"
    "<b>Buyruqlar</b>\n"
    "/new — yangi slayd\n"
    "/my — slaydlarim\n"
    "/credits — balans\n"
    "/buy — varaq sotib olish\n"
    "/invite — do'st taklif qilish\n"
    "/settings — Google akkaunt\n"
    "/id — Telegram ID"
)
ABOUT = HELP
GREETING_RE = re.compile(r"^(salom|assalomu\s*alaykum|assalom|hello|hi|hey|привет|здравствуй\w*|qalay|nima gap|start|boshla)[\s!.,?]*$", re.I)
COUNT_RE = re.compile(r"(\d{1,2})\s*(?:ta|tadan|ta\.)?\s*[-–]?\s*(?:slayd\w*|slaid\w*|slide\w*|слайд\w*|varaq\w*|sahifa\w*|page\w*)", re.I)
MIN_SLIDES, MAX_SLIDES = 3, 20


def _app_url(topic: str = "") -> str:
    if topic:
        return f"{SITE_URL}/?src=tg&topic={quote(topic[:200], safe='')}"
    return f"{SITE_URL}/?src=tg"


def _btn(text: str, data: str) -> dict:
    return {"text": text, "callback_data": data}


def _https() -> bool:
    return SITE_URL.startswith("https://") and "localhost" not in SITE_URL and "127.0.0.1" not in SITE_URL


def kb_reply() -> dict:
    """Doimiy pastki menyu: 2 ustunli, tartibli (v47)."""
    last = [{"text": "🚀 Muharrir", "web_app": {"url": _app_url()}}] if _https() else [{"text": BTN_SITE}]
    return {
        "keyboard": [[{"text": BTN_NEW}, {"text": BTN_MY}], [{"text": BTN_BAL}, {"text": BTN_SET}], [{"text": BTN_INV}, {"text": BTN_ABOUT}], last],
        "resize_keyboard": True, "is_persistent": True, "input_field_placeholder": "Slayd mavzusini yozing…",
    }


def kb_main(topic: str = "") -> dict:
    rows = []
    if _https():
        rows.append([{"text": "🚀 Muharrirda ochish", "web_app": {"url": _app_url(topic)}}])
    rows.append([_btn("💳 Balans", "bal")])
    return {"inline_keyboard": rows}


def kb_count(mode: str) -> dict:
    return {"inline_keyboard": [
        [_btn("5 slayd", "cnt:5"), _btn("8 slayd", "cnt:8"), _btn("10 slayd", "cnt:10"), _btn("12 slayd", "cnt:12")],
        [_btn(("✅ " if mode == "fast" else "") + "⚡ Tez AI", "mode:fast"), _btn(("✅ " if mode == "deep" else "") + "🧠 Chuqur AI", "mode:deep")],
    ]}


def _editor_url(st: dict) -> str:
    """Mini App / brauzer havolasi: shu slaydning o'zini muharrirga ochadi (token bilan; fayl serverda saqlanmaydi)."""
    did, cid = st.get("deck_id"), st.get("cid")
    if did and cid:
        return f"{SITE_URL}/?src=tg&tgdeck={_make_token('D', did, cid, 3 * 86400)}"
    return _app_url(st.get("topic") or "")


def kb_done(arg: Any = "") -> dict:
    """v51: tayyor slayd kartasi — 3 ta yuklab olish tugmasi + bitta «Tahrirlash» (qolganlari tahrirlash oynasida)."""
    return {"inline_keyboard": [
        [_btn("📊 PPTX", "dl:pptx"), _btn("📕 PDF", "dl:pdf"), _btn("🌐 HTML", "dl:html")],
        [_btn("✏️ Tahrirlash", "edit")],
        [_btn("🆕 Yangi slayd", "new"), _btn("📂 Slaydlarim", "my")],
    ]}


def kb_edit(arg: Any = "") -> dict:
    """v51: tahrirlash oynasi — Muharrirda ochish (shu slaydning o'zi), rang, orqaga."""
    st = arg if isinstance(arg, dict) else {"topic": arg}
    url = _editor_url(st)
    first = [{"text": "🚀 Muharrirda ochish", "web_app": {"url": url}}] if _https() else []
    first.append({"text": "🌐 Brauzerda", "url": url})
    return {"inline_keyboard": [first, [_btn("🎨 Rang", "theme")], [_btn("✅ Tayyor — fayllarga qaytish", "back")]]}


def kb_start() -> dict:
    return {"inline_keyboard": [[_btn("🎨 Yangi slayd", "new"), _btn("📂 Slaydlarim", "my")]]}


def kb_themes() -> dict:
    names = list(decks.THEMES.keys()) if decks else []
    rows, row = [], []
    for k in names:
        row.append(_btn(decks.THEMES[k]["label"], f"th:{k}"))
        if len(row) == 2:
            rows.append(row)
            row = []
    if row:
        rows.append(row)
    rows.append([_btn("⬅️ Orqaga", "back")])
    return {"inline_keyboard": rows}


def kb_balance(linked: bool, info: Optional[dict] = None) -> dict:
    info = info or {}
    rows = []
    if not info.get("unlimited"):
        rows.append([_btn("➕ Varaq sotib olish", "buy")])
    if not linked:
        rows.append([_btn("🔗 Google ulash", "linkinfo")])
    return {"inline_keyboard": rows or [[_btn("⬅️ Menyu", "dismiss")]]}


# ----------------------------------------------------------------------------------------------
# Himoya: dublikat update va spam (xotirasi chegaralangan)
# ----------------------------------------------------------------------------------------------
_seen: "OrderedDict[int, float]" = OrderedDict()
_rl: "OrderedDict[int, list]" = OrderedDict()
RL_MAX, RL_WINDOW = 8, 10.0


def _is_dup(update_id: Any) -> bool:
    if not isinstance(update_id, int):
        return False
    if update_id in _seen:
        return True
    _seen[update_id] = time.time()
    while len(_seen) > 1000:
        _seen.popitem(last=False)
    return False


def _limited(chat_id: int, mx: int = RL_MAX) -> bool:
    now = time.time()
    arr = [t for t in _rl.pop(chat_id, []) if now - t < RL_WINDOW]
    over = len(arr) >= mx
    if not over:
        arr.append(now)
    _rl[chat_id] = arr
    while len(_rl) > 5000:
        _rl.popitem(last=False)
    return over


# ----------------------------------------------------------------------------------------------
# Foydalanuvchi holati (RAM, chegaralangan, 3 soatdan keyin o'chadi)
# ----------------------------------------------------------------------------------------------
_chats: "OrderedDict[int, dict]" = OrderedDict()
MAX_CHATS, CHAT_TTL = 300, 3 * 3600


IMG_TTL = 600
_last_sweep = 0.0


def _sweep_imgs(now: float) -> None:
    """Fayl yuborilmay qolgan rasmlar 10 daqiqadan keyin RAM'dan tashlanadi (xotira o'smasin)."""
    global _last_sweep
    if now - _last_sweep < 60:
        return
    _last_sweep = now
    for v in _chats.values():
        if v.get("imgs") and now - v.get("img_ts", 0) > IMG_TTL and not v.get("busy") and not v.get("sending"):
            v["imgs"] = {}


def _state(chat_id: int) -> dict:
    now = time.time()
    _sweep_imgs(now)
    st = _chats.pop(chat_id, None)
    if st is None or now - st.get("ts", 0) > CHAT_TTL:
        keep = {}
        if st and st.get("adm") and now - st.get("ts", 0) < 6 * 3600:
            keep = {"adm": st["adm"]}          # v49.5: admin qoralamasi (reklama) uzoq o'ylansa ham yo'qolmasin
        st = {"mode": (st or {}).get("mode", "fast"), "busy": False, **keep}
    st["ts"] = now
    st["cid"] = chat_id
    _chats[chat_id] = st
    while len(_chats) > MAX_CHATS:
        k, v = next(iter(_chats.items()))
        if v.get("busy"):
            _chats.move_to_end(k)
            break
        _chats.popitem(last=False)
    return st


# ----------------------------------------------------------------------------------------------
# Akkaunt va kreditlar (Telegram ID -> Supabase akkaunt tg<ID>@t.me; Mini App bilan BIR XIL)
# ----------------------------------------------------------------------------------------------
def _tg_email(tg_id: int) -> str:
    return f"tg{int(tg_id)}@{TG_EMAIL_DOMAIN}"


def _sb():
    return (_deps.get("supabase_getter") or (lambda: None))()


def _provision_sync(user: dict) -> dict:
    """Supabase akkauntini yaratadi/topadi va kredit qatorini ta'minlaydi. {'uid','email','name','hashed'} yoki {'error'}."""
    sb = _sb()
    tid = int(user["id"])
    email = _tg_email(tid)
    name = " ".join(x for x in (user.get("first_name"), user.get("last_name")) if x)[:80]
    if not sb:
        if DEV_MODE:
            return {"uid": f"dev-tg{tid}", "email": email, "name": name, "hashed": None}
        return {"error": "auth_unavailable"}
    admin = sb.auth.admin
    try:
        admin.create_user({
            "email": email,
            "email_confirm": True,
            "app_metadata": {"provider": "telegram", "telegram_id": tid},
            "user_metadata": {"full_name": name, "telegram_username": user.get("username") or ""},
        })
    except Exception as e:
        m = str(e).lower()
        if not any(x in m for x in ("already", "registered", "exists", "duplicate")):
            _warn("create_user", f"create_user: {str(e)[:150]}")
    link = admin.generate_link({"type": "magiclink", "email": email})
    props = getattr(link, "properties", None)
    hashed = getattr(props, "hashed_token", None)
    u = getattr(link, "user", None)
    if not hashed or not u:
        return {"error": "link_failed"}
    meta = getattr(u, "app_metadata", None) or {}
    if str(meta.get("telegram_id")) != str(tid):   # begona (oldindan ro'yxatdan o'tkazilgan) akkauntdan himoya
        return {"error": "account_conflict"}
    get_usage = _deps.get("get_usage")
    if get_usage:
        try:
            get_usage(str(u.id), email)          # kredit qatori darhol yaratiladi
        except Exception as e:
            _warn("usage_row", f"usage yaratilmadi: {str(e)[:120]}")
    return {"uid": str(u.id), "email": email, "name": name, "hashed": hashed}


_uids: "OrderedDict[int, Tuple[str, str]]" = OrderedDict()      # tg_id -> (uid, email)
_uid_ts: Dict[int, float] = {}                                  # tg_id -> oxirgi tekshirilgan vaqt
UID_TTL = 45.0                                                  # v51: akkaunt har 45 s da qayta tekshiriladi (Google o'chirilsa bot ham to'xtaydi)


def _linked_ex(tid: int) -> Tuple[Optional[Tuple[str, str]], bool]:
    """((uid, email) | None, baza_javob_berdi)."""
    sb = _sb()
    if not sb:
        return None, False
    try:
        res = sb.table("tg_links").select("user_id,email").eq("tg_id", int(tid)).limit(1).execute()
        if res.data:
            return (str(res.data[0]["user_id"]), str(res.data[0]["email"])), True
        return None, True
    except Exception as e:
        _warn("links", f"tg_links o'qilmadi (SUPABASE_SCHEMA.sql ishga tushirilganmi?): {str(e)[:100]}")
        return None, False


def _linked_sync(tid: int) -> Optional[Tuple[str, str]]:
    """Telegram ID sayt (Google) akkauntiga ulangan bo'lsa (uid, email), aks holda None."""
    return _linked_ex(tid)[0]


def _auth_user_exists(uid: str) -> bool:
    """Supabase Auth'da foydalanuvchi bormi. Tarmoq/baza xatosida True (begunoh odamni bloklamaymiz)."""
    sb = _sb()
    if not sb:
        return True
    try:
        r = sb.auth.admin.get_user_by_id(str(uid))
        u = getattr(r, "user", None) if not isinstance(r, dict) else r.get("user")
        return bool(u)
    except Exception as e:
        m = str(e).lower()
        if any(x in m for x in ("not found", "user_not_found", "404", "does not exist", "no user")):
            return False
        return True


def _ensure_uid_sync(user: dict) -> Tuple[str, str]:
    """(uid, email). Avval ulangan sayt akkaunti, bo'lmasa tg<ID>@t.me akkaunti (Mini App bilan bir xil)."""
    tid = int(user["id"])
    hit = _uids.get(tid)
    if hit and tid not in _uid_ts:
        _uid_ts[tid] = time.time()          # kesh to'g'ridan-to'g'ri yozilgan (test / eski kod) — hozirdan hisoblanadi
    if hit and time.time() - _uid_ts.get(tid, 0.0) < UID_TTL:
        return hit
    res, db_ok = _linked_ex(tid)
    if hit and not res and not db_ok:
        _uid_ts[tid] = time.time()          # baza vaqtincha javob bermadi — oldingi holatda qoladi
        return hit
    if res and not _auth_user_exists(res[0]):
        # Google akkaunt Supabase'dan o'chirilgan -> ulanish ham o'chadi, bot yana «Google ulang» deydi
        try:
            _sb().table("tg_links").delete().eq("tg_id", tid).execute()
        except Exception as e:
            _db_warn(e)
        _uids.pop(tid, None)
        res = None
    if not res:
        email = _tg_email(tid)
        sb = _sb()
        uid = ""
        if sb:
            q = sb.table("user_usage").select("user_id").eq("email", email).limit(1).execute()
            if q.data:
                uid = str(q.data[0]["user_id"])
        if not uid:
            r = _provision_sync(user)
            if r.get("error"):
                raise RuntimeError(r["error"])
            uid = r["uid"]
        res = (uid, email)
    _uids[tid] = res
    _uid_ts[tid] = time.time()
    while len(_uids) > 5000:
        _k, _ = _uids.popitem(last=False)
        _uid_ts.pop(_k, None)
    return res


UID_STALE_MAX = 900.0          # v52: shu muddat ichida eskirgan kesh DARHOL ishlatiladi, yangilash fonda bajariladi
_uid_refreshing: set = set()


async def _refresh_uid_bg(user: dict) -> None:
    tid = int(user["id"])
    try:
        await asyncio.to_thread(_ensure_uid_sync, user)
    except Exception as e:
        _warn("uid-refresh", f"akkaunt yangilanmadi: {str(e)[:100]}")
    finally:
        _uid_refreshing.discard(tid)


async def _ensure_uid(user: dict) -> Tuple[str, str]:
    """v52: stale-while-revalidate. Har 45 soniyada har bir xabar 2-3 ta Supabase so'rovini (tg_links, auth, user_usage)
    kutib qolardi. Endi kesh eskirgan bo'lsa ham javob darhol beriladi, tekshiruv fonda — Google uzilsa keyingi xabardan ishlaydi."""
    tid = int(user["id"])
    hit = _uids.get(tid)
    if hit:
        ts = _uid_ts.get(tid)
        if ts is None:
            _uid_ts[tid] = time.time()          # to'g'ridan-to'g'ri yozilgan kesh (link) — yangi deb hisoblanadi
            return hit
        age = time.time() - ts
        if age < UID_TTL:
            return hit
        if age < UID_STALE_MAX:
            if tid not in _uid_refreshing:
                _uid_refreshing.add(tid)
                _spawn(_refresh_uid_bg(user))
            return hit
    return await asyncio.to_thread(_ensure_uid_sync, user)


_ulocks: Dict[str, asyncio.Lock] = {}


def _ulock(uid: str) -> asyncio.Lock:
    """v52: sayt (WebSocket), Lemon webhook va bot BIR XIL lock'dan foydalanadi — aks holda to'lov krediti bot yozuvi bilan
    ustma-ust yozilib ketardi (read-modify-write poygasi)."""
    shared = _deps.get("user_lock")
    if shared:
        return shared(str(uid))
    lk = _ulocks.get(uid)
    if lk is None:
        if len(_ulocks) > 3000:
            _ulocks.clear()
        lk = _ulocks[uid] = asyncio.Lock()
    return lk


def _usage_now_sync(uid: str, email: str) -> dict:
    return _deps["apply_reset"](_deps["get_usage"](uid, email))


def _page_units(mode: str) -> int:
    return int(_deps["MODES"][mode if mode in _deps["MODES"] else "fast"]["page"])


def _deep_mult() -> int:
    """1 Chuqur-varaq necha Tez-varaqqa teng (narx backend/monitoring.py MODES dan; matnga qotirib yozilmaydi)."""
    try:
        return max(1, _page_units("deep") // _page_units("fast"))
    except Exception:
        return 2


def _pages_left(usage: dict, mode: str) -> float:
    return _deps["total_credits"](usage) / _page_units(mode)


def _fmt_pages(x: float) -> str:
    if float(x) >= 999999:
        return "∞"
    x = round(float(x), 2)
    return str(int(x)) if x == int(x) else f"{x:.2f}".rstrip("0").rstrip(".")


def _fmt_wait(sec: Any) -> str:
    try:
        sec = int(sec)
    except Exception:
        return ""
    if sec <= 0:
        return ""
    h, m = sec // 3600, (sec % 3600) // 60
    return f"{h} soat {m} daqiqa" if h else f"{m} daqiqa"


async def _balance_info(user: dict) -> Optional[dict]:
    """Bazadan HAR SAFAR yangi o'qiladi (keshlanmaydi) — sayt va bot bir xil raqamni ko'radi."""
    try:
        uid, email = await _ensure_uid(user)
        u = await asyncio.to_thread(_usage_now_sync, uid, email)
        p = _deps["usage_payload"](u)
    except Exception as e:
        _warn("credits", f"kredit o'qish xatosi: {str(e)[:120]}")
        return None
    linked_ok = email != _tg_email(int(user["id"]))
    if not linked_ok and not _is_admin(user):
        return {"linked": False, "locked": True, "email": email}       # Google ulanmaguncha balans/limit ko'rsatilmaydi
    m = p.get("modes") or {}
    fast, deep = m.get("fast") or {}, m.get("deep") or {}
    until = ""
    return {
        "free": fast.get("free_pages", 0), "paid": fast.get("paid_pages", 0),
        "fast": fast.get("pages_exact", 0), "deep": deep.get("pages_exact", 0),
        "daily": fast.get("free_daily_pages", 0),
        "wait": _fmt_wait(p.get("next_reset_in_seconds")) if p.get("window_started") else "",
        "linked": email != _tg_email(int(user["id"])), "email": email,
        "suspended": bool(p.get("free_suspended")), "plan": p.get("plan", "free"), "until": until, "unlimited": bool(p.get("unlimited")), "ad_free": bool(p.get("ad_free")),
    }


def _mask_email(e: str) -> str:
    a, _, d = (e or "").partition("@")
    return (a[:1] + "***@" + d) if d else "***"


def _bar(frac: float, n: int = 10) -> str:
    frac = max(0.0, min(1.0, float(frac)))
    k = int(round(frac * n))
    return "▰" * k + "▱" * (n - k)


LINK_FIRST = "🔗 Balans va slaydlar uchun avval <b>Google akkauntni ulang</b>."


def _balance_block(i: dict) -> str:
    if i.get("locked"):
        return LINK_FIRST
    if i.get("unlimited"):
        return "♾ Varaqlar: <b>cheksiz</b>"
    daily = float(i.get("daily") or 0)
    lines = [f"💎 Varaqlar: <b>{_fmt_pages(float(i['free']) + float(i['paid']))}</b>"]
    if daily and not i.get("suspended"):
        lines.append(f"🎁 Shundan bugungi bepul: <b>{_fmt_pages(i['free'])}</b>/{_fmt_pages(daily)}")
    if i.get("wait") and not i.get("suspended"):
        lines.append(f"🔄 Bepul varaqlar <b>{i['wait']}</b> dan keyin yangilanadi")
    return "\n".join(lines)


def _welcome_text(name: str, info: Optional[dict]) -> str:
    hello = f"👋 <b>Salom, {esc(name)}!</b>" if name else "👋 <b>Salom!</b>"
    bal = ("\n\n" + _balance_block(info)) if (info and not info.get("locked")) else ""
    return f"{hello}\nMavzuni yozing — slayd tayyorlab beraman.{bal}"


async def _credits_text(user: dict) -> str:
    i = await _balance_info(user)
    if not i:
        return "⚠️ Hozir balansni o'qib bo'lmadi. Birozdan keyin qayta urinib ko'ring."
    if i.get("locked"):
        return f"💳 <b>Balans</b>\n{LINK_FIRST}"
    return f"💳 <b>Balans</b>\n{_balance_block(i)}\n\n<i>1 slayd = 1 varaq</i>"


async def _charge(uid: str, email: str, pages: int, tokens: int, mode: str, details: dict) -> Tuple[dict, int]:
    """Slaydlar uchun yechadi (pages=0 bo'lsa — oddiy chat narxi). (usage, yechilgan_birlik)."""
    def _fn(u):
        u = _deps["apply_reset"](u)
        u["total_tokens"] = (u.get("total_tokens") or 0) + tokens
        u["daily_tokens"] = (u.get("daily_tokens") or 0) + tokens
        u, ch, rs = _deps["charge"](u, int(pages), 0, mode)
        return u, (ch, rs)
    async with _ulock(uid):
        if _deps.get("update_atomic"):          # v53: boshqa server nusxasi / webhook bilan to'qnashuvda qayta hisoblaydi
            usage, (charged, reason) = await asyncio.to_thread(_deps["update_atomic"], uid, email, _fn)
        else:
            usage, (charged, reason) = _fn(await asyncio.to_thread(_usage_now_sync, uid, email))
            await asyncio.to_thread(_deps["save_usage"], uid, usage, 0)
        if int(charged) > 0:
            await asyncio.to_thread(_deps["ledger_log"], uid, "tg_" + str(reason), -int(charged), usage, 0, details)
        return usage, int(charged)


# ----------------------------------------------------------------------------------------------
# Supabase: faqat MA'LUMOT (qisqa slayd JSON, ulanish). Fayllar (PPTX/PDF/HTML) HECH QACHON saqlanmaydi.
# Jadvallar: SUPABASE_SCHEMA.sql. Jadval yo'q bo'lsa bot baribir ishlaydi (faqat RAM, restartda tarix yo'qoladi).
# ----------------------------------------------------------------------------------------------
MAX_SAVED = 1          # faqat OXIRGI slayd saqlanadi (yangisi eskisini almashtiradi)
LINK_TTL = 600


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_uuid(v: Any) -> Optional[str]:
    try:
        return str(uuid.UUID(str(v)))
    except Exception:
        return None


def _sign(p: str) -> str:
    return hmac.new(SECRET.encode(), p.encode(), hashlib.sha256).hexdigest()[:20]


def _make_token(kind: str, a: int, b: int, ttl: int) -> str:
    p = f"{kind}.{int(a)}.{int(b)}.{int(time.time()) + int(ttl)}"
    return f"{p}.{_sign(p)}"


def _check_token(kind: str, tok: str) -> Optional[Tuple[int, int]]:
    try:
        k, a, b, exp, sig = str(tok or "").split(".")
        if k != kind or not hmac.compare_digest(sig, _sign(f"{k}.{a}.{b}.{exp}")) or int(exp) < time.time():
            return None
        return int(a), int(b)
    except Exception:
        return None


def _db_warn(e: Exception) -> None:
    _warn("db", f"Supabase jadval xatosi (SUPABASE_SCHEMA.sql ishga tushirilganmi?): {str(e)[:120]}")


def _deck_insert_sync(tid: int, uid: str, deck: dict, topic: str, lang: str) -> Optional[int]:
    sb = _sb()
    if not sb:
        return None
    try:
        r = sb.table("tg_decks").insert({
            "tg_id": int(tid), "user_id": _as_uuid(uid), "title": str(deck.get("title") or "")[:120],
            "topic": (topic or "")[:300], "lang": lang or "uz", "deck": deck,
        }).execute()
        new_id = r.data[0]["id"] if r.data else None
        rows = sb.table("tg_decks").select("id").eq("tg_id", int(tid)).order("updated_at", desc=True).limit(60).execute().data or []
        old = [x["id"] for x in rows[MAX_SAVED:]]
        if old:
            sb.table("tg_decks").delete().in_("id", old).execute()
        return new_id
    except Exception as e:
        _db_warn(e)
        return None


def _deck_update_sync(deck_id: int, tid: int, deck: dict) -> bool:
    sb = _sb()
    if not sb:
        return False
    try:
        sb.table("tg_decks").update({"deck": deck, "title": str(deck.get("title") or "")[:120], "updated_at": _now_iso()}) \
            .eq("id", int(deck_id)).eq("tg_id", int(tid)).execute()
        return True
    except Exception as e:
        _db_warn(e)
        return False


def _deck_list_sync(tid: int) -> List[dict]:
    sb = _sb()
    if not sb:
        return []
    try:
        return sb.table("tg_decks").select("id,title,updated_at").eq("tg_id", int(tid)).order("updated_at", desc=True).limit(MAX_SAVED).execute().data or []
    except Exception as e:
        _db_warn(e)
        return []


def _deck_get_sync(tid: int, deck_id: Optional[int] = None) -> Optional[dict]:
    sb = _sb()
    if not sb:
        return None
    try:
        q = sb.table("tg_decks").select("id,title,topic,lang,deck").eq("tg_id", int(tid))      # tg_id sharti: begona slaydni ochib bo'lmaydi
        q = q.eq("id", int(deck_id)) if deck_id else q.order("updated_at", desc=True).limit(1)
        rows = q.execute().data or []
        return rows[0] if rows else None
    except Exception as e:
        _db_warn(e)
        return None


def _deck_clear_sync(tid: int) -> int:
    sb = _sb()
    if not sb:
        return 0
    try:
        return len(sb.table("tg_decks").delete().eq("tg_id", int(tid)).execute().data or [])
    except Exception as e:
        _db_warn(e)
        return 0


async def _restore_deck(chat_id: int, deck_id: Optional[int] = None) -> bool:
    """RAM'da deck bo'lmasa (restart / eskirgan) — bazadagi oxirgi (yoki tanlangan) slaydni tiklaydi. Private chat: chat_id == tg_id."""
    st = _state(chat_id)
    if st.get("deck") and not deck_id:
        return True
    row = await asyncio.to_thread(_deck_get_sync, chat_id, deck_id)
    if not row or not decks:
        return False
    deck = decks.normalize_deck(row.get("deck"), MAX_SLIDES + 10, row.get("title") or "")
    if not deck:
        return False
    st.update(deck=deck, deck_id=row.get("id"), topic=row.get("topic") or "", lang=row.get("lang") or "uz", imgs={}, awaiting=None)
    return True


# ----------------------------------------------------------------------------------------------
# Sayt akkaunti (Google) <-> Telegram ulash (bir martalik kod orqali). Bir xil balans uchun.
# ----------------------------------------------------------------------------------------------
_BOT_USER = ""


async def _bot_username() -> str:
    global _BOT_USER
    if not _BOT_USER:
        me = await tg("getMe")
        if isinstance(me, dict):
            _BOT_USER = str(me.get("username") or "")
    return _BOT_USER


def _link_code_sync(user_id: str, email: str) -> str:
    sb = _sb()
    alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
    code = "".join(secrets.choice(alphabet) for _ in range(8))
    sb.table("tg_link_codes").delete().eq("user_id", user_id).execute()
    sb.table("tg_link_codes").insert({
        "code": code, "user_id": user_id, "email": email,
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=LINK_TTL)).isoformat(),
    }).execute()
    return code


def _link_consume_sync(user: dict, code: str) -> dict:
    """Kodni ATOMIK ishlatadi: DELETE ... RETURNING — bir kodni faqat bitta so'rov oladi (ikki marta ishlatib bo'lmaydi).
    Natija: {"ok": True, "tid", "user_id", "email"} yoki {"error": ...}. Ulashning o'zi — async _link_apply()."""
    sb = _sb()
    if not sb:
        return {"error": "db"}
    tid = int(user["id"])
    code = re.sub(r"[^A-Za-z0-9]", "", code or "").upper()[:16]
    if not code:
        return {"error": "bad_code"}
    try:
        res = sb.table("tg_link_codes").delete().eq("code", code).execute()     # bir martalik
    except Exception as e:
        _db_warn(e)
        return {"error": "db"}
    if not res.data:
        return {"error": "bad_code"}
    row = res.data[0]
    try:
        exp = datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        expired = exp < datetime.now(timezone.utc)
    except Exception:
        expired = True
    if expired:
        return {"error": "bad_code"}
    return {"ok": True, "tid": tid, "user_id": str(row["user_id"]), "email": str(row["email"])}


def _tg_src_uid_sync(tid: int, uid: str) -> Optional[str]:
    """Botda yaratilgan tg<ID>@t.me akkaunti (sayt akkauntidan boshqa bo'lsa) — pullik varaqlar shu yerdan ko'chadi."""
    sb = _sb()
    if not sb:
        return None
    q = sb.table("user_usage").select("user_id").eq("email", _tg_email(tid)).limit(1).execute()
    if q.data and str(q.data[0]["user_id"]) != uid:
        return str(q.data[0]["user_id"])
    return None


def _move_paid_sync(src_uid: str, uid: str, email: str, tid: int) -> int:
    """Pullik varaqlarni (BIRLIK) src -> dst ko'chiradi. Avval SQL funksiyasi (bitta tranzaksiya, atomik);
    funksiya bazada yo'q bo'lsa — zaxira yo'l (chaqiruvchi ikkala foydalanuvchi lock'ini ushlab turadi)."""
    sb = _sb()
    _deps["get_usage"](uid, email)                     # qabul qiluvchi qatori bazada bo'lsin
    try:
        r = sb.rpc("transfer_paid_credits", {"p_from": src_uid, "p_to": uid}).execute()
        d = r.data[0] if isinstance(r.data, list) and r.data else r.data
        moved = int((d or {}).get("moved") or 0) if isinstance(d, dict) else int(d or 0)
        if moved > 0:
            src = _deps["apply_reset"](_deps["get_usage"](src_uid, _tg_email(tid)))
            dst = _deps["apply_reset"](_deps["get_usage"](uid, email))
            try:
                _deps["ledger_log"](uid, "tg_link_in", moved, dst, 0, {"from": src_uid})
                _deps["ledger_log"](src_uid, "tg_link_out", -moved, src, 0, {"to": uid})
            except Exception:
                pass
        return moved
    except Exception as e:
        msg = str(e).lower()
        if "transfer_paid_credits" not in msg and "pgrst202" not in msg and "could not find" not in msg:
            raise
    # Zaxira: SQL funksiyasi yo'q (SUPABASE_SCHEMA.sql yangilanmagan)
    src = _deps["apply_reset"](_deps["get_usage"](src_uid, _tg_email(tid)))
    paid = int(src.get("paid_credits") or 0)
    if paid <= 0:
        return 0
    dst = _deps["apply_reset"](_deps["get_usage"](uid, email))
    dst["paid_credits"] = int(dst.get("paid_credits") or 0) + paid
    if _deps["save_usage"](uid, dst, 0) is False:
        raise RuntimeError("dst_save_failed")
    src["paid_credits"] = 0
    if _deps["save_usage"](src_uid, src, 0) is False:
        dst["paid_credits"] = int(dst["paid_credits"]) - paid           # qaytarish: varaq ikki akkauntda qolmasin
        _deps["save_usage"](uid, dst, 0)
        raise RuntimeError("src_save_failed")
    try:
        _deps["ledger_log"](uid, "tg_link_in", paid, dst, 0, {"from": src_uid})
        _deps["ledger_log"](src_uid, "tg_link_out", -paid, src, 0, {"to": uid})
    except Exception:
        pass
    return paid


def _link_rows_sync(tid: int, uid: str, email: str) -> bool:
    sb = _sb()
    try:
        sb.table("tg_links").delete().eq("tg_id", tid).execute()
        sb.table("tg_links").delete().eq("user_id", uid).execute()
        sb.table("tg_links").insert({"tg_id": tid, "user_id": uid, "email": email}).execute()
    except Exception as e:
        _db_warn(e)
        return False
    _uids[tid] = (uid, email)
    return True


async def _link_apply(tid: int, uid: str, email: str) -> dict:
    """Telegram ID ni sayt akkauntiga bog'laydi (kod orqali ham, havola orqali ham shu yerga keladi).
    Oldin botda sotib olingan PULLIK varaqlar tg<ID>@t.me akkauntidan sayt akkauntiga ko'chiriladi.
    (Bepul kunlik varaqlar ko'chirilmaydi — ikki akkaunt orqali ko'paytirib bo'lmasin.)
    Ikkala akkauntning lock'i (sayt/bot/webhook bilan umumiy) ushlanadi — to'lov yoki slayd yechish bilan poyga bo'lmaydi."""
    if not _sb():
        return {"error": "db"}
    moved = 0
    try:
        src_uid = await asyncio.to_thread(_tg_src_uid_sync, tid, uid)
        if src_uid:
            a, b = sorted([src_uid, uid])
            async with _ulock(a):
                async with _ulock(b):
                    moved = await asyncio.to_thread(_move_paid_sync, src_uid, uid, email, tid)
    except Exception as e:
        _warn("link-move", f"pullik varaqlarni ko'chirib bo'lmadi: {str(e)[:120]}")
    if not await asyncio.to_thread(_link_rows_sync, tid, uid, email):
        return {"error": "db"}
    pages = 0.0
    try:
        pages = moved / _page_units("fast")
    except Exception:
        pass
    return {"ok": True, "email": email, "moved_pages": pages}


def _unlink_sync(tid: int) -> bool:
    sb = _sb()
    if not sb:
        return False
    try:
        sb.table("tg_links").delete().eq("tg_id", int(tid)).execute()
        _uids.pop(int(tid), None)
        _uid_ts.pop(int(tid), None)
        return True
    except Exception as e:
        _db_warn(e)
        return False


def _tg_for_uid_sync(user_id: str) -> Optional[Tuple[int, str]]:
    sb = _sb()
    if not sb:
        return None
    email = ""
    r = sb.table("user_usage").select("email").eq("user_id", user_id).limit(1).execute()
    if r.data:
        email = str(r.data[0].get("email") or "")
    l = sb.table("tg_links").select("tg_id").eq("user_id", user_id).limit(1).execute()
    if l.data:
        return int(l.data[0]["tg_id"]), email
    m = re.match(r"^tg(\d+)@t\.me$", email)
    return (int(m.group(1)), email) if m else None


async def notify_purchase(user_id: str, pages: int, refund: bool = False, kind: str = "pack") -> None:
    """main.py to'lov webhook'idan: balans/reja bazada yangilangan — foydalanuvchiga darhol xabar."""
    if not ENABLED:
        return
    try:
        hit = await asyncio.to_thread(_tg_for_uid_sync, user_id)
        if not hit:
            return
        tid, email = hit
        usage = await asyncio.to_thread(_usage_now_sync, user_id, email)
        left = _pages_left(usage, "fast")
        head = f"↩️ To'lov qaytarildi: <b>−{pages}</b> varaq." if refund else f"✅ To'lov qabul qilindi: <b>+{pages}</b> varaq!"
        await _send(tid, f"{head}\n💳 Balansingiz: <b>{_fmt_pages(left)}</b> varaq", kb_main())
    except Exception as e:
        _warn("notify", f"to'lov xabari yuborilmadi: {str(e)[:100]}")


async def notify_user(user_id: str, text: str) -> None:
    """Admin amali (Pro berildi, varaq qo'shildi...) haqida foydalanuvchiga xabar (HTML)."""
    if not ENABLED:
        return
    try:
        hit = await asyncio.to_thread(_tg_for_uid_sync, str(user_id))
        if hit:
            await _send(hit[0], text, kb_main())
    except Exception as e:
        _warn("notify-user", f"xabar yuborilmadi: {str(e)[:100]}")


async def admin_send(tid: int, text: str) -> bool:
    """Ommaviy xabar (admin paneldan): oddiy matn (HTML belgilar escape qilinadi)."""
    if not ENABLED:
        return False
    r = await tg("sendMessage", chat_id=int(tid), text=esc(text)[:4000], disable_web_page_preview=True)
    return bool(r)


# ----------------------------------------------------------------------------------------------
# Admin: «admin» deb yozilsa — FAQAT tasdiqlangan admin (Telegram ID + ulangan Google email) ga panel ochiladi
# ----------------------------------------------------------------------------------------------
def _is_admin(user: dict) -> bool:
    adm = _deps.get("admin")
    return bool(adm and adm.is_tg_admin((user or {}).get("id")))


async def _google_ok(cid: int, user: dict) -> bool:
    """Slayd yaratishdan oldin Google akkaunt ulangan bo'lishi shart (admin — istisno)."""
    if DEV_MODE or _is_admin(user):
        return True
    try:
        _uid, email = await _ensure_uid(user)
    except Exception:
        return True                       # baza xatosi — keyingi bosqich o'zi tushunarli xabar beradi
    if not email.endswith("@" + TG_EMAIL_DOMAIN):
        return True
    await _send(cid, "🔗 Slayd yaratish uchun avval <b>Google akkauntni ulang</b>.\nBu balansingizni saqlab qolish uchun kerak.",
                {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})
    return False


# ----------------------------------------------------------------------------------------------
# Admin: «admin» yoki /admin — FAQAT ADMIN_TG_IDS dagi Telegram ID ga ochiladi. Boshqalarga: «Bunday buyruq mavjud emas».
# Foydalanuvchi ID / email / UUID bo'yicha topiladi. Hammasi bazada (Supabase) saqlanadi va jurnalga yoziladi.
# ----------------------------------------------------------------------------------------------
ADMIN_CMDS = {"/give", "/take", "/unlimited", "/fill", "/reset", "/block", "/unblock", "/user", "/merge", "/daily"}
ADMIN_HELP = (
    "🛡 <b>Admin</b>\n"
    "<code>/give ID 50</code> — varaq qo'shish\n"
    "<code>/take ID 20</code> — varaq ayirish (<code>/take ID all</code> — hammasini 0 qilish)\n"
    "<code>/daily ID 0</code> — shaxsiy kunlik bepul limit (<code>/daily ID off</code> — odatiy limitga qaytarish)\n"
    "<code>/merge email</code> — bir email'dagi eski akkauntlarni bittaga birlashtirish (<code>/merge all</code> — hammasi)\n"
    "<code>/unlimited ID</code> — cheksiz qilish (<code>/unlimited ID off</code> — olib tashlash)\n"
    "<code>/fill ID</code> — bugungi bepul limitni to'ldirish\n"
    "<code>/reset ID</code> — varaqlarni 0 qilish, cheksizni olib tashlash\n"
    "<code>/block ID</code> · <code>/unblock ID</code>\n"
    "<code>/user ID</code> — foydalanuvchi holati\n\n"
    "<i>ID — Telegram ID, email yoki UUID. Telegram ID ni foydalanuvchi /id orqali biladi.</i>"
)


def _dupes_warning(row: dict) -> str:
    """Bir email bilan bir nechta akkaunt bo'lsa — qaysi biri tanlanganini va boshqalarini ko'rsatadi."""
    d = row.get("_dupes") or []
    if not d:
        return ""
    lines = [f"\n\n⚠️ Bu email bilan <b>{len(d) + 1}</b> ta akkaunt bor. Tanlandi: <code>{esc(str(row.get('user_id')))}</code> "
             "(Telegram'ga ulangan / oxirgi faol)."]
    for b in d[:4]:
        bal = "♾" if b.get("unlimited") else _fmt_pages(float(b.get("free_pages") or 0) + float(b.get("paid_pages") or 0))
        lines.append(f"• <code>{esc(str(b.get('user_id')))}</code> — {bal} varaq")
    lines.append(f"Bittaga birlashtirish: <code>/merge {esc(str(row.get('email') or ''))}</code>")
    return "\n".join(lines)


def _user_line(b: dict) -> str:
    who = b.get("email") or ""
    if b.get("tg_id"):
        who += f" · TG {b['tg_id']}"
    bal = "♾ cheksiz" if b.get("unlimited") else f"{_fmt_pages(float(b.get('free_pages') or 0) + float(b.get('paid_pages') or 0))} varaq"
    return f"👤 {esc(who)}\n💎 {bal}" + (" · ⛔ bloklangan" if b.get("blocked") else "")


async def _admin_command(cid: int, user: dict, cmd: str, arg: str) -> None:
    adm = _deps.get("admin")
    if not adm or not adm.is_tg_admin(user.get("id")):
        await _send(cid, "Bunday buyruq mavjud emas.")            # oddiy foydalanuvchiga hech narsa oshkor bo'lmaydi
        return
    if cmd == "/admin":
        await _admin_home(cid)
        return
    parts = arg.split()
    if not parts:
        await _admin_home(cid)
        return
    actor = f"tg:{int(user['id'])}"
    target = parts[0]
    if cmd == "/merge":
        try:
            if target.lower() == "all":
                r = await asyncio.to_thread(adm.merge_all_duplicates, actor)
                txt = (f"✅ Birlashtirildi: <b>{r['emails']}</b> email, <b>{r['merged']}</b> ta eski akkaunt, "
                       f"<b>{_fmt_pages(r['moved_pages'])}</b> pullik varaq ko'chirildi.")
                if r["errors"]:
                    txt += "\n⚠️ " + "\n⚠️ ".join(esc(x) for x in r["errors"][:10])
                await _send(cid, txt)
                return
            r = await asyncio.to_thread(adm.merge_email_accounts, actor, target)
            if not r.get("merged"):
                await _send(cid, "ℹ️ Birlashtiradigan eski akkaunt yo'q." + (
                    f"\n⚠️ Auth'da faol boshqa akkauntlar: {', '.join(r['alive_others'])}" if r.get("alive_others") else ""))
                return
            b = await asyncio.to_thread(adm.user_brief, r["target"])
            await _send(cid, f"✅ {r['merged']} ta eski akkaunt birlashtirildi (+{_fmt_pages(r['moved_pages'])} pullik varaq)\n{_user_line(b)}")
        except adm.AdminError as e:
            await _send(cid, f"⚠️ {esc(e.msg)}")
        return
    try:
        row = await asyncio.to_thread(adm.resolve_target, target)
        uid = str(row["user_id"])
        body: Dict[str, Any] = {"user_id": uid}
        if cmd in ("/give", "/take"):
            if len(parts) < 2:
                await _send(cid, f"Misol: <code>{cmd} {esc(target)} 50</code>")
                return
            if cmd == "/take" and parts[1].lower() in ("all", "hammasi", "barchasi"):
                body.update(action="set_credits", free_pages=0, paid_pages=0)
            else:
                n = abs(float(parts[1].replace(",", ".")))
                body.update(action="add_credits", pages=n if cmd == "/give" else -n)
        elif cmd == "/daily":
            if len(parts) < 2:
                await _send(cid, f"Misol: <code>/daily {esc(target)} 0</code> yoki <code>/daily {esc(target)} off</code>")
                return
            v = parts[1].lower()
            body.update(action="daily_override", pages=None if v in ("off", "yoq", "yo'q", "default") else abs(float(v.replace(",", "."))))
        elif cmd == "/unlimited":
            body.update(action="unlimited", value=not (len(parts) > 1 and parts[1].lower() in ("off", "0", "yoq", "yo'q", "no")))
        elif cmd == "/fill":
            body.update(action="fill_free")
        elif cmd in ("/block", "/unblock"):
            body.update(action="block", value=cmd == "/block")
        elif cmd == "/reset":
            await asyncio.to_thread(adm.user_action, actor, {"user_id": uid, "action": "set_credits", "free_pages": 0, "paid_pages": 0})
            body.update(action="unlimited", value=False)
        elif cmd == "/user":
            b = (await asyncio.to_thread(adm.user_brief, uid))
            await _send(cid, _user_line(b) + _dupes_warning(row))
            return
        res = await asyncio.to_thread(adm.user_action, actor, body)
        await _send(cid, f"✅ {esc(res.get('note') or 'Bajarildi')}\n{_user_line(res['user'])}" + _dupes_warning(row))
    except adm.AdminError as e:
        await _send(cid, f"⚠️ {esc(e.msg)}")
    except ValueError:
        await _send(cid, "⚠️ Son noto'g'ri. Misol: <code>/give 123456789 50</code>")
    except Exception as e:
        _warn("admin", f"admin amali xatosi: {type(e).__name__}: {str(e)[:120]}")
        await _send(cid, "⚠️ Bajarib bo'lmadi. Keyinroq urinib ko'ring.")


# ----------------------------------------------------------------------------------------------
# ADMIN PANEL — to'liq TUGMALAR bilan, botning ichida (havola kerak emas).
# «admin» yoki /admin yozing: Statistika · Foydalanuvchi · Reklamalar · Xabar yuborish · Reklama sozlamalari.
# Faqat ADMIN_TG_IDS dagi Telegram ID ishlaydi; boshqalarga hech narsa ko'rinmaydi.
# ----------------------------------------------------------------------------------------------
AD_BTN_TEXTS = ["Batafsil", "Ochish", "Ko'rish", "Sotib olish", "Yozilish"]
AD_HOURS = [1, 3, 6, 12, 24, 48, 72, 168]


def _akb(rows: list) -> dict:
    return {"inline_keyboard": rows}


_HOME = [_btn("🏠 Admin menyu", "a:home")]


async def _show(cid: int, mid: Optional[int], text: str, kb: Optional[dict] = None) -> None:
    """Xabarni tahrirlaydi (iloji bo'lsa), bo'lmasa yangisini yuboradi."""
    if mid:
        r = await tg("editMessageText", chat_id=cid, message_id=mid, text=text[:4000], parse_mode="HTML",
                     disable_web_page_preview=True, reply_markup=kb or {"inline_keyboard": []})
        if r:
            return
    await _send(cid, text, kb)


def _adm(user: dict):
    a = _deps.get("admin")
    return a if (a and a.is_tg_admin((user or {}).get("id"))) else None


def _hours_text(h: float) -> str:
    h = float(h)
    if h < 24:
        return f"{int(h) if h == int(h) else h} soat"
    d = h / 24.0
    return f"{int(d) if d == int(d) else round(d, 1)} kun"


def _left_text(ends_at: Any) -> str:
    try:
        d = datetime.fromisoformat(str(ends_at).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        sec = (d - datetime.now(timezone.utc)).total_seconds()
    except Exception:
        return "muddatsiz"
    if sec <= 0:
        return "⌛ tugagan"
    h = sec / 3600
    return f"{int(h)} soat qoldi" if h >= 1 else f"{max(1, int(sec // 60))} daqiqa qoldi"


async def _admin_home(cid: int, mid: Optional[int] = None) -> None:
    _state(cid).pop("adm", None)
    _adm_disk_clear(cid)
    _ad_sweeper_start()
    await _show(cid, mid, "🛡 <b>Admin panel</b>\nKerakli bo'limni tanlang 👇\n\n" + ADMIN_HELP.split("\n", 1)[1], _akb([
        [_btn("📊 Statistika", "a:stats"), _btn("👥 Foydalanuvchi", "a:u")],
        [_btn("📢 Reklamalar", "a:ads"), _btn("📣 Xabar yuborish", "a:bc")],
        [_btn("⚙️ Reklama sozlamalari", "a:set")],
    ]))


async def _admin_stats(cid: int, mid: Optional[int], adm) -> None:
    try:
        s = await asyncio.to_thread(adm.stats)
    except Exception:
        await _show(cid, mid, "⚠️ Statistika olinmadi.", _akb([_HOME]))
        return

    def n(k):
        v = s.get(k)
        return "—" if v is None else f"{int(v):,}".replace(",", " ")
    text = ("📊 <b>Statistika</b>\n\n"
            f"👥 Hamma foydalanuvchi: <b>{n('users_total')}</b>\n"
            f"🟢 24 soatda faol: <b>{n('users_24h')}</b>  ·  7 kunda: <b>{n('users_7d')}</b>\n"
            f"🆕 Yangi (7 kun): <b>{n('new_7d')}</b>\n"
            f"✈️ Telegram orqali: <b>{n('tg_users')}</b>  ·  Google ulangan: <b>{n('linked')}</b>\n"
            f"♾ Cheksiz: <b>{n('unlimited')}</b>  ·  ⛔ Bloklangan: <b>{n('blocked')}</b>\n"
            f"💳 To'lovlar (30 kun): <b>{n('purchases_30d')}</b>\n\n"
            f"📢 Faol reklama: <b>{n('ads_active')}</b>\n"
            f"👁 Ko'rsatilgan: <b>{n('ad_impressions')}</b>  ·  🖱 Bosilgan: <b>{n('ad_clicks')}</b>  ·  CTR: <b>{s.get('ad_ctr', 0)}%</b>")
    await _show(cid, mid, text, _akb([[_btn("🔄 Yangilash", "a:stats")], _HOME]))


# ---------- foydalanuvchi ----------
def _user_card_kb(b: dict) -> dict:
    return _akb([
        [_btn("➕ 10", "a:ua:g10"), _btn("➕ 50", "a:ua:g50"), _btn("➕ 100", "a:ua:g100")],
        [_btn("➖ 10", "a:ua:t10"), _btn("➖ 50", "a:ua:t50"), _btn("✍️ Boshqa son", "a:ua:num")],
        [_btn("♾ Cheksizni o'chirish" if b.get("unlimited") else "♾ Cheksiz qilish", "a:ua:unl"),
         _btn("🔄 Bugungi limitni to'ldirish", "a:ua:fill")],
        [_btn("🧹 Varaqni 0 qilish", "a:ua:rst"), _btn("✅ Blokdan chiqarish" if b.get("blocked") else "⛔ Bloklash", "a:ua:blk")],
        [_btn("👤 Boshqa foydalanuvchi", "a:u"), _btn("🏠 Menyu", "a:home")],
    ])


async def _admin_user_card(cid: int, mid: Optional[int], adm, uid: str, note: str = "") -> None:
    try:
        b = await asyncio.to_thread(adm.user_brief, uid)
    except Exception:
        await _show(cid, mid, "⚠️ Foydalanuvchi topilmadi.", _akb([[_btn("👤 Qayta qidirish", "a:u")], _HOME]))
        return
    st = _state(cid)
    st["adm"] = {"uid": uid}
    head = (f"✅ {esc(note)}\n\n" if note else "") + "👤 <b>Foydalanuvchi</b>\n" + _user_line(b)
    await _show(cid, mid, head, _user_card_kb(b))


async def _admin_user_action(cid: int, mid: Optional[int], user: dict, adm, code: str) -> None:
    st = _state(cid)
    uid = (st.get("adm") or {}).get("uid")
    if not uid:
        await _show(cid, mid, "Avval foydalanuvchini tanlang.", _akb([[_btn("👤 Foydalanuvchi", "a:u")], _HOME]))
        return
    actor = f"tg:{int(user['id'])}"
    body: Dict[str, Any] = {"user_id": uid}
    if code == "num":
        st["adm"] = {"uid": uid, "await": "num"}
        await _show(cid, mid, "✍️ Sonni yozing:\n<code>+25</code> — qo'shish\n<code>-10</code> — ayirish\n<code>25</code> — qo'shish",
                    _akb([[_btn("↩️ Orqaga", "a:ua:back")]]))
        return
    if code == "back":
        await _admin_user_card(cid, mid, adm, uid)
        return
    try:
        if code[0] in "gt" and code[1:].isdigit():
            n = int(code[1:])
            body.update(action="add_credits", pages=n if code[0] == "g" else -n)
        elif code == "unl":
            cur = await asyncio.to_thread(adm.user_brief, uid)
            body.update(action="unlimited", value=not cur.get("unlimited"))
        elif code == "fill":
            body.update(action="fill_free")
        elif code == "blk":
            cur = await asyncio.to_thread(adm.user_brief, uid)
            body.update(action="block", value=not cur.get("blocked"))
        elif code == "rst":
            await asyncio.to_thread(adm.user_action, actor, {"user_id": uid, "action": "set_credits", "free_pages": 0, "paid_pages": 0})
            body.update(action="unlimited", value=False)
        else:
            return
        res = await asyncio.to_thread(adm.user_action, actor, body)
        await _admin_user_card(cid, mid, adm, uid, res.get("note") or "Bajarildi")
    except adm.AdminError as e:
        await _show(cid, mid, f"⚠️ {esc(e.msg)}", _akb([[_btn("↩️ Orqaga", "a:ua:back")]]))
    except Exception as e:
        _warn("admin", f"admin tugma xatosi: {type(e).__name__}: {str(e)[:100]}")
        await _show(cid, mid, "⚠️ Bajarib bo'lmadi.", _akb([[_btn("↩️ Orqaga", "a:ua:back")]]))


# ---------- reklamalar ----------
async def _admin_ads(cid: int, mid: Optional[int], adm, user: dict) -> None:
    try:
        rows = (await asyncio.to_thread(adm._dispatch, "ads", {}, f"tg:{int(user['id'])}")).get("ads", [])
    except Exception as e:
        msg = getattr(e, "msg", "") or "Reklama jadvali ulanmagan (SUPABASE_SCHEMA.sql ni ishga tushiring)."
        await _show(cid, mid, f"⚠️ {esc(msg)}", _akb([[_btn("➕ Yangi reklama", "a:ad:new")], _HOME]))
        return
    lines = ["📢 <b>Reklamalar</b>"]
    kb: list = []
    if not rows:
        lines.append("\nHali reklama yo'q. «Yangi reklama» ni bosing.")
    for _i, r in enumerate(rows[:8], 1):
        left = _left_text(r.get("ends_at")) if r.get("ends_at") else "muddatsiz"
        on = bool(r.get("active")) and left != "⌛ tugagan"
        where = {"bot": "🤖 bot", "site": "🌐 sayt"}.get(r.get("placement"), "🤖+🌐")
        title = (r.get("title") or r.get("body") or ("🖼 media" if r.get("media_type") != "none" else "—")).strip().replace("\n", " ")[:28]
        kind_tag = "📣 e'lon" if str(r.get("kind") or "ad") == "notice" else "📢 reklama"
        lines.append(f"\n{'🟢' if on else '⚪️'} <b>{_i}.</b> {esc(title)}\n   {kind_tag} · {where} · {left} · 👁 {r.get('impressions') or 0} · 🖱 {r.get('clicks') or 0}")
        if str(r.get("kind") or "ad") == "notice":
            # v56: e'lon — bitta tugma bilan bekor qilinadi: saytdagi popup yopiladi va botdagi xabarlar chatlardan o'chadi
            kb.append([_btn(f"👁 {_i}", f"a:ad:v:{r['id']}"),
                       (_btn(f"❌ Bekor qilish {_i}", f"a:ad:c:{r['id']}") if on else _btn(f"▶️ Qayta yoqish {_i}", f"a:ad:t:{r['id']}")),
                       _btn(f"🗑 O'chirish {_i}", f"a:ad:d:{r['id']}")])
        else:
            kb.append([_btn(f"👁 {_i}", f"a:ad:v:{r['id']}"),
                       _btn((f"⏹ To'xtatish {_i}" if on else f"▶️ Yoqish {_i}"), f"a:ad:t:{r['id']}"),
                       _btn(f"🗑 Botdan ham o'chirish {_i}", f"a:ad:d:{r['id']}")])
        kb.append([_btn(f"📤 Hozir hammaga {_i}", f"a:ad:p:{r['id']}"), _btn(f"🔁 Joyi {_i}", f"a:ad:pl:{r['id']}")])
    kb.append([_btn("➕ Yangi reklama", "a:ad:new"), _btn("📣 Yangi e'lon (reklamasiz)", "a:ad:newn")])
    kb.append(_HOME)
    await _show(cid, mid, "\n".join(lines), _akb(kb))


_AD_SENT: Dict[int, list] = {}          # reklama_id -> [(chat_id, message_id, vaqt)] — reklama tugasa/o'chsa chatdan ham o'chiriladi
_AD_SENT_FILE = os.path.join(os.environ.get("TMPDIR", "/tmp"), "ss_ad_sent.json")
_ad_sweeper_task: Optional["asyncio.Task"] = None


_AD_LOCK = threading.Lock()
_AD_PENDING: list = []          # bazaga hali yozilmagan [ad_id, chat_id, msg_id, vaqt]
_AD_DIRTY = False
_AD_DB_OFF = False              # ad_sent jadvali yo'q bo'lsa — faqat fayl (SUPABASE_SCHEMA.sql)
_AD_PHOTO_ID: Dict[int, str] = {}   # reklama_id -> Telegram file_id (rasm bir marta yuklanadi, qolganlarga file_id bilan)


def _ad_sent_save() -> None:
    try:
        with _AD_LOCK:
            snap = {str(k): [list(x) for x in v] for k, v in _AD_SENT.items()}
        with open(_AD_SENT_FILE, "w", encoding="utf-8") as f:
            json.dump(snap, f)
    except Exception:
        pass


def _ad_db_off(e: Exception) -> None:
    global _AD_DB_OFF
    m = str(e)
    if any(x in m for x in ("does not exist", "PGRST205", "PGRST204", "relation", "schema cache")):
        _AD_DB_OFF = True
    _warn("adsent", f"ad_sent jadvali (SUPABASE_SCHEMA.sql ishga tushirilganmi?): {m[:110]}")


def _ad_db_flush_sync() -> None:
    if _AD_DB_OFF:
        return
    with _AD_LOCK:
        batch = list(_AD_PENDING)
        del _AD_PENDING[:]
    sb = _sb() if batch else None
    if not sb:
        return
    for i in range(0, len(batch), 200):
        rows = [{"ad_id": int(a), "chat_id": int(c), "msg_id": int(m), "sent_at": datetime.fromtimestamp(float(t), timezone.utc).isoformat()}
                for a, c, m, t in batch[i:i + 200]]
        try:
            sb.table("ad_sent").insert(rows).execute()
        except Exception as e:
            _ad_db_off(e)
            return


def _ad_sent_persist() -> None:
    global _AD_DIRTY
    _AD_DIRTY = False
    _ad_sent_save()
    _ad_db_flush_sync()


def _ad_sent_load() -> None:
    try:
        with open(_AD_SENT_FILE, "r", encoding="utf-8") as f:
            for k, v in (json.load(f) or {}).items():
                _AD_SENT.setdefault(int(k), [list(x) for x in v])
    except Exception:
        pass


def _ad_sent_load_db() -> None:
    """Bot qayta ishga tushganda: oxirgi 47 soatda yuborilgan reklama xabarlari bazadan tiklanadi."""
    sb = _sb()
    if not sb or _AD_DB_OFF:
        return
    since = (datetime.now(timezone.utc) - timedelta(hours=47)).isoformat()
    seen = {(int(a), int(c), int(m)) for a, lst in _AD_SENT.items() for c, m, _t in lst}
    off = 0
    try:
        while off < 60000:
            rows = sb.table("ad_sent").select("ad_id,chat_id,msg_id,sent_at").gte("sent_at", since).order("id").range(off, off + 999).execute().data or []
            for r in rows:
                key = (int(r["ad_id"]), int(r["chat_id"]), int(r["msg_id"]))
                if key in seen:
                    continue
                seen.add(key)
                try:
                    ts = datetime.fromisoformat(str(r["sent_at"]).replace("Z", "+00:00")).timestamp()
                except Exception:
                    ts = time.time()
                _AD_SENT.setdefault(key[0], []).append([key[1], key[2], ts])
            if len(rows) < 1000:
                break
            off += 1000
        sb.table("ad_sent").delete().lt("sent_at", since).execute()          # 47 soatdan eskisi endi o'chirilmaydi — bazani tozalaymiz
    except Exception as e:
        _ad_db_off(e)


def _ad_sent_db_items(ad_id: int) -> list:
    sb = _sb()
    if not sb or _AD_DB_OFF:
        return []
    out: list = []
    off = 0
    try:
        while off < 60000:
            rows = sb.table("ad_sent").select("chat_id,msg_id,sent_at").eq("ad_id", int(ad_id)).order("id").range(off, off + 999).execute().data or []
            for r in rows:
                try:
                    ts = datetime.fromisoformat(str(r["sent_at"]).replace("Z", "+00:00")).timestamp()
                except Exception:
                    ts = time.time()
                out.append([int(r["chat_id"]), int(r["msg_id"]), ts])
            if len(rows) < 1000:
                break
            off += 1000
    except Exception as e:
        _ad_db_off(e)
    return out


def _ad_sent_db_delete(ad_id: int) -> None:
    sb = _sb()
    if not sb or _AD_DB_OFF:
        return
    try:
        sb.table("ad_sent").delete().eq("ad_id", int(ad_id)).execute()
    except Exception as e:
        _ad_db_off(e)


def _ad_exists(ad_id: int) -> Optional[bool]:
    """True/False — reklama bazada bormi; None — baza javob bermadi (bunda hech narsa o'chirilmaydi)."""
    sb = _sb()
    if not sb:
        return None
    try:
        return bool(sb.table("ads").select("id").eq("id", int(ad_id)).limit(1).execute().data)
    except Exception:
        return None


def _ad_sent_add(ad_id: int, chat_id: int, msg_id: int) -> None:
    """RAM'ga yozadi; faylga/bazaga sweeper har 15 s da BIR MARTA (ming kishiga yuborilganda ham bot qotmaydi)."""
    global _AD_DIRTY
    now = time.time()
    with _AD_LOCK:
        lst = _AD_SENT.setdefault(int(ad_id), [])
        lst.append([int(chat_id), int(msg_id), now])
        if len(lst) > 20000:
            del lst[:2000]
        _AD_PENDING.append([int(ad_id), int(chat_id), int(msg_id), now])
        if len(_AD_PENDING) > 30000:
            del _AD_PENDING[:5000]
    _AD_DIRTY = True


async def _ad_purge(ad_id: int) -> int:
    """Reklamaning hamma yuborilgan xabarlarini chatlardan o'chiradi (RAM + fayl + baza)."""
    with _AD_LOCK:
        items = _AD_SENT.pop(int(ad_id), [])
        _AD_PENDING[:] = [x for x in _AD_PENDING if int(x[0]) != int(ad_id)]
    try:
        extra = await asyncio.to_thread(_ad_sent_db_items, int(ad_id))
    except Exception:
        extra = []
    have = {(int(c), int(m)) for c, m, _t in items}
    items = list(items) + [x for x in extra if (x[0], x[1]) not in have]
    _AD_PHOTO_ID.pop(int(ad_id), None)
    _AD_REPORTS.pop(int(ad_id), None)
    n = 0
    for chat_id, msg_id, ts in items:
        if time.time() - ts > 47 * 3600:
            continue                     # Telegram 48 soatdan eskisini o'chirtirmaydi
        try:
            if await tg("deleteMessage", chat_id=chat_id, message_id=msg_id):
                n += 1
        except Exception:
            pass
        await asyncio.sleep(0.04)
    await asyncio.to_thread(_ad_sent_db_delete, int(ad_id))
    await asyncio.to_thread(_ad_sent_save)
    return n


_PREVIEWS: list = []                    # [[chat_id, message_id, o'chish_vaqti]] — ko'rib chiqish xabarlari (restartdan keyin ham o'chadi)
_PREVIEWS_FILE = os.path.join(os.environ.get("TMPDIR", "/tmp"), "ss_ad_previews.json")
_ad_tasks: set = set()


def _keep_task(t: "asyncio.Task") -> "asyncio.Task":
    """Task'ga kuchli havola: aks holda Python uni o'rtada o'chirib yuborishi mumkin."""
    _ad_tasks.add(t)
    t.add_done_callback(_ad_tasks.discard)
    return t


def _previews_save() -> None:
    try:
        with open(_PREVIEWS_FILE, "w", encoding="utf-8") as f:
            json.dump(_PREVIEWS, f)
    except Exception:
        pass


def _previews_load() -> None:
    try:
        with open(_PREVIEWS_FILE, "r", encoding="utf-8") as f:
            for x in (json.load(f) or []):
                if x not in _PREVIEWS:
                    _PREVIEWS.append(list(x))
    except Exception:
        pass


def _preview_add(chat_id: int, msg_id: int, ttl: int) -> None:
    _PREVIEWS.append([int(chat_id), int(msg_id), time.time() + max(5, int(ttl))])
    _previews_save()


async def _previews_sweep() -> None:
    now = time.time()
    due = [x for x in _PREVIEWS if x[2] <= now]
    if not due:
        return
    for x in due:
        try:
            _PREVIEWS.remove(x)
        except ValueError:
            pass
    _previews_save()
    for chat_id, msg_id, _t in due:
        try:
            await tg("deleteMessage", chat_id=chat_id, message_id=msg_id)
        except Exception:
            pass
        await asyncio.sleep(0.04)


def _ad_set_ends(adm, aid: int, when: datetime) -> None:
    sb = adm._sb()
    if sb:
        sb.table("ads").update({"ends_at": when.isoformat(), "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", int(aid)).execute()
    ads = _deps.get("ads")
    if ads:
        ads.invalidate()


def _ad_expire_rows() -> list:
    """Muddati o'tgan faol reklamalarni «tugadi» (active=false) qiladi. Yozuv O'CHMAYDI — statistika qoladi."""
    adm, ads = _deps.get("admin"), _deps.get("ads")
    sb = adm._sb() if adm else None
    if not sb:
        return []
    now = datetime.now(timezone.utc)
    done = []
    rows = sb.table("ads").select("id,ends_at").eq("active", True).execute().data or []
    for r in rows:
        try:
            e = datetime.fromisoformat(str(r.get("ends_at")).replace("Z", "+00:00")) if r.get("ends_at") else None
        except Exception:
            e = None
        if e is not None and e.tzinfo is None:
            e = e.replace(tzinfo=timezone.utc)
        if e is not None and e <= now:
            sb.table("ads").update({"active": False, "updated_at": now.isoformat()}).eq("id", int(r["id"])).execute()
            done.append(int(r["id"]))
    if done and ads:
        ads.invalidate()
    return done


async def _ad_sweeper() -> None:
    """Har 15 soniyada: ko'rib chiqish xabarlari o'chadi. Har daqiqada: muddati tugagan reklama «tugadi» bo'ladi
    (saytdan ham, yangi yuborishdan ham chiqadi, yozuv saqlanadi); butunlay o'chirilgan reklamaning xabarlari chatdan olinadi."""
    tick = 0
    try:
        await asyncio.to_thread(_ad_sent_load_db)          # restartdan keyin ham reklama xabarlari yo'qolmaydi
    except Exception:
        pass
    while True:
        try:
            await asyncio.sleep(15)
            await _previews_sweep()
            if _AD_DIRTY or _AD_PENDING:
                await asyncio.to_thread(_ad_sent_persist)
            tick += 1
            if tick % 4:
                continue
            ended = await asyncio.to_thread(_ad_expire_rows)
            ads = _deps.get("ads")
            purge_on_end = bool((_deps.get("settings").get("ad_purge_on_expire", False)) if _deps.get("settings") else False)
            for aid in list(_AD_SENT.keys()):
                exists = await asyncio.to_thread(_ad_exists, aid)      # None = baza javob bermadi -> hech narsa o'chirilmaydi
                if exists is False:                           # reklama butunlay o'chirilgan
                    await _ad_purge(aid)
                elif exists and purge_on_end and aid in ended:    # ixtiyoriy: tugaganda chatdan ham olish (standart: yo'q)
                    await _ad_purge(aid)
        except asyncio.CancelledError:
            return
        except Exception as e:
            _warn("adsweep", f"{type(e).__name__}: {str(e)[:80]}")


def _ad_sweeper_start() -> None:
    global _ad_sweeper_task
    if _ad_sweeper_task is None or _ad_sweeper_task.done():
        if not _AD_SENT:
            _ad_sent_load()
        if not _PREVIEWS:
            _previews_load()
        try:
            _ad_sweeper_task = asyncio.get_running_loop().create_task(_ad_sweeper())
        except Exception:
            pass


async def _deliver_ad(chat_id: int, title: str, body: str, mtype: str, media: str, link: str = "", btn_text: str = "Batafsil",
                      label: bool = True, ad_id: int = 0, ttl: int = 0) -> bool:
    text = ""
    if title:
        text += f"<b>{esc(title)}</b>\n"
    if body:
        text += f"{esc(body)}\n"
    if label:
        text += "\n<i>📢 Reklama</i>"
    kb = _akb([[{"text": f"🔗 {btn_text}", "url": link}]]) if link else None
    blob: Optional[bytes] = None
    if media.startswith("tg:"):
        media = media[3:]
    elif media.startswith("data:"):
        cached_fid = _AD_PHOTO_ID.get(int(ad_id)) if ad_id else None
        if cached_fid and mtype == "image":
            media, blob = cached_fid, None            # shu reklamaning rasmi Telegram'da bor — qayta yuklanmaydi
        else:
            try:
                blob = base64.b64decode(media.split(",", 1)[1])
            except Exception:
                blob = None
            media = ""
    elif media.startswith("/"):
        media = SITE_URL + media
    sent = None
    if blob and mtype == "image":
        try:        # baytlarni o'zimiz yuklaymiz (Telegram bizning serverga kirib o'tirmaydi — ishonchliroq)
            r = await _http().post(f"{API}/sendPhoto", data={"chat_id": str(chat_id), "caption": text[:1000], "parse_mode": "HTML",
                                                            **({"reply_markup": json.dumps(kb)} if kb else {})},
                                   files={"photo": ("ad.jpg", blob, "image/jpeg")}, timeout=httpx.Timeout(40.0, connect=8.0))
            j = r.json()
            sent = j.get("result") if j.get("ok") else None
            if ad_id and isinstance(sent, dict) and sent.get("photo"):
                if len(_AD_PHOTO_ID) > 50:
                    _AD_PHOTO_ID.clear()
                _AD_PHOTO_ID[int(ad_id)] = str(sent["photo"][-1].get("file_id") or "")
        except Exception as e:
            _warn("adup", f"reklama rasmi yuborilmadi: {type(e).__name__}")
    elif media and mtype == "image":
        sent = await tg("sendPhoto", chat_id=chat_id, photo=media, caption=text[:1000], parse_mode="HTML", reply_markup=kb)
    elif media and mtype == "video":
        sent = await tg("sendVideo", chat_id=chat_id, video=media, caption=text[:1000], parse_mode="HTML", reply_markup=kb, supports_streaming=True)
    if not sent:
        sent = await _send(chat_id, text or "📢", kb)
    if sent and ad_id and isinstance(sent, dict) and sent.get("message_id"):
        _ad_sent_add(ad_id, chat_id, sent["message_id"])
        _ad_sweeper_start()
    if sent and ttl and isinstance(sent, dict) and sent.get("message_id"):
        _preview_add(chat_id, sent["message_id"], ttl)          # ko'rib chiqish xabari ttl soniyadan keyin o'chadi
        _ad_sweeper_start()
    return bool(sent)


async def _push_ad_all(cid: int, aid: int, silent_if_none: bool = False) -> int:
    """Reklamani botdagi (VIP/admin bo'lmagan) hamma foydalanuvchiga yuboradi. Fon rejimida; tugagach adminga hisobot."""
    adm = _deps.get("admin")
    from backend import ads as _ads
    try:
        row = await asyncio.to_thread(_ads.get_row, aid)
        is_notice = _ads.kind_of(row) == "notice"
        tids = await asyncio.to_thread(adm._audience, "all" if is_notice else "free")      # e'lon — hammaga (VIP ham)
    except Exception:
        row, tids, is_notice = None, [], False
    if not row or not tids:
        if not silent_if_none:
            await _send(cid, "⚠️ Reklama yoki qabul qiluvchi topilmadi.", _akb([[_btn("📢 Reklamalar", "a:ads")]]))
        return 0
    pub = _ads.public(row, "bot")
    link = (SITE_URL + pub["click_url"]) if pub["has_link"] else ""

    async def _push():
        ok = bad = 0
        good_ids: list = []
        bad_ids: list = []
        for tid in tids:
            try:
                if await _deliver_ad(int(tid), pub["title"], pub["body"], pub["media_type"], pub["media_url"], link, pub["button_text"],
                                     label=not is_notice, ad_id=int(aid)):
                    ok += 1; good_ids.append(int(tid))
                else:
                    bad += 1; bad_ids.append(int(tid))
            except Exception:
                bad += 1; bad_ids.append(int(tid))
            await asyncio.sleep(0.06)
        _AD_REPORTS[int(aid)] = {"ok": good_ids, "bad": bad_ids, "t": time.time()}
        while len(_AD_REPORTS) > 20:
            _AD_REPORTS.pop(next(iter(_AD_REPORTS)), None)
        await asyncio.to_thread(_ad_sent_persist)
        try:
            await asyncio.to_thread(_ads.bump, int(row["id"]), "impression")
        except Exception:
            pass
        await _send(cid, f"✅ Reklama botga yuborildi:\n✔️ yetdi: <b>{ok}</b>\n✖️ yetmadi: <b>{bad}</b> (botni to'xtatgan/bloklaganlar)",
                    _akb([[_btn("📋 Kimlarga yetdi / yetmadi", f"a:ad:r:{aid}")], [_btn("📢 Reklamalar", "a:ads")]]))
    _keep_task(asyncio.get_running_loop().create_task(_push()))
    return len(tids)


def _wiz_nav(extra: Optional[list] = None) -> dict:
    rows = list(extra or [])
    rows.append([_btn("❌ Bekor qilish", "a:w:x")])
    return _akb(rows)


def _adm_disk_path(cid: int) -> str:
    return os.path.join(os.environ.get("TMPDIR", "/tmp"), f"ss_adm_{int(cid)}.json")


def _adm_disk_save(cid: int, a: dict) -> None:
    try:
        with open(_adm_disk_path(cid), "w", encoding="utf-8") as f:
            json.dump({"t": time.time(), "adm": a}, f)
    except Exception:
        pass


def _adm_disk_clear(cid: int) -> None:
    try:
        os.remove(_adm_disk_path(cid))
    except Exception:
        pass


def _adm_disk_load(cid: int) -> Optional[dict]:
    try:
        with open(_adm_disk_path(cid), "r", encoding="utf-8") as f:
            d = json.load(f)
        if time.time() - float(d.get("t", 0)) < 6 * 3600 and isinstance(d.get("adm"), dict):
            return d["adm"]
    except Exception:
        pass
    return None


async def _wiz_step(cid: int, mid: Optional[int], step: str) -> None:
    st = _state(cid)
    a = st.setdefault("adm", {})
    a["await"] = None
    ad = a.setdefault("ad", {"media_type": "none", "media_url": "", "title": "", "body": "", "link_url": "", "button_text": "Batafsil", "placement": "both", "hours": 24})
    _adm_disk_save(cid, a)
    if step == "media":
        a["await"] = "ad_media"
        head = ("📣 <b>Yangi e'lon</b> (reklamasiz) · 1/5\n<i>«Reklama» yozuvi bo'lmaydi; saytda popup bo'lib chiqadi, botda hammaga (VIP ham) boradi.</i>"
                if ad.get("kind") == "notice" else "➕ <b>Yangi reklama</b> · 1/5")
        await _show(cid, mid, head + "\n\n📸 <b>Rasm</b> yoki 🎬 <b>video</b> yuboring.\n<i>Faqat matnli bo'lsa — «Mediasiz» ni bosing.</i>",
                    _wiz_nav([[_btn("⏭ Mediasiz", "a:w:nomedia")]]))
    elif step == "text":
        a["await"] = "ad_text"
        extra = [[_btn("⏭ Matnsiz (faqat media)", "a:w:notext")]] if ad["media_type"] != "none" else []
        await _show(cid, mid, "✍️ 2/5 · <b>Reklama matnini yozing.</b>\n<i>Birinchi qator — sarlavha, qolgani — matn.</i>\n\nMasalan:\n<code>Yangi kurs!\n30% chegirma faqat shu hafta.</code>", _wiz_nav(extra))
    elif step == "link":
        a["await"] = "ad_link"
        await _show(cid, mid, "🔗 3/5 · <b>Havolani yuboring</b> (<code>https://...</code>).\n<i>Reklama ostida tugma bo'lib chiqadi.</i>", _wiz_nav([[_btn("⏭ Havolasiz", "a:w:nolink")]]))
    elif step == "btn":
        rows = [[_btn(t, f"a:w:b:{i}") for i, t in enumerate(AD_BTN_TEXTS[:3])], [_btn(t, f"a:w:b:{i + 3}") for i, t in enumerate(AD_BTN_TEXTS[3:])]]
        await _show(cid, mid, "🔘 Tugma yozuvini tanlang (yoki o'zingiz yozing, 24 belgigacha):", _wiz_nav(rows))
        a["await"] = "ad_btn"
    elif step == "where":
        if ad.get("kind") != "notice" and (ad["media_type"] == "video" or str(ad["media_url"]).startswith("tg:")):
            ad["placement"] = "bot"
            await _wiz_step(cid, mid, "hours")
            return
        await _show(cid, mid, "📍 4/5 · <b>Qayerda ko'rsatilsin?</b>", _wiz_nav([[_btn("🤖 Botda", "a:w:p:bot"), _btn("🌐 Saytda", "a:w:p:site")], [_btn("🤖 + 🌐 Ikkalasida", "a:w:p:both")]]))
    elif step == "hours":
        a["await"] = "ad_hours"
        note = "\n<i>Video faqat botda ko'rsatiladi.</i>" if ad["placement"] == "bot" and ad["media_type"] == "video" else ""
        rows = [[_btn(_hours_text(h), f"a:w:h:{h}") for h in AD_HOURS[:4]], [_btn(_hours_text(h), f"a:w:h:{h}") for h in AD_HOURS[4:]]]
        await _show(cid, mid, f"⏰ 5/5 · <b>Necha soat tursin?</b>{note}\nTugmani bosing yoki soat sonini yozing (masalan <code>36</code>).", _wiz_nav(rows))
    elif step == "confirm":
        a["await"] = None
        where = {"bot": "🤖 botda", "site": "🌐 saytda"}.get(ad["placement"], "🤖 + 🌐 ikkalasida")
        await _show(cid, mid, f"👆 <b>Shunday ko'rinadi.</b>\n\n📍 {where}\n⏰ {_hours_text(ad['hours'])} turadi\n🔗 {esc(ad['link_url']) if ad['link_url'] else 'havolasiz'}\n\nJoylaymizmi?",
                    _akb([[_btn("✅ Joylash", "a:w:save")], [_btn("✏️ Qaytadan", "a:ad:new"), _btn("❌ Bekor", "a:w:x")]]))


async def _wiz_preview(cid: int) -> None:
    ad = (_state(cid).get("adm") or {}).get("ad") or {}
    await _deliver_ad(cid, ad.get("title", ""), ad.get("body", ""), ad.get("media_type", "none"), ad.get("media_url", ""),
                      ad.get("link_url", ""), ad.get("button_text", "Batafsil"), label=ad.get("kind") != "notice", ttl=90)


async def _wiz_save(cid: int, mid: Optional[int], user: dict, adm) -> None:
    _a = _state(cid).get("adm") or {}
    ad = dict(_a.get("ad") or {})
    if not ad:
        await _admin_home(cid, mid)
        return
    if _a.get("saving"):
        return                                 # ikki marta bosilsa — ikkita reklama bo'lib ketmasin
    _a["saving"] = True
    ends = datetime.now(timezone.utc) + timedelta(hours=float(ad.get("hours") or 24))
    raw = {k: ad.get(k) for k in ("title", "body", "media_type", "media_url", "link_url", "button_text", "placement", "kind")}
    raw.update(active=True, weight=1, ends_at=ends.isoformat())
    try:
        res = await asyncio.to_thread(adm._dispatch, "ad_save", {"ad": raw}, f"tg:{int(user['id'])}")
    except Exception as e:
        msg = getattr(e, "msg", "") or "Saqlanmadi"
        _a["saving"] = False
        await _show(cid, mid, f"⚠️ {esc(msg)}", _akb([[_btn("🔁 Qayta urinish", "a:w:save")], _HOME]))
        return
    _state(cid).pop("adm", None)
    _adm_disk_clear(cid)
    new_id = int(res.get("id") or 0)
    to_bot = ad.get("placement") in ("bot", "both") and new_id
    n_sent = 0
    if to_bot:
        n_sent = await _push_ad_all(cid, new_id, silent_if_none=True)
    where = "🌐 saytda" if ad.get("placement") == "site" else ("🤖 botda" if ad.get("placement") == "bot" else "🤖 botda va 🌐 saytda")
    sent_line = (f"\n📤 Botga <b>{n_sent}</b> ta foydalanuvchiga yuborilmoqda…" if n_sent else ("\n⚠️ Botda qabul qiluvchi topilmadi." if to_bot else ""))
    await _show(cid, mid, f"✅ <b>{'E' + chr(39) + 'lon' if ad.get('kind') == 'notice' else 'Reklama'} joylandi</b> ({where})\n⏰ {_hours_text(ad.get('hours') or 24)} davomida ko'rsatiladi, keyin o'zi tugaydi.{sent_line}",
                _akb([[_btn("📢 Reklamalar", "a:ads")], _HOME]))


async def _photo_to_data_url(file_id: str) -> Optional[str]:
    data = await _download_tg_file(file_id, 12 * 1024 * 1024)
    if not data:
        return None
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB") if im.mode not in ("RGB",) else im
        side = 1280
        for q in (82, 72, 62, 50):
            c = im.copy()
            c.thumbnail((side, side))
            buf = io.BytesIO()
            c.save(buf, "JPEG", quality=q, optimize=True)
            url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
            if len(url) < 1_400_000:
                return url
            side = int(side * 0.8)
    except Exception as e:
        _warn("adphoto", f"{type(e).__name__}: {str(e)[:80]}")
    return None


async def _admin_input(cid: int, user: dict, msg: dict, st: dict) -> bool:
    """Admin kutilgan javob (matn / rasm / video) yuborganda. True — xabar shu yerda ishlatildi."""
    adm = _adm(user)
    a = st.get("adm") or {}
    aw = a.get("await")
    if not adm or not aw:
        return False
    text = (msg.get("text") or "").strip()
    if text.startswith("/"):
        st.pop("adm", None)
        _adm_disk_clear(cid)
        return False
    ad = a.get("ad") or {}
    if aw == "user":
        if not text:
            return True
        try:
            row = await asyncio.to_thread(adm.resolve_target, text)
        except adm.AdminError as e:
            await _send(cid, f"⚠️ {esc(e.msg)}\nQayta yuboring yoki:", _akb([_HOME]))
            return True
        except Exception:
            await _send(cid, "⚠️ Topib bo'lmadi.", _akb([_HOME]))
            return True
        warn = _dupes_warning(row)
        if warn:
            await _send(cid, warn.strip())
        await _admin_user_card(cid, None, adm, str(row["user_id"]))
        return True
    if aw == "num":
        try:
            raw = text.replace(",", ".").replace(" ", "")
            v = float(raw)
            uid = a.get("uid")
            res = await asyncio.to_thread(adm.user_action, f"tg:{int(user['id'])}", {"user_id": uid, "action": "add_credits", "pages": v})
            await _admin_user_card(cid, None, adm, uid, res.get("note") or "Bajarildi")
        except ValueError:
            await _send(cid, "⚠️ Son yozing: <code>+25</code> yoki <code>-10</code>")
        except adm.AdminError as e:
            await _send(cid, f"⚠️ {esc(e.msg)}")
        return True
    if aw == "ad_media":
        ph = msg.get("photo")
        vid = msg.get("video") or msg.get("animation")
        doc = msg.get("document") or {}
        if isinstance(ph, list) and ph:
            best = max((p for p in ph if isinstance(p, dict) and p.get("file_id")), key=lambda p: int(p.get("file_size") or 0), default=None)
            url = await _photo_to_data_url(best["file_id"]) if best else None
            if not url:
                await _send(cid, "⚠️ Rasmni o'qib bo'lmadi. Boshqa rasm yuboring.")
                return True
            ad.update(media_type="image", media_url=url)
        elif isinstance(doc, dict) and str(doc.get("mime_type", "")).startswith("image/") and doc.get("file_id"):
            url = await _photo_to_data_url(doc["file_id"])
            if not url:
                await _send(cid, "⚠️ Rasmni o'qib bo'lmadi. Boshqa rasm yuboring.")
                return True
            ad.update(media_type="image", media_url=url)
        elif isinstance(vid, dict) and vid.get("file_id"):
            if int(vid.get("file_size") or 0) > 20 * 1024 * 1024:
                await _send(cid, "⚠️ Video 20 MB dan katta. Qisqaroq (20 MB gacha) video yuboring.")
                return True
            ad.update(media_type="video", media_url="tg:" + str(vid["file_id"]))
        else:
            await _send(cid, "📸 Rasm yoki 🎬 video yuboring (matn emas).", _wiz_nav([[_btn("⏭ Mediasiz", "a:w:nomedia")]]))
            return True
        a["ad"] = ad
        await _wiz_step(cid, None, "text")
        return True
    if aw == "ad_text":
        if not text:
            return True
        lines = text.split("\n", 1)
        ad["title"] = lines[0].strip()[:80]
        ad["body"] = (lines[1].strip() if len(lines) > 1 else "")[:400]
        a["ad"] = ad
        await _wiz_step(cid, None, "link")
        return True
    if aw == "ad_link":
        if not re.match(r"^https?://\S{3,}$", text):
            await _send(cid, "⚠️ Havola <code>https://</code> bilan boshlansin. Qayta yuboring yoki «Havolasiz» ni bosing.", _wiz_nav([[_btn("⏭ Havolasiz", "a:w:nolink")]]))
            return True
        ad["link_url"] = text
        a["ad"] = ad
        await _wiz_step(cid, None, "btn")
        return True
    if aw == "ad_btn":
        if text:
            ad["button_text"] = text[:24]
            a["ad"] = ad
            await _wiz_step(cid, None, "where")
        return True
    if aw == "ad_hours":
        try:
            h = float(text.replace(",", "."))
            if not (0.1 <= h <= 24 * 90):
                raise ValueError
        except ValueError:
            await _send(cid, "⚠️ Soat sonini yozing (masalan <code>36</code>) yoki tugmani bosing.")
            return True
        ad["hours"] = h
        a["ad"] = ad
        await _wiz_step(cid, None, "confirm")
        await _wiz_preview(cid)
        return True
    if aw == "bc_text":
        if len(text) < 2:
            return True
        a["bc_text"] = text[:3500]
        a["await"] = None
        try:
            cnt = (await asyncio.to_thread(adm._dispatch, "broadcast_preview", {"audience": a.get("aud", "all")}, f"tg:{int(user['id'])}")).get("count")
        except Exception:
            cnt = "?"
        await _send(cid, f"📣 <b>Xabar:</b>\n\n{esc(a['bc_text'])}\n\n👥 Qabul qiluvchilar: <b>{cnt}</b>\nYuboraymi?",
                    _akb([[_btn("✅ Yuborish", "a:bc:go")], [_btn("❌ Bekor", "a:home")]]))
        return True
    return False


async def _admin_cb(cid: int, mid: Optional[int], user: dict, data: str) -> None:
    adm = _adm(user)
    if not adm:
        return                                                    # admin bo'lmasa — hech narsa (hech qanday ma'lumot ochilmaydi)
    st = _state(cid)
    parts = data.split(":")
    cmd = parts[1] if len(parts) > 1 else "home"
    actor = f"tg:{int(user['id'])}"
    if cmd == "home":
        await _admin_home(cid, mid)
    elif cmd == "stats":
        await _admin_stats(cid, mid, adm)
    elif cmd == "u":
        st["adm"] = {"await": "user"}
        await _show(cid, mid, "👤 <b>Foydalanuvchini toping</b>\n\nTelegram ID, email yoki UUID yuboring.\n<i>Telegram ID ni foydalanuvchi botga <code>/id</code> yozib bilib oladi.</i>", _akb([_HOME]))
    elif cmd == "ua":
        await _admin_user_action(cid, mid, user, adm, parts[2] if len(parts) > 2 else "")
    elif cmd == "ads":
        await _admin_ads(cid, mid, adm, user)
    elif cmd == "ad":
        sub = parts[2] if len(parts) > 2 else ""
        aid = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
        if sub in ("new", "newn"):
            st["adm"] = {"ad": {"media_type": "none", "media_url": "", "title": "", "body": "", "link_url": "", "button_text": "Batafsil",
                                "placement": "both", "hours": 24, "kind": "notice" if sub == "newn" else "ad"}}
            await _wiz_step(cid, mid, "media")
        elif sub == "t" and aid:
            rows = (await asyncio.to_thread(adm._dispatch, "ads", {}, actor)).get("ads", [])
            cur = next((r for r in rows if int(r["id"]) == aid), None)
            if cur:
                expired = bool(cur.get("ends_at")) and _left_text(cur.get("ends_at")) == "⌛ tugagan"
                running = bool(cur.get("active")) and not expired
                if running:
                    # 1-tugma: reklama saytdan ham, botdan ham to'xtaydi (chatdagi xabarlar o'chmaydi)
                    await asyncio.to_thread(adm._dispatch, "ad_toggle", {"id": aid, "active": False}, actor)
                else:
                    if expired:           # muddati tugagan reklamani qayta yoqsa — yana 24 soat
                        await asyncio.to_thread(_ad_set_ends, adm, aid, datetime.now(timezone.utc) + timedelta(hours=24))
                    await asyncio.to_thread(adm._dispatch, "ad_toggle", {"id": aid, "active": True}, actor)
            await _admin_ads(cid, mid, adm, user)
        elif sub == "d" and aid:
            await _show(cid, mid, "🗑 <b>Reklama butunlay o'chirilsinmi?</b>\n\nSaytdan ham, foydalanuvchilarning botdagi chatlaridan ham o'chadi. Bu qaytarilmaydi.\n<i>Faqat to'xtatmoqchi bo'lsangiz — «⏹ To'xtatish» ni bosing.</i>", _akb([[_btn("✅ Ha, hammasini o'chirish", f"a:ad:dd:{aid}"), _btn("↩️ Yo'q", "a:ads")]]))
        elif sub == "pl" and aid:
            try:
                from backend import ads as _ads
                row = await asyncio.to_thread(_ads.get_row, aid)
                order = ["both", "bot", "site"]
                cur_pl = str((row or {}).get("placement") or "both")
                new_pl = order[(order.index(cur_pl) + 1) % 3] if cur_pl in order else "both"
                raw = dict(row)
                raw["placement"] = new_pl
                await asyncio.to_thread(adm._dispatch, "ad_save", {"ad": raw}, actor)
            except Exception as e:
                _warn("ad", f"joy o'zgarmadi: {type(e).__name__}")
            await _admin_ads(cid, mid, adm, user)
        elif sub == "p" and aid:
            from backend import ads as _ads
            _notice = _ads.kind_of(await asyncio.to_thread(_ads.get_row, aid, False)) == "notice"
            n_all = len(await asyncio.to_thread(adm._audience, "all"))
            n = n_all if _notice else len(await asyncio.to_thread(adm._audience, "free"))
            note = "\n\n⚠️ Botda hozircha boshqa foydalanuvchi yo'q ko'rinadi — reklama faqat sizga boradi." if n_all <= 1 else ""
            await _show(cid, mid, f"📤 Reklama hozir <b>{n}</b> ta foydalanuvchiga yuboriladi (botda jami {n_all} ta{"" if _notice else "; VIP/adminlar kirmaydi"}).{note}\nDavom etamizmi?",
                        _akb([[_btn("✅ Yuborish", f"a:ad:pp:{aid}"), _btn("↩️ Yo'q", "a:ads")]]))
        elif sub == "r" and aid:
            rep = _AD_REPORTS.get(aid)
            page = int(parts[4]) if len(parts) > 4 and parts[4].isdigit() else 0
            if not rep:
                await _show(cid, mid, "Bu reklama uchun hisobot yo'q (yuborilmagan yoki bot qayta ishga tushgan).", _akb([[_btn("↩️ Reklamalar", "a:ads")]]))
            else:
                PG = 30
                def _fmt(ids):
                    part = ids[page * PG:(page + 1) * PG]
                    return ", ".join(f'<a href="tg://user?id={i}">{i}</a>' for i in part) if part else "—"
                total = max(len(rep["ok"]), len(rep["bad"]))
                nav = []
                if page > 0:
                    nav.append(_btn("‹ Oldingi", f"a:ad:r:{aid}:{page - 1}"))
                if (page + 1) * PG < total:
                    nav.append(_btn("Keyingi ›", f"a:ad:r:{aid}:{page + 1}"))
                await _show(cid, mid, f"📋 <b>Reklama hisoboti</b> ({page + 1}/{max(1, -(-total // PG))})\n\n✔️ <b>Yetdi ({len(rep['ok'])}):</b>\n{_fmt(rep['ok'])}\n\n✖️ <b>Yetmadi ({len(rep['bad'])}):</b>\n{_fmt(rep['bad'])}",
                            _akb(([nav] if nav else []) + [[_btn("↩️ Reklamalar", "a:ads")]]))
        elif sub == "pp" and aid:
            n = await _push_ad_all(cid, aid)
            if n:
                await _show(cid, mid, f"📤 Yuborish boshlandi ({n} ta). Tugagach xabar keladi.", _akb([[_btn("↩️ Reklamalar", "a:ads")], _HOME]))
        elif sub == "c" and aid:
            await _show(cid, mid, "❌ <b>E'lon bekor qilinsinmi?</b>\n\nSaytda darhol yopiladi (sahifani yangilash shart emas) va botdagi "
                                  "yuborilgan xabarlar chatlardan o'chiriladi. Keyin «▶️ Qayta yoqish» mumkin.",
                        _akb([[_btn("✅ Ha, bekor qilish", f"a:ad:cc:{aid}"), _btn("↩️ Yo'q", "a:ads")]]))
        elif sub == "cc" and aid:
            await asyncio.to_thread(adm._dispatch, "ad_toggle", {"id": aid, "active": False}, actor)
            _keep_task(asyncio.get_running_loop().create_task(_ad_purge(aid)))
            await _admin_ads(cid, mid, adm, user)
        elif sub == "dd" and aid:
            await asyncio.to_thread(adm._dispatch, "ad_delete", {"id": aid}, actor)
            _AD_REPORTS.pop(aid, None)
            _keep_task(asyncio.get_running_loop().create_task(_ad_purge(aid)))
            await _admin_ads(cid, mid, adm, user)
        elif sub == "v" and aid:
            try:
                from backend import ads as _ads
                row = await asyncio.to_thread(_ads.get_row, aid)
            except Exception:
                row = None
            if row:
                m = str(row.get("media_url") or "")
                media = (_ads.media_path(row) if row.get("media_type") != "none" else "")
                await _deliver_ad(cid, row.get("title", ""), row.get("body", ""), row.get("media_type", "none"), media,
                                  row.get("link_url", ""), row.get("button_text", "Batafsil"), label=_ads.kind_of(row) != "notice",
                                  ad_id=int(aid), ttl=90)   # ad_id: reklama o'chirilsa, ko'rib chiqish nusxasi ham chatdan olinadi
    elif cmd == "w":
        a = st.get("adm") or {}
        if not a.get("ad"):
            d = _adm_disk_load(cid)
            if d and d.get("ad"):
                st["adm"] = a = d
        ad = a.get("ad")
        sub = parts[2] if len(parts) > 2 else ""
        if sub == "x":
            await _admin_home(cid, mid)
        elif not ad:
            await _show(cid, mid, "⚠️ Reklama qoralamasi topilmadi (bot qayta ishga tushgan bo'lishi mumkin).\nQaytadan boshlang — bu juda tez.",
                        _akb([[_btn("➕ Yangi reklama", "a:ad:new")], _HOME]))
        elif sub == "nomedia":
            ad.update(media_type="none", media_url="")
            await _wiz_step(cid, mid, "text")
        elif sub == "notext":
            ad.update(title="", body="")
            await _wiz_step(cid, mid, "link")
        elif sub == "nolink":
            ad.update(link_url="")
            await _wiz_step(cid, mid, "where")
        elif sub == "b" and len(parts) > 3 and parts[3].isdigit() and int(parts[3]) < len(AD_BTN_TEXTS):
            ad["button_text"] = AD_BTN_TEXTS[int(parts[3])]
            await _wiz_step(cid, mid, "where")
        elif sub == "p" and len(parts) > 3 and parts[3] in ("bot", "site", "both"):
            ad["placement"] = parts[3]
            await _wiz_step(cid, mid, "hours")
        elif sub == "h" and len(parts) > 3:
            try:
                ad["hours"] = float(parts[3])
            except ValueError:
                return
            await _wiz_step(cid, mid, "confirm")
            await _wiz_preview(cid)
        elif sub == "save":
            await _wiz_save(cid, mid, user, adm)
    elif cmd == "bc":
        sub = parts[2] if len(parts) > 2 else ""
        if not sub:
            await _show(cid, mid, "📣 <b>Xabar yuborish</b>\nKimga yuboramiz?", _akb([
                [_btn("👥 Hammaga", "a:bc:aud:all"), _btn("🔗 Google ulaganlarga", "a:bc:aud:linked")],
                [_btn("🆓 Bepul foydalanuvchilarga", "a:bc:aud:free")], _HOME]))
        elif sub == "aud" and len(parts) > 3 and parts[3] in ("all", "linked", "free", "pro"):
            st["adm"] = {"await": "bc_text", "aud": parts[3]}
            await _show(cid, mid, "✍️ Xabar matnini yozing (HTML kerak emas, oddiy matn):", _akb([_HOME]))
        elif sub == "go":
            a = st.get("adm") or {}
            if not a.get("bc_text"):
                await _admin_home(cid, mid)
                return
            try:
                r = await asyncio.to_thread(adm._dispatch, "broadcast", {"text": a["bc_text"], "audience": a.get("aud", "all")}, actor)
                st.pop("adm", None)
                await _show(cid, mid, f"✅ Yuborish boshlandi (job <code>{esc(r.get('job') or r.get('id') or '')}</code>). Bir necha daqiqa ketadi.", _akb([_HOME]))
            except adm.AdminError as e:
                await _show(cid, mid, f"⚠️ {esc(e.msg)}", _akb([_HOME]))
            except Exception:
                await _show(cid, mid, "⚠️ Yuborib bo'lmadi.", _akb([_HOME]))
    elif cmd == "set":
        sub = parts[2] if len(parts) > 2 else ""
        ap = _deps.get("appsettings") or __import__("backend.appsettings", fromlist=["x"])
        if sub in ("ads_enabled", "ads_bot", "ads_site"):
            cur = bool(ap.get(sub, True))
            await asyncio.to_thread(ap.set_many, {sub: not cur})
        elif sub == "iv" and len(parts) > 3 and parts[3].isdigit():
            await asyncio.to_thread(ap.set_many, {"ad_bot_interval_min": int(parts[3])})
        def onoff(k):
            return "🟢 yoqilgan" if ap.get(k, True) else "🔴 o'chiq"
        await _show(cid, mid, "⚙️ <b>Reklama sozlamalari</b>\n\n"
                    f"Umumiy: {onoff('ads_enabled')}\nBotda: {onoff('ads_bot')}\nSaytda: {onoff('ads_site')}\n"
                    f"Botda oraliq: <b>{ap.get('ad_bot_interval_min', 15)} daqiqa</b> (bir foydalanuvchiga)",
                    _akb([[_btn("Umumiy: yoqish/o'chirish", "a:set:ads_enabled")],
                          [_btn("Botda", "a:set:ads_bot"), _btn("Saytda", "a:set:ads_site")],
                          [_btn(f"{m} daq", f"a:set:iv:{m}") for m in (5, 15, 30, 60)], _HOME]))


# ----------------------------------------------------------------------------------------------
# Reklama (VIP / admin ko'rmaydi)
# ----------------------------------------------------------------------------------------------
async def _maybe_ad(chat_id: int, uid: str, email: str) -> None:
    """Natija yuborilgach — oraliq (sozlama) o'tgan bo'lsa bitta reklama. Hech qachon asosiy oqimni buzmaydi."""
    try:
        ads = _deps.get("ads")
        if not ads or not ads.surface_enabled("bot") or not ads.bot_due(str(uid)):
            return
        try:
            if _deps.get("admin") and _deps["admin"].is_tg_admin(chat_id):
                return                          # admin o'z botida reklama ko'rmaydi
        except Exception:
            pass
        usage = await asyncio.to_thread(_usage_now_sync, uid, email)
        if _deps["usage_payload"](usage).get("ad_free"):
            return
        row = await asyncio.to_thread(ads.pick, "bot", False)
        if not row:
            return
        ads.bot_mark(str(uid))
        pub = ads.public(row, "bot")
        link = (SITE_URL + pub["click_url"]) if pub["has_link"] else ""
        ok = await _deliver_ad(chat_id, pub["title"], pub["body"], pub["media_type"], pub["media_url"], link, pub["button_text"], ad_id=int(row["id"]))
        if ok:
            await asyncio.to_thread(ads.bump, int(row["id"]), "impression")
    except Exception as e:
        _warn("ad", f"reklama yuborilmadi: {type(e).__name__}: {str(e)[:100]}")


# ----------------------------------------------------------------------------------------------
# AI
# ----------------------------------------------------------------------------------------------
GEN_SYSTEM = """You are Slide Studio AI, a professional presentation writer and designer.
Return ONLY one valid JSON object (json) — no markdown fences, no commentary.

SCHEMA
{
  "title": "deck title (max 70 chars)",
  "subtitle": "one short line",
  "theme": "ocean | violet | forest | sunset | rose | slate | teal",
  "images": true,
  "slides": [ ... exactly N slides ... ]
}
SLIDE TYPES (field "layout"):
- {"layout":"title","title":"","subtitle":"","image":"english photo query or empty","notes":""}            — ALWAYS the first slide
- {"layout":"bullets","title":"","bullets":["3-5 items, each max 110 chars"],"image":"english photo query or empty","notes":""}
- {"layout":"cards","title":"","cards":[{"heading":"max 30 chars","text":"max 110 chars"}, ... 2 to 4 cards]}
- {"layout":"stats","title":"","stats":[{"value":"72%","label":"what it means"}, ... 2 to 4 items]}
- {"layout":"table","title":"","rows":[["Header 1","Header 2","Header 3"],["cell","cell","cell"], ... 3 to 8 rows, 2 to 5 columns, each cell max 40 chars]}   — first row = header; use for comparisons, schedules, prices, specs
- {"layout":"chart","title":"","chart":"bar | line | pie | doughnut","labels":["A","B","C"],"series":[{"name":"2025","values":[10,20,30]}]}   — 2 to 8 labels, numbers only; pie/doughnut use ONE series; use for trends, shares, comparisons
- {"layout":"quote","text":"","author":""}                                                          — only a REAL, well-known quote with the correct author
- {"layout":"closing","title":"Thank you / key takeaway","subtitle":""}                                — ALWAYS the last slide

RULES
- Produce EXACTLY the requested number of slides: 1 title + (N-2) content slides + 1 closing.
- Write all slide text in the language of the user's request. If it is Uzbek, use Latin script. If the language is unclear, use Uzbek.
- Content must be concrete, accurate and useful: real facts, examples, steps — no filler, no repeated points. Never invent precise statistics; use a "stats" slide only for well-known figures, otherwise use "~" approximations or use "cards".
- Use a "table" or "chart" slide when the topic has comparable data (N >= 6). Chart numbers must be real or clearly approximate ("~"), never invented precise statistics. If the user asks for a table, chart, diagram, graph or statistics, ALWAYS include it.
- Slide transition (the way the whole slide appears): optional deck field "transition" and optional per-slide "transition": one of fade | zoom | flip | up | blur | none. Default "fade". Set it only if the user asks for a specific effect (e.g. "zoom"), for all slides via the deck field.
- Vary layouts: never more than 2 identical content layouts in a row. Use at least one "cards" slide when N >= 6.
- "image": a short ENGLISH search query (2-4 words) for a concrete photographable subject. Give it for the title slide and for at most 40% of the "bullets" slides, otherwise "". If the user does not want images set "images": false and every "image" to "".
- "notes": 1-2 sentences of speaker notes (same language as the slides).
- No emoji, no markdown symbols (**, #) inside text.
- Top decorative stripe/bar: use y:0, h:8 to h:20 ONLY. Never exceed y:30.
- Slide title: use y >= 70 ALWAYS. Never overlap the decorative stripe.
- Content boxes: use y >= 100 ALWAYS.
- Pick the theme that fits the topic, or the colour the user asked for (blue=ocean, purple=violet, green=forest, orange=sunset, pink/red=rose, black/gray=slate, turquoise=teal).
OPTIONAL INTERACTIVE FIELDS (any slide; use ONLY when the user asks for it):
- "buttons":[{"text":"max 24 chars","url":"https://..."}]  — up to 3 clickable buttons / links. Use ONLY URLs the user wrote (or official well-known sites like https://www.wikipedia.org). Never invent URLs.
- "media" (only on "title" and "bullets" slides, replaces the photo):
    {"type":"gif","query":"2-4 word english query"}   — animated GIF (found automatically)
    {"type":"gif","url":"https://...gif"} · {"type":"image","url":"https://..."} · {"type":"youtube","url":"https://youtu.be/..."} · {"type":"video","url":"https://...mp4"}
  YouTube / video URLs must come from the user. In PPTX the GIF is animated and the YouTube cover is clickable; in HTML YouTube and video play inside the slide.
"""

EDIT_SYSTEM = """You are Slide Studio AI, the editor of an existing slide deck. Return ONLY one valid JSON object (json), no markdown fences.
You receive: OUTLINE (every slide, numbered from 1), the FULL JSON of the slides that matter (or of the whole deck), and the user's NEW MESSAGE.
Decide the intent:
1) "edit" — the user wants a change (shorten, rewrite, retitle, translate, add/remove/move slides, change colours, fix a fact...).
   Return {"intent":"edit","reply":"1-2 short sentences saying what you changed","ops":[ ... ]}
   Change ONLY what was asked. Never rewrite untouched slides. Operations (slide numbers = numbering in the OUTLINE; the server applies them in order):
   {"op":"replace","index":3,"slide":{...complete new slide...}}        — rewrite one slide
   {"op":"insert","after":5,"slide":{...}}                              — add a slide after slide 5 (never before the title slide)
   {"op":"delete","index":4}                                            — remove a slide (never the title slide)
   {"op":"move","index":6,"after":2}                                    — move slide 6 right after slide 2
   {"op":"meta","title":"...","subtitle":"...","theme":"ocean|violet|forest|sunset|rose|slate|teal","transition":"fade|zoom|flip|up|blur|none"}  — deck title / subtitle / colour / slide transition for ALL slides (any subset of the fields)
   {"op":"transition","index":3,"name":"zoom"}                           — slide transition (how that whole slide appears) of ONE slide
   For slide 1 use "replace" with layout "title" (that is how «sarlavhasini o'zgartir» works for the deck title: also send a "meta" op with the new title).
   Only if nearly EVERY slide must change (translate the whole deck, rewrite everything) you may return "deck" (the COMPLETE updated deck) instead of "ops".
2) "new_topic" — the message is clearly a NEW presentation topic unrelated to the current deck, OR the user asks to throw the deck away and
   build it again from scratch ("boshidan qil", "hammasini yangidan yasa", "butunlay boshqa qil", "start over", "заново").
   Return {"intent":"new_topic","topic":"<the full topic to build, incl. requested slide count / style; for «start over» reuse the current deck topic>"}
3) "chat" — a question or small talk about the deck, not requesting a change.   Return {"intent":"chat","reply":"helpful answer, max 4 sentences"}
MIXED REQUESTS (statistics + table + chart + buttons + GIF + transitions ... in one message): do ALL of them in this one answer.
 - One slide has ONE layout, so put each block type on its own slide ("stats" slide, "table" slide, "chart" slide ...) next to the slide the
   user means (insert after it), and put buttons / media / transition on the slides where they belong. Keep the deck theme.
 - "animatsiya" in this bot = slide transition ("transition" op / meta) and animated GIF media. Per-element animations, free positions or
   several block types on ONE slide are not possible in the bot: do the closest version and say in "reply" in one short sentence that for full
   control they can press «🚀 Muharrirda ochish» (the site editor, where Slide Studio AI can do it exactly).
SLIDE SCHEMA (field "layout"): title/closing: title, subtitle · bullets: title, bullets[3-5], image, media · cards: title, cards[{heading,text}] (2-4) · stats: title, stats[{value,label}] (2-4) · quote: text, author · table: title, rows[[cells]] (first row = header, 2-8 rows, 2-5 columns) · chart: title, chart(bar|line|pie|doughnut), labels[], series[{name,values[]}]
 - To add a table / chart / statistics use "insert" or "replace" with these layouts. Numbers must be real or approximate, never invented.
 - "image" is a short ENGLISH photo search query or "". Keep the language of the deck unless asked to translate. No emoji, no markdown symbols. Reply in the user's language.
 - Any slide may also have "buttons" and (title/bullets) "media" — see below. To add a button/link/GIF/YouTube/video to slide N use "replace" with the COMPLETE slide including the new field; keep all other fields unchanged.

OPTIONAL INTERACTIVE FIELDS (any slide; use ONLY when the user asks for it):
- "buttons":[{"text":"max 24 chars","url":"https://..."}]  — up to 3 clickable buttons / links. Use ONLY URLs the user wrote (or official well-known sites like https://www.wikipedia.org). Never invent URLs.
- "media" (only on "title" and "bullets" slides, replaces the photo):
    {"type":"gif","query":"2-4 word english query"}   — animated GIF (found automatically)
    {"type":"gif","url":"https://...gif"} · {"type":"image","url":"https://..."} · {"type":"youtube","url":"https://youtu.be/..."} · {"type":"video","url":"https://...mp4"}
  YouTube / video URLs must come from the user. In PPTX the GIF is animated and the YouTube cover is clickable; in HTML YouTube and video play inside the slide.
"""

_NUM_A = re.compile(r"(\d{1,2})\s*[-–]?\s*(?:chi|nchi|inchi|-chi)?\s*(?:slayd\w*|slaid\w*|slide\w*|слайд\w*|varaq\w*|sahifa\w*|page\w*)", re.I)
_NUM_B = re.compile(r"(?:slayd\w*|slaid\w*|slide\w*|слайд\w*|varaq\w*|sahifa\w*|page\w*)\s*(?:№|#|raqam\w*)?\s*(\d{1,2})\b", re.I)
_LAST_RE = re.compile(r"\b(oxirgi|yakuniy|so'nggi|последн\w*|last)\b", re.I)
_FIRST_RE = re.compile(r"\b(birinchi|muqova|titul|первы\w*|first|cover)\b", re.I)


def _focus_indexes(text: str, total: int) -> List[int]:
    """Xabarda tilga olingan slayd raqamlari (1-based). Bo'sh bo'lsa — butun deck AI'ga beriladi."""
    found = set()
    for rx in (_NUM_A, _NUM_B):
        for m in rx.finditer(text or ""):
            n = int(m.group(1))
            if 1 <= n <= total:
                found.add(n)
    if _LAST_RE.search(text or ""):
        found.add(total)
    if _FIRST_RE.search(text or ""):
        found.add(1)
    return sorted(found)


def _outline(deck: dict) -> str:
    out = []
    for i, s in enumerate(deck.get("slides", []), 1):
        t = s.get("title") or s.get("text") or ""
        out.append(f"{i}. [{s.get('layout')}] {decks.clean(t, 70)}")
    return "\n".join(out)


def _edit_prompt(deck: dict, text: str) -> str:
    slides = deck.get("slides", [])
    focus = _focus_indexes(text, len(slides))
    slim = lambda s: {k: v for k, v in s.items() if v not in ("", None, [])}
    head = f"DECK: title={json.dumps(deck.get('title'), ensure_ascii=False)} theme={deck.get('theme')}\nOUTLINE:\n{_outline(deck)}\n\n"
    if focus:
        body = "FULL JSON OF THE SLIDES THE USER MENTIONED:\n" + json.dumps({str(i): slim(slides[i - 1]) for i in focus}, ensure_ascii=False)
    else:
        body = "FULL DECK JSON:\n" + _deck_for_prompt(deck)
    return f"{head}{body}\n\nNEW MESSAGE:\n{text}"


def _apply_ops(deck: dict, ops: Any) -> Tuple[Optional[dict], int]:
    """AI bergan amallarni deck nusxasiga qo'llaydi. (yangi_deck | None, o'zgargan/qo'shilgan slaydlar soni).
    Tegilmagan slaydlar AYNAN o'zgarishsiz qoladi."""
    if not isinstance(ops, list) or not ops:
        return None, 0
    items: List[List[Any]] = [[i, dict(s)] for i, s in enumerate(deck["slides"], 1)]     # [asl_raqam, slayd]
    title, subtitle, theme = deck.get("title"), deck.get("subtitle"), deck.get("theme")
    deck_tr = deck.get("transition") or ""
    changed, applied = 0, 0

    def pos(orig: int) -> int:
        for k, it in enumerate(items):
            if it[0] == orig:
                return k
        return -1

    for op in ops[:30]:
        if not isinstance(op, dict):
            continue
        kind = str(op.get("op") or "").lower()
        try:
            if kind == "replace":
                k = pos(int(op.get("index")))
                new = decks.normalize_slide(op.get("slide"))
                if k < 0 or not new:
                    continue
                if k == 0 and new["layout"] != "title":
                    continue
                if json.dumps(items[k][1], sort_keys=True, ensure_ascii=False) != json.dumps(new, sort_keys=True, ensure_ascii=False):
                    changed += 1
                items[k][1] = new
                applied += 1
            elif kind == "insert":
                after = int(op.get("after"))
                new = decks.normalize_slide(op.get("slide"))
                k = pos(after)
                if not new or k < 0 or len(items) >= MAX_SLIDES + 8:
                    continue
                if items[k][1].get("layout") == "closing":      # yakunlovchi slayddan keyin emas, oldin
                    k -= 1
                items.insert(k + 1, [-len(items) - 1000, new])
                changed += 1
                applied += 1
            elif kind == "delete":
                k = pos(int(op.get("index")))
                if k <= 0 or len(items) <= 2:
                    continue
                items.pop(k)
                applied += 1
            elif kind == "move":
                a, b = pos(int(op.get("index"))), int(op.get("after"))
                if a <= 0 or items[a][1].get("layout") == "closing":      # titul va yakunlovchi slayd joyidan qo'zg'almaydi
                    continue
                it = items.pop(a)
                k = pos(b)
                if k >= 0 and items[k][1].get("layout") == "closing":
                    k -= 1
                items.insert(k + 1 if k >= 0 else a, it)
                applied += 1
            elif kind == "meta":
                if isinstance(op.get("title"), str) and op["title"].strip():
                    title = decks.clean(op["title"], 90)
                if isinstance(op.get("subtitle"), str):
                    subtitle = decks.clean(op["subtitle"], 140)
                th = str(op.get("theme") or "").strip().lower()
                if th in decks.THEMES:
                    theme = th
                tr = str(op.get("transition") or "").strip().lower()
                if tr in decks.TRANSITIONS:
                    deck_tr = tr
                    for it in items:
                        it[1]["transition"] = ""
                applied += 1
            elif kind == "transition":
                k = pos(int(op.get("index")))
                nm = str(op.get("name") or "").strip().lower()
                if k < 0 or nm not in decks.TRANSITIONS:
                    continue
                items[k][1]["transition"] = nm
                applied += 1
        except (TypeError, ValueError):
            continue
    if not applied:
        return None, 0
    raw = {"title": title, "subtitle": subtitle, "theme": theme, "transition": deck_tr, "slides": [it[1] for it in items]}
    new_deck = decks.normalize_deck(raw, len(items) + 2, str(title or ""))
    return new_deck, changed


_ai_client = None
_ai_sig: Tuple[str, str] = ("", "")


def _get_ai():
    global _ai_client, _ai_sig
    cfg = (_deps.get("ai") or (lambda: {}))()
    if not cfg.get("api_key"):
        raise RuntimeError("ai_not_configured")
    sig = (cfg["api_key"], cfg.get("base_url") or "")
    if _ai_client is None or sig != _ai_sig:
        from openai import AsyncOpenAI
        _ai_client = AsyncOpenAI(api_key=cfg["api_key"], base_url=cfg.get("base_url") or "https://api.deepseek.com", timeout=170.0, max_retries=1)
        _ai_sig = sig
    return _ai_client, cfg


async def _ai_json(system: str, user: str, mode: str) -> Tuple[Optional[dict], int]:
    client, cfg = _get_ai()
    model = cfg.get("deep_model") if mode == "deep" else cfg.get("fast_model")
    kw: Dict[str, Any] = dict(model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens=7500)
    if mode != "deep":
        kw.update(temperature=0.7, response_format={"type": "json_object"})
    # v59: sayt bilan UMUMIY cheklov (DEEPSEEK_CONCURRENCY). Avval bot o'z hisobicha (+6) so'rov yuborardi —
    # ko'p odam bir vaqtda kirganda bitta API kalitga ruxsatdan ko'p parallel so'rov ketib, 429/sekinlashish bo'lardi.
    sem = _deps.get("ai_sem")
    if sem is not None:
        await asyncio.wait_for(sem.acquire(), timeout=120)   # TimeoutError — chaqiruvchilar uni allaqachon ushlaydi
        try:
            resp = await asyncio.wait_for(client.chat.completions.create(**kw), timeout=175)
        finally:
            sem.release()
    else:
        resp = await asyncio.wait_for(client.chat.completions.create(**kw), timeout=175)
    text = (resp.choices[0].message.content or "") if resp.choices else ""
    tokens = int(getattr(getattr(resp, "usage", None), "total_tokens", 0) or 0)
    return decks.extract_json(text), tokens


def _parse_count(text: str) -> Optional[int]:
    m = COUNT_RE.search(text or "")
    if not m:
        return None
    try:
        n = int(m.group(1))
    except Exception:
        return None
    return max(MIN_SLIDES, min(MAX_SLIDES, n))


def _deck_for_prompt(deck: dict) -> str:
    slim = {"title": deck.get("title"), "subtitle": deck.get("subtitle"), "theme": deck.get("theme"),
            "slides": [{k: v for k, v in s.items() if v not in ("", None, [])} for s in deck.get("slides", [])]}
    return json.dumps(slim, ensure_ascii=False)


async def _fetch_images(deck: dict, have: Dict[str, bytes], enabled: bool) -> Dict[str, bytes]:
    """Slaydlar uchun rasmlarni (query -> bayt) parallel yuklaydi. Vaqt cheklangan; topilmasa — rasmsiz slayd."""
    out = dict(have)
    if not enabled:
        return out
    queries: List[str] = []
    for s in deck["slides"]:
        q = decks.media_key(s)               # v55: oddiy rasm so'rovi, rasm/GIF havolasi, GIF so'rovi yoki YouTube muqovasi
        if q and s["layout"] in ("title", "bullets") and q not in out and q not in queries and not q.startswith("vid:"):
            queries.append(q)
    queries = queries[:8]
    if not queries:
        return out
    sem = asyncio.Semaphore(6)               # v55: hammasi deyarli bir vaqtda (avval 3 tadan)

    async def one(q: str):
        async with sem:
            return q, await asyncio.to_thread(decks.fetch_media, q)

    tasks = [asyncio.create_task(one(q)) for q in queries]
    done, pending = await asyncio.wait(tasks, timeout=28)
    for t in pending:
        t.cancel()
    for t in done:
        try:
            q, data = t.result()
            if data:
                out[q] = data
        except Exception:
            pass
    return out


_NO_IMG_RE = re.compile(r"rasmsiz|rasm\s*(?:kerak\s*emas|qo'?yma|siz)|without\s+images?|no\s+images?|без\s+(?:картин|изображ|фото)", re.I)


async def _ensure_image_queries(deck: dict, topic: str) -> int:
    """Titul va ba'zi bullets slaydlarda rasm so'rovi yo'q bo'lsa (Chuqur AI'da tez-tez) — kichik tez AI so'rovi bilan to'ldiradi. Sarflangan token qaytadi."""
    slides = deck.get("slides") or []
    cand = [i for i, sl in enumerate(slides) if sl.get("layout") in ("title", "bullets")]
    if not cand or any((slides[i].get("image") or "").strip() for i in cand):
        return 0
    pick = [cand[0]] + [i for i in cand[1:] if (i - cand[0]) % 2 == 1][: max(1, int(len(cand) * 0.4))]
    listing = "\n".join(f"{i}: {str(slides[i].get('title') or deck.get('title') or '')[:90]}" for i in pick)
    prompt = (f"Topic: {topic[:200]}\nFor each slide below give a short ENGLISH photo search query (2-4 words, a concrete photographable subject).\n"
              f"Slides:\n{listing}\n\nReturn ONLY JSON: {{\"queries\": {{\"<slide number>\": \"query\"}}}}")
    try:
        data, tk = await _ai_json("You write image search queries. Return only valid JSON (json).", prompt, "fast")
    except Exception as e:
        _warn("imgq", f"rasm so'rovlari olinmadi: {type(e).__name__}")
        slides[cand[0]]["image"] = decks.clean(topic, 60)                 # kamida titul slaydga mavzu bo'yicha rasm
        return 0
    qs = (data or {}).get("queries") if isinstance(data, dict) else None
    if isinstance(qs, dict):
        for k, v in qs.items():
            try:
                i = int(k)
            except (TypeError, ValueError):
                continue
            q = decks.clean(v, 60)
            if i in pick and q:
                slides[i]["image"] = q
    if not any((slides[i].get("image") or "").strip() for i in cand):      # AI ham bermasa — mavzu o'zi bilan titul slayd
        slides[cand[0]]["image"] = decks.clean(topic, 60)
    return int(tk or 0)


def _img_index(deck: dict, imgs: Dict[str, bytes]) -> Dict[int, bytes]:
    out = {}
    for i, s in enumerate(deck["slides"]):
        k = decks.media_key(s)
        if k and k in imgs:
            out[i] = imgs[k]
    return out


def _theme_label(deck: dict) -> str:
    return decks.THEMES.get(deck.get("theme"), {}).get("label", "")


def _card_text(deck: dict, head: str = "✅", extra: str = "") -> str:
    """Tayyor/saqlangan slayd kartasi: sarlavha + tuzilma matni (+ ixtiyoriy qo'shimcha). Tugmalar — kb_done."""
    return (f"{head} <b>{esc(deck['title'])}</b>\n🎞 {len(deck['slides'])} ta slayd · 🎨 {esc(_theme_label(deck))}\n\n{_summary(deck)}"
            + (f"\n\n{extra}" if extra else "")
            + "\n\n<i>✏️ O'zgartirish kerak bo'lsa — «Tahrirlash» ni bosing, keyin AI'ga oddiy yozing (u slaydni ko'rib turadi).</i>"   # v64
            + "\n\n<b>Yuklab olish uchun formatni tanlang</b> 👇")


def _summary(deck: dict) -> str:
    lines = []
    for i, s in enumerate(deck["slides"][:14], 1):
        t = s.get("title") or s.get("text") or ""
        lines.append(f"{i}. {esc(decks.clean(t, 60))}")
    if len(deck["slides"]) > 14:
        lines.append(f"… va yana {len(deck['slides']) - 14} ta")
    return "\n".join(lines)


# ----------------------------------------------------------------------------------------------
# Generatsiya / tahrirlash vazifalari (alohida task'larda — webhook darhol 200 qaytaradi)
# ----------------------------------------------------------------------------------------------
try:
    _GEN_PARALLEL = max(2, min(16, int(_env("TG_AI_PARALLEL", "6"))))      # v52: 3 -> 6 (AI so'rovlari tarmoq kutishi, CPU emas)
except Exception:
    _GEN_PARALLEL = 6
_gen_sem = asyncio.Semaphore(_GEN_PARALLEL)
_gen_waiting = 0
GEN_QUEUE_MAX = 30          # v51: navbatda 30 tadan ko'p AI so'rovi bo'lsa — yangisi rad etiladi (server qotmasin)
_bg: set = set()


class _AiSlot:
    """`async with _AiSlot():` — bir vaqtda 3 ta AI so'rovi, qolgani navbatda (soni hisoblanadi)."""
    async def __aenter__(self):
        global _gen_waiting
        _gen_waiting += 1
        try:
            await _gen_sem.acquire()
        finally:
            _gen_waiting -= 1
        return self

    async def __aexit__(self, *a):
        _gen_sem.release()


def _overloaded() -> bool:
    return _gen_waiting >= GEN_QUEUE_MAX


BUSY_TEXT = "⏳ Hozir so'rovlar juda ko'p. 1–2 daqiqadan keyin qayta urinib ko'ring — hech narsa yechilmadi."


def _spawn(coro) -> None:
    t = asyncio.create_task(coro)
    _bg.add(t)
    t.add_done_callback(_bg.discard)


async def _send(chat_id: int, text: str, kb: Optional[dict] = None) -> Optional[dict]:
    payload: Dict[str, Any] = {"chat_id": chat_id, "text": text[:4000], "parse_mode": "HTML", "disable_web_page_preview": True}
    if kb:
        payload["reply_markup"] = kb
    return await tg("sendMessage", **payload)


async def _edit(chat_id: int, msg_id: Optional[int], text: str, kb: Optional[dict] = None) -> None:
    if not msg_id:
        await _send(chat_id, text, kb)
        return
    payload: Dict[str, Any] = {"chat_id": chat_id, "message_id": msg_id, "text": text[:4000], "parse_mode": "HTML", "disable_web_page_preview": True}
    if kb:
        payload["reply_markup"] = kb
    await tg("editMessageText", **payload)


def _no_credit_text(mode: str, usage: Optional[dict]) -> str:
    w = ""
    try:
        w = _fmt_wait(_deps["usage_payload"](usage).get("next_reset_in_seconds")) if usage else ""
    except Exception:
        pass
    return "😔 <b>Varaqlar tugadi.</b>\n" + (f"Bepul varaqlar <b>{w}</b> dan keyin yangilanadi.\n" if w else "") + "Davom etish uchun varaq sotib oling 👇"


def _no_credit_reply(mode: str, usage: Optional[dict]) -> Tuple[str, dict]:
    """Google ulanmagan Telegram akkaunti — balansi ham, AI ham yo'q: «sotib oling» emas, «Google ulang» deyiladi."""
    if _TG_ONLY_RE.match(str((usage or {}).get("email") or "")):
        return LINK_FIRST, {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]}
    return _no_credit_text(mode, usage), _kb_buy()


_TG_ONLY_RE = re.compile(r"^tg\d+@t\.me$", re.I)


def _kb_buy() -> dict:
    return {"inline_keyboard": [[_btn("➕ Varaq sotib olish", "buy")]]}


STEPS = ["Mavzu tahlili", "Slayd matnlari", "Rasmlar", "Fayllar (PPTX · PDF · HTML)"]
HEADS = ["⏳ AI mavzuni tahlil qilmoqda…", "🧠 Slayd tuzilishi va matnlari yozilmoqda…", "🖼 Rasmlar tanlanmoqda…", "📦 Fayl yuborilmoqda..."]


def _steps(cur: int, extra: str = "") -> str:
    lines = [("✅" if i < cur else ("⏳" if i == cur else "▫️")) + f" {t}" for i, t in enumerate(STEPS)]
    return f"<b>{HEADS[cur]}</b>\n\n" + "\n".join(lines) + extra


async def _run_generate(chat_id: int, user: dict, topic: str, n: int) -> None:
    st = _state(chat_id)
    if _overloaded():
        await _send(chat_id, BUSY_TEXT)
        return
    st["busy"] = True
    msg_id: Optional[int] = None
    try:
        mode = st.get("mode", "fast")
        sent = await _send(chat_id, _steps(0))
        msg_id = (sent or {}).get("message_id") if isinstance(sent, dict) else None
        await tg("sendChatAction", chat_id=chat_id, action="typing")
        uid, email = await _ensure_uid(user)
        usage = await asyncio.to_thread(_usage_now_sync, uid, email)
        if usage.get("blocked"):
            await _edit(chat_id, msg_id, "⛔ Akkauntingiz bloklangan.")
            return
        afford = int(_deps["total_credits"](usage) // _page_units(mode))
        if afford < 1:
            await _edit(chat_id, msg_id, *_no_credit_reply(mode, usage))
            return
        note = ""
        if n > afford:
            note = f"\n\nℹ️ Balansingizda {afford} varaq bor — shuncha slayd yaratiladi."
            n = max(1, afford)
        n = max(1, n)
        extra = f"\n\n{n} ta slayd · {'🧠 Chuqur' if mode == 'deep' else '⚡ Tez'} AI" + ("\n<i>Chuqur rejim 1–2 daqiqa olishi mumkin.</i>" if mode == "deep" else "") + note
        await _edit(chat_id, msg_id, _steps(1, extra))

        async with _AiSlot():
            deck, tokens, tries = None, 0, 0
            data: Optional[dict] = None
            prompt = f"User request:\n{topic}\n\nNumber of slides N = {n}"
            if mode == "deep" and not _NO_IMG_RE.search(topic):
                prompt += "\nIMPORTANT: set \"images\": true and fill the English \"image\" query for the title slide and for about 40% of the bullets slides."
            while tries < 2 and deck is None:
                tries += 1
                data, tk = await _ai_json(GEN_SYSTEM, prompt if tries == 1 else prompt + "\n\nReturn ONLY the JSON object, strictly following the schema.", mode)
                tokens += tk
                deck = decks.normalize_deck(data, n, topic)
            if deck is None:
                await _edit(chat_id, msg_id, "⚠️ AI to'g'ri javob bermadi. Hech narsa yechilmadi — mavzuni qayta yuboring.")
                return
            imgs_on = (data or {}).get("images", True) is not False or not _NO_IMG_RE.search(topic)   # AI «rasm kerak emas» desa-yu, foydalanuvchi so'ramagan bo'lsa — baribir rasm
            if imgs_on:
                tokens += await _ensure_image_queries(deck, topic)           # Chuqur AI ko'pincha rasm so'rovini yozmaydi — shuni to'ldiramiz
            await _edit(chat_id, msg_id, _steps(2, f"\n\n«{esc(deck['title'])}» — {len(deck['slides'])} ta slayd"))
            await tg("sendChatAction", chat_id=chat_id, action="upload_photo")
            imgs = await _fetch_images(deck, {}, imgs_on)

        usage2, charged = await _charge(uid, email, len(deck["slides"]), tokens, mode, {"src": "telegram", "slides": len(deck["slides"]), "topic": topic[:80]})
        lang = _guess_lang(topic)
        st.update(deck=deck, imgs=imgs, img_ts=time.time(), topic=topic, awaiting=None, uid=uid, email=email, lang=lang)
        st["deck_id"] = await asyncio.to_thread(_deck_insert_sync, chat_id, uid, deck, topic, lang)      # faqat qisqa JSON matn
        left = _pages_left(usage2, mode)
        spent = charged / _page_units(mode)
        st["ui"] = None                                   # slayd tayyor — «Yangi slayd» rejimi tugadi
        await _edit(chat_id, msg_id, _card_text(deck, "✅", f"💳 Sarflandi: <b>{_fmt_pages(spent)}</b> varaq · Qoldi: <b>{_fmt_pages(left)}</b>{note}"), kb_done(st))
        await _maybe_ad(chat_id, uid, email)
        _spawn(_prewarm_files(chat_id))                     # PPTX ni fonda oldindan tayyorlab qo'yamiz
    except asyncio.TimeoutError:
        await _edit(chat_id, msg_id, "⌛ AI juda uzoq o'ylandi. Hech narsa yechilmadi — qayta urinib ko'ring (yoki ⚡ Tez AI rejimini tanlang: /mode).")
    except RuntimeError as e:
        txt = "⚙️ AI xizmati hozircha sozlanmagan." if "ai_not_configured" in str(e) else "⚙️ Akkauntni ochib bo'lmadi. Birozdan keyin urinib ko'ring."
        await _edit(chat_id, msg_id, txt)
    except Exception as e:
        _warn("gen", f"generatsiya xatosi: {type(e).__name__}: {str(e)[:160]}")
        await _edit(chat_id, msg_id, "⚠️ Xatolik yuz berdi. Hech narsa yechilmadi — birozdan keyin qayta urinib ko'ring.")
    finally:
        st["busy"] = False


def _guess_lang(text: str) -> str:
    if re.search(r"[а-яёА-ЯЁ]", text or ""):
        return "ru"
    return "uz"


def _changed_slides(old: dict, new: dict) -> int:
    a, b = old.get("slides", []), new.get("slides", [])
    ch = 0
    for i, s in enumerate(b):
        if i >= len(a) or json.dumps(a[i], sort_keys=True, ensure_ascii=False) != json.dumps(s, sort_keys=True, ensure_ascii=False):
            ch += 1
    return ch


async def _run_edit(chat_id: int, user: dict, text: str) -> None:
    st = _state(chat_id)
    if _overloaded():
        await _send(chat_id, BUSY_TEXT)
        return
    st["busy"] = True
    msg_id: Optional[int] = None
    try:
        mode = st.get("mode", "fast")
        if not st.get("deck") and not await _restore_deck(chat_id):
            await _send(chat_id, "Avval slayd yarating — mavzuni yozing 🙂")
            return
        deck = st["deck"]
        uid, email = await _ensure_uid(user)
        usage = await asyncio.to_thread(_usage_now_sync, uid, email)
        if _deps["total_credits"](usage) < _deps["MODES"][mode]["chat"]:
            await _send(chat_id, *_no_credit_reply(mode, usage))
            return
        sent = await _send(chat_id, "✏️ <b>AI o'qimoqda…</b>")
        msg_id = (sent or {}).get("message_id") if isinstance(sent, dict) else None
        await tg("sendChatAction", chat_id=chat_id, action="typing")
        async with _AiSlot():
            data, tokens = await _ai_json(EDIT_SYSTEM, _edit_prompt(deck, text) + _account_context(usage, email, user), mode)
        data = data if isinstance(data, dict) else {}
        intent = str(data.get("intent") or "").lower()
        if intent == "new_topic":
            # v63: «hammasini boshidan qil» kabi buyruqda mavzu matnda bo'lmasligi mumkin — AI bergan mavzu, bo'lmasa eski mavzu ishlatiladi
            topic = decks.clean(data.get("topic"), 1500)
            if not topic:
                topic = text[:1500] if len(text.split()) > 3 else f"{deck.get('title') or st.get('topic') or ''}. {text}".strip(" .")[:1500]
            await _edit(chat_id, msg_id, "🆕 Eski slayd yopildi — butunlay yangidan yarataman.")
            st.update(deck=None, deck_id=None, imgs={}, awaiting=None, ui=None, topic=topic)
            st["busy"] = False
            await _run_generate(chat_id, user, topic, _parse_count(text) or _parse_count(topic) or DEFAULT_SLIDES)
            return
        has_change = isinstance(data.get("ops"), list) or isinstance(data.get("deck"), dict)
        if intent == "chat" or not has_change:
            await _charge(uid, email, 0, tokens, mode, {"src": "telegram", "kind": "chat"})
            reply = decks.clean(data.get("reply"), 800) or "Tushunmadim, iltimos aniqroq yozing — masalan: «3-slaydni qisqartir»."
            await _edit(chat_id, msg_id, f"💬 {esc(reply)}", kb_done(st))
            return
        new, changed = None, 0
        if isinstance(data.get("ops"), list):
            new, changed = _apply_ops(deck, data["ops"])            # faqat kerakli slaydlar o'zgaradi
        else:
            new = decks.normalize_deck(data["deck"], len(deck["slides"]) + 8, deck.get("title", ""))
            changed = _changed_slides(deck, new) if new else 0
        if not new:
            await _edit(chat_id, msg_id, "⚠️ O'zgartirishni qo'llab bo'lmadi. Hech narsa yechilmadi — boshqacha yozib ko'ring.", kb_done(st))
            return
        afford = int(_deps["total_credits"](usage) // _page_units(mode))
        if changed > afford:
            await _edit(chat_id, msg_id, f"😔 Bu o'zgarish {changed} varaq talab qiladi, sizda {afford} varaq bor. Kichikroq o'zgarish so'rang yoki varaq oling.", kb_main())
            return
        usage2, charged = await _charge(uid, email, changed, tokens, mode, {"src": "telegram", "kind": "edit", "changed": changed})
        st.update(deck=new, awaiting=None)
        if st.get("deck_id"):
            await asyncio.to_thread(_deck_update_sync, st["deck_id"], chat_id, new)
        else:
            st["deck_id"] = await asyncio.to_thread(_deck_insert_sync, chat_id, uid, new, st.get("topic", ""), st.get("lang", "uz"))
        reply = decks.clean(data.get("reply"), 500)
        left = _pages_left(usage2, mode)
        await _edit(
            chat_id, msg_id,
            _card_text(new, "✅ Yangilandi", (esc(reply) + "\n\n" if reply else "") + f"💳 Sarflandi: <b>{_fmt_pages(charged / _page_units(mode))}</b> varaq · Qoldi: <b>{_fmt_pages(left)}</b>\n"
                       "<i>Yana o'zgartirish kerak bo'lsa — shu yerga yozing.</i>"),
            kb_done(st),
        )
        await _maybe_ad(chat_id, uid, email)
        _spawn(_prewarm_files(chat_id))
    except asyncio.TimeoutError:
        await _edit(chat_id, msg_id, "⌛ AI juda uzoq o'ylandi. Hech narsa yechilmadi — qayta urinib ko'ring.", kb_done(st))
    except Exception as e:
        _warn("edit", f"tahrir xatosi: {type(e).__name__}: {str(e)[:160]}")
        await _edit(chat_id, msg_id, "⚠️ Xatolik yuz berdi. Hech narsa yechilmadi.", kb_done(st))
    finally:
        st["busy"] = False


async def _chat_action_loop(chat_id: int, action: str, stop: "asyncio.Event") -> None:
    """Fayl tayyorlanayotganda Telegram'da «yuborilmoqda…» ko'rsatib turadi (har 4 soniyada; harakat 5 s da o'chadi)."""
    try:
        while not stop.is_set():
            await tg("sendChatAction", chat_id=chat_id, action=action)
            try:
                await asyncio.wait_for(stop.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                pass
    except Exception:
        pass


_FMT_LABEL = {"pptx": "PPTX", "pdf": "PDF", "html": "HTML", "all": "PPTX + PDF + HTML"}


async def _cleanup_storage_files(chat_id: int) -> None:
    """Remove generated files from Supabase Storage immediately after delivery (keep storage near zero)."""
    sb = _deps.get("supabase") or _sb()
    if not sb:
        return
    # Clean up any files stored for this chat_id in common bucket patterns
    buckets_paths = [
        ("presentations", f"{chat_id}/"),
        ("slides", f"{chat_id}/"),
        ("exports", f"{chat_id}/"),
    ]
    for bucket, prefix in buckets_paths:
        try:
            listed = sb.storage.from_(bucket).list(prefix)
            if listed and isinstance(listed, list):
                paths = [f"{prefix}{item['name']}" for item in listed if item.get('name')]
                if paths:
                    sb.storage.from_(bucket).remove(paths)
        except Exception:
            pass   # bucket may not exist — silently ignore


async def _send_files(chat_id: int, fmt: str) -> bool:
    """v53: tezkor yuborish.
    - Fayllar FAQAT RAM'da (io.BytesIO) yasaladi va to'g'ridan-to'g'ri Telegram'ga oqim qilinadi — Supabase/diskka yozilmaydi.
    - Tayyor fayl keshda bo'lsa (oldindan isitilgan yoki shu slayd avval yuborilgan) rasmlar yuklanmaydi, sahna qayta qurilmaydi.
    - Birinchi bosishdayoq «tayyorlanmoqda» xabari + «fayl yuborilmoqda» belgisi ko'rinadi (kutish jim emas)."""
    st = _state(chat_id)
    if not st.get("deck") and not await _restore_deck(chat_id):
        await _send(chat_id, "Slayd topilmadi (bot qayta ishga tushgan bo'lishi mumkin). Mavzuni yozing — yangisini yarataman 🙂")
        return False
    if st.get("sending"):
        return False
    deck = st["deck"]
    lang = st.get("lang", "uz")
    st["sending"] = True
    ok_all = False
    stop = asyncio.Event()
    pulse = asyncio.create_task(_chat_action_loop(chat_id, "upload_document", stop))
    status_id: Optional[int] = None
    try:
        fmts = ["pptx", "pdf", "html"] if fmt == "all" else [fmt]
        # 1) keshdan darhol (rasm yuklash ham, sahna qurish ham yo'q)
        cached = [decks.cache_peek(deck, lang, f) for f in fmts]
        if not all(cached):
            m = await _send(chat_id, "⏳ <b>Fayl yuborilmoqda...</b>")
            status_id = (m or {}).get("message_id") if isinstance(m, dict) else None
            imgs_q = await _fetch_images(deck, st.get("imgs") or {}, True)          # faqat yetishmayotgan rasmlar
            st["imgs"], st["img_ts"] = imgs_q, time.time()                          # IMG_TTL gacha RAM'da: keyingi format uchun qayta yuklanmaydi
            idx = _img_index(deck, imgs_q)
            files = []
            for f in fmts:
                async with _gen_sem:                                                # CPU og'ir ish: AI bilan bir xil cheklov
                    name, stream, mime, size = await asyncio.to_thread(decks.export_stream, deck, idx, f, lang)
                files.append((name, stream, mime))
        else:
            files = [(n, io.BytesIO(d), mt) for n, d, mt in cached]
        total, ok_all, first = len(files), True, True
        for name, stream, mime in files:
            cap = f"📦 <b>{esc(deck['title'])}</b>" if (first and fmt == "all") else (f"<b>{esc(deck['title'])}</b>" if total == 1 else "")
            if name.endswith(".html") and fmt != "all":
                cap += "\n<i>Brauzerda oching: ← → tugmalar yoki barmoq bilan suring, F — to'liq ekran.</i>"
            if name.endswith(".pptx"):     # v62: animatsiya / o'tishlar qaysi dasturda ishlashi
                cap += ("\n<i>PowerPoint'da oching va «Slide Show» ni bosing — o'tish effektlari va GIF'lar ishlaydi. "
                        "Google Slides, WPS yoki telefon ilovalarida ba'zi effektlar ishlamasligi mumkin; 100% bir xil ko'rinish — HTML formatda.</i>")
            ok_all = (await tg_send_document(chat_id, name, stream, mime, cap)) and ok_all
            first = False
            try:
                stream.close()                                                      # yuborilgach RAM'dan bo'shaydi
            except Exception:
                pass
        if status_id:
            _spawn(tg("deleteMessage", chat_id=chat_id, message_id=status_id))
            status_id = None
        # Immediate Supabase Storage cleanup after successful delivery
        if ok_all:
            _spawn(_cleanup_storage_files(chat_id))
        if ok_all:
            await _send(chat_id, "✅ Tayyor! Yana format kerakmi yoki o'zgartirish qilamizmi?\n<i>Masalan: «3-slaydni qisqartir», «sarlavhasini o'zgartir».</i>", kb_done(st))
        else:
            await _send(chat_id, "⚠️ Faylni yuborib bo'lmadi. Qayta urinib ko'ring.", kb_done(st))
    except Exception as e:
        _warn("files", f"fayl yig'ish xatosi: {type(e).__name__}: {str(e)[:160]}")
        if status_id:
            _spawn(tg("deleteMessage", chat_id=chat_id, message_id=status_id))
        await _send(chat_id, "⚠️ Faylni tayyorlashda xatolik. Qayta urinib ko'ring.", kb_done(st))
    finally:
        stop.set()
        try:
            await pulse
        except Exception:
            pass
        st["sending"] = False                                                       # rasmlar _sweep_imgs orqali IMG_TTL dan keyin tashlanadi
    return ok_all


async def _prewarm_files(chat_id: int) -> None:
    """Slayd tayyor bo'lgach FONDA PPTX ni oldindan yasab RAM keshiga qo'yadi — «PPTX» tugmasi bosilganda fayl darhol ketadi.
    Foydalanuvchi bosmasa ham zarar yo'q: kesh 10 daqiqada o'zi tozalanadi. TG_PREWARM=0 bilan o'chiriladi."""
    if decks is None or _env("TG_PREWARM", "1") == "0":
        return
    try:
        st = _state(chat_id)
        deck = st.get("deck")
        if not deck or st.get("sending"):          # (busy tekshirilmaydi: generatsiya tugash arafasida — bu aynan kerakli payt)
            return
        lang = st.get("lang", "uz")
        if decks.cache_peek(deck, lang, "pptx"):
            return
        imgs_q = await _fetch_images(deck, st.get("imgs") or {}, True)
        st["imgs"], st["img_ts"] = imgs_q, time.time()
        idx = _img_index(deck, imgs_q)
        async with _gen_sem:
            await asyncio.to_thread(decks.export_cached, deck, idx, "pptx", lang)
    except Exception as e:
        _warn("prewarm", f"oldindan tayyorlash: {type(e).__name__}: {str(e)[:100]}")


async def _ask_count(chat_id: int, user: dict, topic: str) -> None:
    st = _state(chat_id)
    st["topic"] = topic[:1500]
    bal = ""
    try:
        uid, email = await _ensure_uid(user)
        u = await asyncio.to_thread(_usage_now_sync, uid, email)
        bal = f"\n💳 Balans: <b>{_fmt_pages(_pages_left(u, st.get('mode', 'fast')))}</b> varaq"
    except Exception:
        pass
    shown = decks.clean(topic, 160)
    await _send(
        chat_id,
        f"✅ Mavzu: <b>{esc(shown)}</b>\n\n<b>Nechta slayd kerak?</b> Tugmani bosing (yoki «10 ta slayd» deb yozing).\n"
        f"<i>1 slayd = 1 varaq{f' (Chuqur AI — {_deep_mult()} Tez-varaq)' if st.get('mode') == 'deep' else ''}</i>{bal}",
        kb_count(st.get("mode", "fast")),
    )


# ----------------------------------------------------------------------------------------------
# Update ishlovi
# ----------------------------------------------------------------------------------------------
PPTX_MAX = 12 * 1024 * 1024


async def _download_tg_file(file_id: str, limit: int = PPTX_MAX) -> Optional[bytes]:
    info = await tg("getFile", file_id=file_id)
    path = (info or {}).get("file_path") if isinstance(info, dict) else None
    if not path or int((info or {}).get("file_size") or 0) > limit:
        return None
    try:
        r = await _http().get(f"https://api.telegram.org/file/bot{BOT_TOKEN}/{path}", timeout=httpx.Timeout(60.0, connect=8.0))
        if r.status_code == 200 and len(r.content) <= limit:
            return r.content
    except Exception as e:
        _warn("dl", f"fayl yuklab olinmadi: {type(e).__name__}")
    return None


_AD_REPORTS: dict = {}
_AD_FILE_CACHE: "OrderedDict[str, Tuple[bytes, str]]" = OrderedDict()
_AD_FILE_CACHE_MAX = 60 * 1024 * 1024


async def fetch_ad_file(file_id: str) -> Optional[Tuple[bytes, str]]:
    """Telegram'dagi video/rasmni (file_id) o'qib beradi — saytdagi reklama uchun. 20 MB gacha, keshlanadi."""
    hit = _AD_FILE_CACHE.get(file_id)
    if hit:
        _AD_FILE_CACHE.move_to_end(file_id)
        return hit
    info = await tg("getFile", file_id=file_id)
    path = (info or {}).get("file_path") if isinstance(info, dict) else None
    data = await _download_tg_file(file_id, 20 * 1024 * 1024)
    if not data:
        return None
    ext = (path or "").rsplit(".", 1)[-1].lower()
    mime = {"mp4": "video/mp4", "webm": "video/webm", "mov": "video/quicktime", "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "video/mp4")
    _AD_FILE_CACHE[file_id] = (data, mime)
    while sum(len(v[0]) for v in _AD_FILE_CACHE.values()) > _AD_FILE_CACHE_MAX and len(_AD_FILE_CACHE) > 1:
        _AD_FILE_CACHE.popitem(last=False)
    return data, mime


_TR_REV = {"fade": "fade", "zoom": "zoom", "cover": "flip", "push": "up", "dissolve": "blur"}


def _shape_font_pt(sh) -> float:
    best = 0.0
    try:
        for p in sh.text_frame.paragraphs:
            for r in p.runs:
                if r.font.size is not None:
                    best = max(best, float(r.font.size.pt))
    except Exception:
        pass
    return best


def _pptx_to_deck(data: bytes, fname: str = "") -> Tuple[Optional[dict], int]:
    """Yuborilgan PPTX dan tuzilmani o'qiydi: sarlavha, punktlar, STATISTIKA, JADVAL, DIAGRAMMA, slayd o'tishi.
    Pastki kolontitul ("Test", "2 / 8"), kichik yuqori yozuv va bezak shakllar o'tkazib yuboriladi — matn ikkilanmaydi."""
    from pptx import Presentation
    prs = Presentation(io.BytesIO(data))
    SH = float(prs.slide_height or 1)
    raw, skipped = [], 0
    for sl in prs.slides:
        texts: List[Tuple[float, float, float, str, float]] = []        # (top, left, pt, text, height)
        tables, charts = [], []
        for sh in sl.shapes:
            try:
                top = float(sh.top or 0) / SH
                if getattr(sh, "has_table", False) and sh.has_table:
                    rows = [[c.text.strip() for c in r.cells] for r in sh.table.rows]
                    if rows:
                        tables.append(rows)
                    continue
                if getattr(sh, "has_chart", False) and sh.has_chart:
                    charts.append(sh.chart)
                    continue
                if not (getattr(sh, "has_text_frame", False) and sh.has_text_frame):
                    continue
                t = "\n".join((p.text or "").strip() for p in sh.text_frame.paragraphs if (p.text or "").strip())
                if not t:
                    continue
                if re.fullmatch(r"\s*\d+\s*/\s*\d+\s*", t):                 # sahifa raqami
                    continue
                pt = _shape_font_pt(sh)
                if top > 0.9 and (pt == 0 or pt <= 14):                         # pastki kolontitul
                    continue
                if t.strip().upper() == "SLIDE STUDIO AI":
                    continue
                texts.append((top, float(sh.left or 0), pt, t, float(sh.height or 0) / SH))
            except Exception:
                continue
        texts.sort(key=lambda x: (round(x[0], 2), x[1]))
        tr = ""
        try:
            el = sl._element.find("{http://schemas.openxmlformats.org/presentationml/2006/main}transition")
            tr = _TR_REV.get(el[0].tag.split("}")[1], "") if (el is not None and len(el)) else "none"
        except Exception:
            pass
        title = ""
        title_item = None
        try:
            ts = sl.shapes.title
            if ts is not None and ts.has_text_frame and ts.text_frame.text.strip():
                title = ts.text_frame.text.strip()
        except Exception:
            pass
        if not title and texts:
            head = [x for x in texts if x[0] < 0.3]
            big = max(head or texts, key=lambda x: (x[2], -x[0]))
            title_item = big
            title = big[3].replace("\n", " ").strip()
        rest = [x for x in texts if x is not title_item and x[3].replace("\n", " ").strip() != title]
        slide: Dict[str, Any] = {"title": title, "transition": tr}
        if tables:
            slide.update(layout="table", rows=tables[0])
        elif charts:
            ch = charts[0]
            try:
                plot = ch.plots[0]
                ctn = str(ch.chart_type).upper()
                kind = "doughnut" if "DOUGHNUT" in ctn else ("pie" if "PIE" in ctn else ("line" if "LINE" in ctn or "AREA" in ctn else "bar"))
                labels = [str(c) for c in plot.categories]
                series = [{"name": str(s.name or ""), "values": [float(v or 0) for v in s.values]} for s in plot.series]
                slide.update(layout="chart", chart=kind, labels=labels, series=series)
            except Exception:
                skipped += 1
                continue
        else:
            # statistika: katta qisqa raqam + uning tagidagi izoh
            nums = [x for x in rest if x[2] >= 30 and len(x[3]) <= 10]
            if len(nums) >= 2:
                stats = []
                for n in nums[:4]:
                    lab = ""
                    below = [x for x in rest if x is not n and x[0] > n[0] and abs(x[1] - n[1]) < 1_500_000 and x[2] < 30]
                    if below:
                        lab = min(below, key=lambda x: x[0] - n[0])[3].replace("\n", " ")
                    stats.append({"value": n[3], "label": lab})
                slide.update(layout="stats", stats=stats)
            else:
                paras = []
                for x in rest:
                    paras.extend([ln.strip() for ln in x[3].split("\n") if ln.strip()])
                slide.update(layout="bullets", bullets=paras, _paras=paras)
        if not slide.get("title") and not slide.get("_paras") and slide.get("layout") == "bullets":
            skipped += 1
            continue
        raw.append(slide)
    if not raw:
        return None, skipped
    if len(raw) > MAX_SLIDES:
        skipped += len(raw) - MAX_SLIDES
        raw = raw[:MAX_SLIDES]
    slides = []
    for i, s in enumerate(raw):
        paras = s.pop("_paras", None)
        if s["layout"] == "bullets":
            if i == 0:
                s = {"layout": "title", "title": s["title"], "subtitle": (paras or [""])[0], "transition": s["transition"]}
            elif i == len(raw) - 1 and len(raw) >= 3 and len(paras or []) <= 1:
                s = {"layout": "closing", "title": s["title"], "subtitle": (paras or [""])[0], "transition": s["transition"]}
            elif not paras:
                skipped += 1
                continue
            else:
                s["bullets"] = paras[:6]
        slides.append(s)
    base = os.path.splitext(fname or "")[0]
    deck = decks.normalize_deck({"title": raw[0]["title"] or base, "subtitle": "", "theme": "ocean", "slides": slides}, MAX_SLIDES + 2, base)
    return deck, skipped


# ----------------------------------------------------------------------------------------------
# «✏️ Redaktorda ochish»: botga yuborilgan fayl VAQTINCHA (15 daqiqa) faqat RAM'da turadi, Mini App/brauzer uni
# imzolangan havola bilan oladi. Diskka yozilmaydi, bazaga tushmaydi.
# ----------------------------------------------------------------------------------------------
FILE_MAX = 15 * 1024 * 1024
FILE_TTL = 900
FILES_KEEP, FILES_BYTES = 40, 160 * 1024 * 1024
EDITABLE_RE = re.compile(r"\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|m4v|ogv|ogg|pptx|pdf|html?)$", re.I)
_files: "OrderedDict[int, dict]" = OrderedDict()


def _files_sweep() -> None:
    now = time.time()
    for k in [k for k, v in _files.items() if v["exp"] < now]:
        _files.pop(k, None)
    while _files and (len(_files) > FILES_KEEP or sum(len(v["data"]) for v in _files.values()) > FILES_BYTES):
        _files.popitem(last=False)


def _file_put(cid: int, name: str, data: bytes) -> int:
    _files_sweep()
    key = secrets.randbelow(2 ** 31 - 1) + 1
    _files[key] = {"cid": int(cid), "name": name[:120], "data": data, "exp": time.time() + FILE_TTL}
    return key


def _file_url(cid: int, key: int) -> str:
    return f"{SITE_URL}/?src=tg&tgfile={_make_token('F', cid, key, FILE_TTL)}"


def _incoming_file(msg: dict) -> Optional[Tuple[str, str, int]]:
    """Xabardagi rasm/hujjat/video/GIF -> (file_id, fayl_nomi, hajmi) yoki None."""
    doc = msg.get("document")
    if isinstance(doc, dict) and doc.get("file_id"):
        return str(doc["file_id"]), str(doc.get("file_name") or "fayl"), int(doc.get("file_size") or 0)
    ph = msg.get("photo")
    if isinstance(ph, list) and ph and isinstance(ph[-1], dict):
        best = max((p for p in ph if isinstance(p, dict) and p.get("file_id")), key=lambda p: int(p.get("file_size") or 0), default=None)
        if best:
            return str(best["file_id"]), "foto.jpg", int(best.get("file_size") or 0)
    for key, nm in (("animation", "animatsiya.mp4"), ("video", "video.mp4")):
        v = msg.get(key)
        if isinstance(v, dict) and v.get("file_id"):
            return str(v["file_id"]), str(v.get("file_name") or nm), int(v.get("file_size") or 0)
    return None


async def _run_file(chat_id: int, user: dict, file_id: str, fname: str, size: int) -> None:
    st = _state(chat_id)
    st["busy"] = True
    try:
        if not EDITABLE_RE.search(fname):
            await _send(chat_id, "📎 Bu turdagi fayl muharrirda ochilmaydi.\nQo'llanadi: <b>rasm, GIF, video, PPTX, PDF, HTML</b>.", kb_reply())
            return
        if size and size > FILE_MAX:
            await _send(chat_id, "⚠️ Fayl katta — 15 MB gacha yuboring.", kb_reply())
            return
        sent = await _send(chat_id, "📎 <b>Fayl qabul qilinmoqda…</b>")
        mid = (sent or {}).get("message_id") if isinstance(sent, dict) else None
        data = await _download_tg_file(file_id, FILE_MAX)
        if not data:
            await _edit(chat_id, mid, "⚠️ Faylni yuklab bo'lmadi (15 MB dan oshmasin). Qayta yuboring.")
            return
        key = _file_put(chat_id, fname, data)
        n = len(data)
        data = None
        url = _file_url(chat_id, key)
        rows = [[{"text": "✏️ Redaktorda ochish", "web_app": {"url": url}}]]
        if fname.lower().endswith(".pptx"):
            rows.append([_btn("🤖 AI bilan matnini tahrirlash", f"pptxai:{key}")])
        rows.append([{"text": "🌐 Brauzerda ochish", "url": url}])
        size_txt = f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{max(1, n // 1024)} KB"
        await _edit(chat_id, mid, f"✅ <b>{esc(fname)}</b> ({size_txt}) qabul qilindi.\n"
                                  f"Muharrirda ochish uchun tugmani bosing. <i>Fayl {FILE_TTL // 60} daqiqa saqlanadi, so'ng o'chadi.</i>",
                    {"inline_keyboard": rows})
    except Exception as e:
        _warn("file", f"fayl qabuli xatosi: {type(e).__name__}: {str(e)[:140]}")
        await _send(chat_id, "⚠️ Faylni qabul qilib bo'lmadi. Keyinroq qayta urinib ko'ring.")
    finally:
        st["busy"] = False
        gc.collect()


async def _run_import(chat_id: int, user: dict, file_id: str, fname: str, pre: Optional[bytes] = None) -> None:
    st = _state(chat_id)
    st["busy"] = True
    msg_id: Optional[int] = None
    try:
        sent = await _send(chat_id, "📎 <b>PPTX o'qilmoqda…</b>")
        msg_id = (sent or {}).get("message_id") if isinstance(sent, dict) else None
        data = pre or await _download_tg_file(file_id)
        pre = None
        if not data:
            await _edit(chat_id, msg_id, "⚠️ Faylni yuklab bo'lmadi. <b>.pptx</b> bo'lsin va 12 MB dan oshmasin.")
            return
        deck, skipped = await asyncio.to_thread(_pptx_to_deck, data, fname)
        data = None
        if not deck:
            await _edit(chat_id, msg_id, "⚠️ PPTX ichida o'qiladigan matn topilmadi (faqat rasmli slaydlar bo'lishi mumkin).")
            return
        uid, email = await _ensure_uid(user)
        lang = _guess_lang(json.dumps(deck, ensure_ascii=False)[:2000])
        st.update(deck=deck, imgs={}, topic=deck["title"], awaiting=None, lang=lang, uid=uid, email=email, ui=None)
        st["deck_id"] = await asyncio.to_thread(_deck_insert_sync, chat_id, uid, deck, deck["title"], lang)
        note = f"\n<i>{skipped} ta bo'sh/rasmli slayd o'tkazib yuborildi.</i>" if skipped else ""
        await _edit(
            chat_id, msg_id,
            f"✅ <b>{esc(deck['title'])}</b> o'qildi (bepul)\n🎞 {len(deck['slides'])} ta slayd{note}\n\n{_summary(deck)}\n\n"
            "ℹ️ Matn olindi; asl dizayn va rasmlar o'qilmaydi — yangi fayl bot dizaynida chiqadi.\n"
            "✏️ O'zgartirish uchun <b>«Tahrirlash»</b> tugmasini bosing.",
            kb_done(st),
        )
    except Exception as e:
        _warn("import", f"PPTX import xatosi: {type(e).__name__}: {str(e)[:140]}")
        await _edit(chat_id, msg_id, "⚠️ PPTX ni o'qib bo'lmadi. Boshqa fayl yuboring yoki mavzuni yozing.")
    finally:
        st["busy"] = False
        gc.collect()


async def _show_my(cid: int) -> None:
    rows = await asyncio.to_thread(_deck_list_sync, cid)
    if not rows:
        await _send(cid, "📂 Saqlangan slaydlar yo'q.", {"inline_keyboard": [[_btn("🎨 Yangi slayd", "new")]]})
        return
    kb = [[_btn(f"📂 {decks.clean(r.get('title') or 'Slayd', 40)}", f"open:{r['id']}")] for r in rows]
    kb.append([_btn("🗑 Hammasini tozalash", "clr")])
    await _send(cid, f"📂 <b>Slaydlarim</b> (oxirgi {len(rows)} ta, faqat matn saqlanadi)\nOchish uchun tanlang:", {"inline_keyboard": kb})


async def _ask_clear(cid: int) -> None:
    await _send(cid, "🗑 <b>Barcha slaydlaringiz tarixi o'chiriladi.</b>\nBalans va akkaunt saqlanib qoladi. Davom etamizmi?",
                {"inline_keyboard": [[_btn("🗑 Ha, tozalash", "clr_yes"), _btn("↩️ Bekor", "clr_no")]]})


async def _do_clear(cid: int) -> None:
    n = await asyncio.to_thread(_deck_clear_sync, cid)
    st = _state(cid)
    st.update(deck=None, deck_id=None, imgs={}, awaiting=None, topic=None, sending=False, ui=None)
    gc.collect()
    await _send(cid, f"✅ Tozalandi: <b>{n}</b> ta saqlangan slayd o'chirildi.\n💳 Balansingiz va akkauntingiz joyida.")


async def _show_balance(cid: int, user: dict) -> None:
    i = await _balance_info(user)
    if not i:
        await _send(cid, "⚠️ Hozir balansni o'qib bo'lmadi. Birozdan keyin qayta urinib ko'ring.", kb_main())
        return
    if i.get("locked"):
        await _send(cid, await _credits_text(user), {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})
        return
    await _send(cid, await _credits_text(user), kb_balance(bool(i["linked"]), i))


async def _do_buy(cid: int, user: dict, product: str = "pack") -> None:
    res: Dict[str, Any] = {}
    try:
        uid, email = await _ensure_uid(user)
        if email.endswith("@" + TG_EMAIL_DOMAIN) and not _is_admin(user):
            await _send(cid, LINK_FIRST + "\nVaraq sotib olish ham shundan keyin.", {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})
            return
        fn = _deps.get("checkout")
        res = await fn(uid, "" if email.endswith("@" + TG_EMAIL_DOMAIN) else email, SITE_URL, "pack") if fn else {"error": "no_checkout"}
    except Exception as e:
        _warn("buy", f"checkout xatosi: {type(e).__name__}: {str(e)[:140]}")
        res = {"error": f"{type(e).__name__}: {str(e)[:120]}"}
    if res.get("url"):
        info = f"💎 <b>{res.get('pages')} varaq</b>" + (f" — <b>${res.get('price')}</b>" if res.get("price") else "")
        await _send(cid, f"🧾 {info}\nTo'lovdan so'ng varaqlar darhol qo'shiladi.",
                    {"inline_keyboard": [[{"text": "💳 To'lovga o'tish", "url": res["url"]}], [_btn("⬅️ Orqaga", "bal")]]})
        return
    # xato: oddiy foydalanuvchiga mayin matn, ADMINGA — aniq sabab
    reason = str(res.get("error") or "") + ((" — " + str(res.get("hint"))) if res.get("hint") else "")
    adm = _deps.get("admin")
    if adm and adm.is_tg_admin(user.get("id")):
        await _send(cid, f"🛠 <b>To'lov sozlanmagan</b> (faqat sizga ko'rinadi)\n<code>{esc(reason[:600])}</code>\n\n"
                         "Tekshiring: LEMON_SQUEEZY_API_KEY, _STORE_ID, _VARIANT_ID, _WEBHOOK_SECRET.\n"
                         "Vaqtincha: /give ID SON bilan varaq bering.", kb_main())
        return
    await _send(cid, "⚙️ To'lov hozircha ishlamayapti. Birozdan keyin urinib ko'ring.", kb_main())


async def _link_help(cid: int) -> None:
    url = f"{SITE_URL}/?tglink={_make_token('L', cid, 0, 600)}"
    await _send(
        cid,
        "🔗 <b>Sayt akkauntini ulash</b> (Google)\n\n1️⃣ Pastdagi tugmani bosing — sayt ochiladi\n2️⃣ Google bilan kiring — ulash <b>o'zi</b> tugaydi ✅\n\n"
        "<i>Telegram ichida Google kirishga ruxsat bermasa: havolani ⋮ → «Brauzerda ochish» orqali oching.</i>\n"
        "Yoki saytda: ⚙️ Sozlamalar → <b>«Telegram botni ulash»</b> (bir bosish).",
        {"inline_keyboard": [[{"text": "🌐 Saytda ulash", "url": url}]]},
    )


def _linked_text(res: dict) -> str:
    extra = f"\n💎 Botdagi {_fmt_pages(res['moved_pages'])} pullik varaq sayt akkauntingizga ko'chirildi." if res.get("moved_pages") else ""
    return f"✅ <b>Ulandi!</b> Sayt akkauntingiz ({esc(_mask_email(res['email']))}) bilan balans endi <b>bir xil</b>.{extra}"


async def _do_link(cid: int, user: dict, code: str) -> None:
    res = await asyncio.to_thread(_link_consume_sync, user, code)
    if res.get("ok"):
        res = await _link_apply(res["tid"], res["user_id"], res["email"])
    if res.get("ok"):
        await _send(cid, _linked_text(res), kb_main())
        pend = _state(cid).pop("ref", None)               # do'st havolasi bilan kelgan bo'lsa — endi bonus hisoblanadi
        if pend:
            await _claim_ref(cid, user, pend, quiet=True)
    elif res.get("error") == "db":
        await _send(cid, "⚙️ Ulashni hozir bajarib bo'lmadi (baza sozlanmagan). Keyinroq urinib ko'ring.")
    else:
        await _send(cid, "❌ Kod noto'g'ri yoki eskirgan (10 daqiqa yashaydi). Saytda «Telegram botni ulash» ni bosib yangi kod oling.")


def _ref_api() -> dict:
    try:
        from backend import community
        return community.api
    except Exception:
        return {}


_REF_RE = re.compile(r"^[A-Za-z0-9]{6,12}$")


async def _show_invite(cid: int, user: dict) -> None:
    api = _ref_api()
    if not api.get("stats"):
        await _send(cid, "⚙️ Taklif tizimi hozircha mavjud emas.", kb_main())
        return
    try:
        uid, email = await _ensure_uid(user)
    except Exception:
        await _send(cid, "⚠️ Akkauntni ochib bo'lmadi. Birozdan keyin urinib ko'ring.")
        return
    if email.endswith("@" + TG_EMAIL_DOMAIN) and not _is_admin(user):
        await _send(cid, "🎁 <b>Do'st taklif qilish</b>\n" + LINK_FIRST, {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})
        return
    r = await api["stats"](uid)
    if r.get("error"):
        await _send(cid, "⚙️ Taklif tizimi hozir ishlamayapti. Keyinroq urinib ko'ring.", kb_main())
        return
    code = r["code"]
    uname = await _bot_username()
    bot_link = f"https://t.me/{uname}?start=ref_{code}" if uname else f"{SITE_URL}/?ref={code}"
    site_link = f"{SITE_URL}/?ref={code}"
    per = r.get("bonus_per_friend", 15)
    text = (f"🎁 <b>Do'st taklif qiling — har biri uchun +{per} varaq</b>\n"
            f"Do'stingiz havolangiz orqali kirib Google akkaunt ulasa, balansingizga {per} ta pullik varaq qo'shiladi.\n\n"
            f"🤖 Bot havolasi:\n<code>{esc(bot_link)}</code>\n\n🌐 Sayt havolasi:\n<code>{esc(site_link)}</code>\n\n"
            f"👥 Taklif qilinganlar: <b>{r.get('invited', 0)}</b> · 🎉 Olingan bonus: <b>+{r.get('bonus_total', 0)}</b> varaq")
    share = f"https://t.me/share/url?url={quote(bot_link, safe='')}&text={quote('Slide Studio — AI bilan slayd yarating. Mening havolam orqali kiring:', safe='')}"
    await _send(cid, text, {"inline_keyboard": [[{"text": "📤 Do'stga yuborish", "url": share}], [_btn("💳 Balans", "bal")]]})


async def _claim_ref(cid: int, user: dict, code: str, quiet: bool = False) -> None:
    api = _ref_api()
    if not api.get("claim") or not _REF_RE.match(code or ""):
        return
    try:
        uid, _email = await _ensure_uid(user)
        r = await api["claim"](uid, None, code)
    except Exception as e:
        _warn("ref", f"taklif xatosi: {str(e)[:100]}")
        return
    if r.get("ok"):
        await _send(cid, "🎉 Taklif qabul qilindi! Sizni taklif qilgan do'stingizga bonus varaqlar berildi. Xush kelibsiz!")
    elif not quiet and r.get("error"):
        await _send(cid, f"ℹ️ {esc(r['error'])}")


async def _handle_ref_start(cid: int, user: dict, code: str) -> None:
    st = _state(cid)
    code = (code or "").strip().upper()
    if not _REF_RE.match(code):
        return
    try:
        _uid, email = await _ensure_uid(user)
    except Exception:
        return
    if email.endswith("@" + TG_EMAIL_DOMAIN) and not _is_admin(user):
        st["ref"] = code               # Google ulangach (yoki shu paytda) bonus hisoblanadi
        await _send(cid, "🎁 Do'stingiz sizni taklif qildi!\nBonus hisoblanishi uchun avval <b>Google akkauntni ulang</b>.",
                    {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})
        return
    await _claim_ref(cid, user, code)


async def _show_settings(cid: int, user: dict, mid: Optional[int] = None) -> None:
    st = _state(cid)
    try:
        info = await asyncio.wait_for(_balance_info(user), timeout=6)
    except Exception:
        info = None
    deep = st.get("mode") == "deep"
    if info and info.get("linked"):
        acc = f"🔗 Google: <b>ulangan</b> ({esc(_mask_email(info['email']))})"
        first = [_btn("🔓 Google'ni uzish", "unl")]
    else:
        acc = "🔗 Google: <b>ulanmagan</b>"
        first = [_btn("🔗 Google ulash", "linkinfo")]
    text = f"⚙️ <b>Sozlamalar</b>\n{acc}\n🤖 AI: <b>{'🧠 Chuqur' if deep else '⚡ Tez'}</b>"
    kb = {"inline_keyboard": [
        first,
        [_btn(("✅ " if not deep else "") + "⚡ Tez", "smode:fast"), _btn(("✅ " if deep else "") + "🧠 Chuqur", "smode:deep")],
        [_btn("💳 Balans", "bal")],
    ]}
    await _edit(cid, mid, text, kb)


async def _menu_action(cid: int, user: dict, action: str) -> None:
    st = _state(cid)
    if action == "new":
        st.update(deck=None, deck_id=None, imgs={}, awaiting=None, topic=None, ui="new")
        await _send(cid, "🎨 <b>Yangi slayd</b>\nMavzuni yozing — AI slayd tayyorlaydi.\n"
                         "Yoki oddiy savol bering — slayd yasamasdan javob beraman.\n\n"
                         "<i>Masalan: «Sun'iy intellekt, 8 ta slayd»</i>")
    elif action == "my":
        st["ui"] = None
        await _show_my(cid)
    elif action == "bal":
        await _show_balance(cid, user)
    elif action == "site":
        await _send(cid, f"🌐 {esc(SITE_URL)}", kb_main())
    elif action == "set":
        await _show_settings(cid, user)
    elif action == "about":
        await _send(cid, ABOUT, kb_main())
    elif action == "inv":
        await _show_invite(cid, user)


async def _handle_callback(cb: dict) -> None:
    cid = (cb.get("message") or {}).get("chat", {}).get("id")
    mid = (cb.get("message") or {}).get("message_id")
    user = cb.get("from") or {}
    data = str(cb.get("data") or "")
    await tg("answerCallbackQuery", callback_query_id=cb.get("id"))
    if not isinstance(cid, int) or not isinstance(user.get("id"), int) or _limited(cid, 14):
        return
    st = _state(cid)
    if data.startswith("a:"):
        await _admin_cb(cid, mid, user, data)
        return
    if data in ("credits", "bal"):
        await _show_balance(cid, user)
    elif data == "inv":
        await _show_invite(cid, user)
    elif data == "buy":
        await _do_buy(cid, user, "pack")
    elif data in ("pro", "buypro"):                      # eski xabarlardagi Pro tugmalari
        await _show_balance(cid, user)
    elif data == "linkinfo":
        await _link_help(cid)
    elif data == "dismiss":
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
    elif data == "about":
        await _send(cid, ABOUT, kb_main())
    elif data.startswith("smode:"):
        st["mode"] = "deep" if data.endswith("deep") else "fast"
        await _show_settings(cid, user, mid)
    elif data == "unl":
        await _send(cid, "🔓 <b>Google akkaunt uzilsinmi?</b>\nBot o'zining Telegram akkauntiga qaytadi. Sayt akkauntingiz va uning balansi o'zgarmaydi.",
                    {"inline_keyboard": [[_btn("✅ Ha, uzish", "unl_yes"), _btn("↩️ Yo'q", "unl_no")]]})
    elif data == "unl_yes":
        ok = await asyncio.to_thread(_unlink_sync, user["id"])
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
        await _send(cid, "🔓 Google akkaunt uzildi. Qayta ulash: «⚙️ Sozlamalar» → «Google akkauntni ulash»." if ok else "⚙️ Hozir bajarib bo'lmadi. Keyinroq urinib ko'ring.")
    elif data == "unl_no":
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
    elif data.startswith("pptxai:") and not await _google_ok(cid, user):
        return
    elif data.startswith("pptxai:"):
        try:
            f = _files.get(int(data.split(":", 1)[1]))
        except Exception:
            f = None
        if not f or f["cid"] != cid or f["exp"] < time.time():
            await _send(cid, "⌛ Fayl muddati tugagan — qayta yuboring.")
        elif st.get("busy"):
            await _send(cid, "⏳ Oldingi so'rov hali bajarilmoqda — biroz kuting.")
        else:
            _spawn(_run_import(cid, user, "", f["name"], f["data"]))
    elif data == "my":
        await _show_my(cid)
    elif data == "clr":
        await _ask_clear(cid)
    elif data == "clr_yes":
        await _do_clear(cid)
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
    elif data == "clr_no":
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
        await _send(cid, "↩️ Bekor qilindi. Hech narsa o'chirilmadi.")
    elif data.startswith("open:"):
        try:
            did = int(data.split(":", 1)[1])
        except Exception:
            return
        if await _restore_deck(cid, did):
            st["ui"] = None
            await _send(cid, _card_text(st["deck"], "📂"), kb_done(st))
        else:
            await _send(cid, "Bu slayd topilmadi (o'chirilgan bo'lishi mumkin).")
    elif data.startswith("mode:"):
        st["mode"] = "deep" if data.endswith("deep") else "fast"
        if st.get("topic"):
            await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup=kb_count(st["mode"]))
    elif data.startswith("cnt:"):                         # eski xabarlardagi tugmalar uchun
        if st.get("busy"):
            await _send(cid, "⏳ Oldingi so'rov bajarilmoqda, biroz kuting.")
            return
        topic = st.get("topic")
        if not topic:
            await _send(cid, "Mavzu topilmadi — iltimos, mavzuni qayta yozing.")
            return
        if not await _google_ok(cid, user):
            return
        try:
            n = max(MIN_SLIDES, min(MAX_SLIDES, int(data.split(":")[1])))
        except Exception:
            n = DEFAULT_SLIDES
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
        _spawn(_run_generate(cid, user, topic, n))
    elif data.startswith("dl:"):
        fmt = data.split(":", 1)[1]
        if fmt in ("pptx", "pdf", "html", "all"):
            _spawn(_send_files(cid, fmt))
    elif data == "edit":
        if not await _google_ok(cid, user):
            return
        if not st.get("deck") and not await _restore_deck(cid):
            await _send(cid, "Slayd topilmadi. «🎨 Yangi slayd» ni bosing.", kb_start())
            return
        st.update(ui="edit", awaiting=None)
        d = st["deck"]
        await _send(cid, f"✏️ <b>Tahrirlash oynasi</b>\n<b>{esc(d['title'])}</b> · 🎞 {len(d['slides'])} ta slayd\n\n{_summary(d)}\n\n"
                         "<b>Nimani o'zgartiray? Oddiy matn bilan yozing:</b>\n"
                         "• <i>3-slaydni qisqartir</i>\n• <i>sarlavhasini o'zgartir: «Yangi nom»</i>\n• <i>yana 2 ta slayd qo'sh: xavflar va xulosa</i>\n• <i>ruscha tarjima qil</i>\n\n"
                         "💬 <b>AI'ga oddiy yozsangiz ham bo'ldi</b> — u slaydlarni ko'rib turibdi va aytganingizni qiladi. "
                         "«Hammasini boshidan qil» yoki yangi mavzu yozsangiz — eski slayd yopilib, butunlay yangisi yaratiladi.\n\n"
                         "<i>Faqat kerakli slaydlar o'zgaradi. Yoki «🚀 Muharrirdan» o'zingiz tahrirlang — shu slaydning o'zi ochiladi.</i>", kb_edit(st))
    elif data == "theme":
        if st.get("deck"):
            await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup=kb_themes())
    elif data == "back":
        if not st.get("deck") and not await _restore_deck(cid):
            await _send(cid, "Slayd topilmadi.", kb_start())
            return
        st["ui"] = None
        await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup={"inline_keyboard": []})
        await _send(cid, _card_text(st["deck"], "✅"), kb_done(st))
    elif data.startswith("th:"):
        name = data[3:]
        if st.get("deck") and decks and name in decks.THEMES:
            st["deck"]["theme"] = name
            if st.get("deck_id"):
                await asyncio.to_thread(_deck_update_sync, st["deck_id"], cid, st["deck"])
            await tg("editMessageReplyMarkup", chat_id=cid, message_id=mid, reply_markup=kb_edit(st))
            await _send(cid, _card_text(st["deck"], "🎨", f"Rang: <b>{esc(decks.THEMES[name]['label'])}</b> (bepul)"), kb_done(st))
    elif data == "new":
        await _menu_action(cid, user, "new")


NEW_SYSTEM = """You are Slide Studio AI inside a Telegram bot. The user is in "new slide" mode. Return ONLY one JSON object (json), no markdown fences.
Decide what the message is:
1) The user wants a presentation / names a topic to make slides about  -> {"intent":"slides","topic":"the request, cleaned, in the user's language","count":N or 0}
2) A question, greeting or small talk that does NOT ask for slides      -> {"intent":"chat","reply":"helpful answer in the user's language, plain text, max 6 sentences"}
Questions (who / what / why / how / "?") are "chat" unless they ask to make slides. A bare noun phrase topic ("Solar energy") is "slides".
If the user asks about their balance / pages / limit, answer as "chat" using the [ACCOUNT] data (exact numbers). If they ask for more slides than the balance allows, set "count" to what the balance allows.
Reply in the user's language (Uzbek by default). No markdown, no emoji."""
SLIDE_WORD_RE = re.compile(r"slayd|slaid|slide|taqdimot|prezentatsi|presentation|презентац|слайд|powerpoint|pptx", re.I)


async def _run_new(chat_id: int, user: dict, text: str) -> None:
    """«🎨 Yangi slayd» rejimi: AI o'zi hal qiladi — slayd yasaydi yoki oddiy savolga javob beradi (varaq sarflanmaydi)."""
    st = _state(chat_id)
    if SLIDE_WORD_RE.search(text) or _parse_count(text):
        await _run_generate(chat_id, user, text, _parse_count(text) or DEFAULT_SLIDES)
        return
    if _overloaded():
        await _send(chat_id, BUSY_TEXT)
        return
    st["busy"] = True
    go_topic, go_n = "", 0
    try:
        uid, email = await _ensure_uid(user)
        usage = await asyncio.to_thread(_usage_now_sync, uid, email)
        if usage.get("blocked"):
            await _send(chat_id, "⛔ Akkauntingiz bloklangan.")
            return
        if _deps["total_credits"](usage) < _deps["MODES"]["fast"]["chat"]:
            await _send(chat_id, *_no_credit_reply("fast", usage))
            return
        await tg("sendChatAction", chat_id=chat_id, action="typing")
        async with _AiSlot():
            data, tokens = await _ai_json(NEW_SYSTEM, text + _account_context(usage, email, user), "fast")
        data = data if isinstance(data, dict) else {}
        intent = str(data.get("intent") or "").lower()
        if intent == "chat" and decks.clean(data.get("reply"), 900):
            await _charge(uid, email, 0, tokens, "fast", {"src": "telegram", "kind": "chat"})
            await _send(chat_id, f"💬 {esc(decks.clean(data.get('reply'), 900))}\n\n<i>Slayd kerak bo'lsa — mavzuni yozing.</i>")
            return
        go_topic = decks.clean(data.get("topic"), 1500) if intent == "slides" else ""
        go_topic = go_topic or text
        try:
            go_n = int(data.get("count") or 0)
        except Exception:
            go_n = 0
        go_n = max(MIN_SLIDES, min(MAX_SLIDES, go_n)) if go_n else (_parse_count(go_topic) or DEFAULT_SLIDES)
    except asyncio.TimeoutError:
        await _send(chat_id, "⌛ AI juda uzoq o'ylandi. Hech narsa yechilmadi — qayta yozing.")
        return
    except RuntimeError as e:
        await _send(chat_id, "⚙️ AI xizmati hozircha sozlanmagan." if "ai_not_configured" in str(e) else "⚙️ Akkauntni ochib bo'lmadi. Birozdan keyin urinib ko'ring.")
        return
    except Exception as e:
        _warn("new", f"yangi rejim xatosi: {type(e).__name__}: {str(e)[:140]}")
        go_topic, go_n = text, (_parse_count(text) or DEFAULT_SLIDES)       # AI javobi tushunarsiz — mavzu deb olamiz
    finally:
        st["busy"] = False
    if go_topic:
        await _run_generate(chat_id, user, go_topic, go_n)


CHAT_SYSTEM = ("You are Slide Studio AI, a friendly and concise assistant inside a Telegram bot that makes presentations. "
               "Answer the user's question or message helpfully in the SAME language the user writes (Uzbek by default), max 6 short sentences, plain text, no markdown. "
               "If the user asks about their balance, pages or limit, answer with the exact numbers from [ACCOUNT]. "
               "Do NOT create or edit slides. Return ONLY one JSON object: {\"reply\":\"your answer\"}")


async def _run_chat(chat_id: int, user: dict, text: str) -> None:
    """Oddiy savol-javob: slaydga tegmaydi (faqat chat narxi yechiladi)."""
    st = _state(chat_id)
    st["busy"] = True
    msg_id: Optional[int] = None
    try:
        mode = st.get("mode", "fast")
        # v52: «O'ylayapman…» darhol yuboriladi va akkaunt/balans tekshiruvi PARALLEL ketadi (avval ketma-ket kutilardi)
        sent_task = asyncio.create_task(_send(chat_id, "💬 <i>O'ylayapman…</i>"))
        _spawn(tg("sendChatAction", chat_id=chat_id, action="typing"))
        try:
            uid, email = await _ensure_uid(user)
            usage = await asyncio.to_thread(_usage_now_sync, uid, email)
        except Exception:
            sent = await sent_task
            msg_id = (sent or {}).get("message_id") if isinstance(sent, dict) else None
            raise
        sent = await sent_task
        msg_id = (sent or {}).get("message_id") if isinstance(sent, dict) else None
        if usage.get("blocked"):
            await _edit(chat_id, msg_id, "⛔ Akkauntingiz bloklangan.")
            return
        if _deps["total_credits"](usage) < _deps["MODES"][mode]["chat"]:
            await _edit(chat_id, msg_id, *_no_credit_reply(mode, usage))
            return
        async with _gen_sem:
            data, tokens = await _ai_json(CHAT_SYSTEM, text[:1500] + _account_context(usage, email, user), mode)
        usage2, _ch = await _charge(uid, email, 0, tokens, mode, {"src": "telegram", "kind": "chat"})
        reply = decks.clean((data or {}).get("reply") if isinstance(data, dict) else "", 1500) or "Tushunmadim, qayta yozing."
        await _edit(chat_id, msg_id, f"💬 {esc(reply)}{_balance_footer(usage2, mode, email, user)}", kb_start())
    except asyncio.TimeoutError:
        await _edit(chat_id, msg_id, "⌛ AI juda uzoq o'ylandi. Qayta urinib ko'ring.")
    except RuntimeError as e:
        await _edit(chat_id, msg_id, "⚙️ AI xizmati hozircha sozlanmagan." if "ai_not_configured" in str(e) else "⚙️ Akkauntni ochib bo'lmadi. Birozdan keyin urinib ko'ring.")
    except Exception as e:
        _warn("chat", f"chat xatosi: {type(e).__name__}: {str(e)[:120]}")
        await _edit(chat_id, msg_id, "⚠️ Xatolik yuz berdi. Hech narsa yechilmadi.")
    finally:
        st["busy"] = False


async def _handle_text(chat_id: int, user: dict, text: str) -> None:
    st = _state(chat_id)
    act = MENU.get(text.strip())
    if act:
        await _menu_action(chat_id, user, act)
        return
    if st.get("busy"):
        await _send(chat_id, "⏳ Oldingi so'rov hali bajarilmoqda — biroz kuting.")
        return
    ui = st.get("ui")
    if ui not in ("new", "edit"):
        if GREETING_RE.match(text):
            await _send_welcome(chat_id, user)
            return
        if not await _google_ok(chat_id, user):
            return
        # v64: tugma bosilmasa ham topshiriq bajariladi — AI o'zi hal qiladi: slayd so'ralgan bo'lsa YANGI slayd yaratadi,
        # oddiy savol bo'lsa javob beradi. Bosh menyuda AI eski slaydni KO'RMAYDI: eski/hozirgi slaydni o'zgartirish
        # faqat «✏️ Tahrirlash» bosilgandan keyin (shunda AI slaydni ko'rib turadi).
        _spawn(_run_new(chat_id, user, " ".join(text.split())[:1500]))
        return
    if not await _google_ok(chat_id, user):                # Google ulanmagan bo'lsa slayd yaratilmaydi / tahrirlanmaydi
        return
    if ui == "edit":
        if st.get("deck") or await _restore_deck(chat_id):
            _spawn(_run_edit(chat_id, user, text[:1500]))
        else:
            st["ui"] = None
            await _send(chat_id, "Slayd topilmadi. «🎨 Yangi slayd» ni bosing.", kb_start())
        return
    _spawn(_run_new(chat_id, user, " ".join(text.split())[:1500]))


def _balance_footer(usage: Optional[dict], mode: str, email: str, user: dict) -> str:
    """v54: har AI javobi ostida qolgan balans (foydalanuvchi oddiy yozganda ham balansini ko'radi)."""
    try:
        if not usage or (email == _tg_email(int(user["id"])) and not _is_admin(user)):
            return ""                                   # Google ulanmagan — balans umuman ko'rsatilmaydi
        if usage.get("unlimited") or _deps["total_credits"](usage) >= 10 ** 8:
            return "\n\n<i>♾ Varaqlar: cheksiz</i>"
        return f"\n\n<i>💳 Qoldi: {_fmt_pages(_pages_left(usage, mode))} varaq</i>"
    except Exception:
        return ""


def _account_context(usage: Optional[dict], email: str, user: dict) -> str:
    """v55: AI foydalanuvchi balansini BILSIN («balansim qancha?» / ko'p slayd so'rasa — yetadiganini aytadi)."""
    try:
        if not usage:
            return ""
        if email == _tg_email(int(user["id"])) and not _is_admin(user):
            return ("\n\n[ACCOUNT] Google account NOT linked yet — the balance is hidden. If the user asks about balance, tell them to "
                    "press «⚙️ Sozlamalar» → «Google ulash» first.")
        if usage.get("unlimited") or _deps["total_credits"](usage) >= 10 ** 8:
            return "\n\n[ACCOUNT] Balance: UNLIMITED pages."
        fast, deep = _pages_left(usage, "fast"), _pages_left(usage, "deep")
        p = _deps["usage_payload"](usage)
        wait = _fmt_wait(p.get("next_reset_in_seconds")) if p.get("window_started") else ""
        daily = ((p.get("modes") or {}).get("fast") or {}).get("free_daily_pages", 0)
        return (f"\n\n[ACCOUNT — real data, use it] Balance: {_fmt_pages(fast)} pages in Fast AI mode "
                f"(= {_fmt_pages(deep)} pages in Deep AI mode). 1 slide costs 1 page (Deep AI: {_deep_mult()} pages). "
                f"Free daily pages: {daily}" + (f", next free refill in {wait}" if wait else "") + ". "
                "Extra pages: «💳 Balans» → «Varaq sotib olish». Never offer more slides than the balance allows.")
    except Exception:
        return ""


async def _late_balance(chat_id: int, user: dict) -> None:
    """v54: baza sekin javob bersa (Render uyg'onishi) salomlashuvda balans yo'qolib qolardi — fonda olib, alohida yuboriladi."""
    try:
        info = await asyncio.wait_for(_balance_info(user), timeout=25)
    except Exception:
        info = None
    if info and not info.get("locked"):
        await _send(chat_id, f"💳 <b>Balans</b>\n{_balance_block(info)}")
    elif info and not _is_admin(user):
        await _send(chat_id, LINK_FIRST, {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})
    elif not info:
        await _send(chat_id, "⚠️ Balansni hozir o'qib bo'lmadi. «💳 Balans» tugmasini bosib qayta urinib ko'ring.")


async def _send_welcome(chat_id: int, user: dict) -> None:
    try:
        info = await asyncio.wait_for(_balance_info(user), timeout=6)
    except Exception:
        info = None
    _state(chat_id)["ui"] = None
    await _send(chat_id, _welcome_text(user.get("first_name") or "", info), kb_reply())
    if info is None:
        _spawn(_late_balance(chat_id, user))
    if info and not info.get("linked") and not _is_admin(user):
        await _send(chat_id, "🔗 Slayd yaratish uchun avval <b>Google akkauntni ulang</b>.", {"inline_keyboard": [[_btn("🔗 Google ulash", "linkinfo")]]})


async def handle_update(data: dict) -> None:
    cb = data.get("callback_query")
    if cb:
        await _handle_callback(cb)
        return

    msg = data.get("message")
    if not msg:
        return
    chat = msg.get("chat") or {}
    if chat.get("type") != "private":          # guruh/kanalda jim turamiz
        return
    chat_id = chat.get("id")
    user = msg.get("from") or {}
    if not isinstance(chat_id, int) or user.get("is_bot") or not isinstance(user.get("id"), int):
        return
    if _limited(chat_id):
        return

    if _is_admin(user):
        _ast = _state(chat_id)
        if not (_ast.get("adm") or {}).get("await"):
            _d = _adm_disk_load(chat_id)         # qayta ishga tushgan bo'lsa — qoralama diskdan tiklanadi
            if _d and _d.get("await"):
                _ast["adm"] = _d
        if (_ast.get("adm") or {}).get("await") and await _admin_input(chat_id, user, msg, _ast):
            return

    incoming = _incoming_file(msg)
    if incoming:
        if _state(chat_id).get("busy"):
            await _send(chat_id, "⏳ Oldingi so'rov hali bajarilmoqda — biroz kuting.")
        else:
            _spawn(_run_file(chat_id, user, *incoming))
        return

    text = (msg.get("text") or "").strip()
    if not text:
        await _send(chat_id, "Mavzuni <b>matn</b> ko'rinishida yozib yuboring, masalan: <i>«Sun'iy intellekt kelajagi»</i>.\nRasm yoki fayl yuborsangiz — muharrirda ochib beraman.", kb_reply())
        return

    if text.startswith("/"):
        parts = text.split(maxsplit=1)
        cmd = parts[0].split("@")[0].lower()
        arg = parts[1].strip() if len(parts) > 1 else ""
        st = _state(chat_id)
        if cmd == "/start":
            st["ui"] = None
            if arg.lower().startswith("link_"):               # saytdagi «Telegram» tugmasidan: t.me/bot?start=link_KOD
                await _do_link(chat_id, user, arg[5:])
            elif arg.lower().startswith("ref_"):              # do'st havolasi: t.me/bot?start=ref_KOD
                await _handle_ref_start(chat_id, user, arg[4:])
            await _send_welcome(chat_id, user)
        elif cmd == "/help":
            await _send(chat_id, HELP, kb_reply())
        elif cmd == "/new":
            await _menu_action(chat_id, user, "new")
        elif cmd in ("/my", "/slides"):
            await _show_my(chat_id)
        elif cmd in ("/clear", "/tozalash"):
            await _ask_clear(chat_id)
        elif cmd == "/mode":
            st["mode"] = "deep" if st.get("mode") != "deep" else "fast"
            await _send(chat_id, f"Rejim: <b>{'🧠 Chuqur AI' if st['mode'] == 'deep' else '⚡ Tez AI'}</b>\n"
                                 f"<i>{f'Murakkab mavzular uchun, 1 slayd = {_deep_mult()} Tez-varaq, sekinroq.' if st['mode'] == 'deep' else 'Tez va tejamkor: 1 slayd = 1 varaq.'}</i>")
        elif cmd in ("/credits", "/kredit", "/kreditlar", "/balance", "/balans"):
            await _show_balance(chat_id, user)
        elif cmd in ("/invite", "/taklif", "/referral"):
            await _show_invite(chat_id, user)
        elif cmd == "/buy":
            await _do_buy(chat_id, user, "pack")
        elif cmd == "/pro":
            await _show_balance(chat_id, user)
        elif cmd == "/id":
            await _send(chat_id, f"🆔 Sizning Telegram ID: <code>{int(user['id'])}</code>")
        elif cmd in ADMIN_CMDS or cmd == "/admin":
            await _admin_command(chat_id, user, cmd, arg)
        elif cmd == "/link":
            if arg:
                await _do_link(chat_id, user, arg)
            else:
                await _link_help(chat_id)
        elif cmd == "/unlink":
            ok = await asyncio.to_thread(_unlink_sync, user["id"])
            await _send(chat_id, "🔓 Sayt akkaunti uzildi. Bot endi o'zining Telegram akkauntidan foydalanadi." if ok else "⚙️ Hozir bajarib bo'lmadi.")
        elif cmd == "/site":
            await _menu_action(chat_id, user, "site")
        elif cmd in ("/settings", "/sozlamalar"):
            await _menu_action(chat_id, user, "set")
        elif cmd in ("/about", "/bot"):
            await _menu_action(chat_id, user, "about")
        else:
            await _send(chat_id, "Bunday buyruq mavjud emas.", kb_reply())
        return

    if re.fullmatch(r"(?i)\s*admin(\s*panel)?\s*[!.]?\s*", text):          # «admin» — faqat haqiqiy adminga menyu ochiladi
        if _is_admin(user):
            await _admin_command(chat_id, user, "/admin", "")
            return
        # admin bo'lmasa — oddiy matn sifatida davom etadi (hech narsa oshkor bo'lmaydi)
    await _handle_text(chat_id, user, text)


async def _warm_account(user: dict) -> None:
    try:
        await _ensure_uid(user)
    except Exception as e:
        _warn("warm", f"akkaunt tayyorlanmadi: {str(e)[:120]}")


async def _safe_handle(data: dict) -> None:
    try:
        await asyncio.wait_for(handle_update(data), timeout=60)
    except asyncio.TimeoutError:
        _warn("timeout", "update ishlovi vaqtdan oshdi")
    except Exception as e:
        _warn("handle", f"update xatosi: {type(e).__name__}: {str(e)[:150]}")


@router.post(WEBHOOK_PATH)
async def telegram_webhook(request: Request, background: BackgroundTasks):
    if not ENABLED:
        raise HTTPException(404)
    got = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not hmac.compare_digest(got.encode(), SECRET.encode()):
        raise HTTPException(403)
    try:
        data = await request.json()
    except Exception:
        return {"ok": True}
    if not isinstance(data, dict) or _is_dup(data.get("update_id")):
        return {"ok": True}
    background.add_task(_safe_handle, data)      # darhol 200 — Telegram qayta yubormaydi
    return {"ok": True}


@router.get("/api/telegram/status")
async def telegram_status():
    """Diagnostika: bot yoqilganmi, webhook to'g'ri o'rnatilganmi (maxfiy ma'lumotsiz)."""
    if not ENABLED:
        return {"enabled": False, "hint": "TELEGRAM_BOT_TOKEN yo'q yoki noto'g'ri (format: 123456:ABC...)"}
    info = await tg("getWebhookInfo") or {}
    want = f"{SITE_URL}{WEBHOOK_PATH}"
    return {
        "enabled": True, "mode": _mode_now, "webhook_ok": info.get("url") == want, "webhook_url_set": bool(info.get("url")),
        "pending": info.get("pending_update_count"), "last_error": str(info.get("last_error_message") or "")[:120] or None,
        "site_url": SITE_URL, "decks": decks is not None,
    }


# ----------------------------------------------------------------------------------------------
# Mini App: Telegram orqali kirish (initData tekshiruvi + Supabase sessiyasi)
# ----------------------------------------------------------------------------------------------
def verify_init_data(init_data: str, max_age: int = 86400) -> Optional[dict]:
    """Telegram WebApp initData imzosini tekshiradi. To'g'ri bo'lsa user dict, aks holda None."""
    try:
        if not init_data or len(init_data) > 4096:
            return None
        pairs = dict(parse_qsl(init_data, keep_blank_values=True))
        got = pairs.pop("hash", "")
        if not got:
            return None
        check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
        secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
        calc = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, got):
            return None
        age = time.time() - int(pairs.get("auth_date", "0"))
        if age > max_age or age < -300:
            return None
        user = json.loads(pairs.get("user", "{}"))
        if not isinstance(user, dict) or not isinstance(user.get("id"), int):
            return None
        return user
    except Exception:
        return None


def _login_sync(user: dict) -> dict:
    """Mini App kirishi. Telegram sayt akkauntiga ulangan bo'lsa — SHU akkaunt sessiyasi (balans bir xil)."""
    tid = int(user["id"])
    linked = _linked_sync(tid)
    if linked:
        _uid, email = linked
        try:
            link = _sb().auth.admin.generate_link({"type": "magiclink", "email": email})
            hashed = getattr(getattr(link, "properties", None), "hashed_token", None)
            if hashed:
                return {"token_hash": hashed, "type": "magiclink", "email": email, "name": ""}
        except Exception as e:
            _warn("login-linked", f"ulangan akkaunt bilan kirib bo'lmadi, Telegram akkauntiga o'tildi: {str(e)[:120]}")
    r = _provision_sync(user)
    if r.get("error"):
        return {"error": r["error"]}
    if not r.get("hashed"):
        return {"error": "auth_unavailable"}
    return {"token_hash": r["hashed"], "type": "magiclink", "email": r["email"], "name": r["name"]}


async def _web_user(request: Request) -> Optional[Tuple[str, str]]:
    """Sayt sessiyasi (Supabase access token) -> (user_id, email) yoki None."""
    try:
        body = await request.json()
    except Exception:
        return None
    token = str((body or {}).get("token") or "").strip()
    sb = _sb()
    if not token or token == "dev-token" or not sb:
        return None
    try:
        res = await asyncio.to_thread(sb.auth.get_user, token)
        if res and res.user:
            return str(res.user.id), str(res.user.email or "")
    except Exception:
        pass
    return None


@router.post("/api/telegram/link-code")
async def telegram_link_code(request: Request):
    """Saytdagi «✈️ Telegram» tugmasi: bir martalik kod (10 daqiqa) + botni ochish havolasi."""
    if not ENABLED:
        return JSONResponse({"error": "telegram_disabled"}, status_code=503)
    me = await _web_user(request)
    if not me or not me[1]:
        return JSONResponse({"error": "login_required"}, status_code=401)
    if me[1].endswith("@" + TG_EMAIL_DOMAIN):
        return JSONResponse({"error": "already_telegram"}, status_code=400)
    try:
        code = await asyncio.to_thread(_link_code_sync, me[0], me[1])
    except Exception as e:
        _db_warn(e)
        return JSONResponse({"error": "db_not_ready"}, status_code=503)
    uname = await _bot_username()
    return JSONResponse({"code": code, "bot": uname, "expires_in": LINK_TTL,
                         "url": f"https://t.me/{uname}?start=link_{code}" if uname else ""}, headers={"Cache-Control": "no-store"})


@router.post("/api/telegram/link-status")
async def telegram_link_status(request: Request):
    if not ENABLED:
        return JSONResponse({"linked": False, "enabled": False})
    me = await _web_user(request)
    if not me:
        return JSONResponse({"error": "login_required"}, status_code=401)
    linked = False
    try:
        sb = _sb()
        r = await asyncio.to_thread(lambda: sb.table("tg_links").select("tg_id").eq("user_id", me[0]).limit(1).execute())
        linked = bool(r.data)
    except Exception:
        pass
    return JSONResponse({"linked": linked, "enabled": True}, headers={"Cache-Control": "no-store"})


@router.post("/api/telegram/unlink")
async def telegram_unlink_web(request: Request):
    """v61: saytdan (Google akkaunt) Telegram botni UZISH. Balanslar ajraladi — bot o'z (Telegram) akkauntiga qaytadi."""
    if not ENABLED:
        return JSONResponse({"error": "telegram_disabled"}, status_code=503)
    me = await _web_user(request)
    if not me:
        return JSONResponse({"error": "login_required"}, status_code=401)
    try:
        sb = _sb()
        r = await asyncio.to_thread(lambda: sb.table("tg_links").select("tg_id").eq("user_id", me[0]).execute())
        tids = [int(x["tg_id"]) for x in (r.data or []) if x.get("tg_id") is not None]
    except Exception as e:
        _db_warn(e)
        return JSONResponse({"error": "db_not_ready"}, status_code=503)
    for tid in tids:
        if await asyncio.to_thread(_unlink_sync, tid):
            try:
                await _send(tid, "🔌 Sayt akkauntingiz (Google) bu Telegram'dan <b>uzildi</b>. Qayta ulash: /link")
            except Exception:
                pass
    return JSONResponse({"ok": True, "unlinked": len(tids)}, headers={"Cache-Control": "no-store"})


@router.post("/api/telegram/miniapp-link")
async def telegram_miniapp_link(request: Request):
    """v61: Mini App ichida Google akkaunt holati: action = status | link | unlink (init_data bilan tasdiqlanadi)."""
    if not ENABLED:
        return JSONResponse({"error": "telegram_disabled"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        body = {}
    user = verify_init_data(str((body or {}).get("init_data") or ""))
    if not user:
        return JSONResponse({"error": "invalid_init_data"}, status_code=401)
    tid = int(user["id"])
    action = str((body or {}).get("action") or "status")
    if action == "link":
        return JSONResponse({"url": f"{SITE_URL}/?tglink={_make_token('L', tid, 0, 600)}"}, headers={"Cache-Control": "no-store"})
    if action == "unlink":
        ok = await asyncio.to_thread(_unlink_sync, tid)
        return JSONResponse({"ok": bool(ok)} if ok else {"error": "db"}, status_code=200 if ok else 503)
    try:
        linked = await asyncio.to_thread(_linked_sync, tid)
    except Exception:
        linked = None
    return JSONResponse({"linked": bool(linked), "email": _mask_email(linked[1]) if linked else ""},
                        headers={"Cache-Control": "no-store"})


_used_links: "OrderedDict[str, float]" = OrderedDict()


@router.post("/api/telegram/link-complete")
async def telegram_link_complete(request: Request):
    """Botdagi «Saytda ulash» havolasi (?tglink=TOKEN): sayt Google bilan kirgach shu yerga murojaat qiladi — ulash o'zi tugaydi."""
    if not ENABLED:
        return JSONResponse({"error": "telegram_disabled"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        body = {}
    key = str((body or {}).get("link") or "")
    ids = _check_token("L", key)
    if not ids:
        return JSONResponse({"error": "expired"}, status_code=410)
    if key in _used_links:
        return JSONResponse({"error": "used"}, status_code=409)
    me = await _web_user(request)
    if not me or not me[1]:
        return JSONResponse({"error": "login_required"}, status_code=401)
    if me[1].endswith("@" + TG_EMAIL_DOMAIN):
        return JSONResponse({"error": "already_telegram"}, status_code=400)
    if key in _used_links:                    # _web_user kutilgan paytda parallel so'rov ishlatib qo'ygan bo'lishi mumkin
        return JSONResponse({"error": "used"}, status_code=409)
    _used_links[key] = time.time()            # ishlatishdan OLDIN band qilinadi — bir havola ikki marta ishlamaydi
    while len(_used_links) > 500:
        _used_links.popitem(last=False)
    res = await _link_apply(ids[0], me[0], me[1])
    if not res.get("ok"):
        _used_links.pop(key, None)            # xato bo'lsa qayta urinish mumkin
        return JSONResponse({"error": res.get("error") or "link_failed"}, status_code=503)
    await _send(ids[0], _linked_text(res), kb_main())
    return JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})


@router.get("/api/telegram/file")
async def telegram_file(t: str = ""):
    """Botga yuborilgan faylni (RAM'da, 15 daqiqa) muharrirga beradi. Havola imzolangan va faqat shu chatga tegishli."""
    if not ENABLED:
        return JSONResponse({"error": "disabled"}, status_code=503)
    ids = _check_token("F", t)
    f = _files.get(ids[1]) if ids else None
    if not ids or not f or f["cid"] != ids[0] or f["exp"] < time.time():
        return JSONResponse({"error": "expired"}, status_code=410)
    return Response(content=f["data"], media_type="application/octet-stream",
                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-File-Name": quote(f["name"])})


def _stream_response(name: str, stream: "io.BytesIO", mime: str, size: int, inline: bool = True) -> StreamingResponse:
    """RAM'dagi BytesIO ni 64 KB bo'laklarda oqim qilib beradi (Content-Length bilan). Yuborish tugagach BytesIO yopiladi
    (Starlette uni fon vazifasi sifatida chaqiradi) — fayl hech qayerda saqlanmaydi."""
    def gen():
        try:
            while True:
                chunk = stream.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            try:
                stream.close()
            except Exception:
                pass
    disp = "inline" if inline else "attachment"
    return StreamingResponse(
        gen(), media_type=mime.split(";")[0],
        headers={"Cache-Control": "no-store", "Content-Length": str(size), "X-Content-Type-Options": "nosniff",
                 "Content-Disposition": f"{disp}; filename=\"slayd.{name.rsplit('.', 1)[-1]}\"; filename*=UTF-8''{quote(name)}"},
    )


@router.get("/api/telegram/deck-file")
async def telegram_deck_file(t: str = "", fmt: str = "pptx"):
    """Botdagi «Muharrirda ochish»: slaydni bazadagi qisqa JSON'dan RAM'da PPTX qilib beradi (diskka/Supabase'ga yozilmaydi);
    sayt uni editorga o'zi import qiladi. v53: keshlangan + oqim (StreamingResponse): bot oldindan tayyorlagan fayl bo'lsa — darhol."""
    if not ENABLED or decks is None:
        return JSONResponse({"error": "disabled"}, status_code=503)
    if fmt not in ("pptx", "pdf", "html"):
        fmt = "pptx"
    ids = _check_token("D", t)
    if not ids:
        return JSONResponse({"error": "expired"}, status_code=410)
    deck_id, tid = ids
    row = await asyncio.to_thread(_deck_get_sync, tid, deck_id)
    deck = decks.normalize_deck(row.get("deck"), MAX_SLIDES + 10, row.get("title") or "") if row else None
    if not deck:
        return JSONResponse({"error": "not_found"}, status_code=404)
    lang = row.get("lang") or "uz"
    hit = decks.cache_peek(deck, lang, fmt)
    if hit:
        name, data, mime = hit
        return _stream_response(name, io.BytesIO(data), mime, len(data))
    async with _gen_sem:
        imgs = await _fetch_images(deck, (_state(tid).get("imgs") or {}), True)
        name, stream, mime, size = await asyncio.to_thread(decks.export_stream, deck, _img_index(deck, imgs), fmt, lang)
    imgs = None
    return _stream_response(name, stream, mime, size)


@router.post("/api/telegram/auth")
async def telegram_auth(request: Request):
    if not ENABLED:
        return JSONResponse({"error": "telegram_disabled"}, status_code=503)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "bad_request"}, status_code=400)
    user = verify_init_data(str((body or {}).get("init_data") or ""))
    if not user:
        return JSONResponse({"error": "invalid_init_data"}, status_code=401)
    try:
        res = await asyncio.to_thread(_login_sync, user)
    except Exception as e:
        _warn("login", f"login xatosi: {type(e).__name__}: {str(e)[:150]}")
        return JSONResponse({"error": "login_failed"}, status_code=502)
    if res.get("error"):
        return JSONResponse(res, status_code=409 if res["error"] == "account_conflict" else 503)
    return JSONResponse(res, headers={"Cache-Control": "no-store"})


# ----------------------------------------------------------------------------------------------
# Ulanish: webhook (+ nazorat) yoki long-polling (zaxira)
# ----------------------------------------------------------------------------------------------
_mode_now = "off"
ALLOWED = ["message", "callback_query"]


async def _set_commands() -> None:
    await tg("setMyCommands", commands=[
        {"command": "start", "description": "Bosh menyu"},
        {"command": "new", "description": "Yangi slayd yaratish"},
        {"command": "my", "description": "Slaydlarim"},
        {"command": "clear", "description": "Slaydlarimni tozalash"},
        {"command": "credits", "description": "Balans"},
        {"command": "invite", "description": "Do'st taklif qilish (+15 varaq)"},
        {"command": "link", "description": "Google akkauntni ulash"},
        {"command": "settings", "description": "Sozlamalar"},
        {"command": "mode", "description": "Tez ⚡ / Chuqur 🧠 AI"},
        {"command": "help", "description": "Yordam"},
    ])
    await tg("setChatMenuButton", menu_button={"type": "web_app", "text": "🚀 Muharrir", "web_app": {"url": _app_url()}})


async def _register_webhook(attempts: int = 4) -> bool:
    if not SITE_URL.startswith("https://") or "localhost" in SITE_URL or "127.0.0.1" in SITE_URL:
        _warn("https", "PUBLIC_BASE_URL https:// bo'lishi kerak — webhook o'rnatilmadi")
        return False
    url = f"{SITE_URL}{WEBHOOK_PATH}"
    for attempt in range(attempts):
        ok = await tg("setWebhook", url=url, secret_token=SECRET, max_connections=20, allowed_updates=ALLOWED)
        if ok:
            await _set_commands()
            print(f"[TG] bot tayyor — webhook: {url}")
            return True
        await asyncio.sleep(2 * (attempt + 1))
    return False


async def _poll_loop() -> None:
    """Webhook o'rnatilmasa ham bot javob bersin: getUpdates (long-polling)."""
    global _mode_now
    await tg("deleteWebhook", drop_pending_updates=False)
    await _set_commands()
    _mode_now = "polling"
    print("[TG] bot tayyor — long-polling rejimi")
    offset = 0
    while True:
        try:
            r = await _http().post(f"{API}/getUpdates", json={"offset": offset, "timeout": 25, "allowed_updates": ALLOWED},
                                   timeout=httpx.Timeout(40.0, connect=8.0))
            j = r.json()
            if not j.get("ok"):
                _warn("poll", f"getUpdates: {str(j.get('description'))[:120]}")
                await asyncio.sleep(5)
                continue
            for upd in j.get("result") or []:
                offset = max(offset, int(upd.get("update_id", 0)) + 1)
                if isinstance(upd, dict) and not _is_dup(upd.get("update_id")):
                    _spawn(_safe_handle(upd))
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _warn("poll-net", f"polling xatosi: {type(e).__name__}")
            await asyncio.sleep(4)


async def _watchdog() -> None:
    """Har 10 daqiqada webhook hali o'rnatilganini tekshiradi; yo'qolgan bo'lsa qayta o'rnatadi."""
    want = f"{SITE_URL}{WEBHOOK_PATH}"
    while True:
        await asyncio.sleep(600)
        try:
            info = await tg("getWebhookInfo") or {}
            if info.get("url") != want:
                _warn("wd", "webhook yo'qolgan — qayta o'rnatilmoqda")
                await _register_webhook(2)
            elif info.get("last_error_message"):
                _warn("wd-err", f"webhook xatosi: {str(info.get('last_error_message'))[:120]}")
        except Exception as e:
            _warn("wd-ex", f"watchdog: {str(e)[:100]}")


async def _bootstrap() -> None:
    global _mode_now
    if MODE == "polling" or (MODE == "auto" and not _env("PUBLIC_BASE_URL")):
        # PUBLIC_BASE_URL yo'q (masalan, lokal kompyuter) — webhook Render'ning webhookini buzmasligi uchun polling
        await _poll_loop()
        return
    ok = await _register_webhook()
    if ok:
        _mode_now = "webhook"
        t = asyncio.create_task(_watchdog())
        _bg.add(t)
        t.add_done_callback(_bg.discard)
        return
    if MODE == "webhook":
        _warn("webhook", "setWebhook bajarilmadi — TELEGRAM_BOT_TOKEN va PUBLIC_BASE_URL ni tekshiring")
        return
    _warn("fallback", "webhook o'rnatilmadi -> long-polling rejimiga o'tildi")
    await _poll_loop()


async def startup() -> None:
    if not ENABLED:
        print("[TG] TELEGRAM_BOT_TOKEN yo'q yoki noto'g'ri — bot o'chiq")
        return
    if decks is None:
        print("[TG] ⚠️ tg_decks yuklanmadi — bot slayd yarata olmaydi (requirements.txt o'rnatilganmi?)")
    t = asyncio.create_task(_bootstrap())          # startni bloklamaydi
    _bg.add(t)
    t.add_done_callback(_bg.discard)
    _ad_sweeper_start()                            # reklama/ko'rib chiqish xabarlarini tozalovchi (restartdan keyin ham)


async def shutdown() -> None:
    global _client
    for t in list(_bg):
        t.cancel()
    if _client is not None and not _client.is_closed:
        try:
            await _client.aclose()
        except Exception:
            pass
    _client = None
