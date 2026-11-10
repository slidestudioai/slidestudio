"""
Slide Studio — Monitoring / Billing  (v38 — yagona kredit hisobi)

YAGONA HISOB: balans "birlik" (unit) larda, butun sonlarda saqlanadi — yaxlitlash xatosi YO'Q.
    1 Tez-varaq  = 20 birlik        (Tez/arzon AI)
    1 Chuqur-varaq = 40 birlik       (Chuqur AI = 2 Tez-varaq, DEEP_MULT)

                          TEZ AI              CHUQUR AI
  1 ta slayd ........      20 (1 varaq)        40 (1 varaq)
  1 ta savol-javob ...      5  (4 ta = 1)       10 (4 ta = 1)
  1 ta qidiruv ......       4  (5 ta = 1)       10 (4 ta = 1)

  Bepul (kuniga): 200 birlik  = 10 Tez-varaq  = 5 Chuqur-varaq
  Pullik ($1.58): 2000 birlik = 100 Tez-varaq = 50 Chuqur-varaq
  Rejim almashganda balans qayta hisoblanadi: faqat birliklar bo'linadi (units / varaq_birligi).

  - free_credits / paid_credits ustunlari = BIRLIK (SUPABASE_SCHEMA.sql noldan yaratadi)
  - free: har 24 soatda FREE_DAILY_UNITS gacha tiklanadi; paid: sotib olingan, tugamaguncha
  - Ayirish: avval free, keyin paid. Hamma hisob-kitob FAQAT serverda.
  - Slaydlar tarixi bazada SAQLANMAYDI — faqat akkaunt va balans.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterator, List, Optional, Tuple

import os as _os

def _env_num(name, default, cast):
    try:
        return cast(_os.environ.get(name, default))
    except (TypeError, ValueError):
        return default

UNIT = 20                       # 1 Tez-varaq = 20 birlik (4 va 5 ga ham aniq bo'linadi)
DEEP_MULT = 2                   # 1 Chuqur-varaq = 2 Tez-varaq (100 Tez = 50 Chuqur)
FREE_DAILY_PAGES = _env_num("FREE_DAILY_PAGES", 10, int)     # Tez-varaq hisobida (Chuqur: /2 = 5)
PAGES_PER_PACK = _env_num("PAGES_PER_PACK", 100, int)        # Tez-varaq hisobida (Chuqur: /2 = 50)
CHECKOUT_PRICE_USD = _env_num("PACK_PRICE_USD", 1.58, float)   # 100 varaq = $1.58
FREE_DAILY_UNITS = FREE_DAILY_PAGES * UNIT
PACK_UNITS = PAGES_PER_PACK * UNIT

# ---- VIP / cheksiz + admin paneldan o'zgartiriladigan limitlar (Pro rejasi olib tashlangan) ----
_RT: Dict[str, Any] = {"free_daily_pages": FREE_DAILY_PAGES, "pack_pages": PAGES_PER_PACK}

def rt(name: str) -> int:
    return int(_RT[name])

def set_runtime(**kw: Any) -> None:
    """Admin paneldan: bepul kunlik / paket hajmi (Tez-varaq hisobida)."""
    for k, v in kw.items():
        if k in _RT and v is not None:
            try:
                _RT[k] = max(0, min(100000, int(v)))
            except (TypeError, ValueError):
                pass

def free_daily_units() -> int:
    return rt("free_daily_pages") * UNIT

def pack_pages() -> int:
    return rt("pack_pages")

def pack_units() -> int:
    return rt("pack_pages") * UNIT

MODES: Dict[str, Dict[str, int]] = {
    "fast": {"page": UNIT,             "chat": UNIT // 4, "search": UNIT // 5, "chat_per_page": 4, "search_per_page": 5},
    "deep": {"page": UNIT * DEEP_MULT, "chat": UNIT * DEEP_MULT // 4, "search": UNIT * DEEP_MULT // 4, "chat_per_page": 4, "search_per_page": 4},
}
PROMPTS_PER_PAGE = 4
SEARCHES_PER_PAGE = 5

def mode_for_model(model: str) -> str:
    return "deep" if str(model or "").endswith("reasoner") else "fast"

PLANS = [
    {"id": "free", "name": "Bepul", "pages": FREE_DAILY_PAGES, "deep_pages": FREE_DAILY_PAGES // DEEP_MULT,
     "price_usd": 0, "price_display": "Bepul", "renew": "24 soat"},
    {"id": f"pack_{PAGES_PER_PACK}", "name": f"{PAGES_PER_PACK} varaq", "pages": PAGES_PER_PACK,
     "deep_pages": PAGES_PER_PACK // DEEP_MULT,
     "price_usd": CHECKOUT_PRICE_USD, "price_display": f"${CHECKOUT_PRICE_USD:.2f}",
     "renew": "tugamaguncha"},
]

FREE_ACTIONS = {
    "switch_slide", "change_slide", "goto_slide", "set_transition", "slide_transition",
    "success", "error", "reply", "noop", "none", "message",
}

SLIDE_EDIT_ACTIONS = {
    "replace_slide", "clear_slide",
    "add_gif", "add_video", "place_image", "place_image_url", "add_image",
    "set_background", "set_background_url",
    "add_element", "add_text", "create_element",
    "update_element", "update_object", "move_element", "move_object",
    "delete_element", "delete_object", "delete_image",
    "move_image", "resize_image", "bring_to_front", "send_to_back",
}

RESET_DECK_CHARGES_DELETED = True

def _now() -> datetime:
    return datetime.now(timezone.utc)

def _parse_ts(val: Any) -> Optional[datetime]:
    if not val:
        return None
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    try:
        dt = datetime.fromisoformat(str(val).replace("Z", "+00:00"))
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None

_THINK_RE = re.compile(r"<think>[\s\S]*?(?:</think>|$)", re.I)

def _iter_json_values(text: str) -> Iterator[Any]:
    """Matn ichidagi barcha to'liq JSON qiymatlarni (obyekt/massiv) ketma-ket qaytaradi.
    Uzilgan (chala) obyektlar ichidagi TO'LIQ ichki obyektlar ham topiladi."""
    dec = json.JSONDecoder()
    i, n = 0, len(text)
    while i < n:
        if text[i] in "{[":
            try:
                obj, end = dec.raw_decode(text, i)
                yield obj
                i = end
                continue
            except ValueError:
                pass
        i += 1

