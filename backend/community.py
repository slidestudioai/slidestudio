"""
backend/community.py — Referral (do'st taklif qilish, +15 varaq) va Feedback (Instagram uslubidagi fikrlar).

main.py dan:   from backend.community import register_community; register_community(app, ctx)
ctx — main.py dagi funksiyalarga havolalar (aylanma import bo'lmasligi uchun).

Supabase jadvallari (README dagi SQL ni bir marta ishga tushiring):
  referral_codes(user_id pk, code unique)
  referrals(invitee_id pk, inviter_id, code, pages, created_at)
  feedback_posts(id uuid pk, user_id, author, body, parent_id, created_at)
  feedback_likes(post_id, user_id, pk(post_id,user_id))
"""
import asyncio
import hashlib
import hmac
import os
import re
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse

REFERRAL_BONUS_PAGES = 15
MAX_REWARDED_REFERRALS = 100
NEW_ACCOUNT_WINDOW_DAYS = 3
POST_MAX_LEN = 1000
POST_COOLDOWN_SEC = 8

_last_post_at: Dict[str, float] = {}
_mem_codes: Dict[str, str] = {}
api: Dict[str, Any] = {}          # register_community to'ldiradi: api["claim"], api["stats"] — Telegram bot ham shundan foydalanadi

def _json(data: dict, status: int = 200):
    return JSONResponse(data, status_code=status)

def _make_code(user_id: str) -> str:
    secret = (os.environ.get("SLIDE_STUDIO_HMAC_SECRET") or "slide-studio-change-me").encode()
    digest = hmac.new(secret, ("ref:" + user_id).encode(), hashlib.sha256).digest()
    import base64
    return base64.b32encode(digest).decode().rstrip("=")[:8]

