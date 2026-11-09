"""
PDF -> tahrirlanadigan slaydlar (fabric JSON).

Har sahifa: vektor shakllar (to'rtburchak, yumaloq to'rtburchak, ellips, ixtiyoriy chiziq/egri), rasmlar va MATN
alohida obyekt bo'lib chiqadi (rasmga aylantirilmaydi). Matn qatorlari bir xil shrift/rang/chap chegara bo'yicha
bitta matn blokiga birlashtiriladi. Juda murakkab sahifalar (gradient, 600+ shakl) uchun: matnsiz fon rasmi + tahrirlanadigan matn.

Fayl serverda saqlanmaydi: xotirada o'qiladi va javob qaytgach tashlab yuboriladi.
"""
from __future__ import annotations

import base64
import ctypes
import io
import re
from typing import Any, Dict, List, Optional, Tuple

FAB_VER = "5.3.1"
MAX_PAGES = 60
MAX_OBJS = 600
TW, TH = 960.0, 540.0

_SITE_FONTS = {"roboto": "Roboto", "montserrat": "Montserrat", "georgia": "Georgia", "impact": "Impact",
               "caveat": "Caveat", "pacifico": "Pacifico", "couri": "Courier New", "times": "Times New Roman",
               "liberation serif": "Times New Roman", "mono": "Courier New"}


def _pdfium():
    import pypdfium2 as pdfium
    import pypdfium2.raw as raw
    return pdfium, raw


def _rgba(c: Tuple[int, int, int, int]) -> str:
    r, g, b, a = c
    if a >= 250:
        return "#%02x%02x%02x" % (r, g, b)
    return "rgba(%d,%d,%d,%.2f)" % (r, g, b, a / 255.0)


def _fill_color(raw, obj) -> Tuple[int, int, int, int]:
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    raw.FPDFPageObj_GetFillColor(obj.raw, r, g, b, a)
    return r.value, g.value, b.value, a.value


def _stroke_color(raw, obj) -> Tuple[int, int, int, int]:
    r, g, b, a = ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint(), ctypes.c_uint()
    raw.FPDFPageObj_GetStrokeColor(obj.raw, r, g, b, a)
    return r.value, g.value, b.value, a.value


def _font_info(raw, obj) -> Tuple[str, bool, bool]:
    """(family, bold, italic)"""
    try:
        font = raw.FPDFTextObj_GetFont(obj.raw)
        buf = (ctypes.c_char * 160)()
        raw.FPDFFont_GetBaseFontName(font, buf, 160)
        name = buf.value.decode("latin1", "ignore")
        weight = int(raw.FPDFFont_GetWeight(font) or 400)
        ang = ctypes.c_int(0)
        raw.FPDFFont_GetItalicAngle(font, ang)
    except Exception:
        return "Arial", False, False
    name = re.sub(r"^[A-Z]{6}\+", "", name)
    low = name.lower()
    bold = weight >= 600 or bool(re.search(r"bold|black|heavy|semibold|demi", low))
    italic = ang.value != 0 or bool(re.search(r"italic|oblique", low))
    fam = "Arial"
    for key, val in _SITE_FONTS.items():
        if key in low:
            fam = val
            break
    return fam, bold, italic


