# Slide Studio

AI yordamida taqdimot (slayd) yaratuvchi sayt + Telegram bot. FastAPI (Python) backend, oddiy HTML/JS frontend, Supabase (baza + Google login).

```
main.py                  — server (FastAPI), frontend'ni ham o'zi tarqatadi
backend/                 — AI, billing, Telegram bot, admin, reklama modullari
js/, index.html, *.css   — frontend
admin/panel.html         — admin panel
SUPABASE_SCHEMA.sql      — BAZA: yagona SQL fayl (hamma jadvallar)
.env.example             — kerakli kalitlar shabloni
render.yaml, Dockerfile  — Render / Docker uchun
```

## 1. Supabase (baza)
1. https://supabase.com → **New project** yarating.
2. **SQL Editor → New query** → `SUPABASE_SCHEMA.sql` ning butun matnini qo'yib **Run** bosing (qayta bossangiz ham xavfsiz).
3. **Project Settings → API** dan oling: `Project URL` → `SUPABASE_URL`, `Publishable` kalit → `SUPABASE_PUBLISHABLE_KEY`, `Secret` (service_role) → `SUPABASE_SECRET_KEY`.

## 2. Google login
1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID** (Web application).
2. *Authorized redirect URI*: `https://<SUPABASE-LOYIHA>.supabase.co/auth/v1/callback`
3. Client ID va Secret ni Supabase → **Authentication → Providers → Google** ga kiriting va yoqing.
4. Client ID ni `GOOGLE_CLIENT_ID` ga yozing.
5. Supabase → **Authentication → URL Configuration**: *Site URL* = saytingiz manzili (`PUBLIC_BASE_URL`), *Redirect URLs* ga ham shuni qo'shing.

## 3. GitHub'ga yuklash
```bash
cd mysayt
git init
git add .
git status        # .env ro'yxatda BO'LMASLIGI kerak
git commit -m "Slide Studio"
git branch -M main
git remote add origin https://github.com/<login>/<repo>.git
git push -u origin main
```
`.env` fayli `.gitignore` da — kalitlar GitHub'ga ketmaydi.

## 4. Render'ga joylash
1. https://render.com → **New → Blueprint** (yoki **Web Service**, Runtime = Docker) → GitHub repo'ni tanlang. `render.yaml` hamma narsani o'zi sozlaydi.
2. **Environment** bo'limida `.env` dagi qiymatlarni kiriting (kamida: `AI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GOOGLE_CLIENT_ID`, `PUBLIC_BASE_URL`). `SLIDE_STUDIO_HMAC_SECRET` avtomatik hosil bo'ladi.
3. Deploy tugagach manzilni (masalan `https://slide-studio.onrender.com`) `PUBLIC_BASE_URL` ga yozing va Supabase *Site URL* ga qo'ying, so'ng qayta deploy qiling.
4. Tekshirish: `https://<manzil>/healthz`

Boshqa serverlarda (Railway, VPS): `pip install -r requirements.txt` → `.env` ni to'ldiring → `python main.py` (yoki `docker build -t slide-studio . && docker run -p 8080:8080 --env-file .env slide-studio`). Port `PORT` o'zgaruvchisidan olinadi (standart 8080).

> Render **free** reja 15 daqiqa ishlatilmasa uxlab qoladi. Doimiy ishlashi uchun `render.yaml` da `plan: starter` qiling.

