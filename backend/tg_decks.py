"""
backend/tg_decks.py — Telegram bot uchun slayd yaratish (server tomonda).

AI (JSON) -> bitta "sahna" (scene) tavsifi -> uchta fayl:  PPTX  /  PDF  /  HTML (mustaqil namoyish).
Uchala format BIR XIL sahnadan chiziladi, shuning uchun ko'rinishi bir xil bo'ladi.

Koordinatalar: 960 x 540 (sayt bilan bir xil). PPTX da 1 px = 1 pt (13.333in x 7.5in).
Matn o'lchami DejaVu Sans (eng keng shrift) bilan o'lchanadi — boshqa shriftlarda (Arial, brauzer shrifti) ham sig'adi.
"""
from __future__ import annotations

from collections import OrderedDict
import base64
import html as _html
import io
import ipaddress
import json
import math
import os
import re
import socket
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

W, H = 960, 540
LH = 1.22                                   # qator balandligi (o'lcham ko'paytmasi)
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
SYS_FONT_DIR = "/usr/share/fonts/truetype/dejavu"

LAYOUTS = ("title", "bullets", "cards", "stats", "quote", "closing", "table", "chart")
TRANSITIONS = ("fade", "zoom", "flip", "up", "blur", "none")      # sayt bilan bir xil nomlar
CHART_KINDS = ("bar", "line", "pie", "doughnut")

THEMES: Dict[str, Dict[str, str]] = {
    #            qora/to'q   asosiy      urg'u       fon        matn       xira       kartochka   och ton
    "ocean":  dict(dark="#0B1F4D", primary="#1D4ED8", accent="#06B6D4", bg="#F8FAFC", text="#0F172A", muted="#64748B", card="#FFFFFF", tint="#E0F2FE", label="🔵 Okean"),
    "violet": dict(dark="#2E1065", primary="#6D28D9", accent="#F59E0B", bg="#FAF5FF", text="#1E1B4B", muted="#6B7280", card="#FFFFFF", tint="#EDE9FE", label="🟣 Binafsha"),
    "forest": dict(dark="#052E16", primary="#15803D", accent="#84CC16", bg="#F7FEF9", text="#14281D", muted="#5B6B61", card="#FFFFFF", tint="#DCFCE7", label="🟢 O'rmon"),
    "sunset": dict(dark="#431407", primary="#C2410C", accent="#F59E0B", bg="#FFFBF5", text="#2A1608", muted="#7C6A5C", card="#FFFFFF", tint="#FFEDD5", label="🟠 Quyosh"),
    "rose":   dict(dark="#500724", primary="#BE185D", accent="#FB7185", bg="#FFF7FA", text="#2D0A1A", muted="#7A5C69", card="#FFFFFF", tint="#FFE4EC", label="🌸 Atirgul"),
    "slate":  dict(dark="#0B1220", primary="#1E293B", accent="#38BDF8", bg="#F8FAFC", text="#0F172A", muted="#64748B", card="#FFFFFF", tint="#E2E8F0", label="⚫ Grafit"),
    "teal":   dict(dark="#042F2E", primary="#0F766E", accent="#F97316", bg="#F6FFFE", text="#0B2B29", muted="#5A7270", card="#FFFFFF", tint="#CCFBF1", label="🩵 Zumrad"),
}
DEFAULT_THEME = "ocean"

# ---------------------------------------------------------------------------------------------
# Matnni tozalash
# ---------------------------------------------------------------------------------------------
_EMOJI_RE = re.compile("[\U00010000-\U0010FFFF☀-⛿✀-➿⬀-⯿︀-️​-‍⁠]")
_MD_RE = re.compile(r"(\*\*|__|`|^#+\s*)")


def clean(s: Any, limit: int = 0) -> str:
    t = "" if s is None else str(s)
    t = _EMOJI_RE.sub("", t)
    t = _MD_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip()
    if limit and len(t) > limit:
        cut = t[:limit].rsplit(" ", 1)[0].rstrip(",;:-– ")
        t = (cut or t[:limit]) + "…"
    return t


# ---------------------------------------------------------------------------------------------
# Shriftlar va o'lchash
# ---------------------------------------------------------------------------------------------
_FONT: Optional[Dict[str, str]] = None


def fonts() -> Dict[str, str]:
    """reportlab shriftlarini ro'yxatdan o'tkazadi. DejaVu topilmasa Helvetica (faqat lotin)."""
    global _FONT
    if _FONT is not None:
        return _FONT
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    files = {"r": ("SS", "DejaVuSans.ttf"), "b": ("SS-B", "DejaVuSans-Bold.ttf"), "i": ("SS-I", "DejaVuSans-Oblique.ttf")}
    out: Dict[str, str] = {}
    fallback = {"r": "Helvetica", "b": "Helvetica-Bold", "i": "Helvetica-Oblique"}
    for k, (name, fn) in files.items():
        path = next((p for p in (os.path.join(FONT_DIR, fn), os.path.join(SYS_FONT_DIR, fn)) if os.path.isfile(p)), None)
        try:
            if path:
                pdfmetrics.registerFont(TTFont(name, path))
                out[k] = name
                continue
        except Exception as e:  # pragma: no cover
            print(f"[DECK] shrift yuklanmadi {fn}: {e}")
        out[k] = fallback[k]
    _FONT = out
    return out


def _fk(bold: bool, italic: bool) -> str:
    f = fonts()
    return f["b"] if bold else (f["i"] if italic else f["r"])


def text_w(s: str, size: float, bold: bool = False, italic: bool = False) -> float:
    from reportlab.pdfbase.pdfmetrics import stringWidth
    return stringWidth(s, _fk(bold, italic), size)


def wrap(text: str, size: float, width: float, bold: bool = False, italic: bool = False) -> List[str]:
    words = text.split(" ")
    lines: List[str] = []
    cur = ""
    for w in words:
        if not w:
            continue
        cand = (cur + " " + w) if cur else w
        if text_w(cand, size, bold, italic) <= width:
            cur = cand
            continue
        if cur:
            lines.append(cur)
            cur = ""
        while text_w(w, size, bold, italic) > width and len(w) > 1:     # juda uzun so'z — harf bo'yicha bo'lamiz
            k = len(w)
            while k > 1 and text_w(w[:k], size, bold, italic) > width:
                k -= 1
            lines.append(w[:k])
            w = w[k:]
        cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def fit(text: str, width: float, height: float, max_size: int, min_size: int, bold: bool = False, italic: bool = False,
        lh: float = LH) -> Tuple[int, List[str]]:
    """Matn (width x height) ga sig'adigan eng katta o'lchamni tanlaydi."""
    size = max_size
    longest = max((len(w) for w in text.split(" ")), default=0)
    while size >= min_size:
        lines = wrap(text, size, width, bold, italic)
        whole = all(text_w(w, size, bold, italic) <= width for w in text.split(" ") if w) if longest > 6 else True
        if whole and len(lines) * size * lh <= height + 0.5:
            return size, lines
        size -= 1
    return min_size, wrap(text, min_size, width, bold, italic)


# ---------------------------------------------------------------------------------------------
# Ranglar
# ---------------------------------------------------------------------------------------------
def _rgb(h: str) -> Tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def mix(a: str, b: str, t: float) -> str:
    ra, rb = _rgb(a), _rgb(b)
    return "#%02X%02X%02X" % tuple(round(ra[i] + (rb[i] - ra[i]) * t) for i in range(3))


# ---------------------------------------------------------------------------------------------
# AI javobini tozalash va tekshirish
# ---------------------------------------------------------------------------------------------
def extract_json(text: str) -> Optional[dict]:
    """AI javobidan birinchi to'liq JSON obyektini oladi (```json``` va <think> bloklari bilan ham)."""
    if not text:
        return None
    t = re.sub(r"<think>[\s\S]*?(?:</think>|$)", "", text, flags=re.I).strip()
    try:
        v = json.loads(t)
        return v if isinstance(v, dict) else None
    except Exception:
        pass
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
    if m:
        try:
            v = json.loads(m.group(1))
            if isinstance(v, dict):
                return v
        except Exception:
            pass
    start = t.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(t)):
            ch = t[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        v = json.loads(t[start:i + 1])
                        if isinstance(v, dict):
                            return v
                    except Exception:
                        pass
                    break
        start = t.find("{", start + 1)
    return None


def _num(v: Any) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d\s,.]*", str(v or ""))
    if not m:
        return 0.0
    t = m.group(0).replace(" ", "")
    if t.count(",") == 1 and t.count(".") == 0:
        t = t.replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return 0.0


def _as_list(v: Any) -> list:
    return v if isinstance(v, list) else []