def _text_of(raw, obj, textpage) -> str:
    n = raw.FPDFTextObj_GetText(obj.raw, textpage.raw, None, 0)
    if not n or n <= 2:
        return ""
    buf = (ctypes.c_ushort * (n // 2 + 2))()
    raw.FPDFTextObj_GetText(obj.raw, textpage.raw, buf, n)
    return bytes(buf)[: max(0, n - 2)].decode("utf-16le", "ignore")


def _eff_matrix(obj):
    m = obj.get_matrix()
    p = getattr(obj, "parent", None)
    guard = 0
    while p is not None and guard < 8:
        try:
            m = m.multiply(p.get_matrix())
        except Exception:
            break
        p = getattr(p, "parent", None)
        guard += 1
    return m


def _segments(raw, obj) -> List[Tuple[int, float, float, bool]]:
    out = []
    n = raw.FPDFPath_CountSegments(obj.raw)
    for k in range(n):
        s = raw.FPDFPath_GetPathSegment(obj.raw, k)
        x, y = ctypes.c_float(), ctypes.c_float()
        raw.FPDFPathSegment_GetPoint(s, x, y)
        out.append((int(raw.FPDFPathSegment_GetType(s)), x.value, y.value, bool(raw.FPDFPathSegment_GetClose(s))))
    return out


class _Page:
    def __init__(self, w: float, h: float):
        self.s = min(TW / w, TH / h)
        self.ox = (TW - w * self.s) / 2.0
        self.oy = (TH - h * self.s) / 2.0
        self.h = h

    def X(self, x: float) -> float:
        return self.ox + x * self.s

    def Y(self, y: float) -> float:
        return self.oy + (self.h - y) * self.s


def _base(**kw) -> dict:
    d = {"version": FAB_VER, "originX": "left", "originY": "top", "scaleX": 1, "scaleY": 1, "angle": 0}
    d.update(kw)
    return d


def _shape_from_path(raw, obj, pg: _Page) -> Optional[dict]:
    m = _eff_matrix(obj)
    a, b, c, d, e, f = m.get()
    segs_raw = _segments(raw, obj)
    if len(segs_raw) < 2:
        return None
    fm, st = ctypes.c_int(), ctypes.c_int()
    raw.FPDFPath_GetDrawMode(obj.raw, fm, st)
    do_fill, do_stroke = fm.value != 0, bool(st.value)
    if not do_fill and not do_stroke:
        return None
    fill = _fill_color(raw, obj)
    stroke = _stroke_color(raw, obj)
    sw = ctypes.c_float(1.0)
    raw.FPDFPageObj_GetStrokeWidth(obj.raw, sw)
    scale = (abs(a) + abs(d)) / 2.0 or 1.0
    strokeW = max(0.5, sw.value * scale * pg.s) if do_stroke else 0.0

    pts = [(t, pg.X(a * x + c * y + e), pg.Y(b * x + d * y + f), cl) for (t, x, y, cl) in segs_raw]
    xs = [p[1] for p in pts]
    ys = [p[2] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = x1 - x0, y1 - y0
    common = dict(fill=_rgba(fill) if do_fill else "rgba(0,0,0,0)",
                  stroke=_rgba(stroke) if do_stroke else None, strokeWidth=strokeW)
    types = [p[0] for p in pts]
    lines, ncurve_pts = types.count(0), types.count(1)
    curves = ncurve_pts // 3
    tol = max(0.6, 0.004 * max(w, h))

    # to'rtburchak
    if curves == 0 and lines in (3, 4, 5) and types[0] == 2:
        on_edge = all((abs(p[1] - x0) < tol or abs(p[1] - x1) < tol) and (abs(p[2] - y0) < tol or abs(p[2] - y1) < tol) for p in pts)
        if on_edge and w > 0.3 and h > 0.3:
            return _base(type="rect", left=x0, top=y0, width=w, height=h, rx=0, ry=0, **common)
    # ellips (4 ta Bezier)
    if curves == 4 and lines == 0 and w > 0.3 and h > 0.3:
        return _base(type="ellipse", left=x0, top=y0, width=w, height=h, rx=w / 2, ry=h / 2, **common)
    # yumaloq to'rtburchak (4 chiziq + 4 egri)
    if curves == 4 and lines in (3, 4) and w > 0.3 and h > 0.3:
        r = 0.0
        k = 0
        while k < len(pts):
            if pts[k][0] == 1 and k >= 1 and k + 2 < len(pts):
                r = max(r, abs(pts[k + 2][1] - pts[k - 1][1]))
                k += 3
            else:
                k += 1
        r = min(r, w / 2, h / 2)
        if r > 0.5:
            return _base(type="rect", left=x0, top=y0, width=w, height=h, rx=r, ry=r, **common)
    # umumiy yo'l
    cmds: List[list] = []
    i = 0
    while i < len(pts):
        t, px, py, cl = pts[i]
        if t == 2:
            cmds.append(["M", px, py])
        elif t == 0:
            cmds.append(["L", px, py])
        elif t == 1 and i + 2 < len(pts):
            cmds.append(["C", px, py, pts[i + 1][1], pts[i + 1][2], pts[i + 2][1], pts[i + 2][2]])
            if pts[i + 2][3]:
                cmds.append(["Z"])
            i += 2
            i += 1
            continue
        if cl:
            cmds.append(["Z"])
        i += 1
    if len(cmds) < 2:
        return None
    if not do_fill and strokeW < 0.5:
        return None
    return _base(type="path", path=cmds, left=x0, top=y0, width=max(w, 0.01), height=max(h, 0.01),
                 pathOffset={"x": x0 + w / 2, "y": y0 + h / 2}, **common)


def _image_obj(obj, pg: _Page, budget: List[int]) -> Optional[dict]:
    try:
        bmp = obj.get_bitmap(render=True)
        pil = bmp.to_pil()
    except Exception:
        try:
            pil = obj.get_bitmap().to_pil()
        except Exception:
            return None
    try:
        l, bt, r, tp = obj.get_bounds()
        m = _eff_matrix(obj)
        if m is not None and getattr(obj, "level", 0):
            a, b, c, d, e, f = m.get()
            l, r = e, e + a
            bt, tp = f, f + d
        W = abs(pg.X(r) - pg.X(l))
        H = abs(pg.Y(bt) - pg.Y(tp))
        left, top = min(pg.X(l), pg.X(r)), min(pg.Y(bt), pg.Y(tp))
        from PIL import Image
        iw, ih = pil.size
        k = min(1.0, 1400.0 / max(iw, ih))
        if k < 1.0:
            pil = pil.resize((max(1, int(iw * k)), max(1, int(ih * k))), Image.LANCZOS)
            iw, ih = pil.size
        has_alpha = pil.mode in ("RGBA", "LA") or "transparency" in pil.info
        buf = io.BytesIO()
        if has_alpha:
            pil.convert("RGBA").save(buf, "PNG", optimize=True)
            mime = "image/png"
        else:
            pil.convert("RGB").save(buf, "JPEG", quality=86)
            mime = "image/jpeg"
        data = buf.getvalue()
        budget[0] += len(data)
        if budget[0] > 18 * 1024 * 1024:
            return None
        src = "data:%s;base64,%s" % (mime, base64.b64encode(data).decode())
        return _base(type="image", left=left, top=top, width=iw, height=ih, scaleX=W / iw, scaleY=H / ih,
                     src=src, crossOrigin=None, filters=[])
    except Exception:
        return None


def _flush_group(group: List[dict], out: List[dict]) -> None:
    if not group:
        return
    g0 = group[0]
    fs = g0["fs"]
    text = "\n".join(g["text"] for g in group)
    left = min(g["left"] for g in group)
    right = max(g["left"] + g["w"] for g in group)
    align = "left"
    if len(group) > 1:
        lefts = [g["left"] for g in group]
        cents = [g["left"] + g["w"] / 2 for g in group]
        if max(lefts) - min(lefts) > 3 and max(cents) - min(cents) <= 3:
            align = "center"
        elif max(lefts) - min(lefts) > 3 and abs((right - max(g["left"] + g["w"] for g in group))) < 0.1:
            r_edges = [g["left"] + g["w"] for g in group]
            if max(r_edges) - min(r_edges) <= 3:
                align = "right"
    pitch = (group[-1]["base"] - g0["base"]) / (len(group) - 1) if len(group) > 1 else fs * 1.2
    line_h = max(0.8, min(2.4, pitch / (fs * 1.13)))
    top = g0["base"] - 0.879 * fs - (line_h - 1.0) * 0.0
    width = (right - left) * 1.1 + 8
    if align == "center":
        left = (left + right) / 2 - width / 2
    elif align == "right":
        left = right - width + 4
    out.append(_base(type="textbox", left=left, top=top, width=width, text=text, fontSize=round(fs, 1),
                     fontFamily=g0["fam"], fill=g0["color"], fontWeight="bold" if g0["bold"] else "normal",
                     fontStyle="italic" if g0["italic"] else "normal", textAlign=align, lineHeight=round(line_h, 3),
                     splitByGrapheme=False, height=fs * 1.13 * line_h * len(group)))


def _convert_page(pdf, page, pg_index: int, budget: List[int]) -> Tuple[dict, dict]:
    pdfium, raw = _pdfium()
    w, h = page.get_size()
    pg = _Page(w, h)
    textpage = page.get_textpage()
    objs = list(page.get_objects(max_depth=6))
    n_paths = sum(1 for o in objs if o.type == raw.FPDF_PAGEOBJ_PATH)
    n_shade = sum(1 for o in objs if o.type == raw.FPDF_PAGEOBJ_SHADING)
    stats = {"fallback": False, "objects": len(objs)}
    out: List[dict] = []
    bg = "#ffffff"
    bg_image = None

    complex_page = n_shade > 0 or n_paths > MAX_OBJS
    if complex_page:
        stats["fallback"] = True
        try:                                       # matnsiz fon rasmi: matn obyektlarini olib tashlab chizamiz
            for o in objs:
                if o.type == raw.FPDF_PAGEOBJ_TEXT:
                    try:
                        page.remove_obj(o)
                    except Exception:
                        pass
            try:
                page.gen_content()
            except Exception:
                pass
            sc = min(2.0, 1600.0 / max(w, h))
            pil = page.render(scale=sc).to_pil().convert("RGB")
            buf = io.BytesIO()
            pil.save(buf, "JPEG", quality=88)
            budget[0] += len(buf.getvalue())
            bg_image = {"type": "image", "version": FAB_VER, "left": pg.ox, "top": pg.oy, "originX": "left", "originY": "top",
                        "scaleX": (w * pg.s) / pil.width, "scaleY": (h * pg.s) / pil.height,
                        "src": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}
        except Exception:
            bg_image = None
        # matn obyektlari o'chirilgan bo'lishi mumkin — matnni qayta ochamiz
        pdf_page = pdf[pg_index]
        page = pdf_page
        textpage = page.get_textpage()
        objs = [o for o in page.get_objects(max_depth=6) if o.type == raw.FPDF_PAGEOBJ_TEXT]

    texts: List[dict] = []
    group: List[dict] = []
    for idx, o in enumerate(objs):
        t = o.type
        try:
            if t == raw.FPDF_PAGEOBJ_PATH and not complex_page:
                sh = _shape_from_path(raw, o, pg)
                if not sh:
                    continue
                if (not out and sh["type"] == "rect" and sh["width"] >= TW * 0.98 * (w * pg.s / TW) and sh["height"] >= h * pg.s * 0.98
                        and not sh.get("stroke") and isinstance(sh["fill"], str) and sh["fill"].startswith("#")):
                    bg = sh["fill"]
                    continue
                _flush_group(group, out)
                group = []
                out.append(sh)
            elif t == raw.FPDF_PAGEOBJ_IMAGE and not complex_page:
                _flush_group(group, out)
                group = []
                im = _image_obj(o, pg, budget)
                if im:
                    out.append(im)
            elif t == raw.FPDF_PAGEOBJ_TEXT:
                txt = _text_of(raw, o, textpage).replace("\r", "").replace("\n", " ")
                if not txt.strip():
                    continue
                fs_ptr = ctypes.c_float(0)
                raw.FPDFTextObj_GetFontSize(o.raw, fs_ptr)
                m = _eff_matrix(o)
                a, b, c, d, e, f = m.get()
                mscale = (abs(d) + abs(a)) / 2.0 or 1.0
                fs = max(4.0, (fs_ptr.value or 12.0) * mscale * pg.s)
                l, bt, r, tp = o.get_bounds()
                base = pg.Y(f)
                left = pg.X(l)
                wid = max(4.0, (r - l) * pg.s)
                fam, bold, italic = _font_info(raw, o)
                col = _fill_color(raw, o)
                rec = {"text": txt.strip("\u0000"), "left": left, "w": wid, "base": base, "fs": fs, "fam": fam,
                       "bold": bold, "italic": italic, "color": _rgba(col)}
                if group:
                    g = group[-1]
                    gap = base - g["base"]
                    same = (abs(g["fs"] - fs) <= max(0.6, fs * 0.06) and g["fam"] == fam and g["bold"] == bold
                            and g["color"] == rec["color"] and 0.9 * fs <= gap <= 2.1 * fs)
                    near = abs(g["left"] - left) <= 3.0 or abs((g["left"] + g["w"] / 2) - (left + wid / 2)) <= 3.0 \
                        or abs((g["left"] + g["w"]) - (left + wid)) <= 3.0
                    if same and near:
                        group.append(rec)
                        continue
                    _flush_group(group, out)
                group = [rec]
        except Exception:
            continue
        if len(out) > MAX_OBJS + 200:
            break
    _flush_group(group, out)
    # matn har doim eng ustida bo'lishi uchun: (stream tartibi saqlanadi, lekin fon rasmi ostida)
    fab = {"version": FAB_VER, "objects": out, "background": bg}
    if bg_image:
        fab["backgroundImage"] = bg_image
    return fab, stats


def convert(data: bytes) -> Dict[str, Any]:
    pdfium, _raw = _pdfium()
    pdf = pdfium.PdfDocument(data)
    n = min(len(pdf), MAX_PAGES)
    slides: List[dict] = []
    budget = [0]
    fallback = 0
    title = ""
    try:
        meta = pdf.get_metadata_dict()
        title = (meta.get("Title") or "").strip()
    except Exception:
        pass
    for i in range(n):
        page = pdf[i]
        try:
            fab, st = _convert_page(pdf, page, i, budget)
            fallback += 1 if st.get("fallback") else 0
        except Exception:
            fab = {"version": FAB_VER, "objects": [], "background": "#ffffff"}
        slides.append({"json": fab})
    return {"slides": slides, "title": title, "pages": len(pdf), "fallback_pages": fallback}