> **Yangilashda:** `SUPABASE_SCHEMA.sql` ni Supabase SQL Editor'da qayta ishga tushiring (xavfsiz — faqat yangi jadval/ustun qo'shadi).
> v69: `tg_pending_refs` jadvali (botdagi do'st taklifi bonusi server qayta ishga tushganda yo'qolmasligi uchun).
> v70: `support_messages` jadvali — **💬 Yordam (Support)**: foydalanuvchi saytda (⚙️ Sozlamalar → 💬 Yordam) yoki botda (⚙️ Sozlamalar → 💬 Adminga yozish, `/support`) adminga yozadi. Admin javobni sayt **Admin panel → 💬 Yordam** da yoki botdagi admin menyuda (`admin` → 💬 Yordam) beradi. Yangi xabar Telegram admin(lar)ga «✍️ Javob yozish» tugmasi bilan keladi; javob foydalanuvchiga saytda va (Telegram ulangan bo'lsa) botda ko'rinadi.
> v71: **Krossvord** — muharrirda «Qo'shish → Krossvord» (yoki asboblar panelidagi to'r belgisi), AI esa `{"type":"crossword"}` elementi bilan yasaydi; universitet taqdimotlari (mustaqil ish, seminar, referat) uchun AI promptida alohida tuzilma va oxirida krossvord + javoblar kaliti. SQL o'zgarishi yo'q.
> v78: **Mustaqil Telegram akkaunti va umumiy dizayn yadrosi.** `SUPABASE_SCHEMA.sql` ni qayta ishga tushiring (17-bo'lim:
> `user_usage.telegram_id`, `auth_provider`, `contact_email` + `public.users` ko'rinishi).
> - Bot / Mini App: Google ulash shart emas, `/link` olib tashlandi. `/start` — 🆕 Yangi slayd · 🚀 Muharrir · 💳 Balans;
>   yangi foydalanuvchiga darhol akkaunt va bepul varaq (`TG_FREE_DAILY_PAGES` bilan alohida sozlanadi).
> - Dodo: checkout `metadata` da `user_id` + `telegram_id`; webhook shu ID bo'yicha balansni to'ldiradi. Telegram akkauntida email
>   bo'lmasa — to'lov oynasi o'zi so'raydi, kiritilgan email chek uchun `contact_email` ga saqlanadi.
> - Bot generatori saytdagi 32 ta dizayn mavzusini (`js/51_design_themes.js` — yagona manba, `backend/services/design_system.py`),
>   mavzuga mos rang tanlashni, krossvord (`backend/services/crossword.py` — `js/56_crossword.js` ning aynan nusxasi), ikki ustunli
>   taqqoslash va katta rasm maketlarini ishlatadi. Tayyor PPTX darhol yuboriladi (`TG_AUTO_SEND`), ostida «✏️ Muharrirda tahrirlash».
> v79: `SUPABASE_SCHEMA.sql` ni qayta ishga tushiring (18-bo'lim: `tg_username`, `display_name`, `last_active` to'ldiriladi).
> - Admin: Google va Telegram'ni bir-biriga ulash shart emas — `ADMIN_TG_IDS` dagi Telegram ID **yoki** `ADMIN_EMAILS` dagi Google email.
> - Admin panel: Telegram foydalanuvchi ismi va @username bilan; eng so'nggi faol odam tepada; har qanday harakat (bot / Mini App /
>   sayt) «oxirgi faollik»; panel 30 soniyada o'zi yangilanadi; «Telegram» / «Ulanganlar» filtrlari ko'p foydalanuvchida ham ishlaydi.
> - «🚀 Muharrir»: botdagi taqdimot muharrirdagi qoralamadan yangiroq bo'lsa — o'sha ochiladi. Bir qurilmada 2 akkaunt:
>   bir akkaunt slaydlari boshqasining qoralamasiga yozilmaydi.
> v80: **Yuklama.** PPTX/PDF eksporti server kuchiga moslashadi (`backend/services/export_pool.py`): kuchli serverda bot
> worker'ida alohida jarayonlar (barcha yadrolar; 4 CPU'da ~7x tez), kuchsizda oqim; bir vaqtdagi eksportlar RAM'dan
> hisoblanadi. Botda navbatdagi foydalanuvchi o'z o'rnini ko'radi. Telegram API: umumiy tezlik cheklagich (`TG_API_RPS`)
> va 429 da Telegram aytgan vaqt to'liq kutiladi — ommaviy yuklamada xabar/fayl yo'qolmaydi. Deploy logida:
> `[EXPORT] RAM … MB, CPU … -> N jarayon`.
>
> **Worker soni** serverning RAM/CPU'siga qarab o'zi tanlanadi (`backend/gunicorn_conf.py`; deploy logida
> `[GUNICORN] RAM limit ... -> N worker(s)` qatori). Qo'lda: `WEB_CONCURRENCY`.

## 5. Telegram bot (ixtiyoriy)
@BotFather → `/newbot` → tokenni `TELEGRAM_BOT_TOKEN` ga yozing. `PUBLIC_BASE_URL` https bo'lsa webhook avtomatik o'rnatiladi.
Admin bo'lish uchun botga `/id` yozing va `ADMIN_TG_IDS` + `ADMIN_EMAILS` ni to'ldiring (ikkalasi ham mos kelishi shart).

## 6. To'lov (ixtiyoriy)
To'lovlar **Dodo Payments** (Merchant of Record) orqali. `.env` / Render'ga yozing:

- `DODO_PAYMENTS_API_KEY` — API kalit
- `DODO_PRODUCT_ID` — "Pay What You Want" mahsuloti (minimal narx $1)
- `DODO_WEBHOOK_SECRET` — webhook signing secret (`whsec_...`)
- `DODO_PAYMENTS_ENV` — `test` (standart, `https://test.dodopayments.com`) yoki `live`
- `DODO_FEE_PERCENT` / `DODO_FEE_FIXED_CENTS` — mijoz narxiga qo'shiladigan komissiya (standart 5.5% + 40 sent). Formula: `gross = ceil((N + 0.40) / (1 - 0.055))`, masalan $1 → $1.49. Kredit netto (N) bo'yicha beriladi.

Dodo dashboard → Webhooks: manzil `https://<manzil>/webhooks`, hodisalar: `payment.succeeded`, `refund.succeeded`.
Checkout: `POST /api/create-checkout` `{token, amount}` → `{checkout_url}`. 1 USD netto = 100 kredit. Tekshiruv: `GET /api/payment/health`.