def extract_actions_from_reply(text: str) -> List[Dict[str, Any]]:
    """AI javobidagi HAQIQIY amallar (takrorlari olib tashlangan).
    Frontend ham bir xil amalni ikki marta bajarmaydi — shuning uchun biz ham sanamaymiz."""
    if not text or not isinstance(text, str):
        return []
    clean = _THINK_RE.sub("", text)
    found: List[Dict[str, Any]] = []
    for obj in _iter_json_values(clean):
        if isinstance(obj, dict):
            if isinstance(obj.get("actions"), list):
                found.extend(a for a in obj["actions"] if isinstance(a, dict) and isinstance(a.get("action"), str))
            elif isinstance(obj.get("action"), str):
                found.append(obj)
        elif isinstance(obj, list):
            found.extend(a for a in obj if isinstance(a, dict) and isinstance(a.get("action"), str))
    seen, out = set(), []
    for a in found:
        try:
            sig = json.dumps(a, sort_keys=True, ensure_ascii=False)
        except Exception:
            sig = repr(a)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(a)
    return out

def _int(v: Any) -> Optional[int]:
    try:
        if v is None or isinstance(v, bool):
            return None
        return int(v)
    except (TypeError, ValueError):
        return None

def _int_list(v: Any) -> List[int]:
    if not isinstance(v, list):
        return []
    return [x for x in (_int(i) for i in v) if x is not None]

class _Deck:
    """Slaydlar sonini va faol slaydni taxminiy kuzatadi (insert/delete raqamlarni siljitadi)."""

    def __init__(self, total: Any, active: Any):
        t = _int(total)
        self.n: Optional[int] = t if (t is not None and t > 0) else None
        a = _int(active)
        self.active: int = a if (a is not None and a > 0) else 1
        self._seq = 0

    def uniq(self, tag: str) -> Tuple[str, int]:
        self._seq += 1
        return (tag, self._seq)

    def valid(self, i: Optional[int]) -> bool:
        if i is None or i < 1:
            return False
        return self.n is None or i <= self.n

def _slide_of(a: Dict[str, Any], deck: _Deck) -> int:
    for k in ("slide", "target_slide", "slide_index", "to_slide"):
        v = _int(a.get(k))
        if v is not None:
            return v
    return deck.active

