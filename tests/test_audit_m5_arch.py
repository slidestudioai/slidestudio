"""Audit M5: services split out of main.py — re-exports stay the same objects; ws_chat stays small."""
import importlib
import inspect

import main


def test_services_import_cleanly():
    for m in ("auth", "billing", "prompt_builder", "resume", "abuse", "obs"):
        importlib.import_module(f"backend.services.{m}")


def test_reexports_are_the_same_objects():
    from backend.services import auth, billing, prompt_builder
    assert main._USAGE_CACHE is billing._USAGE_CACHE
    assert main._PENDING_CHARGES is billing._PENDING_CHARGES
    assert main.charge_turn_atomic is billing.charge_turn_atomic
    assert main._TOK_CACHE is auth._TOK_CACHE
    assert main.auth_user_cached is auth.auth_user_cached
    assert main.ai_balance_rules is prompt_builder.ai_balance_rules


def test_services_follow_monkeypatched_main(sb):
    """Late-bound deps: tests (and admin tools) that replace main.supabase are seen by the services."""
    from backend.services import billing
    assert billing._sb() is sb


def test_ws_chat_stays_small():
    lines = len(inspect.getsource(main.ws_chat).splitlines())
    assert lines < 360, f"ws_chat grew to {lines} lines — move logic into backend/services"
    assert len(inspect.getsource(main._run_ai_turn).splitlines()) < 300
