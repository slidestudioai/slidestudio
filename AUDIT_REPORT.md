# Slide Studio — Production Audit (100k concurrent users)

Date: 2026-11-17. Scope: `main.py` (FastAPI + WebSocket AI), `backend/*` (billing, bot, admin),
`SUPABASE_SCHEMA.sql`, frontend `js/*`, Dodo Payments webhook, deploy (`Dockerfile`, `render.yaml`).

Status legend: **FIXED** = done in this branch with tests. **TODO** = proposed, waiting for your OK.

## What is already good

- The Dodo webhook checks the signature, rejects old timestamps (5 min) and uses an atomic, idempotent SQL
  function (`apply_payment`, `ON CONFLICT DO NOTHING` in one transaction). The same payment cannot add credits twice.
- The checkout price is signed with HMAC. The client cannot change the amount.
- Balance writes use optimistic locking (CAS), so a payment and an AI charge at the same time do not erase each other (mostly — see H2).
- The image/video proxy has real SSRF protection (checks the connected IP, safe redirects).
- RLS is on for all tables, and `anon`/`authenticated` roles have no table rights. Only the server key can read/write.
- Supabase calls inside `async` code are sent to a thread pool (no event-loop freeze found).
- Credits are charged **after** generation, and nothing is charged when the AI fails with no answer.

---

## CRITICAL

### C1. Free slides: the charge was capped at the balance — **FIXED**
- Files: `backend/monitoring.py` (`charge_for_ai_turn`), `main.py` (WS charge).
- Problem: the AI answer is streamed to the browser and the browser applies the actions itself. The server
  then charged `min(cost, balance)`. A user with 0.25 page could write "make 30 slides" (or inject
  "ignore the balance rules") and get 30 slides for 0.25 page. The client-side balance text in `system_hint`
  is also editable by the user.
- Fix: the full cost is charged. The part above the balance becomes a **debt** (negative `paid_credits`),
  limited by `MAX_DEBT_PAGES` (default 10). Debt is repaid by the next daily reset or a purchase. While in debt,
  `can_afford()` is false. The UI never shows negative numbers (`usage_payload` folds debt; new field `debt_units`).

### C2. "Generate" spam / many tabs started parallel turns — **FIXED (per worker)**
- File: `main.py` (`ws_chat`).
- Problem: the balance is checked before the AI call, charged after. 10 tabs → 10 turns all pass the check at once.
- Fix: max 1 AI turn per user at a time (`MAX_AI_INFLIGHT_PER_USER`). A second request gets `AI_BUSY` with a clear message.
  Together with C1 the worst case is bounded by `MAX_DEBT_PAGES`. The counter is per worker process — see H1 for the Redis version.

### C3. User closes the tab → AI keeps generating and we keep paying — **FIXED**
- File: `main.py` (stream loop).
- Problem: on disconnect the loop stopped reading, but the HTTP stream to DeepSeek was not closed. DeepSeek kept
  generating (paid tokens) and the pooled connection stayed busy until garbage collection. At 100k users this
  drains the connection pool.
- Fix: `try/finally: await _close_ai_stream(stream)` on every exit.

### C4. Login token written to server logs — **FIXED**
- Files: `js/04_websocket_stream.js`, `js/03_auth_project.js`, `js/35_v45_tglink.js`, `js/13_community.js`,
  `main.py` (`/api/user/usage`), `backend/community.py`.
- Problem: the Supabase access token was put in URLs (`/ws/chat?token=`, `/api/user/usage?token=` …).
  Gunicorn runs with `--access-logfile -`, so every token went into Render logs in plain text (also proxy logs,
  browser history). Anyone with log access could act as any user for ~1 hour.
- Fix: the token goes in the `Authorization: Bearer` header (WebSocket: only in the message body, as the server already
  expected). Query `?token=` still works on the server for old cached pages only.

### C5. Production ignored the WebSocket limits → OOM risk — **FIXED**
- Files: new `backend/worker.py`, `Dockerfile`, `render.yaml`, `requirements.txt`.
- Problem: production runs `gunicorn ... UvicornWorker`, so the settings in `uvicorn.run(...)` were never used.
  Default WebSocket frame limit = 16 MB per message. A few hundred big messages (parsed JSON is 5–10× bigger in RAM)
  kill a 512 MB instance.
