"""v80: PPTX / PDF / HTML eksporti server kuchiga MOSLASHADI.

Muammo (o'lchangan): bot fayllarni ``asyncio.to_thread`` da yasardi. python-pptx / reportlab — sof Python, GIL
tufayli 4 yadroli serverda ham 4 ta parallel eksport 1 tasidan ~5 barobar sekin edi (amalda bitta yadro).
Parallel eksportlar soni esa qat'iy 3 edi (TG_EXPORT_PARALLEL) — kuchsiz serverda ko'p (RAM), kuchlida kam.

Endi (gunicorn_conf.py bilan bir xil o'lchov — konteynerning HAQIQIY RAM / CPU chegarasi):
  * RAM yetarli va CPU >= 2 bo'lsa — alohida JARAYONLAR havzasi (ProcessPoolExecutor, «spawn»): har yadro ishlaydi;
  * kuchsiz serverda (1 CPU yoki RAM kam) — avvalgidek oqim (thread), jarayon ochilmaydi (RAM tejaladi);
  * bir vaqtdagi eksportlar soni (semafor) ham RAM'dan hisoblanadi.
Qo'lda: TG_EXPORT_PROCS (0 = havzasiz), TG_EXPORT_PARALLEL (aniq son). Havza ishlamay qolsa — avtomatik oqimga qaytadi.
"""
from __future__ import annotations

import asyncio
import math
import multiprocessing as _mp
import os
import threading
from concurrent.futures import ProcessPoolExecutor
from typing import Any, Dict, Optional, Tuple

PROC_RAM_MB = 140          # bitta eksport jarayoni: python-pptx + reportlab + Pillow + bitta taqdimot rasmlari
EXPORT_RAM_MB = 60         # bitta eksport (oqimda) vaqtinchalik xotirasi


def _int_env(name: str, default: int) -> int:
    try:
        v = os.environ.get(name, "")
        return int(v) if str(v).strip() != "" else default
    except (TypeError, ValueError):
        return default