def normalize_slide(s: Any) -> Optional[dict]:
    if not isinstance(s, dict):
        return None
    lay = str(s.get("layout") or "").strip().lower()
    if lay not in LAYOUTS:
        lay = "bullets" if (s.get("bullets") or s.get("points")) else ("cards" if s.get("cards") else "")
    if lay == "" and s.get("rows"):
        lay = "table"
    if lay == "" and (s.get("labels") or s.get("series") or s.get("values")):
        lay = "chart"
    out: Dict[str, Any] = {"layout": lay, "notes": clean(s.get("notes"), 400), "image": clean(s.get("image"), 80)}
    tr = str(s.get("transition") or "").strip().lower()
    out["transition"] = tr if tr in TRANSITIONS else ""
    title = clean(s.get("title"), 90)
    if lay in ("title", "closing"):
        out.update(title=title or "…", subtitle=clean(s.get("subtitle"), 140))
    elif lay == "bullets":
        items = [clean(b, 150) for b in _as_list(s.get("bullets") or s.get("points"))]
        items = [b for b in items if b][:6]
        if not items:
            return None
        out.update(title=title, bullets=items)
    elif lay == "cards":
        cards = []
        for c in _as_list(s.get("cards")):
            if isinstance(c, dict):
                hd, tx = clean(c.get("heading") or c.get("title"), 42), clean(c.get("text") or c.get("body"), 150)
            else:
                hd, tx = "", clean(c, 150)
            if hd or tx:
                cards.append({"heading": hd, "text": tx})
        cards = cards[:4]
        if len(cards) < 2:
            return None
        out.update(title=title, cards=cards)
        out["image"] = ""
    elif lay == "stats":
        stats = []
        for c in _as_list(s.get("stats")):
            if isinstance(c, dict):
                v, lb = clean(c.get("value"), 14), clean(c.get("label"), 70)
                if v:
                    stats.append({"value": v, "label": lb})
        stats = stats[:4]
        if len(stats) < 2:
            return None
        out.update(title=title, stats=stats)
        out["image"] = ""
    elif lay == "table":
        rows = []
        for r in _as_list(s.get("rows") or s.get("table")):
            if isinstance(r, dict):
                r = list(r.values())
            if isinstance(r, list):
                cells = [clean(c, 60) for c in r][:6]
                if any(cells):
                    rows.append(cells)
        rows = rows[:9]
        if len(rows) < 2:
            return None
        cols = max(len(r) for r in rows)
        rows = [r + [""] * (cols - len(r)) for r in rows]
        out.update(title=title, rows=rows)
        out["image"] = ""
    elif lay == "chart":
        kind = str(s.get("chart") or s.get("kind") or s.get("type") or "bar").strip().lower()
        if kind in ("column", "columns", "histogram"):
            kind = "bar"
        if kind in ("donut",):
            kind = "doughnut"
        if kind not in CHART_KINDS:
            kind = "bar"
        labels = [clean(x, 24) for x in _as_list(s.get("labels") or s.get("categories"))][:10]
        series = []
        for sr in _as_list(s.get("series")):
            if isinstance(sr, dict):
                vals = [_num(v) for v in _as_list(sr.get("values"))][:10]
                if vals:
                    series.append({"name": clean(sr.get("name"), 30), "values": vals})
        if not series and s.get("values"):
            series = [{"name": "", "values": [_num(v) for v in _as_list(s.get("values"))][:10]}]
        series = series[:3]
        if not series or not labels:
            return None
        n = min(len(labels), max(len(sr["values"]) for sr in series))
        if n < 2:
            return None
        labels = labels[:n]
        for sr in series:
            sr["values"] = (sr["values"] + [0.0] * n)[:n]
        if kind in ("pie", "doughnut"):
            series = series[:1]
        out.update(title=title, chart=kind, labels=labels, series=series)
        out["image"] = ""
    elif lay == "quote":
        q = clean(s.get("text") or s.get("quote"), 220)
        if not q:
            return None
        out.update(text=q, author=clean(s.get("author"), 60), title=title)
        out["image"] = ""
    else:
        return None
    return out


def normalize_deck(raw: Any, n: int, topic: str = "") -> Optional[dict]:
    """AI chiqargan JSON ni xavfsiz, sig'adigan ko'rinishga keltiradi. n = so'ralgan slaydlar soni."""
    if not isinstance(raw, dict):
        return None
    slides_raw = raw.get("slides")
    if not isinstance(slides_raw, list):
        return None
    slides = [x for x in (normalize_slide(s) for s in slides_raw) if x]
    if not slides:
        return None
    title = clean(raw.get("title"), 90) or clean(topic, 90) or slides[0].get("title") or "Taqdimot"
    theme = str(raw.get("theme") or "").strip().lower()
    if theme not in THEMES:
        theme = DEFAULT_THEME
    if slides[0]["layout"] != "title":
        slides.insert(0, {"layout": "title", "title": title, "subtitle": clean(raw.get("subtitle"), 140), "notes": "", "image": "", "transition": ""})
    n = max(1, int(n or len(slides)))
    if len(slides) > n:
        closing = next((s for s in reversed(slides) if s["layout"] == "closing"), None)
        slides = slides[:n]
        if closing is not None and n >= 3 and slides[-1]["layout"] != "closing":
            slides[-1] = closing
    dtr = str(raw.get("transition") or "").strip().lower()
    return {"title": title, "subtitle": clean(raw.get("subtitle"), 140), "theme": theme, "slides": slides,
            "transition": dtr if dtr in TRANSITIONS else ""}


# ---------------------------------------------------------------------------------------------
# Rasm tayyorlash (Pillow)
# ---------------------------------------------------------------------------------------------
def cover_jpeg(data: bytes, w: int, h: int, scale: float = 1.6, quality: int = 80) -> Optional[bytes]:
    """Rasmni (w:h) nisbatga 'cover' usulida kesib, JPEG qiladi. Buzuq rasm bo'lsa None."""
    try:
        from PIL import Image, ImageOps
        im = Image.open(io.BytesIO(data))
        im = ImageOps.exif_transpose(im)
        if im.width < 200 or im.height < 120:
            return None
        if im.mode not in ("RGB",):
            bg = Image.new("RGB", im.size, (255, 255, 255))
            try:
                rgba = im.convert("RGBA")
                bg.paste(rgba, mask=rgba.split()[-1])
                im = bg
            except Exception:
                im = im.convert("RGB")
        tw, th = max(2, int(w * scale)), max(2, int(h * scale))
        im = ImageOps.fit(im, (tw, th), method=Image.LANCZOS, centering=(0.5, 0.4))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=quality, optimize=True)
        return buf.getvalue()
    except Exception:
        return None


# ---------------------------------------------------------------------------------------------
# Sahna (scene)
# ---------------------------------------------------------------------------------------------
class Scene:
    def __init__(self, bg: str):
        self.bg = bg
        self.items: List[dict] = []
        self.notes = ""
        self.transition = "fade"

    def table(self, x, y, w, h, rows, colw, rowh, fs, th):
        self.items.append(dict(t="table", x=x, y=y, w=w, h=h, rows=rows, colw=colw, rowh=rowh, fs=fs, th=th))

    def chart(self, x, y, w, h, kind, labels, series, th):
        self.items.append(dict(t="chart", x=x, y=y, w=w, h=h, kind=kind, labels=labels, series=series, th=th))

    def rect(self, x, y, w, h, fill, r=0, line=None, lw=1):
        self.items.append(dict(t="rect", x=x, y=y, w=w, h=h, fill=fill, r=r, line=line, lw=lw))

    def oval(self, x, y, w, h, fill):
        self.items.append(dict(t="oval", x=x, y=y, w=w, h=h, fill=fill))

    def image(self, x, y, w, h, data, r=0):
        self.items.append(dict(t="img", x=x, y=y, w=w, h=h, data=data, r=r))

    def text(self, x, y, w, h, text, size, color, bold=False, italic=False, align="l", anchor="t", lines=None):
        size = int(round(size))
        if lines is None:
            lines = wrap(text, size, w, bold, italic)
        self.items.append(dict(t="text", x=x, y=y, w=w, h=h, text=text, size=size, color=color, bold=bold, italic=italic,
                               align=align, anchor=anchor, lines=lines))


def _layout_table(sc: Scene, th: dict, rows: List[List[str]]) -> None:
    """Jadval o'lchamlarini hisoblaydi (ustun kengligi matn uzunligiga qarab, shrift sig'ishiga qarab)."""
    cols = len(rows[0])
    X, Y, TW, MAXH = 56, 152, 848, 330
    weights = []
    for ci in range(cols):
        mx = max(len(r[ci]) for r in rows)
        weights.append(min(30, max(6, mx)))
    tot = float(sum(weights))
    colw = [TW * w / tot for w in weights]
    colw = [max(70.0, c) for c in colw]
    k = TW / sum(colw)
    colw = [c * k for c in colw]
    pick = None
    for fs in range(22, 10, -1):
        rh = []
        for ri, r in enumerate(rows):
            n = max(len(wrap(c or " ", fs, colw[ci] - 20, bold=(ri == 0))) for ci, c in enumerate(r))
            rh.append(n * fs * LH + 16)
        if sum(rh) <= MAXH:
            pick = (fs, rh)
            break
    if pick is None:
        fs = 11
        pick = (fs, [max(len(wrap(c or " ", fs, colw[ci] - 20)) for ci, c in enumerate(r)) * fs * LH + 12 for r in rows])
    fs, rh = pick
    sc.table(X, Y, TW, sum(rh), rows, colw, rh, fs, th)


