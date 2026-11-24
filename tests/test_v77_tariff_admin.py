"""v77: tarif admin paneldan (kodda qotirilgan son yo'q), pullik balans > 0 — kunlik bepul limit o'chadi,
admin panelda 4 ta filtr (Google / Telegram / Ulanganlar / Barchasi) va har foydalanuvchining aniq holati."""
from datetime import datetime, timedelta, timezone

import pytest

import main
from backend import admin_core, appsettings
from backend import monitoring as mon

U = mon.UNIT


@pytest.fixture(autouse=True)
def _restore_tariff():
    cache, rtv = dict(appsettings._cache), dict(mon._RT)
    yield
    appsettings._cache.clear()
    appsettings._cache.update(cache)
    mon._RT.clear()
    mon._RT.update(rtv)
    mon._rebuild_modes()


def _now(h=0):
    return (datetime.now(timezone.utc) - timedelta(hours=h)).isoformat()


# ------------------------------------------------------------------ 1) dinamik tarif
def test_defaults_match_spec():
    s = appsettings.DEFAULTS
    assert (s["slides_per_dollar"], s["fast_ai_cost"], s["deep_ai_cost"],
            s["free_daily_fast_limit"], s["free_daily_deep_limit"]) == (100, 1, 2, 10, 5)


def test_settings_change_prices_everywhere():
    r = appsettings.set_many({"slides_per_dollar": 150, "fast_ai_cost": 1, "deep_ai_cost": 3,
                              "free_daily_fast_limit": 20, "free_daily_deep_limit": 4})
    assert r["saved"]["slides_per_dollar"] == 150
    assert mon.pack_pages() == 150 and mon.MODES["fast"]["page"] == U and mon.MODES["deep"]["page"] == 3 * U
    assert mon.free_daily_units() == 20 * U and mon.rt("free_daily_deep_limit") == 4
    # to'lov: $1 -> 150, $2 -> 300; paket bonusi foizda qoladi (+10%)
    assert main.credits_for_net_cents(100) == 150 and main.credits_for_net_cents(200) == 300
    q, err = main._topup_quote_from_payload({"package": "popular"})
    assert not err and q["credits"] == 550 * 150 // 100


def test_old_setting_keys_still_work_and_bad_cost_rejected():
    r = appsettings.set_many({"pack_pages": 120, "free_daily_pages": 12, "deep_ai_cost": 0, "fast_ai_cost": -1})
    assert r["saved"] == {"slides_per_dollar": 120, "free_daily_fast_limit": 12}
    assert mon.pack_pages() == 120 and mon.rt("free_daily_pages") == 12


# ------------------------------------------------------------------ 2) pullik > 0 -> bepul limit o'chadi
def test_paid_mode_hides_free_and_charges_paid_only():
    u = {"email": "a@x.uz", "paid_credits": 100 * U, "free_credits": 10 * U, "last_reset_time": _now(1)}
    u2 = mon.apply_24h_reset(dict(u))
    assert u2["free_credits"] == 0 and mon.free_suspended(u2)
    u3, ch, _ = mon.charge_for_ai_turn(dict(u), 50, 0, "fast")       # 50 Tez varaq
    assert ch == 50 * U and u3["paid_credits"] == 50 * U and u3["free_credits"] == 0
    u4, ch, _ = mon.charge_for_ai_turn(dict(u3), 1, 0, "deep")       # Chuqur = 2 birlik
    assert ch == 2 * U and u4["paid_credits"] == 48 * U


def test_even_one_unit_paid_disables_free_limit():
    u = mon.apply_24h_reset({"email": "a@x.uz", "paid_credits": 1, "free_credits": 200, "last_reset_time": _now(30)})
    assert u["free_credits"] == 0 and mon.usage_payload(u)["free_suspended"] is True


def test_free_limit_back_at_once_when_paid_runs_out():
    u = {"email": "a@x.uz", "paid_credits": 1 * U, "free_credits": 0, "last_reset_time": _now(1)}
    u2, ch, _ = mon.charge_for_ai_turn(dict(u), 1, 0, "fast")
    assert ch == U and u2["paid_credits"] == 0
    u3 = mon.apply_24h_reset(dict(u2))
    assert u3["free_credits"] == mon.free_daily_units()               # 10/10 darhol


def test_sql_charge_same_rule(sb):
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "a@x.uz", "paid_credits": 3 * U, "free_credits": 200,
                                "last_reset_time": _now(2)}]
    r = sb._charge_units("u1", 2 * U, "slide_actions", 200, 200)
    assert r["charged"] == 2 * U and r["free_credits"] == 0 and r["paid_credits"] == U
    r = sb._charge_units("u1", U, "slide_actions", 200, 200)          # pullik tugadi
    assert r["paid_credits"] == 0
    r = sb._charge_units("u1", U, "slide_actions", 200, 200)          # bepul limit darhol qaytdi
    assert r["free_credits"] == 200 - U and r["paid_credits"] == 0


