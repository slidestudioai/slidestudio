"""Gunicorn worker class for production (Dockerfile / render.yaml).

Audit C5: in production the app runs under gunicorn, so the WebSocket options passed to `uvicorn.run(...)`
in main.py are NOT used. The stock UvicornWorker accepts WebSocket frames up to 16 MB; one 16 MB JSON message
is parsed into ~5-10x that in Python objects, so a few hundred such messages can OOM a 512 MB instance.
The browser sends a slim deck (no base64 images), so 4 MB is plenty.
"""
import os

try:                                    # maintained package (uvicorn.workers is deprecated)
    from uvicorn_worker import UvicornWorker
except ImportError:                     # pragma: no cover
    from uvicorn.workers import UvicornWorker


def _int_env(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except (TypeError, ValueError):
        return default


class SlideStudioWorker(UvicornWorker):
    CONFIG_KWARGS = {
        **UvicornWorker.CONFIG_KWARGS,
        "ws_max_size": _int_env("WS_MAX_SIZE", 4 * 1024 * 1024),
        "ws_ping_interval": 25.0,      # detects dead mobile connections (lost internet) and frees the slot
        "ws_ping_timeout": 60.0,
        "timeout_keep_alive": 65,
    }
