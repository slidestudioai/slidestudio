"""Audit M4: observability — request id, JSON logs, Prometheus metrics, optional Sentry.

* Request id: a contextvar set per HTTP request (X-Request-ID in/out) and per AI turn (its request_id).
* JSON logs (LOG_FORMAT=json): the app has 400+ `print()` lines. Instead of rewriting them, stdout is wrapped so
  every printed line becomes one JSON object {ts, level, msg, request_id, pid}. Level is guessed from the text
  (❌/xato/error -> error, ⚠️/warn -> warning). Library `logging` output uses the same format.
* Metrics: in-process counters/gauges in Prometheus text format (GET /metrics, needs METRICS_TOKEN).
  Under gunicorn each worker has its own numbers (label `pid`); scrape all workers or sum by job.
* Sentry: enabled only when SENTRY_DSN is set (send_default_pii=False).
"""
from __future__ import annotations

import contextvars
import io
import json
import logging
import os
import re
import sys
import threading
import time
import uuid
from typing import Callable, Dict, Optional, Tuple

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")
_RID_RE = re.compile(r"^[A-Za-z0-9_.:-]{6,80}$")


def new_request_id(incoming: Optional[str] = None) -> str:
    rid = (incoming or "").strip()
    return rid if _RID_RE.match(rid) else uuid.uuid4().hex[:16]


# ---------------------------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------------------------
class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], float] = {}
        self._gauges: Dict[str, Callable[[], float]] = {}
        self._help: Dict[str, str] = {}

    def inc(self, name: str, labels: Optional[Dict[str, str]] = None, value: float = 1.0, help: str = "") -> None:
        key = (name, tuple(sorted((labels or {}).items())))
        with self._lock:
            self._counters[key] = self._counters.get(key, 0.0) + value
            if help:
                self._help.setdefault(name, help)

    def gauge(self, name: str, fn: Callable[[], float], help: str = "") -> None:
        self._gauges[name] = fn
        if help:
            self._help[name] = help

    def get(self, name: str, labels: Optional[Dict[str, str]] = None) -> float:
        return self._counters.get((name, tuple(sorted((labels or {}).items()))), 0.0)

    def render(self) -> str:
        pid = str(os.getpid())
        out, seen = [], set()
        with self._lock:
            items = sorted(self._counters.items())
        for (name, labels), v in items:
            if name not in seen:
                seen.add(name)
                if name in self._help:
                    out.append(f"# HELP {name} {self._help[name]}")
                out.append(f"# TYPE {name} counter")
            lab = ",".join([f'{k}="{_esc(val)}"' for k, val in labels] + [f'pid="{pid}"'])
            out.append(f"{name}{{{lab}}} {v:g}")
        for name, fn in sorted(self._gauges.items()):
            try:
                v = float(fn())
            except Exception:
                continue
            if name in self._help:
                out.append(f"# HELP {name} {self._help[name]}")
            out.append(f"# TYPE {name} gauge")
            out.append(f'{name}{{pid="{pid}"}} {v:g}')
        return "\n".join(out) + "\n"


def _esc(v: str) -> str:
    return str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ")


metrics = Metrics()


# ---------------------------------------------------------------------------------------------
# JSON logs
# ---------------------------------------------------------------------------------------------
_ERR_RE = re.compile(r"❌|\bxato\b|\berror\b|exception|traceback", re.I)
_WARN_RE = re.compile(r"⚠️|⚠|\bwarn", re.I)


def _level(msg: str) -> str:
    if _ERR_RE.search(msg):
        return "error"
    if _WARN_RE.search(msg):
        return "warning"
    return "info"


def json_line(msg: str, level: Optional[str] = None) -> str:
    return json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
                       "level": level or _level(msg), "msg": msg, "request_id": request_id_var.get() or None,
                       "pid": os.getpid()}, ensure_ascii=False)


class _JsonStdout(io.TextIOBase):
    """Line-buffered stdout wrapper: every complete line -> one JSON object."""

    def __init__(self, raw) -> None:
        self._raw = raw
        self._buf = ""
        self._lock = threading.Lock()

    def writable(self) -> bool:
        return True

    def write(self, s: str) -> int:
        with self._lock:
            self._buf += s
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                if line.strip():
                    if line.lstrip().startswith("{") and '"level"' in line:
                        self._raw.write(line + "\n")              # already JSON
                    else:
                        self._raw.write(json_line(line) + "\n")
            self._raw.flush()
        return len(s)

    def flush(self) -> None:
        try:
            self._raw.flush()
        except Exception:
            pass

    @property
    def encoding(self):
        return getattr(self._raw, "encoding", "utf-8")

    def isatty(self) -> bool:
        return False

    def fileno(self) -> int:
        return self._raw.fileno()


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        if record.exc_info:
            msg += "\n" + self.formatException(record.exc_info)
        return json_line(f"[{record.name}] {msg}", record.levelname.lower())


_installed = {"logs": False, "sentry": False}


def install_json_logs(force: bool = False) -> bool:
    if _installed["logs"] or (not force and os.environ.get("LOG_FORMAT", "").strip().lower() != "json"):
        return False
    if not isinstance(sys.stdout, _JsonStdout):
        sys.stdout = _JsonStdout(sys.stdout)
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(_JsonFormatter())
    root = logging.getLogger()
    root.handlers = [h]
    _installed["logs"] = True
    return True


def install_sentry() -> bool:
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn or _installed["sentry"]:
        return False
    try:
        import sentry_sdk
    except Exception:
        print("[OBS] ⚠️ SENTRY_DSN bor, lekin sentry-sdk o'rnatilmagan")
        return False
    try:
        rate = float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0") or 0)
    except ValueError:
        rate = 0.0
    sentry_sdk.init(dsn=dsn, send_default_pii=False, traces_sample_rate=max(0.0, min(1.0, rate)),
                    environment=os.environ.get("SENTRY_ENV", "production"))
    _installed["sentry"] = True
    return True


def capture(exc: BaseException) -> None:
    """Report an exception to Sentry (no-op without SENTRY_DSN)."""
    if not _installed["sentry"]:
        return
    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exc)
    except Exception:
        pass
