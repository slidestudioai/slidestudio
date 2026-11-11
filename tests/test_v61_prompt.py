"""v61: system prompt — til qoidasi eng boshida, bo'lim raqamlari takrorlanmaydi, ziddiyatli qoidalar yo'q."""
import re

import main


def _prompt() -> str:
    return main._read_default_system_prompt()


def test_language_rule_is_first():
    p = _prompt()
    assert p.find("RULE #1 — REPLY LANGUAGE") < 1500
    assert "NEVER answer in Uzbek unless the user wrote in Uzbek" in p
    assert '"hello"' in p and '"привет"' in p


def test_section_numbers_unique():
    nums = re.findall(r"^### ([0-9]+[A-Za-z]?)[.)]", _prompt(), re.M)
    dup = {n for n in nums if nums.count(n) > 1}
    assert not dup, dup
    assert not re.search(r"^2[789]\)", _prompt(), re.M)


def test_no_conflicting_rules():
    p = _prompt()
    assert "url set to a short ENGLISH search phrase" not in p           # GIF: faqat qidiruvdan kelgan URL
    assert "prefer 28–32" not in p and "card.left + 28" not in p          # padding hamma joyda 24
    assert "height comes from the text" not in p                         # text height majburiy
    assert "section 29" not in p
    assert "replace_slide has non-empty elements" in p
    assert p.find("### 0D. TITLE SLIDE") < p.find("### 2. LAYOUT LAW")


def test_server_balance_block_example_is_logical():
    src = open(main.__file__, encoding="utf-8").read()
    assert "masalan 10 ta, balans" not in src
    assert "masalan {bal + 10} ta" in src
    assert 'action = \\"create_slides\\" count=N yoki' not in src
