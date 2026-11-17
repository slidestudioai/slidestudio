"""Stop button: {"type": "cancel"} is read DURING the AI stream, the upstream stream is closed at once,
finished work is kept and charged fairly, nothing is charged if no text came yet."""
import asyncio
import json
import time
from types import SimpleNamespace as NS

import pytest

import main
from backend import monitoring

pytestmark = pytest.mark.timeout(60)
U = monitoring.UNIT


def _chunk(content=None, finish=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=None, tool_calls=None))],
              usage=None)


class _SlowStream:
    """First `head` chunks come fast, then one chunk every 0.2 s for a long time (a big answer)."""
    def __init__(self, head):
        self.head, self.n, self.closed = list(head), 0, False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.closed:
            raise StopAsyncIteration
        if self.head:
            await asyncio.sleep(0.01)
            return _chunk(content=self.head.pop(0))
        self.n += 1
        if self.n > 200:
            raise StopAsyncIteration
        await asyncio.sleep(0.2)
        return _chunk(content=" bla")

    async def close(self):
        self.closed = True


@pytest.fixture()
def env(sb, monkeypatch):
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "a@x.com", "free_credits": 200, "paid_credits": 0,
                                "last_reset_time": "2099-01-01T00:00:00+00:00"}]
    monkeypatch.setitem(main.config, "api_key", "test-key")
    monkeypatch.setattr(main, "_search_images_sync", None)
    st = {"streams": [], "head": []}

    class _Completions:
        async def create(self, **kw):
            s = _SlowStream(st["head"])
            st["streams"].append(s)
            return s
    monkeypatch.setattr(main, "_deepseek_client", lambda *a, **k: NS(chat=NS(completions=_Completions())))
    return st


def _run(client, head, wait_chunks):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "10 ta slayd", "token": "tok-1", "request_id": "req_stop_0001"}))
        got = []
        while len([m for m in got if m.get("type") == "chunk"]) < wait_chunks:
            got.append(ws.receive_json())
        t0 = time.monotonic()
        ws.send_text(json.dumps({"type": "cancel", "request_id": "req_stop_0001", "token": "tok-1"}))
        while True:
            m = ws.receive_json()
            got.append(m)
            if m.get("type") in ("end", "error"):
                break
        took = time.monotonic() - t0
        # the connection is still usable after a stop
        ws.send_text(json.dumps({"type": "resume", "token": "tok-1", "request_id": "req_stop_0001"}))
        after = ws.receive_json()
    return got, took, after


def test_stop_with_one_finished_slide_keeps_and_charges_only_it(env, client):
    acts = {"actions": [{"action": "insert_slide", "after": 1, "elements": []}]}
    env["head"] = ["Mana.\n```json\n" + json.dumps(acts) + "\n```\n", "Keyingi slayd: "]
    got, took, after = _run(client, env["head"], 2)
    end = got[-1]
    assert end["type"] == "end" and end["finish_reason"] == "stopped" and end["request_id"] == "req_stop_0001"
    assert took < 1.5                                     # seen during the stream (not after 40 s of answer)
    assert env["streams"][0].closed                      # upstream closed -> no more tokens
    assert end["units_charged"] == U                     # the 1 finished slide, nothing more
    assert after["type"] == "resume_none"                # stopped turns are not resumed
    assert main._AI_INFLIGHT == {}


def test_stop_before_any_text_charges_nothing(env, client, sb):
    env["head"] = []
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": "slayd", "token": "tok-1", "request_id": "req_stop_0002"}))
        ws.send_text(json.dumps({"type": "cancel", "request_id": "req_stop_0002"}))
        while True:
            m = ws.receive_json()
            if m.get("type") in ("end", "error"):
                break
    assert m["type"] == "end" and m["finish_reason"] == "stopped" and m["units_charged"] == 0
    assert sb.usage("u1")["free_credits"] == 200


def test_stop_for_an_old_turn_does_not_stop_the_new_one():
    ws = main._DetachableWS(NS())
    ws.cancel_rid = "req_old"
    ws.begin_turn(False, rid="req_new")
    assert not ws.cancelled()
    ws.cancel_rid = "req_new"
    assert ws.cancelled()


def test_frontend_stop_sends_cancel_and_keeps_socket():
    import pathlib
    src = (pathlib.Path(main.BASE_DIR) / "js/04_websocket_stream.js").read_text(encoding="utf-8")
    body = src[src.index("function stopAiStream()"):src.index("window.stopAiStream = stopAiStream")]
    assert "type: 'cancel'" in body and "if (!_sent)" in body
