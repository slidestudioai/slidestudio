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
import httpx
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
        turn_cost,
        max_debt_units,
        raw_balance,
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
        plan_active, is_unlimited, is_ad_free,
        pack_pages, pack_units, free_daily_units, rt, daily_units_for,
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

from backend.services import obs                    # Audit M4: request id, JSON logs, metrics, Sentry
from backend.services.obs import metrics as _metrics
obs.install_json_logs()
obs.install_sentry()

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
from backend.services.prompt_builder import _NO_TOOLS_NOTE  # noqa: E402  (Audit M5: moved)
_NO_IMG_RE = _re.compile(r"rasmsiz|rasm\s*(?:kerak\s*emas|qo'?yma|siz)|without\s+images?|no\s+images?|без\s+(?:картин|изображ|фото)", _re.I)
_IMG_CTX_RE = _re.compile(r"slayd|slide|taqdimot|rasm|image|photo|foto|fon\b|banner|презент|слайд|изображ|картин", _re.I)
_IMG_INTENT_RE = _re.compile(r"rasm|surat|image|photo|picture|foto|fon\b|banner|illyustr|gif|video|изображ|картин|фото|"
                             r"(?:yarat|tuz|qil|qo'?sh|ochib\s*ber|tayyorla|generate|create|make|build|добав|созда)\w*\s+.{0,40}?(?:slayd|slide|taqdimot|prezentats|презент|слайд)|"
                             r"(?:slayd|slide|taqdimot|prezentats|презент|слайд)\w*\s+.{0,40}?(?:yarat|tuz|qo'?sh|tayyorla|generate|create|make|добав|созда)|"
                             r"mavzu\w*\s+(?:bo'?yicha|haqida|ustida)", _re.I)
_SMALLTALK_RE = _re.compile(r"^\s*(?:salom|assalom\w*|hi|hello|hey|rahmat|raxmat|ok|okay|yaxshi|nima\s+deding|nima\s+dedi\w*|tushund\w*|qalay\w*|thanks?|привет|спасибо)\W*$", _re.I)

_N_SLIDES_RE = _re.compile(r"(\d{1,2})\s*(?:ta\s*)?(?:slayd|slide|varaq|sahifa|page|слайд)", _re.IGNORECASE)


def _presearch_count(text: str) -> int:
    """How many searches are planned before writing: one per requested slide / topic (3..12)."""
    m = _N_SLIDES_RE.search(text or "")
    try:
        n = int(m.group(1)) if m else 0
    except Exception:
        n = 0
    topics = len([p for p in _re.split(r"[,;\n]|\bva\b|\band\b|\bи\b", text or "") if len(p.strip()) > 2])
    return max(3, min(12, max(n, topics)))


_DECK_CREATE_RE = _re.compile(r"(taqdimot|prezentats|presentation|deck|презентац|слайды)", _re.I)
_CREATE_VERB_RE = _re.compile(r"(yasa|yarat|tuz|qil|tayyorla|create|make|generate|build|созда|сдела|подготов)", _re.I)


def _is_multi_slide_request(text: str) -> bool:
    """A new deck or 2+ slides in one message (then the pictures for all topics are searched first, in one batch)."""
    t = text or ""
    m = _N_SLIDES_RE.search(t)
    try:
        if m and int(m.group(1)) >= 2:
            return True
    except Exception:
        pass
    return bool(_DECK_CREATE_RE.search(t) and _CREATE_VERB_RE.search(t))


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
                                                    f"Cover EVERY topic, sub-topic and slide the user mentions (one query each, in slide order) — do not skip any. "
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
            lines = []
            for x in f[:4]:
                if not (isinstance(x, dict) and x.get("url")):
                    continue
                size = f" {x['width']}x{x['height']}" if x.get("width") and x.get("height") else ""
                title = _pb.sanitize_inline(x.get("title") or "", 60)      # external text = data only (Audit M1)
                lines.append(f"  - {x['url']}" + (f'  ("{title}"{size})' if title or size else ""))
            if lines:
                blocks.append(f'"{q}":\n' + "\n".join(lines))
    if not blocks:
        return ""
    print(f"[DEEP-IMG] {len(blocks)} ta so'rov uchun rasm topildi")
    how = {"gif": "GIF uchun: {\"type\":\"gif\",\"gifUrl\":URL,...} (yoki orqa fon GIF)",
           "video": "Video uchun: add_video (yoki set_background_video) ga URL bering"}.get(kind, "{\"type\":\"image\",\"src\":URL,...}")
    return ("\n\n[TAYYOR " + {"gif": "GIFLAR", "video": "VIDEOLAR"}.get(kind, "RASMLAR") + " — server allaqachon qidirib topdi]\n"
            "Kerak bo'lsa FAQAT shu URL'lardan birini ishlating: " + how + ". URL o'ylab topmang, tool chaqirmang, "
            "qidirishga va'da bermang — rasmlar tayyor. Bu ro'yxatda so'rovdagi BARCHA mavzular uchun rasmlar bor: "
            "endi BUTUN taqdimotni BITTA ```json blokda TO'LIQ yozing — har bir so'ralgan slayd (sarlavha, matn/kartalar va mos rasm) "
            "bitta javobda tugallangan bo'lsin; bitta URL'ni ikki slaydda ishlatmang.\n" + "\n".join(blocks))