def _targets(a: Dict[str, Any], deck: _Deck, source: int, all_if_missing: bool) -> List[int]:
    lst = _int_list(a.get("to_slides")) or _int_list(a.get("target_slides")) or _int_list(a.get("targets"))
    if not lst:
        for k in ("to_slide", "target_slide"):
            v = _int(a.get(k))
            if v is not None:
                lst = [v]
                break
    if not lst and all_if_missing and deck.n:
        lst = list(range(1, deck.n + 1))
    out, seen = [], set()
    for t in lst:
        if t != source and deck.valid(t) and t not in seen:
            seen.add(t)
            out.append(t)
    return out

def _keys_for_action(a: Dict[str, Any], deck: _Deck) -> List[Any]:
    """Amal tegadigan slayd 'kalitlari'. Bir xil kalit bir turn ichida faqat 1 marta to'lanadi."""
    name = str(a.get("action") or "").strip().lower()
    if not name or name in ("success", "error"):
        return []

    if name in ("switch_slide", "change_slide", "goto_slide"):
        t = _int(a.get("slide") if a.get("slide") is not None else a.get("index"))
        if deck.valid(t):
            deck.active = t
        return []
    if name in FREE_ACTIONS:
        return []

    S = lambda n: ("s", int(n))

    if name == "insert_slide":
        after = _int(a.get("after"))
        if after is None:
            after = _int(a.get("slide"))
        if after is None:
            after = deck.n
        if after is None:
            deck.active = deck.active
            return [deck.uniq("new")]
        after = max(0, after)
        if deck.n is not None:
            if after > deck.n:
                deck.n = after
            deck.n += 1
        new = after + 1
        act = _int(a.get("activate"))
        deck.active = act if (act is not None and act > 0) else new
        return [S(new)]

    if name == "create_slides":
        count = max(1, min(50, _int(a.get("count")) or 1))
        base = deck.n if deck.n is not None else None
        if base is None:
            return [deck.uniq("new") for _ in range(count)]
        deck.n = base + count
        deck.active = base + 1
        return [S(base + i) for i in range(1, count + 1)]

    if name == "duplicate_slide":
        idx = _slide_of(a, deck)
        if not deck.valid(idx):
            return []
        if deck.n is not None:
            deck.n += 1
        deck.active = idx + 1
        return [S(idx + 1)]

    if name == "delete_slide":
        idx = _int(a.get("slide")) or 1
        if deck.n is not None and (idx < 1 or idx > deck.n or deck.n <= 1):
            return []
        if deck.n is not None:
            deck.n -= 1
            deck.active = min(deck.active, deck.n)
        return [deck.uniq("del")]

    if name in ("reorder_slide", "move_slide"):
        frm = _int(a.get("from") if a.get("from") is not None else a.get("slide")) or 1
        to = _int(a.get("to") if a.get("to") is not None else a.get("after")) or 1
        if frm == to or not deck.valid(frm) or not deck.valid(to):
            return []
        deck.active = to
        return [S(to)]

    if name == "swap_slides":
        x = _int(a.get("a") if a.get("a") is not None else a.get("slide1")) or 1
        y = _int(a.get("b") if a.get("b") is not None else a.get("slide2")) or 2
        if x == y or not deck.valid(x) or not deck.valid(y):
            return []
        return [S(x), S(y)]

    if name in ("reset_deck", "delete_extra_slides"):
        keep = _int(a.get("keep"))
        keep = 1 if (keep is None or keep < 1) else keep
        keys: List[Any] = []
        if deck.n is not None:
            keep = min(keep, deck.n)
            if RESET_DECK_CHARGES_DELETED:
                keys += [deck.uniq("del") for _ in range(max(0, deck.n - keep))]
            keys += [S(i) for i in range(1, keep + 1)]
            deck.n = keep
        else:
            keys = [S(1)]
        deck.active = 1
        return keys

    if name == "swap_images":
        sa = _int(a.get("slide_a"))
        sb = _int(a.get("slide_b"))
        ka = S(sa if sa is not None else deck.active)
        kb = S(sb) if sb is not None else deck.uniq("unk")
        return [ka] if ka == kb else [ka, kb]

    if name == "move_image_to_slide":
        frm = _int(a.get("from_slide"))
        to = _int(a.get("to_slide"))
        if to is None or not deck.valid(to):
            return []
        src = frm if frm is not None else deck.active
        return [S(src), S(to)] if src != to else [S(to)]

    if name in ("duplicate_image", "copy_object"):
        src = _int(a.get("from_slide") if a.get("from_slide") is not None else a.get("source_slide"))
        src = src if src is not None else deck.active
        tg = _targets(a, deck, src, all_if_missing=(name == "duplicate_image"))
        if not tg and deck.n is None and name == "duplicate_image":
            return [deck.uniq("unk")]
        return [S(t) for t in tg]

    if name in SLIDE_EDIT_ACTIONS:
        idx = _slide_of(a, deck)
        if not deck.valid(idx):
            return []
        if name == "replace_slide":
            deck.active = idx
        return [S(idx)]

    return []

