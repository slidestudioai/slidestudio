"""Audit H3: verify Supabase access tokens LOCALLY (no HTTP call to Supabase Auth per request).

Supabase signs access tokens either with
  * asymmetric "JWT signing keys" (ES256 / RS256 / EdDSA) -> public keys from {SUPABASE_URL}/auth/v1/.well-known/jwks.json
  * the legacy shared secret (HS256)                      -> SUPABASE_JWT_SECRET (Project Settings -> API -> JWT secret)

verify(token) returns:
  * dict (claims)       -> signature, exp, aud, iss and role are valid
  * None                -> the token is definitely invalid (bad signature, expired, wrong audience, anon key, ...)
  * raises Unavailable  -> cannot decide locally (no key configured / JWKS unreachable) -> caller asks Supabase Auth

Security notes:
  * The algorithm is taken from the KEY, never trusted from the token header (no "alg confusion", no "none").
  * HS256 is accepted only when SUPABASE_JWT_SECRET is set.
  * A local check cannot see a logout/ban before the token expires (max ~1 h). main.auth_user_cached therefore
    still asks Supabase Auth once per session every AUTH_REVALIDATE_SEC (default 10 min).
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, Optional

try:
    import jwt as _jwt                      # PyJWT[crypto]
    from jwt import PyJWK as _PyJWK
except Exception:                           # pragma: no cover - library missing -> always "Unavailable"
    _jwt = None
    _PyJWK = None


class Unavailable(Exception):
    """Local verification is not possible right now."""


_ASYM = ("ES256", "RS256", "EdDSA", "ES384", "RS384", "RS512", "PS256")
LEEWAY = 30                                 # seconds of clock skew
JWKS_TTL = 600                              # refresh public keys every 10 min
JWKS_MIN_RETRY = 60                         # unknown kid / failed fetch: at most one fetch per minute

_cfg: Dict[str, str] = {"url": "", "secret": ""}
_jwks: Dict[str, Any] = {"keys": {}, "fetched": 0.0, "last_try": 0.0}
_lock = threading.Lock()


def configure(supabase_url: str = "", jwt_secret: str = "") -> None:
    _cfg["url"] = (supabase_url or "").strip().rstrip("/")
    _cfg["secret"] = (jwt_secret or "").strip()
    with _lock:
        _jwks.update(keys={}, fetched=0.0, last_try=0.0)


def enabled() -> bool:
    return _jwt is not None and os.environ.get("JWT_LOCAL_VERIFY", "1").strip().lower() not in ("0", "false", "no", "off")


def _fetch_jwks() -> Dict[str, Any]:
    """Downloads the public keys. Replaced in tests."""
    import httpx
    r = httpx.get(f"{_cfg['url']}/auth/v1/.well-known/jwks.json", timeout=httpx.Timeout(3.0, connect=2.0))
    r.raise_for_status()
    return r.json()


def _refresh_jwks(force: bool) -> None:
    now = time.time()
    with _lock:
        fresh = now - _jwks["fetched"] < JWKS_TTL
        if (fresh and not force) or now - _jwks["last_try"] < JWKS_MIN_RETRY:
            return
        _jwks["last_try"] = now
    try:
        data = _fetch_jwks()
        keys = {}
        for k in (data or {}).get("keys") or []:
            try:
                jwk = _PyJWK.from_dict(k)
            except Exception:
                continue                           # unsupported key type -> skipped
            keys[str(k.get("kid") or "")] = jwk
        with _lock:
            _jwks.update(keys=keys, fetched=now)
    except Exception as e:
        print(f"[JWT] JWKS olinmadi: {type(e).__name__}: {str(e)[:120]}")


def _key_for(kid: str):
    if not _cfg["url"]:
        raise Unavailable("no supabase url")
    _refresh_jwks(force=False)
    with _lock:
        jwk = _jwks["keys"].get(kid)
        have_any = bool(_jwks["fetched"])
    if jwk is None:
        _refresh_jwks(force=True)                   # key rotation: new kid -> refetch (rate-limited)
        with _lock:
            jwk = _jwks["keys"].get(kid)
            have_any = bool(_jwks["fetched"])
    if jwk is None:
        if not have_any:
            raise Unavailable("jwks unavailable")
        return None                                 # keys loaded, but this kid is unknown -> invalid token
    return jwk


def verify(token: str) -> Optional[Dict[str, Any]]:
    if not enabled():
        raise Unavailable("disabled")
    if not _cfg["url"] and not _cfg["secret"]:
        raise Unavailable("not configured")
    if not token or token.count(".") != 2:
        return None
    try:
        header = _jwt.get_unverified_header(token)
    except Exception:
        return None
    alg = str(header.get("alg") or "")
    if alg == "HS256":
        if not _cfg["secret"]:
            raise Unavailable("no jwt secret")
        key, algorithms = _cfg["secret"], ["HS256"]
    elif alg in _ASYM:
        jwk = _key_for(str(header.get("kid") or ""))
        if jwk is None:
            return None
        key, algorithms = jwk.key, [jwk.algorithm_name]   # algorithm from the KEY, not from the header
    else:
        return None                                       # "none", unknown algorithms
    try:
        claims = _jwt.decode(
            token, key, algorithms=algorithms, audience="authenticated",
            issuer=(f"{_cfg['url']}/auth/v1" if _cfg["url"] else None),
            leeway=LEEWAY, options={"require": ["exp", "sub", "aud"], "verify_iss": bool(_cfg["url"])},
        )
    except _jwt.InvalidTokenError:
        return None
    if claims.get("role") != "authenticated" or not claims.get("sub"):
        return None
    return claims
