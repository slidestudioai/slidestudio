import os
import sys
import json
import time
import asyncio
import base64
import signal
import threading
import secrets
from collections import OrderedDict
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timedelta, timezone
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Request
from starlette.websockets import WebSocketState

_RUNTIME_SECRET = secrets.token_hex(32)   # v52-fix: fallback HMAC kalit (barcha e'lonlardan oldin)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, Response, RedirectResponse
from fastapi.staticfiles import StaticFiles

try:
    from openai import OpenAI, AsyncOpenAI
except ImportError:
    print("[ERROR] openai paketi o'rnatilmagan: pip install openai")
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = None

from backend.media_search import search as media_search_impl, first_gif_url
from backend import appsettings, ads as ads_mod, admin_core      # v47: admin panel, reklama, sozlamalar

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(BASE_DIR, "config.json")
ENV_FILE = os.path.join(BASE_DIR, ".env")

try:
    from backend.monitoring import (
        calculate_page_cost_from_reply,
        calculate_page_cost,
        extract_actions_from_reply,
        plans_public,
        cost_for_action,
        normalize_user_row,
        apply_24h_reset,
        charge_for_ai_turn,
        usage_payload,
        add_paid_credits,
        remove_paid_credits,
        deduct_credits,
        total_credits,
        FREE_DAILY_PAGES,
        FREE_DAILY_UNITS,
        PACK_UNITS,
        UNIT,
        DEEP_MULT,
        MODES,
        can_afford,
        mode_for_model,
        PAGES_PER_PACK,
        CHECKOUT_PRICE_USD,
        plan_active, is_unlimited, is_ad_free,
        pack_pages, pack_units, free_daily_units, rt,
    )
except ImportError as _mon_err:
    print(f"[ERROR] backend/monitoring.py yuklanmadi: {_mon_err}")
    print("        'backend' papkasi (ichida __init__.py va monitoring.py) main.py yonida bo'lishi shart.")
    sys.exit(1)

def _load_dotenv():
    if not os.path.exists(ENV_FILE):
        return
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                k, _, v = line.partition("=")
                v = v.strip()
                if v[:1] in ('"', "'"):
                    q = v[0]
                    end = v.find(q, 1)
                    v = v[1:end] if end > 0 else v[1:]
                else:
                    v = v.split(" #", 1)[0].split("\t#", 1)[0].strip()
                    if v.startswith("#"):
                        v = ""
                k = k.strip()
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception:
        pass

_load_dotenv()

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

DEFAULT_CONFIG = {
    "supabase_url": "",
    "supabase_publishable_key": "",
    "supabase_secret_key": "",
    "google_client_id": "",
    "google_client_secret": "",
    "api_key": "",
    "model_name": "deepseek-chat",
    "available_models": ["deepseek-chat", "deepseek-reasoner"],
    "max_context_messages": 10,
    "daily_message_limit": 200,
    "default_slide_credits": 5,
    "deepseek_base_url": "https://api.deepseek.com",
}

AVAILABLE_MODELS = [
    {
        "value": "deepseek-chat",
        "public_id": "fast",
        "label": "Tez AI",
        "desc": "Tez javob — chat va slayd tahriri uchun",
        "input_price": 0.15,
        "output_price": 0.60,
    },
    {
        "value": "deepseek-reasoner",
        "public_id": "deep",
        "label": "Chuqur AI (2× varaq)",
        "desc": "Murakkab mantiq va chuqur tahlil",
        "input_price": 0.66,
        "output_price": 1.98,
    },
]

AVAILABLE_MODEL_VALUES = {m["value"] for m in AVAILABLE_MODELS}

# v37: brauzerga FAQAT neytral id lar ketadi (fast/deep). Haqiqiy model nomi serverda qoladi.
_PUBLIC_MODEL_MAP = {m["public_id"]: m["value"] for m in AVAILABLE_MODELS}
_PUBLIC_MODEL_MAP.update({"standard": "deepseek-chat", "reasoning": "deepseek-reasoner"})

def resolve_model(requested, fallback="deepseek-chat") -> str:
    r = str(requested or "").strip()
    if r in _PUBLIC_MODEL_MAP:
        return _PUBLIC_MODEL_MAP[r]
    if r in AVAILABLE_MODEL_VALUES:          # eski mijozlar (kesh) uchun moslik
        return r
    return fallback if fallback in AVAILABLE_MODEL_VALUES else "deepseek-chat"

def _internal_to_public(value: str) -> str:
    for mm in AVAILABLE_MODELS:
        if mm["value"] == value:
            return mm["public_id"]
    return "fast"

DEFAULT_PROMPT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "default_system_prompt.txt")

def _read_default_system_prompt() -> str:
    try:
        if os.path.exists(DEFAULT_PROMPT_FILE):
            with open(DEFAULT_PROMPT_FILE, "r", encoding="utf-8") as f:
                txt = f.read().strip()
            if txt:
                return txt
    except Exception as e:
        print(f"[PROMPT] Standart prompt o'qilmadi: {e}")
    return (
        "You are 'Slide Studio AI' — an expert presentation designer and Fabric.js "
        "canvas layout generator. Always answer with a SINGLE ```json code block "
        "containing {\"reply_text\": \"...\", \"actions\": [...]}. "
        "If the user only greets or asks a general question, return \"actions\": []. "
        "Slide size is 960x540. Use only supported actions."
    )

_prompt_cache = {"mtime": None, "text": ""}

def build_system_prompt() -> str:
    """v33: prompt HAR DOIM default_system_prompt.txt dan olinadi (fayl o'zgarsa avtomatik yangilanadi).
    Avval config.json dagi eski nusxa fayldan ustun edi — shu sabab prompt tahrirlari ishlamasdi.
    config.json["system_prompt"] faqat fayl topilmasa zaxira."""
    try:
        if os.path.exists(DEFAULT_PROMPT_FILE):
            mt = os.path.getmtime(DEFAULT_PROMPT_FILE)
            if _prompt_cache["mtime"] != mt or not _prompt_cache["text"]:
                with open(DEFAULT_PROMPT_FILE, "r", encoding="utf-8") as f:
                    txt = f.read().strip()
                if txt:
                    _prompt_cache["mtime"], _prompt_cache["text"] = mt, txt
            if _prompt_cache["text"]:
                return _prompt_cache["text"]
    except Exception as e:
        print(f"[PROMPT] fayl o'qilmadi, zaxira ishlatiladi: {e}")
    if config and str(config.get("system_prompt") or "").strip():
        return str(config["system_prompt"])
    return _read_default_system_prompt()

try:
    from backend.image_search import search_images as _search_images_sync
except Exception as _is_err:
    _search_images_sync = None
    print(f"[IMG-SEARCH] yuklanmadi: {_is_err}")

MAX_TOOL_ROUNDS = 4
MAX_SEARCHES_PER_TURN = 10

import re as _re
_DSML_RE = _re.compile(r"DSML|invoke\s+name|tool_call|function_calls", _re.I)
_NO_TOOLS_NOTE = ("\n\n[MUHIM — BU REJIMDA TOOL YO'Q]\nSizda hech qanday tool/funksiya yo'q: search_images, DSML, invoke, function_calls, tool_call YOZMANG va "
                  "«rasm qidiraman» deb va'da bermang. Rasmlar serverda oldindan topiladi: foydalanuvchi xabari oxiridagi [TAYYOR RASMLAR] bo'limidagi URL'lardan foydalaning. "
                  "U bo'lim bo'lmasa — rasm elementi qo'shmang. Javobni darhol yozing: qisqa PART A matn + bitta ```json blok.")
_NO_IMG_RE = _re.compile(r"rasmsiz|rasm\s*(?:kerak\s*emas|qo'?yma|siz)|without\s+images?|no\s+images?|без\s+(?:картин|изображ|фото)", _re.I)
_IMG_CTX_RE = _re.compile(r"slayd|slide|taqdimot|rasm|image|photo|foto|fon\b|banner|презент|слайд|изображ|картин", _re.I)
_IMG_INTENT_RE = _re.compile(r"rasm|surat|image|photo|picture|foto|fon\b|banner|illyustr|gif|video|изображ|картин|фото|"
                             r"(?:yarat|tuz|qil|qo'?sh|ochib\s*ber|tayyorla|generate|create|make|build|добав|созда)\w*\s+.{0,40}?(?:slayd|slide|taqdimot|prezentats|презент|слайд)|"
                             r"(?:slayd|slide|taqdimot|prezentats|презент|слайд)\w*\s+.{0,40}?(?:yarat|tuz|qo'?sh|tayyorla|generate|create|make|добав|созда)|"
                             r"mavzu\w*\s+(?:bo'?yicha|haqida|ustida)", _re.I)
_SMALLTALK_RE = _re.compile(r"^\s*(?:salom|assalom\w*|hi|hello|hey|rahmat|raxmat|ok|okay|yaxshi|nima\s+deding|nima\s+dedi\w*|tushund\w*|qalay\w*|thanks?|привет|спасибо)\W*$", _re.I)

def _wants_images(raw: str) -> bool:
    """Faqat foydalanuvchining O'Z matni asosida: salomlashuv/oddiy savolga rasm qidirilmaydi."""
    t = (raw or "").strip()
    if len(t) < 4 or _SMALLTALK_RE.match(t):
        return False
    return bool(_IMG_INTENT_RE.search(t))


_GIF_WANT_RE = _re.compile(r"\bgif|animats|animation|animated|анимац|гиф", _re.I)
_VIDEO_WANT_RE = _re.compile(r"\bvideo|видео|\bclip\b|klip", _re.I)


def _presearch_kind(text: str) -> str:
    """v54: Chuqur AI ham Tez AI kabi GIF / video qidira olsin — foydalanuvchi matnidan media turini aniqlaydi."""
    t = text or ""
    if _GIF_WANT_RE.search(t):
        return "gif"
    if _VIDEO_WANT_RE.search(t):
        return "video"
    return "photo"


async def _deep_presearch(client: Any, context: str, max_q: int = 3, websocket: Any = None, stats: Optional[dict] = None,
                          kind: str = "photo") -> str:
    """Chuqur AI (deepseek-reasoner) tool chaqira olmaydi — shuning uchun rasmlarni OLDINDAN topib, tayyor URL ro'yxatini beramiz.
    Kichik tez model inglizcha so'rovlarni yozadi, qidiruv parallel ishlaydi. Xatoda bo'sh matn (oqim buzilmaydi)."""
    if not _search_images_sync:
        return ""

    async def _ev(payload: dict) -> None:           # Tez AI dagi kabi chatda «qidirilmoqda» ko'rinadi
        if websocket is not None:
            try:
                await websocket.send_json(payload)
            except Exception:
                pass
    _first = "mavzuga mos rasmlar"
    try:
        r = await asyncio.wait_for(client.chat.completions.create(
            model="deepseek-chat", temperature=0, max_tokens=160, response_format={"type": "json_object"},
            messages=[{"role": "system", "content": f"You write {'animated GIF' if kind == 'gif' else ('short video clip' if kind == 'video' else 'photo')} search queries for slides. Return only JSON (json): {{\"queries\": [\"2-4 word ENGLISH query\", ...]}}. "
                                                    f"At most {max_q} queries, each a concrete photographable subject. If the request needs no pictures return an empty list."},
                      {"role": "user", "content": context[:1500]}]), timeout=20)
        qs = json.loads(r.choices[0].message.content or "{}").get("queries") or []
    except Exception as e:
        print(f"[DEEP-IMG] so'rov yozilmadi: {type(e).__name__}")
        return ""
    qs = [str(q).strip()[:60] for q in qs if str(q).strip()][:max_q]
    if not qs:
        return ""
    if stats is not None:
        stats["searches"] = len(qs)                 # v53: bu qidiruvlar ham varaq hisobiga kiradi (avval bepul edi)
    res = await _search_batch(websocket, [(q, kind) for q in qs], per_query=8)     # v55: Tez AI bilan bir xil to'plamli qidiruv
    blocks = []
    for q, f in zip(qs, res):
        if isinstance(f, list):
            urls = [str(x.get("url")) for x in f[:4] if isinstance(x, dict) and x.get("url")]
            if urls:
                blocks.append(f'"{q}":\n' + "\n".join("  - " + u for u in urls))
    if not blocks:
        return ""
    print(f"[DEEP-IMG] {len(blocks)} ta so'rov uchun rasm topildi")
    how = {"gif": "GIF uchun: {\"type\":\"gif\",\"gifUrl\":URL,...} (yoki orqa fon GIF)",
           "video": "Video uchun: add_video (yoki set_background_video) ga URL bering"}.get(kind, "{\"type\":\"image\",\"src\":URL,...}")
    return ("\n\n[TAYYOR " + {"gif": "GIFLAR", "video": "VIDEOLAR"}.get(kind, "RASMLAR") + " — server allaqachon qidirib topdi]\n"
            "Kerak bo'lsa FAQAT shu URL'lardan birini ishlating: " + how + ". URL o'ylab topmang, tool chaqirmang, "
            "qidirishga va'da bermang — rasmlar tayyor.\n" + "\n".join(blocks))
SEARCH_TOOLS = [{
    "type": "function",
    "function": {
        "name": "search_images",
        "description": (
            "Internetdan slaydga MOS HAQIQIY rasm, GIF yoki qisqa VIDEO qidiradi va to'g'ridan-to'g'ri havolalarni qaytaradi. Foydalanuvchi GIF yoki video so'rasa kind='gif' / kind='video' bilan alohida chaqiring. "
            "Rasm kerak bo'lgan HAR BIR slayd uchun, mavzuga 100% mos rasm topish uchun chaqiring. "
            "query — INGLIZ tilida, aniq va qisqa (masalan 'solar panels on roof', 'DNA double helix'). "
            "Natijadan eng mosini tanlab, shu url ni place_image_url / image element / set_background_url ga bering. "
            "URL'ni o'zingiz o'ylab topmang."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Inglizcha aniq qidiruv so'rovi"},
                "kind": {"type": "string", "enum": ["photo", "gif", "video"], "description": "photo (standart), gif yoki video (qisqa MP4 klip — add_video / orqa fon video uchun)"},
            },
            "required": ["query"],
        },
    },
}]

GIF_RETRY_KEYWORD = "GIF_URL_FIX"
GIF_RETRY_MAX = 5
GIF_FALLBACK_URL = "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif"

import re as _re
_GIF_URL_RE = _re.compile(r'https?://[^\s"\'<>\\]+?\.gif(?:\?[^\s"\'<>\\]*)?', _re.IGNORECASE)

_GIF_BAD_HOST_RE = _re.compile(
    r'https?://(?:www\.)?(?:tenor\.com/view|giphy\.com/gifs|giphy\.com/clips|'
    r'gph\.is|media\.tenor\.com/view|imgur\.com/(?:gallery|a)/)',
    _re.IGNORECASE,
)

def _is_direct_gif_url(url: str) -> bool:
    """URL to'g'ridan-to'g'ri .gif faylga ishora qiladimi?"""
    if not url or not isinstance(url, str):
        return False
    u = url.strip()
    if not u.lower().startswith(("http://", "https://")):
        return False
    if _GIF_BAD_HOST_RE.search(u):
        return False
    return bool(_GIF_URL_RE.search(u))

def _extract_gif_urls(text: str) -> List[str]:
    """Matndan barcha to'g'ridan-to'g'ri .gif URL'larni ajratib oladi."""
    if not text:
        return []
    found = _GIF_URL_RE.findall(text)

    seen = set()
    out = []
    for u in found:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out

def _extract_bad_gif_urls(text: str) -> List[str]:
    """Matndan buzuq / sahifa havolasini (direct .gif emas) ajratib oladi.
    tenor.com/view, giphy.com/gifs va boshqa .gif bo'lmagan media havolalarini ushlaydi.
    """
    if not text:
        return []
    bad = []
    seen = set()
    for m in _re.finditer(r'https?://[^\s"\'<>\\]+', text):
        u = m.group(0).rstrip("),.;]}'\"")
        if u in seen:
            continue
        if _GIF_BAD_HOST_RE.search(u):
            seen.add(u)
            bad.append(u)
            continue
        low = u.lower()
        if ("tenor.com" in low or "giphy.com" in low or "gph.is" in low):
            if not _GIF_URL_RE.search(u):
                seen.add(u)
                bad.append(u)
    return bad

def _build_gif_fix_prompt(bad_urls: List[str]) -> str:
    """
    AI'ga yuboriladigan ingliz tilidagi tuzatish so'rovi.
    AI FAQAT to'g'rilangan to'g'ridan-to'g'ri .gif URL'larni qaytarishi kerak —
    boshqa matn, izoh yoki JSON YO'Q.
    """
    listed = "\n".join(f"- {u}" for u in bad_urls) if bad_urls else "- (unknown)"
    return (
        f"[{GIF_RETRY_KEYWORD}]\n"
        "The following GIF URL(s) you provided are INVALID — they are web page links, "
        "not direct .gif file URLs, so they cannot be displayed:\n"
        f"{listed}\n\n"
        "Return ONLY corrected DIRECT .gif URLs (one per line). "
        "Rules:\n"
        "- Each line must be a direct URL ending in .gif (e.g. https://media.tenor.com/XXXX/name.gif).\n"
        "- Allowed hosts: media.tenor.com, c.tenor.com, media.giphy.com, i.giphy.com.\n"
        "- Do NOT output any explanation, JSON, markdown, or extra text.\n"
        "- Output exactly the same number of URLs as the invalid ones above.\n"
        "- If you cannot find a valid direct URL, output the single word: NONE"
    )

def _parse_gif_fix_reply(reply: str) -> List[str]:
    """AI'ning tuzatish javobidan to'g'ri .gif URL'larni ajratib oladi."""
    if not reply:
        return []
    if "NONE" in reply.upper() and not _extract_gif_urls(reply):
        return []
    return _extract_gif_urls(reply)

def load_config() -> dict:
    cfg = DEFAULT_CONFIG.copy()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            for k, v in data.items():
                if k.strip():
                    cfg[k.strip()] = v
        except Exception as e:
            print(f"[CONFIG] Yuklash xatosi: {e}")
    cfg["api_key"] = _env("AI_API_KEY", "DEEPSEEK_API_KEY", "API_KEY", default=cfg.get("api_key", ""))
    _bu = _env("AI_BASE_URL", "DEEPSEEK_BASE_URL", default="")
    if _bu:
        cfg["deepseek_base_url"] = _bu
    cfg["supabase_url"] = _env("SUPABASE_URL", default=cfg.get("supabase_url", ""))
    cfg["supabase_publishable_key"] = _env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", default=cfg.get("supabase_publishable_key", ""))
    cfg["supabase_secret_key"] = _env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", default=cfg.get("supabase_secret_key", ""))
    cfg["google_client_id"] = _env("GOOGLE_CLIENT_ID", default=cfg.get("google_client_id", ""))
    cfg["google_client_secret"] = _env("GOOGLE_CLIENT_SECRET", default=cfg.get("google_client_secret", ""))
    cfg["model_name"] = _env("MODEL_NAME", default=cfg.get("model_name", "deepseek-chat"))
    if cfg["model_name"] not in AVAILABLE_MODEL_VALUES:
        cfg["model_name"] = "deepseek-chat"
    cfg["max_context_messages"] = _env_int("MAX_CONTEXT_MESSAGES", cfg.get("max_context_messages", 10))
    cfg["daily_message_limit"] = _env_int("DAILY_MESSAGE_LIMIT", cfg.get("daily_message_limit", 200))
    cfg["default_slide_credits"] = _env_int("DEFAULT_SLIDE_CREDITS", 5)
    cfg["port"] = _env_int("PORT", 8080)

    cfg["system_prompt"] = _read_default_system_prompt()   # v33: kesh har ishga tushganda fayldan yangilanadi
    save_config(cfg)
    return cfg

SECRET_KEYS = ("supabase_secret_key", "google_client_secret", "api_key")

def save_config(cfg: dict):
    try:
        out = dict(cfg)

        for k in SECRET_KEYS:
            out.pop(k, None)
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[CONFIG] Saqlash xatosi: {e}")

config = load_config()
SERVER_PORT = int(config.get("port", 8080))
supabase: Optional[Any] = None

def init_supabase():
    global supabase
    if not create_client:
        print("[SUPABASE] ⚠️  supabase-py o'rnatilmagan! -> pip install supabase")
        return
    url = config.get("supabase_url")
    key = config.get("supabase_secret_key")
    if not url:
        print("[SUPABASE] ⚠️  supabase_url yo'q (.env yoki config.json tekshiring)")
        return
    if not key:
        print("[SUPABASE] ⚠️  supabase_secret_key yo'q! Auth ishlamaydi. SUPABASE_SECRET_KEY ni .env ga qo'shing.")
        return
    try:
        supabase = create_client(url, key)
        print("[SUPABASE] OK — Ulandi.")
    except Exception as e:
        print(f"[SUPABASE] ❌ Ulanish xatosi: {e}")
        supabase = None

