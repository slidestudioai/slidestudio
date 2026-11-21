"""Gunicorn settings (Dockerfile / render.yaml: `gunicorn main:app -c backend/gunicorn_conf.py`).

v69: the number of workers is picked from the REAL limits of the container (RAM and CPU), not a fixed 4.
Each worker is a full copy of the app: ~85 MB right after start, ~150-200 MB under load (image proxy cache,
PPTX/PDF building, the Telegram bot's images in the bot worker). Four workers on a 512 MB instance (Render free /
starter) could run out of memory under an ad campaign and the platform restarts the whole service.

    workers = min( (RAM - reserve) / WORKER_RAM_MB ,  2 x CPU ,  8 ),  at least 1
    512 MB -> 2 workers,  1 GB -> 5 (if 3+ CPU),  2 GB / 1 CPU -> 2,  4 GB / 2 CPU -> 4

Override with WEB_CONCURRENCY (exact number) or WORKER_RAM_MB (budget per worker).
"""
import math
import os


def _read(path: str) -> str:
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return ""


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def memory_limit_mb() -> int:
    """Container memory limit (cgroup v2 / v1), else the machine's RAM."""
    v2 = _read("/sys/fs/cgroup/memory.max")
    if v2 and v2 != "max" and v2.isdigit():
        return int(v2) // (1024 * 1024)
    v1 = _read("/sys/fs/cgroup/memory/memory.limit_in_bytes")
    if v1.isdigit() and int(v1) < (1 << 60):          # "unlimited" is a huge number
        return int(v1) // (1024 * 1024)
    for line in _read("/proc/meminfo").splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) // 1024
    return 512


def cpu_limit() -> float:
    """Container CPU quota (cgroup v2 / v1), else the number of CPUs this process may use."""
    v2 = _read("/sys/fs/cgroup/cpu.max").split()
    if len(v2) == 2 and v2[0] != "max":
        try:
            return max(0.1, int(v2[0]) / int(v2[1]))
        except (ValueError, ZeroDivisionError):
            pass
    q, p = _read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"), _read("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
    if q.lstrip("-").isdigit() and p.isdigit() and int(q) > 0 and int(p) > 0:
        return max(0.1, int(q) / int(p))
    try:
        return float(len(os.sched_getaffinity(0)))
    except (AttributeError, OSError):
        return float(os.cpu_count() or 1)


def pick_workers(mem_mb: int, cpus: float, per_worker_mb: int = 170, reserve_mb: int = 80, cap: int = 8) -> int:
    by_mem = (mem_mb - reserve_mb) // max(50, per_worker_mb)
    by_cpu = max(1, math.ceil(cpus) * 2)
    return int(max(1, min(by_mem, by_cpu, cap)))


_MEM, _CPU = memory_limit_mb(), cpu_limit()
_forced = _int_env("WEB_CONCURRENCY", 0)
workers = _forced if _forced > 0 else pick_workers(_MEM, _CPU, _int_env("WORKER_RAM_MB", 170))

worker_class = "backend.worker.SlideStudioWorker"
worker_connections = 1000
bind = f"0.0.0.0:{os.environ.get('PORT', '8080')}"
keepalive = 5
timeout = 120
graceful_timeout = 30
loglevel = os.environ.get("GUNICORN_LOG_LEVEL", "warning")
accesslog = "-"


def on_starting(server):          # one line in the deploy log: what was detected and chosen
    print(f"[GUNICORN] RAM limit {_MEM} MB, CPU {_CPU:g} -> {workers} worker(s)"
          + (" (WEB_CONCURRENCY)" if _forced > 0 else ""), flush=True)
