"""Audit H5: a turn cut by a network drop finishes in the background and can be resumed (charged fairly, once)."""
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace as NS

import pytest
from fastapi import WebSocketDisconnect
from starlette.websockets import WebSocketState

import main
from backend import monitoring
from backend.services import resume

pytestmark = pytest.mark.timeout(60)
U = monitoring.UNIT
ACTS = {"actions": [{"action": "insert_slide", "after": i, "elements": []} for i in range(3)]}
PART1 = "Tayyorlayapman. "
PART2 = "```json\n" + json.dumps(ACTS) + "\n```"


def _chunk(content=None, finish=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=None, tool_calls=None))],
              usage=None)


class _Stream:
    def __init__(self, chunks):
        self._it = iter(chunks)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        await asyncio.sleep(0)
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        self.closed = True


class FakeWS:
    """Minimal WebSocket: delivers `ok_chunks` chunk messages, then every send fails (network drop)."""

    def __init__(self, messages, ok_chunks=None):
        self.headers = {}
        self.client_state = WebSocketState.CONNECTED
        self.application_state = WebSocketState.CONNECTED
        self._in = list(messages)
        self.sent = []
        self.ok_chunks = ok_chunks
        self.broken = False

    async def accept(self):
        pass

    async def close(self, code=1000):
        pass

    async def receive_text(self):
        await asyncio.sleep(0)
        if self.broken or not self._in:
            raise WebSocketDisconnect()
        return self._in.pop(0)

    async def send_json(self, data):
        if self.broken:
            raise RuntimeError("socket closed")
        if data.get("type") == "chunk" and self.ok_chunks is not None:
            if self.ok_chunks <= 0:
                self.broken = True
                raise RuntimeError("socket closed")
            self.ok_chunks -= 1
        self.sent.append(data)


@pytest.fixture()
def env(sb, monkeypatch):
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "a@x.com", "free_credits": 200, "paid_credits": 0,
                                "last_reset_time": datetime.now(timezone.utc).isoformat()}]
    monkeypatch.setitem(main.config, "api_key", "test-key")
    monkeypatch.setattr(main, "_search_images_sync", None)
    streams = []

    class _Completions:
        async def create(self, **kw):
            s = _Stream([_chunk(content=PART1), _chunk(content=PART2), _chunk(finish="stop")])
            streams.append(s)
            return s
    monkeypatch.setattr(main, "_deepseek_client", lambda *a, **k: NS(chat=NS(completions=_Completions())))
    resume._mem.clear()
    yield NS(sb=sb, streams=streams)
    resume._mem.clear()


def _turn(rid="req_abcdef12"):
    return json.dumps({"prompt": "3 ta slayd", "token": "tok-1", "request_id": rid,
                       "deck_state": json.dumps({"presentation": [{"slide": 1, "objects": []}]})})


def _resume(rid="req_abcdef12"):
    return json.dumps({"type": "resume", "token": "tok-1", "request_id": rid})


def test_drop_mid_stream_then_resume_gets_rest_and_fair_charge(env):
    ws = FakeWS([_turn()], ok_chunks=1)                         # PART1 arrives, then the network drops
    asyncio.run(main.ws_chat(ws))
    assert [m["type"] for m in ws.sent if m["type"] == "chunk"] == ["chunk"]
    assert not any(m["type"] == "end" for m in ws.sent)
    # the turn finished in the background: only the delivered part (chat, no slides) was charged so far
    assert env.sb.usage("u1")["free_credits"] == 200 - monitoring.MODES["fast"]["chat"]
    assert env.streams[0].closed

    ws2 = FakeWS([_resume()])                                   # reconnect (any worker)
    asyncio.run(main.ws_chat(ws2))
    r = ws2.sent[-1]
    assert r["type"] == "resume_result" and r["request_id"] == "req_abcdef12"
    assert r["stream_text"] == PART1 + PART2                    # browser applies only what it did not get
    # total charged == a turn without a break (3 slides)
    assert env.sb.usage("u1")["free_credits"] == 200 - 3 * U
    assert r["free_credits"] == 200 - 3 * U

    ws3 = FakeWS([_resume()])                                   # second resume: same data, NOT charged again
    asyncio.run(main.ws_chat(ws3))
    assert ws3.sent[-1]["type"] == "resume_result"
    assert env.sb.usage("u1")["free_credits"] == 200 - 3 * U


def test_tab_closed_never_resumed_pays_only_delivered_part(env):
    asyncio.run(main.ws_chat(FakeWS([_turn("req_closed01")], ok_chunks=1)))
    assert env.sb.usage("u1")["free_credits"] == 200 - monitoring.MODES["fast"]["chat"]


def test_normal_turn_end_lost_can_be_resumed_on_same_worker(env):
    ws = FakeWS([_turn("req_normal01")])
    asyncio.run(main.ws_chat(ws))
    end = [m for m in ws.sent if m["type"] == "end"][0]
    assert end["request_id"] == "req_normal01" and end["units_charged"] == 3 * U
    ws2 = FakeWS([_resume("req_normal01")])
    asyncio.run(main.ws_chat(ws2))
    assert ws2.sent[-1]["type"] == "resume_result"
    assert env.sb.usage("u1")["free_credits"] == 200 - 3 * U    # no extra charge


def test_resume_of_other_users_turn_is_refused(env):
    asyncio.run(main.ws_chat(FakeWS([_turn("req_private1")])))
    env.sb.add_user("tok-2", "u2", "b@x.com")
    ws = FakeWS([json.dumps({"type": "resume", "token": "tok-2", "request_id": "req_private1"})])
    asyncio.run(main.ws_chat(ws))
    assert ws.sent[-1]["type"] == "resume_none"


def test_resume_unknown_or_bad_id(env):
    ws = FakeWS([_resume("req_unknown9"), json.dumps({"type": "resume", "token": "tok-1", "request_id": "../x"})])
    asyncio.run(main.ws_chat(ws))
    assert [m["type"] for m in ws.sent] == ["resume_none", "resume_none"]


def test_resume_pending_while_running():
    resume._mem.clear()
    resume.start("req_running1", "u1")
    assert resume.lookup("req_running1", "u1")["status"] == "running"
    assert resume.lookup("req_running1", "u2") is None
    resume._mem.clear()


def test_detach_disabled_keeps_old_c3_behaviour(env, monkeypatch):
    monkeypatch.setattr(main, "RESUME_DETACH_SEC", 0.0)
    asyncio.run(main.ws_chat(FakeWS([_turn("req_nodetach")], ok_chunks=1)))
    e = resume.lookup("req_nodetach", "u1")
    assert e is None or e["status"] == "aborted"


def test_turn_without_request_id_is_not_detached(env):
    msg = json.dumps({"prompt": "3 ta slayd", "token": "tok-1"})
    asyncio.run(main.ws_chat(FakeWS([msg], ok_chunks=1)))
    assert resume._mem == {}


def test_frontend_wires_resume():
    import pathlib
    root = pathlib.Path(main.BASE_DIR) / "js"
    ws = (root / "04_websocket_stream.js").read_text(encoding="utf-8")
    st = (root / "01_state.js").read_text(encoding="utf-8")
    assert "payload.request_id" in st
    assert "socket.onopen" in ws and "_ssSendResume" in ws and "_ssCaptureResume()" in ws
    assert "full.slice(got.length)" in ws          # only the missing part is applied