init_supabase()

def _stable_hmac_secret() -> str:
    """Barcha HMAC imzolar uchun YAGONA barqaror kalit:
    SLIDE_STUDIO_HMAC_SECRET -> HMAC_SECRET -> config.json hmac_secret -> runtime random.
    Muhim: server restart'da kalit o'zgarmasligi kerak — aks holda admin tokenlari
    yaroqsiz bo'ladi va foydalanuvchi sessiyalari (TOK_CACHE kaliti) reset bo'ladi."""
    s = (os.environ.get("SLIDE_STUDIO_HMAC_SECRET") or os.environ.get("HMAC_SECRET") or "").strip()
    if not s:
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    s = str((json.load(f) or {}).get("hmac_secret") or "").strip()
        except Exception:
            s = ""
    return s or _RUNTIME_SECRET

# load_config() hali ishlamaydigan paytda ham xavfsiz (CONFIG_FILE faylidan o'qiydi).
_SCALING_HMAC_SECRET = _stable_hmac_secret()
try:
    from backend.scaling import (
        GEMINI_SEMAPHORE, MAX_WS as _SCALING_MAX_WS, DEEPSEEK_CONCURRENCY,
        hash_user_id,
        _active_sessions as active_sessions,
        _sessions_lock as sessions_lock,
    )
    # v52-fix: main.py da hash_user_id DOIM yagona barqaror kalit (_stable_hmac_secret) bilan ishlaydi.
    def hash_user_id(uid: str, _sec=_SCALING_HMAC_SECRET) -> str:  # noqa: F811
        import hashlib, hmac as _hmac
        return _hmac.new(_sec.encode("utf-8"), (uid or "anon").encode("utf-8"), hashlib.sha256).hexdigest()[:32]
    MAX_WS = _SCALING_MAX_WS
    print(f"[SCALING] concurrency={DEEPSEEK_CONCURRENCY} MAX_WS={MAX_WS}")
except Exception as _sc_err:
    print(f"[SCALING] local fallback: {_sc_err}")
    active_sessions: Dict[str, dict] = {}
    sessions_lock = threading.Lock()
    _conc = int(os.environ.get("DEEPSEEK_CONCURRENCY", "40") or "40")
    DEEPSEEK_CONCURRENCY = _conc
    GEMINI_SEMAPHORE = asyncio.Semaphore(max(1, _conc))
    MAX_WS = int(os.environ.get("MAX_WS", "2000") or "2000")
    def hash_user_id(uid: str) -> str:
        import hashlib, hmac as _hmac
        secret = _stable_hmac_secret().encode()
        return _hmac.new(secret, (uid or "anon").encode(), hashlib.sha256).hexdigest()[:32]

MODEL_COST_MULT = {"deepseek-chat": 1, "deepseek-reasoner": DEEP_MULT}   # (faqat ma'lumot) Chuqur varaq = DEEP_MULT (2) Tez-varaq. Narx — backend/monitoring.py MODES
server_paused = threading.Event()
_user_locks: Dict[str, asyncio.Lock] = {}
_user_locks_guard = threading.Lock()   # v52-fix: clear()/create tugmachasiz holat (race) oldini oladi

def _user_lock(uid: str) -> asyncio.Lock:
    lk = _user_locks.get(uid)
    if lk is None:
        with _user_locks_guard:
            lk = _user_locks.get(uid)          # double-checked: boshqa ip birinchi yaratgan bo'lishi mumkin
            if lk is None:
                if len(_user_locks) > 5000:
                    # v52-fix: to'liq clear() o'rniga FAQAT band bo'lmagan lock'larni o'chiramiz.
                    # Eski xatti-harakat: clear() davomida yopib qo'yilgan lock yo'qolib,
                    # ikki parallel oqim (webhook + sayt) BOSHQA lock olib, balans race'iga yo'l qo'yardi.
                    for k in [k for k, v in list(_user_locks.items()) if not v.locked()][:2500]:
                        _user_locks.pop(k, None)
                    if len(_user_locks) > 5000:   # hali ham juda ko'p — majburan tozalash (oxirgi chora)
                        _user_locks.clear()
                lk = _user_locks[uid] = asyncio.Lock()
    return lk

def _deck_slide_count(deck_state) -> Optional[int]:
    """deck_state dan slaydlar sonini aniqlaydi (narx hisoblash validatsiyasi uchun)."""
    try:
        d = json.loads(deck_state) if isinstance(deck_state, str) else deck_state
        if not isinstance(d, dict):
            return None
        pres = d.get("presentation")
        if isinstance(pres, list) and pres:
            return len(pres)
        t = d.get("total_slides")
        return int(t) if t else None
    except Exception:
        return None

ws_count = 0
ws_lock = threading.Lock()

def _sk(uid: str, email: str) -> str:
    return uid or email or f"anon-{int(time.time())}"

def register_session(uid: str, email: str, model: str) -> str:
    key = _sk(uid, email)
    with sessions_lock:
        s = active_sessions.get(key)
        if not s:
            s = {"user_id": uid, "email": email or "?", "connected_at": time.time(),
                 "message_count": 0, "blocked": False, "tokens_used": 0}
            active_sessions[key] = s
        s["last_active"] = time.time()
        s["model"] = model
    return key

def bump_msg(key: str) -> int:
    with sessions_lock:
        if key in active_sessions:
            sess = active_sessions[key]
            now = time.time()

            if now - sess.get("msg_window_start", sess.get("connected_at", now)) >= 86400:
                sess["message_count"] = 0
                sess["msg_window_start"] = now
            sess.setdefault("msg_window_start", now)
            sess["message_count"] += 1
            sess["last_active"] = now
            return sess["message_count"]
    return 0

def add_tokens(key: str, n: int):
    with sessions_lock:
        if key in active_sessions:
            active_sessions[key]["tokens_used"] = active_sessions[key].get("tokens_used", 0) + n

def is_blocked(key: str) -> bool:
    with sessions_lock:
        s = active_sessions.get(key)
        return bool(s and s.get("blocked"))

def _cas_version(u: dict, free: Any, paid: Any) -> dict:
    """v53: bazadagi joriy qiymatlar (optimistic lock). save_user_credits faqat shu qiymatlar o'zgarmagan bo'lsa yozadi."""
    u["_v_free"], u["_v_paid"] = int(free or 0), int(paid or 0)
    return u

def _get_or_create_user_usage_raw(user_id: str, email: str, _retry: int = 2) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    default = normalize_user_row({
        "user_id": user_id, "email": email or "",
        "total_tokens": 0, "daily_tokens": 0,
        "free_credits": free_daily_units(),
        "paid_credits": 0,
        "prompt_count": 0,
        "last_reset_time": now_iso,
        "slide_credits": free_daily_units(),
        "blocked": False,
    })
    if not supabase or not user_id or str(user_id).startswith(("dev-", "anon-", "guest-")):
        return apply_24h_reset(default)
    try:
        res = supabase.table("user_usage").select("*").eq("user_id", user_id).execute()
        if res.data:
            u = normalize_user_row(res.data[0])
            u_before = dict(u)
            u = apply_24h_reset(u)

            patch = {}
            if u.get("free_credits") != u_before.get("free_credits") or u.get("last_reset_time") != u_before.get("last_reset_time"):
                patch["free_credits"] = u["free_credits"]
                patch["prompt_count"] = u.get("prompt_count", 0)
                if "search_count" in res.data[0]:
                    patch["search_count"] = 0
                patch["last_reset_time"] = u["last_reset_time"]
                patch["slide_credits"] = u["free_credits"] + u["paid_credits"]
            dr = u.get("daily_reset")
            if dr:
                try:
                    dt = datetime.fromisoformat(str(dr).replace("Z", "+00:00"))
                    if datetime.now(dt.tzinfo) - dt > timedelta(days=1):
                        patch["daily_tokens"] = 0
                        patch["daily_reset"] = now_iso
                        u["daily_tokens"] = 0
                except Exception:
                    pass
            db_free, db_paid = res.data[0].get("free_credits"), res.data[0].get("paid_credits")
            if patch:
                try:
                    q = supabase.table("user_usage").update(patch).eq("user_id", user_id)
                    if "free_credits" in patch and db_free is not None:
                        q = q.eq("free_credits", db_free)        # v53: parallel yozuvni bosib ketmasin
                    w = q.execute()
                    if "free_credits" in patch and db_free is not None and not w.data:
                        if _retry > 0:                            # boshqa jarayon shu payt yozdi — qayta o'qiymiz
                            return _get_or_create_user_usage_raw(user_id, email, _retry - 1)
                    elif "free_credits" in patch:
                        db_free = patch["free_credits"]
                except Exception as e:
                    print(f"[USAGE RESET WRITE] {e}")
            return _cas_version(u, db_free if db_free is not None else u["free_credits"],
                                db_paid if db_paid is not None else u["paid_credits"])
        safe_email = email if (email and email.strip()) else f"user_{str(user_id)[:8]}@slidestudio.local"
        new_u = {
            "user_id": user_id, "email": safe_email,
            "total_tokens": 0, "daily_tokens": 0,
            "free_credits": free_daily_units(),
            "paid_credits": 0,
            "prompt_count": 0,
            "last_reset_time": now_iso,
            "slide_credits": free_daily_units(),
            "blocked": False,
        }
        try:
            supabase.table("user_usage").insert(new_u).execute()
        except Exception as e:

            print(f"[USAGE INSERT] {e} — legacy fallback")
            legacy = {
                "user_id": user_id, "email": safe_email,
                "total_tokens": 0, "daily_tokens": 0,
                "slide_credits": free_daily_units(), "blocked": False,
            }
            try:
                supabase.table("user_usage").insert(legacy).execute()
            except Exception as e2:
                print(f"[USAGE INSERT2] {e2}")
            new_u = legacy
        return _cas_version(normalize_user_row(new_u), new_u.get("free_credits"), new_u.get("paid_credits"))
    except Exception as e:
        print(f"[USAGE] {e}")
        return default

def get_or_create_user_usage(user_id: str, email: str) -> dict:
    """v47: + VIP bayrog'i (admin Google email / admin Telegram akkaunti) — cheksiz va reklamasiz."""
    u = _get_or_create_user_usage_raw(user_id, email)
    try:
        u["vip"] = bool(admin_core.is_vip_account(str(user_id or ""), (email or u.get("email") or "")))
    except Exception:
        u["vip"] = False
    return u

def save_user_credits(user_id: str, user: dict, tokens_add: int = 0, cas: bool = True) -> Optional[bool]:
    """free/paid/prompt/last_reset + tokens yozish.
    v53: OPTIMISTIC LOCK — `user` bazadan o'qilganda (get_or_create_user_usage) free/paid qiymatlari eslab qolinadi;
    yozishda baza shu qiymatlarda bo'lsagina yoziladi. Shu orada boshqa jarayon/server nusxasi (to'lov webhook'i,
    bot, ikkinchi instance) balansni o'zgartirgan bo'lsa — False qaytadi va chaqiruvchi qayta o'qib hisoblaydi
    (qarang update_usage_atomic). True = yozildi, False = to'qnashuv/xato, None = baza yo'q (dev)."""
    if not supabase or not user_id or str(user_id).startswith(("dev-", "anon-", "guest-")):
        return None
    vf, vp = user.get("_v_free"), user.get("_v_paid")
    user_ref = user                                         # chaqiruvchining dict'i (versiya shu yerda yangilanadi)
    user = normalize_user_row(user)
    patch = {
        "total_tokens": (user.get("total_tokens") or 0) + max(0, tokens_add),
        "daily_tokens": (user.get("daily_tokens") or 0) + max(0, tokens_add),
        "free_credits": int(user.get("free_credits") or 0),
        "paid_credits": int(user.get("paid_credits") or 0),
        "prompt_count": int(user.get("prompt_count") or 0),
        "last_reset_time": user.get("last_reset_time") or datetime.now(timezone.utc).isoformat(),
        "slide_credits": int(user.get("free_credits") or 0) + int(user.get("paid_credits") or 0),
        "last_active": datetime.now(timezone.utc).isoformat(),
    }
    use_cas = cas and vf is not None and vp is not None

    def _q(p):
        q = supabase.table("user_usage").update(p).eq("user_id", user_id)
        if use_cas:
            q = q.eq("free_credits", int(vf)).eq("paid_credits", int(vp))
        return q.execute()
    try:
        # v33: search_count ustuni bo'lmasa ham saqlash buzilmasligi uchun avval ustun bilan, bo'lmasa ustunsiz yozamiz
        try:
            res = _q({**patch, "search_count": int(user.get("search_count") or 0)})
        except Exception:
            res = _q(patch)
        if use_cas and not res.data:
            return False                                   # to'qnashuv: boshqa yozuv bor edi
        _cas_version(user_ref, patch["free_credits"], patch["paid_credits"])   # keyingi yozuv uchun yangi versiya
        return True
    except Exception as e:

        print(f"[SAVE CREDITS] {e}")
        try:
            supabase.table("user_usage").update({
                "total_tokens": patch["total_tokens"],
                "daily_tokens": patch["daily_tokens"],
                "last_active": patch["last_active"],
            }).eq("user_id", user_id).execute()
        except Exception as e2:
            print(f"[SAVE CREDITS2] {e2}")
        return False

def update_usage_atomic(user_id: str, email: str, fn, retries: int = 5):
    """v53: balansni xavfsiz o'zgartirish: o'qi -> fn(usage) -> (yangi_usage, natija) -> CAS bilan yoz.
    To'qnashuvda qaytadan o'qib hisoblanadi (fn SOF bo'lishi shart: faqat dict'ni o'zgartirsin).
    Natija: (yozilgan_usage, natija)."""
    u2, out = None, None
    for attempt in range(max(1, retries)):
        u = get_or_create_user_usage(user_id, email)
        u2, out = fn(dict(u))
        for k in ("_v_free", "_v_paid"):
            if k in u:
                u2[k] = u[k]
        ok = save_user_credits(user_id, u2, 0, cas=attempt < retries - 1)
        if ok is not False:
            return u2, out
        print(f"[USAGE CAS] to'qnashuv user={str(user_id)[:8]} urinish={attempt + 1}")
    return u2, out

def update_user_tokens(user_id: str, tokens: int, credits_delta: int = 0):
    """Legacy wrapper — yangi tizimda save_user_credits + charge_for_ai_turn ishlatiladi."""
    if not supabase or not user_id or str(user_id).startswith(("dev-", "anon-", "guest-")):
        return
    from backend.monitoring import deduct_credits

    def _apply(u):
        u["total_tokens"] = (u.get("total_tokens") or 0) + max(0, tokens)
        u["daily_tokens"] = (u.get("daily_tokens") or 0) + max(0, tokens)
        if credits_delta < 0:
            u = deduct_credits(u, -credits_delta)
        elif credits_delta > 0:
            u = add_paid_credits(u, credits_delta)
        return u, None
    try:
        update_usage_atomic(user_id, "", _apply)
    except Exception as e:
        print(f"[TOKEN UPD] {e}")

def calc_cost(model: str, inp: int, out: int) -> float:
    for m in AVAILABLE_MODELS:
        if m["value"] == model:
            return (inp / 1e6) * m["input_price"] + (out / 1e6) * m["output_price"]
    return 0.0

def count_accounts() -> int:
    if not supabase:
        return 0
    try:
        res = supabase.table("user_usage").select("user_id", count="exact").execute()
        return res.count if hasattr(res, "count") and res.count is not None else len(res.data or [])
    except Exception:
        return 0

def _extract_imgs(objects, slide_num):
    out = []
    if not isinstance(objects, list):
        return out
    for z, el in enumerate(objects):
        if not isinstance(el, dict):
            continue
        etype = el.get("type")
        is_gif = bool(el.get("isGif") or el.get("gifUrl") or etype == "gifImage" or el.get("kind") == "gif")
        if etype != "image" and etype != "gifImage" and not is_gif:
            continue
        num = el.get("imageNumber")
        if num is None:
            continue
        out.append({
            "number": num, "id": el.get("id"), "slide": slide_num,
            "left": el.get("left"), "top": el.get("top"),
            "width": el.get("width"), "height": el.get("height"),
            "angle": el.get("angle", 0), "z": z,
            "kind": "gif" if is_gif else "image",
        })
    return out

def extract_images_from_deck_state(deck_state) -> Dict:
    result = {"pending": [], "placed": []}
    if not deck_state:
        return result
    try:
        deck = json.loads(deck_state) if isinstance(deck_state, str) else deck_state
    except Exception:
        return result
    if not isinstance(deck, dict):
        return result
    for p in deck.get("slide_images_pending") or []:
        if isinstance(p, dict):
            num = p.get("number") or p.get("globalNum")
            if num is not None:
                result["pending"].append({"number": num, "width": p.get("width"), "height": p.get("height")})
    slide_data = deck.get("slide_data") or {}
    if isinstance(slide_data, dict):
        sn = deck.get("active_slide", 1)
        objs = slide_data.get("objects") or slide_data.get("elements") or []
        result["placed"].extend(_extract_imgs(objs, sn))
    for s in deck.get("presentation") or []:
        if isinstance(s, dict):
            sn = s.get("slide") or s.get("slide_index") or 0
            objs = s.get("objects") or s.get("elements") or []
            result["placed"].extend(_extract_imgs(objs, sn))
    for el in deck.get("placed_images") or []:
        if isinstance(el, dict):
            num = el.get("number") or el.get("imageNumber")
            if num is not None:
                result["placed"].append({
                    "number": num, "id": el.get("id"), "slide": el.get("slide"),
                    "left": el.get("left"), "top": el.get("top"),
                    "width": el.get("width"), "height": el.get("height"),
                    "angle": el.get("angle", 0), "z": el.get("z"),
                })
    return result

_OLD_ACTIONS_NOTE = "[oldingi amallar bajarilgan — joriy mazmun faqat LIVE DECK STATE da]"
_FENCE_RE = _re.compile(r"```[a-zA-Z]*\s*[\s\S]*?(?:```|$)")

def _strip_old_actions(text: str) -> str:
    """v33: AI ning ESKI javobidagi JSON amallari (eski slayd mazmuni) tarixga qaytarilmaydi —
    aks holda model eski kontentni 'eslab' qayta yozib yuboradi. Joriy holat faqat LIVE DECK STATE."""
    if not text:
        return text
    t = _FENCE_RE.sub(_OLD_ACTIONS_NOTE, text)
    # qavs-balansli, fence'siz {"actions": ...} bloklari
    dec = json.JSONDecoder()
    out, i = [], 0
    while True:
        j = t.find('{"actions"', i)
        if j < 0:
            out.append(t[i:])
            break
        out.append(t[i:j])
        try:
            _, end = dec.raw_decode(t, j)
        except ValueError:
            end = len(t)
        out.append(_OLD_ACTIONS_NOTE)
        i = end
    t = "".join(out)
    t = _re.sub(r"(?:" + _re.escape(_OLD_ACTIONS_NOTE) + r"\s*){2,}", _OLD_ACTIONS_NOTE + " ", t)
    return t.strip()

def build_history(chat_history) -> List[dict]:
    if not isinstance(chat_history, list):
        return []
    try:
        _max_ctx = max(2, int(config.get("max_context_messages", 10) or 10))
    except Exception:
        _max_ctx = 10
    chat_history = chat_history[-_max_ctx:]
    items = []
    for m in chat_history:
        if not isinstance(m, dict):
            continue
        role = m.get("role")
        text = (m.get("text") or "").strip()
        if not text:
            continue
        if role in ("assistant", "bot", "model"):
            role = "assistant"
            text = _strip_old_actions(text)
            if not text:
                continue
        else:
            role = "user"
        items.append({"role": role, "content": text})
    norm = []
    for it in items:
        if norm and norm[-1]["role"] == it["role"]:
            norm[-1]["content"] += "\n" + it["content"]
        else:
            norm.append(dict(it))
    while norm and norm[0]["role"] == "assistant":
        norm.pop(0)
    while norm and norm[-1]["role"] == "user":
        norm.pop()
    return norm

app = FastAPI(title="Slide Studio", version="37.0", docs_url=None, redoc_url=None, openapi_url=None)

