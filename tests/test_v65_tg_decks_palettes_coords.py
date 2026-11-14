"""Test coordinate safety guards and multi-color palettes in tg_decks."""
import pytest
from backend import tg_decks as td


def test_constants():
    assert td.TOP_STRIPE_SAFE_Y == 0
    assert td.TOP_STRIPE_MAX_H == 28
    assert td.MIN_CONTENT_Y == 70
    assert td.TOP_STRIPE_MAX_Y == 30
    assert td.MIN_TITLE_Y == 70


def test_palettes():
    assert len(td.CHART_PALETTES) == 7
    assert "ocean" in td.CHART_PALETTES
    assert td.DEFAULT_PALETTE == td.CHART_PALETTES["ocean"]
    assert td.get_palette("ocean") == td.CHART_PALETTES["ocean"]
    assert td.get_palette({"name": "violet"}) == td.CHART_PALETTES["violet"]
    assert td.get_palette({"primary": "#1D4ED8"}) == td.CHART_PALETTES["ocean"]
    assert len(td.series_colors({"name": "forest"}, 10)) == 10


def test_guard_item_coords():
    # Decorative stripe near top is clamped
    deco = {"t": "rect", "x": 0, "y": 15, "w": 960, "h": 25}
    guarded = td._guard_item_coords(deco)
    assert guarded["y"] <= 10
    assert guarded["h"] <= 20

    # Title is clamped to at least MIN_TITLE_Y (70)
    title = {"t": "text", "x": 56, "y": 38, "w": 800, "h": 50, "bold": True, "size": 28}
    guarded_title = td._guard_item_coords(title)
    assert guarded_title["y"] >= 70


def test_stats_and_charts_scenes():
    deck = {
        "title": "Test Presentation",
        "theme": "ocean",
        "slides": [
            {"layout": "title", "title": "Title Slide"},
            {
                "layout": "bullets",
                "title": "Bullets Slide",
                "bullets": ["Point 1", "Point 2"],
                "buttons": [
                    {"text": "Btn 1", "url": "https://a.com"},
                    {"text": "Btn 2", "url": "https://b.com"}
                ]
            },
            {
                "layout": "stats",
                "title": "Stats Slide",
                "stats": [
                    {"value": "99%", "label": "Accuracy"},
                    {"value": "2x", "label": "Speed"}
                ]
            },
            {
                "layout": "chart",
                "chart": "bar",
                "title": "Chart Slide",
                "labels": ["Q1", "Q2", "Q3"],
                "series": [{"name": "Revenue", "values": [10, 20, 30]}]
            },
            {"layout": "closing", "title": "Closing"}
        ]
    }
    scenes = td.build_scenes(deck)
    assert len(scenes) == 5

    # Check stats scene uses different colors for stat items
    stats_scene = scenes[2]
    stat_accent_rects = [it for it in stats_scene.items if it["t"] == "rect" and it.get("w") == 44 and it.get("h") == 6]
    assert len(stat_accent_rects) == 2
    assert stat_accent_rects[0]["fill"] != stat_accent_rects[1]["fill"]


def test_tenor_prefers_medium_gif_when_full_is_big(monkeypatch):
    from backend import gif_search as gs
    big = gs.MAX_BYTES + 1
    monkeypatch.setattr(gs, "_get_json", lambda url: {"results": [
        {"media_formats": {"gif": {"url": "https://t/big.gif", "size": big, "dims": [498, 280]},
                           "mediumgif": {"url": "https://t/med.gif", "size": 900000, "dims": [320, 180]},
                           "tinygif": {"url": "https://t/tiny.gif"}}},
        {"media_formats": {"gif": {"url": "https://t/small.gif", "size": 500000, "dims": [200, 100]},
                           "tinygif": {"url": "https://t/tiny2.gif"}}}]})
    out, _ = gs._tenor("cat", 8, 1)
    assert [o["url"] for o in out] == ["https://t/med.gif", "https://t/small.gif"]
    assert out[0]["width"] == 320


def test_prompt_has_no_default_decorative_lines():
    import main
    p = main._read_default_system_prompt()
    assert "NO DECORATIVE LINES" in p
    assert "accent bar or divider line under titles" not in p