- Fix: `SlideStudioWorker` with `ws_max_size=4 MB` (`WS_MAX_SIZE`), ping 25 s / timeout 60 s (dead mobile
  connections are freed). Uses the maintained `uvicorn-worker` package.

---

## HIGH

### H1. All limits and locks live in one process's memory — **TODO (in-memory fallback kept, no Redis yet)**
- Files: `main.py` (`_RL`, `_UWIN`, `_TOK_CACHE`, `_AI_INFLIGHT`, `_user_locks`, `ws_count`, `bump_msg`), `backend/scaling.py`.
- With 4 workers (and more instances later): rate limits are really ×4, `DEEPSEEK_CONCURRENCY=40` is really 160
  calls, `MAX_WS` is per worker, the daily message limit resets on every restart/deploy.
- Fix: use Redis (`REDIS_URL` code already exists in `backend/scaling.py` but is unused): sliding-window rate limit
  (`INCR`+`EXPIRE`), in-flight lease (`SET uid NX EX 300`), global AI semaphore. Keep the in-memory fallback.

### H2. Charging = 4–8 Supabase HTTP calls, and the last retry can erase a payment — **FIXED (needs the SQL below)**
- Files: `main.py` (`update_usage_atomic`, `save_user_credits`, `ledger_log`, `ledger_spent`).
- Every AI turn: read row → CAS write (up to 5 tries) → ledger insert → sum of up to 5000 ledger rows.
  The **last retry writes without CAS** (`cas=attempt < retries - 1`), so under heavy conflict it can overwrite
  a payment that just arrived (money lost for the user).
- Also: if the charge fails (Supabase outage), the user gets the slides free (`charge_reason = "charge_error"`).
- Fix (done):
  - New SQL function `public.charge_units` (`SUPABASE_SCHEMA.sql`, section 13): row lock (`FOR UPDATE`), 24h reset,
    charge (free → paid → bounded debt), ledger insert and "spent since reset" — **one call, one transaction**.
    Idempotent by `charge_id` (the same id is never charged twice, also under parallel retries).
  - `main.charge_turn_atomic()` is used by the website WebSocket **and** the Telegram bot.
  - If the SQL function is not installed yet → the old CAS path is used automatically (logged once, re-checked every 10 min).
  - If Supabase is down → the charge is **queued** (not given away) and retried every 60 s with the same `charge_id`,
    and once more on shutdown/deploy. Note: the queue is in RAM — a hard crash during an outage loses it (Redis would fix this).
  - `update_usage_atomic` now always uses CAS (8 tries with jitter) and raises `UsageConflict` instead of overwriting.
  - Tested on a real PostgreSQL 16: all rules, re-running the snippet, 20 parallel charges, 5 parallel retries with one id.

### H3. Every API call asks Supabase Auth over the network — **FIXED**
- Files: `main.py` (`/api/user/usage`, payments, admin entry), `backend/community.py`.
- `supabase.auth.get_user(token)` = 1 HTTP call per request. Supabase Auth has rate limits; at 100k users it becomes
  the bottleneck and a single point of failure.
- Fix (done): new `backend/jwt_auth.py` + `main.auth_user_cached` (used by WebSocket and `/api/user/usage`).
  - Signature, `exp`, `aud=authenticated`, `iss`, `role=authenticated` are checked **locally**. Public keys come from
    `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` (ES256/RS256, cached 10 min, re-fetched on key rotation at most
    once per minute). Legacy HS256 projects: set `SUPABASE_JWT_SECRET`.
  - Junk, expired and forged tokens are rejected with **no network call** (also cached for 60 s).
  - The algorithm comes from the key, never from the token header (`alg=none` and HS256-with-public-key attacks are blocked).
  - Supabase Auth is still asked **once per session every 10 min** (`AUTH_REVALIDATE_SEC`) to catch logout / ban /
    deleted users. Before: once per minute per token. If Supabase Auth is down, tokens with a valid signature are accepted.
  - Without keys/URL (or `JWT_LOCAL_VERIFY=0`) it works exactly like before.
  - Not changed on purpose: payments, admin entry and community (they need the full user object or must be strict; low traffic).

