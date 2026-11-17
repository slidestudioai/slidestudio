"""Audit H3 (local JWT verification) and H6 (AI turn deadline)."""
import asyncio
import base64
import json
import time
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

import main
from backend import jwt_auth, monitoring

pytestmark = pytest.mark.timeout(60)
URL = "https://proj.supabase.co"
ISS = URL + "/auth/v1"
SECRET = "legacy-jwt-secret-" + "s" * 30


def _ec_key():
    priv = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(priv.public_key()))
    return priv, jwk


@pytest.fixture()
def keys(monkeypatch):
    priv, jwk = _ec_key()
    jwk.update(kid="k1", alg="ES256", use="sig")
    state = {"jwks": {"keys": [jwk]}, "fetches": 0, "fail": False}

    def fetch():
        state["fetches"] += 1
        if state["fail"]:
            raise ConnectionError("jwks down")
        return state["jwks"]
    monkeypatch.setattr(jwt_auth, "_fetch_jwks", fetch)
    jwt_auth.configure(URL, SECRET)
    main._SESSION_OK.clear()
    main._TOK_BAD.clear()
    state["priv"] = priv
    yield state
    jwt_auth.configure("", "")
    main._SESSION_OK.clear()
    main._TOK_BAD.clear()


def _tok(priv, kid="k1", alg="ES256", **over):
    now = int(time.time())
    claims = {"sub": "u1", "email": "a@x.com", "aud": "authenticated", "role": "authenticated", "iss": ISS,
              "iat": now, "exp": now + 3600, "session_id": "s1"}
    claims.update(over)
    return jwt.encode(claims, priv, algorithm=alg, headers={"kid": kid})


@pytest.fixture()
def auth_calls(sb, monkeypatch):
    st = {"n": 0, "mode": "ok"}

    def get_user(token):
        st["n"] += 1
        if st["mode"] == "down":
            raise ConnectionError("auth down")
        if st["mode"] == "logged_out":
            return None
        return NS(user=NS(id="u1", email="a@x.com"))
    monkeypatch.setattr(sb.auth, "get_user", get_user)
    return st


# ---- H3 ---------------------------------------------------------------------------------------
def test_valid_token_local_and_revalidated_once_per_session(keys, auth_calls):
    t1 = _tok(keys["priv"])
    assert main.auth_user_cached(t1) == ("u1", "a@x.com")
    assert auth_calls["n"] == 1                                    # first sight of the session -> Supabase Auth asked
    t2 = _tok(keys["priv"], iat=int(time.time()) + 1)             # refreshed token, same session
    main._TOK_CACHE.clear()
    assert main.auth_user_cached(t2) == ("u1", "a@x.com")
    assert auth_calls["n"] == 1                                    # no network: signature checked locally
    assert keys["fetches"] == 1                                    # JWKS cached


@pytest.mark.parametrize("over", [
    {"exp": int(time.time()) - 120},          # expired
    {"aud": "other"},                          # wrong audience
    {"role": "anon"},                          # anon / publishable key JWT
    {"iss": "https://evil.supabase.co/auth/v1"},
])
def test_bad_claims_rejected_without_network(keys, auth_calls, over):
    assert main.auth_user_cached(_tok(keys["priv"], **over)) is None
    assert auth_calls["n"] == 0


def test_tampered_signature_rejected(keys, auth_calls):
    t = _tok(keys["priv"])
    h, p, sig = t.split(".")
    payload = json.loads(base64.urlsafe_b64decode(p + "=="))
    payload["sub"] = "victim"
    p2 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    assert main.auth_user_cached(f"{h}.{p2}.{sig}") is None
    assert auth_calls["n"] == 0


def test_alg_none_rejected(keys, auth_calls):
    t = jwt.encode({"sub": "u1", "aud": "authenticated", "role": "authenticated", "iss": ISS,
                    "exp": int(time.time()) + 600}, None, algorithm="none")
    assert main.auth_user_cached(t) is None