def series_colors(th: dict, n: int) -> List[str]:
    base = [th["primary"], th["accent"], mix(th["primary"], "#FFFFFF", 0.45), mix(th["accent"], th["dark"], 0.4),
            mix(th["primary"], th["accent"], 0.5), mix(th["dark"], "#FFFFFF", 0.35), mix(th["accent"], "#FFFFFF", 0.5),
            mix(th["primary"], th["dark"], 0.5), mix(th["tint"], th["primary"], 0.6), mix(th["muted"], "#FFFFFF", 0.4)]
    return [base[i % len(base)] for i in range(n)]


def _fmt_num(v: float) -> str:
    if abs(v - round(v)) < 1e-9:
        return f"{int(round(v)):,}"                  # 1,000 — canvas va PPTX bilan bir xil
    return f"{v:.2f}".rstrip("0").rstrip(".")


def _short(text: str, size: float, width: float, bold: bool = False) -> str:
    if text_w(text, size, bold) <= width:
        return text
    while text and text_w(text + "…", size, bold) > width:
        text = text[:-1]
    return (text + "…") if text else ""


def expand_item(it: dict) -> List[dict]:
    """table / chart ni oddiy chizma elementlariga (rect, text, line, poly, wedge) ajratadi — PDF va HTML uchun."""
    t = it["t"]
    if t == "table":
        tmp = Scene("#FFFFFF")
        th = it["th"]
        x0, y = it["x"], it["y"]
        fs = it["fs"]
        for ri, r in enumerate(it["rows"]):
            rh = it["rowh"][ri]
            x = x0
            for ci, cell in enumerate(r):
                cw = it["colw"][ci]
                if ri == 0:
                    fill = th["primary"]
                elif ri % 2 == 0:
                    fill = th["tint"]
                else:
                    fill = th["card"]
                tmp.rect(x, y, cw, rh, fill, line=mix(th["tint"], th["primary"], 0.25), lw=1)
                col = "#FFFFFF" if ri == 0 else th["text"]
                lines = wrap(cell or " ", fs, cw - 20, bold=(ri == 0))
                if cell:
                    tmp.text(x + 10, y, cw - 20, rh, cell, fs, col, bold=(ri == 0), align=("l" if ci == 0 else "c"), anchor="m", lines=lines)
                x += cw
            y += rh
        return tmp.items
    if t == "chart":
        return _chart_items(it)
    return [it]


def chart_axis(series: List[dict]) -> Tuple[float, float, float]:
    """Bar/line diagramma Y o'qi: (pastki chegara, yuqori chegara, qadam).
    Yagona manba: PDF/HTML'dagi o'zimiz chizgan o'q ham, PPTX'dagi native diagramma ham SHU qiymatlarni ishlatadi —
    shuning uchun raqamlar va gridline'lar hamma formatda bir xil bo'ladi (avval PPTX o'zi 'avto' tanlardi)."""
    allv = [float(v) for sr in series for v in sr["values"]]
    vmax = max(allv + [0.0])
    vmin = min(allv + [0.0])
    if vmax == vmin:
        vmax = vmin + 1
    span = vmax - vmin
    step = 10 ** math.floor(math.log10(span / 4.0))
    for m in (1, 2, 2.5, 5, 10):
        if span / (step * m) <= 5:
            step *= m
            break
    top = math.ceil(vmax / step - 1e-9) * step
    bot = math.floor(vmin / step) * step if vmin < 0 else 0.0
    return bot, top, step


def _chart_items(it: dict) -> List[dict]:
    th = it["th"]
    X, Y, CW, CH = it["x"], it["y"], it["w"], it["h"]
    kind, labels, series = it["kind"], it["labels"], it["series"]
    n = len(labels)
    tmp = Scene("#FFFFFF")
    if kind in ("pie", "doughnut"):
        vals = [max(0.0, v) for v in series[0]["values"]]
        tot = sum(vals) or 1.0
        cols = series_colors(th, n)
        r = min(CH / 2 - 8, 150)
        cx, cy = X + r + 30, Y + CH / 2
        a = 0.0
        for v, c in zip(vals, cols):
            ext = 360.0 * v / tot
            if ext > 0.05:
                tmp.items.append(dict(t="wedge", cx=cx, cy=cy, r=r, a0=a, a1=a + ext, fill=c))
            a += ext
        if kind == "doughnut":
            tmp.oval(cx - r * 0.55, cy - r * 0.55, r * 1.1, r * 1.1, th["bg"])
        lx, ly = cx + r + 60, Y + max(0.0, (CH - n * 34) / 2)
        for lab, v, c in zip(labels, vals, cols):
            tmp.rect(lx, ly + 6, 18, 18, c, r=4)
            pct = f"{100.0 * v / tot:.0f}%"
            txt = _short(f"{lab}", 20, X + CW - lx - 130)
            tmp.text(lx + 28, ly, X + CW - lx - 120, 30, txt, 20, th["text"], anchor="m", lines=[txt])
            tmp.text(X + CW - 90, ly, 90, 30, pct, 20, th["primary"], bold=True, align="r", anchor="m", lines=[pct])
            ly += 34
        return tmp.items
    # bar / line — o'q chegaralari PPTX bilan BIR XIL (chart_axis)
    bot, top, step = chart_axis(series)
    gx0 = X + 70
    gx1 = X + CW - 10
    legend_h = 30 if len(series) > 1 else 0
    gy0 = Y + 10 + legend_h
    gy1 = Y + CH - 44
    def py(v):
        return gy1 - (v - bot) / (top - bot) * (gy1 - gy0)
    gv = bot
    guard = 0
    while gv <= top + 1e-9 and guard < 20:
        yy = py(gv)
        tmp.items.append(dict(t="line", x1=gx0, y1=yy, x2=gx1, y2=yy, color=mix(th["tint"], th["muted"], 0.35), lw=1))
        lab = _fmt_num(gv)
        tmp.text(X, yy - 10, 62, 20, lab, 14, th["muted"], align="r", anchor="m", lines=[lab])
        gv += step
        guard += 1
    cols = series_colors(th, len(series))
    slot = (gx1 - gx0) / n
    for ci, lab in enumerate(labels):
        txt = _short(lab, 15, slot - 4)
        tmp.text(gx0 + ci * slot, gy1 + 10, slot, 22, txt, 15, th["text"], align="c", anchor="m", lines=[txt])
    if kind == "bar":
        ns = len(series)
        bw = min(70.0, (slot * 0.72) / ns)
        for si, sr in enumerate(series):
            for ci, v in enumerate(sr["values"]):
                x = gx0 + ci * slot + (slot - bw * ns) / 2 + si * bw
                y0, y1 = py(max(v, 0)), py(min(v, 0) if bot < 0 else bot)
                hh = max(1.0, abs(y1 - y0))
                tmp.rect(x, min(y0, y1), bw - 2, hh, cols[si], r=0)
                lab = _fmt_num(v)
                tmp.text(x - 10, min(y0, y1) - 22, bw + 18, 20, lab, 14, th["text"], bold=True, align="c", anchor="m", lines=[lab])
    else:
        for si, sr in enumerate(series):
            pts = [(gx0 + ci * slot + slot / 2, py(v)) for ci, v in enumerate(sr["values"])]
            tmp.items.append(dict(t="poly", pts=pts, color=cols[si], lw=3.5))
            for (px, pyy), v in zip(pts, sr["values"]):
                tmp.oval(px - 6, pyy - 6, 12, 12, cols[si])
                lab = _fmt_num(v)
                tmp.text(px - 40, pyy - 28, 80, 20, lab, 14, th["text"], bold=True, align="c", anchor="m", lines=[lab])
    if len(series) > 1:
        lx = gx0
        for si, sr in enumerate(series):
            nm = sr["name"] or f"#{si + 1}"
            tmp.rect(lx, Y + 6, 16, 16, cols[si], r=3)
            tmp.text(lx + 24, Y + 2, 200, 24, nm, 16, th["text"], anchor="m", lines=[_short(nm, 16, 190)])
            lx += 40 + min(190, text_w(nm, 16)) + 20
    return tmp.items



def _footer(sc: Scene, th: dict, deck_title: str, idx: int, total: int):
    sc.text(56, 502, 640, 20, deck_title, 12, th["muted"], lines=[deck_title[:90]])
    num = f"{idx} / {total}"
    sc.text(804, 502, 100, 20, num, 12, th["muted"], align="r", lines=[num])


def _topbar(sc: Scene, th: dict):
    sc.rect(0, 0, W, 10, th["primary"])
    sc.rect(0, 0, 140, 10, th["accent"])


def _heading(sc: Scene, th: dict, title: str, width: float) -> None:
    size, lines = fit(title, width, 84, 34, 22, bold=True)
    sc.text(56, 38, width, 84, title, size, th["primary"], bold=True, lines=lines)
    sc.rect(56, 128, 64, 5, th["accent"], r=2)


