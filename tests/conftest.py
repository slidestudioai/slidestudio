"""Umumiy test sozlamalari.

main.py import qilinishidan OLDIN muhit o'zgaruvchilari tozalanadi: testlar haqiqiy Supabase / AI / Telegram ga
ulanmaydi. Har test uchun yangi FakeSupabase (tests/fake_supabase.py) beriladi.
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

for _k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "AI_API_KEY", "DEEPSEEK_API_KEY",
           "API_KEY", "TELEGRAM_BOT_TOKEN", "DODO_WEBHOOK_SECRET", "DODO_PAYMENTS_API_KEY", "DODO_PRODUCT_ID", "DODO_PAYMENTS_ENV", "SLIDE_STUDIO_DEV_MODE",
           "SLIDE_STUDIO_DEV_TOKEN", "TRUST_CF_CONNECTING_IP", "REDIS_URL", "KEEPALIVE"):
    os.environ.pop(_k, None)
os.environ.setdefault("SLIDE_STUDIO_HMAC_SECRET", "test-secret-" + "x" * 40)
os.environ.setdefault("SEARCH_VERIFY_IMAGES", "0")      # tests use fake picture URLs (tested on its own)

import pytest  # noqa: E402

import main  # noqa: E402
from fake_supabase import FakeSupabase  # noqa: E402


@pytest.fixture()
def sb(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(main, "supabase", fake)
    main._RL.clear()
    main._TOK_CACHE.clear()
    main._UWIN.clear()
    main._USAGE_CACHE.clear()
    main._PENDING_CHARGES.clear()
    main._CHARGE_RPC.update(ok=True, checked=0.0)
    main._AI_INFLIGHT.clear()
    yield fake
    main._RL.clear()
    main._USAGE_CACHE.clear()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient
    main._RL.clear()
    return TestClient(main.app)       # lifespan ishga tushirilmaydi (bot / keepalive yo'q)
