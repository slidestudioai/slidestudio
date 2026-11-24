"""v78: ONE design system for the website and the Telegram bot.

Source of truth: the website's theme list in ``js/51_design_themes.js`` (the ``RAW`` array — 32 themes:
background, title / body colours, three accent colours, fonts, edge decoration). This module reads that file, so a
theme added or recoloured on the site is used by the bot too (no second copy of the colours to keep in sync).

What it gives the bot renderer (backend/tg_decks.py):
  * ``bot_themes()``      — every site theme converted to the renderer's colour tokens
                            (bg, text, title, primary, accent, dark, card, tint, muted, on_primary, palette, decor),
                            with a contrast guard (WCAG ratio) so text never disappears on its background;
  * ``pick_theme(topic)`` — a theme that fits the topic (tech -> tech/midnight, nature -> leaf/mint, history ->
                            academic/retro, kids -> kids/sun ...), the same idea as the site AI choosing a theme;
  * ``decor_items(key)``  — the theme's edge decoration as plain rect / oval pieces (identical ids to the site).

The old 7 bot theme names (ocean, violet, forest, sunset, rose, slate, teal) stay valid — decks saved earlier open
unchanged.
"""
from __future__ import annotations

import hashlib
import os
import re
from typing import Any, Dict, List, Optional, Tuple

_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SITE_THEMES_JS = os.path.join(_ROOT, "js", "51_design_themes.js")

W, H = 960, 540

# ---------------------------------------------------------------------------------------------
# 1) colour helpers (WCAG relative luminance / contrast ratio)
# ---------------------------------------------------------------------------------------------
_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def _rgb(h: str) -> Tuple[int, int, int]:
    m = _HEX_RE.match(str(h or "").strip())
    if not m:
        return (0, 0, 0)
    n = int(m.group(1), 16)
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def _hex(r: float, g: float, b: float) -> str:
    return "#{:02X}{:02X}{:02X}".format(*(max(0, min(255, int(round(v)))) for v in (r, g, b)))


def mix(a: str, b: str, t: float) -> str:
    """a -> b, t = 0..1 (same formula as tg_decks.mix)."""
    ra, ga, ba = _rgb(a)
    rb, gb, bb = _rgb(b)
    return _hex(ra + (rb - ra) * t, ga + (gb - ga) * t, ba + (bb - ba) * t)


def luminance(h: str) -> float:
    def ch(v: int) -> float:
        c = v / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = _rgb(h)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a: str, b: str) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def is_dark(h: str) -> bool:
    """Same threshold idea as the site (lum < 0.45 on the simple 0..1 scale)."""
    r, g, b = _rgb(h)
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0 < 0.45


def ensure_contrast(fg: str, bg: str, ratio: float = 4.5) -> str:
    """fg moved towards black or white (whichever helps) until it reaches ``ratio`` against bg."""
    if contrast(fg, bg) >= ratio:
        return fg.upper()
    target = "#000000" if not is_dark(bg) else "#FFFFFF"
    for k in range(1, 21):
        c = mix(fg, target, k / 20.0)
        if contrast(c, bg) >= ratio:
            return c
    return target


def on_color(fill: str) -> str:
    """Readable text colour (white or near-black) on a filled shape."""
    return "#FFFFFF" if contrast("#FFFFFF", fill) >= contrast("#111827", fill) else "#111827"


# ---------------------------------------------------------------------------------------------
# 2) reading the site theme list
# ---------------------------------------------------------------------------------------------
_ROW_RE = re.compile(r"\[\s*((?:'(?:[^'\\]|\\.)*'\s*,?\s*){12})\]")
_STR_RE = re.compile(r"'((?:[^'\\]|\\.)*)'")