def _dark_slide(sc: Scene, th: dict, title: str, subtitle: str, img: Optional[bytes], kicker: str) -> None:
    dark, prim, acc = th["dark"], th["primary"], th["accent"]
    text_w_ = 500 if img else 700
    if img:
        sc.rect(0, 0, W, H, dark)
        sc.image(580, 0, 380, 540, img, 0)
        sc.rect(572, 0, 8, 540, acc)
    else:
        sc.oval(600, -170, 600, 600, mix(dark, prim, 0.55))
        sc.oval(720, 330, 320, 320, mix(dark, acc, 0.45))
        sc.oval(520, 380, 90, 90, mix(dark, acc, 0.7))
    sc.rect(64, 168, 70, 6, acc, r=3)
    if kicker:
        sc.text(64, 130, text_w_, 26, kicker, 15, mix("#FFFFFF", dark, 0.35), bold=True, lines=[kicker])
    size, lines = fit(title, text_w_, 190, 54, 28, bold=True)
    sc.text(64, 196, text_w_, 190, title, size, "#FFFFFF", bold=True, lines=lines)
    used = len(lines) * size * LH
    if subtitle:
        ssz, slines = fit(subtitle, text_w_, 110, 22, 14)
        sc.text(64, 196 + used + 14, text_w_, 110, subtitle, ssz, mix("#FFFFFF", dark, 0.28), lines=slines)


