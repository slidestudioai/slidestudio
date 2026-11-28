"""v83: salom / rahmat / xayr / «nima qila olasan» — answered from code, no AI tokens (~0.05 ms).

The words and replies live in js/data/smalltalk.json — the SAME file the site uses (js/59_smalltalk.js), so the bot
and the site always know the same phrases. The JS copy of classify() must stay in step with this one.

classify(text) -> {"intent": "greet"|"thanks"|"bye"|"about", "lang": "uz"|"ru"|"en"} or None.
A message is small talk only if EVERY word is a known phrase, a filler («aka», «bot», «hammaga») or a near miss of a
greeting (1 letter off for 4–6 letters, 2 for longer: «slaom», «privte», «helol»). Any topic word («haqida», «slayd»,
«презентация», «about»...) or any other word -> None, so «Salom, kosmos haqida slayd» still goes to the AI.
"""
from __future__ import annotations

import json
import os
import random
import re
from typing import Any, Dict, List, Optional, Tuple

DATA_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                         "js", "data", "smalltalk.json")
MAX_WORDS = 9
_WAVE = "👋🙋🤝✋🖐"
_data: Dict[str, Any] = {}


def norm(text: str) -> str:
    """lower, ' variants -> ', no punctuation / emoji, repeated letters -> one (saloooom -> salom, hello -> helo)."""
    t = str(text or "").lower().replace("ʻ", "'").replace("’", "'").replace("‘", "'").replace("`", "'").replace("ё", "е")
    t = re.sub(r"[^\w\s']+", " ", t)
    t = re.sub(r"(\w)\1+", r"\1", t)
    return " ".join(t.replace("_", " ").split())


def _load() -> Dict[str, Any]:
    if _data:
        return _data
    with open(DATA_FILE, encoding="utf-8") as f:
        raw = json.load(f)
    phrases: Dict[str, Tuple[str, str]] = {}               # normalized phrase -> (intent, lang)
    for intent, langs in raw["intents"].items():
        for lang, items in langs.items():
            for p in items:
                k = norm(p)
                if k and k not in phrases:
                    phrases[k] = (intent, lang)
    single = {k: v for k, v in phrases.items() if " " not in k and v[0] in ("greet", "thanks", "bye") and len(k) >= 4}
    _data.update({
        "phrases": phrases, "single": single, "max_len": max(len(k.split()) for k in phrases),
        "filler": {norm(w) for w in raw["filler"]},
        "topic": [norm(w) for w in raw["topic_stems"]],
        "block": {norm(w) for w in raw["fuzzy_block"]},
        "replies": raw["replies"],
    })
    return _data


def _lev(a: str, b: str, cap: int) -> int:
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def _fuzzy(word: str, d: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    if len(word) < 4 or word in d["block"] or not word.isalpha():
        return None
    cap = 1 if len(word) <= 6 else 2
    best = None
    for k, v in d["single"].items():
        if k[0] != word[0] and len(word) <= 6:               # short words: the first letter must match (fewer false hits)
            continue
        dist = _lev(word, k, cap)
        if dist <= cap and (best is None or dist < best[0]):
            best = (dist, v)
    return best[1] if best else None


def _is_topic(words: List[str], d: Dict[str, Any]) -> bool:
    for w in words:
        for st in d["topic"]:
            if (len(st) >= 4 and w.startswith(st)) or w == st:
                return True
    return False


def classify(text: str) -> Optional[Dict[str, str]]:
    raw = str(text or "").strip()
    if not raw or len(raw) > 120:
        return None
    d = _load()
    t = norm(raw)
    if not t:
        return {"intent": "greet", "lang": ""} if any(e in raw for e in _WAVE) else None
    words = t.split()
    if len(words) > MAX_WORDS or _is_topic(words, d):
        return None
    first: Optional[Tuple[str, str]] = None
    i = 0
    while i < len(words):
        hit = None
        for n in range(min(d["max_len"], len(words) - i), 0, -1):       # the longest known phrase first
            k = " ".join(words[i:i + n])
            if k in d["phrases"]:
                hit = (n, d["phrases"][k])
                break
        if hit is None and words[i] in d["filler"]:
            i += 1
            continue
        if hit is None:
            fz = _fuzzy(words[i], d)
            if fz is None:
                return None
            hit = (1, fz)
        if first is None or (first[0] == "greet" and hit[1][0] == "about"):
            first = hit[1]                                   # «salom, nima qila olasan?» -> about
        i += hit[0]
    if first is None:
        return None
    return {"intent": first[0], "lang": first[1]}


def reply(key: str, lang: str, name: str = "", avoid: Optional[str] = None) -> str:
    """A random reply for key (greet1/greet2/greet3/thanks/bye/about) in lang; never the same as `avoid` if possible."""
    d = _load()
    opts = d["replies"].get(key, {})
    items = opts.get(lang) or opts.get("uz") or [""]
    pool = [x for x in items if x != avoid] or items
    return random.choice(pool).replace("{name}", (", " + name) if name else "")


def greet_level(count: int) -> str:
    return "greet1" if count <= 1 else ("greet2" if count == 2 else "greet3")


def guide_text(lang: str, deep_min: Any = 10, html: bool = True) -> str:
    """«ℹ️ Bot haqida» / «ℹ️ Yordam / Imkoniyatlar»: features, 3-day storage rule and a short how-to (same as the site)."""
    g = _load_raw().get("guide", {})
    t = g.get(lang) or g.get("uz") or {}
    b = (lambda s: f"<b>{s}</b>") if html else (lambda s: s)
    esc = (lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")) if html else (lambda s: s)
    parts = [b(esc(t.get("title", ""))), "",
             b(esc(t.get("features_title", ""))), *["• " + esc(x) for x in t.get("features", [])], "",
             b(esc(t.get("storage_title", ""))), esc(t.get("storage", "")), "",
             b(esc(t.get("howto_title", ""))), *[f"{i}. " + esc(x) for i, x in enumerate(t.get("howto", []), 1)], "",
             esc(str(t.get("modes", "")).replace("{deep_min}", str(deep_min)))]
    return "\n".join(parts).strip()


_raw: Dict[str, Any] = {}


def _load_raw() -> Dict[str, Any]:
    if not _raw:
        with open(DATA_FILE, encoding="utf-8") as f:
            _raw.update(json.load(f))
    return _raw