def register_community(app: FastAPI, ctx: Dict[str, Any]):
    get_sb = ctx["get_supabase"]
    user_lock = ctx["user_lock"]
    get_usage = ctx["get_or_create_user_usage"]
    save_credits = ctx["save_user_credits"]
    add_paid = ctx["add_paid_credits"]
    notify = ctx.get("notify")          # async (user_id, html_text) — taklif qilgan odamga Telegram xabari
    is_admin_email = ctx.get("is_admin_email") or (lambda email: False)   # v60: izohlarni pin qilish / o'chirish huquqi

    def is_admin(user) -> bool:
        try:
            return bool(user and is_admin_email(str(getattr(user, "email", "") or "").strip().lower()))
        except Exception:
            return False

    def auth(token: str):
        sb = get_sb()
        if not sb or not token:
            return None
        try:
            r = sb.auth.get_user(token)
            if r and r.user:
                return r.user
        except Exception as e:
            print(f"[COMMUNITY AUTH] {str(e)[:120]}")
        return None

    def display_name(user) -> str:
        meta = getattr(user, "user_metadata", None) or {}
        name = (meta.get("full_name") or meta.get("name") or "").strip()
        if not name:
            email = (getattr(user, "email", "") or "").strip()
            name = email.split("@")[0] if email else "Foydalanuvchi"
        return name[:40]

    def no_db():
        return _json({"error": "Server bazasi ulanmagan (Supabase)."}, 503)

    async def stats(uid: str) -> Dict[str, Any]:
        """{'code','invited','bonus_total','bonus_per_friend'} yoki {'error','status'}."""
        sb = get_sb()
        if not sb:
            return {"error": "Server bazasi ulanmagan (Supabase).", "status": 503}
        code = _make_code(uid)
        try:
            await asyncio.to_thread(
                lambda: sb.table("referral_codes").upsert({"user_id": uid, "code": code}, on_conflict="user_id").execute())
        except Exception as e:
            print(f"[REFERRAL] referral_codes xato: {str(e)[:150]}")
            return {"error": "Taklif jadvallari yaratilmagan (SUPABASE_SCHEMA.sql ni ishga tushiring).", "status": 503}
        invited, bonus = 0, 0
        try:
            res = await asyncio.to_thread(
                lambda: sb.table("referrals").select("pages").eq("inviter_id", uid).execute())
            rows = res.data or []
            invited = len(rows)
            bonus = sum(int(r.get("pages") or 0) for r in rows)
        except Exception:
            pass
        return {"code": code, "invited": invited, "bonus_total": bonus, "bonus_per_friend": REFERRAL_BONUS_PAGES}

    async def do_claim(invitee: str, created: Any, code: str) -> Dict[str, Any]:
        """Taklif bonusini hisoblaydi (taklif qilgan odamga +REFERRAL_BONUS_PAGES). {'ok':True} yoki {'ok':False,'error':...}."""
        sb = get_sb()
        if not sb:
            return {"error": "Server bazasi ulanmagan (Supabase).", "status": 503}
        code = str(code or "").strip().upper()
        if not re.fullmatch(r"[A-Z0-9]{6,12}", code):
            return {"ok": False, "error": "Havola noto'g'ri", "status": 400}
        invitee = str(invitee)
        try:
            if created is None:
                r = await asyncio.to_thread(lambda: sb.auth.admin.get_user_by_id(invitee))
                created = getattr(getattr(r, "user", None), "created_at", None)
            if isinstance(created, str):
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if created and created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
        except Exception as e:
            print(f"[REFERRAL] akkaunt sanasini o'qib bo'lmadi: {str(e)[:120]}")
            created = None
        # v53: sana aniqlanmasa bonus BERILMAYDI (avval xatoda tekshiruv o'tkazib yuborilib, eski akkaunt ham bonus olardi)
        if not isinstance(created, datetime):
            return {"ok": False, "error": "Hozir tekshirib bo'lmadi. Birozdan keyin qayta urinib ko'ring.", "status": 503}
        if datetime.now(timezone.utc) - created > timedelta(days=NEW_ACCOUNT_WINDOW_DAYS):
            return {"ok": False, "error": "Bonus faqat yangi akkaunt ochganlar uchun"}
        try:
            res = await asyncio.to_thread(
                lambda: sb.table("referral_codes").select("user_id").eq("code", code).limit(1).execute())
            if not res.data:
                return {"ok": False, "error": "Havola topilmadi"}
            inviter = str(res.data[0]["user_id"])
        except Exception as e:
            print(f"[REFERRAL] code lookup: {str(e)[:150]}")
            return {"error": "Taklif jadvallari yaratilmagan", "status": 503}
        if inviter == invitee:
            return {"ok": False, "error": "O'zingizning havolangiz"}
        try:        # bir kishi faqat bir marta taklif orqali hisoblanadi (bazadagi PK dan tashqari ikkinchi himoya)
            ex = await asyncio.to_thread(
                lambda: sb.table("referrals").select("invitee_id").eq("invitee_id", invitee).limit(1).execute())
            if ex.data:
                return {"ok": False, "error": "Siz allaqachon taklif orqali kirgansiz"}
        except Exception:
            pass
        try:
            cnt = await asyncio.to_thread(
                lambda: sb.table("referrals").select("invitee_id", count="exact").eq("inviter_id", inviter).execute())
            if (getattr(cnt, "count", None) or len(cnt.data or [])) >= MAX_REWARDED_REFERRALS:
                return {"ok": False, "error": "Taklif qiluvchi bonus chegarasiga yetgan"}
        except Exception:
            pass
        try:
            await asyncio.to_thread(lambda: sb.table("referrals").insert(
                {"invitee_id": invitee, "inviter_id": inviter, "code": code, "pages": REFERRAL_BONUS_PAGES}).execute())
        except Exception as e:
            m = str(e).lower()
            if "duplicate" in m or "23505" in m or "unique" in m:
                return {"ok": False, "error": "Siz allaqachon taklif orqali kirgansiz"}
            print(f"[REFERRAL] insert: {str(e)[:150]}")
            return {"error": "Taklif jadvallari yaratilmagan", "status": 503}
        try:
            async with user_lock(inviter):
                atomic = ctx.get("update_usage_atomic")
                if atomic:          # v53: optimistic lock — parallel to'lov/yechish bilan to'qnashmaydi
                    await asyncio.to_thread(atomic, inviter, "", lambda u: (add_paid(u, REFERRAL_BONUS_PAGES), None))
                else:
                    u = await asyncio.to_thread(get_usage, inviter, "")
                    u = add_paid(u, REFERRAL_BONUS_PAGES)
                    await asyncio.to_thread(save_credits, inviter, u, 0)
            print(f"[REFERRAL] +{REFERRAL_BONUS_PAGES} varaq → {inviter} (taklif: {invitee})")
        except Exception as e:
            try:
                await asyncio.to_thread(lambda: sb.table("referrals").delete().eq("invitee_id", invitee).execute())
            except Exception:
                pass
            print(f"[REFERRAL] kredit xato: {e}")
            return {"error": "Bonusni yozib bo'lmadi", "status": 500}
        if notify:                      # taklif qilgan odamga Telegramda darhol xabar
            try:
                asyncio.get_running_loop().create_task(notify(
                    inviter, f"🎁 <b>Do'stingiz sizning havolangiz orqali qo'shildi!</b>\n+{REFERRAL_BONUS_PAGES} varaq balansingizga qo'shildi."))
            except Exception:
                pass
        return {"ok": True, "inviter": inviter, "pages": REFERRAL_BONUS_PAGES}

    api["claim"] = do_claim
    api["stats"] = stats

    @app.get("/api/referral/me")
    async def referral_me(token: str = ""):
        if not get_sb():
            return no_db()
        user = await asyncio.to_thread(auth, token)
        if not user:
            return _json({"error": "Avval tizimga kiring"}, 401)
        r = await stats(str(user.id))
        return _json(r, r.pop("status", 200)) if "error" in r else r

    @app.post("/api/referral/claim")
    async def referral_claim(payload: Dict[str, Any]):
        if not get_sb():
            return no_db()
        user = await asyncio.to_thread(auth, str(payload.get("token") or ""))
        if not user:
            return _json({"error": "Avval tizimga kiring"}, 401)
        r = await do_claim(str(user.id), getattr(user, "created_at", None), str(payload.get("code") or ""))
        st = r.pop("status", 200)
        return _json(r, st) if st != 200 else r

    def _shape(row: dict, likes_map: Dict[str, int], liked: set, me: Optional[str]) -> dict:
        return {
            "id": row["id"],
            "author": row.get("author") or "Foydalanuvchi",
            "body": row.get("body") or "",
            "created_at": row.get("created_at"),
            "likes": likes_map.get(row["id"], 0),
            "liked": row["id"] in liked,
            "mine": bool(me and row.get("user_id") == me),
            "pinned": bool(row.get("pinned_at")),
            "replies": [],
        }

    def _list_tops(sb, offset: int, limit: int):
        """v60: pin qilingan izohlar ENG TEPADA (pinned_at bo'yicha), qolgani yangi -> eski.
        pinned_at ustuni hali yo'q bo'lsa (SQL qayta ishga tushirilmagan) — eski tartib."""
        base = lambda: sb.table("feedback_posts").select("*", count="exact").is_("parent_id", "null")
        try:
            return (base().order("pinned_at", desc=True, nullsfirst=False).order("created_at", desc=True)
                    .range(offset, offset + limit - 1).execute())
        except Exception as e:
            if "pinned_at" not in str(e):
                raise
            return base().order("created_at", desc=True).range(offset, offset + limit - 1).execute()

    @app.get("/api/feedback/list")
    async def feedback_list(limit: int = 15, offset: int = 0, token: str = ""):
        sb = get_sb()
        if not sb:
            return no_db()
        limit = max(1, min(30, int(limit)))
        offset = max(0, int(offset))
        user = await asyncio.to_thread(auth, token) if token and token != "dev-token" else None
        me = str(user.id) if user else None
        try:
            top = await asyncio.to_thread(_list_tops, sb, offset, limit)
            tops = top.data or []
            total = getattr(top, "count", None) or (offset + len(tops))
            ids = [t["id"] for t in tops]
            replies = []
            if ids:
                rr = await asyncio.to_thread(lambda: sb.table("feedback_posts").select("*")
                                             .in_("parent_id", ids).order("created_at").execute())
                replies = rr.data or []
            all_ids = ids + [r["id"] for r in replies]
            likes_map: Dict[str, int] = {}
            liked: set = set()
            if all_ids:
                lk = await asyncio.to_thread(lambda: sb.table("feedback_likes").select("post_id,user_id")
                                             .in_("post_id", all_ids).execute())
                for row in (lk.data or []):
                    likes_map[row["post_id"]] = likes_map.get(row["post_id"], 0) + 1
                    if me and row["user_id"] == me:
                        liked.add(row["post_id"])
        except Exception as e:
            print(f"[FEEDBACK LIST] {str(e)[:200]}")
            return _json({"error": "Fikrlar jadvallari yaratilmagan (README dagi SQL ni ishga tushiring)."}, 503)
        by_id = {t["id"]: _shape(t, likes_map, liked, me) for t in tops}
        for r in replies:
            p = by_id.get(r.get("parent_id"))
            if p is not None:
                p["replies"].append(_shape(r, likes_map, liked, me))
        return {"posts": [by_id[i] for i in ids], "total": total, "is_admin": is_admin(user)}

    @app.post("/api/feedback/pin")
    async def feedback_pin(payload: Dict[str, Any]):
        """v60: admin izohni tepaga qadaydi (pin) yoki qadashni olib tashlaydi."""
        sb = get_sb()
        if not sb:
            return no_db()
        user = await asyncio.to_thread(auth, str(payload.get("token") or ""))
        if not user:
            return _json({"error": "Avval tizimga kiring"}, 401)
        if not is_admin(user):
            return _json({"error": "Faqat admin izohni qadab qo'ya oladi"}, 403)
        try:
            pid = str(uuid.UUID(str(payload.get("id") or "")))
        except ValueError:
            return _json({"error": "Noto'g'ri izoh"}, 400)
        on = bool(payload.get("pinned", True))
        try:
            pr = await asyncio.to_thread(lambda: sb.table("feedback_posts").select("id,parent_id").eq("id", pid).limit(1).execute())
            if not pr.data:
                return _json({"error": "Izoh topilmadi"}, 404)
            if pr.data[0].get("parent_id"):
                return _json({"error": "Faqat asosiy izohni qadash mumkin (javobni emas)"}, 400)
            val = datetime.now(timezone.utc).isoformat() if on else None
            await asyncio.to_thread(lambda: sb.table("feedback_posts").update({"pinned_at": val}).eq("id", pid).execute())
        except Exception as e:
            print(f"[FEEDBACK PIN] {str(e)[:200]}")
            if "pinned_at" in str(e):
                return _json({"error": "Bazada pinned_at ustuni yo'q — SUPABASE_SCHEMA.sql ni qayta ishga tushiring."}, 503)
            return _json({"error": "Saqlab bo'lmadi"}, 503)
        return {"ok": True, "pinned": on}

    @app.post("/api/feedback/post")
    async def feedback_post(payload: Dict[str, Any]):
        sb = get_sb()
        if not sb:
            return no_db()
        user = await asyncio.to_thread(auth, str(payload.get("token") or ""))
        if not user:
            return _json({"error": "Avval tizimga kiring"}, 401)
        uid = str(user.id)
        body = str(payload.get("body") or "").strip()
        if len(body) < 2:
            return _json({"error": "Matn juda qisqa"}, 400)
        body = body[:POST_MAX_LEN]
        now = time.time()
        if now - _last_post_at.get(uid, 0) < POST_COOLDOWN_SEC:
            return _json({"error": "Iltimos, biroz kuting va qayta yuboring"}, 429)
        parent_id = payload.get("parent_id") or None
        if parent_id:
            try:
                parent_id = str(uuid.UUID(str(parent_id)))
                pr = await asyncio.to_thread(lambda: sb.table("feedback_posts").select("id,parent_id")
                                             .eq("id", parent_id).limit(1).execute())
                if not pr.data:
                    return _json({"error": "Izoh topilmadi (o'chirilgan bo'lishi mumkin)"}, 404)
                if pr.data[0].get("parent_id"):
                    parent_id = pr.data[0]["parent_id"]
            except ValueError:
                return _json({"error": "Noto'g'ri izoh"}, 400)
            except Exception as e:
                print(f"[FEEDBACK POST parent] {str(e)[:150]}")
                return _json({"error": "Fikrlar jadvallari yaratilmagan"}, 503)
        row = {"id": str(uuid.uuid4()), "user_id": uid, "author": display_name(user), "body": body,
               "parent_id": parent_id, "created_at": datetime.now(timezone.utc).isoformat()}
        try:
            await asyncio.to_thread(lambda: sb.table("feedback_posts").insert(row).execute())
        except Exception as e:
            print(f"[FEEDBACK POST] {str(e)[:200]}")
            return _json({"error": "Fikrlar jadvallari yaratilmagan"}, 503)
        _last_post_at[uid] = now
        if len(_last_post_at) > 5000:
            _last_post_at.clear()
        return {"post": _shape(row, {}, set(), uid)}

    def _like_count(sb, pid: str) -> int:
        """Bitta post uchun HAQIQIY layk soni (barcha foydalanuvchilar bo'yicha)."""
        try:
            cnt = sb.table("feedback_likes").select("post_id", count="exact").eq("post_id", pid).execute()
            n = getattr(cnt, "count", None)
            if n is not None:
                return int(n)
            return len(cnt.data or [])
        except Exception:
            try:
                res = sb.table("feedback_likes").select("user_id").eq("post_id", pid).execute()
                return len(res.data or [])
            except Exception:
                return 0

    @app.post("/api/feedback/like")
    async def feedback_like(payload: Dict[str, Any]):
        sb = get_sb()
        if not sb:
            return no_db()
        user = await asyncio.to_thread(auth, str(payload.get("token") or ""))
        if not user:
            return _json({"error": "Avval tizimga kiring"}, 401)
        uid = str(user.id)
        try:
            pid = str(uuid.UUID(str(payload.get("id") or "")))
        except ValueError:
            return _json({"error": "Noto'g'ri izoh"}, 400)

        want = payload.get("liked")
        want = None if want is None else bool(want)

        def _toggle() -> bool:
            ex = sb.table("feedback_likes").select("post_id").eq("post_id", pid).eq("user_id", uid).execute()
            currently = bool(ex.data)
            target = (not currently) if want is None else want
            if target == currently:
                return currently
            if target:
                try:
                    sb.table("feedback_likes").insert({"post_id": pid, "user_id": uid}).execute()
                except Exception as ie:

                    m = str(ie).lower()
                    if not ("duplicate" in m or "23505" in m or "unique" in m):
                        raise
            else:
                sb.table("feedback_likes").delete().eq("post_id", pid).eq("user_id", uid).execute()
            return target

        try:
            liked = await asyncio.to_thread(_toggle)

            likes = await asyncio.to_thread(_like_count, sb, pid)
        except Exception as e:
            print(f"[FEEDBACK LIKE] {str(e)[:200]}")
            return _json({"error": "Layk saqlanmadi"}, 503)
        return {"liked": liked, "likes": likes}

    @app.post("/api/feedback/delete")
    async def feedback_delete(payload: Dict[str, Any]):
        sb = get_sb()
        if not sb:
            return no_db()
        user = await asyncio.to_thread(auth, str(payload.get("token") or ""))
        if not user:
            return _json({"error": "Avval tizimga kiring"}, 401)
        uid = str(user.id)
        try:
            pid = str(uuid.UUID(str(payload.get("id") or "")))
        except ValueError:
            return _json({"error": "Noto'g'ri izoh"}, 400)
        try:
            pr = await asyncio.to_thread(lambda: sb.table("feedback_posts").select("id,user_id")
                                         .eq("id", pid).limit(1).execute())
            if not pr.data:
                return {"ok": True}
            if str(pr.data[0].get("user_id")) != uid and not is_admin(user):   # v60: admin har qanday izohni o'chira oladi
                return _json({"error": "Faqat o'zingiz yozganini o'chira olasiz"}, 403)
            kids = await asyncio.to_thread(lambda: sb.table("feedback_posts").select("id").eq("parent_id", pid).execute())
            ids = [pid] + [k["id"] for k in (kids.data or [])]
            await asyncio.to_thread(lambda: sb.table("feedback_likes").delete().in_("post_id", ids).execute())
            await asyncio.to_thread(lambda: sb.table("feedback_posts").delete().eq("parent_id", pid).execute())
            await asyncio.to_thread(lambda: sb.table("feedback_posts").delete().eq("id", pid).execute())
        except Exception as e:
            print(f"[FEEDBACK DELETE] {str(e)[:200]}")
            return _json({"error": "O'chirib bo'lmadi"}, 503)
        return {"ok": True}