def cost_for_action(action: Dict[str, Any]) -> int:
    """Bitta amal narxi (alohida, kontekstsiz) — moslik uchun."""
    if not isinstance(action, dict):
        return 0
    return len(set(_keys_for_action(action, _Deck(None, 1))))

def calculate_page_cost(
    actions: List[Dict[str, Any]],
    total_slides: Any = None,
    active_slide: Any = 1,
) -> Tuple[int, List[Dict[str, Any]]]:
    """Bir AI javobi uchun jami varaq: har bir tegilgan slayd 1 marta sanaladi."""
    deck = _Deck(total_slides, active_slide)
    paid_keys: set = set()
    breakdown: List[Dict[str, Any]] = []
    total = 0
    for a in actions or []:
        if not isinstance(a, dict):
            continue
        new_keys = [k for k in dict.fromkeys(_keys_for_action(a, deck)) if k not in paid_keys]
        if not new_keys:
            continue
        paid_keys.update(new_keys)
        total += len(new_keys)
        breakdown.append({
            "action": a.get("action"),
            "cost": len(new_keys),
            "slide": [k[1] for k in new_keys if k[0] == "s"] or None,
        })
    return total, breakdown

def calculate_page_cost_from_reply(
    full_reply: str, total_slides: Any = None, active_slide: Any = 1
) -> Tuple[int, List[Dict[str, Any]]]:
    return calculate_page_cost(extract_actions_from_reply(full_reply or ""), total_slides, active_slide)


def plan_active(user: Optional[dict]) -> str:
    """'free' | 'vip' (Pro rejasi yo'q; eski 'pro' qatorlari oddiy 'free' hisoblanadi)."""
    user = user or {}
    if user.get("vip"):
        return "vip"
    if str(user.get("plan") or "free").strip().lower() == "vip":
        until = _parse_ts(user.get("plan_until"))
        if until is None or until >= _now():
            return "vip"
    return "free"

def is_unlimited(user: Optional[dict]) -> bool:
    user = user or {}
    return bool(user.get("unlimited")) or bool(user.get("vip")) or plan_active(user) == "vip"

def is_ad_free(user: Optional[dict]) -> bool:
    return is_unlimited(user)

def daily_units_for(user: Optional[dict]) -> int:
    """Shu foydalanuvchining kunlik bepul chegarasi (BIRLIK): admin belgilagan > oddiy."""
    user = user or {}
    ov = user.get("daily_units_override")
    try:
        if ov is not None and str(ov) != "":
            return max(0, int(ov))
    except (TypeError, ValueError):
        pass
    return free_daily_units()

def free_suspended(user: Optional[dict]) -> bool:
    """Pullik balans kunlik bepul limitdan (masalan 10 varaq) KO'P yoki teng bo'lsa — kunlik bepul limit ishlamaydi.
    Pullik balans shu chegaradan pastga tushganda avtomatik qayta tiklanadi."""
    user = user or {}
    try:
        daily = daily_units_for(user)
        paid = int(user.get("paid_credits") or 0)
    except (TypeError, ValueError):
        return False
    return daily > 0 and paid >= daily

def plans_public() -> List[Dict[str, Any]]:
    fd, pk = rt("free_daily_pages"), rt("pack_pages")
    return [
        {"id": "free", "name": "Bepul", "pages": fd, "deep_pages": fd // DEEP_MULT,
         "price_usd": 0, "price_display": "Bepul", "renew": "24 soat"},
        {"id": f"pack_{pk}", "name": f"{pk} varaq", "pages": pk, "deep_pages": pk // DEEP_MULT,
         "price_usd": CHECKOUT_PRICE_USD, "price_display": f"${CHECKOUT_PRICE_USD:.2f}", "renew": "tugamaguncha"},
    ]