def test_free_deep_limit_is_its_own_setting():
    appsettings.set_many({"free_daily_fast_limit": 10, "free_daily_deep_limit": 4})
    free_user = mon.apply_24h_reset({"email": "a@x.uz", "paid_credits": 0, "free_credits": 0, "last_reset_time": _now(30)})
    assert mon.pages_left(free_user, "fast") == 10 and mon.pages_left(free_user, "deep") == 4
    paid_user = {"email": "a@x.uz", "paid_credits": 100 * U, "free_credits": 0}
    assert mon.pages_left(paid_user, "deep") == 50                   # pullikda oddiy Chuqur narx (2)


# ------------------------------------------------------------------ 3) admin: holat va balans
def _ledger(sb, uid, kind, amount_units, paid_after, h, usd=None):
    det = {"usd": usd} if usd is not None else {}
    sb.tables.setdefault("usage_ledger", []).append({"user_id": uid, "kind": kind, "amount": amount_units,
                                                     "paid_after": paid_after, "created_at": _now(h), "details": det})


def test_balance_view_spec_sequence(sb):
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "a@x.uz", "paid_credits": 0, "free_credits": 200,
                                "last_reset_time": _now(30)}]
    b = admin_core.user_brief("u1")["balance"]
    assert b["text"] == "Bepul: Tez 10/10 | Chuqur 5/5"
    _ledger(sb, "u1", "purchase", 100 * U, 100 * U, 5, usd=1.49)       # $1 -> 100
    sb.usage("u1")["paid_credits"] = 100 * U
    assert admin_core.user_brief("u1")["balance"]["text"] == "Pullik: 100 / 100 ($1.49)"
    _ledger(sb, "u1", "slide_actions", -50 * U, 50 * U, 4)             # 50 Tez varaq ishlatdi
    sb.usage("u1")["paid_credits"] = 50 * U
    br = admin_core.user_brief("u1")
    assert br["balance"]["text"].startswith("Pullik: 50 / 100") and br["last_spend"] == -50
    _ledger(sb, "u1", "purchase", 100 * U, 150 * U, 3, usd=1.49)       # yana $1
    sb.usage("u1")["paid_credits"] = 150 * U
    assert admin_core.user_brief("u1")["balance"]["text"] == "Pullik: 150 / 150 ($2.98)"


def _users(sb):
    sb.tables["user_usage"] = [
        {"user_id": "g1", "email": "g1@gmail.com", "paid_credits": 0, "free_credits": 200, "last_active": _now(1), "created_at": _now(100)},
        {"user_id": "both", "email": "b@gmail.com", "paid_credits": 40 * U, "free_credits": 0, "last_active": _now(2), "created_at": _now(90)},
        {"user_id": "t1", "email": "tg111@t.me", "paid_credits": 0, "free_credits": 0, "last_active": _now(3), "created_at": _now(80)},
        {"user_id": "new", "email": "new@gmail.com", "paid_credits": 0, "free_credits": 200, "last_active": None, "created_at": _now(0)},
    ]
    sb.tables["tg_links"] = [{"tg_id": 222, "user_id": "both", "email": "b@gmail.com", "created_at": _now(0.25)}]


@pytest.mark.parametrize("flt,want", [
    ("google", ["new", "g1", "both"]),       # yangi (hali faol emas) ham darhol, tepada
    ("tg", ["both", "t1"]),
    ("linked", ["both"]),
    ("all", ["new", "g1", "both", "t1"]),
])
def test_four_filters(sb, flt, want):
    _users(sb)
    got = [u["user_id"] for u in admin_core._find_users("", flt, 30, 0)]
    assert got == want


def test_row_shows_connection_and_time(sb):
    _users(sb)
    rows = {u["user_id"]: u for u in admin_core._find_users("", "all", 30, 0)}
    assert rows["both"]["source"] == "both" and rows["both"]["linked_at"] and rows["both"]["tg_id"] == 222
    assert rows["t1"]["source"] == "tg" and rows["g1"]["source"] == "google"
    assert rows["both"]["balance"]["mode"] == "paid" and rows["g1"]["balance"]["mode"] == "free"


def test_stats_match_filters(sb):
    _users(sb)
    s = admin_core.stats()
    assert (s["users_total"], s["google_users"], s["tg_users"], s["linked"]) == (4, 3, 1, 1)
    assert s["google_only"] == 2 and s["tg_total"] == 2
    assert s["paid_left_total"] == 40 and s["paid_users"] == 1
    assert s["tariff"]["slides_per_dollar"] == 100