# kept in the code as well: the bot still works if the JS file is missing from a slim deployment
_FALLBACK_RAW = [
    ["office", "Ofis", "#FFFFFF", "#1F2937", "#374151", "#2563EB", "#60A5FA", "#F59E0B", "Arial", "Arial", "top_bar", "corporate_blue"],
    ["tech", "Texnologiya", "#0F172A", "#E2E8F0", "#94A3B8", "#38BDF8", "#818CF8", "#34D399", "Verdana", "Verdana", "circuit", "dark_neon"],
    ["leaf", "Yashil barg", "#F3F8F2", "#1B3A2B", "#44624F", "#2E7D32", "#A5D6A7", "#F9A825", "Georgia", "Verdana", "blobs", "eco_green"],
    ["academic", "Akademik", "#FFFFFF", "#1B2A41", "#3D4B5C", "#8C1C13", "#B08D2A", "#1B2A41", "Georgia", "Georgia", "rules", "academic"],
]


def load_site_themes(path: str = SITE_THEMES_JS) -> List[List[str]]:
    """[[id, label, bg, title, body, a1, a2, a3, fontTitle, fontBody, decor, kit], ...] in the site's order."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            src = f.read()
        start = src.index("var RAW = [")
        end = src.index("];", start)
        block = src[start:end]
        rows = []
        for m in _ROW_RE.finditer(block):
            vals = [v.replace("\\'", "'") for v in _STR_RE.findall(m.group(1))]
            if len(vals) == 12 and all(_HEX_RE.match(v) for v in vals[2:8]):
                rows.append(vals)
        if rows:
            return rows
    except Exception:
        pass
    return [list(r) for r in _FALLBACK_RAW]


# ---------------------------------------------------------------------------------------------
# 3) site theme -> renderer tokens
# ---------------------------------------------------------------------------------------------
_EXTRA_SERIES = ["#6366F1", "#EC4899", "#10B981", "#F97316", "#0EA5E9", "#A855F7"]


def to_bot_theme(row: List[str]) -> Dict[str, Any]:
    tid, label, bg, title, body, a1, a2, a3, f_title, f_body, decor, kit = row
    dark_bg = is_dark(bg)
    if dark_bg:
        card = mix(bg, "#FFFFFF", 0.08)
        tint = mix(bg, a1, 0.22)
        dark = mix(bg, "#000000", 0.25)
    else:
        card = "#FFFFFF" if bg.upper() != "#FFFFFF" else mix("#FFFFFF", a1, 0.03)
        tint = mix("#FFFFFF", a1, 0.12)
        dark = title if luminance(title) < 0.08 else mix(title, "#000000", 0.45)
    text = ensure_contrast(body, bg, 4.5)
    primary = ensure_contrast(a1, card, 3.0)            # card headings, table header, numbers
    accent = a2 if contrast(a2, bg) >= 1.6 else a3       # decorative lines / dots — must stay visible
    palette = []
    for c in [a1, a2, a3] + _EXTRA_SERIES:
        c = c.upper()
        if c not in palette and contrast(c, bg) >= 1.5:
            palette.append(c)
    return {
        "name": tid, "label": label, "site": True,
        "bg": bg.upper(), "text": text, "title": ensure_contrast(title, bg, 4.5),
        "primary": primary, "accent": accent.upper(), "accent3": a3.upper(),
        "dark": dark, "card": card, "tint": tint,
        "muted": ensure_contrast(mix(body, bg, 0.35), bg, 3.0),
        "on_primary": on_color(primary),
        "palette": palette[:6],
        "decor": decor, "font_title": f_title, "font_body": f_body, "kit": kit, "dark_bg": dark_bg,
    }


_CACHE: Dict[str, Dict[str, Any]] = {}


def bot_themes() -> Dict[str, Dict[str, Any]]:
    if not _CACHE:
        for row in load_site_themes():
            _CACHE[row[0]] = to_bot_theme(row)
    return _CACHE


def site_theme_ids() -> List[str]:
    return list(bot_themes().keys())


# ---------------------------------------------------------------------------------------------
# 4) topic -> theme (Uzbek / Russian / English keywords)
# ---------------------------------------------------------------------------------------------
_TOPIC_RULES: List[Tuple[str, Tuple[str, ...]]] = [
    (r"kosmos|koinot|sayyora|galaktik|space|planet|astronom|космос|вселен|планет", ("space", "midnight")),
    (r"sun'?iy intellekt|\bai\b|texnolog|dastur|kompyuter|robot|kiber|internet|digital|raqamli|blockchain|"
     r"technolog|software|program|computer|cyber|технолог|программ|компьютер|искусствен", ("tech", "midnight", "ion")),
    (r"tabiat|ekolog|o'?rmon|o'?simlik|yashil|iqlim|suv|nature|ecolog|climate|forest|plant|природ|эколог|климат|лес",
     ("leaf", "mint", "facet")),
    (r"tarix|qadimgi|imperiya|sivilizats|amir temur|history|ancient|empire|истори|древн|импери", ("retro", "academic", "coffee")),
    (r"mustaqil ish|referat|seminar|kurs ishi|dissertats|ilmiy|universitet|research|thesis|science|научн|реферат|курсов",
     ("academic", "office", "newspaper")),
    (r"bolalar|maktabgacha|o'?yin|ertak|kids|children|детск|сказк", ("kids", "sun", "spring")),
    (r"biznes|marketing|startap|moliya|iqtisod|savdo|investits|business|startup|finance|econom|sales|бизнес|маркетинг|"
     r"финанс|эконом", ("office", "blue", "red", "graphite")),
    (r"tibbiyot|sog'?liq|kasallik|shifokor|medic|health|disease|медицин|здоров", ("ice", "mint", "clean")),
    (r"sport|futbol|olimpiad|football|спорт|футбол", ("sport", "berlin")),
    (r"san'?at|musiqa|dizayn|rassom|moda|art|music|design|fashion|искусств|музык|дизайн|мод", ("gallery", "lavender", "brutal")),
    (r"oziq|taom|ovqat|oshxona|qahva|food|cook|coffee|кухн|еда|кофе", ("coffee", "coral", "desert")),
    (r"sayohat|turizm|dengiz|okean|travel|touris|sea|ocean|путешеств|туризм|море", ("ocean", "ice", "desert")),
    (r"adabiyot|she'?r|yozuvchi|kitob|literat|poem|book|литератур|стих|книг", ("retro", "academic", "coffee")),
    (r"bayram|to'?y|tabrik|holiday|wedding|празд|свадьб", ("gold", "berry", "spring")),
]
_DEFAULT_ROTATION = ("office", "ocean", "gallery", "integral", "facet", "blue", "lavender", "clean", "ice", "mint")


def pick_theme(topic: str, prefer: Optional[str] = None) -> str:
    """Theme id for the topic. ``prefer`` (the user's choice / the AI's choice) wins when it is a known theme."""
    themes = bot_themes()
    if prefer and prefer in themes:
        return prefer
    low = (topic or "").lower()
    seed = int(hashlib.sha1(low.encode("utf-8", "ignore")).hexdigest()[:8], 16)
    for rx, ids in _TOPIC_RULES:
        if re.search(rx, low, re.I):
            ok = [i for i in ids if i in themes]
            if ok:
                return ok[seed % len(ok)]
    ok = [i for i in _DEFAULT_ROTATION if i in themes] or list(themes)
    return ok[seed % len(ok)]


def themes_for_prompt() -> str:
    """Short theme list for the AI prompt: 'office (light, business) | tech (dark) | ...'."""
    return " | ".join(f"{k}{' (dark)' if v['dark_bg'] else ''}" for k, v in bot_themes().items())


# ---------------------------------------------------------------------------------------------
# 5) edge decoration — the site's DECOR ids, drawn with rect / oval only (PPTX shapes, PDF, HTML)
#    Every piece stays on the slide EDGES (content box 56..904 x 70..500 stays clear).
#    Opacity is baked into the colour (mix with the background) — PPTX/PDF/HTML show the same colour.
# ---------------------------------------------------------------------------------------------
def _r(x, y, w, h, fill, r=0, line=None, lw=1) -> dict:
    return dict(t="rect", x=x, y=y, w=w, h=h, fill=fill, r=r, line=line, lw=lw)


def _o(x, y, w, h, fill) -> dict:
    return dict(t="oval", x=x, y=y, w=w, h=h, fill=fill)


def decor_items(th: Dict[str, Any]) -> List[dict]:
    key = th.get("decor") or "top_bar"
    bg, a1, a2, a3 = th["bg"], th["primary"], th["accent"], th.get("accent3") or th["accent"]
    soft = lambda c, op: mix(bg, c, op)           # noqa: E731 — «opacity» on this background
    # safe zones: top strip y 0..30, title from y 70, content 56..904 x 70..490, footer text 56..904 x 502..518
    if key == "plain":
        return [_r(0, 0, W, 6, a1)]
    if key in ("top_bar", "rules"):
        return [_r(0, 0, W, 10, a1), _r(0, 10, 140, 4, a2), _r(56, 494, W - 112, 1.5, soft(a1, 0.5))]
    if key == "band_left":
        return [_r(0, 0, 22, H, a1), _r(22, 0, 6, H, a2), _r(W - 120, H - 10, 72, 6, a1, r=3)]
    if key == "side_panel":
        return [_r(W - 30, 0, 30, H, a1), _r(W - 40, 0, 7, H, soft(a2, 0.85)), _o(W - 62, 12, 14, 14, a3)]
    if key == "frame":
        return [_r(14, 14, W - 28, 2.5, a1), _r(14, H - 16.5, W - 28, 2.5, a1), _r(14, 14, 2.5, H - 28, a1),
                _r(W - 16.5, 14, 2.5, H - 28, a1), _r(24, 24, W - 48, 1, soft(a2, 0.8))]
    if key in ("corner_circles", "rings"):
        return [_o(W - 110, -170, 240, 240, soft(a1, 0.9)), _o(W - 150, 14, 28, 28, a2),
                _o(-100, H - 60, 150, 150, soft(a2, 0.8)), _o(24, H - 120, 14, 14, a3)]
    if key == "blobs":
        return [_o(W - 200, -150, 300, 220, soft(a1, 0.35)), _o(-160, H - 70, 210, 160, soft(a2, 0.45)),
                _o(W - 50, H - 90, 120, 120, soft(a3, 0.4))]
    if key == "dots_grid":
        out = [_r(0, 0, W, 6, a1)]
        for r_ in range(5):
            for c in range(2):
                out.append(_o(W - 30 + c * 14, 200 + r_ * 16, 6, 6, soft(a2, 0.8)))
        return out
    if key == "ribbon_bottom":
        return [_r(0, H - 12, W, 12, a1), _r(0, H - 16, W, 4, a2), _r(0, 0, 120, 6, a3)]
    if key == "thin_lines":
        return [_r(56, 20, W - 112, 1.2, a1), _r(56, H - 8, W - 112, 1.2, soft(a1, 0.5))]
    if key in ("confetti", "stars"):
        pts = [(18, 18, 14, a1), (W - 40, 18, 12, a2), (W - 22, 140, 9, a3), (30, H - 48, 12, a2), (W - 30, H - 44, 16, a1),
               (8, 200, 8, a3), (W - 14, 320, 8, a1), (470, H - 16, 8, a3)]
        return [_o(x, y, d, d, soft(c, 0.9) if key == "confetti" else soft(c, 0.75)) for x, y, d, c in pts]
    if key == "circuit":
        return [_r(0, 0, W, 4, a1), _r(W - 150, 20, 120, 2, soft(a1, 0.7)), _o(W - 34, 15, 12, 12, a2),
                _r(30, H - 8, 140, 2, soft(a2, 0.7)), _o(166, H - 13, 12, 12, a3)]
    if key == "newspaper":
        return [_r(56, 16, W - 112, 3, a2), _r(56, 22, W - 112, 1, a2), _r(56, H - 8, W - 112, 1, soft(a2, 0.6))]
    if key == "stripes":
        return [_r(W - 26, 0, 10, H, a1), _r(W - 12, 0, 6, H, a2), _r(0, 0, W, 6, a1)]
    if key in ("wave_bottom", "arc_corner", "diagonal", "geo"):
        # curves / triangles drawn as overlapping circles on the corners (editable shapes everywhere)
        return [_r(0, H - 10, W, 10, soft(a1, 0.9)), _o(W - 48, H - 70, 120, 120, a2),
                _o(-60, H - 16, 200, 80, soft(a2, 0.55)), _r(56, 20, 60, 6, a1, r=3)]
    return [_r(0, 0, W, 10, a1), _r(0, 0, 140, 10, a2)]