def normalize_user_row(u: Optional[dict], default_free: int = None) -> dict:
    """DB qatorini to'ldiradi. free_credits/paid_credits = BIRLIK."""
    u = dict(u or {})
    if default_free is None:
        default_free = daily_units_for(u)
    if "free_credits" not in u and "paid_credits" not in u:
        u["free_credits"] = default_free
        u["paid_credits"] = 0
    u["free_credits"] = int(u.get("free_credits") if u.get("free_credits") is not None else default_free)
    u["paid_credits"] = int(u.get("paid_credits") or 0)
    u["prompt_count"] = 0      # eski hisoblagichlar endi ishlatilmaydi (hamma narsa birlikda)
    u["search_count"] = 0
    if not u.get("last_reset_time"):
        u["last_reset_time"] = _now().isoformat()
    u["slide_credits"] = u["free_credits"] + u["paid_credits"]
    u["blocked"] = bool(u.get("blocked", False))
    u["plan"] = str(u.get("plan") or "free").lower()
    u["unlimited"] = bool(u.get("unlimited", False))
    return u

def apply_24h_reset(user: dict, free_daily: int = None) -> dict:
    """>=24 soat -> free_credits = FREE_DAILY_UNITS."""
    user = normalize_user_row(user, free_daily)
    if free_daily is None:
        free_daily = daily_units_for(user)
    now = _now()
    last = _parse_ts(user.get("last_reset_time"))
    if free_suspended(user):
        # Pullik balans yetarli: yangi bepul varaq BERILMAYDI (qolgan eski bepul varaqlar avval ishlatiladi).
        user["free_credits"] = min(user["free_credits"], free_daily)
        if user["free_credits"] <= 0 and (last is None or (now - last) < timedelta(hours=24)):
            user["last_reset_time"] = (now - timedelta(hours=24)).isoformat()   # pullik balans tushishi bilan bepul limit DARHOL tiklansin
    elif last is None or (now - last) >= timedelta(hours=24):
        user["free_credits"] = free_daily
        user["last_reset_time"] = now.isoformat()
    else:
        user["free_credits"] = min(user["free_credits"], free_daily)
    user["slide_credits"] = user["free_credits"] + user["paid_credits"]
    return user

def window_started(user: dict, free_daily: int = None) -> bool:
    """24 soatlik oyna faqat birinchi sarfdan keyin boshlanadi."""
    u = normalize_user_row(user, free_daily)
    if free_suspended(u):
        return False
    if free_daily is None:
        free_daily = daily_units_for(u)
    return int(u.get("free_credits") or 0) < int(free_daily)

def seconds_until_reset(user: dict) -> int:
    user = normalize_user_row(user)
    if not window_started(user):
        return 0
    last = _parse_ts(user.get("last_reset_time")) or _now()
    return max(0, int(((last + timedelta(hours=24)) - _now()).total_seconds()))

def total_credits(user: dict) -> int:
    """Jami BIRLIK."""
    user = normalize_user_row(user)
    return max(0, int(user["free_credits"]) + int(user["paid_credits"]))

def can_afford(user: dict, mode: str = "fast") -> bool:
    """Shu rejimda kamida 1 ta savol-javobga yetadimi."""
    if is_unlimited(user):
        return not bool((user or {}).get("blocked"))
    return total_credits(user) >= MODES.get(mode, MODES["fast"])["chat"]

def pages_left(user: dict, mode: str = "fast") -> int:
    if is_unlimited(user):
        return 999999
    return total_credits(user) // MODES.get(mode, MODES["fast"])["page"]

def deduct_credits(user: dict, amount: int) -> dict:
    """Avval free, keyin paid (BIRLIK)."""
    user = normalize_user_row(user)
    left = max(0, int(amount))
    if left > 0:
        take_free = min(user["free_credits"], left)
        user["free_credits"] -= take_free
        left -= take_free
        if left > 0:
            user["paid_credits"] -= min(user["paid_credits"], left)
    user["slide_credits"] = user["free_credits"] + user["paid_credits"]
    return user