### H4. Balance polling: ~3,300 req/s at 100k users — **FIXED**
- Files: `js/35_v45_tglink.js` (every 30 s + on focus), `main.py` `/api/user/usage` (5–6 DB calls each: auth, merge
  check, usage read/write, ledger sum, cap query). Endpoint is sync `def` → uses the small default thread pool (40).
- Fix (done):
  - Per-user cache of the `/api/user/usage` payload, 15 s (`USAGE_CACHE_TTL`). Dropped on every balance change in
    the same process (charge, webhook, `ledger_log` = admin edits / merges / purchases).
  - Token → user cache (60 s) shared by HTTP and WebSocket (`auth_user_cached`), thread-safe.
  - Background polling: every 2 min (was 30 s), on focus at most once per 30 s (was 15 s).
  - Payment and referral watchers ask `?fresh=1` (ignored if the cached value is < 2 s old), so a payment that lands on
    another worker is still shown within ~2–3 s.
  - Result at 100k open tabs: ~830 req/s instead of ~3,300, and most of them are served from memory.

### H5. Lost result when the connection drops at the end — **TODO**
- Files: `main.py` (charges when `client_gone`), `js/04_websocket_stream.js` (`onclose`).
- This is correct against abuse (the text was already streamed), but if the last chunks were lost, the user pays
  and sees nothing. Fix: keep the last finished reply per user for 10 min (Redis/DB, key = request id); the client
  sends a `request_id` and on reconnect asks `resume`; save `currentAiStreamBuffer` to `sessionStorage`.

### H6. Deep model and tool rounds can hold an AI slot for minutes — **FIXED**
- File: `main.py` (`timeout=600`, `MAX_TOOL_ROUNDS`, queue 90 s).
- One turn can take up to 10 min per call × rounds. With 40 slots, a few slow turns block everyone else.
- Fix (done):
  - `asyncio.timeout` around the whole turn (presearch + all tool rounds): `AI_TURN_DEADLINE_FAST=300`, `AI_TURN_DEADLINE_DEEP=600`.
    (Long decks legitimately take minutes, so the defaults are generous; the point is a hard upper bound.)
  - HTTP read timeout = max silence between two chunks: `AI_READ_TIMEOUT=120` (was 600 for the whole call).
  - On timeout: the stream is closed, the AI slot and the per-user slot are released. With a partial answer the client
    gets `finish_reason: "timeout"` → «Javob to'liq emas (vaqt tugadi)» + «Davom ettirish» (no auto-continue, so no loops);
    only finished actions are charged. With no answer: a clear error and **nothing is charged**.
  - The Telegram bot already had 175 s limits — not changed.

---

## MEDIUM

### M1. Prompt injection surface — **TODO**
- `system_hint` (client text, 6000 chars) is added to the **system** prompt; `chat_history` may contain fake
  assistant messages; slide texts go into the prompt. After C1 this no longer gives free credits, but it can break
  the "identity" rule and the JSON format. Fix: put client text in the user message inside clear `<untrusted>` tags,
  drop the client-side balance line (the server already sends the true balance), cap total prompt size.

### M2. Free-tier abuse with many Google accounts — **TODO**
- Each new Google account = 10 free pages/day. Fix: daily free cap per IP / device id for accounts younger than 7 days,
  and an admin view of "many accounts from one IP".

### M3. Database growth — **TODO**
- `usage_ledger`, `admin_audit`, `ad_sent` grow forever. Add retention (e.g. move > 180 days to an archive table) or
  monthly partitions on `usage_ledger`.
- `balance_cap_units` filters `kind IN (...)` after the `(user_id, created_at)` index → add
  `create index on usage_ledger (user_id, created_at desc) where kind in ('purchase','refund','admin_credit','account_merge_in','tg_link_in');`
