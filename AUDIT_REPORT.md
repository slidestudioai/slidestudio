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

### H1. All limits and locks live in one process's memory — **TODO**
- Files: `main.py` (`_RL`, `_UWIN`, `_TOK_CACHE`, `_AI_INFLIGHT`, `_user_locks`, `ws_count`, `bump_msg`), `backend/scaling.py`.
- With 4 workers (and more instances later): rate limits are really ×4, `DEEPSEEK_CONCURRENCY=40` is really 160
  calls, `MAX_WS` is per worker, the daily message limit resets on every restart/deploy.
- Fix: use Redis (`REDIS_URL` code already exists in `backend/scaling.py` but is unused): sliding-window rate limit
  (`INCR`+`EXPIRE`), in-flight lease (`SET uid NX EX 300`), global AI semaphore. Keep the in-memory fallback.

### H2. Charging = 4–8 Supabase HTTP calls, and the last retry can erase a payment — **TODO**
- Files: `main.py` (`update_usage_atomic`, `save_user_credits`, `ledger_log`, `ledger_spent`).
- Every AI turn: read row → CAS write (up to 5 tries) → ledger insert → sum of up to 5000 ledger rows.
  The **last retry writes without CAS** (`cas=attempt < retries - 1`), so under heavy conflict it can overwrite
  a payment that just arrived (money lost for the user).
- Also: if the charge fails (Supabase outage), the user gets the slides free (`charge_reason = "charge_error"`).
- Fix: one SQL function `charge_units(p_user, p_units, p_kind, p_details)` — `SELECT … FOR UPDATE`, update balance,
  insert ledger, return the new balance — in one transaction (like `apply_payment`). Keep a `spent_since_reset`
  column instead of summing the ledger. Log + alert on charge failure.

### H3. Every API call asks Supabase Auth over the network — **TODO**
- Files: `main.py` (`/api/user/usage`, payments, admin entry), `backend/community.py`.
- `supabase.auth.get_user(token)` = 1 HTTP call per request. Supabase Auth has rate limits; at 100k users it becomes
  the bottleneck and a single point of failure.
- Fix: verify the JWT locally (Supabase JWKS / JWT secret, `PyJWT`), check `exp`/`aud`; cache for 60 s.

### H4. Balance polling: ~3,300 req/s at 100k users — **TODO**
- Files: `js/35_v45_tglink.js` (every 30 s + on focus), `main.py` `/api/user/usage` (5–6 DB calls each: auth, merge
  check, usage read/write, ledger sum, cap query). Endpoint is sync `def` → uses the small default thread pool (40).
- Fix: 10–20 s per-user server cache of the payload; poll every 120 s (the WS `end` message already pushes the balance);
  move `_merge_duplicates_once` to login only.

### H5. Lost result when the connection drops at the end — **TODO**
- Files: `main.py` (charges when `client_gone`), `js/04_websocket_stream.js` (`onclose`).
- This is correct against abuse (the text was already streamed), but if the last chunks were lost, the user pays
  and sees nothing. Fix: keep the last finished reply per user for 10 min (Redis/DB, key = request id); the client
  sends a `request_id` and on reconnect asks `resume`; save `currentAiStreamBuffer` to `sessionStorage`.

### H6. Deep model and tool rounds can hold an AI slot for minutes — **TODO**
- File: `main.py` (`timeout=600`, `MAX_TOOL_ROUNDS`, queue 90 s).
- One turn can take up to 10 min per call × rounds. With 40 slots, a few slow turns block everyone else.
- Fix: a total deadline per turn (e.g. 180 s fast / 300 s deep) with `asyncio.timeout`, and a smaller per-call read timeout (60 s between chunks).

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

## How to test (QA)

1. `python -m pytest -q` — new file `tests/test_audit_critical.py`.
2. C1: set a user to 1 page, ask "make 5 slides" → 5 pages charged, balance 0, next request → `LIMIT_EXCEEDED`;
   buy a pack → balance = pack − 4.
3. C2: open 2 tabs, send in both quickly → the second gets "previous request is still running".
4. C3: start a long deck, close the tab → DeepSeek usage stops (check provider dashboard / server logs).
5. C4: check Render logs — no `token=` in URLs.
6. C5: send a 5 MB WebSocket message → connection is closed (code 1009), server RAM stays flat.