def charge_for_ai_turn(user: dict, pages_from_actions: int, searches: int = 0, mode: str = "fast") -> Tuple[dict, int, str]:
    """
    Bitta AI javobi uchun narx (BIRLIK, aniq butun son):
      pages_from_actions > 0 -> slaydlar * page
      aks holda (faqat chat)  -> chat
      searches * search
    Balansdan oshmaydi. Returns: (user, charged_units, reason)
    """
    c = MODES.get(mode if mode in MODES else "fast")
    user = apply_24h_reset(user)
    if is_unlimited(user):                      # v47: VIP / admin / "cheksiz" — hech narsa yechilmaydi
        return user, 0, "unlimited"
    was_suspended = free_suspended(user)
    if not window_started(user) and not was_suspended:
        user["last_reset_time"] = _now().isoformat()
    pages_from_actions = max(0, int(pages_from_actions or 0))
    searches = max(0, int(searches or 0))
    if pages_from_actions > 0:
        wanted, reason = pages_from_actions * c["page"], "slide_actions"
    else:
        wanted, reason = c["chat"], "chat"
    if searches:
        wanted += searches * c["search"]
        reason += "+search"
    take = min(wanted, total_credits(user))
    if take > 0:
        user = deduct_credits(user, take)
    else:
        reason = "no_credits"
    if was_suspended and int(user.get("free_credits") or 0) <= 0:
        user["last_reset_time"] = (_now() - timedelta(hours=24)).isoformat()   # pullik balans tushsa, bepul limit darhol qaytadi
    return user, int(take), reason

def _fmt_pages(units: int, page_units: int) -> float:
    return round(units / page_units, 2)

def usage_payload(user: dict) -> dict:
    """Har API/WS javobiga qo'shiladigan balans. Brauzer faqat KO'RSATADI — hisob-kitob serverda."""
    user = apply_24h_reset(user)
    free, paid = int(user["free_credits"]), int(user["paid_credits"])
    total = free + paid
    unl = is_unlimited(user)
    plan = plan_active(user)
    fdu = daily_units_for(user)
    modes = {}
    for name, c in MODES.items():
        modes[name] = {
            "page_units": c["page"], "chat_units": c["chat"], "search_units": c["search"],
            "chat_per_page": c["chat_per_page"], "search_per_page": c["search_per_page"],
            "pages_left": 999999 if unl else total // c["page"],
            "pages_exact": 999999 if unl else _fmt_pages(total, c["page"]),
            "free_pages": _fmt_pages(free, c["page"]), "paid_pages": _fmt_pages(paid, c["page"]),
            "free_daily_pages": fdu // c["page"], "pack_pages": pack_units() // c["page"],
            "can_chat": True if unl else total >= c["chat"],
        }
    spent = user.get("spent_24h")
    return {
        "free_credits": free,                 # BIRLIK
        "paid_credits": paid,                 # BIRLIK
        "units_total": total,
        "free_daily_units": fdu,
        "pack_units": pack_units(),
        "modes": modes,
        "slide_credits": total,
        "slide_credits_left": 999999 if unl else total // UNIT,
        "prompt_count": 0,
        "search_count": 0,
        "spent_24h": spent,                   # BIRLIK (yoki None)
        "next_reset_in_seconds": seconds_until_reset(user),
        "window_started": window_started(user),
        "is_pro": False,                                   # Pro rejasi olib tashlangan (mijoz moslik uchun kalit qoldi)
        "plan": plan,                                      # free | pro | vip
        "plan_until": None,
        "unlimited": unl,
        "ad_free": is_ad_free(user),
        "free_suspended": free_suspended(user),          # pullik balans yetarli — kunlik bepul limit to'xtatilgan
        "free_daily": fdu // UNIT,
        "pack_pages": pack_pages(),
        "pack_price_usd": CHECKOUT_PRICE_USD,
        "blocked": bool(user.get("blocked", False)),
        "plans": plans_public(),
    }

def add_paid_credits(user: dict, pages: int = None) -> dict:
    """pages = TEZ-varaq hisobida (1 varaq = 20 birlik)."""
    if pages is None:
        pages = pack_pages()
    user = normalize_user_row(user)
    user["paid_credits"] = int(user["paid_credits"]) + max(0, int(pages)) * UNIT
    user["slide_credits"] = user["free_credits"] + user["paid_credits"]
    return user

def remove_paid_credits(user: dict, pages: int = None) -> dict:
    """Qaytarilgan (refund) to'lov uchun."""
    if pages is None:
        pages = pack_pages()
    user = normalize_user_row(user)
    user["paid_credits"] = max(0, int(user["paid_credits"]) - max(0, int(pages)) * UNIT)
    user["slide_credits"] = user["free_credits"] + user["paid_credits"]
    return user