- Refund idempotency key uses `refund_id or amount`: two partial refunds with the same amount and no id → the second is skipped.

### M4. Logging and monitoring — **TODO**
- Logs are `print()` in Uzbek with no level, user id or request id; many `except Exception: pass/continue`
  (e.g. the stream chunk loop) hide errors. No metrics.
- Fix: `logging` with JSON format + request id, Sentry for errors, Prometheus metrics: AI queue length (`_ds_waiting`),
  active AI turns, WS connections, charge failures, webhook failures.

### M5. Architecture — **TODO**
- `main.py` is 3,900 lines; `ws_chat` alone is ~750 lines (auth + limits + prompt build + AI stream + tools + billing).
- Split into: `services/auth.py` (JWT), `services/billing.py` (reserve/charge RPC), `services/prompt.py`
  (system prompt builder, pure functions → easy tests), `services/ai_stream.py` (stream + tools + close),
  `routes/ws.py` (thin handler).

### M6. UX failure states — **TODO**
- `AI_BUSY`, `LIMIT_EXCEEDED`, queue messages are Uzbek-only text from the server; send `code` + let the frontend translate (i18n exists).
- When in debt, show "−N pages will be taken from tomorrow's free pages" (field `debt_units` is now in the payload).
- Show a "Retry" button on AI errors instead of only a red toast.

---

## Configuration added

| Variable | Default | Meaning |
|---|---|---|
| `MAX_DEBT_PAGES` | 10 | Max pages a user can go below zero in one oversized turn |
| `MAX_AI_INFLIGHT_PER_USER` | 1 | Parallel AI turns per user (per worker) |
| `WS_MAX_SIZE` | 4194304 | Max WebSocket message size (bytes) |
| `USAGE_CACHE_TTL` | 15 | Seconds the balance payload is cached per user |
| `SUPABASE_JWT_SECRET` | empty | Only for Legacy HS256 JWT projects |
| `JWT_LOCAL_VERIFY` | 1 | Local JWT check on/off |
| `AUTH_REVALIDATE_SEC` | 600 | How often a session is re-checked with Supabase Auth |
| `AI_READ_TIMEOUT` | 120 | Max silence between two AI chunks (s) |
| `AI_TURN_DEADLINE_FAST` / `_DEEP` | 300 / 600 | Max total time of one AI turn (s) |

## Database migration (run once in Supabase → SQL Editor)

Copy **section 13** from the end of `SUPABASE_SCHEMA.sql` (from the line `-- 13) Audit H2: ATOMIC AI charge`
to the end of the file) and run it. It only adds a nullable column, a partial unique index and a function.
It does not drop or change any data and is safe to run more than once. Until you run it, the app keeps working
on the old path.

## How to test (QA)

1. `python -m pytest -q` — new file `tests/test_audit_critical.py`.
2. C1: set a user to 1 page, ask "make 5 slides" → 5 pages charged, balance 0, next request → `LIMIT_EXCEEDED`;
   buy a pack → balance = pack − 4.
3. C2: open 2 tabs, send in both quickly → the second gets "previous request is still running".
4. C3: start a long deck, close the tab → DeepSeek usage stops (check provider dashboard / server logs).
5. C4: check Render logs — no `token=` in URLs.
6. C5: send a 5 MB WebSocket message → connection is closed (code 1009), server RAM stays flat.
7. H2: after running the SQL, generate 2 slides → `usage_ledger` has 1 new row with `charge_id`; in logs there is
   no `[CHARGE] ⚠️ ... yo'q` warning. Run two charges at the same time → the balance is correct.
8. H4: open DevTools → Network: `/api/user/usage` every ~2 min, not every 30 s; after a test payment the balance
   updates in a few seconds.
9. H3: in logs there should be no `[JWT] JWKS olinmadi`. Log out in one tab → within 10 min the other tab's AI request
   gets "Sessiya tugagan". Send a random string as token → rejected instantly.
10. H6: set `AI_TURN_DEADLINE_FAST=20`, ask for a 15-slide deck → after 20 s «vaqt tugadi» + «Davom ettirish»; the next request works at once.
