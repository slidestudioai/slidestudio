"""E2E uchun server: haqiqiy main.py + SOXTA AI va SOXTA rasm qidiruvi (internet / kalit kerak emas).

AI xatti-harakati (oxirgi foydalanuvchi xabaridagi so'zlarga qarab, real DeepSeek oqimiga o'xshash):
  * «N ta slayd»            -> N ta slayd (replace_slide 1 + insert_slide ...), har birida karta va matn
  * «rasm» / «gif»          -> avval search_images tool chaqiruvlari (bir raundda bir nechta), keyin topilgan URL'lar bilan slaydlar
  * Chuqur AI (reasoner)    -> avval reasoning_content (o'ylash), tool yo'q (server oldindan qidiradi)
  * «sekin»                 -> javob sekinroq oqadi (bo'laklar orasida pauza)
Rasmlar: /e2e-img/<nom>.png (shu server o'zi chizib beradi).

Ishga tushirish:  python e2e/fake_ai_server.py   (PORT, SLIDE_STUDIO_DEV_MODE=1, SLIDE_STUDIO_DEV_TOKEN=devtok)
"""
import asyncio
import hashlib
import io
import json
import os
import re
import sys
from types import SimpleNamespace as NS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)
for _k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "AI_API_KEY", "DEEPSEEK_API_KEY"):
    os.environ.pop(_k, None)
os.environ.setdefault("SLIDE_STUDIO_DEV_MODE", "1")
os.environ.setdefault("SLIDE_STUDIO_DEV_TOKEN", "devtok")

import main  # noqa: E402
from fastapi import Response  # noqa: E402

BASE = f"http://127.0.0.1:{int(os.environ.get('PORT', '8765'))}"
main.config["api_key"] = "fake-key"
CALLS = {"search": [], "ai": 0}


def _img_url(q: str, kind: str = "photo") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", q.lower()).strip("-") or "x"
    return f"{BASE}/e2e-img/{slug}.{'gif' if kind == 'gif' else 'png'}"


def fake_search(q, kind="photo", n=12):
    CALLS["search"].append((q, kind))
    if "yoq" in q.lower() or q.lower() == "narsa":   # «yoq narsa» va uning soddaroq varianti — hech narsa topilmaydi (qayta urinish sinovi)
        return []
    return [{"url": _img_url(f"{q} {i}", kind), "thumb": _img_url(f"{q} {i}", kind), "title": q} for i in range(min(n, 3))]


main._search_images_sync = fake_search


@main.app.get("/e2e-img/{name}")
def e2e_img(name: str):
    from PIL import Image
    h = hashlib.md5(name.encode()).digest()
    color = (h[0], h[1], h[2])
    buf = io.BytesIO()
    if name.endswith(".gif"):
        fr = [Image.new("RGB", (320, 200), color), Image.new("RGB", (320, 200), (255 - color[0], color[1], 255 - color[2]))]
        fr[0].save(buf, "GIF", save_all=True, append_images=fr[1:], duration=300, loop=0)
        return Response(buf.getvalue(), media_type="image/gif", headers={"Access-Control-Allow-Origin": "*"})
    Image.new("RGB", (640, 400), color).save(buf, "PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Access-Control-Allow-Origin": "*"})


@main.app.get("/e2e-calls")
def e2e_calls():
    return {"search": CALLS["search"], "ai": CALLS["ai"]}


# ------------------------------------------------------------------------------------------------ soxta AI
def _chunk(content=None, reasoning=None, tool_calls=None, finish=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=reasoning, tool_calls=tool_calls))],
              usage=None)


def _usage():
    return NS(choices=[], usage=NS(prompt_tokens=1000, completion_tokens=500, total_tokens=1500))


class _Stream:
    def __init__(self, items, delay):
        self.items, self.delay = items, delay

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for it in self.items:
            await asyncio.sleep(self.delay)
            yield it


def _last_user(messages):
    """Foydalanuvchining haqiqiy so'rovi (server qo'shadigan «Qidiruv yakunlandi…» xizmat xabarlari emas)."""
    for m in reversed(messages):
        c = str(m.get("content") or "")
        if m.get("role") == "user" and not c.startswith(("Qidiruv yakunlandi", "Tool mavjud emas", "Bu so'rovlar bo'yicha rasm TOPILMADI")):
            return c.split("\n\n[TAYYOR")[0]
    return ""


def _n_slides(text):
    m = re.search(r"(\d{1,2})\s*ta\s*(?:slayd|varaq)", text, re.I)
    return max(1, min(12, int(m.group(1)))) if m else 3


def _n_images(text):
    m = re.search(r"(\d{1,2})\s*ta\s*(?:rasm|gif)", text, re.I)
    return max(1, min(10, int(m.group(1)))) if m else 3