## Lokal ishga tushirish
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # to'ldiring
python main.py            # http://localhost:8080
```

## Testlar
Testlar haqiqiy Supabase / AI / Telegram ga ulanmaydi (`tests/fake_supabase.py` — xotiradagi soxta baza).
```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Brauzer testlari (Playwright: editor, telefon, Telegram Mini App):
```bash
cd e2e
npm ci
npx playwright install --with-deps chromium
npm test
```

## Yangilanganda (v57)
- **AI slayd yaratish tuzatishlari** (Tez va Pro AI'da bir xil):
  - «Qayta yaratish» oldingi natija ustiga qo'shardi (4 ta slayd → 7 ta). Endi AI'dan oldingi holatdan qayta boshlanadi.
  - Xabarni tahrirlab qayta yuborishda eski holat to'liq yuklanib bo'lgach yuboriladi (avval slayd yo'qolib qolishi mumkin edi).
  - Yangi loyihadagi «Sarlavha Kiriting» bo'sh slayd hisoblanadi: «4 ta slayd yarat» → 4 ta (avval 5 ta kutilib, «3/5 yaratildi» degan noto'g'ri xabar chiqardi).
  - Qidiruv hisoblagichi har yangi xabarda noldan boshlanadi.
- **Rasm qidiruvi birma-bir:** qidiruvlar baribir parallel, lekin natijalar ketma-ket chiqadi (har biri ~0.35 s).
- **Yuklanish effektlari:** slayd yaratilayotganda kanvas ustida yengil to'lqin, chap panelda «N-slayd yaratilmoqda…» skeleti, yangi slaydlar silliq paydo bo'ladi.
- Yuqori tugmalar ixchamroq (30px).
- e2e testlar endi `e2e/fake_ai_server.py` (soxta AI + rasm qidiruvi) bilan AI oqimini ham tekshiradi.

## Yangilanganda (v56)
- Pastki «Shu varoq haqida yozing» qatori, uning ustidagi tugmalar va o'ngdagi zoom tugmalari ixchamroq; AI panel torroq, yozuvi mayinroq; chap panel biroz kengroq, tugmalari chetga yopishmaydi.
- **E'lon:** faqat ENG OXIRGI faol e'lon ko'rsatiladi (bir nechtasi yuborilib, odam ko'rmagan bo'lsa ham — faqat oxirgisi). Har bir kishiga bir marta. Saytni yangilamasa ham ~45 soniyada chiqadi.
  Bot admin → «📢 Reklamalar» → e'lon yonidagi **«❌ Bekor qilish»**: saytdagi ochiq popup o'zi yopiladi, botdagi yuborilgan xabarlar chatlardan o'chadi. E'longa rasm, video, havola va tugma qo'shish mumkin.

## Yangilanganda (v55)
`SUPABASE_SCHEMA.sql` ni Supabase SQL Editor'da **qayta ishga tushiring** (`ads.kind` ustuni — e'lonlar uchun). Qayta bosish xavfsiz.
- **E'lon (reklamasiz):** bot admin → «📢 Reklamalar» → «📣 Yangi e'lon» (yoki veb admin panelda «Turi: E'lon»). «Reklama» yozuvisiz; saytda popup bo'lib chiqadi, botda hammaga (VIP ham) boradi.
- **Rasm qidiruvi:** Tez va Chuqur AI'da hamma qidiruvlar bir vaqtda; topilmaganlari ham bitta to'plamda qayta qidiriladi. Chatda qatorlar ketma-ket (tez) chiqadi.
- **Bot slaydlari:** tugma / havola, GIF (PPTX va HTML'da harakatlanadi), YouTube va video (HTML'da slayd ichida o'ynaydi, PPTX/PDF'da bosiladigan muqova). «Muharrirda ochish» da GIF va havolalar saqlanadi.
- **Bot AI balansni biladi:** «balansim qancha?» deb so'rasa aniq raqamni aytadi; balansdan ko'p slayd taklif qilmaydi.
- Yuqori tugmalar yumaloq (pill), chap panel biroz torroq.

## Yangilanganda (v54)
- Fon rangi / rasm o'zgarganda kanvas darhol yangilanadi (avval boshqa elementni bosish kerak edi).
- Sozlamalar paneli ochilganda slayd qayta sig'diriladi (o'ng panel ostiga kirib ketmaydi).
- Yuqori panel va asboblar paneli tugmalari bir xil o'lchamda (`v54.css`).
- Pro (Chuqur) AI ham GIF/video qidiradi va «o'ylayapti» holatini jonli ko'rsatadi — Tez AI bilan bir xil oqim.
- Telegram bot: har javob ostida qolgan balans; baza sekin bo'lsa balans keyinroq alohida yuboriladi.
- Telegram Mini App: to'liq ekranda xavfsiz hudud (chelka) va Telegram «Orqaga» tugmasi.

## Yangilanganda (v53)
`SUPABASE_SCHEMA.sql` ni Supabase SQL Editor'da **qayta ishga tushiring** (13-bo'lim: `transfer_paid_credits`). Qayta bosish xavfsiz.