SEARCH_TOOLS = [{
    "type": "function",
    "function": {
        "name": "search_images",
        "description": (
            "Internetdan slaydga MOS HAQIQIY rasm, GIF yoki qisqa VIDEO qidiradi va to'g'ridan-to'g'ri havolalarni qaytaradi. Foydalanuvchi GIF yoki video so'rasa kind='gif' / kind='video' bilan alohida chaqiring. "
            "Rasm kerak bo'lgan HAR BIR slayd uchun, mavzuga 100% mos rasm topish uchun chaqiring. "
            "MUHIM: barcha kerakli qidiruvlarni BITTA qadamda (bir xabarda bir nechta tool chaqiruvi) qiling — slaydma-slayd emas; "
            "natijalar kelgach hamma slaydlarni bitta javobda to'liq yozing. "
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

from backend import jwt_auth          # Audit H3: local JWT verification
from backend.services import resume as _resume   # Audit H5
from backend.services import abuse as _abuse     # Audit M2
from backend.services import image_shrink as _image_shrink   # big photos -> max 1600 px
from backend.services import image_pool as _ipool  # session image pool (reuse found images, one URL once)
_resume.configure(lambda: supabase)
jwt_auth.configure(config.get("supabase_url") or "", os.environ.get("SUPABASE_JWT_SECRET", ""))

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

class UsageConflict(RuntimeError):
    """The balance kept changing under us (or the DB write failed) — nothing was written."""


def update_usage_atomic(user_id: str, email: str, fn, retries: int = 8):
    """v53: balansni xavfsiz o'zgartirish: o'qi -> fn(usage) -> (yangi_usage, natija) -> CAS bilan yoz.
    To'qnashuvda qaytadan o'qib hisoblanadi (fn SOF bo'lishi shart: faqat dict'ni o'zgartirsin).
    Audit H2: EVERY attempt uses CAS. The old code wrote the last attempt WITHOUT CAS, which could overwrite a payment
    that arrived in between. Now it raises UsageConflict instead. Natija: (yozilgan_usage, natija)."""
    import random
    for attempt in range(max(1, retries)):
        u = get_or_create_user_usage(user_id, email)
        u2, out = fn(dict(u))
        for k in ("_v_free", "_v_paid"):
            if k in u:
                u2[k] = u[k]
        ok = save_user_credits(user_id, u2, 0, cas=True)
        if ok is not False:
            usage_cache_drop(user_id)
            return u2, out
        print(f"[USAGE CAS] to'qnashuv user={str(user_id)[:8]} urinish={attempt + 1}")
        time.sleep(random.uniform(0.005, 0.03) * (attempt + 1))     # jitter: parallel writers do not collide again
    raise UsageConflict(f"usage_conflict user={str(user_id)[:8]}")

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

# Audit M5: billing lives in backend/services/billing.py (names re-exported for old imports/tests)
from backend.services import billing as _billing      # noqa: E402
from backend.services import auth as _auth            # noqa: E402
from backend.services.billing import (                 # noqa: E402,F401
    USAGE_CACHE_TTL, USAGE_CACHE_FRESH_MIN, _USAGE_CACHE, _USAGE_CACHE_LOCK, usage_cache_get, usage_cache_put,
    usage_cache_drop, _CHARGE_RPC, _PENDING_CHARGES, _PENDING_LOCK, PENDING_CHARGES_MAX, _is_missing_rpc,
    _charge_rpc_call, _charge_units_py, _charge_legacy, charge_turn_atomic, _queue_pending_charge,
    retry_pending_charges, _pending_charges_loop,
)
from backend.services.auth import (                    # noqa: E402,F401
    _TOK_CACHE, _TOK_LOCK, TOK_TTL, AUTH_REVALIDATE_SEC, _SESSION_OK, _TOK_BAD, _AUTH_DEGRADED,
    _auth_error_is_invalid, _server_get_user, _mark_token_bad, auth_user_cached,
)

_billing.configure(
    supabase=lambda: supabase,
    get_usage=lambda uid, email: get_or_create_user_usage(uid, email),
    update_atomic=lambda *a, **k: update_usage_atomic(*a, **k),
    ledger_log=lambda *a, **k: ledger_log(*a, **k),
    ledger_spent=lambda *a, **k: ledger_spent(*a, **k),
    cas_version=lambda *a, **k: _cas_version(*a, **k),
)
_auth.configure(supabase=lambda: supabase, hash_user_id=lambda v: hash_user_id(v))


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

# Audit M5: prompt helpers live in backend/services/prompt_builder.py (names re-exported for old imports/tests)
from backend.services import prompt_builder as _pb
from backend.services.prompt_builder import (  # noqa: E402,F401
    _extract_imgs, extract_images_from_deck_state, _OLD_ACTIONS_NOTE, _FENCE_RE, _strip_old_actions, ai_balance_rules,
)


def _max_ctx_cfg() -> int:
    try:
        return max(2, int(config.get("max_context_messages", 10) or 10))
    except Exception:
        return 10


def build_history(chat_history) -> List[dict]:
    return _pb.build_history(chat_history, _max_ctx_cfg())


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
    ("/api/create-checkout", 10),
    ("/api/telegram/auth", 20),
    ("/api/user/usage", 60),
    ("/api/media-search", 120),
    ("/api/proxy-image", 900),
    ("/api/proxy-video", 60),
    ("/api/", 240),
)
_RL_EXEMPT = ("/webhooks", "/webhoks", "/api/payment/dodo-webhook")

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

def _safe_client_ip(conn) -> str:
    """Audit M2: IP for the abuse check — never breaks the request."""
    try:
        return _client_ip(conn)
    except Exception:
        return "?"

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
    rid = obs.new_request_id(request.headers.get("x-request-id"))       # Audit M4
    obs.request_id_var.set(rid)
    if path.startswith("/api/") and _rate_limited(ip, path):
        _metrics.inc("http_rate_limited_total", help="HTTP requests refused by the IP rate limit")
        return JSONResponse({"error": "Juda ko'p so'rov. Biroz kuting.", "code": "RATE_LIMITED"}, status_code=429,
                            headers={"Retry-After": "30", "X-Request-ID": rid})
    _t0 = time.perf_counter()
    try:
        resp = await call_next(request)
    except Exception as e:
        obs.capture(e)
        _metrics.inc("http_requests_total", {"status": "5xx"})
        raise
    _metrics.inc("http_requests_total", {"status": f"{resp.status_code // 100}xx"}, help="HTTP requests by status class")
    _metrics.inc("http_request_seconds_sum", value=time.perf_counter() - _t0, help="Total HTTP handling time")
    h = resp.headers
    h["X-Request-ID"] = rid
    h.setdefault("X-Content-Type-Options", "nosniff")
    # v43: Telegram Web/Desktop Mini App'ni iframe ichida ochadi -> faqat o'z domen va telegram ruxsat etiladi
    h.setdefault("Content-Security-Policy", "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org https://telegram.org")
    h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # v66: mikrofon faqat O'Z saytimizga ruxsat (ovozli yozish). Avval microphone=() — brauzer ruxsat ham so'ramay rad etardi
    h.setdefault("Permissions-Policy", "camera=(), microphone=(self), geolocation=()")
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

@app.get("/metrics")
def metrics_endpoint(request: Request):
    """Audit M4: Prometheus metrics. Needs METRICS_TOKEN (Authorization: Bearer ...); without it -> 404."""
    import hmac as _h
    tok = os.environ.get("METRICS_TOKEN", "").strip()
    got = (request.headers.get("authorization") or "")[7:].strip()
    if not tok or not _h.compare_digest(tok, got):
        raise HTTPException(404, "Not Found")
    return Response(_metrics.render(), media_type="text/plain; version=0.0.4")


@app.get("/healthz")
def healthz():
    return {"ok": True, "ai": bool((config.get("api_key") or "").strip()), "auth": bool(supabase)}

# ---------------------------------------------------------------------------------------------
# v68: yuklab olingan HTML taqdimot (file:// dan ochilgan) ichidagi YouTube / Vimeo / Dailymotion pleyeri.
# file:// sahifada Referer bo'lmaydi va YouTube pleyeri «xato 153» beradi. HTML fayl videoni shu sahifa orqali
# o'ynatadi: Referer = bizning sayt, video slaydning O'Z JOYIDA o'ynaydi (havolaga o'tib ketmaydi).
# Istalgan joydan iframe ichida ochilishi kerak (file:// ham) — shuning uchun frame-ancestors qo'yilmaydi.
# ---------------------------------------------------------------------------------------------
_EMBED_ID_RE = {
    "youtube": _re.compile(r"^[\w-]{11}$"),
    "vimeo": _re.compile(r"^\d{1,12}$"),
    "dailymotion": _re.compile(r"^[a-zA-Z0-9]{5,12}$"),
}

@app.get("/embed-player")
def embed_player(k: str = "youtube", id: str = "", au: int = 1, mu: int = 1, lp: int = 1, st: int = 0, bg: int = 0, h: str = ""):
    rx = _EMBED_ID_RE.get(k)
    if not rx or not rx.match(id or ""):
        raise HTTPException(400, "Noto'g'ri video")
    au, mu, lp, bg = (1 if au else 0), (1 if mu else 0), (1 if lp else 0), (1 if bg else 0)
    st = max(0, min(int(st or 0), 86400))
    if bg:
        au, mu, lp = 1, 1, 1
    if k == "youtube":
        q = f"rel=0&playsinline=1&autoplay={au}&mute={1 if au else mu}&controls={0 if bg else 1}"
        if lp:
            q += f"&loop=1&playlist={id}"
        if st:
            q += f"&start={st}"
        if bg:
            q += "&disablekb=1&fs=0&modestbranding=1&iv_load_policy=3"
        src = f"https://www.youtube.com/embed/{id}?{q}"
    elif k == "vimeo":
        hh = h if _re.match(r"^[0-9a-f]{6,20}$", h or "") else ""
        src = f"https://player.vimeo.com/video/{id}?autoplay={au}&muted={1 if au else mu}&loop={lp}" + ("&background=1" if bg else "") + (f"&h={hh}" if hh else "")
    else:
        src = f"https://www.dailymotion.com/embed/video/{id}?autoplay={au}&mute={mu}"
    page = ("<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta name=\"referrer\" content=\"strict-origin-when-cross-origin\"><title>Video</title>"
            "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{position:absolute;inset:0;width:100%;height:100%;border:0}</style>"
            f"</head><body><iframe src=\"{src}\" title=\"Video\" allow=\"autoplay; fullscreen; encrypted-media; picture-in-picture\" allowfullscreen "
            "referrerpolicy=\"strict-origin-when-cross-origin\"></iframe></body></html>")
    return HTMLResponse(page, headers={
        # frame-ancestors YO'Q: yuklab olingan HTML fayl (file://) ichida ochilishi kerak
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-src https://www.youtube.com https://player.vimeo.com https://www.dailymotion.com",
        "Cache-Control": "public, max-age=86400",
    })

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
        charge_atomic=lambda *a, **k: charge_turn_atomic(*a, **k),   # Audit H2: atomic SQL charge (kech bog'lanadi)
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

_PURGE = {"last": 0.0, "off": False}


def purge_old_rows_once() -> Optional[dict]:
    """Audit M3: daily retention (SQL public.purge_old_rows). payment_events is never deleted."""
    if not supabase or _PURGE["off"]:
        return None
    _PURGE["last"] = time.time()
    try:
        r = supabase.rpc("purge_old_rows", {
            "p_ledger_days": max(30, _env_int("RETENTION_LEDGER_DAYS", 365)),
            "p_audit_days": max(30, _env_int("RETENTION_AUDIT_DAYS", 365)),
            "p_adsent_days": max(3, _env_int("RETENTION_ADSENT_DAYS", 7)),
            "p_turns_days": 1, "p_batch": 5000,
        }).execute()
        data = r.data[0] if isinstance(r.data, list) and r.data else r.data
        print(f"[PURGE] eski yozuvlar o'chirildi: {data}")
        return data if isinstance(data, dict) else {}
    except Exception as e:
        if _is_missing_rpc(e) or "purge_old_rows" in str(e).lower():
            print("[PURGE] ⚠️ SQL funksiya public.purge_old_rows yo'q (SUPABASE_SCHEMA.sql 14-bo'lim) — tozalash o'chiq.")
            _PURGE["off"] = True
        else:
            print(f"[PURGE] {str(e)[:160]}")
        return None


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
            for k in [k for k, v in list(_UWIN.items()) if not v or now - v[-1] > 120]:
                _UWIN.pop(k, None)
            if now - _PURGE["last"] > 86400 + (os.getpid() % 3600):     # Audit M3: once a day, workers spread out
                await asyncio.to_thread(purge_old_rows_once)
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
    _pc_task = asyncio.create_task(_pending_charges_loop())      # Audit H2: retries charges queued during a DB outage
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    _bg_tasks.add(_pc_task)
    _pc_task.add_done_callback(_bg_tasks.discard)
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
        _pc_task.cancel()
        if _PENDING_CHARGES:              # deploy/restart: one last try, the queue lives only in RAM
            try:
                left = await asyncio.wait_for(asyncio.to_thread(retry_pending_charges), timeout=10)
                if left:
                    print(f"[CHARGE] ❌ to'xtashda {left} ta yechim bazaga yozilmadi")
            except Exception as e:
                print(f"[CHARGE] shutdown flush: {str(e)[:120]}")
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
        "pack_price_usd": round(topup_gross_cents(pack_pages()) / 100, 2),
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
    usage_cache_drop(user_id)        # Audit H4: every balance change (admin, purchase, merge) writes a ledger row
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

# Balansni o'zgartiradigan "to'ldirish" yozuvlari: hisoblagich maxraji shulardan keyingi balans bo'ladi.
TOPUP_LEDGER_KINDS = ["purchase", "refund", "admin_credit", "account_merge_in", "tg_link_in"]


def balance_cap_units(user_id: str, u: dict) -> int:
    """v66: saytdagi hisoblagich «80/80» — maxraj = oxirgi to'ldirish (sotib olish / admin +/-) dan keyingi balans.
    Pullik varaq yo'q bo'lsa — kunlik limit. Hech qachon joriy balansdan kichik emas."""
    total = int(u.get("free_credits") or 0) + int(u.get("paid_credits") or 0)
    if int(u.get("paid_credits") or 0) <= 0:
        return max(daily_units_for(u), total)
    top = None
    if supabase and user_id and not str(user_id).startswith(("dev-", "anon-", "guest-")):
        try:
            rows = (supabase.table("usage_ledger").select("free_after,paid_after").eq("user_id", str(user_id))
                    .in_("kind", TOPUP_LEDGER_KINDS).order("created_at", desc=True).limit(1).execute().data or [])
            if rows:
                top = int(rows[0].get("free_after") or 0) + int(rows[0].get("paid_after") or 0)
        except Exception:
            top = None
    return max(total, top or total)


_merge_checked: "OrderedDict[str, float]" = OrderedDict()


def _merge_duplicates_once(uid: str, email: str) -> None:
    """v66: 1 email = 1 balans. Foydalanuvchi saytga kirganda (token tasdiqlangan => shu uid Auth'da BOR)
    shu email'dagi eski akkaunt qoldiqlari (pullik varaq, VIP, Telegram ulanishi) shu akkauntga birlashtiriladi.
    Har uid uchun jarayonda bir marta tekshiriladi (ortiqcha so'rov yo'q)."""
    if not supabase or not uid or not email or uid in _merge_checked:
        return
    _merge_checked[uid] = time.time()
    while len(_merge_checked) > 20000:
        _merge_checked.popitem(last=False)
    try:
        res = admin_core.merge_email_accounts("auto-login", email, keep_uid=uid)
        if res.get("merged"):
            print(f"[MERGE] {email}: {res['merged']} ta o'chirilgan akkaunt qoldig'i tozalandi (asosiy: {uid})")
    except Exception as e:
        _merge_checked.pop(uid, None)          # keyingi safar yana urinib ko'ramiz
        print(f"[MERGE] {email}: {str(e)[:160]}")


# Audit M5: auth lives in backend/services/auth.py (names re-exported below for old imports/tests)

@app.get("/api/user/usage")
def user_usage(request: Request, token: str = "", fresh: int = 0):
    token = _bearer(request, token)       # Audit C4: header preferred; ?token= kept only for old cached clients
    if not supabase or not token:
        u = normalize_user_row({
            "free_credits": free_daily_units(),
            "paid_credits": 0,
            "prompt_count": 0,
            "last_reset_time": datetime.now(timezone.utc).isoformat(),
        })
        return {**usage_payload(u), "total_tokens": 0, "daily_tokens": 0}
    try:
        who = auth_user_cached(token)
        if not who:
            return {"error": "invalid_token"}
        uid, email = who
        cached = usage_cache_get(uid, fresh=bool(fresh))
        if cached is not None:
            _metrics.inc("usage_cache_total", {"result": "hit"}, help="/api/user/usage cache")
            return cached
        _metrics.inc("usage_cache_total", {"result": "miss"})
        _merge_duplicates_once(uid, email)
        u = get_or_create_user_usage(uid, email)
        if _abuse.check_new_account(supabase, uid, u, _safe_client_ip(request), _SCALING_HMAC_SECRET):   # Audit M2
            u = get_or_create_user_usage(uid, email)
        u["spent_24h"] = ledger_spent(uid, u.get("last_reset_time"))
        payload = usage_payload(u)
        payload["cap_units"] = balance_cap_units(uid, apply_24h_reset(dict(u)))
        payload["total_tokens"] = u.get("total_tokens", 0)
        payload["daily_tokens"] = u.get("daily_tokens", 0)
        usage_cache_put(uid, payload)
        return payload
    except Exception as e:
        print(f"[USAGE] {e}")
        return {"error": "usage_unavailable"}

@app.get("/api/billing/plans")
def billing_plans():
    return {
        "plans": plans_public(),
        "checkout_price_usd": round(topup_gross_cents(pack_pages()) / 100, 2),
        "pages_per_pack": pack_pages(),
        "deep_pages_per_pack": pack_units() // MODES["deep"]["page"],
        "free_daily": rt("free_daily_pages"),
        "deep_free_daily": free_daily_units() // MODES["deep"]["page"],
        "note": f"Dodo Payments komissiyasi ({DODO_FEE_PERMILLE / 10:g}% + ${DODO_FEE_FIXED_CENTS / 100:.2f}) to'lovga qo'shiladi; 1 USD netto = 100 kredit",
        "fee": topup_fee_public(),
        "topup_packages": {k: _topup_quote_public(_topup_quote(k, v["net_cents"], v["credits"])) for k, v in TOPUP_PACKAGES.items()},
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

DODO_BASE_URLS = {"test": "https://test.dodopayments.com", "live": "https://live.dodopayments.com"}


def _dodo_env():
    """Dodo Payments sozlamalari. Rejim: DODO_PAYMENTS_ENV=test|live (standart: test).
    Live'ga o'tish uchun: DODO_PAYMENTS_ENV=live + live API kalit / mahsulot / webhook secret."""
    mode = (os.environ.get("DODO_PAYMENTS_ENV") or "test").strip().lower()
    if mode not in DODO_BASE_URLS:
        mode = "test"
    base = (os.environ.get("DODO_PAYMENTS_BASE_URL") or "").strip().rstrip("/") or DODO_BASE_URLS[mode]
    return {
        "api_key": _clean_env("DODO_PAYMENTS_API_KEY", bearer=True),
        "product_id": _clean_env("DODO_PRODUCT_ID"),
        "secret": _clean_env("DODO_WEBHOOK_SECRET"),
        "mode": mode,
        "api_base": base,
        "base_url": (os.environ.get("PUBLIC_BASE_URL") or "").strip().rstrip("/"),
    }

@app.get("/api/payment/health")
def payment_health():
    """To'lov sozlamalari tekshiruvi (kalitlarning o'zi ko'rsatilmaydi)."""
    e = _dodo_env()
    return {
        "provider": "dodo",
        "api_key": bool(e["api_key"]),
        "product_id": bool(e["product_id"]),
        "webhook_secret": bool(e["secret"]),
        "mode": e["mode"],
        "api_base": e["api_base"],
        "public_base_url": e["base_url"] or None,
        "supabase": bool(supabase),
    }

async def _dodo_request(method: str, path: str, api_key: str, base: str, body: dict = None) -> dict:
    """Dodo Payments REST API. {'status', 'json'} yoki {'status', 'error_body'} qaytaradi."""
    url = base.rstrip("/") + path
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=20) as cli:
        r = await cli.request(method, url, headers=headers, json=body)
    if 200 <= r.status_code < 300:
        try:
            return {"status": r.status_code, "json": r.json()}
        except ValueError:
            return {"status": r.status_code, "error_body": r.text[:4000]}
    return {"status": r.status_code, "error_body": r.text[:4000]}


async def _payment_user_from_token(payload: Dict[str, Any]):
    """(user_id, email, error_response). Foydalanuvchi FAQAT Supabase token orqali aniqlanadi —
    mijoz yuborgan user_id ga ishonilmaydi (boshqa akkauntga yozib yuborish xatosidan himoya)."""
    token = (payload.get("token") or "").strip()
    if not token or token == "dev-token" or not supabase:
        return None, "", JSONResponse({"error": "To'lov uchun avval tizimga kiring."}, status_code=401)
    try:
        user_res = await asyncio.to_thread(supabase.auth.get_user, token)
    except Exception as e:
        return None, "", JSONResponse({"error": f"Sessiya xato: {str(e)[:120]}"}, status_code=401)
    if not user_res or not user_res.user:
        return None, "", JSONResponse({"error": "Sessiya tugagan. Qayta kiring."}, status_code=401)
    claimed = str(payload.get("user_id") or "").strip()
    if claimed and claimed != str(user_res.user.id):
        return None, "", JSONResponse({"error": "user_id sessiyaga mos emas."}, status_code=403)
    return str(user_res.user.id), (user_res.user.email or payload.get("email") or "").strip(), None


@app.post("/api/create-checkout")
@app.post("/api/payment/create-checkout")
async def create_checkout(payload: Dict[str, Any] = None):
    """Dodo Payments checkout session. Body: {token, amount | net_amount | package, return_url?}.
    amount — dollarda (kamida $1). Javob: {checkout_url, session_id, pages, price_usd, quote}."""
    payload = payload or {}
    user_id, user_email, err_resp = await _payment_user_from_token(payload)
    if err_resp is not None:
        return err_resp
    if payload.get("amount") not in (None, "") and payload.get("net_amount") in (None, ""):
        payload = {**payload, "net_amount": payload.get("amount")}
    quote, err = _topup_quote_from_payload(payload)
    if err:
        return JSONResponse({"error": err}, status_code=400)
    # Mijoz ko'rsatgan "Jami to'lov" serverdagi hisob bilan bir xil bo'lishi shart (narx yashirin o'zgarmasin).
    client_gross = payload.get("gross_amount")
    if client_gross not in (None, ""):
        try:
            client_gross_cents = int(round(float(client_gross) * 100))
        except (TypeError, ValueError):
            client_gross_cents = -1
        if client_gross_cents != quote["gross_cents"]:
            return JSONResponse({"error": "Narx yangilandi. Oynani yopib, qaytadan urinib ko'ring.",
                                 "quote": _topup_quote_public(quote)}, status_code=409)
    code, data = await _build_checkout(user_id, user_email, str(payload.get("return_url") or ""), "pack", quote=quote)
    return data if code == 200 else JSONResponse(data, status_code=code)


# ---------------------------------------------------------------------------------------------
# Kredit to'ldirish: paketlar va imzolangan metadata. 1 cent netto = 1 kredit (1 USD = 100 kredit).
# Dodo Payments komissiyasi mijoz narxiga qo'shiladi, shunda bizga tanlangan summa (N) to'liq tushadi:
#     gross = ceil((N + FIXED) / (1 - PERCENT))
# Standart: 5.5% + $0.40 (4% bazaviy + 1.5% xalqaro karta). Env: DODO_FEE_PERCENT, DODO_FEE_FIXED_CENTS.
# Masalan: $1 -> $1.49, $5 -> $5.71, $10 -> $11.01, $20 -> $21.59.
# ---------------------------------------------------------------------------------------------
def _env_fee_permille() -> int:
    try:
        pct = float(os.environ.get("DODO_FEE_PERCENT") or 5.5)
    except ValueError:
        pct = 5.5
    return max(0, min(500, int(round(pct * 10))))            # 0% .. 50%

def _env_fee_fixed_cents() -> int:
    return max(0, min(500, _env_int("DODO_FEE_FIXED_CENTS", 40)))

DODO_FEE_PERMILLE = _env_fee_permille()       # 55 = 5.5%
DODO_FEE_FIXED_CENTS = _env_fee_fixed_cents() # 40 = $0.40
TOPUP_MIN_CENTS = 100           # $1.00 netto (mijoz komissiya bilan ko'proq to'laydi; Dodo minimal $1 dan katta)
TOPUP_MAX_CENTS = 100_000       # $1000.00 — xato kiritishdan himoya
TOPUP_PACKAGES: Dict[str, Dict[str, Any]] = {
    "starter":  {"net_cents": 100,  "credits": 100,  "label": "Starter"},
    "popular":  {"net_cents": 500,  "credits": 550,  "label": "Eng ommabop"},
    "pro":      {"net_cents": 1000, "credits": 1200, "label": "Pro"},
    "business": {"net_cents": 2000, "credits": 2600, "label": "Business"},
}


def topup_gross_cents(net_cents: int) -> int:
    """Mijoz to'laydigan summa (sentlarda): gross = ceil((N + FIXED) * 1000 / (1000 - PERMILLE)).
    Butun sonlarda (float xatosiz) — frontend (js/46_topup.js) bilan bir xil natija."""
    num = (int(net_cents) + DODO_FEE_FIXED_CENTS) * 1000
    return -(-num // (1000 - DODO_FEE_PERMILLE))


def topup_net_from_gross_cents(gross_cents: int) -> int:
    """Teskari hisob (imzosiz yoki kam to'langan to'lovlar uchun): N = gross * (1 - PERCENT) - FIXED, pastga."""
    return max(0, (int(gross_cents) * (1000 - DODO_FEE_PERMILLE)) // 1000 - DODO_FEE_FIXED_CENTS)


def topup_fee_public() -> Dict[str, Any]:
    return {"percent": DODO_FEE_PERMILLE / 10, "fixed_usd": DODO_FEE_FIXED_CENTS / 100,
            "permille": DODO_FEE_PERMILLE, "fixed_cents": DODO_FEE_FIXED_CENTS}


def _topup_quote(package: str, net_cents: int, credits: int) -> Dict[str, Any]:
    gross = topup_gross_cents(net_cents)
    return {"package": package, "net_cents": int(net_cents), "credits": int(credits),
            "gross_cents": gross, "fee_cents": gross - int(net_cents)}


def _topup_quote_public(q: Dict[str, Any]) -> Dict[str, Any]:
    return {"package": q["package"], "credits": q["credits"],
            "net_usd": round(q["net_cents"] / 100, 2), "fee_usd": round(q["fee_cents"] / 100, 2),
            "gross_usd": round(q["gross_cents"] / 100, 2)}


def _topup_quote_from_payload(payload: Dict[str, Any]):
    """(quote, error). Kreditlar va narx FAQAT serverda hisoblanadi — mijoz yuborgan credits e'tiborsiz."""
    package = str(payload.get("package") or "").strip().lower()
    if package and package != "custom":
        p = TOPUP_PACKAGES.get(package)
        if not p:
            return None, "Noma'lum paket."
        return _topup_quote(package, p["net_cents"], p["credits"]), None
    raw = payload.get("net_amount")
    if raw in (None, "") and payload.get("amount_cents"):
        raw = _int_or(payload.get("amount_cents"), 0) / 100
    if raw in (None, ""):                                           # hech narsa tanlanmagan -> standart paket
        return _topup_quote("pack", pack_pages(), pack_pages()), None
    try:
        net = float(raw)
    except (TypeError, ValueError):
        return None, "Miqdor noto'g'ri."
    if net != net or net in (float("inf"), float("-inf")):
        return None, "Miqdor noto'g'ri."
    net_cents = int(round(net * 100))
    if net_cents < TOPUP_MIN_CENTS:
        return None, "Eng kam miqdor — $1.00."
    if net_cents > TOPUP_MAX_CENTS:
        return None, f"Eng ko'p miqdor — ${TOPUP_MAX_CENTS // 100}."
    return _topup_quote("custom", net_cents, net_cents), None


def _topup_sign_key() -> bytes:
    d = _dodo_env()
    return (d["secret"] or d["api_key"] or "slidestudio-dev").encode()


def _topup_sig(user_id: str, package: str, net_cents: int, credits: int, gross_cents: int) -> str:
    import hmac, hashlib
    msg = f"topup|{user_id}|{package}|{int(net_cents)}|{int(credits)}|{int(gross_cents)}".encode()
    return hmac.new(_topup_sign_key(), msg, hashlib.sha256).hexdigest()


def _topup_verified_credits(meta: Dict[str, Any], user_id: str, paid_cents: int):
    """Imzo to'g'ri va to'langan summa kutilganidan kam bo'lmasa -> kreditlar soni (paket bonusi bilan), aks holda None."""
    import hmac
    sig = str(meta.get("sig") or "")
    if not sig:
        return None
    net_cents = _int_or(meta.get("net_cents"), -1)
    credits = _int_or(meta.get("credits"), -1)
    gross = _int_or(meta.get("gross_cents"), -1)
    package = str(meta.get("package") or "")
    if net_cents <= 0 or credits <= 0 or gross <= 0:
        return None
    expected = _topup_sig(user_id, package, net_cents, credits, gross)
    if not hmac.compare_digest(sig, expected):
        print("[DODO WEBHOOK] metadata imzosi noto'g'ri — to'langan summa bo'yicha hisoblanadi.")
        return None
    if paid_cents < gross:              # Dodo summani aniq sentlarda yuboradi
        print(f"[DODO WEBHOOK] to'langan {paid_cents} < kutilgan {gross} — to'langan summa bo'yicha hisoblanadi.")
        return None
    return credits


def _safe_return_url(base: str, hint: str) -> str:
    url = base or str(hint or "").strip().rstrip("/")
    return url if url.startswith(("http://", "https://")) else ""


async def _build_checkout(user_id, user_email: str, return_url_hint: str = "", product: str = "pack",
                          quote: Dict[str, Any] = None, embed: bool = False):
    """Sayt VA Telegram bot uchun umumiy Dodo checkout session. (http_status, dict) qaytaradi."""
    d = _dodo_env()
    if not d["api_key"] or not d["product_id"]:
        return 503, {
            "error": "Dodo Payments sozlanmagan",
            "hint": "Render env'ga DODO_PAYMENTS_API_KEY va DODO_PRODUCT_ID yozing",
        }
    q = quote or _topup_quote("pack", pack_pages(), pack_pages())
    if q["gross_cents"] < TOPUP_MIN_CENTS:
        return 400, {"error": "Eng kam miqdor — $1.00."}
    # Dodo metadata: faqat satr qiymatlar (webhookda _int_or bilan o'qiladi)
    metadata = {
        "user_id": str(user_id), "product": "pack", "package": q["package"],
        "net_cents": str(q["net_cents"]), "credits": str(q["credits"]), "gross_cents": str(q["gross_cents"]),
        "sig": _topup_sig(str(user_id), q["package"], q["net_cents"], q["credits"], q["gross_cents"]),
    }
    body: Dict[str, Any] = {
        # "Pay What You Want" mahsuloti: amount — mijoz to'laydigan narx, SENTLARDA ($5 -> 500)
        "product_cart": [{"product_id": d["product_id"], "quantity": 1, "amount": int(q["gross_cents"])}],
        "metadata": metadata,
    }
    if user_email:
        body["customer"] = {"email": user_email, "name": user_email.split("@")[0][:60] or "Customer"}
    return_url = _safe_return_url(d["base_url"], return_url_hint)
    if return_url:
        body["return_url"] = return_url + "/?payment=success"
    try:
        res = await _dodo_request("POST", "/checkouts", d["api_key"], d["api_base"], body)
    except Exception as e:
        return 502, {"error": f"Dodo Payments ga ulanib bo'lmadi: {type(e).__name__}: {str(e)[:200]}"}
    if "json" in res:
        js = res["json"] or {}
        url = js.get("checkout_url") or js.get("url")
        if url:
            return 200, {"checkout_url": url, "session_id": js.get("session_id"), "pages": q["credits"],
                         "price_usd": round(q["gross_cents"] / 100, 2), "product": "pack",
                         "quote": _topup_quote_public(q)}
        return 502, {"error": "Dodo Payments checkout_url qaytarmadi"}
    code = res.get("status")
    print(f"[DODO CHECKOUT] HTTP {code}: {res.get('error_body')}", flush=True)
    if code in (401, 403):
        msg = f"Dodo Payments API kaliti noto'g'ri yoki rejim mos emas (DODO_PAYMENTS_API_KEY, rejim: {d['mode']})."
    elif code == 404:
        msg = f"Dodo Payments: mahsulot topilmadi (DODO_PRODUCT_ID; API kalit bilan bir rejimda bo'lishi kerak: {d['mode']})."
    elif code in (400, 422):
        msg = f"Dodo Payments so'rovni qabul qilmadi (HTTP {code})."
    else:
        msg = f"Dodo Payments xatosi (HTTP {code})."
    reason = _dodo_error_reason(res.get("error_body", ""))
    if reason:
        msg = f"{msg} Sabab: {reason}"
    return 502, {"error": msg, "dodo_status": code, "detail": (res.get("error_body") or "")[:300]}


def _dodo_error_reason(raw: str) -> str:
    """Dodo xato javobidan qisqa sabab ({'code','message'})."""
    try:
        js = json.loads(raw or "{}") or {}
    except Exception:
        return ""
    if not isinstance(js, dict):
        return ""
    return str(js.get("message") or js.get("error") or js.get("detail") or "").strip()[:300]


async def _checkout_for_bot(user_id: str, email: str = "", return_url: str = "", product: str = "pack") -> dict:
    """Telegram bot «To'ldirish» tugmasi uchun. {'url','pages','price'} yoki {'error'}."""
    code, data = await _build_checkout(user_id, (email or "").strip(), return_url, product)
    if code == 200:
        return {"url": data["checkout_url"], "pages": data.get("pages"), "days": data.get("days"), "price": data.get("price_usd"), "product": product}
    return {"error": data.get("error") or "checkout_error", "hint": data.get("hint") or data.get("detail") or ""}

_processed_orders: set = set()          # faqat DEV (Supabase yo'q) rejimi uchun

def _apply_payment_sync(key: str, user_id: str, pages: int, sign: int, event_name: str) -> dict:
    """ATOMIK + IDEMPOTENT: SQL funksiyasi public.apply_payment (SUPABASE_SCHEMA.sql, 10-bo'lim) bitta tranzaksiyada
    payment_events ga yozadi va balansni yangilaydi. Bir xil kalit (payment_id) qayta kelsa — {'duplicate': true}.
    Funksiya yo'q/xato bo'lsa — istisno ko'tariladi (webhook 500 qaytaradi, Dodo qayta yuboradi)."""
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
        print(f"[DODO WEBHOOK] email qidiruv xatosi: {e}")
    return ""

def _int_or(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default

def _refunded_pages(order_key: str) -> int:
    """Shu to'lov bo'yicha avval olingan (refund) varaqlar yig'indisi."""
    if not supabase or not order_key:
        return 0
    try:
        rows = supabase.table("payment_events").select("pages").like("order_id", f"refund-{order_key}%").execute().data or []
        return sum(_int_or(r.get("pages"), 0) for r in rows)
    except Exception as e:
        print(f"[DODO WEBHOOK] refund tarixini o'qib bo'lmadi: {str(e)[:120]}")
        raise

def _payment_event_row(order_key: str) -> dict:
    """payment_events dagi asl to'lov yozuvi (refund uchun: kimga va qancha varaq berilgan)."""
    if not supabase:
        return {}
    rows = supabase.table("payment_events").select("user_id,pages").eq("order_id", order_key).execute().data or []
    return rows[0] if rows else {}

_unmatched_notified: "OrderedDict[str, float]" = OrderedDict()

async def _report_unmatched_payment(order_id: str, event_name: str, email: str, details_extra: dict) -> None:
    """Egasi topilmagan to'lov: log + admin_audit + adminlarga Telegram (bir to'lov uchun bir marta)."""
    print(f"[DODO WEBHOOK] ⚠️ user_id topilmadi! payment={order_id} email={email} — qo'lda kredit bering.")
    if order_id in _unmatched_notified:
        return
    _unmatched_notified[order_id] = time.time()
    while len(_unmatched_notified) > 500:
        _unmatched_notified.popitem(last=False)
    details = {"payment": order_id, "event": event_name, "email": email, **(details_extra or {})}
    try:
        await asyncio.to_thread(admin_core.audit, "dodo-webhook", "payment_unmatched", order_id, details)
    except Exception:
        pass
    if tgbot is not None:
        text = (f"⚠️ To'lov egasi topilmadi\nTo'lov: {order_id}\nEmail: {email or '—'}\n"
                f"Hodisa: {event_name}\nVaraqlarni qo'lda bering (admin panel).")
        for tid in list(admin_core.admin_tg_ids()):
            try:
                await tgbot.admin_send(int(tid), text)
            except Exception:
                pass


WEBHOOK_TOLERANCE_SEC = 5 * 60

def _verify_standard_webhook(secret: str, msg_id: str, timestamp: str, signature: str, raw: bytes) -> bool:
    """Standard Webhooks (Dodo): HMAC-SHA256( "{webhook-id}.{webhook-timestamp}.{body}" ), base64.
    secret = "whsec_<base64>"; webhook-signature = "v1,<base64> [v1,<base64> ...]"."""
    import hmac, hashlib, base64
    if not (secret and msg_id and timestamp and signature):
        return False
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts) > WEBHOOK_TOLERANCE_SEC:          # eski so'rovni qayta yuborishdan himoya
        return False
    key_s = secret[6:] if secret.startswith("whsec_") else secret
    try:
        key = base64.b64decode(key_s, validate=True)
    except Exception:
        key = key_s.encode()
    signed = f"{msg_id}.{ts}.".encode() + raw
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()
    for part in signature.split():
        ver, _, sig = part.partition(",")
        if ver == "v1" and sig and hmac.compare_digest(sig, expected):
            return True
    return False


def _paid_cents_usd(data: dict) -> int:
    """Soliqsiz to'langan summa (USD sentlarda). Boshqa valyutada bo'lsa — settlement (USD) summasi."""
    total = _int_or(data.get("total_amount"), 0)
    tax = max(0, _int_or(data.get("tax"), 0))
    if str(data.get("currency") or "USD").upper() == "USD":
        return max(0, total - tax)
    if str(data.get("settlement_currency") or "").upper() == "USD":
        st = _int_or(data.get("settlement_amount"), 0)
        stax = max(0, _int_or(data.get("settlement_tax"), 0))
        return max(0, st - stax)
    return max(0, total - tax)


async def _credit_user(user_id: str, email: str, key: str, pages: int, sign: int, event_name: str, ref: str):
    async with _user_lock(user_id):       # bot/sayt bilan BIR XIL lock
        await asyncio.to_thread(get_or_create_user_usage, user_id, email)     # qator borligiga ishonch
        res = await asyncio.to_thread(_apply_payment_sync, key, user_id, pages, sign, event_name)
        if res.get("duplicate"):
            return None
        usage_cache_drop(user_id)
        u = await asyncio.to_thread(get_or_create_user_usage, user_id, email)
        await asyncio.to_thread(ledger_log, user_id, "refund" if sign < 0 else "purchase",
                                sign * pages * UNIT, u, 0, {"order": ref})
    try:   # Telegram foydalanuvchisiga darhol xabar (balans bazada allaqachon yangilangan)
        if tgbot is not None:
            asyncio.create_task(tgbot.notify_purchase(str(user_id), pages, sign < 0))
    except Exception:
        pass
    return u


@app.post("/webhooks")
@app.post("/webhoks")                       # dashboard'da xato yozilgan manzil ham ishlasin
@app.post("/api/payment/dodo-webhook")
async def dodo_webhook(request: Request):
    """Dodo Payments: payment.succeeded -> kredit qo'shiladi; refund.succeeded -> qaytarib olinadi.
    Idempotent: bir xil payment_id / refund_id qayta kelsa ikki marta hisoblanmaydi."""
    raw = await request.body()
    d = _dodo_env()
    dev = os.environ.get("SLIDE_STUDIO_DEV_MODE", "").strip() == "1"
    if not d["secret"]:
        if not dev:
            print("[DODO WEBHOOK] DODO_WEBHOOK_SECRET yo'q — so'rov rad etildi.")
            return JSONResponse({"error": "webhook secret sozlanmagan"}, status_code=503)
    elif not _verify_standard_webhook(d["secret"], request.headers.get("webhook-id") or "",
                                      request.headers.get("webhook-timestamp") or "",
                                      request.headers.get("webhook-signature") or "", raw):
        _metrics.inc("webhook_events_total", {"result": "bad_signature"}, help="Dodo webhook events by result")
        print("[DODO WEBHOOK] noto'g'ri imzo yoki eskirgan timestamp — rad etildi.")
        return JSONResponse({"error": "invalid signature"}, status_code=401)
    try:
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
    if not isinstance(event, dict):
        return JSONResponse({"error": "invalid json"}, status_code=400)

    etype = str(event.get("type") or "").strip()
    data = event.get("data") or {}
    if etype not in ("payment.succeeded", "refund.succeeded"):
        return {"ok": True, "ignored": etype}
    payment_id = str(data.get("payment_id") or "").strip()
    if not payment_id:
        print(f"[DODO WEBHOOK] ⚠️ payment_id yo'q ({etype}) — rad etildi.")
        return JSONResponse({"error": "missing payment_id"}, status_code=400)
    pay_key = f"dodo-{payment_id}"

    try:
        if etype == "payment.succeeded":
            if str(data.get("status") or "succeeded").lower() != "succeeded":
                return {"ok": True, "ignored": f"status={data.get('status')}"}
            meta = data.get("metadata") or {}
            customer = data.get("customer") or {}
            email = str(customer.get("email") or "").strip()
            if str(meta.get("product") or "pack") != "pack":
                return {"ok": True, "ignored": "other_product"}
            user_id = str(meta.get("user_id") or "").strip()
            if not user_id or user_id == "unknown":
                user_id = await asyncio.to_thread(_find_user_by_email, email)
            if not user_id:
                # 500 -> Dodo qayta yuboradi (shu orada foydalanuvchi ro'yxatdan o'tsa, email bo'yicha topiladi)
                await _report_unmatched_payment(payment_id, etype, email,
                                                {"total_amount": data.get("total_amount"), "currency": data.get("currency")})
                return JSONResponse({"error": "user not found"}, status_code=500)
            paid = _paid_cents_usd(data)
            # Kreditlar: imzolangan metadata.credits (paket bonusi bilan); imzo yo'q/noto'g'ri yoki kam to'langan
            # bo'lsa — to'langan summadan komissiyani ayirib (1 cent netto = 1 kredit).
            pages = _topup_verified_credits(meta, user_id, paid)
            if pages is None:
                pages = topup_net_from_gross_cents(paid)
            if pages <= 0:
                print(f"[DODO WEBHOOK] {payment_id}: summa 0 — kredit berilmadi.")
                return {"ok": True, "ignored": "zero_amount"}
            u = await _credit_user(user_id, email, pay_key, pages, +1, etype, payment_id)
            if u is None:
                return {"ok": True, "duplicate": True}
            _metrics.inc("webhook_events_total", {"result": "credited"})
            print(f"[DODO WEBHOOK] {etype}: +{pages} -> {user_id} (payment={payment_id}, mode={d['mode']})")
            return {"ok": True, "user_id": user_id, "paid_credits": u.get("paid_credits"), "pages": pages}

        # refund.succeeded: asl to'lov yozuvidan kim va qancha olganini topamiz
        refund_id = str(data.get("refund_id") or "").strip()
        orig = await asyncio.to_thread(_payment_event_row, pay_key)
        user_id = str(orig.get("user_id") or "").strip()
        orig_pages = _int_or(orig.get("pages"), 0)
        if not user_id or orig_pages <= 0:
            print(f"[DODO WEBHOOK] refund: asl to'lov topilmadi (payment={payment_id}) — e'tiborsiz.")
            return {"ok": True, "ignored": "unknown_payment"}
        already = await asyncio.to_thread(_refunded_pages, pay_key)
        remaining = max(0, orig_pages - already)
        amount = _int_or(data.get("amount"), 0)
        partial = bool(data.get("is_partial")) and amount > 0
        # qisman refund: qaytarilgan summadan foiz komissiya ulushi ayriladi (1 cent netto = 1 kredit); to'liq -> qolgani
        pages = min(remaining, amount * (1000 - DODO_FEE_PERMILLE) // 1000) if partial else remaining
        if pages <= 0:
            return {"ok": True, "duplicate": True}
        # Audit M3: without refund_id the key used to be the amount, so two partial refunds of the same amount
        # collided (the 2nd was lost). webhook-id is unique per event and stable across Dodo's retries.
        key = f"refund-{pay_key}-{refund_id or request.headers.get('webhook-id') or amount}"
        u = await _credit_user(user_id, "", key, pages, -1, etype, payment_id)
        if u is None:
            return {"ok": True, "duplicate": True}
        _metrics.inc("webhook_events_total", {"result": "refunded"})
        print(f"[DODO WEBHOOK] {etype}: -{pages} -> {user_id} (payment={payment_id})")
        return {"ok": True, "user_id": user_id, "paid_credits": u.get("paid_credits"), "pages": pages}
    except Exception as e:
        # 5xx -> Dodo webhookni qayta yuboradi (idempotent, shuning uchun xavfsiz)
        _metrics.inc("webhook_events_total", {"result": "error"})
        obs.capture(e)
        print(f"[DODO WEBHOOK] xato: {type(e).__name__}: {str(e)[:200]}")
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
    if res.get("data"):
        # a 5000 px / 10 MB original took too long for the browser (the picture was dropped) -> max 1600 px
        res = dict(res)
        res["data"], res["content_type"] = _image_shrink.shrink(res["data"], res.get("content_type") or "")
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
# Speed: no artificial wait per search row (was 0.35 s each = up to 3.5 s per turn). Set SEARCH_STAGGER=0.35 for the old look.
try:
    SEARCH_STAGGER = max(0.0, float(os.environ.get("SEARCH_STAGGER", "0") or 0))
except ValueError:
    SEARCH_STAGGER = 0.0


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
        if getattr(websocket, "cancelled", lambda: False)():     # Stop pressed: do not wait for the browser
            break
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=min(left, 0.5))
        except asyncio.TimeoutError:
            continue
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


# Pictures the AI gets must really open: before, a dead link (404, hot-link blocked site, an HTML page) was put on a
# slide and its place stayed empty. The first results of each photo search are downloaded here (in parallel, through
# the same proxy cache the browser uses -> later the browser gets them instantly); the ones that fail are removed.
SEARCH_VERIFY_IMAGES = os.environ.get("SEARCH_VERIFY_IMAGES", "1").strip().lower() not in ("0", "false", "no", "off")
SEARCH_VERIFY_FIRST = 6           # results checked per search
SEARCH_VERIFY_WAIT = 8.0          # seconds; a result not checked by then keeps its place after the good ones
_VERIFY_SEM: Optional[asyncio.Semaphore] = None


async def _verify_image_results(res: list, kind: str) -> list:
    global _VERIFY_SEM
    if not SEARCH_VERIFY_IMAGES or kind not in ("photo", "image") or not res:
        return res
    if _VERIFY_SEM is None:
        _VERIFY_SEM = asyncio.Semaphore(8)
    head = [x for x in res[:SEARCH_VERIFY_FIRST] if isinstance(x, dict) and x.get("url")]
    rest = [x for x in res[SEARCH_VERIFY_FIRST:]]

    async def one(x: dict) -> bool:
        async with _VERIFY_SEM:
            r = await asyncio.to_thread(_fetch_image_sync, str(x["url"]))
        return bool(r) and not r.get("error")

    tasks = [asyncio.ensure_future(one(x)) for x in head]
    if not tasks:
        return res
    await asyncio.wait(tasks, timeout=SEARCH_VERIFY_WAIT)     # unfinished ones keep running and warm the cache
    good, unknown = [], []
    for x, t in zip(head, tasks):
        if not t.done():
            unknown.append(x)
        elif not t.cancelled() and t.exception() is None and t.result():
            good.append(x)
    out = good + unknown + rest
    dropped = len(head) - len(good) - len(unknown)
    if dropped:
        print(f"[IMG-VERIFY] {dropped}/{len(head)} dead picture link(s) removed")
    return out or res


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
        return await _verify_image_results(res, kind)

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
    # Session image pool: remember every result for this presentation, never return an already used URL
    _pk = _ipool.current_pool.get()
    if _pk:
        for (q, k), r in zip(jobs, results):
            _ipool.add_results(_pk, q, k, r)
        results = [_ipool.filter_used(_pk, r) for r in results]
        try:
            await ev({"type": "image_pool", "unused": _ipool.client_list(_pk)})
        except WebSocketDisconnect:
            pass
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
        "is_admin_email": lambda email: bool(email) and email in admin_core.admin_emails(),   # v60: izohlarni pin/o'chirish
    })
except Exception as _cm_err:
    print(f"[COMMUNITY] yuklanmadi: {_cm_err}")

PUBLIC_STATIC_FILES = {
        "index.html", "styles.css", "mobile.css", "v38.css", "v39.css", "v40.css", "v54.css", "topup.css", "v68.css",
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
# Audit H6: time limits of one AI turn (seconds). Env-configurable.
AI_READ_TIMEOUT = float(_env_int("AI_READ_TIMEOUT", 120))
AI_TURN_DEADLINE_FAST = float(_env_int("AI_TURN_DEADLINE_FAST", 300))
AI_TURN_DEADLINE_DEEP = float(_env_int("AI_TURN_DEADLINE_DEEP", 600))
_ds_waiting = 0

def _deepseek_client(api_key: str, base_url: str):
    import httpx
    sig = (api_key, base_url)
    if _ds_client_cache["sig"] != sig or _ds_client_cache["client"] is None:
        _ds_client_cache["sig"] = sig
        # Audit H6: `read` = max silence between two stream chunks (not the total time). A stuck upstream now fails
        # in AI_READ_TIMEOUT seconds instead of 600. The total time of a turn is limited by AI_TURN_DEADLINE_*.
        _to = httpx.Timeout(connect=10.0, read=AI_READ_TIMEOUT, write=30.0, pool=30.0)
        _ds_client_cache["client"] = AsyncOpenAI(
            api_key=api_key, base_url=base_url, timeout=_to, max_retries=2,
            http_client=httpx.AsyncClient(
                timeout=_to,
                limits=httpx.Limits(max_connections=max(20, DEEPSEEK_CONCURRENCY * 2 if DEEPSEEK_CONCURRENCY < 500 else 200),
                                    max_keepalive_connections=40, keepalive_expiry=60),
            ),
        )
    return _ds_client_cache["client"]

async def _close_ai_stream(stream) -> None:
    """Audit C3: stop the upstream generation and give the HTTP connection back to the pool."""
    close = getattr(stream, "close", None)
    if close is None:
        return
    try:
        r = close()
        if asyncio.iscoroutine(r):
            await r
    except Exception:
        pass

class _DsBusy(Exception):
    pass


async def _end_stopped_turn(websocket, rid, uid: str, usage: dict) -> None:
    """Stop pressed before any text arrived: nothing is charged, the turn simply ends."""
    if rid:
        _resume.abort(rid, uid, websocket.detached)
    _metrics.inc("ai_turns_total", {"result": "stopped"})
    await websocket.send_json({"type": "end", "finish_reason": "stopped", "interrupted": True, "request_id": rid,
                               "ai_msg": {"role": "assistant", "content": ""}, "units_charged": 0, "pages_charged": 0,
                               "charge_reason": "stopped", **usage_payload(usage)})


class _SkipCharge(Exception):
    pass


class _TurnStopped(Exception):
    """The user pressed «To'xtatish» — the AI turn ends at once (stream closed, no more tokens)."""

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
                _t_end = time.monotonic() + DS_QUEUE_TIMEOUT
                while True:                          # wait for a slot, but leave at once if the user pressed Stop
                    if getattr(self.ws, "cancelled", lambda: False)():
                        raise _TurnStopped()
                    left = _t_end - time.monotonic()
                    if left <= 0:
                        raise asyncio.TimeoutError()
                    try:
                        await asyncio.wait_for(GEMINI_SEMAPHORE.acquire(), timeout=min(0.5, left))
                        break
                    except asyncio.TimeoutError:
                        continue
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

# ---- Audit C2: one AI turn at a time per user ----
# The balance is checked BEFORE generation and charged AFTER it. Without this guard a user could open many tabs
# (or spam "Generate") and start N turns that all pass the balance check at the same moment.
# NOTE: the counter is per worker process. For a hard cross-worker guarantee set REDIS_URL (see AUDIT_REPORT.md).
MAX_AI_INFLIGHT_PER_USER = _env_i("MAX_AI_INFLIGHT_PER_USER", 1)
_AI_INFLIGHT: Dict[str, int] = {}

def _ai_inflight_acquire(uid: str) -> bool:
    n = _AI_INFLIGHT.get(uid, 0)
    if n >= MAX_AI_INFLIGHT_PER_USER:
        return False
    _AI_INFLIGHT[uid] = n + 1
    return True

def _ai_inflight_release(uid: str) -> None:
    n = _AI_INFLIGHT.get(uid, 0) - 1
    if n > 0:
        _AI_INFLIGHT[uid] = n
    else:
        _AI_INFLIGHT.pop(uid, None)


class _Turn:
    """Audit M5: mutable result of one AI turn (filled by _run_ai_turn)."""
    __slots__ = ("full_reply", "usage_meta", "stream_err", "finish_reason", "client_gone", "n_searches")

    def __init__(self):
        self.full_reply = ""
        self.usage_meta = None
        self.stream_err = None
        self.finish_reason = None
        self.client_gone = False
        self.n_searches = 0


async def _run_ai_turn(websocket, t: "_Turn", *, api_key: str, model: str, mode: str, prompt: str, user_content: str,
                       messages: List[dict], plan_slides: Any, plan_index: Any, uid: Any, data: Dict[str, Any]) -> None:
    """Audit M5: the AI part of one WebSocket turn, moved out of ws_chat: queue slot, deep-model presearch,
    streaming, tool (image search) rounds, turn deadline (H6) and stream close (C3). Results go into `t`."""
    client = None
    try:

        client = _deepseek_client(api_key, config.get("deepseek_base_url") or "https://api.deepseek.com")
        async with _ds_slot(websocket):
            # Audit H6: a hard deadline for the WHOLE turn (presearch + all tool rounds). Before, one turn could hold
            # an AI slot for up to 600 s x 5 rounds and block everybody in the queue. On timeout the partial answer is
            # kept (only finished actions are charged) and the client shows «Davom ettirish».
            async with asyncio.timeout(AI_TURN_DEADLINE_DEEP if model == "deepseek-reasoner" else AI_TURN_DEADLINE_FAST):
                _pre_stats: Dict[str, int] = {}
                tools_on = bool(_search_images_sync) and model != "deepseek-reasoner" and mode != "plan" and not _SMALLTALK_RE.match((prompt or "").strip() or "x")
                # «Search everything first, then write everything»: for a new deck / several slides the server finds the
                # pictures for ALL topics of the message in ONE parallel batch, then the AI writes the whole deck in ONE
                # answer (no tools, no slide-by-slide search rounds that ran out and left slides unfinished).
                _batch_first = (tools_on and mode not in ("plan", "generate") and _is_multi_slide_request(prompt or "")
                                and _wants_images(prompt or ""))
                if (model == "deepseek-reasoner" or _batch_first) and _search_images_sync and mode != "plan" and not _NO_IMG_RE.search(prompt or ""):
                    try:
                        # the user's OWN text (user_content also carries the browser's action report — Audit M1)
                        _ctx, _want = prompt or "", _wants_images(prompt or "")
                        if mode == "generate" and isinstance(plan_slides, list) and plan_index is not None and 0 <= int(plan_index) < len(plan_slides):      # slayd-slayd yaratish: faqat has_image slaydlar
                            _cur = plan_slides[int(plan_index)] or {}
                            _want = bool(_cur.get("has_image")) and _wants_images(prompt or "") or bool(_cur.get("has_image"))
                            _ctx = f"Deck topic: {prompt}\nSlide: {_cur.get('title', '')} — {_cur.get('summary', '')}"
                        if _want:
                            _extra = await _deep_presearch(client, _ctx, 1 if mode == "generate" else _presearch_count(prompt or ""), websocket, _pre_stats,
                                                           kind=_presearch_kind(prompt or ""))
                            if _extra:
                                messages[-1] = {"role": "user", "content": (messages[-1].get("content") or "") + _extra}
                                if _batch_first:
                                    tools_on = False         # every picture is already here -> one complete answer
                    except Exception as _pe:
                        print(f"[DEEP-IMG] {type(_pe).__name__}: {str(_pe)[:80]}")
                msgs = messages
                _bad_chunk_logged = False
                t.n_searches = int(_pre_stats.get("searches") or 0)
                _dsml_retried = False
                _researched = False
                agg_in = agg_out = agg_tot = 0
                # v29: qidiruvdan oldin yozilgan matn (PART A) O'CHIRILMAYDI va qayta yozdirilmaydi
                shown_text = False      # foydalanuvchi allaqachon matn ko'rdi
                _think_chars, _think_t0 = 0, time.monotonic()
                _think_last = 0.0
                sep_pending = False     # keyingi raundning matni oldiga bo'sh qator qo'yiladi
                try:
                    for _round in range(MAX_TOOL_ROUNDS + 1):
                        if websocket.cancelled():
                            raise _TurnStopped()
                        kwargs = {
                            "model": model,
                            "messages": msgs,
                            "stream": True,
                            "stream_options": {"include_usage": True},
                            "max_tokens": 16384,
                        }
                        if model != "deepseek-reasoner":
                            kwargs["temperature"] = 0.7
                        if tools_on and _round < MAX_TOOL_ROUNDS and t.n_searches < MAX_SEARCHES_PER_TURN:
                            kwargs["tools"] = SEARCH_TOOLS
                            kwargs["tool_choice"] = "auto"

                        try:
                            kwargs["extra_body"] = {"user_id": hash_user_id(uid)}
                        except Exception:
                            kwargs["extra_body"] = {"user_id": str(uid or "anon")[:32]}
                        round_text = ""
                        calls: Dict[int, dict] = {}
                        stream = await client.chat.completions.create(**kwargs)
                        # Audit C3: the stream is closed on ANY exit (user closed tab -> WebSocketDisconnect),
                        # so DeepSeek stops generating (no tokens paid for nobody) and the pooled connection is freed at once.
                        try:
                            async for chunk in stream:
                                if websocket.cancelled():        # Stop pressed: leave now (finally closes the stream)
                                    raise _TurnStopped()
                                try:
                                    choice = chunk.choices[0] if chunk.choices else None
                                    if choice is not None:
                                        fr = getattr(choice, "finish_reason", None)
                                        if fr:
                                            t.finish_reason = fr
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
                                                t.full_reply += "\n\n"
                                                try:
                                                    await websocket.send_json({"type": "chunk", "text": "\n\n"})
                                                except (WebSocketDisconnect, RuntimeError):
                                                    raise WebSocketDisconnect()
                                            round_text += txt
                                            t.full_reply += txt
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
                                except Exception as _ce:            # Audit M4: no more silent skips
                                    _metrics.inc("ai_bad_chunks_total", help="Stream chunks that could not be parsed")
                                    if not _bad_chunk_logged:
                                        _bad_chunk_logged = True
                                        print(f"[AI] ⚠️ bo'lak o'qilmadi: {type(_ce).__name__}: {str(_ce)[:120]}")
                                    continue
                        finally:
                            await _close_ai_stream(stream)
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
                            if c["name"] == "search_images" and q_ and t.n_searches < MAX_SEARCHES_PER_TURN:
                                t.n_searches += 1
                                _job_of[i] = len(_jobs)
                                _jobs.append((q_, kind_))
                        _found_all = await _search_batch(websocket, _jobs, client_search=bool(data.get("client_search")),
                                                         n0=t.n_searches - len(_jobs))
                        for i, c in enumerate(ordered):
                            if i not in _job_of:
                                result = {"error": "qidiruv bajarilmadi", "results": []}
                            else:
                                q_, kind_ = _jobs[_job_of[i]]
                                found = _found_all[_job_of[i]]
                                result = {"query": q_, "kind": kind_, "results": found, "note": _search_note(kind_, bool(found))}
                                _pk = _ipool.current_pool.get()
                                if _pk:      # the AI also sees earlier, still unused finds of this presentation
                                    result["session_unused_images"] = [
                                        {"url": it["url"], "kind": it["kind"], "title": _pb.sanitize_inline(it.get("title") or it.get("query"), 80)}
                                        for it in _ipool.unused(_pk, kind_, 8, exclude=[x.get("url") for x in found if isinstance(x, dict)])]
                                    result["rule"] = ("Never use an image URL twice in this presentation; "
                                                      "prefer session_unused_images before searching again.")
                            msgs.append({"role": "tool", "tool_call_id": c["id"] or f"call_{i}",
                                         "content": json.dumps(result, ensure_ascii=False)[:6000]})

                        # v59: topilmagan rasmlar bo'lsa — AI ularni BOSHQA so'z bilan yana bir marta qidiradi (keyin yasaydi)
                        _missing = [q_ for (q_, k_), f_ in zip(_jobs, _found_all) if not f_ and k_ != "gif"]
                        if (_missing and _round + 1 < MAX_TOOL_ROUNDS and t.n_searches < MAX_SEARCHES_PER_TURN
                                and not _researched):
                            _researched = True
                            msgs.append({
                                "role": "user",
                                "content": (
                                    "Bu so'rovlar bo'yicha rasm TOPILMADI: " + "; ".join(f'"{m}"' for m in _missing[:6]) + ". "
                                    "Faqat ular uchun search_images ni BOSHQA, soddaroq va aniqroq INGLIZCHA so'rov bilan yana bir marta chaqiring "
                                    "(2-3 so'z, aniq predmet). Topilgan rasmlarni qayta qidirmang. Hech qanday matn yozmang."
                                ),
                            })
                            t.finish_reason = None
                            continue
                        if t.n_searches > 0:
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
                        t.finish_reason = None
                except WebSocketDisconnect:
                    t.client_gone = True
                except Exception as e:
                    t.stream_err = e
                finally:
                    if agg_tot or agg_in or agg_out:
                        from types import SimpleNamespace as _NS
                        t.usage_meta = _NS(prompt_tokens=agg_in, completion_tokens=agg_out, total_tokens=agg_tot or (agg_in + agg_out))
    except WebSocketDisconnect:
        t.client_gone = True
    except Exception as e:
        t.stream_err = t.stream_err or e


# ---- Audit H5: a WebSocket that can "detach" (client gone -> the AI turn finishes in the background) ----
RESUME_DETACH_SEC = float(_env_int("RESUME_DETACH_SEC", 120)) if os.environ.get("RESUME_DETACH_SEC", "") != "0" else 0.0


class _DetachableWS:
    """Wraps the real WebSocket. During an AI turn that has a request_id, a failed send does not stop the turn:
    the socket becomes `detached`, further sends are dropped, and the turn may run RESUME_DETACH_SEC more seconds
    (then a send raises WebSocketDisconnect = the old Audit C3 behaviour). Everything else is delegated."""

    def __init__(self, ws):
        self._ws = ws
        self.allow_detach = False
        self.detached = False
        self.detached_at = 0.0
        self.delivered_chars = 0          # length of streamed text that really reached the client
        self.on_detach = None

    def __getattr__(self, name):
        return getattr(self._ws, name)

    # --- Stop button: a reader task keeps reading the socket DURING an AI turn, so {"type": "cancel"} is seen
    #     at once (before, the server read nothing while streaming). Other messages are queued in order.
    _EOF = object()

    def start_reader(self) -> None:
        self._inbox = asyncio.Queue()
        self.cancel_rid = None
        self.turn_rid = None
        self._reader = asyncio.ensure_future(self._read_loop())

    async def _read_loop(self) -> None:
        try:
            while True:
                raw = await self._ws.receive_text()
                d = None
                if isinstance(raw, str) and '"cancel"' in raw:
                    try:
                        d = json.loads(raw)
                    except ValueError:
                        d = None
                if isinstance(d, dict) and d.get("type") == "cancel":
                    self.cancel_rid = str(d.get("request_id") or "*")[:80]
                    _metrics.inc("ai_cancel_total", help="Stop button presses")
                    continue
                await self._inbox.put(raw)
        except BaseException:
            try:
                self._inbox.put_nowait(self._EOF)
            except Exception:
                pass

    def stop_reader(self) -> None:
        r = getattr(self, "_reader", None)
        if r is not None and not r.done():
            r.cancel()

    def cancelled(self) -> bool:
        rid = getattr(self, "cancel_rid", None)
        return bool(rid) and (rid == "*" or rid == getattr(self, "turn_rid", None))

    def begin_turn(self, allow: bool, on_detach=None, rid=None) -> None:
        if getattr(self, "cancel_rid", None) not in (None, rid):
            self.cancel_rid = None               # a stop for an older turn does not stop this one
        self.turn_rid = rid
        self.allow_detach = bool(allow) and RESUME_DETACH_SEC > 0
        self.detached = False
        self.detached_at = 0.0
        self.delivered_chars = 0
        self.on_detach = on_detach

    async def send_json(self, data, *a, **k):
        if self.detached:
            if time.monotonic() - self.detached_at > RESUME_DETACH_SEC:
                raise WebSocketDisconnect()
            return
        try:
            await self._ws.send_json(data, *a, **k)
        except (TypeError, ValueError):
            raise
        except Exception:
            if not self.allow_detach:
                raise WebSocketDisconnect()
            self.detached = True
            self.detached_at = time.monotonic()
            if self.on_detach:
                try:
                    self.on_detach()
                except Exception:
                    pass
            return
        if isinstance(data, dict) and data.get("type") == "chunk":
            self.delivered_chars += len(data.get("text") or "")

    async def receive_text(self):
        if self.detached:
            raise WebSocketDisconnect()
        inbox = getattr(self, "_inbox", None)
        if inbox is None:
            return await self._ws.receive_text()
        item = await inbox.get()
        if item is self._EOF:
            inbox.put_nowait(self._EOF)
            raise WebSocketDisconnect()
        return item


async def _handle_resume(websocket, data: dict) -> None:
    """Audit H5: {"type": "resume", "token", "request_id"} -> resume_pending | resume_result | resume_none."""
    rid = _resume.valid_request_id(data.get("request_id"))
    token = str(data.get("token") or "")
    if not rid:
        await websocket.send_json({"type": "resume_none", "request_id": None})
        return
    who = None
    if supabase and token:
        try:
            who = await asyncio.to_thread(auth_user_cached, token)
        except Exception:
            who = None
    elif os.environ.get("SLIDE_STUDIO_DEV_MODE", "").strip() == "1" and token and token == os.environ.get("SLIDE_STUDIO_DEV_TOKEN", ""):
        who = ("dev-user", "dev@local")
    if not who:
        await websocket.send_json({"type": "resume_none", "request_id": rid, "code": "invalid_token"})
        return
    uid, email = who
    e = await asyncio.to_thread(_resume.lookup, rid, uid)
    _metrics.inc("resume_requests_total", {"status": (e or {}).get("status") or "none"}, help="Resume requests by state")
    if not e or e.get("status") == "aborted":
        await websocket.send_json({"type": "resume_none", "request_id": rid})
        return
    if e.get("status") != "done":
        await websocket.send_json({"type": "resume_pending", "request_id": rid})
        return
    end = dict(e.get("end") or {})
    extra = int(e.get("extra_units") or 0)
    if extra > 0:                         # the part the client did NOT get before the break — charged now, once
        try:
            async with _user_lock(uid):
                usage, ch, _rs = await asyncio.to_thread(
                    charge_turn_atomic, uid, email, None, 0, 0, e.get("mode") or "fast", 0,
                    {"resume": rid, "units": extra}, "", f"resume:{rid}", extra)
            end.update(usage_payload(usage))
            end["units_charged"] = int(end.get("units_charged") or 0) + int(ch)
            end["pages_charged"] = end["units_charged"]
        except Exception as ce:
            print(f"[RESUME] charge: {type(ce).__name__}: {str(ce)[:160]}")
    end.update({"type": "resume_result", "request_id": rid, "stream_text": e.get("stream_text") or ""})
    await websocket.send_json(end)


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    global ws_count
    websocket = _DetachableWS(websocket)          # Audit H5
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
    websocket.start_reader()                      # Stop button: «cancel» is read even while the AI is writing
    session_key = None
    uid = ""
    email = ""
    DEV_MODE = os.environ.get("SLIDE_STUDIO_DEV_MODE", "").strip() == "1"
    DEV_TOKEN = os.environ.get("SLIDE_STUDIO_DEV_TOKEN", "")
    _held_uid = None                      # Audit C2: uid whose in-flight slot this connection holds
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
            obs.request_id_var.set(obs.new_request_id(str(data.get("request_id") or "")))   # Audit M4
            if data.get("type") == "resume":            # Audit H5
                await _handle_resume(websocket, data)
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
                        who = await asyncio.to_thread(auth_user_cached, token)
                        if not who:
                            await websocket.send_json({"type": "error", "code": "invalid_token",
                                                       "message": "Sessiya tugagan. Qayta kiring."})
                            continue
                        uid, email = who
                    except Exception as e:
                        await websocket.send_json({"type": "error", "code": "invalid_token",
                                                   "message": "Kirishni tekshirib bo'lmadi. Qayta kiring."})
                        continue
                _wait = _user_rate_hit(str(uid), "plan" if mode == "plan" else ("generate" if mode == "generate" else "chat"))
                if _wait:
                    _metrics.inc("ai_turns_total", {"result": "rate_limited"})
                    await websocket.send_json({"type": "error", "code": "RATE_LIMITED", "retry_after": _wait,
                                               "message": f"Juda tez-tez so'rov yuboryapsiz. {_wait} soniyadan keyin qayta urinib ko'ring."})
                    continue
                usage = await asyncio.to_thread(get_or_create_user_usage, uid, email)
                if await asyncio.to_thread(_abuse.check_new_account, supabase, str(uid), usage,    # Audit M2
                                           _safe_client_ip(websocket), _SCALING_HMAC_SECRET):
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
                    _metrics.inc("ai_turns_total", {"result": "limit"})
                    payload = usage_payload(usage)
                    _alt = ""
                    if bill_mode == "deep" and can_afford(usage, "fast"):
                        _alt = " Chuqur AI uchun balans yetmaydi — Tez AI ga o'tib davom eting."
                    await websocket.send_json({
                        "type": "error",
                        "code": "LIMIT_EXCEEDED",
                        "message": f"Limit tugadi.{_alt} 24 soat kuting, ${topup_gross_cents(pack_pages()) / 100:.2f} ga {pack_pages()} Tez-varaq ({pack_units() // MODES['deep']['page']} Chuqur-varaq) sotib oling.",
                        **payload,
                    })
                    continue
                if mode == "generate" and not is_unlimited(usage) and bal_units < MODES[bill_mode]["page"]:
                    # v53: reja bo'yicha slayd yaratish (1 so'rov = 1 slayd = 1 varaq). Avval faqat 1 ta savol-javobga
                    # yetadigan balans tekshirilardi va 0.25 varaq bilan TO'LIQ slayd olinardi (yechim balansdan oshmaydi).
                    await websocket.send_json({
                        "type": "error",
                        "code": "LIMIT_EXCEEDED",
                        "message": f"Limit tugadi: yangi slayd uchun kamida 1 varaq kerak. 24 soat kuting yoki ${topup_gross_cents(pack_pages()) / 100:.2f} ga {pack_pages()} Tez-varaq sotib oling.",
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
                # Session image pool for this presentation (browser sends deck_session + the URLs already on its slides)
                _pkey = _ipool.pool_key(uid, data.get("deck_session"))
                _uiu = data.get("used_image_urls")
                if isinstance(_uiu, list):
                    _ipool.mark_used(_pkey, [u for u in _uiu[:300] if isinstance(u, str)])
                _ipool.current_pool.set(_pkey)
                messages, user_content = _pb.build_turn_messages(      # Audit M5/M1: backend/services/prompt_builder.py
                    base_prompt=build_system_prompt(), data=data, usage=usage, bill_mode=bill_mode, model=model, mode=mode,
                    plan_slides=plan_slides, plan_index=plan_index, scope=scope, active_slide=active_slide,
                    images_meta=images_meta, deck_state=deck_state, chat_history=chat_history, prompt=prompt,
                    max_ctx=_max_ctx_cfg(), image_pool_block=_ipool.prompt_block(_pkey, _pb.sanitize_inline))
                full_reply = ""
                usage_meta = None
                stream_err = None
                finish_reason = None
                client_gone = False
                if not _ai_inflight_acquire(str(uid)):
                    _metrics.inc("ai_turns_total", {"result": "busy"})
                    await websocket.send_json({"type": "error", "code": "AI_BUSY",
                                               "message": "Oldingi so'rovingiz hali bajarilmoqda (boshqa oynada ham bo'lishi mumkin). Tugashini kuting."})
                    continue
                _held_uid = str(uid)
                _rid = _resume.valid_request_id(data.get("request_id"))       # Audit H5
                if _rid:
                    _resume.start(_rid, str(uid))
                    _rid_uid = str(uid)
                    def _on_detach(_r=_rid, _u=_rid_uid):
                        _t = asyncio.get_running_loop().create_task(asyncio.to_thread(_resume.detached, _r, _u))
                        _bg_tasks.add(_t)
                        _t.add_done_callback(_bg_tasks.discard)
                    websocket.begin_turn(True, _on_detach, rid=_rid)
                else:
                    websocket.begin_turn(False, rid=None)
                _t = _Turn()                                   # Audit M5: AI part lives in _run_ai_turn
                await _run_ai_turn(websocket, _t, api_key=api_key, model=model, mode=mode, prompt=prompt,
                                   user_content=user_content, messages=messages, plan_slides=plan_slides,
                                   plan_index=plan_index, uid=uid, data=data)
                full_reply, usage_meta, stream_err = _t.full_reply, _t.usage_meta, _t.stream_err
                finish_reason, client_gone, n_searches = _t.finish_reason, _t.client_gone, _t.n_searches
                if client_gone and not full_reply.strip():
                    if _rid:
                        _resume.abort(_rid, str(uid), websocket.detached)
                    raise WebSocketDisconnect()
                _stopped = isinstance(stream_err, _TurnStopped)
                if _stopped and not full_reply.strip():
                    _ai_inflight_release(_held_uid); _held_uid = None
                    await _end_stopped_turn(websocket, _rid, str(uid), usage)
                    continue
                if stream_err and not full_reply.strip():
                    if _rid:
                        _resume.abort(_rid, str(uid), websocket.detached)
                    err = str(stream_err).lower()
                    _err_code = "AI_ERROR"
                    if isinstance(stream_err, TimeoutError):
                        _err_code = "AI_TIMEOUT"
                        msg = "AI javobi juda uzoq davom etdi va to'xtatildi. Varaq yechilmadi — so'rovni qisqaroq qilib qayta yuboring."
                    elif "429" in err or "rate" in err or "quota" in err:
                        _err_code = "AI_UPSTREAM_LIMIT"
                        msg = "AI xizmati limiti tugadi. Birozdan so'ng qayta urinib ko'ring."
                    elif "401" in err or "auth" in err or "api key" in err:
                        msg = "API kalit xato. Admin panel orqali tekshiring."
                    elif "503" in err or "overloaded" in err:
                        _err_code = "AI_BUSY_UPSTREAM"
                        msg = "AI serveri band. Keyinroq urinib ko'ring."
                    else:
                        print(f"[AI] stream xatosi: {str(stream_err)[:300]}")
                        msg = "AI xizmatida xatolik yuz berdi. Qayta urinib ko'ring."
                    _ai_inflight_release(_held_uid); _held_uid = None
                    _metrics.inc("ai_turns_total", {"result": "timeout" if isinstance(stream_err, TimeoutError) else "error"},
                                 help="AI turns by result")
                    if not isinstance(stream_err, TimeoutError):
                        obs.capture(stream_err)
                    await websocket.send_json({"type": "error", "code": _err_code, "message": msg})
                    continue

                _stream_text = full_reply                    # Audit H5: exactly what was streamed (before the GIF fix)
                _ipool.mark_used(_pkey, _ipool.urls_in_reply(_stream_text))     # these URLs are taken now
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
                _extra_units = 0
                try:
                    pages_from_actions, pages_breakdown = calculate_page_cost_from_reply(
                        full_reply or "", _deck_slide_count(deck_state), active_slide
                    )
                    if websocket.detached:
                        # Audit H5: charge now only what reached the client; the rest (in UNITS, so the total equals
                        # a turn without a break) is charged when a resume really delivers it
                        _delivered, _ = calculate_page_cost_from_reply(
                            _stream_text[:websocket.delivered_chars], _deck_slide_count(deck_state), active_slide)
                        _m = mode_for_model(model)
                        _ns = int(n_searches or 0)
                        _extra_units = max(0, turn_cost(int(pages_from_actions), _ns, _m)[0] - turn_cost(int(_delivered), _ns, _m)[0])
                        pages_from_actions = int(_delivered)
                except Exception as _me:
                    print(f"[MONITORING] cost calc: {_me}")
                pages_charged, charge_reason = 0, "none"
                try:
                    try:
                        _n_search_turn = int(n_searches)
                    except Exception:
                        _n_search_turn = 0

                    if _stopped and int(pages_from_actions) == 0 and _n_search_turn == 0:
                        raise _SkipCharge()          # stopped with text only (no slide, no search): nothing to charge
                    # Audit H2: one atomic SQL call (balance + ledger + spent). Lock kept for the legacy fallback path.
                    async with _user_lock(uid):
                        usage, pages_charged, charge_reason = await asyncio.to_thread(
                            charge_turn_atomic, uid, email, usage, int(pages_from_actions), _n_search_turn,
                            mode_for_model(model), tot,
                            {"pages_needed": int(pages_from_actions), "breakdown": pages_breakdown[:20]})
                except _SkipCharge:
                    charge_reason = "stopped"
                except Exception as _ce:
                    _metrics.inc("ai_charge_failures_total", help="AI turns whose charge failed")
                    obs.capture(_ce)
                    print(f"[MONITORING] ❌ charge: {type(_ce).__name__}: {str(_ce)[:200]}")
                    charge_reason = "charge_error"
                    usage = await asyncio.to_thread(get_or_create_user_usage, uid, email)
                if _held_uid:
                    _ai_inflight_release(_held_uid); _held_uid = None
                if client_gone:
                    if _rid:
                        _resume.abort(_rid, str(uid), websocket.detached)
                    raise WebSocketDisconnect()
                bal_payload = usage_payload(usage)
                if _stopped:
                    finish_reason = "stopped"
                    if _rid:
                        _resume.abort(_rid, str(uid), websocket.detached)
                elif isinstance(stream_err, TimeoutError):
                    finish_reason = "timeout"                 # Audit H6: frontend shows «vaqt tugadi» + «Davom ettirish»
                    print(f"[AI] turn deadline user={str(uid)[:8]} model={model} chars={len(full_reply)}")
                elif stream_err:
                    finish_reason = "error"
                elif finish_reason in (None, "", "stop"):
                    finish_reason = "stop"
                _end = {
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
                    "request_id": _rid,
                    **bal_payload,
                }
                if _rid and not _stopped:                   # a stopped turn is not kept for resume
                    await asyncio.to_thread(_resume.finish, _rid, str(uid), stream_text=_stream_text, end_payload=_end,
                                            extra_units=_extra_units, mode=mode_for_model(model),
                                            was_detached=websocket.detached)
                _metrics.inc("ai_turns_total", {"result": "detached" if websocket.detached else str(finish_reason)})
                if websocket.detached:
                    print(f"[RESUME] fonda tugadi user={str(uid)[:8]} id={_rid} extra_units={_extra_units}")
                    raise WebSocketDisconnect()
                await websocket.send_json(_end)
            except WebSocketDisconnect:
                raise
            except Exception as e:
                # v53: bitta xabardagi kutilmagan xato ulanishni YOPMAYDI — xato aytiladi va keyingi xabar kutiladi
                if (websocket.client_state != WebSocketState.CONNECTED
                        or websocket.application_state != WebSocketState.CONNECTED):
                    raise WebSocketDisconnect()
                if _held_uid:
                    _ai_inflight_release(_held_uid); _held_uid = None
                _ws_errs += 1
                _metrics.inc("ws_message_errors_total", help="Unexpected errors while handling a WS message")
                obs.capture(e)
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
        websocket.stop_reader()
        if _held_uid:
            _ai_inflight_release(_held_uid)
        with ws_lock:
            ws_count = max(0, ws_count - 1)

# Audit M4: live gauges for /metrics
_metrics.gauge("ws_connections", lambda: ws_count, "Open WebSocket connections (this worker)")
_metrics.gauge("ai_queue_waiting", lambda: _ds_waiting, "AI turns waiting for a slot")
_metrics.gauge("ai_slots_free", lambda: getattr(GEMINI_SEMAPHORE, "_value", 0), "Free AI slots")
_metrics.gauge("ai_inflight_users", lambda: len(_AI_INFLIGHT), "Users with a running AI turn")
_metrics.gauge("charges_pending", lambda: len(_PENDING_CHARGES), "Charges waiting for the DB")
_metrics.gauge("usage_cache_entries", lambda: len(_USAGE_CACHE), "Entries in the balance cache")


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