# v37: CORS faqat ALLOWED_ORIGINS (vergul bilan) ro'yxati uchun; bo'sh = faqat o'z domeni (same-origin)
_ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in (os.environ.get("ALLOWED_ORIGINS") or "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS, allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"], allow_headers=["Content-Type", "Authorization"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

_RL: Dict[str, list] = {}
_RL_LOCK = threading.Lock()
_RL_RULES = (            # (path prefix, limit per 60s per IP)
    ("/api/payment/create-checkout", 10),
    ("/api/telegram/auth", 20),
    ("/api/user/usage", 60),
    ("/api/media-search", 120),
    ("/api/proxy-image", 900),
    ("/api/proxy-video", 60),
    ("/api/", 240),
)
_RL_EXEMPT = ("/api/payment/lemon-webhook", "/webhook/lemonsqueezy")

# v53: X-Forwarded-For ning BOSHIDAGI qiymatni mijoz o'zi yozishi mumkin (soxta IP -> rate limit ishlamasdi).
# Ishonchli qiymat — o'ngdan TRUSTED_PROXY_HOPS-chi element (Render proksisi haqiqiy IP ni oxiriga qo'shadi).
# CF-Connecting-IP / True-Client-IP faqat TRUST_CF_CONNECTING_IP=1 bo'lsa (sayt Cloudflare ortida bo'lsa) ishlatiladi.
TRUSTED_PROXY_HOPS = max(0, _env_int("TRUSTED_PROXY_HOPS", 1))
TRUST_CF_CONNECTING_IP = os.environ.get("TRUST_CF_CONNECTING_IP", "").strip().lower() in ("1", "true", "yes")

def _client_ip(request) -> str:
    """Rate limit uchun mijoz IP manzili (soxtalashtirib bo'lmaydigan qismidan)."""
    h = request.headers
    if TRUST_CF_CONNECTING_IP:
        for name in ("cf-connecting-ip", "true-client-ip"):
            v = (h.get(name) or "").strip()
            if v:
                return v[:64]
    if TRUSTED_PROXY_HOPS > 0:
        parts = [p.strip() for p in (h.get("x-forwarded-for") or "").split(",") if p.strip()]
        if parts:
            return parts[-min(TRUSTED_PROXY_HOPS, len(parts))][:64]
    return request.client.host if request.client else "?"

def _rate_limited(ip: str, path: str) -> bool:
    if path.startswith(_RL_EXEMPT):
        return False
    limit = None
    for pref, lim in _RL_RULES:
        if path.startswith(pref):
            limit, bucket = lim, pref
            break
    if limit is None:
        return False
    now = time.time()
    key = f"{ip}|{bucket}"
    with _RL_LOCK:
        arr = [t for t in _RL.get(key, ()) if now - t < 60]
        if len(arr) >= limit:
            _RL[key] = arr
            return True
        arr.append(now)
        _RL[key] = arr
        if len(_RL) > 20000:
            for k in list(_RL.keys())[:5000]:
                _RL.pop(k, None)
    return False

@app.middleware("http")
async def _security_middleware(request: Request, call_next):
    path = request.url.path
    ip = _client_ip(request)
    if path.startswith("/api/") and _rate_limited(ip, path):
        return JSONResponse({"error": "Juda ko'p so'rov. Biroz kuting."}, status_code=429, headers={"Retry-After": "30"})
    resp = await call_next(request)
    h = resp.headers
    h.setdefault("X-Content-Type-Options", "nosniff")
    # v43: Telegram Web/Desktop Mini App'ni iframe ichida ochadi -> faqat o'z domen va telegram ruxsat etiladi
    h.setdefault("Content-Security-Policy", "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    # v52: JS/CSS. index.html ichidagi ?v=<hash> fayl o'zgarganda AVTOMATIK o'zgaradi (qarang _render_index),
    # shuning uchun ?v= li fayl abadiy keshlansa bo'ladi; ?v= siz so'rov har safar tekshiriladi (ETag -> 304).
    if path.startswith("/static/"):
        h["Cache-Control"] = "no-cache, no-store, must-revalidate"
    elif path.startswith("/js/") or path.endswith((".css", ".png", ".ico", ".woff2", ".js")):
        if path.endswith((".png", ".ico", ".woff2")):
            h.setdefault("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
        elif request.query_params.get("v"):
            h.setdefault("Cache-Control", "public, max-age=31536000, immutable")
        else:
            h.setdefault("Cache-Control", "no-cache")
    elif path in ("/", "/index.html"):
        h.setdefault("Cache-Control", "no-cache, no-store, must-revalidate")
    return resp

@app.get("/healthz")
def healthz():
    return {"ok": True, "ai": bool((config.get("api_key") or "").strip()), "auth": bool(supabase)}

# ---------------------------------------------------------------------------------------------
# v43: Telegram bot (webhook) — backend/telegram_bot.py. TELEGRAM_BOT_TOKEN yo'q bo'lsa hech narsa qilmaydi.
# ---------------------------------------------------------------------------------------------
try:
    from backend import telegram_bot as tgbot
    tgbot.configure(
        supabase_getter=lambda: supabase,
        get_usage=get_or_create_user_usage,
        usage_payload=usage_payload,
        free_daily_pages=rt("free_daily_pages"),
        # v44: botda AI orqali slayd yaratish va kredit yechish
        apply_reset=apply_24h_reset,
        charge=charge_for_ai_turn,
        save_usage=save_user_credits,
        update_atomic=update_usage_atomic,         # v53: o'qi-hisobla-yoz (optimistic lock, qayta urinish bilan)
        user_lock=lambda uid: _user_lock(uid),     # v52: bot, sayt va webhook uchun yagona lock
        ledger_log=lambda *a, **k: ledger_log(*a, **k),   # v44.1: ledger_log pastroqda e'lon qilingan -> kech bog'lanadi (NameError tuzatildi)
        total_credits=lambda u: (10 ** 9 if is_unlimited(u) else total_credits(u)),   # v47: cheksiz/VIP uchun bot hech qachon "varaq tugadi" demaydi
        MODES=MODES,
        ai_sem=GEMINI_SEMAPHORE,                   # v59: bot va sayt bitta AI kalitini UMUMIY navbat bilan ishlatadi
        checkout=lambda *a, **k: _checkout_for_bot(*a, **k),   # v45: botdan to'lov havolasi (kech bog'lanadi — NameError bo'lmasin)
        ai=lambda: {
            "api_key": (config.get("api_key") or "").strip(),
            "base_url": config.get("deepseek_base_url") or "https://api.deepseek.com",
            "fast_model": "deepseek-chat",
            "deep_model": "deepseek-reasoner",
        },
    )
    app.include_router(tgbot.router)
except Exception as _tg_err:
    tgbot = None
    import traceback; traceback.print_exc()
    print(f"[TG] bot moduli yuklanmadi: {_tg_err}")

# ---------------------------------------------------------------------------------------------
# v47: sozlamalar, reklama, admin yadrosi ulanishi
# ---------------------------------------------------------------------------------------------
appsettings.configure(lambda: supabase)
ads_mod.configure(lambda: supabase)

def _admin_state() -> dict:
    with sessions_lock:
        n = len(active_sessions)
    return {"ws_live": ws_count, "sessions": n}

def _set_paused(v: bool) -> None:
    (server_paused.set if v else server_paused.clear)()

def _set_ai_key(k: str) -> None:
    config["api_key"] = k
    os.environ["AI_API_KEY"] = k

admin_core.configure(
    supabase_getter=lambda: supabase,
    ledger_log=lambda *a, **k: ledger_log(*a, **k),
    config=lambda: config,
    secret_hint=lambda: config.get("supabase_secret_key") or _stable_hmac_secret(),
    state=_admin_state, paused=lambda: server_paused.is_set(),
    set_paused=_set_paused, set_ai_key=_set_ai_key,
)
if tgbot is not None:
    admin_core.configure(tg_send=tgbot.admin_send, tg_notify=tgbot.notify_user)
    tgbot.configure(admin=admin_core, ads=ads_mod, settings=appsettings)
app.include_router(admin_core.router)

_bg_tasks: set = set()

async def _housekeeping_loop():
    """Har 10 daqiqada eskirgan xotirani tozalaydi (RAM o'sib ketmasligi uchun)."""
    import gc
    while True:
        await asyncio.sleep(600)
        try:
            now = time.time()
            with sessions_lock:
                for k in [k for k, s in active_sessions.items()
                          if now - s.get("last_active", s.get("connected_at", now)) > 86400]:
                    active_sessions.pop(k, None)
            if len(_processed_orders) > 5000:
                _processed_orders.clear()
            with _HOST_LOCK:
                if len(_HOST_SEM) > 300:
                    _HOST_SEM.clear()
                    _HOST_LAST.clear()
            with _RL_LOCK:
                for k in [k for k, v in _RL.items() if not v or now - v[-1] > 120]:
                    _RL.pop(k, None)
            gc.collect()
        except Exception as e:
            print(f"[HOUSEKEEPING] {str(e)[:120]}")

async def _keepalive_loop():
    """KEEPALIVE=1 bo'lsa: Render free reja 15 daqiqada uxlab qolmasligi uchun o'z /healthz ini har 9 daqiqada chaqiradi
    (uxlagan serverda bot birinchi javobni 30-60 soniyada beradi — eng katta «sekinlik» sababi shu)."""
    import httpx
    base = (os.environ.get("PUBLIC_BASE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
    if not base.startswith("https://"):
        return
    async with httpx.AsyncClient(timeout=15) as c:
        while True:
            await asyncio.sleep(540)
            try:
                await c.get(base + "/healthz")
            except Exception:
                pass

from contextlib import asynccontextmanager

@asynccontextmanager
async def _lifespan_v43(_app):
    """Start/stop: yangi FastAPI/Starlette'da add_event_handler yo'q, shuning uchun lifespan ishlatiladi."""
    # v52: asyncio.to_thread standart hovuzi kichik serverda atigi ~5 ta ip — har bir Supabase so'rovi navbat kutardi (bot sekin javob berardi)
    try:
        from concurrent.futures import ThreadPoolExecutor
        asyncio.get_running_loop().set_default_executor(
            ThreadPoolExecutor(max_workers=int(os.environ.get("THREAD_POOL_SIZE", "32")), thread_name_prefix="ss-io"))
    except Exception as e:
        print(f"[POOL] {str(e)[:100]}")
    try:
        admin_core.configure(loop=asyncio.get_running_loop())
        await asyncio.to_thread(appsettings.load, True)
    except Exception as e:
        print(f"[ADMIN] ishga tushirish: {str(e)[:100]}")
    t = asyncio.create_task(_housekeeping_loop())
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    if os.environ.get("KEEPALIVE", "").strip().lower() in ("1", "true", "yes", "on"):
        _kt = asyncio.create_task(_keepalive_loop())
        _bg_tasks.add(_kt)
        _kt.add_done_callback(_bg_tasks.discard)
    if tgbot is not None:
        try:
            await tgbot.startup()
        except Exception as e:
            print(f"[TG] startup xatosi: {str(e)[:150]}")
    try:
        yield
    finally:
        t.cancel()
        if tgbot is not None:
            try:
                await tgbot.shutdown()
            except Exception:
                pass

app.router.lifespan_context = _lifespan_v43

_static = os.path.join(BASE_DIR, "static")
if os.path.isdir(_static):
    app.mount("/static", StaticFiles(directory=_static), name="static")

_js_dir = os.path.join(BASE_DIR, "js")
if os.path.isdir(_js_dir):
    app.mount("/js", StaticFiles(directory=_js_dir), name="js_modules")

# v52: index.html dagi  js/xx.js?v=N  va  xx.css?v=N  havolalari fayl tarkibi (mtime+hajm) bo'yicha avtomatik
# yangilanadi. Kodni o'zgartirsangiz ?v= raqamini qo'lda oshirish SHART EMAS — eski nusxa brauzer/Telegram keshida qolmaydi.
import re as _re_idx
import hashlib as _hashlib
_ASSET_RE = _re_idx.compile(r'((?:href|src)=")((?:js/[\w.\-]+\.js)|(?:[\w.\-]+\.css))\?v=[\w.\-]*(")')
_index_cache: Dict[str, Any] = {"sig": None, "html": ""}

def _render_index() -> Optional[str]:
    path = os.path.join(BASE_DIR, "index.html")
    try:
        raw = open(path, "r", encoding="utf-8").read()
    except OSError:
        return None
    stamps: Dict[str, str] = {}
    def _ver(rel: str) -> str:
        if rel not in stamps:
            try:
                st = os.stat(os.path.join(BASE_DIR, rel))
                stamps[rel] = f"{st.st_mtime_ns}-{st.st_size}"
            except OSError:
                stamps[rel] = "0"
        return stamps[rel]
    rels = [m.group(2) for m in _ASSET_RE.finditer(raw)]
    sig = (_ver("index.html"),) + tuple(_ver(r) for r in rels)
    if _index_cache["sig"] == sig and _index_cache["html"]:
        return _index_cache["html"]
    def _sub(m):
        v = _hashlib.md5(_ver(m.group(2)).encode()).hexdigest()[:10]
        return f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}"
    html = _ASSET_RE.sub(_sub, raw)
    _index_cache["sig"], _index_cache["html"] = sig, html
    return html

def _index_response():
    html = _render_index()
    if html is None:
        return HTMLResponse("<h2>Slide Studio ishlamoqda. index.html topilmadi.</h2>")
    return HTMLResponse(html, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

@app.get("/")
def root():
    return _index_response()

@app.get("/api/config/public")
def public_config():
    return {
        "supabase_url": config.get("supabase_url"),
        "supabase_publishable_key": config.get("supabase_publishable_key"),
        "free_daily": rt("free_daily_pages"),
        "pack_pages": pack_pages(),
        "pack_price_usd": CHECKOUT_PRICE_USD,
        "announcement": appsettings.get("announcement", ""),
        "unit": UNIT,
        "modes": {k: {"page_units": v["page"], "chat_units": v["chat"], "search_units": v["search"],
                      "free_daily_pages": free_daily_units() // v["page"], "pack_pages": pack_units() // v["page"]}
                  for k, v in MODES.items()},
    }

# ---- v52: yuklash cheklovlari (hajm + format). Fayl RAMga TO'LIQ o'qilishidan OLDIN tekshiriladi ----
MAX_UPLOAD_BYTES = 10 * 1024 * 1024          # 10 MB
_PDF_SEM = asyncio.Semaphore(2)              # PDF konvertatsiya CPU og'ir — bir vaqtda 2 ta
_IMG_MAGIC = ((b"\x89PNG\r\n\x1a\n", "png"), (b"\xff\xd8\xff", "jpeg"), (b"GIF87a", "gif"), (b"GIF89a", "gif"))
ALLOWED_IMAGE_MIME = ("image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif")

async def _read_body_limited(request: Request, limit: int = MAX_UPLOAD_BYTES) -> bytes:
    """Content-Length va haqiqiy oqim bo'yicha limit: 10 MB dan oshsa 413 (xotira to'lib ketmaydi)."""
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > limit:
        raise HTTPException(status_code=413, detail=f"Fayl {limit // (1024 * 1024)} MB dan oshmasin")
    buf = bytearray()
    try:
        async for chunk in request.stream():
            buf += chunk
            if len(buf) > limit:
                raise HTTPException(status_code=413, detail=f"Fayl {limit // (1024 * 1024)} MB dan oshmasin")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Fayl o'qilmadi")
    return bytes(buf)

def _is_image_bytes(b: bytes) -> bool:
    return any(b.startswith(m) for m, _ in _IMG_MAGIC) or (b[:4] == b"RIFF" and b[8:12] == b"WEBP")

@app.post("/api/import/pdf")
async def import_pdf(request: Request):
    """PDF -> tahrirlanadigan slaydlar (shakl, rasm, matn alohida obyekt). Fayl saqlanmaydi. Maks 10 MB."""
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if ctype and ctype not in ("application/pdf", "application/octet-stream"):
        raise HTTPException(status_code=415, detail="Faqat PDF fayl qabul qilinadi")
    data = await _read_body_limited(request)
    if not data:
        raise HTTPException(status_code=400, detail="Fayl bo'sh")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Bu PDF emas")
    try:
        from backend import pdf_import
        async with _PDF_SEM:
            res = await asyncio.to_thread(pdf_import.convert, data)
    except ImportError:
        raise HTTPException(status_code=501, detail="PDF import serverda o'rnatilmagan")
    except Exception as e:
        print(f"[PDF-IMPORT] {type(e).__name__}: {str(e)[:120]}")
        raise HTTPException(status_code=422, detail="PDF o'qib bo'lmadi")
    return res


@app.post("/api/analyze-images")
async def analyze_images(payload: Dict[str, Any]):
    images = payload.get("images") if isinstance(payload, dict) else []
    if not isinstance(images, list):
        raise HTTPException(status_code=400, detail="images list is required")
    if len(images) > 30:
        raise HTTPException(status_code=413, detail="Bir so'rovda 30 tadan ko'p rasm yuborib bo'lmaydi")
    results = []
    for item in images:
        if not isinstance(item, dict):
            continue
        number = item.get("number")
        src = item.get("src") or ""
        if isinstance(src, str) and src.startswith("data:") and len(src) > int(MAX_UPLOAD_BYTES * 1.4):     # base64 ~ 1.33x
            raise HTTPException(status_code=413, detail="Rasm 10 MB dan oshmasin")
        if not isinstance(src, str) or not src.lower().startswith(tuple("data:" + m + ";" for m in ALLOWED_IMAGE_MIME)):
            results.append({"number": number, "description": "Rasm ma'lumoti mavjud emas."})
            continue
        image_desc = "Rasm tarkibiy qismlari va asosiy ob'ektlari aniqlanmoqda."
        if number is not None:
            image_desc = f"Rasm #{number}"
        results.append({"number": number, "description": image_desc})
    return {"images": results}

@app.get("/api/config/models")
def models_list():
    return {"models": [{"value": x["public_id"], "label": x["label"], "desc": x["desc"]} for x in AVAILABLE_MODELS],
            "default": _internal_to_public(config.get("model_name", "deepseek-chat"))}

def ledger_log(user_id: str, kind: str, amount: int, usage: dict = None, searches: int = 0, details: dict = None):
    """v35: har bir balans o'zgarishi usage_ledger jadvaliga yoziladi. Jadval bo'lmasa — jim o'tadi (asosiy oqim buzilmaydi)."""
    if not supabase or not user_id or str(user_id).startswith(("dev-", "anon-", "guest-")) or not amount:
        return
    try:
        u = usage or {}
        supabase.table("usage_ledger").insert({
            "user_id": str(user_id), "kind": kind, "amount": int(amount),
            "free_after": int(u.get("free_credits") or 0), "paid_after": int(u.get("paid_credits") or 0),
            "searches": int(searches or 0), "details": details or {},
        }).execute()
    except Exception as e:
        print(f"[LEDGER] {e}")

def ledger_spent(user_id: str, since_iso):
    """Oxirgi reset'dan beri sarflangan varaqlar (serverdan; brauzer yangilansa ham yo'qolmaydi). Noma'lum bo'lsa None."""
    if not supabase or not user_id or str(user_id).startswith(("dev-", "anon-", "guest-")):
        return None
    try:
        q = supabase.table("usage_ledger").select("amount").eq("user_id", str(user_id)).lt("amount", 0)
        if since_iso:
            q = q.gte("created_at", str(since_iso))
        rows = q.limit(5000).execute().data or []
        return int(sum(-int(r.get("amount") or 0) for r in rows))
    except Exception:
        return None

@app.get("/api/user/usage")
def user_usage(token: str = ""):
    if not supabase or not token:
        u = normalize_user_row({
            "free_credits": free_daily_units(),
            "paid_credits": 0,
            "prompt_count": 0,
            "last_reset_time": datetime.now(timezone.utc).isoformat(),
        })
        return {**usage_payload(u), "total_tokens": 0, "daily_tokens": 0}
    try:
        user_res = supabase.auth.get_user(token)
        if not user_res or not user_res.user:
            return {"error": "invalid_token"}
        u = get_or_create_user_usage(user_res.user.id, user_res.user.email or "")
        u["spent_24h"] = ledger_spent(user_res.user.id, u.get("last_reset_time"))
        payload = usage_payload(u)
        payload["total_tokens"] = u.get("total_tokens", 0)
        payload["daily_tokens"] = u.get("daily_tokens", 0)
        return payload
    except Exception as e:
        print(f"[USAGE] {e}")
        return {"error": "usage_unavailable"}

@app.get("/api/billing/plans")
def billing_plans():
    return {
        "plans": plans_public(),
        "checkout_price_usd": CHECKOUT_PRICE_USD,
        "pages_per_pack": pack_pages(),
        "deep_pages_per_pack": pack_units() // MODES["deep"]["page"],
        "free_daily": rt("free_daily_pages"),
        "deep_free_daily": free_daily_units() // MODES["deep"]["page"],
        "note": "Lemon Squeezy komissiyasi: 5% + $0.50 — narxni shunga qarab belgilang",
    }

def _clean_env(name: str, bearer: bool = False) -> str:
    """Render'ga kalit nusxalanganda qolib ketadigan \\n, bo'shliq, tirnoq va «Bearer » ni tozalaydi
    (aks holda «Invalid header value» xatosi chiqadi)."""
    v = os.environ.get(name) or ""
    if isinstance(v, bytes):
        v = v.decode("utf-8", "ignore")
    v = v.strip().strip("\"'").strip()
    if bearer and v.lower().startswith("bearer "):
        v = v[7:]
    return _re.sub(r"[\s\x00-\x1f\x7f\u200b\ufeff]+", "", v)

def _ls_env():
    return {
        "api_key": _clean_env("LEMON_SQUEEZY_API_KEY", bearer=True),
        "store_id": _clean_env("LEMON_SQUEEZY_STORE_ID"),
        "variant_id": _clean_env("LEMON_SQUEEZY_VARIANT_ID"),
        "secret": _clean_env("LEMON_SQUEEZY_WEBHOOK_SECRET"),
        "test_mode": (os.environ.get("LEMON_SQUEEZY_TEST_MODE") or "").strip() in ("1", "true", "yes"),
        "base_url": (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/"),
    }

@app.get("/api/payment/health")
def payment_health():
    """To'lov sozlamalari tekshiruvi (kalitlarning o'zi ko'rsatilmaydi)."""
    e = _ls_env()
    return {
        "api_key": bool(e["api_key"]),
        "store_id": bool(e["store_id"]),
        "variant_id": bool(e["variant_id"]),
        "webhook_secret": bool(e["secret"]),
        "test_mode": e["test_mode"],
        "public_base_url": e["base_url"] or None,
        "supabase": bool(supabase),
    }

def _ls_post_checkout(api_key: str, body: dict) -> dict:
    """Lemon Squeezy API (bloklovchi) — asyncio.to_thread orqali chaqiriladi."""
    import urllib.error
    req = urllib.request.Request(
        "https://api.lemonsqueezy.com/v1/checkouts",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Accept": "application/vnd.api+json",
            "Content-Type": "application/vnd.api+json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return {"status": resp.status, "json": json.loads(resp.read().decode("utf-8"))}
    except urllib.error.HTTPError as he:
        try:
            raw = he.read().decode("utf-8", "ignore")
        except Exception:
            raw = ""
        return {"status": he.code, "error_body": raw[:600]}

@app.post("/api/payment/create-checkout")
async def create_lemon_checkout(payload: Dict[str, Any] = None):
    """Lemon Squeezy checkout URL (PAGES_PER_PACK varaq / CHECKOUT_PRICE_USD). Faqat tizimga kirgan foydalanuvchi uchun."""
    payload = payload or {}
    token = (payload.get("token") or "").strip()
    if not token or token == "dev-token" or not supabase:
        return JSONResponse({"error": "To'lov uchun avval tizimga kiring."}, status_code=401)
    try:
        user_res = await asyncio.to_thread(supabase.auth.get_user, token)
    except Exception as e:
        return JSONResponse({"error": f"Sessiya xato: {str(e)[:120]}"}, status_code=401)
    if not user_res or not user_res.user:
        return JSONResponse({"error": "Sessiya tugagan. Qayta kiring."}, status_code=401)
    user_id = user_res.user.id
    user_email = (user_res.user.email or payload.get("email") or "").strip()
    code, data = await _build_checkout(user_id, user_email, str(payload.get("return_url") or ""), "pack")
    return data if code == 200 else JSONResponse(data, status_code=code)


async def _build_checkout(user_id, user_email: str, return_url_hint: str = "", product: str = "pack"):
    """v45: sayt VA Telegram bot uchun umumiy checkout yaratish. (http_status, dict) qaytaradi."""
    ls = _ls_env()
    variant = ls["variant_id"]
    if not ls["api_key"] or not ls["store_id"] or not variant:
        return 503, {
            "error": "Lemon Squeezy sozlanmagan",
            "hint": ".env ga LEMON_SQUEEZY_API_KEY, LEMON_SQUEEZY_STORE_ID, LEMON_SQUEEZY_VARIANT_ID yozing",
        }

    return_url = ls["base_url"] or str(return_url_hint or "").strip().rstrip("/")
    if return_url and not return_url.startswith(("http://", "https://")):
        return_url = ""
    checkout_data: Dict[str, Any] = {"custom": {"user_id": str(user_id), "product": "pack"}}
    if user_email:
        checkout_data["email"] = user_email
    product_options: Dict[str, Any] = {"name": f"Slide Studio — {pack_pages()} varaq"}
    try:
        product_options["enabled_variants"] = [int(variant)]
    except ValueError:
        pass
    if return_url:
        product_options["redirect_url"] = return_url + "/?payment=success"
        product_options["receipt_link_url"] = return_url + "/"
        product_options["receipt_button_text"] = "Slide Studio ga qaytish"
    attributes: Dict[str, Any] = {
        "product_options": product_options,
        "checkout_options": {"embed": False},
        "checkout_data": checkout_data,
    }
    if ls["test_mode"]:
        attributes["test_mode"] = True
    body = {"data": {
        "type": "checkouts",
        "attributes": attributes,
        "relationships": {
            "store": {"data": {"type": "stores", "id": str(ls["store_id"])}},
            "variant": {"data": {"type": "variants", "id": str(variant)}},
        },
    }}
    try:
        res = await asyncio.to_thread(_ls_post_checkout, ls["api_key"], body)
    except Exception as e:
        return 502, {"error": f"Lemon Squeezy ga ulanib bo'lmadi: {str(e)[:200]}"}
    if "json" in res:
        url = ((res["json"].get("data") or {}).get("attributes") or {}).get("url")
        if url:
            return 200, {"checkout_url": url, "pages": pack_pages(), "price_usd": CHECKOUT_PRICE_USD, "product": "pack"}
        return 502, {"error": "Lemon Squeezy checkout URL qaytarmadi"}
    code = res.get("status")
    print(f"[LEMON CHECKOUT] HTTP {code}: {res.get('error_body')}")
    if code == 404:
        msg = "Lemon Squeezy: do'kon yoki variant topilmadi (STORE_ID / VARIANT_ID ni tekshiring; variant 'Published' bo'lishi va API kalit bilan bir rejimda — test/live — bo'lishi kerak)."
    elif code in (401, 403):
        msg = "Lemon Squeezy API kaliti noto'g'ri yoki ruxsati yo'q (LEMON_SQUEEZY_API_KEY)."
    elif code == 422:
        msg = "Lemon Squeezy so'rovni qabul qilmadi (422)."
    else:
        msg = f"Lemon Squeezy xatosi (HTTP {code})."
    return 502, {"error": msg, "ls_status": code, "detail": res.get("error_body", "")[:300]}


async def _checkout_for_bot(user_id: str, email: str = "", return_url: str = "", product: str = "pack") -> dict:
    """v45: Telegram bot «To'ldirish» tugmasi uchun. {'url','pages','price'} yoki {'error'}."""
    code, data = await _build_checkout(user_id, (email or "").strip(), return_url, product)
    if code == 200:
        return {"url": data["checkout_url"], "pages": data.get("pages"), "days": data.get("days"), "price": data.get("price_usd"), "product": product}
    return {"error": data.get("error") or "checkout_error", "hint": data.get("hint") or data.get("detail") or ""}

_processed_orders: set = set()          # faqat DEV (Supabase yo'q) rejimi uchun

def _apply_payment_sync(key: str, user_id: str, pages: int, sign: int, event_name: str) -> dict:
    """ATOMIK + IDEMPOTENT: SQL funksiyasi public.apply_payment (SUPABASE_SCHEMA.sql, 10-bo'lim) bitta tranzaksiyada
    payment_events ga yozadi va balansni yangilaydi. Funksiya yo'q/xato bo'lsa — istisno ko'tariladi (webhook 500 qaytaradi,
    Lemon qayta yuboradi). Xotiraga tushib qolmaydi: restartdan keyin ham ikki marta hisoblanmaydi."""
    if not supabase:
        if os.environ.get("SLIDE_STUDIO_DEV_MODE", "").strip() != "1":
            raise RuntimeError("supabase_unavailable")
        if key in _processed_orders:
            return {"duplicate": True}
        _processed_orders.add(key)
        u = get_or_create_user_usage(user_id, "")
        u = remove_paid_credits(u, pages) if sign < 0 else add_paid_credits(u, pages)
        save_user_credits(user_id, u, 0)
        return {"duplicate": False}
    r = supabase.rpc("apply_payment", {
        "p_key": key, "p_user_id": str(user_id), "p_pages": int(pages),
        "p_units": int(pages) * UNIT, "p_sign": int(sign), "p_event": event_name,
    }).execute()
    data = r.data
    if isinstance(data, list):
        data = data[0] if data else {}
    return data if isinstance(data, dict) else {}

def _find_user_by_email(email: str) -> str:
    if not supabase or not email:
        return ""
    try:
        res = supabase.table("user_usage").select("user_id").eq("email", email).execute()
        if res.data and len(res.data) == 1:
            return str(res.data[0].get("user_id") or "")
    except Exception as e:
        print(f"[LEMON WEBHOOK] email qidiruv xatosi: {e}")
    return ""

def _int_or(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default

def _refunded_pages(order_id: str) -> int:
    """Shu buyurtma bo'yicha avval olingan (refund) varaqlar yig'indisi."""
    if not supabase or not order_id:
        return 0
    try:
        rows = supabase.table("payment_events").select("pages").like("order_id", f"refund-{order_id}%").execute().data or []
        return sum(_int_or(r.get("pages"), 0) for r in rows)
    except Exception as e:
        print(f"[LEMON WEBHOOK] refund tarixini o'qib bo'lmadi: {str(e)[:120]}")
        raise

_unmatched_notified: "OrderedDict[str, float]" = OrderedDict()

async def _report_unmatched_payment(order_id: str, event_name: str, email: str, attrs: dict) -> None:
    """Egasi topilmagan to'lov: log + admin_audit + adminlarga Telegram (bir buyurtma uchun bir marta)."""
    print(f"[LEMON WEBHOOK] ⚠️ user_id topilmadi! order={order_id} email={email} — qo'lda kredit bering.")
    if order_id in _unmatched_notified:
        return
    _unmatched_notified[order_id] = time.time()
    while len(_unmatched_notified) > 500:
        _unmatched_notified.popitem(last=False)
    details = {"order": order_id, "event": event_name, "email": email,
               "total": attrs.get("total"), "test_mode": attrs.get("test_mode")}
    try:
        await asyncio.to_thread(admin_core.audit, "lemon-webhook", "payment_unmatched", order_id, details)
    except Exception:
        pass
    if tgbot is not None:
        text = (f"⚠️ To'lov egasi topilmadi\nBuyurtma: {order_id}\nEmail: {email or '—'}\n"
                f"Hodisa: {event_name}\nVaraqlarni qo'lda bering (admin panel).")
        for tid in list(admin_core.admin_tg_ids()):
            try:
                await tgbot.admin_send(int(tid), text)
            except Exception:
                pass

@app.post("/api/payment/lemon-webhook")
@app.post("/webhook/lemonsqueezy")          # muqobil manzil: dashboard'da shu yozilgan bo'lsa ham ishlaydi
async def lemon_webhook(request: Request):
    """Lemon Squeezy: order_created(paid) → paid_credits += 200; order_refunded → qaytarib olinadi."""
    import hmac, hashlib
    raw = await request.body()
    ls = _ls_env()
    dev = os.environ.get("SLIDE_STUDIO_DEV_MODE", "").strip() == "1"

    if not ls["secret"]:
        if not dev:
            print("[LEMON WEBHOOK] LEMON_SQUEEZY_WEBHOOK_SECRET yo'q — so'rov rad etildi.")
            return JSONResponse({"error": "webhook secret sozlanmagan"}, status_code=503)
    else:
        sig = (request.headers.get("X-Signature") or "").strip()
        digest = hmac.new(ls["secret"].encode(), raw, hashlib.sha256).hexdigest()
        if not sig or not hmac.compare_digest(sig, digest):
            print("[LEMON WEBHOOK] noto'g'ri imzo — rad etildi.")
            return JSONResponse({"error": "invalid signature"}, status_code=401)
    try:
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    meta = event.get("meta") or {}
    event_name = (request.headers.get("X-Event-Name") or meta.get("event_name") or "").strip()
    data = event.get("data") or {}
    attrs = data.get("attributes") or {}
    order_id = str(data.get("id") or "")
    if event_name not in ("order_created", "order_refunded"):
        return {"ok": True, "ignored": event_name}

    item = attrs.get("first_order_item") or {}
    vid = str(item.get("variant_id") or "")
    cust_product = str(((meta.get("custom_data") or {}).get("product")) or "")
    if ls["variant_id"] and vid not in (ls["variant_id"], "") and cust_product != "pack":
        print(f"[LEMON WEBHOOK] boshqa mahsulot (variant {vid}) — e'tiborsiz qoldirildi. Sizniki bo'lsa LEMON_SQUEEZY_VARIANT_ID ni tekshiring.")
        return {"ok": True, "ignored": "other_variant"}     # bizning checkout (custom_data.product=pack) har doim hisoblanadi
    try:
        qty = max(1, min(10, int(item.get("quantity") or 1)))
    except (TypeError, ValueError):
        qty = 1
    pages = pack_pages() * qty

    if not order_id:
        # order_id siz idempotentlik (qayta yuborilganda 2 marta hisoblamaslik) kafolatlanmaydi
        print(f"[LEMON WEBHOOK] ⚠️ order_id yo'q ({event_name}) — rad etildi.")
        return JSONResponse({"error": "missing order id"}, status_code=400)

    user_id = str(((meta.get("custom_data") or {}).get("user_id")) or "").strip()
    if not user_id or user_id == "unknown":
        user_id = await asyncio.to_thread(_find_user_by_email, str(attrs.get("user_email") or "").strip())
    if not user_id:
        # v53: 200 qaytarilsa Lemon qayta yubormaydi va to'lov JIMGINA yo'qolardi.
        # Endi: admin_audit ga yoziladi, adminlarga Telegram xabari, 500 -> Lemon qayta yuboradi
        # (shu orada foydalanuvchi ro'yxatdan o'tsa, email bo'yicha topiladi).
        await _report_unmatched_payment(order_id, event_name, str(attrs.get("user_email") or ""), attrs)
        return JSONResponse({"error": "user not found"}, status_code=500)

    if event_name == "order_created" and attrs.get("status") not in ("paid", None):
        return {"ok": True, "ignored": f"status={attrs.get('status')}"}

    sign = -1 if event_name == "order_refunded" else 1
    if sign > 0:
        key = f"order-{order_id}"
    else:
        # v53: qisman refund — faqat qaytarilgan ulushga mos varaq olinadi (avval butun paket olinardi).
        # Lemon har refundda JAMI qaytarilgan summani yuboradi -> kalit summaga bog'liq, avvalgi refundlar ayiriladi.
        refunded = _int_or(attrs.get("refunded_amount"), 0)
        total = _int_or(attrs.get("total"), 0)
        target = pages if (refunded <= 0 or total <= 0 or refunded >= total) else (pages * refunded) // total
        already = await asyncio.to_thread(_refunded_pages, order_id)
        pages = max(0, target - already)
        if pages <= 0:
            return {"ok": True, "duplicate": True}
        key = f"refund-{order_id}-{refunded}" if refunded > 0 else f"refund-{order_id}"
    try:
        async with _user_lock(user_id):       # bot/sayt bilan BIR XIL lock (qarang tgbot.configure(user_lock=...))
            u = await asyncio.to_thread(get_or_create_user_usage, user_id, str(attrs.get("user_email") or ""))   # qator borligiga ishonch
            res = await asyncio.to_thread(_apply_payment_sync, key, user_id, pages, sign, event_name)
            if res.get("duplicate"):
                return {"ok": True, "duplicate": True}
            u = await asyncio.to_thread(get_or_create_user_usage, user_id, str(attrs.get("user_email") or ""))
            await asyncio.to_thread(
                ledger_log, user_id, "refund" if sign < 0 else "purchase",
                sign * pages * UNIT, u, 0, {"order": order_id})
        print(f"[LEMON WEBHOOK] {event_name}: {'-' if sign < 0 else '+'}{pages} -> {user_id} (test={attrs.get('test_mode')})")
        try:   # Telegram foydalanuvchisiga darhol xabar (balans bazada allaqachon yangilangan)
            if tgbot is not None:
                asyncio.create_task(tgbot.notify_purchase(str(user_id), pages, sign < 0))
        except Exception:
            pass
        return {"ok": True, "user_id": user_id, "paid_credits": u.get("paid_credits"), "pages": pages}
    except Exception as e:
        # 5xx -> Lemon Squeezy webhookni qayta yuboradi (idempotent, shuning uchun xavfsiz)
        print(f"[LEMON WEBHOOK] xato: {type(e).__name__}: {str(e)[:200]}")
        return JSONResponse({"error": "temporary_error"}, status_code=500)

# ---------------------------------------------------------------------------------------------
# v47: REKLAMA (sayt chap paneli + bot), ADMIN kirish punkti
# ---------------------------------------------------------------------------------------------
_adfree_cache: Dict[str, Any] = {}

def _bearer(request: Request, fallback: str = "") -> str:
    h = (request.headers.get("authorization") or "").strip()
    if h.lower().startswith("bearer "):
        return h[7:].strip()
    return (fallback or "").strip()

def _ad_free_for_token(token: str) -> bool:
    """Token → reklamasiz (Pro/VIP/admin/cheksiz)mi? 60 soniya keshlanadi. Mehmon (token yo'q) → False."""
    if not token or token == "dev-token" or not supabase:
        return False
    hit = _adfree_cache.get(token)
    if hit and time.time() - hit[1] < 60:
        return hit[0]
    ok = False
    try:
        r = supabase.auth.get_user(token)
        if r and r.user:
            u = get_or_create_user_usage(r.user.id, r.user.email or "")
            ok = bool(is_ad_free(u))
            if not ok:       # v49.3: admin (Telegram ID + ulangan Google) reklama ko'rmaydi
                try:
                    lk = admin_core._linked_row_by_uid(str(r.user.id))
                    ok = bool(lk and admin_core.is_tg_admin(lk.get("tg_id")))
                except Exception:
                    ok = False
    except Exception:
        ok = False
    if len(_adfree_cache) > 3000:
        _adfree_cache.clear()
    _adfree_cache[token] = (ok, time.time())
    return ok

@app.get("/api/ads/next")
async def ads_next(request: Request, surface: str = "site", token: str = "", exclude: int = 0):
    """Sayt reklamasi. Pro/VIP/admin uchun har doim {"ad": null}."""
    tok = _bearer(request, token)
    ad_free = await asyncio.to_thread(_ad_free_for_token, tok)
    row = None if ad_free else await asyncio.to_thread(ads_mod.pick, "site", False, exclude or None)
    if not row:
        return JSONResponse({"ad": None}, headers={"Cache-Control": "no-store"})
    if not exclude or int(row["id"]) != int(exclude):      # v51: o'sha reklama allaqachon ko'rinib turgan bo'lsa (60 s so'rov) qayta sanalmaydi
        asyncio.get_running_loop().run_in_executor(None, ads_mod.bump, int(row["id"]), "impression")
    return JSONResponse({"ad": ads_mod.public(row, "site")}, headers={"Cache-Control": "no-store"})

@app.get("/api/notice/next")
async def notice_next(exclude: str = ""):
    """v55: sayt e'loni (reklamasiz popup). Hammaga ko'rsatiladi (VIP ham) — brauzer ko'rganlarini o'zi eslab qoladi."""
    # v56: FAQAT eng oxirgi faol e'lon. Bir nechta e'lon yuborilgan bo'lsa-yu odam ko'rmagan bo'lsa — eskilari chiqmaydi,
    # faqat oxirgisi. Ko'rgan bo'lsa (exclude) — hech narsa. Bekor qilinsa — {"notice": null} va ochiq popup yopiladi.
    seen = {int(x) for x in (exclude or "").split(",")[:50] if x.strip().isdigit()}
    rows = await asyncio.to_thread(ads_mod._load)
    now = ads_mod._now()
    pool = [r for r in rows if ads_mod._eligible(r, "site", now) and ads_mod.kind_of(r) == "notice"]
    if not pool:
        return JSONResponse({"notice": None}, headers={"Cache-Control": "no-store"})
    row = max(pool, key=lambda r: int(r["id"]))
    if int(row["id"]) in seen:
        return JSONResponse({"notice": None, "latest": int(row["id"])}, headers={"Cache-Control": "no-store"})
    asyncio.get_running_loop().run_in_executor(None, ads_mod.bump, int(row["id"]), "impression")
    return JSONResponse({"notice": ads_mod.public(row, "site")}, headers={"Cache-Control": "no-store"})

@app.get("/api/ads/click/{ad_id}")
async def ads_click(ad_id: int, s: str = "site"):
    row = await asyncio.to_thread(ads_mod.get_row, ad_id)
    link = str((row or {}).get("link_url") or "")
    if not row or not ads_mod.valid_http_url(link):
        raise HTTPException(404, "Topilmadi")
    asyncio.get_running_loop().run_in_executor(None, ads_mod.bump, int(ad_id), "click")
    return RedirectResponse(link, status_code=302, headers={"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})

def _parse_range(header: str, n: int):
    """HTTP Range (bitta oraliq). None = Range yo'q / tushunarsiz (to'liq fayl), "invalid" = 416, aks holda (a, b)."""
    m = _re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", header or "")
    if not m or not (m.group(1) or m.group(2)):
        return None
    if n <= 0:
        return "invalid"
    if m.group(1):
        a = int(m.group(1))
        b = min(int(m.group(2)), n - 1) if m.group(2) else n - 1
    else:                                   # "bytes=-500" — oxirgi 500 bayt
        suffix = int(m.group(2))
        if suffix == 0:
            return "invalid"
        a, b = max(0, n - suffix), n - 1
    if a >= n or a > b:
        return "invalid"
    return a, b

@app.get("/api/ads/media/{ad_id}")
async def ads_media(ad_id: int, request: Request):
    row = await asyncio.to_thread(ads_mod.get_row, ad_id)
    if not row or not row.get("active"):
        raise HTTPException(404, "Topilmadi")
    u = str(row.get("media_url") or "")
    hdr = {"Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes"}
    if u.startswith("tg:"):
        if tgbot is None:                    # v53: bot o'chiq — 500 emas, 404
            raise HTTPException(404, "Fayl topilmadi")
        got = await tgbot.fetch_ad_file(u[3:])
        if not got:
            raise HTTPException(404, "Fayl topilmadi")
        data, mime = got
        rng = _parse_range(request.headers.get("range", ""), len(data))
        if rng == "invalid":
            return Response(status_code=416, headers={**hdr, "Content-Range": f"bytes */{len(data)}"})
        if rng:
            a, b = rng
            return Response(content=data[a:b + 1], status_code=206, media_type=mime,
                            headers={**hdr, "Content-Range": f"bytes {a}-{b}/{len(data)}"})
        return Response(content=data, media_type=mime, headers=hdr)
    dec = ads_mod.decode_data_url(u)
    if not dec:
        raise HTTPException(404, "Topilmadi")
    data, mime = dec
    return Response(content=data, media_type=mime, headers=hdr)

@app.post("/api/me/admin-entry")
async def me_admin_entry(payload: Dict[str, Any] = None):
    """Faqat tasdiqlangan admin (Google admin emaili + unga ulangan admin Telegram) uchun yashirin panel havolasi.
    Boshqalarga HAR DOIM 404 — panel mavjudligi bilinmaydi."""
    nf = JSONResponse({"detail": "Not Found"}, status_code=404)
    token = str((payload or {}).get("token") or "").strip()
    if not token or token == "dev-token" or not supabase:
        return nf
    try:
        r = await asyncio.to_thread(supabase.auth.get_user, token)
        if not r or not r.user:
            return nf
        chk = await asyncio.to_thread(admin_core.check_admin_user, str(r.user.id), r.user.email or "")
    except Exception:
        return nf
    if not chk.get("ok"):
        return nf
    return {"url": "/_a/" + admin_core.make_token(chk["tg_id"], chk["email"])}


import ipaddress, socket, urllib.request, urllib.parse, urllib.error
MAX_PROXY_IMAGE_BYTES = 15 * 1024 * 1024  # v26: 8MB dan katta rasmlar (AI fon) uchun

class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    """v37: redirect orqali ichki tarmoqqa (127.0.0.1, 169.254.x.x ...) o'tishni to'sadi (SSRF)."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        p = urllib.parse.urlparse(newurl)
        if p.scheme not in ("http", "https") or not p.hostname or not _is_public_host(p.hostname):
            raise urllib.error.URLError("redirect rad etildi")
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def _ip_is_public(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(str(ip_str).split("%")[0])
    except ValueError:
        return False
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
                or ip.is_multicast or ip.is_unspecified)

def _is_public_host(host: str) -> bool:
    try:
        for info in socket.getaddrinfo(host, None):
            if not _ip_is_public(info[4][0]):
                return False
        return True
    except Exception:
        return False

# v53: DNS rebinding himoyasi. _is_public_host() nomni tekshiradi, lekin urllib ulanishda nomni QAYTA so'raydi —
# shu orada DNS ichki IP qaytarsa (127.0.0.1, 169.254.169.254 ...) tekshiruv aylanib o'tilardi.
# Endi ulanish o'rnatilgach soketning HAQIQIY manzili tekshiriladi. Proksi orqali ulanishda (tunnel) tekshirilmaydi.
import http.client as _http_client

def _check_peer(conn) -> None:
    try:
        ip = conn.sock.getpeername()[0]
    except Exception:
        return
    if not _ip_is_public(ip):
        try:
            conn.sock.close()
        except Exception:
            pass
        raise urllib.error.URLError("ichki tarmoq manziliga ulanish rad etildi")

class _SafeHTTPConnection(_http_client.HTTPConnection):
    def connect(self):
        super().connect()
        _check_peer(self)

class _SafeHTTPSConnection(_http_client.HTTPSConnection):
    def connect(self):
        super().connect()
        if not getattr(self, "_tunnel_host", None):
            _check_peer(self)

class _SafeHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_http_client.HTTPConnection if req.has_proxy() else _SafeHTTPConnection, req)

class _SafeHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_SafeHTTPSConnection, req, context=self._context)

_SAFE_OPENER = urllib.request.build_opener(_SafeRedirect(), _SafeHTTPHandler(), _SafeHTTPSHandler())

def _sniff_image_mime(data: bytes, fallback: str = "") -> str:
    """Magic-bytes asosida MIME. GIF har doim image/gif — animatsiya yo'qolmasin."""
    if not data:
        return fallback if fallback.startswith("image/") else ""
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:2] == b"BM":
        return "image/bmp"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if data[:5] == b"<?xml" or data[:4] == b"<svg" or data[:5] == b"<SVG ":
        return "image/svg+xml"
    head = data[:64].lstrip().lower()
    if head.startswith((b"<!doctype", b"<html", b"<head", b"<?xml")):
        return ""
    if fallback and fallback.startswith("image/"):
        return fallback
    return ""

def _fetch_image_sync_impl(url: str) -> dict:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return {"error": "Noto'g'ri URL"}
    if not _is_public_host(parsed.hostname):
        return {"error": "Bu manzilga ruxsat yo'q"}

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": f"{parsed.scheme}://{parsed.hostname}/",
    }
    if parsed.hostname.endswith(("wikimedia.org", "wikipedia.org")):
        # Wikimedia siyosati: tavsiflovchi User-Agent shart, aks holda 429 beradi
        headers = {"User-Agent": "SlideStudio/24 (slide editor; contact: admin@localhost) python-urllib",
                   "Accept": "image/*,*/*;q=0.8"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with _SAFE_OPENER.open(req, timeout=20) as r:
            header_ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            data = r.read(MAX_PROXY_IMAGE_BYTES + 1)
            if len(data) > MAX_PROXY_IMAGE_BYTES:
                return {"error": f"Rasm juda katta ({MAX_PROXY_IMAGE_BYTES // (1024*1024)}MB dan oshdi)"}
            final_url = r.geturl() or url
        ctype = _sniff_image_mime(data, header_ctype)
        if not ctype:
            if data[:6] in (b"GIF87a", b"GIF89a"):
                ctype = "image/gif"
            elif len(data) > 100 and header_ctype.startswith("image/"):
                ctype = header_ctype
            else:
                preview = data[:80].decode("utf-8", errors="replace").replace("\n", " ")
                return {"error": f"URL rasm emas ({header_ctype or 'unknown'}). Boshlanishi: {preview[:60]}"}

        if data[:6] in (b"GIF87a", b"GIF89a"):
            ctype = "image/gif"
        return {"data": data, "content_type": ctype, "final_url": final_url}
    except urllib.error.HTTPError as e:
        ra = 0
        try:
            ra = int(float(e.headers.get("Retry-After") or 0))
        except Exception:
            ra = 0
        return {"error": f"Rasm olinmadi: HTTP Error {e.code}: {e.reason}", "status": int(e.code), "retry_after": ra}
    except Exception as e:
        return {"error": f"Rasm olinmadi: {e}"}


# ---------------------------------------------------------------------------------------------
# v38: SERVERDA DISKKA HECH NARSA YOZILMAYDI (.img_cache butunlay olib tashlandi).
# Rasm / GIF / video lar foydalanuvchining O'Z brauzeri xotirasida (RAM, MediaRAM) saqlanadi va
# CDN dan brauzerning o'zi to'g'ridan-to'g'ri oladi. Bu proksi faqat CORS ruxsat bermaydigan
# saytlar uchun ZAXIRA yo'l. Javoblar qisqa muddatli, hajmi qat'iy chegaralangan RAM keshida turadi.
# ---------------------------------------------------------------------------------------------
_IMG_CACHE: "OrderedDict[str, tuple]" = OrderedDict()      # url -> (vaqt, natija)
_IMG_CACHE_BYTES = 0
_IMG_CACHE_MAX_BYTES = max(4, _env_int("IMG_PROXY_CACHE_MB", 32)) * 1024 * 1024
_IMG_CACHE_TTL_OK = 600          # muvaffaqiyatli javob: 10 daqiqa
_IMG_LOCK = threading.Lock()

_HOST_SEM: Dict[str, threading.Semaphore] = {}
_HOST_LAST: Dict[str, float] = {}
_HOST_LOCK = threading.Lock()


_HOST_MAX = 500           # v53: har yangi domen uchun yozuv qo'shilardi va hech qachon o'chmasdi (xotira sekin o'sardi)
_HOST_IDLE = 300.0        # shu vaqt ichida so'rov bo'lmagan domen o'chiriladi (fetch + qayta urinishlar < 90 s)

def _prune_hosts_locked(now: float) -> None:
    """_HOST_LOCK ushlab turilganda chaqiriladi: uzoq ishlatilmagan domenlarni olib tashlaydi."""
    for h in [h for h, t in _HOST_LAST.items() if now - t > _HOST_IDLE]:
        _HOST_LAST.pop(h, None)
        _HOST_SEM.pop(h, None)

def _host_slot(host: str):
    """Bir xostga bir vaqtda ko'pi bilan 3 ta so'rov va so'rovlar orasida >= 0.2 s (429 ni oldini oladi)."""
    with _HOST_LOCK:
        sem = _HOST_SEM.get(host)
        if sem is None:
            if len(_HOST_SEM) > _HOST_MAX:
                _prune_hosts_locked(time.time())
            sem = threading.Semaphore(3)
            _HOST_SEM[host] = sem
    sem.acquire()
    with _HOST_LOCK:
        last = _HOST_LAST.get(host, 0.0)
        wait = 0.2 - (time.time() - last)
        _HOST_LAST[host] = time.time() + max(0.0, wait)
    if wait > 0:
        time.sleep(wait)
    return sem


def _mirror_urls(url: str) -> list:
    """GIF CDN lari 429 bersa — shu faylning boshqa (ekvivalent) xostlarini ham sinaymiz."""
    try:
        p = urllib.parse.urlparse(url)
        h = (p.hostname or "").lower()
        out = [url]
        def swap(newh):
            return urllib.parse.urlunparse((p.scheme, newh + (":" + str(p.port) if p.port else ""), p.path, p.params, p.query, p.fragment))
        if h.endswith("giphy.com"):
            for nh in ("media.giphy.com", "media0.giphy.com", "media1.giphy.com", "media2.giphy.com", "media3.giphy.com", "media4.giphy.com", "i.giphy.com"):
                if nh != h:
                    out.append(swap(nh))
        elif h in ("media.tenor.com", "c.tenor.com", "media1.tenor.com"):
            for nh in ("media.tenor.com", "c.tenor.com"):
                if nh != h:
                    out.append(swap(nh))
        return out[:5]
    except Exception:
        return [url]


def _fetch_with_backoff(url: str) -> dict:
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    res = {"error": "Rasm olinmadi"}
    for attempt in range(3):
        sem = _host_slot(host)
        try:
            res = _fetch_image_sync_impl(url)
        finally:
            sem.release()
        if not res.get("error"):
            return res
        st = int(res.get("status") or 0)
        if st in (429, 503) or "timed out" in str(res.get("error")).lower():
            delay = min(6.0, max(float(res.get("retry_after") or 0), 1.2 * (attempt + 1)))
            time.sleep(delay)
            continue
        return res
    return res


def _cache_get(url: str):
    now = time.time()
    with _IMG_LOCK:
        hit = _IMG_CACHE.get(url)
        if not hit:
            return None
        ts, res = hit
        ttl = _IMG_CACHE_TTL_OK if "data" in res else (6 if "429" in str(res.get("error")) else 30)
        if now - ts >= ttl:
            _cache_drop(url)
            return None
        _IMG_CACHE.move_to_end(url)
        return res


def _cache_drop(url: str):
    """_IMG_LOCK ushlab turilganda chaqiriladi."""
    global _IMG_CACHE_BYTES
    old = _IMG_CACHE.pop(url, None)
    if old and "data" in old[1]:
        _IMG_CACHE_BYTES -= len(old[1]["data"])


def _cache_put(url: str, res: dict):
    global _IMG_CACHE_BYTES
    size = len(res.get("data") or b"")
    if size > _IMG_CACHE_MAX_BYTES // 2:      # juda katta fayl keshga olinmaydi (RAM ni to'ldirib yubormasin)
        return
    with _IMG_LOCK:
        _cache_drop(url)
        _IMG_CACHE[url] = (time.time(), res)
        _IMG_CACHE_BYTES += size
        while _IMG_CACHE_BYTES > _IMG_CACHE_MAX_BYTES or len(_IMG_CACHE) > 400:
            k = next(iter(_IMG_CACHE))
            _cache_drop(k)


def _fetch_image_sync(url: str) -> dict:
    """Natija: {"data": bytes, "content_type", "final_url"} yoki {"error": ...}.
    Faqat qisqa muddatli RAM kesh; 429 bo'lsa kutib 3 martagacha qayta uriniladi, GIF CDN larida boshqa xostlar ham sinaladi."""
    hit = _cache_get(url)
    if hit:
        return hit
    res = {"error": "Rasm olinmadi"}
    for cand in _mirror_urls(url):
        res = _fetch_with_backoff(cand)
        if not res.get("error"):
            break
    _cache_put(url, res)
    return res

# v53: proksilar faylni to'liq RAM'ga o'qiydi (rasm <=15 MB, video <=90 MB). Bir vaqtdagi yuklashlar soni cheklanadi —
# aks holda bir nechta parallel so'rov serverni xotirasiz qoldirardi (Render free = 512 MB -> OOM restart).
PROXY_IMAGE_CONCURRENCY = max(1, _env_int("PROXY_IMAGE_CONCURRENCY", 6))
PROXY_VIDEO_CONCURRENCY = max(1, _env_int("PROXY_VIDEO_CONCURRENCY", 1))
PROXY_QUEUE_TIMEOUT = 20.0
_PROXY_IMG_SEM = asyncio.Semaphore(PROXY_IMAGE_CONCURRENCY)
_PROXY_VID_SEM = asyncio.Semaphore(PROXY_VIDEO_CONCURRENCY)

async def _proxy_slot(sem: asyncio.Semaphore) -> None:
    """Navbat: bo'sh joy kutiladi; PROXY_QUEUE_TIMEOUT dan oshsa 503 (server band)."""
    try:
        await asyncio.wait_for(sem.acquire(), timeout=PROXY_QUEUE_TIMEOUT)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=503, detail="Server band. Birozdan keyin qayta urinib ko'ring.",
                            headers={"Retry-After": "10"})

@app.get("/api/proxy-image")
async def proxy_image(url: str, raw: int = 0):
    url = (url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url bo'sh")

    if url.startswith("http%3A") or url.startswith("https%3A"):
        try:
            url = urllib.parse.unquote(url)
        except Exception:
            pass
    res = _cache_get(url)                     # RAM keshida bo'lsa navbat kutilmaydi
    if not res:
        await _proxy_slot(_PROXY_IMG_SEM)
        try:
            res = await asyncio.to_thread(_fetch_image_sync, url)
        finally:
            _PROXY_IMG_SEM.release()
    if res.get("error"):
        if raw:
            raise HTTPException(status_code=400, detail=res["error"])
        return JSONResponse({"error": res["error"]}, status_code=200)
    data = res.get("data") or b""
    ctype = res.get("content_type") or "image/png"
    if raw:
        return Response(
            content=data,
            media_type=ctype,
            headers={
                # brauzer o'z keshida (RAM) ushlab turadi — server qayta yuklanmaydi
                "Cache-Control": "public, max-age=86400, immutable",
                "Access-Control-Allow-Origin": "*",
                "Cross-Origin-Resource-Policy": "cross-origin",
                "Content-Security-Policy": "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'",
                "X-Content-Type-Options": "nosniff",
            },
        )
    return JSONResponse({
        "data_url": f"data:{ctype};base64," + base64.b64encode(data).decode(),
        "content_type": ctype,
        "final_url": res.get("final_url") or url,
    })

MAX_PROXY_VIDEO_BYTES = 90 * 1024 * 1024  # v42: PPTX ga joylash uchun onlayn MP4 (CORS bermaydigan saytlar)

def _fetch_video_sync(url: str) -> dict:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return {"error": "Noto'g'ri URL"}
    if not _is_public_host(parsed.hostname):
        return {"error": "Bu manzilga ruxsat yo'q"}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "video/mp4,video/*;q=0.9,*/*;q=0.5",
        "Referer": f"{parsed.scheme}://{parsed.hostname}/",
    }
    try:
        req = urllib.request.Request(url, headers=headers)
        with _SAFE_OPENER.open(req, timeout=30) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            clen = int(r.headers.get("Content-Length") or 0)
            if clen > MAX_PROXY_VIDEO_BYTES:
                return {"error": "Video juda katta"}
            data = r.read(MAX_PROXY_VIDEO_BYTES + 1)
        if len(data) > MAX_PROXY_VIDEO_BYTES:
            return {"error": "Video juda katta"}
        if data[4:8] == b"ftyp":
            ctype = "video/mp4"
        elif not ctype.startswith("video/"):
            return {"error": f"URL video emas ({ctype or 'unknown'})"}
        return {"data": data, "content_type": ctype}
    except Exception as e:
        return {"error": f"Video olinmadi: {e}"}

@app.get("/api/proxy-video")
async def proxy_video(url: str):
    url = (url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url bo'sh")
    await _proxy_slot(_PROXY_VID_SEM)
    try:
        res = await asyncio.to_thread(_fetch_video_sync, url)
    finally:
        _PROXY_VID_SEM.release()
    if res.get("error"):
        raise HTTPException(status_code=400, detail=res["error"])
    return Response(content=res["data"], media_type=res["content_type"],
                    headers={"Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff"})

def _fetch_json_sync(url: str, headers: Optional[Dict[str, str]] = None) -> dict:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return {"error": "Noto'g'ri URL"}
    if not _is_public_host(parsed.hostname):
        return {"error": "Bu manzilga ruxsat yo'q"}
    hdrs = {"User-Agent": "Mozilla/5.0 SlideStudio", "Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, headers=hdrs)
    try:
        with _SAFE_OPENER.open(req, timeout=12) as r:        # v53: redirect / DNS rebinding orqali ichki tarmoqqa o'tmaydi
            raw = r.read(4 * 1024 * 1024)
        return {"data": json.loads(raw.decode("utf-8", "replace"))}
    except Exception as e:
        return {"error": f"Qidiruv xatosi: {e}"}


# ----------------------------------------------------------------------------------------------
# v55: to'plamli rasm/GIF/video qidiruvi (Tez va Chuqur AI uchun BIR XIL)
# ----------------------------------------------------------------------------------------------
GIF_SAFE_POOL = [
    "https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif",
    "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
    "https://media.giphy.com/media/26BRv0ThxKQihlNO0/giphy.gif",
    "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif",
    "https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif",
    "https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif",
]
_ANIM_WORDS = ("gif", "animation", "animated", "loop", "motion", "spinner", "particles", "globe rotating", "loading")
SEARCH_STAGGER = 0.35          # v57: har qator kamida shuncha turadi — «birma-bir» ko'rinish (qidiruvlar baribir parallel)


def _tool_search_kind(query: str, kind: Any) -> str:
    k = str(kind or "").lower()
    k = "gif" if k == "gif" else ("video" if k == "video" else "photo")
    if k == "photo" and any(w in (query or "").lower() for w in _ANIM_WORDS):
        k = "gif"
    return k


def _search_note(kind: str, found: bool) -> str:
    if kind == "gif" and found:
        return ("MAJBURIY QOIDALAR (GIF): results[].url ni TO'G'RIDAN-TO'G'RI gifUrl yoki src ga yozing (https://media... bilan "
                "boshlanadi). Qidiruv matnini URL o'rniga YOZMANG. Har bir GIF uchun results dan bittadan boshqa URL tanlang. "
                "URL yo'q deb o'tkazib yubormang.")
    if kind == "video" and found:
        return ("Eng mos videoni tanlang va uning 'url' ini add_video (yoki orqa fon uchun set_background_video) ga bering. "
                "URL ni o'zgartirmang.")
    if found:
        return "Eng mos rasmni tanlang va uning 'url' ini ishlating. Natija mos bo'lmasa, boshqa so'rov bilan qayta qidiring."
    return "Hech narsa topilmadi — rasmsiz davom eting yoki boshqa (soddaroq) inglizcha so'rov bilan qayta qidiring."


def _retry_queries(q: str, kind: str) -> List[str]:
    """Topilmagan so'rov uchun soddaroq variantlar (birinchisi — eng yaqini)."""
    words = (q or "").split()
    alts = []
    if len(words) > 2:
        alts.append(" ".join(words[:2]))
    if len(words) > 1:
        alts.append(words[-1] if kind != "gif" else words[0])
    if kind == "gif":
        alts += ["funny animation", "happy"]
    out, seen = [], {(q or "").lower()}
    for a in alts:
        if a and a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out[:3]


async def _client_side_search_many(websocket, jobs: List[Tuple[int, str, str]], timeout: float = 14.0) -> Dict[int, list]:
    """Brauzerga hamma so'rovlarni BIRDANIGA yuboradi va javoblarni yig'adi. jobs: [(idx, query, kind)]."""
    if not jobs:
        return {}
    ids, out = {}, {}
    stamp = int(time.time() * 1000)
    for idx, q, kind in jobs:
        sid = f"b{idx}_{stamp}"
        ids[sid] = (idx, q)
        try:
            await websocket.send_json({"type": "search_request", "id": sid, "query": q, "kind": kind})
        except Exception:
            return out
    deadline = time.time() + timeout
    while len(out) < len(ids):
        left = deadline - time.time()
        if left <= 0:
            break
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=left)
        except asyncio.TimeoutError:
            break
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        hit = ids.get(msg.get("id")) if msg.get("type") == "search_result" else None
        if not hit:
            continue
        idx, q = hit
        res = []
        for r in (msg.get("results") or [])[:12]:
            u = str((r or {}).get("url") or "")
            if u.startswith("http"):
                res.append({"url": u[:600], "thumb": str(r.get("thumb") or "")[:600],
                            "title": str(r.get("title") or q)[:120], "source": "client"})
        out[idx] = res
    return out


async def _search_batch(websocket, jobs: List[Tuple[str, str]], client_search: bool = False, n0: int = 0,
                        per_query: int = 12, stagger: float = None) -> List[list]:
    """jobs: [(query, kind)] -> har biri uchun natijalar ro'yxati (tartib saqlanadi).
    v57: HAMMA qidiruv (va topilmaganida soddaroq so'rov bilan qayta urinish) bir vaqtda fonda ishlaydi,
    foydalanuvchiga esa natijalar BIRMA-BIR chiqadi: 1-qator «qidirilmoqda» → «topildi», keyin 2-qator va h.k.
    Umumiy vaqt ≈ eng sekin qidiruv + n × stagger (ketma-ket qidirishdan ancha tez)."""
    if not jobs:
        return []
    stagger = SEARCH_STAGGER if stagger is None else stagger

    async def ev(payload: dict) -> None:
        if websocket is None:
            return
        try:
            await websocket.send_json(payload)
        except (WebSocketDisconnect, RuntimeError):
            raise WebSocketDisconnect()
        except Exception:
            pass

    async def server_one(q: str, kind: str) -> list:
        if not _search_images_sync:
            return []
        try:
            r = await asyncio.wait_for(asyncio.to_thread(_search_images_sync, q, kind, per_query), timeout=25)
            return r if isinstance(r, list) else []
        except Exception as e:
            print(f"[IMG-SEARCH] {q!r}: {type(e).__name__}")
            return []

    async def with_retry(q: str, kind: str, first: Optional[list]) -> list:
        """Bitta so'rov: (brauzer natijasi bo'lmasa) server qidiruvi, bo'sh bo'lsa soddaroq variantlar PARALLEL."""
        res = first or await server_one(q, kind)
        if not res:
            alts = _retry_queries(q, kind)
            if alts:
                outs = await asyncio.gather(*[server_one(a, kind) for a in alts], return_exceptions=True)
                res = next((o for o in outs if isinstance(o, list) and o), [])
        if not res and kind == "gif":
            res = [{"url": u, "title": "safe", "source": "safe_pool"} for u in GIF_SAFE_POOL]
        return res

    pre: Dict[int, list] = {}
    if client_search and websocket is not None:     # brauzer qidiruvi — hammasi birdaniga so'raladi
        pre = await _client_side_search_many(websocket, [(i, q, k) for i, (q, k) in enumerate(jobs) if k != "video"])
    tasks = [asyncio.ensure_future(with_retry(q, k, pre.get(i))) for i, (q, k) in enumerate(jobs)]
    results: List[list] = [[] for _ in jobs]
    try:
        for i, (q, k) in enumerate(jobs):
            await ev({"type": "search_start", "query": q, "kind": k, "n": n0 + i + 1})
            t0 = time.monotonic()
            try:
                r = await tasks[i]
            except Exception:
                r = []
            results[i] = r if isinstance(r, list) else []
            if stagger:                                    # «birma-bir» ko'rinishi: har qator kamida stagger turadi
                left = stagger - (time.monotonic() - t0)
                if left > 0:
                    await asyncio.sleep(left)
            await ev({"type": "search_done", "query": q, "kind": k, "count": len(results[i])})
    finally:
        for t in tasks:
            if not t.done():
                t.cancel()
    return results


async def _client_side_search(websocket, q: str, kind: str, n: int, timeout: float = 14.0):
    sid = f"s{n}_{int(time.time() * 1000)}"
    try:
        await websocket.send_json({"type": "search_request", "id": sid, "query": q, "kind": kind})
    except Exception:
        return []
    deadline = time.time() + timeout
    while True:
        left = deadline - time.time()
        if left <= 0:
            return []
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=left)
        except asyncio.TimeoutError:
            return []
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        if msg.get("type") == "search_result" and msg.get("id") == sid:
            out = []
            for r in (msg.get("results") or [])[:12]:
                u = str((r or {}).get("url") or "")
                if u.startswith("http"):
                    out.append({"url": u[:600], "thumb": str(r.get("thumb") or "")[:600],
                                "title": str(r.get("title") or q)[:120], "source": "client"})
            return out

@app.get("/api/client-keys")
async def client_keys():
    k = ""  # Tenor API 2026-06-30 da yopilgan; moslik uchun endpoint qoldirildi
    return JSONResponse({"tenor": k}, headers={"Cache-Control": "private, max-age=3600"})

@app.get("/api/media-search")
async def media_search(provider: str = "image", q: str = "", limit: int = 24, page: int = 1):
    _prov = (provider or "").lower()
    kind = "gif" if _prov in ("tenor", "giphy", "gif", "gifs") else ("video" if _prov in ("video", "videos") else "image")
    try:
        limit = max(1, min(int(limit), 60))
    except Exception:
        limit = 24
    try:
        page = max(1, int(page))
    except Exception:
        page = 1
    try:
        payload = await asyncio.to_thread(media_search_impl, kind, q, limit, page)
    except Exception as e:
        print(f"[MEDIA] qidiruv xatosi: {e}")
        return JSONResponse({"error": f"Qidiruv xatosi: {e}", "results": []})
    if not payload.get("results"):
        payload["warning"] = "no_results_check_api_keys"
        print(f"[MEDIA] {kind} '{q}' natija yo'q. Xatolar: {payload.get('errors')}. "
              "KLIPY_API_KEY / GIPHY_API_KEY / PEXELS_API_KEY / PIXABAY_API_KEY ni .env ga qo'shing.")
    return JSONResponse(payload, headers={"Cache-Control": "public, max-age=120" if payload.get("results") else "no-store"})

@app.get("/api/video-check")
async def video_check(id: str = ""):
    """YouTube videoId mavjud va joylashtiriladimi (AI o'ylab topgan ID larni tekshirish)."""
    import re as _re
    if not _re.fullmatch(r"[\w-]{11}", id or ""):
        return JSONResponse({"ok": False})
    from backend.media_search import check_youtube
    ok = await asyncio.to_thread(check_youtube, id)
    return JSONResponse({"ok": bool(ok)}, headers={"Cache-Control": "public, max-age=600"})

try:
    from backend.community import register_community
    register_community(app, {
        "get_supabase": lambda: supabase,
        "user_lock": _user_lock,
        "get_or_create_user_usage": get_or_create_user_usage,
        "save_user_credits": save_user_credits,
        "update_usage_atomic": update_usage_atomic,
        "add_paid_credits": add_paid_credits,
        "notify": (lambda uid, text: tgbot.notify_user(uid, text)) if tgbot is not None else None,
    })
except Exception as _cm_err:
    print(f"[COMMUNITY] yuklanmadi: {_cm_err}")

PUBLIC_STATIC_FILES = {
        "index.html", "styles.css", "mobile.css", "v38.css", "v39.css", "v40.css", "v54.css",
        "favicon.ico", "logo.png", "manifest.json",
        "terms.html", "privacy.html", "refund.html",
    }

@app.get("/{filename}")
def static_file(filename: str):
    if filename not in PUBLIC_STATIC_FILES:
        raise HTTPException(404, "Fayl topilmadi")
    if filename == "index.html":
        return _index_response()
    path = os.path.join(BASE_DIR, filename)
    if os.path.isfile(path):
        return FileResponse(path)
    raise HTTPException(404, "Fayl topilmadi")

def _tenor_search_direct_gif(query: str) -> str:
    return first_gif_url(query)

def _query_from_bad_gif_url(url: str) -> str:
    """Sahifa/buzilgan GIF URL dan qidiruv so'rovini chiqaradi."""
    if not url:
        return "funny animation"
    try:
        import re as _re2
        m = _re2.search(r"tenor\.com/view/([^/?#]+)", url, _re2.I)
        if m:
            return _re2.sub(r"-gif-\d+$", "", m.group(1), flags=_re2.I).replace("-", " ").strip() or "animation"
        m = _re2.search(r"giphy\.com/gifs/([^/?#]+)", url, _re2.I)
        if m:
            return m.group(1).replace("-", " ").strip() or "animation"
        m = _re2.search(r"/([^/?#]+)(?:\?|#|$)", url)
        if m:
            s = m.group(1).replace("-", " ").replace("_", " ")
            s = _re2.sub(r"\.\w+$", "", s).strip()
            if len(s) >= 2:
                return s
    except Exception:
        pass
    return "funny animation"

async def _fix_gif_urls_in_reply(model: str, full_reply: str) -> str:
    """
    Buzuq GIF URL'larni AI'ga QAYTA SO'RAMASDAN Tenor API orqali to'g'rilaydi.
    Bu 10-slaydli generatsiyada qayta yasash / ikki marta ishlashni oldini oladi.
    """
    if not full_reply:
        return full_reply
    bad = _extract_bad_gif_urls(full_reply)
    if not bad:
        return full_reply
    fixed_reply = full_reply
    for bu in bad:
        q = _query_from_bad_gif_url(bu)
        good = await asyncio.to_thread(_tenor_search_direct_gif, q)
        if not good:
            good = GIF_FALLBACK_URL
        fixed_reply = fixed_reply.replace(bu, good)
        print(f"[GIF-FIX-TENOR] {bu[:60]}... → {good[:60]}... (q={q})")

    for bu in _extract_bad_gif_urls(fixed_reply):
        fixed_reply = fixed_reply.replace(bu, GIF_FALLBACK_URL)
    return fixed_reply

def _ws_origin_ok(ws: WebSocket) -> bool:
    org = (ws.headers.get("origin") or "").strip().rstrip("/")
    if not org:
        return True
    host = (ws.headers.get("x-forwarded-host") or ws.headers.get("host") or "").split(",")[0].strip()
    try:
        o_host = urllib.parse.urlparse(org).netloc
    except Exception:
        return False
    return o_host == host or org in _ALLOWED_ORIGINS

# ---------------------------------------------------------------------------------------------
# v52: DeepSeek — BITTA umumiy AsyncOpenAI (httpx connection pool: TLS qayta qo'lsiz) + navbat (queue)
#   DEEPSEEK_CONCURRENCY  — bir vaqtda DeepSeek'ga ketadigan so'rovlar (standart 40; avval 2000 = navbat yo'q edi)
#   DS_QUEUE_TIMEOUT      — navbatda maksimal kutish (s); oshsa foydalanuvchiga "band" deyiladi, varaq yechilmaydi
# ---------------------------------------------------------------------------------------------
try:
    DS_QUEUE_TIMEOUT = max(5.0, float(os.environ.get("DS_QUEUE_TIMEOUT", "90")))
except ValueError:
    DS_QUEUE_TIMEOUT = 90.0
_ds_client_cache: Dict[str, Any] = {"sig": None, "client": None}
_ds_waiting = 0

def _deepseek_client(api_key: str, base_url: str):
    import httpx
    sig = (api_key, base_url)
    if _ds_client_cache["sig"] != sig or _ds_client_cache["client"] is None:
        _ds_client_cache["sig"] = sig
        _ds_client_cache["client"] = AsyncOpenAI(
            api_key=api_key, base_url=base_url, timeout=600.0, max_retries=2,
            http_client=httpx.AsyncClient(
                timeout=httpx.Timeout(600.0, connect=10.0),
                limits=httpx.Limits(max_connections=max(20, DEEPSEEK_CONCURRENCY * 2 if DEEPSEEK_CONCURRENCY < 500 else 200),
                                    max_keepalive_connections=40, keepalive_expiry=60),
            ),
        )
    return _ds_client_cache["client"]

class _DsBusy(Exception):
    pass

class _ds_slot:
    """`async with _ds_slot(ws):` — GEMINI_SEMAPHORE (DEEPSEEK_CONCURRENCY) navbati; to'lib ketsa foydalanuvchiga o'rni aytiladi."""
    def __init__(self, ws):
        self.ws = ws
        self.held = False
    async def __aenter__(self):
        global _ds_waiting
        if GEMINI_SEMAPHORE.locked():
            _ds_waiting += 1
            try:
                try:
                    await self.ws.send_json({"type": "queue", "position": _ds_waiting,
                                             "message": f"Navbatdasiz ({_ds_waiting}). Biroz kuting…"})
                except Exception:
                    pass
                await asyncio.wait_for(GEMINI_SEMAPHORE.acquire(), timeout=DS_QUEUE_TIMEOUT)
            except asyncio.TimeoutError:
                raise _DsBusy("503 overloaded: queue timeout")
            finally:
                _ds_waiting = max(0, _ds_waiting - 1)
        else:
            await GEMINI_SEMAPHORE.acquire()
        self.held = True
        return self
    async def __aexit__(self, *a):
        if self.held:
            GEMINI_SEMAPHORE.release()
            self.held = False

# ---- foydalanuvchi bo'yicha limit (WebSocket HTTP middleware'dan o'tmaydi, shuning uchun alohida) ----
def _env_i(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except ValueError:
        return default
WS_RPM_PLAN = _env_i("WS_RPM_PLAN", 5)          # yangi deck rejasi (mode=plan): 1 daqiqada 5 ta
WS_RPM_GENERATE = _env_i("WS_RPM_GENERATE", 40)  # reja bo'yicha slayd-slayd yaratish (1 deck = N so'rov)
WS_RPM_CHAT = _env_i("WS_RPM_CHAT", 15)          # oddiy chat/tahrirlash
_UWIN: Dict[str, list] = {}

def _user_rate_hit(uid: str, kind: str) -> int:
    """0 = ruxsat; >0 = necha soniyadan keyin qayta urinish mumkin."""
    lim = {"plan": WS_RPM_PLAN, "generate": WS_RPM_GENERATE}.get(kind, WS_RPM_CHAT)
    now = time.time()
    key = f"{uid}|{kind}"
    arr = [t for t in _UWIN.get(key, ()) if now - t < 60]
    if len(arr) >= lim:
        _UWIN[key] = arr
        return max(1, int(60 - (now - arr[0])) + 1)
    arr.append(now)
    _UWIN[key] = arr
    if len(_UWIN) > 20000:
        for k in list(_UWIN.keys())[:5000]:
            _UWIN.pop(k, None)
    return 0

# ---- token -> foydalanuvchi keshi (har xabarda Supabase Auth'ga HTTP so'rov ketmasin) ----
_TOK_CACHE: "OrderedDict[str, tuple]" = OrderedDict()
TOK_TTL = 60.0

@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    global ws_count
    if not _ws_origin_ok(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    if server_paused.is_set():
        await websocket.send_json({"type": "error", "message": "Server vaqtincha to'xtatilgan."})
        await websocket.close()
        return
    with ws_lock:
        if ws_count >= MAX_WS:
            await websocket.send_json({"type": "error", "message": "Server band."})
            await websocket.close()
            return
        ws_count += 1
    session_key = None
    uid = ""
    email = ""
    DEV_MODE = os.environ.get("SLIDE_STUDIO_DEV_MODE", "").strip() == "1"
    DEV_TOKEN = os.environ.get("SLIDE_STUDIO_DEV_TOKEN", "")
    try:
        _ws_errs = 0
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except ValueError:
                data = None
            if not isinstance(data, dict):        # v53: noto'g'ri xabar butun ulanishni yopmaydi
                await websocket.send_json({"type": "error", "code": "bad_request", "message": "Noto'g'ri so'rov."})
                continue
            if data.get("type") == "search_result":
                continue
            try:
                token = data.get("token", "")
                prompt = (data.get("prompt") or "").strip()
                deck_state = data.get("deck_state") or data.get("slide_context") or ""
                images_meta: List[Dict] = data.get("images_meta") or []
                chat_history = data.get("chat_history") or []
                scope = data.get("scope", "all_slides")
                active_slide = data.get("active_slide_index", 1)
                mode = (data.get("mode") or "").strip().lower()
                plan_slides = data.get("plan_slides") or []
                plan_index = data.get("plan_index")
                model = resolve_model(data.get("model"), config.get("model_name", "deepseek-chat"))
                if DEV_MODE and DEV_TOKEN and token and token == DEV_TOKEN:
                    uid, email = "dev-user", "dev@local"
                else:
                    if not supabase:
                        print("[AUTH] ❌ supabase=None — server tomonida auth sozlanmagan.")
                        await websocket.send_json({"type": "error", "code": "server_auth_misconfigured",
                                                   "message": "Serverda avtorizatsiya sozlanmagan. Administratorga murojaat qiling."})
                        continue
                    if not token or token == "dev-token":
                        await websocket.send_json({"type": "error", "code": "auth_required",
                                                   "message": "AI bilan yozishish uchun tizimga kiring."})
                        continue
                    try:
                        _tk = hash_user_id(token)
                        _hit = _TOK_CACHE.get(_tk)
                        if _hit and time.time() - _hit[2] < TOK_TTL:
                            uid, email = _hit[0], _hit[1]
                        else:
                            user_res = await asyncio.to_thread(supabase.auth.get_user, token)
                            if not user_res or not user_res.user:
                                _TOK_CACHE.pop(_tk, None)
                                await websocket.send_json({"type": "error", "code": "invalid_token",
                                                           "message": "Sessiya tugagan. Qayta kiring."})
                                continue
                            uid = user_res.user.id
                            email = user_res.user.email or ""
                            _TOK_CACHE[_tk] = (uid, email, time.time())
                            while len(_TOK_CACHE) > 5000:
                                _TOK_CACHE.popitem(last=False)
                    except Exception as e:
                        await websocket.send_json({"type": "error", "code": "invalid_token",
                                                   "message": "Kirishni tekshirib bo'lmadi. Qayta kiring."})
                        continue
                _wait = _user_rate_hit(str(uid), "plan" if mode == "plan" else ("generate" if mode == "generate" else "chat"))
                if _wait:
                    await websocket.send_json({"type": "error", "code": "RATE_LIMITED", "retry_after": _wait,
                                               "message": f"Juda tez-tez so'rov yuboryapsiz. {_wait} soniyadan keyin qayta urinib ko'ring."})
                    continue
                usage = await asyncio.to_thread(get_or_create_user_usage, uid, email)
                if usage.get("blocked"):
                    await websocket.send_json({"type": "error", "message": "Akkaunt bloklangan."})
                    continue
                if appsettings.get("maintenance") and not is_unlimited(usage):
                    await websocket.send_json({"type": "error", "code": "maintenance", "message": appsettings.get("maintenance_text")})
                    continue

                usage = apply_24h_reset(usage)
                bill_mode = mode_for_model(model)
                bal_units = total_credits(usage)
                if not can_afford(usage, bill_mode):
                    payload = usage_payload(usage)
                    _alt = ""
                    if bill_mode == "deep" and can_afford(usage, "fast"):
                        _alt = " Chuqur AI uchun balans yetmaydi — Tez AI ga o'tib davom eting."
                    await websocket.send_json({
                        "type": "error",
                        "code": "LIMIT_EXCEEDED",
                        "message": f"Limit tugadi.{_alt} 24 soat kuting, ${CHECKOUT_PRICE_USD:.2f} ga {pack_pages()} Tez-varaq ({pack_units() // MODES['deep']['page']} Chuqur-varaq) sotib oling.",
                        **payload,
                    })
                    continue
                if mode == "generate" and not is_unlimited(usage) and bal_units < MODES[bill_mode]["page"]:
                    # v53: reja bo'yicha slayd yaratish (1 so'rov = 1 slayd = 1 varaq). Avval faqat 1 ta savol-javobga
                    # yetadigan balans tekshirilardi va 0.25 varaq bilan TO'LIQ slayd olinardi (yechim balansdan oshmaydi).
                    await websocket.send_json({
                        "type": "error",
                        "code": "LIMIT_EXCEEDED",
                        "message": f"Limit tugadi: yangi slayd uchun kamida 1 varaq kerak. 24 soat kuting yoki ${CHECKOUT_PRICE_USD:.2f} ga {pack_pages()} Tez-varaq sotib oling.",
                        **usage_payload(usage),
                    })
                    continue
                bal = bal_units // MODES[bill_mode]["page"]       # shu rejimdagi VARAQ soni (tashlab yuborilgan qoldiq birlik hisobga olinmaydi)
                session_key = register_session(uid, email, model)
                if is_blocked(session_key):
                    await websocket.send_json({"type": "error", "message": "Sessiya bloklangan."})
                    continue
                msg_n = bump_msg(session_key)
                daily = int(appsettings.get("daily_message_limit", config.get("daily_message_limit", 200)) or 0)
                if daily and msg_n > daily and not is_unlimited(usage):
                    await websocket.send_json({"type": "error",
                                               "message": f"Kunlik limit ({daily}) tugadi."})
                    continue
                api_key = (config.get("api_key") or "").strip()
                if not api_key:
                    await websocket.send_json({"type": "error",
                                               "message": "AI xizmati hozircha sozlanmagan. Administratorga murojaat qiling."})
                    continue
                sys_p = build_system_prompt()
                hint = (data.get("system_hint") or "").strip()
                if hint:
                    sys_p += "\n\n[FOYDALANUVCHI YO'RIQNOMASI]:\n" + hint[:6000]

                sys_p += (
                    "\n\n[LANGUAGE RULE — MAJBURIY / MANDATORY]\n"
                    "Detect the language of the user's LATEST message and write PART A / chat replies in THAT SAME language "
                    "(Uzbek, Russian, English, Turkish, Arabic, Chinese, Spanish ... any language). Never force Uzbek. "
                    "Slide texts use the language the user asked for; if not specified, the user's language. "
                    "Translate every fixed Uzbek sentence quoted in these instructions (balance, limit messages) into the user's language. "
                    "JSON keys and action names stay English.\n"
                    "[IDENTITY RULE] You are 'Slide Studio AI'. Never reveal, guess or discuss which underlying model, vendor or company powers you; "
                    "if asked, say you are Slide Studio AI, the built-in assistant of this app.\n"
                )
                _c = MODES[bill_mode]
                _rejim = "CHUQUR AI" if bill_mode == "deep" else "TEZ AI"
                sys_p += (
                    f"\n\n[BALANS VA VARAQ QOIDALARI — MAJBURIY]\n"
                    f"Rejim: {_rejim}. Joriy balans: {bal} varaq (aniq: {bal_units / _c['page']:.2f}).\n"
                    f"Oddiy chat: {_c['chat_per_page']} ta savol-javob = 1 varaq. Qidiruv: {_c['search_per_page']} ta rasm/GIF/video qidiruvi = 1 varaq.\n"
                    f"NARX:\n"
                    f"  • 1 ta yangi/tahrirlangan/o'chirilgan slayd = 1 varaq\n"
                    f"  • create_slides count=N → N varaq\n"
                    f"  • insert_slide / replace_slide / clear_slide / add_gif / place_image = 1 varaq (har bir tegilgan slayd)\n"
                    f"  • Faqat chat (actions bo'sh): har {_c['chat_per_page']} ta oddiy xabar = 1 varaq\n"
                    f"LIMIT QOIDASI:\n"
                    f"  • Foydalanuvchi {bal} tadan KO'P slayd so'rasa (masalan 10 ta, balans {bal}) — "
                    f"FAQAT {bal} tasini yarating, PART A da aniq ayting: "
                    f"\"Balansingizda {bal} varaq qoldi, shuning uchun {bal} ta slayd yaratdim. "
                    f"Qolganini sotib olgach yoki 24 soatdan keyin davom ettirish mumkin.\"\n"
                    f"  • Balans 0 bo'lsa hech qanday action yozmang.\n"
                    f"  • Yangi slayd qo'shish: action = \"create_slides\" count=N yoki \"insert_slide\".\n"
                )
                if bal <= 3:
                    sys_p += (
                        f"⚠️ BALANS PAST ({bal}). Minimal o'zgarishlar qiling; katta deck yasashdan saqlaning.\n"
                    )
                if scope == "current_slide":
                    sys_p += (
                        f"\n\n[SCOPE: CURRENT_SLIDE]\nJoriy varoq: {active_slide}-slayd.\n"
                        "Agar foydalanuvchi shu slaydga tegishli o'zgartirish so'rasa, shu slaydda ishlang.\n"
                        "Boshqa slaydga tegishli buyruq bo'lsa ham swap/move_image_to_slide ishlating.\n"
                        "MUHIM: Agar foydalanuvchi shunchaki salomlashsa yoki umumiy savol bersa "
                        "(slaydni o'zgartirishni so'ramasa), hech qanday action yaratmang — "
                        "shunchaki tabiiy matnda javob bering va \"actions\": [] qoldiring.\n"
                    )
                if mode == "plan":
                    sys_p += (
                        "\n\n[MODE: PLAN — REJA BOSQICHI]\n"
                        "Faqat REJA tuzing, to'liq slayd kontentini YOZMANg.\n"
                        "Javob formati (faqat shu JSON):\n"
                        '{"reply_text":"<qisqa izoh>","plan":[{"title":"<slayd sarlavhasi>",'
                        '"summary":"<1 jumla mazmun>","has_image":true|false}, ...]}\n'
                        "QOIDALAR:\n"
                        "- `plan` massivida foydalanuvchi so'ragan ANIQ sondagi slayd bo'lsin.\n"
                        "- Har bir elementda faqat `title`, `summary`, `has_image` bo'lsin. `has_image` — foydalanuvchi rasmni taqiqlamagan bo'lsa va rasm slaydga foyda beradigan bo'lsa true (titul va mavzuni ko'rsatadigan slaydlarda odatda true); taqiqlagan bo'lsa hammasi false.\n"
                        "- `actions` massivini YOZMANg (rejada kerak emas).\n"
                        "- Hech qanday `replace_slide`/`insert_slide` chiqarmang.\n"
                    )
                elif mode == "generate":
                    try:
                        total = len(plan_slides) if isinstance(plan_slides, list) else 0
                        idx = int(plan_index) if plan_index is not None else 0
                    except Exception:
                        total, idx = 0, 0
                    cur = plan_slides[idx] if (isinstance(plan_slides, list) and 0 <= idx < len(plan_slides)) else {}
                    slide_no = idx + 1
                    action_name = "replace_slide" if slide_no == 1 else "insert_slide"
                    after_no = slide_no - 1
                    sys_p += (
                        f"\n\n[MODE: GENERATE — {slide_no}/{total or '?'} SLAYDNI YARATISH]\n"
                        f"Faqat {slide_no}-slaydni to'liq yarating. Boshqa slaydlarni YOZMANg.\n"
                        f"Reja ma'lumoti: {json.dumps(cur, ensure_ascii=False)}\n"
                        "QOIDALAR:\n"
                        f"- Faqat BITTA asosiy action chiqaring: `{action_name}`"
                        + (f' bilan `"slide": 1`' if slide_no == 1 else f' bilan `"after": {after_no}`') + ".\n"
                        "- `elements` massivida sarlavha + matn/kartalar bo'lsin (reja mazmuniga mos).\n"
                        "- RASM: foydalanuvchi rasm/GIF'ni TAQIQLAMAGAN bo'lsa va reja `has_image` true bo'lsa — AVVAL search_images tool bilan mavzuga 100% mos rasm toping va {\"type\":\"image\",\"src\":URL,...} element qiling. Rasm taqiqlangan bo'lsa — rasm QO'SHMANG.\n"
                        "- Rang mavzusi barcha slaydlarda BIR XIL: 1-slayddagi `background` va ranglarni (deck state'dan) takrorlang.\n"
                        "- Professional ko'rinish uchun maqsadli shakllardan foydalaning: sarlavha ostida chiziq/aksent, raqamli doira, galochka (check), strelka/chevron, pill. Tasodifiy shakl sochmang.\n"
                        "- Jami actionlar soni 4 tadan OSHMASIN. Tool (search_images) chaqiruvlari bu hisobga kirmaydi.\n"
                        "- JSON toza va to'liq bo'lsin (trailing comma yo'q, qo'shtirnoqlar yopilgan).\n"
                    )
                imgs = extract_images_from_deck_state(deck_state)
                meta_desc = {}
                for m in images_meta:
                    if isinstance(m, dict) and m.get("number") is not None and m.get("description"):
                        meta_desc[m["number"]] = m["description"]
                if imgs["pending"]:
                    lines = []
                    for p in imgs["pending"]:
                        n = p.get("number")
                        if n is None:
                            continue
                        d = meta_desc.get(n, "")
                        dim = ""
                        if p.get("width") and p.get("height"):
                            dim = f" [{p['width']}x{p['height']}]"
                        lines.append(f"  • Rasm #{n}: {d}{dim}")
                    sys_p += "\n\n[FOYDALANUVCHI YUKLAGAN RASMLAR — PENDING]\n" + "\n".join(lines) + "\n"
                    sys_p += (
                        "Bu rasmlar hali slaydda EMAS — faqat metadata (raqam, o'lcham) berilgan.\n"
                        "Ularni ishlatish uchun ANIQ action chiqaring:\n"
                        "  • place_image (slide, image_number, image_index, left, top, width, height) — slaydga qo'yish.\n"
                        "  • set_background_url (slide, image_number) — to'liq fon qilish (url SHART EMAS).\n"
                        "  • duplicate_image (to_slide, image_number, left, top, width, height) — bir rasmni 2+ slaydga nusxalash.\n"
                        "Rasm ishlatilgach panel'dan AVTOMATIK o'chiriladi — qayta ishlatmang.\n"
                    )
                if imgs["placed"]:
                    lines = []
                    gif_lines = []
                    for img in imgs["placed"]:
                        is_gif = (img.get("kind") == "gif")
                        label = "GIF" if is_gif else "Rasm"
                        line = f"  • {label} #{img.get('number')}"
                        if img.get("slide") is not None:
                            line += f" — {img['slide']}-VAROQDA"
                        if img.get("left") is not None:
                            line += f", joy=({img['left']},{img['top']})"
                        if img.get("width"):
                            line += f", {img['width']}×{img['height']}"
                        if is_gif:
                            gif_lines.append(line)
                        else:
                            lines.append(line)
                    if lines:
                        sys_p += "\n\n[ALLAQACHON JOYLASHTIRILGAN RASMLAR]\n" + "\n".join(lines) + "\n"
                    if gif_lines:
                        sys_p += "\n\n[JONLI GIF'LAR — ALLAQACHON SLAYDLARDA]\n" + "\n".join(gif_lines) + "\n"
                        sys_p += (
                            "Bu elementlar JONLI GIF (animatsiyali). Ular #raqam-GIF bilan belgilangan.\n"
                            "GIF'lar oddiy rasmlardan farq qiladi — ular animatsiyali va o'lchamga ega.\n"
                            "GIF'ni ko'chirish/almashtirish uchun move_image_to_slide yoki swap_images ishlating.\n"
                            "GIF'ni fon qilish uchun set_background_url (image_number bilan) ishlating.\n"
                        )

                sys_p += (
                    "\n\n[RASM/GIF ALMASHTIRISH — swap_images]\n"
                    "Ikki xil rasmni (yoki GIFni) almashtirish uchun `swap_images` action ishlating.\n"
                    "SXEMA: {\"action\":\"swap_images\",\"image_a\":<1-rasm raqami>,\"slide_a\":<a slayd>,\n"
                    "        \"image_b\":<2-rasm raqami>,\"slide_b\":<b slayd>,\"swap_position\":true|false}\n"
                    "QOIDALAR:\n"
                    "- `image_a` va `image_b` — global rasm/GIF raqamlari (yuqoridagi ro'yxatdan).\n"
                    "- `slide_a`/`slide_b` — o'sha rasmlar joylashgan slayd raqamlari (1-based).\n"
                    "- `swap_position: true` (standart) — rasm TARKIBI almashtiriladi, joyi/o'lchami o'zgarmaydi.\n"
                    "- `swap_position: false` — rasm JOYI/o'lchami almashtiriladi, tarkibi o'zgarmaydi.\n"
                    "- Ikkala rasm ham mavjud va turli obyekt bo'lishi SHART.\n"
                    "- GIF'lar ham xuddi rasm kabi almashtiriladi (raqami bo'yicha).\n"
                )

                sys_p += (
                    "\n\n[AMALLAR HISOBOTI VA HALOLLIK]\n"
                    "Sizga har safar oldingi javobingizdagi amallarning HAQIQIY bajarilish natijasi "
                    "(✅ bajarilgan / ❌ bajarilmagan) berilishi mumkin.\n"
                    "QOIDALAR:\n"
                    "- Agar amal ✅ bo'lsa — u TUGALLANGAN. Uni QAYTA bajarmang va qayta so'ramang.\n"
                    "- Agar amal ❌ bo'lsa — u BAJARILMAGAN. Foydalanuvchiga bajarildi deb AYTMANG; "
                    "sababini tushuntiring yoki to'g'rilab qayta urinib ko'ring.\n"
                    "- `reply_text` da faqat HAQIQATDA bajarilgan ishni tasvirlang. Yolg'on da'vo qilmang.\n"
                    "- Foydalanuvchi \"bajarilmadi\" desa va hisobotda ✅ bo'lsa — ish aslida bajarilgan; "
                    "muloyimlik bilan tasdiqlang va nima o'zgarganini tushuntiring.\n"
                )
                if deck_state:
                    try:
                        d = json.loads(deck_state) if isinstance(deck_state, str) else deck_state
                        if isinstance(d, dict):
                            def _obj_brief(o, z_index=0):
                                if not isinstance(o, dict):
                                    return None
                                is_gif = bool(o.get("isGif") or o.get("gifUrl") or o.get("type") in ("gif", "gifImage") or o.get("kind") == "gif")
                                is_img = is_gif or o.get("type") in ("image", "videoImage", "video", "embedVideo") or o.get("kind") == "image" or o.get("isVideo")
                                is_text = o.get("type") in ("textbox", "i-text", "text") or o.get("kind") == "text"
                                brief = {
                                    "type": "gif" if is_gif else (o.get("type") or o.get("kind")),
                                    "id": o.get("id") or o.get("_oid"),
                                    "left": o.get("left"), "top": o.get("top"),
                                    "width": o.get("width"), "height": o.get("height"),
                                    "angle": o.get("angle") or 0,
                                    "zIndex": z_index,
                                }
                                if o.get("fill") is not None:
                                    brief["fill"] = o.get("fill")
                                if o.get("stroke") is not None:
                                    brief["stroke"] = o.get("stroke")
                                if o.get("strokeWidth") is not None:
                                    brief["strokeWidth"] = o.get("strokeWidth")
                                if o.get("opacity") is not None:
                                    brief["opacity"] = o.get("opacity")
                                if is_text:
                                    brief["text"] = (o.get("text") or "")[:120]
                                    if o.get("fontSize") is not None:
                                        brief["fontSize"] = o.get("fontSize")
                                    if o.get("fontFamily"):
                                        brief["fontFamily"] = o.get("fontFamily")
                                    if o.get("fontWeight") is not None:
                                        brief["fontWeight"] = o.get("fontWeight")
                                    if o.get("fontStyle") is not None:
                                        brief["fontStyle"] = o.get("fontStyle")
                                    if o.get("textAlign") is not None:
                                        brief["textAlign"] = o.get("textAlign")
                                    if o.get("underline"):
                                        brief["underline"] = True
                                if is_img and o.get("imageNumber") is not None:
                                    brief["imageNumber"] = o.get("imageNumber")
                                if o.get("animation") or o.get("animName"):
                                    brief["animation"] = o.get("animation") or o.get("animName")
                                if o.get("type") == "video" or o.get("type") == "embedVideo":
                                    brief["type"] = "video"
                                    brief["url"] = (o.get("url") or o.get("embedUrl") or "")[:160]
                                if o.get("type") in ("button", "slideButton"):
                                    brief["type"] = "button"
                                    brief["text"] = (o.get("buttonText") or o.get("text") or o.get("btnLabel") or "")[:60]
                                    brief["click"] = o.get("click") or o.get("btnAction")
                                if is_gif:
                                    brief["kind"] = "gif"
                                    if o.get("gifUrl"):
                                        brief["gifUrl"] = (o.get("gifUrl") or "")[:120]
                                return brief

                            full = {
                                "active_slide": d.get("active_slide"),
                                "total_slides": d.get("total_slides") or len(d.get("presentation") or []) or 1,
                                "title": d.get("title"),
                                "pending_images": d.get("slide_images_pending") or [],
                            }

                            pres = d.get("presentation") or []
                            slides_out = []
                            if isinstance(pres, list) and pres:
                                for s in pres[:30]:
                                    if not isinstance(s, dict):
                                        continue
                                    entry = {
                                        "slide": s.get("slide") or s.get("slide_index"),
                                        "background": s.get("background") or "#ffffff",
                                        "objects": [],
                                    }
                                    if s.get("backgroundGif"):
                                        entry["backgroundGif"] = True
                                    if s.get("backgroundImage"):
                                        entry["backgroundImage"] = True
                                    for zi, o in enumerate((s.get("objects") or s.get("elements") or [])[:50]):
                                        b = _obj_brief(o, z_index=zi)
                                        if b:
                                            entry["objects"].append(b)
                                    slides_out.append(entry)
                            else:

                                sd = d.get("slide_data") or {}
                                if isinstance(sd, dict):
                                    entry = {
                                        "slide": d.get("active_slide") or 1,
                                        "background": sd.get("background") or "#ffffff",
                                        "objects": [],
                                    }
                                    if sd.get("backgroundGif"):
                                        entry["backgroundGif"] = True
                                    for zi, o in enumerate((sd.get("objects") or sd.get("elements") or [])[:50]):
                                        b = _obj_brief(o, z_index=zi)
                                        if b:
                                            entry["objects"].append(b)
                                    slides_out.append(entry)
                            full["slides"] = slides_out
                            sys_p += (
                                "\n\n[LIVE DECK STATE — GROUND TRUTH]\n"
                                "Use ONLY this data. Do not invent objects/images.\n"
                                + json.dumps(full, ensure_ascii=False)
                            )
                    except Exception:
                        sys_p += f"\n\n[LIVE DECK STATE]:\n{str(deck_state)[:6000]}"
                if model == "deepseek-reasoner":
                    sys_p = sys_p.replace("search_images tool bilan", "tayyor rasm ro'yxatidan").replace("search_images", "(rasm qidirish)") + _NO_TOOLS_NOTE
                messages = [{"role": "system", "content": sys_p}]
                messages.extend(build_history(chat_history))
                user_content = prompt or "Buyruqni bajaring."
                if images_meta:
                    tags = []
                    for m in images_meta:
                        if isinstance(m, dict):
                            n = m.get("number") or m.get("globalNum")
                            if n is not None:
                                tags.append(f"[User Image #{n}]")
                    if tags:
                        user_content = " ".join(tags) + "\n" + user_content
                messages.append({"role": "user", "content": user_content})
                full_reply = ""
                usage_meta = None
                stream_err = None
                finish_reason = None
                client = None
                client_gone = False
                try:

                    client = _deepseek_client(api_key, config.get("deepseek_base_url") or "https://api.deepseek.com")
                    async with _ds_slot(websocket):
                        _pre_stats: Dict[str, int] = {}
                        tools_on = bool(_search_images_sync) and model != "deepseek-reasoner" and mode != "plan" and not _SMALLTALK_RE.match((prompt or "").strip() or "x")
                        if model == "deepseek-reasoner" and _search_images_sync and mode != "plan" and not _NO_IMG_RE.search(user_content or ""):
                            try:
                                _ctx, _want = user_content or "", _wants_images(prompt or "")
                                if mode == "generate" and isinstance(plan_slides, list) and plan_index is not None and 0 <= int(plan_index) < len(plan_slides):      # slayd-slayd yaratish: faqat has_image slaydlar
                                    _cur = plan_slides[int(plan_index)] or {}
                                    _want = bool(_cur.get("has_image")) and _wants_images(prompt or "") or bool(_cur.get("has_image"))
                                    _ctx = f"Deck topic: {user_content}\nSlide: {_cur.get('title', '')} — {_cur.get('summary', '')}"
                                if _want:
                                    _extra = await _deep_presearch(client, _ctx, 1 if mode == "generate" else 3, websocket, _pre_stats,
                                                                   kind=_presearch_kind(prompt or ""))
                                    if _extra:
                                        messages[-1] = {"role": "user", "content": (messages[-1].get("content") or "") + _extra}
                            except Exception as _pe:
                                print(f"[DEEP-IMG] {type(_pe).__name__}: {str(_pe)[:80]}")
                        msgs = messages
                        n_searches = int(_pre_stats.get("searches") or 0)
                        _dsml_retried = False
                        agg_in = agg_out = agg_tot = 0
                        # v29: qidiruvdan oldin yozilgan matn (PART A) O'CHIRILMAYDI va qayta yozdirilmaydi
                        shown_text = False      # foydalanuvchi allaqachon matn ko'rdi
                        _think_chars, _think_t0 = 0, time.monotonic()
                        _think_last = 0.0
                        sep_pending = False     # keyingi raundning matni oldiga bo'sh qator qo'yiladi
                        try:
                            for _round in range(MAX_TOOL_ROUNDS + 1):
                                kwargs = {
                                    "model": model,
                                    "messages": msgs,
                                    "stream": True,
                                    "stream_options": {"include_usage": True},
                                    "max_tokens": 16384,
                                }
                                if model != "deepseek-reasoner":
                                    kwargs["temperature"] = 0.7
                                if tools_on and _round < MAX_TOOL_ROUNDS and n_searches < MAX_SEARCHES_PER_TURN:
                                    kwargs["tools"] = SEARCH_TOOLS
                                    kwargs["tool_choice"] = "auto"

                                try:
                                    kwargs["extra_body"] = {"user_id": hash_user_id(uid)}
                                except Exception:
                                    kwargs["extra_body"] = {"user_id": str(uid or "anon")[:32]}
                                round_text = ""
                                calls: Dict[int, dict] = {}
                                stream = await client.chat.completions.create(**kwargs)
                                async for chunk in stream:
                                    try:
                                        choice = chunk.choices[0] if chunk.choices else None
                                        if choice is not None:
                                            fr = getattr(choice, "finish_reason", None)
                                            if fr:
                                                finish_reason = fr
                                            delta = choice.delta
                                            _rc = getattr(delta, "reasoning_content", None) if delta else None
                                            if _rc:
                                                # v54: Chuqur AI avval uzoq «o'ylaydi» — Tez AI kabi jonli holat ko'rinsin (sukut bo'lmasin)
                                                _think_chars += len(_rc)
                                                _now_t = time.monotonic()
                                                if _now_t - _think_last >= 1.0:
                                                    _think_last = _now_t
                                                    try:
                                                        await websocket.send_json({"type": "thinking", "chars": _think_chars,
                                                                                   "sec": int(_now_t - _think_t0)})
                                                    except (WebSocketDisconnect, RuntimeError):
                                                        raise WebSocketDisconnect()
                                            txt = getattr(delta, "content", None) if delta else None
                                            if txt:
                                                if sep_pending and txt.strip():
                                                    sep_pending = False
                                                    full_reply += "\n\n"
                                                    try:
                                                        await websocket.send_json({"type": "chunk", "text": "\n\n"})
                                                    except (WebSocketDisconnect, RuntimeError):
                                                        raise WebSocketDisconnect()
                                                round_text += txt
                                                full_reply += txt
                                                try:
                                                    await websocket.send_json({"type": "chunk", "text": txt})
                                                except (WebSocketDisconnect, RuntimeError):
                                                    raise WebSocketDisconnect()
                                            for tc in (getattr(delta, "tool_calls", None) or []):
                                                slot = calls.setdefault(int(getattr(tc, "index", 0) or 0), {"id": "", "name": "", "args": ""})
                                                if getattr(tc, "id", None):
                                                    slot["id"] = tc.id
                                                fn = getattr(tc, "function", None)
                                                if fn is not None:
                                                    if getattr(fn, "name", None):
                                                        slot["name"] += fn.name
                                                    if getattr(fn, "arguments", None):
                                                        slot["args"] += fn.arguments
                                        if getattr(chunk, "usage", None):
                                            u_ = chunk.usage
                                            agg_in += getattr(u_, "prompt_tokens", 0) or 0
                                            agg_out += getattr(u_, "completion_tokens", 0) or 0
                                            agg_tot += getattr(u_, "total_tokens", 0) or ((getattr(u_, "prompt_tokens", 0) or 0) + (getattr(u_, "completion_tokens", 0) or 0))
                                    except WebSocketDisconnect:
                                        raise
                                    except Exception:
                                        continue
                                if not calls and model == "deepseek-reasoner" and not _dsml_retried and _DSML_RE.search(round_text or "") and "```json" not in (round_text or ""):
                                    _dsml_retried = True           # model mavjud bo'lmagan tool'ni chaqirmoqchi bo'ldi — JSON'siz to'xtab qolmasin
                                    print("[DEEP] DSML/tool matni — qayta so'raladi")
                                    msgs = list(msgs) + [
                                        {"role": "assistant", "content": _DSML_RE.split(round_text)[0].strip()[:1500] or "Rasmlar tayyor."},
                                        {"role": "user", "content": "Tool mavjud emas. Rasm kerak bo'lsa [TAYYOR RASMLAR] dagi URL'dan foydalaning, bo'lmasa rasmsiz yozing. "
                                                                    "Hozir FAQAT bitta ```json blok bilan javob bering (actions bilan), qidirishni eslatmang."}]
                                    sep_pending = True
                                    continue
                                if not calls:
                                    break

                                # v29: eski kod bu yerda matnni o'chirib ("reset") qidiruvdan keyin QAYTA yozdirardi —
                                # javob yo'qolib, keyin sezdirmasdan ikkinchi marta chiqardi. Endi matn qoladi.
                                if round_text.strip():
                                    shown_text = True
                                    sep_pending = True
                                ordered = [calls[k] for k in sorted(calls)]
                                msgs = list(msgs) + [{
                                    "role": "assistant",
                                    "content": round_text or None,
                                    "tool_calls": [{"id": c["id"] or f"call_{i}", "type": "function",
                                                    "function": {"name": c["name"], "arguments": c["args"] or "{}"}}
                                                   for i, c in enumerate(ordered)],
                                }]
                                # v55: HAMMA qidiruvlar bir vaqtda (parallel), topilmaganlari ham bitta to'plamda qayta qidiriladi.
                                # Foydalanuvchiga esa qatorlar ketma-ket (tez) paydo bo'ladi — 1 tadan qidirayotgandek.
                                _jobs, _job_of = [], {}
                                for i, c in enumerate(ordered):
                                    try:
                                        a = json.loads(c["args"] or "{}")
                                    except Exception:
                                        a = {}
                                    q_ = str(a.get("query") or "").strip()
                                    kind_ = _tool_search_kind(q_, a.get("kind"))
                                    if c["name"] == "search_images" and q_ and n_searches < MAX_SEARCHES_PER_TURN:
                                        n_searches += 1
                                        _job_of[i] = len(_jobs)
                                        _jobs.append((q_, kind_))
                                _found_all = await _search_batch(websocket, _jobs, client_search=bool(data.get("client_search")),
                                                                 n0=n_searches - len(_jobs))
                                for i, c in enumerate(ordered):
                                    if i not in _job_of:
                                        result = {"error": "qidiruv bajarilmadi", "results": []}
                                    else:
                                        q_, kind_ = _jobs[_job_of[i]]
                                        found = _found_all[_job_of[i]]
                                        result = {"query": q_, "kind": kind_, "results": found, "note": _search_note(kind_, bool(found))}
                                    msgs.append({"role": "tool", "tool_call_id": c["id"] or f"call_{i}",
                                                 "content": json.dumps(result, ensure_ascii=False)[:6000]})

                                if n_searches > 0:
                                    if shown_text:
                                        _text_rule = (
                                            "Foydalanuvchi PART A matnini ALLAQACHON ko'rdi — uni va boshqa hech qanday matnni QAYTA YOZMANG. "
                                            "Faqat bitta ```json blok chiqaring. "
                                        )
                                    else:
                                        _text_rule = (
                                            "Avval 1–2 jumlalik PART A matn, undan keyin bitta ```json blok yozing. "
                                        )
                                    msgs.append({
                                        "role": "user",
                                        "content": (
                                            "Qidiruv yakunlandi. Endi HECH QANDAY tool chaqirmang. "
                                            + _text_rule +
                                            "Topilgan rasm/GIF URL laridan FAOLIYAT bilan foydalanib, foydalanuvchi so'roviga TO'LIQ mos "
                                            "```json\n{\"actions\":[...]}\n``` blokini yozing. "
                                            "Majburiy actionlar: replace_slide yoki insert_slide (har bir so'ralgan slayd uchun alohida), "
                                            "set_background_url (fon uchun), place_image_url yoki add_gif (har bir rasm/GIF uchun). "
                                            "Har bir slaydda so'ralgan miqdorda rasm va GIF bo'lsin. "
                                            "Kamida so'ralgan slaydlar sonicha insert/replace action bo'lsin."
                                        ),
                                    })
                                finish_reason = None
                            if agg_tot or agg_in or agg_out:
                                from types import SimpleNamespace as _NS
                                usage_meta = _NS(prompt_tokens=agg_in, completion_tokens=agg_out, total_tokens=agg_tot or (agg_in + agg_out))
                        except WebSocketDisconnect:
                            client_gone = True
                        except Exception as e:
                            stream_err = e
                except WebSocketDisconnect:
                    client_gone = True
                except Exception as e:
                    stream_err = stream_err or e
                if client_gone and not full_reply.strip():
                    raise WebSocketDisconnect()
                if stream_err and not full_reply.strip():
                    err = str(stream_err).lower()
                    if "429" in err or "rate" in err or "quota" in err:
                        msg = "AI xizmati limiti tugadi. Birozdan so'ng qayta urinib ko'ring."
                    elif "401" in err or "auth" in err or "api key" in err:
                        msg = "API kalit xato. Admin panel orqali tekshiring."
                    elif "503" in err or "overloaded" in err:
                        msg = "AI serveri band. Keyinroq urinib ko'ring."
                    else:
                        print(f"[AI] stream xatosi: {str(stream_err)[:300]}")
                        msg = "AI xizmatida xatolik yuz berdi. Qayta urinib ko'ring."
                    await websocket.send_json({"type": "error", "message": msg})
                    continue

                try:
                    if _extract_bad_gif_urls(full_reply):
                        fixed = await _fix_gif_urls_in_reply(model, full_reply)
                        if fixed and fixed != full_reply:
                            full_reply = fixed
                            print("[GIF-FIX] URL'lar Tenor orqali tuzatildi (AI so'rovsiz)")
                except Exception as e:
                    print(f"[GIF-FIX] umumiy xato: {e}")
                inp_t = getattr(usage_meta, "prompt_tokens", 0) or 0 if usage_meta else 0
                out_t = getattr(usage_meta, "completion_tokens", 0) or 0 if usage_meta else 0
                tot = getattr(usage_meta, "total_tokens", 0) or (inp_t + out_t) if usage_meta else 0
                cost = calc_cost(model, inp_t, out_t)
                add_tokens(session_key, tot)

                pages_from_actions, pages_breakdown = 0, []
                try:
                    pages_from_actions, pages_breakdown = calculate_page_cost_from_reply(
                        full_reply or "", _deck_slide_count(deck_state), active_slide
                    )
                except Exception as _me:
                    print(f"[MONITORING] cost calc: {_me}")
                pages_charged, charge_reason = 0, "none"
                try:
                    try:
                        _n_search_turn = int(n_searches)
                    except Exception:
                        _n_search_turn = 0

                    def _charge_fn(u, _t=tot, _p=int(pages_from_actions), _n=_n_search_turn, _m=mode_for_model(model)):
                        u["total_tokens"] = (u.get("total_tokens") or 0) + _t
                        u["daily_tokens"] = (u.get("daily_tokens") or 0) + _t
                        u, ch, rs = charge_for_ai_turn(u, _p, _n, _m)
                        return u, (ch, rs)
                    async with _user_lock(uid):
                        usage, (pages_charged, charge_reason) = await asyncio.to_thread(update_usage_atomic, uid, email, _charge_fn)
                        if int(pages_charged) > 0:
                            await asyncio.to_thread(
                                ledger_log, uid, str(charge_reason), -int(pages_charged), usage, _n_search_turn,
                                {"pages_needed": int(pages_from_actions), "breakdown": pages_breakdown[:20]})
                        usage["spent_24h"] = await asyncio.to_thread(ledger_spent, uid, usage.get("last_reset_time"))
                except Exception as _ce:
                    print(f"[MONITORING] charge: {_ce}")
                    charge_reason = "charge_error"
                    usage = await asyncio.to_thread(get_or_create_user_usage, uid, email)
                if client_gone:
                    raise WebSocketDisconnect()
                bal_payload = usage_payload(usage)
                if stream_err:
                    finish_reason = "error"
                elif finish_reason in (None, "", "stop"):
                    finish_reason = "stop"
                await websocket.send_json({
                    "type": "end",
                    "finish_reason": finish_reason,
                    "interrupted": finish_reason != "stop",
                    "ai_msg": {"role": "assistant", "content": full_reply},
                    "tokens_used": tot,
                    "input_tokens": inp_t,
                    "output_tokens": out_t,
                    "cost_usd": cost,
                    "user_total_tokens": usage.get("total_tokens", 0),
                    "pages_charged": int(pages_charged),             # BIRLIK (frontend varaqqa o'giradi)
                    "units_charged": int(pages_charged),
                    "pages_needed": int(pages_from_actions),
                    "limit_reached": not can_afford(usage, mode_for_model(model)),
                    "billing_mode": mode_for_model(model),
                    "pages_breakdown": pages_breakdown[:40],
                    "charge_reason": charge_reason,
                    **bal_payload,
                })
            except WebSocketDisconnect:
                raise
            except Exception as e:
                # v53: bitta xabardagi kutilmagan xato ulanishni YOPMAYDI — xato aytiladi va keyingi xabar kutiladi
                if (websocket.client_state != WebSocketState.CONNECTED
                        or websocket.application_state != WebSocketState.CONNECTED):
                    raise WebSocketDisconnect()
                _ws_errs += 1
                print(f"[WS] xabar xatosi ({_ws_errs}): {type(e).__name__}: {str(e)[:300]}")
                try:
                    await websocket.send_json({"type": "error", "message": "Ichki xatolik. Qayta urinib ko'ring."})
                except Exception:
                    raise WebSocketDisconnect()
                if _ws_errs >= 5:                   # ketma-ket ko'p xato — ulanish yopiladi (cheksiz sikl bo'lmasin)
                    try:
                        await websocket.close(code=1011)
                    except Exception:
                        pass
                    break
                continue
            _ws_errs = 0
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            print(f"[WS] xato: {str(e)[:300]}")
            await websocket.send_json({"type": "error", "message": "Ichki xatolik. Qayta urinib ko'ring."})
        except Exception:
            pass
    finally:
        with ws_lock:
            ws_count = max(0, ws_count - 1)

def admin_panel_loop():
    time.sleep(1.5)
    print("\n" + "=" * 56)
    print("  SLIDE STUDIO — ADMIN PANEL")
    print("  buyruqlar: key | stats | model | pause | resume | quit")
    print("=" * 56)
    while True:
        try:
            cmd = input("\n[admin] > ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nAdmin panel yopildi.")
            break
        if not cmd:
            continue
        if cmd in ("q", "quit", "exit"):
            print("Chiqish...")
            os._exit(0)
        elif cmd in ("stats", "s", "stat"):
            n = count_accounts()
            with sessions_lock:
                active = len(active_sessions)
                msgs = sum(s.get("message_count", 0) for s in active_sessions.values())
                toks = sum(s.get("tokens_used", 0) for s in active_sessions.values())
            print(f"  Akkauntlar (DB): {n}")
            print(f"  Faol sessiyalar: {active}")
            print(f"  Jami xabarlar (sessiya): {msgs}")
            print(f"  Jami tokenlar (sessiya): {toks}")
            print(f"  WS ulanishlar: {ws_count}")
            print(f"  Model: {config.get('model_name')}")
            key_ok = "ha" if (config.get("api_key") or "").strip() else "YO'Q"
            print(f"  API kalit: {key_ok}")
        elif cmd in ("key", "apikey", "api"):
            print("  Yangi AI API kalitini kiriting (bo'sh = bekor):")
            try:
                new_key = input("  key> ").strip()
            except EOFError:
                continue
            if new_key:
                config["api_key"] = new_key
                save_config(config)
                os.environ["AI_API_KEY"] = new_key
                print("  ✅ API kalit saqlandi.")
            else:
                print("  Bekor.")
        elif cmd.startswith("model"):
            parts = cmd.split(maxsplit=1)
            if len(parts) > 1 and parts[1] in AVAILABLE_MODEL_VALUES:
                config["model_name"] = parts[1]
                save_config(config)
                print(f"  ✅ Default model: {parts[1]}")
            else:
                print("  Mavjud:", ", ".join(AVAILABLE_MODEL_VALUES))
                print("  Ishlatish: model deepseek-chat")
        elif cmd == "pause":
            server_paused.set()
            print("  Server pauza (yangi WS rad etiladi).")
        elif cmd == "resume":
            server_paused.clear()
            print("  Server davom etmoqda.")
        elif cmd in ("help", "h", "?"):
            print("  key     — API kalitni o'zgartirish")
            print("  stats   — akkauntlar va sessiya statistikasi")
            print("  model X — default model (deepseek-chat | deepseek-reasoner)")
            print("  pause / resume")
            print("  quit")
        else:
            print("  Noma'lum. 'help' yozing.")

if __name__ == "__main__":
    try:
        _tty = sys.stdin is not None and sys.stdin.isatty()
    except Exception:
        _tty = False
    if _tty:
        threading.Thread(target=admin_panel_loop, daemon=True).start()
    print(f"Slide Studio → http://0.0.0.0:{SERVER_PORT}")
    # v43: app obyekti to'g'ridan-to'g'ri beriladi ("main:app" satri butun modulni 2-marta yuklab RAM'ni ikki baravar qilardi,
    # admin panel esa boshqa nusxadagi config'ni o'zgartirardi). access_log o'chirilgan — Render loglari to'lib ketmaydi.
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT, reload=False,
                log_level=os.environ.get("LOG_LEVEL", "warning").lower(), access_log=False,
                proxy_headers=True, forwarded_allow_ips="*",
                ws_ping_interval=25, ws_ping_timeout=60, timeout_keep_alive=65)
