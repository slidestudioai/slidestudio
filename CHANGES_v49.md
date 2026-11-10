# v49 — Jadval / grafik / sahifa raqami / eksport tezligi

## Frontend
- `js/40_v48_slide_fx.js` — YAGONA layout engine: jadval qator balandligi va ustun kengligi matnni **o'lchab** topiladi
  (uzun so'z ustundan chiqmaydi, ko'p qatorli katak qatorni kengaytiradi). Grafik Y-o'qi: yorliq gridline markaziga qo'yiladi,
  qadam backend (`chart_axis`) bilan bir xil. Natija `ssSpec` ichida saqlanadi (`colW`, `rowHs`, `yMin/yMax/yStep`).
  Shrift yuklanmasdan o'lchangan / eski (v<2) obyektlar avtomatik qayta quriladi (`ssRelayoutStale`).
- `js/41_v49_sync_fix.js` (yangi) — «5/8» kabi sahifa raqamlari har doim joriy slayd/jami bilan sinxron
  (faol slayd + boshqa slaydlar JSON'i + har qanday eksportdan oldin).
- `js/14_pptx_io.js` — PPTX jadvali canvas'dagi `colW/rowHs/padding/lineSpacing` bilan, grafik `valAxisMin/Max/MajorUnit` bilan.

## Backend
- `backend/tg_decks.py` — `chart_axis()` (PPTX = PDF = HTML), jadvalda aniq qator oralig'i, RAM keshi
  (`export_cached`, `cache_peek`, `export_stream` → `io.BytesIO`). Diskka / Supabase'ga yozilmaydi.
- `backend/telegram_bot.py` — `_send_files`: keshdan darhol, «tayyorlanmoqda» holati, `upload_document` indikatori,
  BytesIO oqimi; `_prewarm_files`: slayd tayyor bo'lishi bilan PPTX fonda tayyorlanadi (`TG_PREWARM=0` — o'chirish).
  `/api/telegram/deck-file` — `StreamingResponse` (Content-Length bilan).