def build_scenes(deck: dict, images: Optional[Dict[int, bytes]] = None, lang: str = "uz") -> List[Scene]:
    th = THEMES.get(deck.get("theme"), THEMES[DEFAULT_THEME])
    slides = deck["slides"]
    total = len(slides)
    deck_title = deck.get("title") or ""
    images = images or {}
    scenes: List[Scene] = []
    for i, s in enumerate(slides):
        lay = s["layout"]
        idx = i + 1
        raw_img = images.get(i)
        if lay in ("title", "closing"):
            sc = Scene(th["dark"])
            img = cover_jpeg(raw_img, 380, 540) if (raw_img and lay == "title") else None
            _dark_slide(sc, th, s.get("title") or deck_title, s.get("subtitle", ""), img, "SLIDE STUDIO AI" if lay == "title" else "")
        elif lay == "bullets":
            sc = Scene(th["bg"])
            _topbar(sc, th)
            img = cover_jpeg(raw_img, 304, 330) if raw_img else None
            body_w = 512 if img else 848
            _heading(sc, th, s["title"], body_w if img else 848)
            if img:
                sc.image(600, 150, 304, 330, img, 18)
            blocks = None
            top_size = 30 if (len(s["bullets"]) <= 3 and not img) else 26
            for size in range(top_size, 15, -1):
                tmp = [wrap(b, size, body_w - 28) for b in s["bullets"]]
                gap = 14 if size >= 20 else 10
                h = sum(len(l) * size * LH for l in tmp) + gap * (len(tmp) - 1)
                if h <= 330:
                    blocks = (size, tmp, gap)
                    break
            if blocks is None:
                size = 16
                blocks = (size, [wrap(b, size, body_w - 28) for b in s["bullets"]], 8)
            size, tmp, gap = blocks
            total_h = sum(len(l) * size * LH for l in tmp) + gap * (len(tmp) - 1)
            y = 152 + (max(0.0, 326 - total_h) / 2 if total_h < 260 else 0)
            for b, lines in zip(s["bullets"], tmp):
                hh = len(lines) * size * LH
                d = max(8, round(size * 0.4))
                sc.oval(56, y + (size * LH - d) / 2, d, d, th["accent"])
                sc.text(56 + 28, y, body_w - 28, hh, b, size, th["text"], lines=lines)
                y += hh + gap
            _footer(sc, th, deck_title, idx, total)
        elif lay == "cards":
            sc = Scene(th["bg"])
            _topbar(sc, th)
            _heading(sc, th, s["title"], 848)
            n = len(s["cards"])
            gap = 22
            if n == 4:                                   # 2 x 2 to'r — so'zlar bo'linmaydi
                cw, ch = (848 - gap) / 2, 150
                cells = [(56 + (k % 2) * (cw + gap), 154 + (k // 2) * (ch + 16)) for k in range(4)]
                for (x, y), (k, c) in zip(cells, enumerate(s["cards"])):
                    sc.rect(x, y, cw, ch, th["card"], r=16, line=mix(th["tint"], th["primary"], 0.12), lw=1.2)
                    sc.rect(x, y + 14, 6, ch - 28, th["accent"], r=3)
                    sc.oval(x + 22, y + 20, 40, 40, th["primary"])
                    sc.text(x + 22, y + 20, 40, 40, str(k + 1), 19, "#FFFFFF", bold=True, align="c", anchor="m", lines=[str(k + 1)])
                    inner = cw - 92
                    hs, hl = fit(c["heading"] or " ", inner, 52, 21, 15, bold=True)
                    hh = len(hl) * hs * LH if c["heading"] else 0
                    if c["heading"]:
                        sc.text(x + 78, y + 18, inner, hh, c["heading"], hs, th["primary"], bold=True, lines=hl)
                    ty = y + 18 + hh + 6
                    bs, bl = fit(c["text"] or " ", inner, y + ch - 12 - ty, 17, 12)
                    if c["text"]:
                        sc.text(x + 78, ty, inner, len(bl) * bs * LH, c["text"], bs, th["text"], lines=bl)
            else:
                cw = (848 - gap * (n - 1)) / n
                ch = 316
                for k, c in enumerate(s["cards"]):
                    x = 56 + k * (cw + gap)
                    y = 156
                    sc.rect(x, y, cw, ch, th["card"], r=18, line=mix(th["tint"], th["primary"], 0.12), lw=1.2)
                    sc.rect(x, y, cw, 7, th["accent"], r=0)
                    sc.oval(x + 20, y + 26, 42, 42, th["primary"])
                    sc.text(x + 20, y + 26, 42, 42, str(k + 1), 20, "#FFFFFF", bold=True, align="c", anchor="m", lines=[str(k + 1)])
                    inner = cw - 40
                    hs, hl = fit(c["heading"] or " ", inner, 70, 24 if n == 2 else 22, 15, bold=True)
                    hh = len(hl) * hs * LH if c["heading"] else 0
                    if c["heading"]:
                        sc.text(x + 20, y + 84, inner, hh, c["heading"], hs, th["primary"], bold=True, lines=hl)
                    ty = y + 84 + hh + 10
                    bs, bl = fit(c["text"] or " ", inner, y + ch - 18 - ty, 20 if n == 2 else 18, 12)
                    if c["text"]:
                        sc.text(x + 20, ty, inner, len(bl) * bs * LH, c["text"], bs, th["text"], lines=bl)
            _footer(sc, th, deck_title, idx, total)
        elif lay == "stats":
            sc = Scene(th["bg"])
            _topbar(sc, th)
            _heading(sc, th, s["title"], 848)
            n = len(s["stats"])
            gap = 22
            cw = (848 - gap * (n - 1)) / n
            ch = 280
            for k, c in enumerate(s["stats"]):
                x, y = 56 + k * (cw + gap), 170
                sc.rect(x, y, cw, ch, th["tint"], r=20)
                sc.rect(x + 24, y + 28, 44, 6, th["accent"], r=3)
                vs, vl = fit(c["value"], cw - 40, 80, 58 if n < 4 else 44, 24, bold=True)
                sc.text(x + 20, y + 64, cw - 40, 80, c["value"], vs, th["primary"], bold=True, align="l", anchor="m", lines=vl)
                ls, ll = fit(c["label"] or " ", cw - 40, ch - 170, 19, 12)
                if c["label"]:
                    sc.text(x + 20, y + 160, cw - 40, len(ll) * ls * LH, c["label"], ls, th["text"], lines=ll)
            _footer(sc, th, deck_title, idx, total)
        elif lay == "table":
            sc = Scene(th["bg"])
            _topbar(sc, th)
            _heading(sc, th, s["title"], 848)
            _layout_table(sc, th, s["rows"])
            _footer(sc, th, deck_title, idx, total)
        elif lay == "chart":
            sc = Scene(th["bg"])
            _topbar(sc, th)
            _heading(sc, th, s["title"], 848)
            sc.chart(56, 150, 848, 335, s["chart"], s["labels"], s["series"], th)
            _footer(sc, th, deck_title, idx, total)
        elif lay == "quote":
            sc = Scene(th["tint"])
            sc.rect(0, 0, 14, H, th["primary"])
            sc.text(70, 40, 160, 150, "“", 150, th["accent"], bold=True, lines=["“"])
            qs, ql = fit(s["text"], 760, 250, 38, 20, italic=True)
            qh = len(ql) * qs * LH
            block = qh + (52 if s.get("author") else 0)
            qy = max(150, 120 + (360 - block) / 2)
            sc.text(100, qy, 760, qh, s["text"], qs, th["text"], italic=True, lines=ql)
            if s.get("author"):
                a = "— " + s["author"]
                sc.text(100, qy + qh + 24, 760, 28, a, 20, th["primary"], bold=True, lines=[a])
            _footer(sc, th, deck_title, idx, total)
        else:  # pragma: no cover
            sc = Scene(th["bg"])
        sc.notes = s.get("notes", "")
        sc.transition = s.get("transition") or deck.get("transition") or "fade"
        scenes.append(sc)
    return scenes


# ---------------------------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------------------------
def _flat(items: List[dict]) -> List[dict]:
    out: List[dict] = []
    for it in items:
        if it["t"] in ("table", "chart"):
            out.extend(expand_item(it))
        else:
            out.append(it)
    return out


def render_pdf(scenes: List[Scene], title: str) -> bytes:
    from reportlab.lib.colors import HexColor
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas
    f = fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(W, H), pageCompression=1)
    c.setTitle(title or "Taqdimot")
    c.setAuthor("Slide Studio AI")
    for sc in scenes:
        c.setFillColor(HexColor(sc.bg))
        c.rect(0, 0, W, H, stroke=0, fill=1)
        for it in _flat(sc.items):
            t = it["t"]
            if t == "line":
                c.setStrokeColor(HexColor(it["color"]))
                c.setLineWidth(it.get("lw", 1))
                c.line(it["x1"], H - it["y1"], it["x2"], H - it["y2"])
            elif t == "poly":
                c.setStrokeColor(HexColor(it["color"]))
                c.setLineWidth(it.get("lw", 2))
                c.setLineJoin(1)
                pp = c.beginPath()
                for k, (px, py_) in enumerate(it["pts"]):
                    (pp.moveTo if k == 0 else pp.lineTo)(px, H - py_)
                c.drawPath(pp, stroke=1, fill=0)
            elif t == "wedge":
                c.setFillColor(HexColor(it["fill"]))
                c.setStrokeColor(HexColor("#FFFFFF"))
                c.setLineWidth(1.5)
                cx, cy, r = it["cx"], H - it["cy"], it["r"]
                # bizda burchak: 12:00 dan soat yo'nalishida; reportlab: 3:00 dan soatga teskari
                c.wedge(cx - r, cy - r, cx + r, cy + r, 90 - it["a0"], -(it["a1"] - it["a0"]), stroke=1, fill=1)
            elif t in ("rect", "oval"):
                x, w, h = it["x"], it["w"], it["h"]
                y = H - it["y"] - h
                c.setFillColor(HexColor(it["fill"]))
                if t == "oval":
                    c.ellipse(x, y, x + w, y + h, stroke=0, fill=1)
                else:
                    line = it.get("line")
                    if line:
                        c.setStrokeColor(HexColor(line))
                        c.setLineWidth(it.get("lw", 1))
                    r = min(it.get("r", 0), min(w, h) / 2)
                    if r > 0:
                        c.roundRect(x, y, w, h, r, stroke=1 if line else 0, fill=1)
                    else:
                        c.rect(x, y, w, h, stroke=1 if line else 0, fill=1)
            elif t == "img":
                x, w, h = it["x"], it["w"], it["h"]
                y = H - it["y"] - h
                c.saveState()
                if it.get("r"):
                    p = c.beginPath()
                    p.roundRect(x, y, w, h, it["r"])
                    c.clipPath(p, stroke=0, fill=0)
                c.drawImage(ImageReader(io.BytesIO(it["data"])), x, y, w, h)
                c.restoreState()
            elif t == "text":
                size = it["size"]
                font = f["b"] if it["bold"] else (f["i"] if it["italic"] else f["r"])
                c.setFont(font, size)
                c.setFillColor(HexColor(it["color"]))
                lines = it["lines"]
                block = len(lines) * size * LH
                top = it["y"]
                if it["anchor"] == "m":
                    top = it["y"] + (it["h"] - block) / 2
                for k, ln in enumerate(lines):
                    base = H - (top + k * size * LH + size * (LH / 2 + 0.346))
                    if it["align"] == "c":
                        c.drawCentredString(it["x"] + it["w"] / 2, base, ln)
                    elif it["align"] == "r":
                        c.drawRightString(it["x"] + it["w"], base, ln)
                    else:
                        c.drawString(it["x"], base, ln)
        c.showPage()
    c.save()
    return buf.getvalue()


# ---------------------------------------------------------------------------------------------
# PPTX
# ---------------------------------------------------------------------------------------------
_TR_XML = {
    "fade": '<p:fade/>',
    "zoom": '<p:zoom dir="in"/>',
    "flip": '<p:cover dir="r"/>',
    "up": '<p:push dir="u"/>',
    "blur": '<p:dissolve/>',
}


def _pptx_transition(slide, name: str) -> None:
    """Slayd o'tishini PowerPoint'ning o'z <p:transition> elementi bilan yozadi."""
    xml = _TR_XML.get(name or "")
    if not xml:
        return
    from lxml import etree
    from pptx.oxml.ns import qn
    ns = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
    el = etree.fromstring(f'<p:transition {ns} spd="med">{xml}</p:transition>')
    sld = slide._element
    for old in sld.findall(qn("p:transition")):
        sld.remove(old)
    anchor = sld.find(qn("p:clrMapOvr"))
    if anchor is None:
        anchor = sld.find(qn("p:cSld"))
    anchor.addnext(el)


def _pptx_table(slide, it: dict, E: int, rgb) -> None:
    from pptx.util import Emu, Pt
    from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
    from pptx.oxml.ns import qn
    th = it["th"]
    rows = it["rows"]
    gf = slide.shapes.add_table(len(rows), len(rows[0]), Emu(int(it["x"] * E)), Emu(int(it["y"] * E)),
                                Emu(int(it["w"] * E)), Emu(int(sum(it["rowh"]) * E)))
    tbl = gf.table
    try:                                                   # standart uslub chiziqlarini o'chirish
        tp = tbl._tbl.tblPr
        for a in ("bandRow", "firstRow"):
            tp.set(a, "0")
        sid = tp.find(qn("a:tableStyleId"))
        if sid is not None:
            sid.text = "{2D5ABB26-0587-4C30-8999-92F81FD0307C}"          # No Style, No Grid
    except Exception:
        pass
    for ci, cw in enumerate(it["colw"]):
        tbl.columns[ci].width = Emu(int(cw * E))
    for ri, r in enumerate(rows):
        tbl.rows[ri].height = Emu(int(it["rowh"][ri] * E))
        for ci, txt in enumerate(r):
            cell = tbl.cell(ri, ci)
            cell.fill.solid()
            cell.fill.fore_color.rgb = rgb(th["primary"] if ri == 0 else (th["tint"] if ri % 2 == 0 else th["card"]))
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = cell.margin_right = Emu(10 * E)
            cell.margin_top = cell.margin_bottom = Emu(4 * E)
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT if ci == 0 else PP_ALIGN.CENTER
            p.line_spacing = Pt(it["fs"] * LH)          # o'lchash (wrap) bilan bir xil qator balandligi -> qator kengayib siljimaydi
            run = p.add_run()
            run.text = txt
            run.font.size = Pt(it["fs"])
            run.font.bold = ri == 0
            run.font.name = "Arial"
            run.font.color.rgb = rgb("#FFFFFF" if ri == 0 else th["text"])
            # hujayra chegarasi
            tcPr = cell._tc.get_or_add_tcPr()
            from lxml import etree
            for side in ("lnL", "lnR", "lnT", "lnB"):
                ln = etree.SubElement(tcPr, qn("a:" + side), w="12700")
                sf = etree.SubElement(ln, qn("a:solidFill"))
                etree.SubElement(sf, qn("a:srgbClr"), val=mix(th["tint"], th["primary"], 0.25).lstrip("#").upper())
            # a:lnX elementlari fill'dan OLDIN turishi kerak
            fills = [e for e in tcPr if e.tag in (qn("a:solidFill"), qn("a:noFill"))]
            for fe in fills:
                tcPr.remove(fe)
                tcPr.append(fe)


def _pptx_chart(slide, it: dict, E: int, rgb) -> None:
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
    from pptx.util import Emu, Pt
    th = it["th"]
    kind = it["kind"]
    cd = CategoryChartData()
    cd.categories = it["labels"]
    for k, sr in enumerate(it["series"]):
        cd.add_series(sr["name"] or f"#{k + 1}", sr["values"])
    ct = {"bar": XL_CHART_TYPE.COLUMN_CLUSTERED, "line": XL_CHART_TYPE.LINE_MARKERS,
          "pie": XL_CHART_TYPE.PIE, "doughnut": XL_CHART_TYPE.DOUGHNUT}[kind]
    gf = slide.shapes.add_chart(ct, Emu(int(it["x"] * E)), Emu(int(it["y"] * E)), Emu(int(it["w"] * E)), Emu(int(it["h"] * E)), cd)
    ch = gf.chart
    ch.has_title = False
    ch.font.size = Pt(14)
    ch.font.name = "Arial"
    ch.font.color.rgb = rgb(th["text"])
    cols = series_colors(th, len(it["labels"]) if kind in ("pie", "doughnut") else len(it["series"]))
    plot = ch.plots[0]
    plot.has_data_labels = True
    dl = plot.data_labels
    dl.font.size = Pt(14)
    dl.font.bold = True
    if kind in ("pie", "doughnut"):
        ch.has_legend = True
        ch.legend.position = XL_LEGEND_POSITION.RIGHT
        ch.legend.include_in_layout = False
        ch.legend.font.size = Pt(16)
        dl.show_percentage = True
        dl.show_value = False
        dl.number_format = "0%"
        dl.number_format_is_linked = False
        ser = plot.series[0]
        for pi, c in enumerate(cols):
            pt = ser.points[pi]
            pt.format.fill.solid()
            pt.format.fill.fore_color.rgb = rgb(c)
        if kind == "pie":
            dl.font.color.rgb = rgb("#FFFFFF")
    else:
        ch.has_legend = len(it["series"]) > 1
        if ch.has_legend:
            ch.legend.position = XL_LEGEND_POSITION.TOP
            ch.legend.include_in_layout = False
        dl.show_value = True
        dl.number_format = "#,##0" if all(abs(v - round(v)) < 1e-9 for sr in it["series"] for v in sr["values"]) else "#,##0.##"
        dl.number_format_is_linked = False
        try:
            dl.position = XL_LABEL_POSITION.OUTSIDE_END if kind == "bar" else XL_LABEL_POSITION.ABOVE
        except Exception:
            pass
        for k, ser in enumerate(plot.series):
            if kind == "bar":
                ser.format.fill.solid()
                ser.format.fill.fore_color.rgb = rgb(cols[k])
            else:
                ser.format.line.color.rgb = rgb(cols[k])
                ser.format.line.width = Pt(3.5)
                ser.smooth = False
                ser.marker.format.fill.solid()
                ser.marker.format.fill.fore_color.rgb = rgb(cols[k])
                ser.marker.format.line.color.rgb = rgb(cols[k])
        if kind == "bar":
            plot.gap_width = 60
        va = ch.value_axis
        bot, top, step = chart_axis(it["series"])
        va.minimum_scale, va.maximum_scale, va.major_unit = bot, top, step      # PDF/HTML bilan bir xil o'q
        va.has_major_gridlines = True
        va.tick_labels.number_format = "#,##0" if step >= 1 else "0.0#"
        va.tick_labels.number_format_is_linked = False
        va.major_gridlines.format.line.color.rgb = rgb(mix(th["tint"], th["muted"], 0.35))
        va.format.line.fill.background()
        va.tick_labels.font.size = Pt(14)
        ch.category_axis.tick_labels.font.size = Pt(15)
        try:
            from pptx.enum.chart import XL_TICK_LABEL_POSITION
            ch.category_axis.tick_label_position = XL_TICK_LABEL_POSITION.LOW
        except Exception:
            pass


def render_pptx(scenes: List[Scene], title: str) -> bytes:
    from pptx import Presentation
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
    from pptx.oxml.ns import qn
    from pptx.util import Emu, Pt
    from lxml import etree

    E = 12700                                    # 1 px = 1 pt = 12700 EMU
    prs = Presentation()
    prs.slide_width, prs.slide_height = Emu(W * E), Emu(H * E)
    try:
        prs.core_properties.title = title or "Taqdimot"
        prs.core_properties.author = "Slide Studio AI"
    except Exception:
        pass
    blank = prs.slide_layouts[6]
    align_map = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}

    def rgb(h: str) -> RGBColor:
        return RGBColor.from_string(h.lstrip("#").upper())

    for sc in scenes:
        slide = prs.slides.add_slide(blank)
        bgf = slide.background.fill
        bgf.solid()
        bgf.fore_color.rgb = rgb(sc.bg)
        for it in sc.items:
            t = it["t"]
            x, y, w, h = (int(round(it[k] * E)) for k in ("x", "y", "w", "h"))
            if t in ("rect", "oval"):
                rr = it.get("r", 0) if t == "rect" else 0
                kind = MSO_SHAPE.OVAL if t == "oval" else (MSO_SHAPE.ROUNDED_RECTANGLE if rr > 0 else MSO_SHAPE.RECTANGLE)
                shp = slide.shapes.add_shape(kind, Emu(x), Emu(y), Emu(w), Emu(h))
                if kind == MSO_SHAPE.ROUNDED_RECTANGLE:
                    shp.adjustments[0] = min(0.5, rr / max(1.0, min(it["w"], it["h"])))
                shp.fill.solid()
                shp.fill.fore_color.rgb = rgb(it["fill"])
                if it.get("line"):
                    shp.line.color.rgb = rgb(it["line"])
                    shp.line.width = Pt(it.get("lw", 1))
                else:
                    shp.line.fill.background()
                try:
                    shp.shadow.inherit = False
                    st_el = shp._element.find(qn("p:style"))
                    if st_el is not None:
                        shp._element.remove(st_el)
                except Exception:
                    pass
            elif t == "table":
                _pptx_table(slide, it, E, rgb)
            elif t == "chart":
                _pptx_chart(slide, it, E, rgb)
            elif t == "img":
                pic = slide.shapes.add_picture(io.BytesIO(it["data"]), Emu(x), Emu(y), Emu(w), Emu(h))
                if it.get("r"):
                    try:
                        pic.auto_shape_type = MSO_SHAPE.ROUNDED_RECTANGLE
                        geom = pic._element.spPr.find(qn("a:prstGeom"))
                        av = geom.find(qn("a:avLst"))
                        if av is None:
                            av = etree.SubElement(geom, qn("a:avLst"))
                        for ch in list(av):
                            av.remove(ch)
                        gd = etree.SubElement(av, qn("a:gd"))
                        gd.set("name", "adj")
                        gd.set("fmla", "val %d" % int(min(0.5, it["r"] / max(1.0, min(it["w"], it["h"]))) * 100000))
                    except Exception:
                        pass
            elif t == "text":
                tb = slide.shapes.add_textbox(Emu(x), Emu(y), Emu(w), Emu(h))
                tf = tb.text_frame
                tf.word_wrap = True
                tf.auto_size = MSO_AUTO_SIZE.NONE
                tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
                tf.vertical_anchor = MSO_ANCHOR.MIDDLE if it["anchor"] == "m" else MSO_ANCHOR.TOP
                p = tf.paragraphs[0]
                p.alignment = align_map.get(it["align"], PP_ALIGN.LEFT)
                p.line_spacing = Pt(it["size"] * LH)
                r = p.add_run()
                r.text = it["text"]
                r.font.size = Pt(it["size"])
                r.font.bold = bool(it["bold"])
                r.font.italic = bool(it["italic"])
                r.font.name = "Arial"
                r.font.color.rgb = rgb(it["color"])
        _pptx_transition(slide, getattr(sc, "transition", "fade"))
        if sc.notes:
            try:
                slide.notes_slide.notes_text_frame.text = sc.notes
            except Exception:
                pass
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------------------------------------
# HTML (mustaqil namoyish)
# ---------------------------------------------------------------------------------------------
_HTML_HEAD = """<!doctype html>
<html lang="{lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
html,body{{width:100%;height:100%;background:#0b0f19;overflow:hidden;font-family:"Segoe UI",Roboto,"Helvetica Neue",Arial,"DejaVu Sans",sans-serif;-webkit-tap-highlight-color:transparent}}
#view{{position:fixed;inset:0;display:flex;align-items:center;justify-content:center}}
#stage{{position:relative;width:960px;height:540px;transform-origin:center center;flex:none}}
.slide{{position:absolute;inset:0;width:960px;height:540px;overflow:hidden;opacity:0;visibility:hidden;transition:opacity .35s ease}}
.slide.on{{opacity:1;visibility:visible}}
@keyframes trFade{{from{{opacity:0}}to{{opacity:1}}}}
@keyframes trZoom{{from{{opacity:0;transform:scale(.86)}}to{{opacity:1;transform:scale(1)}}}}
@keyframes trFlip{{from{{opacity:0;transform:perspective(900px) rotateY(80deg)}}to{{opacity:1;transform:perspective(900px) rotateY(0)}}}}
@keyframes trUp{{from{{opacity:0;transform:translateY(48px)}}to{{opacity:1;transform:translateY(0)}}}}
@keyframes trBlur{{from{{opacity:0;filter:blur(14px)}}to{{opacity:1;filter:blur(0)}}}}
.slide.on.tr-fade{{animation:trFade .6s ease both}}
.slide.on.tr-zoom{{animation:trZoom .55s cubic-bezier(.22,.61,.36,1) both}}
.slide.on.tr-flip{{animation:trFlip .7s cubic-bezier(.22,.61,.36,1) both}}
.slide.on.tr-up{{animation:trUp .5s cubic-bezier(.22,.61,.36,1) both}}
.slide.on.tr-blur{{animation:trBlur .6s ease both}}
.slide>svg{{position:absolute}}
.slide>*{{position:absolute}}
.t{{display:flex;flex-direction:column;overflow:visible}}
.t>div{{width:100%}}
.slide img{{object-fit:cover;display:block}}
#bar{{position:fixed;left:0;bottom:0;height:3px;background:#38bdf8;width:0;transition:width .3s}}
#ui{{position:fixed;right:12px;bottom:10px;display:flex;gap:8px;align-items:center;color:#cbd5e1;font:600 12px system-ui,sans-serif;opacity:.0;transition:opacity .25s}}
body:hover #ui,body.touch #ui{{opacity:.9}}
#ui button{{background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:8px;padding:6px 10px;font:600 13px system-ui;cursor:pointer}}
@media print{{
  @page{{size:960px 540px;margin:0}}
  html,body{{background:#fff;overflow:visible;height:auto}}
  #view{{position:static;display:block}}
  #stage{{transform:none!important;width:960px;height:auto}}
  .slide{{position:relative;opacity:1;visibility:visible;page-break-after:always;break-after:page}}
  #bar,#ui{{display:none}}
}}
</style></head><body>
<div id="view"><div id="stage">
"""
_HTML_TAIL = """</div></div>
<div id="bar"></div>
<div id="ui"><button id="pv">&#8592;</button><span id="ct"></span><button id="nx">&#8594;</button><button id="fs">&#x26F6;</button></div>
<script>
(function(){{
var S=[].slice.call(document.querySelectorAll('.slide')),i=0,st=document.getElementById('stage');
function fitStage(){{var k=Math.min(innerWidth/960,innerHeight/540);st.style.transform='scale('+k+')';}}
function show(n){{i=Math.max(0,Math.min(S.length-1,n));S.forEach(function(s,k){{s.classList.toggle('on',k===i)}});
document.getElementById('ct').textContent=(i+1)+' / '+S.length;document.getElementById('bar').style.width=((i+1)/S.length*100)+'%';
try{{history.replaceState(null,'','#'+(i+1))}}catch(e){{}}}}
function next(){{show(i+1)}}function prev(){{show(i-1)}}
addEventListener('resize',fitStage);fitStage();
addEventListener('keydown',function(e){{var k=e.key;
if(k==='ArrowRight'||k==='PageDown'||k===' '||k==='Enter'){{e.preventDefault();next()}}
else if(k==='ArrowLeft'||k==='PageUp'||k==='Backspace'){{e.preventDefault();prev()}}
else if(k==='Home')show(0);else if(k==='End')show(S.length-1);
else if(k==='f'||k==='F')fs();}});
function fs(){{var d=document.documentElement;if(!document.fullscreenElement){{(d.requestFullscreen||d.webkitRequestFullscreen||function(){{}}).call(d)}}else{{(document.exitFullscreen||document.webkitExitFullscreen||function(){{}}).call(document)}}}}
document.getElementById('nx').onclick=function(e){{e.stopPropagation();next()}};
document.getElementById('pv').onclick=function(e){{e.stopPropagation();prev()}};
document.getElementById('fs').onclick=function(e){{e.stopPropagation();fs()}};
var x0=null;
addEventListener('touchstart',function(e){{document.body.classList.add('touch');x0=e.touches[0].clientX}},{{passive:true}});
addEventListener('touchend',function(e){{if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(dx)>40){{dx<0?next():prev()}}}},{{passive:true}});
document.getElementById('view').addEventListener('click',function(e){{if(e.clientX>innerWidth*0.35)next();else prev()}});
var h=parseInt((location.hash||'').slice(1),10);show(isNaN(h)?0:h-1);
}})();
</script></body></html>
""".replace("{{", "{").replace("}}", "}")


def render_html(scenes: List[Scene], title: str, lang: str = "uz", pptx: Optional[bytes] = None) -> bytes:
    e = _html.escape
    out = [_HTML_HEAD.format(title=e(title or "Taqdimot"), lang=e(lang or "uz"))]
    for sc in scenes:
        tr = getattr(sc, "transition", "fade") or "fade"
        out.append(f'<section class="slide tr-{e(tr)}" style="background:{sc.bg}">')
        sec_at = len(out) - 1
        svg: List[str] = []
        for it in _flat(sc.items):
            t = it["t"]
            if t in ("line", "poly", "wedge"):
                if t == "line":
                    svg.append(f'<line x1="{it["x1"]:.1f}" y1="{it["y1"]:.1f}" x2="{it["x2"]:.1f}" y2="{it["y2"]:.1f}" stroke="{it["color"]}" stroke-width="{it.get("lw", 1)}"/>')
                elif t == "poly":
                    pts = " ".join(f"{a:.1f},{b:.1f}" for a, b in it["pts"])
                    svg.append(f'<polyline points="{pts}" fill="none" stroke="{it["color"]}" stroke-width="{it.get("lw", 2)}" stroke-linejoin="round" stroke-linecap="round"/>')
                else:
                    a0, a1 = math.radians(it["a0"] - 90), math.radians(it["a1"] - 90)
                    r, cx, cy = it["r"], it["cx"], it["cy"]
                    x0, y0, x1, y1 = cx + r * math.cos(a0), cy + r * math.sin(a0), cx + r * math.cos(a1), cy + r * math.sin(a1)
                    large = 1 if (it["a1"] - it["a0"]) > 180 else 0
                    if it["a1"] - it["a0"] >= 359.9:
                        svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{it["fill"]}"/>')
                    else:
                        svg.append(f'<path d="M{cx:.1f} {cy:.1f} L{x0:.1f} {y0:.1f} A{r:.1f} {r:.1f} 0 {large} 1 {x1:.1f} {y1:.1f} Z" fill="{it["fill"]}" stroke="#fff" stroke-width="1.5"/>')
                continue
            pos = f'left:{it["x"]:.1f}px;top:{it["y"]:.1f}px;width:{it["w"]:.1f}px;height:{it["h"]:.1f}px;'
            if t == "rect":
                st = pos + f'background:{it["fill"]};'
                if it.get("r"):
                    st += f'border-radius:{it["r"]}px;'
                if it.get("line"):
                    st += f'border:{it.get("lw", 1)}px solid {it["line"]};'
                out.append(f'<div style="{st}"></div>')
            elif t == "oval":
                out.append(f'<div style="{pos}background:{it["fill"]};border-radius:50%"></div>')
            elif t == "img":
                b64 = base64.b64encode(it["data"]).decode("ascii")
                rad = f'border-radius:{it["r"]}px;' if it.get("r") else ""
                out.append(f'<img alt="" src="data:image/jpeg;base64,{b64}" style="{pos}{rad}">')
            elif t == "text":
                jc = "center" if it["anchor"] == "m" else "flex-start"
                st = (pos + f'justify-content:{jc};font-size:{it["size"]}px;line-height:{it["size"] * LH:.1f}px;color:{it["color"]};'
                      f'font-weight:{700 if it["bold"] else 400};text-align:{ {"l": "left", "c": "center", "r": "right"}[it["align"]] };')
                if it["italic"]:
                    st += "font-style:italic;"
                out.append(f'<div class="t" style="{st}"><div>{e(it["text"])}</div></div>')
        if svg:                                              # chiziq/sektorlar eng pastda, matn va nuqtalar ustida
            out.insert(sec_at + 1, '<svg width="960" height="540" viewBox="0 0 960 540" style="position:absolute;left:0;top:0;pointer-events:none">' + "".join(svg) + "</svg>")
        out.append("</section>")
    out.append(_HTML_TAIL)
    html_s = "".join(out)
    if pptx:      # muharrirda qayta ochish uchun: PPTX nusxasi faylning ichida (v49.2)
        import base64 as _b64
        blob = '<script type="application/octet-stream" id="ss-pptx">' + _b64.b64encode(pptx).decode() + "</script>\n"
        i = html_s.rfind("</body>")
        html_s = (html_s[:i] + blob + html_s[i:]) if i >= 0 else (html_s + blob)
    return html_s.encode("utf-8")


# ---------------------------------------------------------------------------------------------
# Yagona kirish nuqtasi
# ---------------------------------------------------------------------------------------------
def safe_filename(title: str, ext: str) -> str:
    base = re.sub(r"[^\w\-]+", "_", clean(title, 40), flags=re.U).strip("_") or "taqdimot"
    return f"{base}.{ext}"


def export(deck: dict, images: Optional[Dict[int, bytes]], fmt: str, lang: str = "uz") -> Tuple[str, bytes, str]:
    """(fayl_nomi, bayt, mime) qaytaradi. fmt: pptx | pdf | html."""
    scenes = build_scenes(deck, images, lang)
    title = deck.get("title") or "Taqdimot"
    if fmt == "pptx":
        return safe_filename(title, "pptx"), render_pptx(scenes, title), "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if fmt == "pdf":
        return safe_filename(title, "pdf"), render_pdf(scenes, title), "application/pdf"
    if fmt == "html":
        return safe_filename(title, "html"), render_html(scenes, title, lang, render_pptx(scenes, title)), "text/html; charset=utf-8"
    raise ValueError("noma'lum format")


def export_all(deck: dict, images: Optional[Dict[int, bytes]], lang: str = "uz") -> List[Tuple[str, bytes, str]]:
    # sahna va PPTX bir marta yasaladi (keshda), PDF/HTML shundan foydalanadi
    return [export_cached(deck, images, f, lang) for f in ("pptx", "pdf", "html")]


# ---------------------------------------------------------------------------------------------
# RAM keshi + oqim (stream): bir slayd uchun sahna va fayllar BIR MARTA yasaladi
# ---------------------------------------------------------------------------------------------
# Avval har bir «PPTX / PDF / HTML» bosilganda: rasmlar qayta yuklanardi, sahna (Pillow bilan kesish) qayta qurilardi,
# HTML uchun PPTX ikkinchi marta yasalardi. Endi: kalit = slayd mazmuni + til + rasmlar to'plami; natija RAM'da qisqa
# muddat saqlanadi (diskka / Supabase'ga YOZILMAYDI) va tayyor baytlar bevosita oqim sifatida uzatiladi.
import hashlib
import threading
import time as _time

MIME = {
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "pdf": "application/pdf",
    "html": "text/html; charset=utf-8",
}
CACHE_TTL = 600.0                    # soniya
CACHE_MAX_ENTRIES = 4
CACHE_MAX_BYTES = 48 * 1024 * 1024   # barcha tayyor fayllar yig'indisi (Render 512 MB RAM ga mos)


class _Entry:
    __slots__ = ("ts", "scenes", "out", "title", "size")

    def __init__(self, scenes: List[Scene], title: str):
        self.ts = _time.time()
        self.scenes = scenes
        self.title = title
        self.out: Dict[str, bytes] = {}
        self.size = 0


_CACHE: "OrderedDict[str, _Entry]" = OrderedDict()
_LATEST: Dict[str, str] = {}                  # slayd mazmuni xeshi -> eng so'nggi to'liq kalit
_CLOCK = threading.Lock()                      # kesh jadvali uchun (qisqa)
_KLOCKS: Dict[str, threading.Lock] = {}        # kalit bo'yicha: bir xil slaydni ikki marta yasamaslik uchun


def _deck_hash(deck: dict, lang: str) -> str:
    raw = json.dumps(deck, sort_keys=True, ensure_ascii=False, default=str) + "|" + (lang or "uz")
    return hashlib.blake2b(raw.encode("utf-8"), digest_size=16).hexdigest()


def _cache_key(deck: dict, images: Optional[Dict[int, bytes]], lang: str) -> Tuple[str, str]:
    dh = _deck_hash(deck, lang)
    h = hashlib.blake2b(dh.encode(), digest_size=16)
    for k in sorted((images or {}).keys()):
        b = images[k]
        h.update(str(k).encode() + b"|" + str(len(b)).encode() + b"|" + b[:64])
    return dh, h.hexdigest()


def _evict_locked() -> None:
    now = _time.time()
    for k in [k for k, e in _CACHE.items() if now - e.ts > CACHE_TTL]:
        _CACHE.pop(k, None)
    total = lambda: sum(e.size for e in _CACHE.values())
    while _CACHE and (len(_CACHE) > CACHE_MAX_ENTRIES or total() > CACHE_MAX_BYTES):
        _CACHE.popitem(last=False)
    live = set(_CACHE.keys())
    for dh in [d for d, k in _LATEST.items() if k not in live]:
        _LATEST.pop(dh, None)
    for k in [k for k in _KLOCKS if k not in live and not _KLOCKS[k].locked()]:
        _KLOCKS.pop(k, None)


def cache_peek(deck: dict, lang: str, fmt: str) -> Optional[Tuple[str, bytes, str]]:
    """Tayyor fayl RAM'da bo'lsa (rasmlarni yuklamasdan) darhol qaytaradi: (nom, bayt, mime) yoki None."""
    dh = _deck_hash(deck, lang)
    with _CLOCK:
        key = _LATEST.get(dh)
        e = _CACHE.get(key) if key else None
        if e is None or _time.time() - e.ts > CACHE_TTL or fmt not in e.out:
            return None
        _CACHE.move_to_end(key)
        return safe_filename(e.title, fmt), e.out[fmt], MIME[fmt]


def export_cached(deck: dict, images: Optional[Dict[int, bytes]], fmt: str, lang: str = "uz") -> Tuple[str, bytes, str]:
    """export() bilan bir xil natija, lekin sahna va fayllar keshlanadi (sinxron — asyncio.to_thread ichida chaqiring)."""
    if fmt not in MIME:
        raise ValueError("noma'lum format")
    dh, key = _cache_key(deck, images, lang)
    title = deck.get("title") or "Taqdimot"
    with _CLOCK:
        _evict_locked()
        kl = _KLOCKS.setdefault(key, threading.Lock())
    with kl:
        with _CLOCK:
            e = _CACHE.get(key)
            if e is not None:
                _CACHE.move_to_end(key)
        if e is None:
            e = _Entry(build_scenes(deck, images, lang), title)
            with _CLOCK:
                _CACHE[key] = e
                _LATEST[dh] = key
        if fmt not in e.out:
            if fmt == "pptx":
                data = render_pptx(e.scenes, title)
            elif fmt == "pdf":
                data = render_pdf(e.scenes, title)
            else:
                px = e.out.get("pptx") or render_pptx(e.scenes, title)     # HTML ichidagi PPTX nusxasi qayta yasalmaydi
                if "pptx" not in e.out:
                    e.out["pptx"] = px
                    e.size += len(px)
                data = render_html(e.scenes, title, lang, px)
            e.out[fmt] = data
            e.size += len(data)
        e.ts = _time.time()
        with _CLOCK:
            _LATEST[dh] = key
            _evict_locked()
        return safe_filename(title, fmt), e.out[fmt], MIME[fmt]


def export_stream(deck: dict, images: Optional[Dict[int, bytes]], fmt: str, lang: str = "uz") -> Tuple[str, io.BytesIO, str, int]:
    """(nom, BytesIO, mime, hajm). Fayl faqat RAM'da (io.BytesIO), diskka/Supabase'ga yozilmaydi."""
    name, data, mime = export_cached(deck, images, fmt, lang)
    return name, io.BytesIO(data), mime, len(data)


def cache_clear() -> None:
    with _CLOCK:
        _CACHE.clear()
        _LATEST.clear()


# ---------------------------------------------------------------------------------------------
# Rasmlarni internetdan olish (xavfsiz: faqat ommaviy hostlar, hajm cheklangan)
# ---------------------------------------------------------------------------------------------
MAX_IMG_BYTES = 6 * 1024 * 1024


def _public_host(host: str) -> bool:
    try:
        for fam, _t, _p, _c, sa in socket.getaddrinfo(host, None):
            ip = ipaddress.ip_address(sa[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                return False
        return True
    except Exception:
        return False


def download_image(url: str, timeout: float = 8.0) -> Optional[bytes]:
    """Sinxron (thread ichida chaqiriladi). Redirect'lar qo'lda tekshiriladi."""
    import httpx
    cur = url
    try:
        with httpx.Client(timeout=timeout, follow_redirects=False, headers={"User-Agent": "SlideStudio/1.0"}) as cl:
            for _ in range(4):
                u = urlparse(cur)
                if u.scheme not in ("http", "https") or not u.hostname or not _public_host(u.hostname):
                    return None
                with cl.stream("GET", cur) as r:
                    if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                        nxt = r.headers["location"]
                        cur = str(httpx.URL(cur).join(nxt))
                        continue
                    if r.status_code != 200:
                        return None
                    ct = (r.headers.get("content-type") or "").lower()
                    if ct and not ct.startswith("image/"):
                        return None
                    buf = bytearray()
                    for chunk in r.iter_bytes(65536):
                        buf.extend(chunk)
                        if len(buf) > MAX_IMG_BYTES:
                            return None
                    return bytes(buf)
    except Exception:
        return None
    return None


_IMG_URL_CACHE: "OrderedDict[str, str]" = OrderedDict()   # query -> tanlangan rasm manzili (faqat qisqa matn, fayl emas)


def find_image(query: str) -> Optional[bytes]:
    """Sinxron: qidiruv + yuklash. Bir mavzu uchun BIR XIL rasm: oldin tanlangan manzil eslab qolinadi,
    shuning uchun rang o'zgartirib qayta yuklaganda rasm almashib ketmaydi."""
    key = (query or "").strip().lower()
    cached = _IMG_URL_CACHE.get(key)
    if cached:
        data = download_image(cached)
        if data and cover_jpeg(data, 100, 100, scale=1.0) is not None:
            return data
    try:
        from backend.image_search import search_images
        res = search_images(query, "photo", 8) or []
    except Exception:
        return None
    tried = 0
    for r in res:
        u = (r or {}).get("url") or ""
        if not u or u.lower().split("?")[0].endswith(".gif"):
            continue
        tried += 1
        data = download_image(u)
        if data and cover_jpeg(data, 100, 100, scale=1.0) is not None:
            _IMG_URL_CACHE[key] = u
            while len(_IMG_URL_CACHE) > 800:
                _IMG_URL_CACHE.popitem(last=False)
            return data
        if tried >= 4:
            break
    return None