def test_alg_confusion_public_key_as_hmac_secret(keys, auth_calls):
    """Attacker signs HS256 with the PUBLIC key; we only accept HS256 with our own secret."""
    pub_pem = keys["priv"].public_key().public_bytes(serialization.Encoding.PEM,
                                                     serialization.PublicFormat.SubjectPublicKeyInfo)
    import hmac, hashlib
    hdr = base64.urlsafe_b64encode(json.dumps({"alg": "HS256", "typ": "JWT", "kid": "k1"}).encode()).decode().rstrip("=")
    body = base64.urlsafe_b64encode(json.dumps({"sub": "u1", "aud": "authenticated", "role": "authenticated",
                                                "iss": ISS, "exp": int(time.time()) + 600}).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(pub_pem, f"{hdr}.{body}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
    assert main.auth_user_cached(f"{hdr}.{body}.{sig}") is None


def test_legacy_hs256_secret(keys, auth_calls):
    now = int(time.time())
    t = jwt.encode({"sub": "u1", "email": "a@x.com", "aud": "authenticated", "role": "authenticated", "iss": ISS,
                    "exp": now + 600, "session_id": "s9"}, SECRET, algorithm="HS256")
    assert main.auth_user_cached(t) == ("u1", "a@x.com")


def test_hs256_without_secret_falls_back_to_supabase(keys, auth_calls):
    jwt_auth.configure(URL, "")
    t = jwt.encode({"sub": "u1", "aud": "authenticated", "role": "authenticated", "iss": ISS,
                    "exp": int(time.time()) + 600}, "whatever", algorithm="HS256")
    assert main.auth_user_cached(t) == ("u1", "a@x.com")           # decided by Supabase Auth (old behaviour)
    assert auth_calls["n"] == 1


def test_auth_outage_accepts_valid_signature(keys, auth_calls):
    auth_calls["mode"] = "down"
    assert main.auth_user_cached(_tok(keys["priv"])) == ("u1", "a@x.com")


def test_logged_out_session_rejected_and_negative_cached(keys, auth_calls):
    auth_calls["mode"] = "logged_out"
    t = _tok(keys["priv"], session_id="gone")
    assert main.auth_user_cached(t) is None
    assert main.auth_user_cached(t) is None
    assert auth_calls["n"] == 1


def test_key_rotation_refetches_jwks_rate_limited(keys, auth_calls):
    priv2, jwk2 = _ec_key()
    jwk2.update(kid="k2", alg="ES256")
    assert main.auth_user_cached(_tok(keys["priv"])) == ("u1", "a@x.com")
    keys["jwks"] = {"keys": [jwk2]}
    jwt_auth._jwks["last_try"] = 0                                 # pretend a minute passed
    main._TOK_CACHE.clear()
    assert main.auth_user_cached(_tok(priv2, kid="k2", session_id="s2")) == ("u1", "a@x.com")
    f = keys["fetches"]
    main._TOK_CACHE.clear()
    assert main.auth_user_cached(_tok(priv2, kid="unknown", session_id="s3")) is None
    assert keys["fetches"] == f                                    # no JWKS fetch storm on random kids


def test_jwks_unreachable_falls_back(keys, auth_calls):
    keys["fail"] = True
    assert main.auth_user_cached(_tok(keys["priv"])) == ("u1", "a@x.com")
    assert auth_calls["n"] == 1


def test_not_configured_keeps_old_behaviour(sb, auth_calls):
    jwt_auth.configure("", "")
    assert main.auth_user_cached("tok-plain") == ("u1", "a@x.com")
    assert auth_calls["n"] == 1


# ---- H6 ---------------------------------------------------------------------------------------
def _chunk(content=None, finish=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=None, tool_calls=None))],
              usage=None)


class _SlowStream:
    def __init__(self, first):
        self.first, self.sent, self.closed = first, False, False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.first and not self.sent:
            self.sent = True
            return _chunk(content=self.first)
        await asyncio.sleep(30)                                     # upstream hangs
        raise StopAsyncIteration

    async def close(self):
        self.closed = True


def _run_turn(sb, client, monkeypatch, first):
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "a@x.com", "free_credits": 200, "paid_credits": 0,
                                "last_reset_time": datetime.now(timezone.utc).isoformat()}]
    monkeypatch.setitem(main.config, "api_key", "test-key")
    monkeypatch.setattr(main, "_search_images_sync", None)
    monkeypatch.setattr(main, "AI_TURN_DEADLINE_FAST", 0.5)
    streams = []

    class _Completions:
        async def create(self, **kw):
            s = _SlowStream(first)
            streams.append(s)
            return s
    monkeypatch.setattr(main, "_deepseek_client", lambda *a, **k: NS(chat=NS(completions=_Completions())))
    t0 = time.time()
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "slayd", "token": "tok-1"}))
        for _ in range(30):
            m = ws.receive_json()
            if m.get("type") in ("end", "error"):
                break
    return m, streams, time.time() - t0


def test_deadline_with_partial_answer(sb, client, monkeypatch):
    m, streams, dt = _run_turn(sb, client, monkeypatch, "Mana birinchi qism...")
    assert dt < 10
    assert m["type"] == "end" and m["finish_reason"] == "timeout" and m["interrupted"] is True
    assert streams[0].closed
    assert main._AI_INFLIGHT == {}
    assert main.GEMINI_SEMAPHORE._value == main.DEEPSEEK_CONCURRENCY      # AI slot given back


def test_deadline_without_answer_is_not_charged(sb, client, monkeypatch):
    m, _, _ = _run_turn(sb, client, monkeypatch, None)
    assert m["type"] == "error" and "uzoq" in m["message"]
    assert sb.usage("u1")["free_credits"] == 200
    assert main._AI_INFLIGHT == {}


def test_ai_client_read_timeout_is_short():
    main._ds_client_cache.update(sig=None, client=None)
    c = main._deepseek_client("k", "https://example.invalid")
    assert c.timeout.read == main.AI_READ_TIMEOUT <= 180
    main._ds_client_cache.update(sig=None, client=None)


def test_frontend_maps_timeout_reason():
    import pathlib
    src = (pathlib.Path(main.BASE_DIR) / "js/04_websocket_stream.js").read_text(encoding="utf-8")
    assert "_fr === 'timeout' ? 'timeout'" in src