def _found_urls(messages):
    urls = []
    for m in messages:
        if m.get("role") == "tool":
            try:
                for r in json.loads(m.get("content") or "{}").get("results") or []:
                    if r.get("url"):
                        urls.append(r["url"])
            except Exception:
                pass
        if m.get("role") == "user" and "TAYYOR" in str(m.get("content") or ""):
            urls += re.findall(r"https?://\S+", str(m.get("content")))
    return urls


def _slide(i, title, urls, gif=False):
    els = [
        {"type": "rect", "left": 40, "top": 40, "width": 880, "height": 460, "fill": "#F1F5F9", "rx": 16, "ry": 16},
        {"type": "text", "text": title, "left": 72, "top": 64, "width": 520, "height": 52, "fontSize": 40, "fontWeight": "bold", "fill": "#0F172A"},
        {"type": "text", "text": f"{i}-slayd matni: muhim fikr.", "left": 72, "top": 140, "width": 460, "height": 60, "fontSize": 20, "fill": "#334155"},
    ]
    if urls:
        u = urls[(i - 1) % len(urls)]
        if gif or u.endswith(".gif"):
            els.append({"type": "gif", "gifUrl": u, "src": u, "left": 600, "top": 120, "width": 280, "height": 180})
        else:
            els.append({"type": "image", "src": u, "left": 600, "top": 120, "width": 280, "height": 180})
    return {"background": "#FFFFFF", "elements": els}


def _reply_actions(prompt, urls):
    n = _n_slides(prompt)
    gif = "gif" in prompt.lower()
    acts = [{"action": "replace_slide", "slide": 1, **_slide(1, "Sarlavha 1", urls, gif)}]
    for i in range(2, n + 1):
        acts.append({"action": "insert_slide", "after": i - 1, **_slide(i, f"Sarlavha {i}", urls, gif)})
    return acts


def _text_stream(text, piece=18):
    return [_chunk(content=text[i:i + piece]) for i in range(0, len(text), piece)]


class _Completions:
    async def create(self, **kw):
        CALLS["ai"] += 1
        msgs = kw.get("messages") or []
        prompt = _last_user(msgs)
        if kw.get("response_format"):            # Chuqur AI oldindan qidiruvi uchun so'rovlar
            k = _n_images(prompt)
            qs = [f"topic photo {i}" for i in range(1, k + 1)]
            return NS(choices=[NS(message=NS(content=json.dumps({"queries": qs})))])
        delay = 0.12 if "sekin" in prompt.lower() else 0.01
        items = []
        if kw.get("model") == "deepseek-reasoner":
            items += [_chunk(reasoning="O'ylayapman... ") for _ in range(6)]
        wants_media = bool(re.search(r"rasm|gif|surat", prompt, re.I))
        had_tools = any(m.get("role") == "tool" for m in msgs)
        if kw.get("tools") and wants_media and not had_tools:
            k = _n_images(prompt)
            kind = "gif" if "gif" in prompt.lower() else "photo"
            items += _text_stream("Rasmlarni qidiryapman. ")
            q_words = ["yoq narsa" if ("topilmas" in prompt.lower() and i == 1) else f"subject {i}" for i in range(1, k + 1)]
            calls = [NS(index=i, id=f"call_{i}", function=NS(name="search_images", arguments=json.dumps({"query": q, "kind": kind})))
                     for i, q in enumerate(q_words)]
            items.append(_chunk(tool_calls=calls))
            items.append(_chunk(finish="tool_calls"))
            items.append(_usage())
            return _Stream(items, delay)
        last = str((msgs[-1] if msgs else {}).get("content") or "")
        if kw.get("tools") and last.startswith("Bu so'rovlar bo'yicha rasm TOPILMADI"):   # AI topilmagan rasmni boshqa so'z bilan qayta qidiradi
            calls = [NS(index=0, id="call_r", function=NS(name="search_images", arguments=json.dumps({"query": "subject retry"})))]
            return _Stream([_chunk(tool_calls=calls), _chunk(finish="tool_calls"), _usage()], delay)
        urls = _found_urls(msgs)
        body = "Tayyor! Slaydlar yaratildi.\n```json\n" + json.dumps({"actions": _reply_actions(prompt, urls)}, ensure_ascii=False) + "\n```"
        items += _text_stream(body, 40)
        items.append(_chunk(finish="stop"))
        items.append(_usage())
        return _Stream(items, delay)


main._deepseek_client = lambda *a, **k: NS(chat=NS(completions=_Completions()))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(main.app, host="127.0.0.1", port=int(os.environ.get("PORT", "8765")), log_level="warning")
