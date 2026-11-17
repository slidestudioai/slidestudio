"""Audit M4: request id, JSON logs, metrics, Sentry."""
import io
import json
import sys
import types

import pytest

import main  # noqa: F401
from backend.services import obs

pytestmark = pytest.mark.timeout(60)


def test_metrics_hidden_without_token(client, monkeypatch):
    monkeypatch.delenv("METRICS_TOKEN", raising=False)
    assert client.get("/metrics").status_code == 404
    monkeypatch.setenv("METRICS_TOKEN", "s3cret")
    assert client.get("/metrics", headers={"Authorization": "Bearer nope"}).status_code == 404


def test_metrics_with_token(client, monkeypatch):
    monkeypatch.setenv("METRICS_TOKEN", "s3cret")
    client.get("/healthz")
    r = client.get("/metrics", headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200
    body = r.text
    for name in ("http_requests_total", "ws_connections", "ai_queue_waiting", "ai_slots_free", "charges_pending"):
        assert name in body
    assert 'pid="' in body


def test_request_id_header(client):
    r = client.get("/healthz", headers={"X-Request-ID": "abc-123456"})
    assert r.headers["X-Request-ID"] == "abc-123456"
    r = client.get("/healthz", headers={"X-Request-ID": "bad id <script>"})
    assert r.headers["X-Request-ID"] != "bad id <script>" and len(r.headers["X-Request-ID"]) == 16


def test_json_stdout_bridge():
    raw = io.StringIO()
    w = obs._JsonStdout(raw)
    tok = obs.request_id_var.set("req-777777")
    try:
        w.write("[CHARGE] ❌ navbat to'la\n[AI] ⚠️ sekin\nhello")
        w.write(" world\n")
    finally:
        obs.request_id_var.reset(tok)
    lines = [json.loads(line) for line in raw.getvalue().splitlines()]
    assert [x["level"] for x in lines] == ["error", "warning", "info"]
    assert lines[2]["msg"] == "hello world" and lines[0]["request_id"] == "req-777777"


def test_counters_render_and_escape():
    m = obs.Metrics()
    m.inc("x_total", {"result": 'a"b'})
    m.inc("x_total", {"result": 'a"b'}, 2)
    out = m.render()
    assert 'x_total{result="a\\"b",pid=' in out and out.strip().endswith("3")


def test_sentry_only_with_dsn(monkeypatch):
    calls = {}
    fake = types.SimpleNamespace(init=lambda **kw: calls.update(kw), capture_exception=lambda e: calls.update(exc=e))
    monkeypatch.setitem(sys.modules, "sentry_sdk", fake)
    monkeypatch.setitem(obs._installed, "sentry", False)
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert obs.install_sentry() is False and not calls
    monkeypatch.setenv("SENTRY_DSN", "https://k@o.ingest.sentry.io/1")
    assert obs.install_sentry() is True
    assert calls["send_default_pii"] is False
    obs.capture(ValueError("x"))
    assert isinstance(calls["exc"], ValueError)
    monkeypatch.setitem(obs._installed, "sentry", False)


def test_bad_webhook_signature_is_counted(sb, client, monkeypatch):
    monkeypatch.setenv("DODO_WEBHOOK_SECRET", "whsec_dGVzdA==")
    before = obs.metrics.get("webhook_events_total", {"result": "bad_signature"})
    client.post("/webhooks", content=b"{}", headers={"webhook-id": "m", "webhook-timestamp": "1", "webhook-signature": "v1,x"})
    assert obs.metrics.get("webhook_events_total", {"result": "bad_signature"}) == before + 1


def test_ai_errors_have_codes():
    import pathlib
    src = (pathlib.Path(main.BASE_DIR) / "main.py").read_text(encoding="utf-8")
    for code in ("AI_TIMEOUT", "AI_UPSTREAM_LIMIT", "AI_BUSY_UPSTREAM", "AI_ERROR"):
        assert f'"{code}"' in src
