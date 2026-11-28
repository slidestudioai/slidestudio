"""v83: the editor's last deck in the cloud — one per account, 3 days, newest wins."""
from datetime import datetime, timedelta, timezone

import pytest

from backend.services import drafts

DECK = {"v": 2, "title": "Kosmos", "activeIndex": 0, "slides": [{"json": "{\"objects\":[]}", "thumb": ""}]}


@pytest.fixture()
def user(sb):
    sb.add_user("t1", "u-1", "one@x.uz")
    sb.add_user("t2", "u-2", "two@x.uz")
    return sb


def _save(client, tok, deck=DECK, saved_at=1000):
    return client.post("/api/draft/save", json={"deck": deck, "saved_at": saved_at}, headers={"Authorization": "Bearer " + tok})


def test_save_and_load_on_another_device(user, client):
    r = _save(client, "t1")
    assert r.status_code == 200 and r.json()["ok"] is True
    got = client.post("/api/draft/load", json={}, headers={"Authorization": "Bearer t1"}).json()
    assert got["deck"]["title"] == "Kosmos" and got["saved_at"] == 1000 and got["ttl_days"] == 3
    # another account never sees it
    assert client.post("/api/draft/load", json={"token": "t2"}).json()["deck"] is None


def test_login_required(user, client):
    assert _save(client, "bad").status_code == 401
    assert client.post("/api/draft/save", json={"deck": DECK}).status_code == 401
    assert client.post("/api/draft/load", json={}).json() == {"deck": None}


def test_older_save_does_not_overwrite_a_newer_one(user, client):
    _save(client, "t1", dict(DECK, title="Yangi"), saved_at=5000)
    r = _save(client, "t1", dict(DECK, title="Eski"), saved_at=3000).json()          # an old tab / phone saves later
    assert r.get("kept_newer") is True
    assert client.post("/api/draft/load", json={"token": "t1"}).json()["deck"]["title"] == "Yangi"
    _save(client, "t1", dict(DECK, title="Eng yangi"), saved_at=9000)
    assert client.post("/api/draft/load", json={"token": "t1"}).json()["deck"]["title"] == "Eng yangi"


def test_future_clock_is_clamped(user, client):
    far = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp() * 1000)
    assert _save(client, "t1", saved_at=far).json()["saved_at"] <= int(datetime.now(timezone.utc).timestamp() * 1000)


def test_older_than_3_days_is_not_returned_and_is_deleted(user, client):
    _save(client, "t1")
    old = (datetime.now(timezone.utc) - timedelta(days=3, minutes=1)).isoformat()
    user.tables["cloud_drafts"][0]["updated_at"] = old
    got = client.post("/api/draft/load", json={"token": "t1"}).json()
    assert got["deck"] is None and got.get("expired") is True
    assert user.tables["cloud_drafts"] == []


def test_purge_removes_only_expired(user, client):
    _save(client, "t1")
    _save(client, "t2")
    user.tables["cloud_drafts"][0]["updated_at"] = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    assert drafts.purge_expired(force=True) == 1
    assert [r["user_id"] for r in user.tables["cloud_drafts"]] == ["u-2"]


def test_too_big_or_empty_deck(user, client, monkeypatch):
    monkeypatch.setattr(drafts, "MAX_DRAFT_BYTES", 100)
    assert _save(client, "t1", dict(DECK, title="x" * 500)).status_code == 413
    assert _save(client, "t1", {"slides": []}).status_code == 400


def test_delete(user, client):
    _save(client, "t1")
    assert client.post("/api/draft/delete", json={"token": "t1"}).status_code == 200
    assert client.post("/api/draft/load", json={"token": "t1"}).json()["deck"] is None


def test_missing_table_gives_clear_error(user, client):
    user.fail_tables.add("cloud_drafts")
    r = _save(client, "t1")
    assert r.status_code == 502
