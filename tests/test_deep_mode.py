"""Deep AI: it cannot call the search tool, so the server searches the pictures beforehand for every new deck —
also when the message is just a topic in an empty deck — and the model gets the «think deeper» instruction."""
import json

import pytest

import main
from test_batch_search_first import ai  # noqa: F401  (fixture)

pytestmark = pytest.mark.timeout(60)

EMPTY = json.dumps({"total_slides": 1, "presentation": [{"slide": 1, "objects": [
    {"type": "textbox", "text": "Sarlavha Kiriting"}, {"type": "textbox", "text": "Matn kiriting..."}]}]})
FULL = json.dumps({"total_slides": 2, "presentation": [{"slide": 1, "objects": [{"type": "textbox", "text": "Iqlim"}]},
                                                       {"slide": 2, "objects": [{"type": "image", "src": "https://x/1.jpg"}]}]})


def _turn(client, prompt, model, deck):
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"prompt": prompt, "token": "tok-1", "model": model, "deck_state": deck, "deck_session": "deck-d1"}))
        got = []
        for _ in range(80):
            m = ws.receive_json()
            got.append(m)
            if m.get("type") in ("end", "error"):
                break
    return got


def test_deep_topic_in_empty_deck_searches_pictures_first(ai, client):  # noqa: F811
    got = _turn(client, "Iqlim o'zgarishi haqida", "deep", EMPTY)
    assert got[-1]["type"] == "end"
    assert ai["planner"] and sorted(ai["searches"]) == ["mars", "moon", "sun"]
    call = ai["calls"][0]
    assert call["model"] == "deepseek-reasoner" and not call.get("tools")
    assert "[TAYYOR RASMLAR" in call["messages"][-1]["content"]
    assert "[CHUQUR AI REJIMI" in call["messages"][0]["content"]


def test_fast_topic_in_empty_deck_also_searches_first(ai, client):  # noqa: F811
    _turn(client, "Amir Temur haqida", "fast", EMPTY)
    assert sorted(ai["searches"]) == ["mars", "moon", "sun"]
    assert "[CHUQUR AI REJIMI" not in ai["calls"][0]["messages"][0]["content"]


def test_deep_edit_of_a_full_deck_does_not_search(ai, client):  # noqa: F811
    _turn(client, "2-slaydning sarlavhasini qizil qil", "deep", FULL)
    assert ai["planner"] == [] and ai["searches"] == []
    assert "[TAHRIR — YANGI RASM YO'Q]" in ai["calls"][0]["messages"][-1]["content"]


def test_deep_picture_request_on_a_full_deck_searches(ai, client):  # noqa: F811
    _turn(client, "2-slaydga mushuk rasmi qo'sh", "deep", FULL)
    assert ai["planner"] and ai["searches"]


@pytest.mark.parametrize("text,empty,want", [
    ("Iqlim o'zgarishi haqida", True, True), ("Amir Temur", True, True), ("salom", True, False),
    ("Bu sayt nima qila oladi?", True, False), ("rasmsiz: Kosmos", True, False), ("Iqlim o'zgarishi haqida", False, False),
])
def test_new_deck_topic(text, empty, want):
    assert main._new_deck_topic(text, EMPTY if empty else FULL) is want


def test_deep_searches_more():
    assert main._presearch_count("16 ta slayd", deep=True) == 16
    assert main._presearch_count("16 ta slayd") == 12
    assert main._is_multi_slide_request("Sun'iy intellekt haqida 10 slayd")
