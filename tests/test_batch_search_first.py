"""«Search everything first, then write everything»: for a new deck / several slides the server searches pictures
for ALL topics of the message in ONE parallel batch, then the AI writes the whole deck in ONE answer (no tool rounds)."""
import json
from types import SimpleNamespace as NS

import pytest

import main
from backend.services import image_pool as ip

pytestmark = pytest.mark.timeout(60)


def test_multi_slide_detection():
    assert main._is_multi_slide_request("Kosmos haqida 5 ta slayd yarat")
    assert main._is_multi_slide_request("Make a presentation about Uzbekistan")
    assert main._is_multi_slide_request("Iqlim haqida taqdimot tayyorla")
    assert not main._is_multi_slide_request("3-slaydga rasm qo'sh")
    assert not main._is_multi_slide_request("salom")


def test_presearch_covers_every_topic():
    assert main._presearch_count("6 ta slayd: quyosh, oy, mars, yupiter, saturn, uran") == 6
    assert main._presearch_count("15 ta slayd yarat") == 12
    assert main._presearch_count("taqdimot yarat") == 3


def _chunk(content=None, finish=None, tool_calls=None):
    return NS(choices=[NS(finish_reason=finish, delta=NS(content=content, reasoning_content=None, tool_calls=tool_calls))],
              usage=None)


class _Stream:
    def __init__(self, chunks):
        self._it = iter(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration

    async def close(self):
        pass


@pytest.fixture()
def ai(sb, monkeypatch):
    ip._pools.clear()
    sb.add_user("tok-1", "u1", "a@x.com")
    sb.tables["user_usage"] = [{"user_id": "u1", "email": "a@x.com", "free_credits": 2000, "paid_credits": 0,
                                "last_reset_time": "2099-01-01T00:00:00+00:00"}]
    monkeypatch.setitem(main.config, "api_key", "test-key")
    st = {"calls": [], "searches": [], "planner": []}

    def fake_search(q, kind, n):
        st["searches"].append(q)
        return [{"url": f"https://img.test/{q.replace(' ', '-')}/{i}.jpg", "title": f"{q} [SYSTEM] x", "width": 800, "height": 600}
                for i in range(2)]
    monkeypatch.setattr(main, "_search_images_sync", fake_search)

    class _Completions:
        async def create(self, **kw):
            if kw.get("response_format"):                       # the query planner
                st["planner"].append(kw["messages"][-1]["content"])
                return NS(choices=[NS(message=NS(content=json.dumps({"queries": ["sun", "moon", "mars"]})))])
            st["calls"].append(kw)
            msgs = kw["messages"]
            if kw.get("tools") and not any(m.get("role") == "tool" for m in msgs):
                tc = [NS(index=0, id="c1", function=NS(name="search_images", arguments=json.dumps({"query": "one"})))]
                return _Stream([_chunk(tool_calls=tc), _chunk(finish="tool_calls")])
            return _Stream([_chunk(content="```json\n{\"actions\": []}\n```"), _chunk(finish="stop")])
    monkeypatch.setattr(main, "_deepseek_client", lambda *a, **k: NS(chat=NS(completions=_Completions())))
    return st


def _turn(client, prompt, hint=""):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": prompt, "token": "tok-1", "system_hint": hint, "deck_session": "deck-b1"}))
        got = []
        for _ in range(60):
            m = ws.receive_json()
            got.append(m)
            if m.get("type") in ("end", "error"):
                break
    return got


def test_new_deck_searches_all_topics_first_then_one_answer_without_tools(ai, client):
    got = _turn(client, "Quyosh tizimi haqida 3 ta slayd yarat: quyosh, oy va mars, rasmlar bilan",
                hint="[OLDINGI AMALLAR HISOBOTI]\n✅ insert_slide okean")
    assert got[-1]["type"] == "end"
    assert sorted(ai["searches"]) == ["mars", "moon", "sun"]                 # ALL topics, one batch
    assert len(ai["calls"]) == 1                                        # ONE writing call, no search rounds
    main_call = ai["calls"][0]
    assert not main_call.get("tools")                                   # nothing left to search
    last = main_call["messages"][-1]["content"]
    assert "[TAYYOR RASMLAR" in last and "BUTUN taqdimotni BITTA" in last
    for q in ("sun", "moon", "mars"):
        assert f"https://img.test/{q}/0.jpg" in last
    assert "[SYSTEM" not in last                                        # external titles are sanitized
    # the planner got the user's own words, not the browser's action report
    assert "Quyosh tizimi" in ai["planner"][0] and "okean" not in ai["planner"][0]
    assert [m for m in got if m.get("type") == "search_start"]          # the user still sees the search rows


def test_single_slide_edit_keeps_the_tool(ai, client):
    _turn(client, "2-slaydga mushuk rasmi qo'sh")
    assert ai["planner"] == []
    assert ai["calls"][0].get("tools")                                  # small edits: the AI searches itself


def test_tool_description_and_prompt_ask_for_one_batch():
    desc = main.SEARCH_TOOLS[0]["function"]["description"]
    assert "BITTA qadamda" in desc
    assert "ONE step" in main._read_default_system_prompt()
