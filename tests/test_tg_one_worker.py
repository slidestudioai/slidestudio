"""Telegram bot: only one gunicorn worker handles updates (chat state lives in one process's RAM).

Followers forward webhook updates to the leader over a local Unix socket; when the leader exits,
its file lock is released and another worker can take over."""
import asyncio
import json
import os
import subprocess
import sys
import textwrap

import pytest

pytestmark = pytest.mark.skipif(sys.platform.startswith("win"), reason="fcntl / Unix sockets")


@pytest.fixture
def bot(monkeypatch, tmp_path):
    from backend import telegram_bot as tb
    monkeypatch.setattr(tb, "_LEAD_LOCK", str(tmp_path / "lead.lock"))
    monkeypatch.setattr(tb, "_LEAD_SOCK", str(tmp_path / "lead.sock"))
    monkeypatch.setattr(tb, "TG_ONE_WORKER", True)
    tb._lead.update(fd=None, server=None, started=False)
    yield tb
    if tb._lead.get("server") is not None:
        tb._lead["server"].close()
    if tb._lead.get("fd") is not None:
        os.close(tb._lead["fd"])
    tb._lead.update(fd=None, server=None, started=False)


def test_follower_update_reaches_the_leader(bot, monkeypatch):
    got = []

    async def fake_handle(data):
        got.append(data)

    monkeypatch.setattr(bot, "_safe_handle", fake_handle)

    async def run():
        assert bot._try_lead()
        await bot._serve_followers()
        fd = bot._lead["fd"]
        bot._lead["fd"] = None                      # act as a follower worker for the forward
        try:
            ok = await bot._forward_to_leader({"update_id": 987654321, "message": {"text": "salom"}})
        finally:
            bot._lead["fd"] = fd
        for _ in range(50):
            if got:
                break
            await asyncio.sleep(0.02)
        return ok

    assert asyncio.run(run()) is True
    assert got == [{"update_id": 987654321, "message": {"text": "salom"}}]


def test_leader_never_forwards_and_dead_socket_falls_back(bot):
    async def run():
        assert bot._try_lead()
        a = await bot._forward_to_leader({"update_id": 1})        # leader handles it itself
        fd = bot._lead["fd"]
        bot._lead["fd"] = None
        try:
            b = await bot._forward_to_leader({"update_id": 2})    # no socket -> handled locally
        finally:
            bot._lead["fd"] = fd
        return a, b

    assert asyncio.run(run()) == (False, False)


def test_only_one_process_is_leader_and_lock_is_released_on_exit(bot, tmp_path):
    lock = str(tmp_path / "lead.lock")
    holder = subprocess.Popen([sys.executable, "-c", textwrap.dedent(f"""
        import fcntl, os, sys, time
        fd = os.open({lock!r}, os.O_CREAT | os.O_RDWR)
        fcntl.flock(fd, fcntl.LOCK_EX)
        print("locked", flush=True)
        sys.stdin.readline()
    """)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        assert holder.stdout.readline().strip() == "locked"
        assert bot._try_lead() is False                            # another worker is the leader
        holder.stdin.write("\n")
        holder.stdin.flush()
        holder.wait(5)
        assert bot._try_lead() is True                             # the leader exited -> take over
    finally:
        if holder.poll() is None:
            holder.kill()


def test_bot_image_ram_has_one_shared_budget(monkeypatch):
    """Images kept for the next export are bounded across ALL chats (before: up to 8 x 6 MB per chat x 300 chats)."""
    from collections import OrderedDict
    import time
    from backend import telegram_bot as tb
    chats = OrderedDict()
    now = time.time()
    for i in range(6):                                   # 6 chats x 4 MB, newest last
        chats[i] = {"imgs": {"q": b"x" * (4 * 1024 * 1024)}, "img_ts": now - 60 + i}
    chats[0]["sending"] = True                           # a chat that is sending files right now is never touched
    monkeypatch.setattr(tb, "_chats", chats)
    monkeypatch.setattr(tb, "IMG_RAM_BUDGET", 10 * 1024 * 1024)
    tb._sweep_imgs(now, force=True)
    total = sum(tb._imgs_bytes(v) for v in chats.values())
    assert total <= 10 * 1024 * 1024 + 4 * 1024 * 1024   # the busy chat may stay above the budget
    assert chats[0]["imgs"]                              # sending -> kept
    assert chats[5]["imgs"]                              # newest -> kept
    assert not chats[1]["imgs"]                          # oldest idle -> dropped first
