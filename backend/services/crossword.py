"""v78: crossword layout — an exact Python port of the website's algorithm (js/56_crossword.js, sections 1-2).

Same word cleaning (Oʻ / Gʻ = one cell), same deterministic order (FNV-1a hash seed + xorshift32 shuffles, 61
attempts), same scoring and the same numbering (left-to-right, top-to-bottom). So the same word list gives the SAME
grid, the same numbers and the same "Across / Down" lists in the bot's PPTX / PDF / HTML as in the site editor.

Pure functions, no I/O — tests/test_v78_shared_pipeline.py checks it against known site results.
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional

MAX_WORDS, MIN_LEN, MAX_LEN = 14, 2, 15
_M32 = 0xFFFFFFFF
_APOS_RE = re.compile(r"[ʻʼ‘’`´']")
_LETTER_RE = re.compile(r"[A-ZА-ЯЁЎҚҒҲÀ-ÖØ-ÞĀ-ž]")
_CLUE_NUM_RE = re.compile(r"^\s*\d{1,2}\s*[.)\-:–]\s*")


# ------------------------------------------------------------------ 1) letters (Oʻ / Gʻ = one cell)
def tokens(word: Any) -> List[str]:
    s = _APOS_RE.sub("'", str("" if word is None else word).upper())
    out: List[str] = []
    i = 0
    while i < len(s):
        c = s[i]
        if c in ("O", "G") and i + 1 < len(s) and s[i + 1] == "'":
            out.append(c + "‘")
            i += 2
            continue
        if _LETTER_RE.match(c):
            out.append(c)
        i += 1
    return out


def clean_words(words: Any) -> List[dict]:
    seen, out = set(), []
    for w in (words if isinstance(words, list) else []):
        if not w:
            continue
        if isinstance(w, str):
            ans, clue = w, ""
        elif isinstance(w, dict):
            ans = w.get("answer") or w.get("word") or w.get("a") or ""
            clue = w.get("clue") or w.get("question") or w.get("q") or ""
        else:
            continue
        clue = _CLUE_NUM_RE.sub("", str(clue))
        t = tokens(ans)
        if len(t) < MIN_LEN or len(t) > MAX_LEN:
            continue
        key = "".join(t)
        if key in seen:
            continue
        seen.add(key)
        out.append({"answer": str(ans).strip(), "clue": str(clue).strip(), "t": t})
    return out[:MAX_WORDS]


# ------------------------------------------------------------------ 2) placement
def _hash(s: str) -> int:
    """FNV-1a over UTF-16 code units — identical to the JS charCodeAt loop with Math.imul."""
    h = 2166136261
    data = s.encode("utf-16-le")
    for k in range(0, len(data), 2):
        h ^= data[k] | (data[k + 1] << 8)
        h = (h * 16777619) & _M32
    return h


def _prng(seed: int):
    state = [(seed & _M32) or 1]

    def rnd() -> float:
        x = state[0]
        x = (x ^ (x << 13)) & _M32
        x ^= x >> 17
        x = (x ^ (x << 5)) & _M32
        state[0] = x
        return x / 4294967296.0
    return rnd


def _attempt(items: List[dict]) -> dict:
    G: Dict[tuple, dict] = {}
    placed: List[dict] = []
    unplaced: List[dict] = []

    def can_place(t, r, c, d) -> int:
        dr, dc = (1, 0) if d == "down" else (0, 1)
        cross = 0
        if (r - dr, c - dc) in G or (r + dr * len(t), c + dc * len(t)) in G:
            return -1
        for k in range(len(t)):
            rr, cc = r + dr * k, c + dc * k
            cell = G.get((rr, cc))
            if cell:
                if cell["ch"] != t[k] or (cell["a"] if d == "across" else cell["d"]):
                    return -1
                cross += 1
            elif (rr + dc, cc + dr) in G or (rr - dc, cc - dr) in G:
                return -1
        return cross

    def put(w, r, c, d) -> None:
        dr, dc = (1, 0) if d == "down" else (0, 1)
        for k in range(len(w["t"])):
            key = (r + dr * k, c + dc * k)
            cell = G.get(key)
            if cell is None:
                cell = G[key] = {"ch": w["t"][k], "a": False, "d": False}
            cell["a" if d == "across" else "d"] = True
        placed.append({"answer": w["answer"], "clue": w["clue"], "t": w["t"], "row": r, "col": c, "dir": d})

    def bbox():
        rs = [k[0] for k in G]
        cs = [k[1] for k in G]
        return min(rs), max(rs), min(cs), max(cs)

    for idx, w in enumerate(items):
        if idx == 0:
            put(w, 0, 0, "across")
            continue
        best = None
        r0, r1b, c0, c1b = bbox()
        for p in placed:
            for i in range(len(p["t"])):
                for j in range(len(w["t"])):
                    if p["t"][i] != w["t"][j]:
                        continue
                    d = "down" if p["dir"] == "across" else "across"
                    pr = p["row"] + (i if p["dir"] == "down" else 0)
                    pc = p["col"] + (i if p["dir"] == "across" else 0)
                    r = pr - j if d == "down" else pr
                    c = pc - j if d == "across" else pc
                    cross = can_place(w["t"], r, c, d)
                    if cross < 1:
                        continue
                    r1 = r + len(w["t"]) - 1 if d == "down" else r
                    c1 = c + len(w["t"]) - 1 if d == "across" else c
                    h = max(r1b, r1) - min(r0, r) + 1
                    wd = max(c1b, c1) - min(c0, c) + 1
                    score = cross * 40 - h * wd * 0.6 - abs(wd / h - 1.6) * 6
                    if best is None or score > best["score"]:
                        best = {"r": r, "c": c, "dir": d, "score": score}
        if best:
            put(w, best["r"], best["c"], best["dir"])
        else:
            unplaced.append(w)
    r0, r1, c0, c1 = bbox()
    return {"placed": placed, "unplaced": unplaced, "rows": r1 - r0 + 1, "cols": c1 - c0 + 1, "r0": r0, "c0": c0, "G": G}


def layout(words: Any, aspect: float = 1.6) -> dict:
    """words -> {cells:[{r,c,ch,n}], words:[{num,dir,answer,clue,row,col,len}], rows, cols, unplaced:[...]}"""
    lst = clean_words(words)
    if not lst:
        return {"cells": [], "words": [], "rows": 0, "cols": 0, "unplaced": []}
    aspect = aspect or 1.6
    lst.sort(key=lambda w: (-len(w["t"]), "".join(w["t"])))
    rand = _prng(_hash("|".join("".join(w["t"]) for w in lst)))
    orders = [sorted(lst, key=lambda w: -len(w["t"]))]
    for _ in range(60):
        o = list(lst)
        for k in range(len(o) - 1, 0, -1):
            j = int(math.floor(rand() * (k + 1)))
            o[k], o[j] = o[j], o[k]
        orders.append(o)
    best = None
    for o in orders:
        a = _attempt(o)
        ratio = a["cols"] / max(1, a["rows"])
        score = len(a["placed"]) * 1000 - a["rows"] * a["cols"] - abs(math.log(ratio / aspect)) * 40
        if best is None or score > best["score"]:
            best = a
            best["score"] = score
    starts = []
    for p in best["placed"]:
        k = (p["row"] - best["r0"], p["col"] - best["c0"])
        if k not in starts:
            starts.append(k)
    starts.sort()
    num_at = {k: i + 1 for i, k in enumerate(starts)}
    cells = []
    for (r, c), v in best["G"].items():
        rr, cc = r - best["r0"], c - best["c0"]
        cells.append({"r": rr, "c": cc, "ch": v["ch"], "n": num_at.get((rr, cc), 0)})
    cells.sort(key=lambda x: (x["r"], x["c"]))
    ws = []
    for p in best["placed"]:
        r, c = p["row"] - best["r0"], p["col"] - best["c0"]
        ws.append({"num": num_at[(r, c)], "dir": p["dir"], "answer": p["answer"], "clue": p["clue"], "row": r, "col": c,
                   "len": len(p["t"])})
    ws.sort(key=lambda w: (w["num"], 0 if w["dir"] == "across" else 1))
    return {"cells": cells, "words": ws, "rows": best["rows"], "cols": best["cols"],
            "unplaced": [w["answer"] for w in best["unplaced"]]}


def labels(lang: str = "uz", across: str = "", down: str = "") -> List[str]:
    d = {"ru": ["По горизонтали", "По вертикали"], "en": ["Across", "Down"]}.get(lang, ["Eniga", "Bo'yiga"])
    return [across or d[0], down or d[1]]


def normalize(raw: Any) -> Optional[List[dict]]:
    """AI words -> [{answer, clue}] (at least 2 usable words, else None)."""
    ws = clean_words(raw)
    if len(ws) < 2:
        return None
    return [{"answer": w["answer"][:30], "clue": w["clue"][:160]} for w in ws]
