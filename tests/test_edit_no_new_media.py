"""An edit of existing slides (colour, text, layout …) never searches / adds new pictures; a request for a picture
or new slides still may."""
import pytest

import main
from test_batch_search_first import ai, _turn  # noqa: F401  (fixture + helper)

pytestmark = pytest.mark.timeout(60)

EDITS = [
    "3-slaydning sarlavha rangini qizil qil",
    "rasmlarni o'chirma o'zgartirma, faqat to'g'rilab joylashtirib ber",
    "2-slayddagi rasmni chapga sur",
    "orqa fonni ko'k rangga o'zgartir",
    "sarlavha qo'sh",
    "make the title bigger",
    "сделай заголовок жирным",
]
ADDS = ["mushuk rasmi qo'sh", "2-slaydga boshqa rasm qo'y", "mushuk qo'sh", "yangi slayd qo'sh quyosh haqida",
        "add a photo of Tashkent", "добавь картинку кошки", "rasmlarni o'chirma, lekin yangi rasm qo'sh"]


@pytest.mark.parametrize("text", EDITS)
def test_edits_do_not_search(text):
    assert main._turn_may_search(text) is False


@pytest.mark.parametrize("text", ADDS)
def test_picture_requests_still_search(text):
    assert main._turn_may_search(text) is True


def test_edit_turn_has_no_tool_and_says_so(ai, client):  # noqa: F811
    got = _turn(client, "3-slaydning sarlavha rangini qizil qil, rasmlarni o'zgartirma")
    assert got[-1]["type"] == "end"
    call = ai["calls"][0]
    assert not call.get("tools")                                   # the AI cannot search
    assert ai["searches"] == [] and ai["planner"] == []
    assert "[TAHRIR — YANGI RASM YO'Q]" in call["messages"][-1]["content"]


def test_prompt_has_the_edit_rule():
    p = main._read_default_system_prompt()
    assert "EDIT ≠ NEW CONTENT" in p and "NOT when editing existing slides" in p


@pytest.mark.parametrize("text,want", [
    ("3 slaydni rangini o'zgartir", False),          # slide NUMBER 3, not 3 slides
    ("2 slayddagi rasmni chapga sur", False),
    ("5-slaydni tuzat", False),
    ("taqdimotdagi xatoni tuzat", False),            # «tuz» inside «tuzat»
    ("taqdimotni chiroyli qil", False),
    ("Kosmos haqida 5 ta slayd yarat", True),
    ("add 3 slides about cats", True),
    ("3 slaydli taqdimot yasa", True),
    ("4 slayd yarat", True),
    ("Make a presentation about Uzbekistan", True),
    ("Iqlim haqida taqdimot tayyorla", True),
    ("create a short presentation on AI", True),
    ("сделай презентацию о космосе", True),
])
def test_new_deck_detection(text, want):
    assert main._is_multi_slide_request(text) is want


def test_edit_with_slide_number_runs_no_presearch(ai, client):  # noqa: F811
    _turn(client, "3 slaydni rangini o'zgartir")
    assert ai["planner"] == [] and ai["searches"] == []
    assert not ai["calls"][0].get("tools")
