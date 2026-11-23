"""v71: krossvord — AI prompti uni biladi va jonli slayd holatida krossvord AI'ga element sifatida ko'rinadi."""
import json
from datetime import datetime, timezone

import pytest

import main
from backend import monitoring
from backend.services import prompt_builder as pb

pytestmark = pytest.mark.timeout(60)

WORDS = [{"answer": "GERAKL", "clue": "12 ta jasorat"}, {"answer": "ANUBIS", "clue": "Misr xudosi"}]


def _build(deck):
    usage = monitoring.normalize_user_row({"user_id": "u1", "free_credits": 200, "paid_credits": 0,
                                           "last_reset_time": datetime.now(timezone.utc).isoformat()})
    msgs, _ = pb.build_turn_messages(base_prompt="BASE", data={}, usage=usage, bill_mode="fast", model="deepseek-chat", mode="",
                                     plan_slides=[], plan_index=None, scope="all_slides", active_slide=1, images_meta=[],
                                     deck_state=json.dumps(deck), chat_history=[], prompt="krossvordni o'zgartir")
    return msgs[0]["content"]


def test_system_prompt_documents_crossword_and_university_decks():
    p = main.build_system_prompt()
    assert '"type":"crossword"' in p and "0E3. CROSSWORD" in p
    assert "0E4. UNIVERSITY" in p and "Foydalanilgan adabiyotlar" in p and "Javoblar" in p
    assert "NEVER draw a crossword by hand" in p


def test_crossword_from_client_map_is_shown_as_element():
    deck = {"presentation": [{"slide": 1, "objects": [
        {"type": "crossword", "kind": "crossword", "left": 48, "top": 110, "width": 500, "height": 300,
         "words": WORDS, "showAnswers": False, "showClues": True},
        {"type": "text", "kind": "text", "text": "1. 12 ta jasorat", "partOf": "crossword"},
    ]}]}
    system = _build(deck)
    assert '"type": "crossword"' in system or '"type":"crossword"' in system
    assert "GERAKL" in system and "Misr xudosi" in system
    assert '"partOf"' in system


def test_crossword_from_raw_fabric_json_is_shown_as_element():
    raw = {"type": "group", "ssKitItem": "crossword", "ssRole": "cw_grid",
           "cwData": json.dumps({"words": WORDS, "showAnswers": True, "showClues": False}), "objects": [{"type": "rect"}] * 40}
    b = pb._crossword_brief(raw)
    assert b["type"] == "crossword" and b["showAnswers"] is True and b["showClues"] is False
    assert [w["answer"] for w in b["words"]] == ["GERAKL", "ANUBIS"]
    assert pb._crossword_brief({"type": "group", "ssKitItem": "crossword", "cwData": "{bad"}) is None
    assert pb._crossword_brief({"type": "rect"}) is None
