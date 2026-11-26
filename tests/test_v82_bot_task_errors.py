"""v82.9: an exception in a bot background job is logged right away and the task is released."""
import asyncio

import pytest

from backend import telegram_bot as tb

pytestmark = pytest.mark.timeout(30)


def test_background_error_is_logged(monkeypatch):
    seen = []
    monkeypatch.setattr(tb, "_warn", lambda key, msg: seen.append(msg))

    async def broken():
        raise ValueError("boom")

    async def main():
        tb._spawn(broken())
        for _ in range(20):
            await asyncio.sleep(0)
    asyncio.run(main())
    assert any("ValueError: boom" in m and "broken" in m for m in seen)
    assert not tb._bg                                           # finished task is not kept


def test_ok_and_cancelled_tasks_are_quiet(monkeypatch):
    seen = []
    monkeypatch.setattr(tb, "_warn", lambda key, msg: seen.append(msg))

    async def ok():
        return 1

    async def slow():
        await asyncio.sleep(10)

    async def main():
        tb._spawn(ok())
        tb._spawn(slow())
        await asyncio.sleep(0)
        for t in list(tb._bg):
            t.cancel()
        for _ in range(20):
            await asyncio.sleep(0)
    asyncio.run(main())
    assert seen == [] and not tb._bg