def plan(mem_mb: Optional[int] = None, cpus: Optional[float] = None, web_workers: Optional[int] = None) -> Dict[str, int]:
    """{'procs': jarayonlar soni (0 = oqim), 'parallel': bir vaqtdagi eksportlar}. Sof funksiya (test qilinadi)."""
    from backend import gunicorn_conf as g
    mem = int(mem_mb if mem_mb is not None else g.memory_limit_mb())
    cpu = float(cpus if cpus is not None else g.cpu_limit())
    ww = int(web_workers if web_workers is not None else g.workers)
    free = max(0, mem - ww * 170 - 80)                 # gunicorn worker'lari va zaxiradan keyin qolgan RAM
    procs = min(math.ceil(cpu), free // PROC_RAM_MB, 6) if cpu >= 2 else 0
    procs = _int_env("TG_EXPORT_PROCS", int(procs))
    procs = max(0, min(16, procs))
    if procs < 2:                                      # 1 ta jarayon foyda bermaydi (oqim + IPC'dan sekinroq)
        procs = 0
    parallel = procs * 2 if procs else max(1, min(4, free // EXPORT_RAM_MB or 1))
    parallel = max(1, min(32, _int_env("TG_EXPORT_PARALLEL", int(parallel))))
    return {"procs": int(procs), "parallel": int(parallel), "mem_mb": mem, "cpus": cpu}


_PLAN: Dict[str, int] = {}
# Jarayonlar FAQAT enable() chaqirilgan worker'da ochiladi — bot ishlaydigan yetakchi worker (telegram_bot._start_as_leader).
# Qolgan gunicorn worker'lari (kamdan-kam: Mini App'ning «deck-file» so'rovi) oqimda yasaydi — RAM byudjeti bitta havza
# uchun hisoblangan (8 worker x 4 jarayon = 32 jarayon bo'lib ketmasin).
_ENABLED = {"on": False}


def enable() -> None:
    _ENABLED["on"] = True
    p = current_plan()
    print(f"[EXPORT] RAM {p.get('mem_mb')} MB, CPU {p.get('cpus')} -> "
          f"{p['procs'] or 'oqim'} jarayon, bir vaqtda {p['parallel']} eksport (bot worker'i)", flush=True)
_POOL: Optional[ProcessPoolExecutor] = None
_POOL_LOCK = threading.Lock()
_POOL_BROKEN = False


def current_plan(quiet: bool = True) -> Dict[str, int]:
    if not _PLAN:
        try:
            _PLAN.update(plan())
        except Exception:
            _PLAN.update({"procs": 0, "parallel": max(1, _int_env("TG_EXPORT_PARALLEL", 3)), "mem_mb": 0, "cpus": 1})
    return _PLAN


def _pool() -> Optional[ProcessPoolExecutor]:
    global _POOL
    if _POOL_BROKEN or not _ENABLED["on"]:
        return None
    n = current_plan()["procs"]
    if n < 2:
        return None
    with _POOL_LOCK:
        if _POOL is None:
            # «spawn»: gunicorn worker (oqimlar + asyncio) ichidan fork xavfli; spawn toza jarayon ochadi
            _POOL = ProcessPoolExecutor(max_workers=n, mp_context=_mp.get_context("spawn"))
        return _POOL


def _child_export(deck: dict, images: Optional[Dict[int, bytes]], fmt: str, lang: str) -> Tuple[str, bytes, str, Optional[bytes]]:
    """Alohida jarayonda: fayl (+ HTML bo'lsa ichidagi PPTX ham — ota keshiga)."""
    from backend import tg_decks as d
    scenes = d.build_scenes(deck, images, lang)
    title = deck.get("title") or "Taqdimot"
    pptx = None
    if fmt == "pptx":
        data = d.render_pptx(scenes, title)
    elif fmt == "pdf":
        data = d.render_pdf(scenes, title)
    else:
        pptx = d.render_pptx(scenes, title)
        data = d.render_html(scenes, title, lang, pptx)
    return d.safe_filename(title, fmt), data, d.MIME[fmt], pptx


class _NoMainReimport:
    """«spawn» yangi jarayonda __main__ faylini QAYTA IMPORT qiladi (`python main.py` da — butun server: Supabase,
    bot, sozlamalar). Jarayon ochilayotgan lahzada __main__ yashiriladi: bola faqat tg_decks'ni yuklaydi (tez, yengil).
    pool.submit() sinxron — jarayon aynan shu blok ichida ochiladi."""
    def __enter__(self):
        import sys
        self.m = sys.modules.get("__main__")
        self.saved = {}
        if self.m is None:
            return self
        if hasattr(self.m, "__file__"):
            self.saved["__file__"] = self.m.__file__
            try:
                del self.m.__file__
            except Exception:
                pass
        self.saved["__spec__"] = getattr(self.m, "__spec__", None)
        try:
            self.m.__spec__ = None                     # multiprocessing getattr(main.__spec__) qiladi — o'chirilmaydi, None
        except Exception:
            pass
        return self

    def __exit__(self, *a):
        for k, v in self.saved.items():
            try:
                setattr(self.m, k, v)
            except Exception:
                pass
        return False


async def export(deck: dict, images: Optional[Dict[int, bytes]], fmt: str, lang: str = "uz") -> Tuple[str, bytes, str]:
    """Keshda bo'lsa — darhol; aks holda havzada (bo'lsa) yoki oqimda yasaydi va keshga qo'yadi."""
    from backend import tg_decks as d
    hit = d.cache_peek(deck, lang, fmt)
    if hit:
        return hit
    pool = _pool()
    if pool is not None:
        try:
            with _NoMainReimport():
                fut = pool.submit(_child_export, deck, images, fmt, lang)
            name, data, mime, pptx = await asyncio.wrap_future(fut)
            d.cache_store(deck, images, lang, fmt, data, pptx)
            return name, data, mime
        except Exception as e:              # havza buzildi (masalan, RAM tugab jarayon o'ldi) — oqimga qaytamiz
            _mark_broken(e)
    return await asyncio.to_thread(d.export_cached, deck, images, fmt, lang)


def _mark_broken(e: Exception) -> None:
    global _POOL_BROKEN, _POOL
    _POOL_BROKEN = True
    print(f"[EXPORT] jarayonlar havzasi o'chirildi, oqimga o'tildi: {type(e).__name__}: {str(e)[:120]}", flush=True)
    try:
        if _POOL is not None:
            _POOL.shutdown(wait=False, cancel_futures=True)
    except Exception:
        pass
    _POOL = None


def shutdown() -> None:
    global _POOL
    with _POOL_LOCK:
        if _POOL is not None:
            _POOL.shutdown(wait=False, cancel_futures=True)
            _POOL = None
