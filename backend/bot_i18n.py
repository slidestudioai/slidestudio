"""Telegram bot tarjimalari (uz → ru, en).

Bot matnlari kodda o'zbekcha yozilgan. Yuborishdan oldin (telegram_bot.tg() ichida) foydalanuvchi tanlagan tilga
o'giriladi: xabar matni, rasm izohi va tugma yozuvlari. Har bir yozuv (uz, ru, en) — uz matn BO'LAGI qidiriladi
(uzunlari birinchi), shuning uchun f-string ichidagi doimiy qismlar ham tarjima bo'ladi. Foydalanuvchi yozgan mavzu
yoki slayd sarlavhalari odatda bu bo'laklarga to'g'ri kelmaydi.

Yangi matn qo'shsangiz — shu ro'yxatga (uz, ru, en) qator qo'shing.
"""
from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

LANGS = ("uz", "ru", "en")
NAMES = {"uz": "🇺🇿 O'zbekcha", "ru": "🇷🇺 Русский", "en": "🇬🇧 English"}
PICK_TEXT = "🌐 Tilni tanlang · Выберите язык · Choose your language"

# Menyu tugmalari (MENU yo'naltirish uchun ham ishlatiladi)
BUTTONS: List[Tuple[str, str, str]] = [
    ("🎨 Yangi slayd yaratish", "🎨 Создать слайды", "🎨 Create slides"),
    ("📂 Mening slaydlarim", "📂 Мои слайды", "📂 My slides"),
    ("💳 Balans", "💳 Баланс", "💳 Balance"),
    ("🌐 Saytga o'tish", "🌐 Перейти на сайт", "🌐 Open website"),
    ("⚙️ Sozlamalar", "⚙️ Настройки", "⚙️ Settings"),
    ("🎁 Do'st taklif qilish", "🎁 Пригласить друга", "🎁 Invite a friend"),
    ("ℹ️ Yordam", "ℹ️ Помощь", "ℹ️ Help"),
    ("🚀 Muharrirda ochish", "🚀 Открыть в редакторе", "🚀 Open in editor"),
    ("🚀 Muharrir", "🚀 Редактор", "🚀 Editor"),
    ("✨ Muharrirni ochish", "✨ Открыть редактор", "✨ Open the editor"),
    ("✨ Muharrir", "✨ Редактор", "✨ Editor"),
    ("🆕 Yangi slayd", "🆕 Новые слайды", "🆕 New slides"),
    ("🎨 Yangi slayd", "🎨 Новые слайды", "🎨 New slides"),
    ("📂 Slaydlarim", "📂 Мои слайды", "📂 My slides"),
    ("✏️ Tahrirlash", "✏️ Изменить", "✏️ Edit"),
    ("✅ Tayyor — fayllarga qaytish", "✅ Готово — к файлам", "✅ Done — back to files"),
    ("🎨 Rang", "🎨 Цвет", "🎨 Color"),
    ("🌐 Brauzerda", "🌐 В браузере", "🌐 In browser"),
    ("⬅️ Orqaga", "⬅️ Назад", "⬅️ Back"),
    ("➕ Varaq sotib olish", "➕ Купить листы", "➕ Buy pages"),
    ("🔗 Google ulash", "🔗 Подключить Google", "🔗 Connect Google"),
    ("🔗 Google akkauntni ulash", "🔗 Подключить аккаунт Google", "🔗 Connect your Google account"),
    ("🌐 Google bilan ulash", "🌐 Подключить через Google", "🌐 Connect with Google"),
    ("✏️ Muharrirda tahrirlash", "✏️ Изменить в редакторе", "✏️ Edit in the editor"),
    ("🤖 AI bilan o'zgartirish", "🤖 Изменить с AI", "🤖 Change with AI"),
    ("🔓 Google'ni uzish", "🔓 Отключить Google", "🔓 Disconnect Google"),
    ("💳 To'lovga o'tish", "💳 Перейти к оплате", "💳 Go to payment"),
    ("🌐 Saytda ulash", "🌐 Подключить на сайте", "🌐 Connect on website"),
    ("📤 Do'stga yuborish", "📤 Отправить другу", "📤 Send to a friend"),
    ("🗑 Hammasini tozalash", "🗑 Очистить всё", "🗑 Clear all"),
    ("🗑 Ha, tozalash", "🗑 Да, очистить", "🗑 Yes, clear"),
    ("↩️ Bekor", "↩️ Отмена", "↩️ Cancel"),
    ("✅ Ha, uzish", "✅ Да, отключить", "✅ Yes, disconnect"),
    ("↩️ Yo'q", "↩️ Нет", "↩️ No"),
    ("🤖 AI bilan matnini tahrirlash", "🤖 Изменить текст с AI", "🤖 Edit the text with AI"),
    ("🔁 Qayta urinish", "🔁 Повторить", "🔁 Try again"),
    ("🌐 Til / Язык / Language", "🌐 Til / Язык / Language", "🌐 Til / Язык / Language"),
    ("5 slayd", "5 слайдов", "5 slides"),
    ("8 slayd", "8 слайдов", "8 slides"),
    ("10 slayd", "10 слайдов", "10 slides"),
    ("12 slayd", "12 слайдов", "12 slides"),
    ("⚡ Tez AI", "⚡ Быстрый AI", "⚡ Fast AI"),
    ("🧠 Chuqur AI", "🧠 Глубокий AI", "🧠 Deep AI"),
]

HELP_UZ = (
    "<b>Qanday ishlaydi</b>\n"
    "1. <b>🆕 Yangi slayd</b> ni bosing va mavzuni yozing — bot taqdimot yasab, PPTX faylni yuboradi.\n"
    "2. <b>✏️ Muharrirda tahrirlash</b> — aynan o'sha taqdimot muharrirda ochiladi, xohlagan joyini o'zgartirasiz.\n"
    "3. <b>🚀 Muharrir</b> — bo'sh muharrir: slaydlarni jonli ko'rib, AI bilan yarating.\n"
    "4. 1 slayd = 1 varaq. Varaq tugasa — «💳 Balans» orqali sotib oling.\n\n"
    "<b>Buyruqlar</b>\n"
    "/my — slaydlarim\n"
    "/credits — balans\n"
    "/buy — varaq sotib olish\n"
    "/invite — do'st taklif qilish (+15 varaq)\n"
    "/settings — sozlamalar\n"
    "/support — adminga yozish\n"
    "/lang — til"
)
HELP_RU = (
    "<b>Как это работает</b>\n"
    "1. Нажмите <b>🆕 Новые слайды</b> и напишите тему — бот сделает презентацию и пришлёт PPTX.\n"
    "2. <b>✏️ Изменить в редакторе</b> — эта же презентация откроется в редакторе, меняйте что угодно.\n"
    "3. <b>🚀 Редактор</b> — пустой редактор: создавайте слайды с AI, сразу видя результат.\n"
    "4. 1 слайд = 1 лист. Закончились листы — купите через «💳 Баланс».\n\n"
    "<b>Команды</b>\n"
    "/my — мои слайды\n"
    "/credits — баланс\n"
    "/buy — купить листы\n"
    "/invite — пригласить друга (+15 листов)\n"
    "/settings — настройки\n"
    "/support — написать админу\n"
    "/lang — язык"
)
HELP_EN = (
    "<b>How it works</b>\n"
    "1. Tap <b>🆕 New slides</b> and write a topic — the bot builds the deck and sends the PPTX.\n"
    "2. <b>✏️ Edit in the editor</b> — the same deck opens in the editor, change anything by hand.\n"
    "3. <b>🚀 Editor</b> — an empty editor: create slides with AI while you see them live.\n"
    "4. 1 slide = 1 page. Out of pages? Buy more via «💳 Balance».\n\n"
    "<b>Commands</b>\n"
    "/my — my slides\n"
    "/credits — balance\n"
    "/buy — buy pages\n"
    "/invite — invite a friend (+15 pages)\n"
    "/settings — settings\n"
    "/support — contact support\n"
    "/lang — language"
)

PHRASES: List[Tuple[str, str, str]] = BUTTONS + [
    # ---- v70: Yordam (Support) ----
    ("💬 Adminga yozish (Support)", "💬 Написать админу (Support)", "💬 Contact support"),
    ("💬 <b>Adminga yozish</b>", "💬 <b>Написать админу</b>", "💬 <b>Contact support</b>"),
    ("Savol, taklif yoki muammoni bitta xabarda yozib yuboring — admin javob beradi. Javob shu yerga keladi.",
     "Опишите вопрос, идею или проблему одним сообщением — администратор ответит. Ответ придёт сюда.",
     "Send your question, idea or problem in one message — an admin will reply. The reply will come here."),
    ("<b>Oxirgi xabarlar:</b>", "<b>Последние сообщения:</b>", "<b>Recent messages:</b>"),
    ("👤 Siz", "👤 Вы", "👤 You"),
    ("✖️ Bekor qilish", "✖️ Отмена", "✖️ Cancel"),
    ("Bekor qilindi.", "Отменено.", "Cancelled."),
    ("✅ Xabaringiz adminga yuborildi. Javob shu yerga keladi.", "✅ Сообщение отправлено администратору. Ответ придёт сюда.", "✅ Your message was sent to the admin. The reply will come here."),
    ("✍️ Yana yozish", "✍️ Написать ещё", "✍️ Write again"),
    ("✍️ Javob yozish", "✍️ Ответить", "✍️ Reply"),
    ("💬 <b>Admin javobi:</b>", "💬 <b>Ответ администратора:</b>", "💬 <b>Admin reply:</b>"),
    ("⚙️ Hozir yuborib bo'lmadi. Keyinroq urinib ko'ring.", "⚙️ Сейчас не удалось отправить. Попробуйте позже.", "⚙️ Could not send right now. Please try again later."),
    ("Iltimos, biroz kuting va qayta yuboring", "Пожалуйста, подождите немного и отправьте снова", "Please wait a moment and try again"),
    ("Juda ko'p xabar yuborildi. Bir soatdan keyin urinib ko'ring", "Слишком много сообщений. Попробуйте через час", "Too many messages. Try again in an hour"),
    ("Xabar juda qisqa", "Сообщение слишком короткое", "Message is too short"),
    (HELP_UZ, HELP_RU, HELP_EN),
    # ---- salomlashuv / balans ----
    ("👋 <b>Salom!</b>", "👋 <b>Привет!</b>", "👋 <b>Hi!</b>"),
    ("👋 <b>Salom, ", "👋 <b>Привет, ", "👋 <b>Hi, "),
    ("Mavzuni yozing — slayd tayyorlab beraman.", "Напишите тему — я подготовлю слайды.", "Write a topic — I'll prepare the slides."),
    ("Slaydlarni jonli ko'rib, AI bilan oson tahrirlash va tayyor shablonlardan foydalanish uchun Muharrirni oching 👇",
     "Чтобы видеть слайды вживую, легко менять их с AI и брать готовые шаблоны — откройте редактор 👇",
     "Open the editor to see your slides live, edit them easily with AI and use ready templates 👇"),
    ("📩 Muharrirdan:", "📩 Из редактора:", "📩 From the editor:"),
    # ---- v78: mustaqil Telegram akkaunti ----
    ("\n✅ Akkauntingiz tayyor · ", "\n✅ Аккаунт готов · ", "\n✅ Your account is ready · "),
    ("Mavzuni yozing — AI taqdimot tayyorlaydi 👇", "Напишите тему — AI подготовит презентацию 👇", "Write a topic — AI will prepare the presentation 👇"),
    ("<i>Chek uchun email to'lov oynasida so'raladi.</i>", "<i>Email для чека запросит окно оплаты.</i>", "<i>The payment page asks for an email for the receipt.</i>"),
    ("Do'stingiz havolangiz orqali botga (yoki saytga) kirsa, balansingizga", "Если друг зайдёт в бот (или на сайт) по вашей ссылке, на ваш баланс добавится",
     "When a friend opens the bot (or the website) with your link, your balance gets"),
    ("ta pullik varaq qo'shiladi.", "платных листов.", "paid pages."),
    ("📦 Fayl yuborilmoqda...", "📦 Отправляю файл...", "📦 Sending the file..."),
    ("🔗 <b>Google akkauntni ulash</b>\nTugmani bosing → saytda Google bilan kiring → tayyor ✅\n",
     "🔗 <b>Подключить аккаунт Google</b>\nНажмите кнопку → войдите через Google на сайте → готово ✅\n",
     "🔗 <b>Connect your Google account</b>\nTap the button → sign in with Google on the website → done ✅\n"),
    ("Shundan keyin bot, sayt va muharrir — <b>bitta balans</b> va <b>bitta oxirgi taqdimot</b>.",
     "После этого бот, сайт и редактор — <b>один баланс</b> и <b>одна последняя презентация</b>.",
     "After that the bot, the website and the editor share <b>one balance</b> and <b>one latest deck</b>."),
    ("<i>Telegram ichida Google kirishga ruxsat bermasa: ⋮ → «Brauzerda ochish».</i>",
     "<i>Если Google не пускает внутри Telegram: ⋮ → «Открыть в браузере».</i>",
     "<i>If Google refuses inside Telegram: ⋮ → “Open in browser”.</i>"),
    ("✅ Google akkaunt ulangan: ", "✅ Аккаунт Google подключён: ", "✅ Google account connected: "),
    ("Balans va oxirgi taqdimot sayt bilan bir xil.", "Баланс и последняя презентация — общие с сайтом.", "Balance and latest deck are shared with the website."),
    (" (balans va slaydlar bir xil)", " (общий баланс и слайды)", " (shared balance and slides)"),
    ("⏳ So'rovlar ko'p — navbatdasiz: ", "⏳ Много запросов — вы в очереди: ", "⏳ Many requests — you are in the queue: "),
    ("-o'rin. Hech narsa yechilmadi, kuting…", "-е место. Ничего не списано, подождите…", " place. Nothing was charged, please wait…"),
    ("🔗 Balans va slaydlar uchun avval <b>Google akkauntni ulang</b>.", "🔗 Для баланса и слайдов сначала <b>подключите аккаунт Google</b>.", "🔗 To get a balance and slides, first <b>connect your Google account</b>."),
    ("🔗 Slayd yaratish uchun avval <b>Google akkauntni ulang</b>.\nBu balansingizni saqlab qolish uchun kerak.", "🔗 Чтобы создавать слайды, сначала <b>подключите аккаунт Google</b>.\nЭто нужно, чтобы сохранить ваш баланс.", "🔗 To create slides, first <b>connect your Google account</b>.\nThis keeps your balance safe."),
    ("🔗 Slayd yaratish uchun avval <b>Google akkauntni ulang</b>.", "🔗 Чтобы создавать слайды, сначала <b>подключите аккаунт Google</b>.", "🔗 To create slides, first <b>connect your Google account</b>."),
    ("Varaq sotib olish ham shundan keyin.", "Покупка листов — тоже после этого.", "Buying pages is available after that too."),
    ("💎 Varaqlar: ", "💎 Листов: ", "💎 Pages: "),
    ("💳 <b>Balans</b>", "💳 <b>Баланс</b>", "💳 <b>Balance</b>"),
    ("<i>1 slayd = 1 varaq</i>", "<i>1 слайд = 1 лист</i>", "<i>1 slide = 1 page</i>"),
    ("⚠️ Hozir balansni o'qib bo'lmadi. Birozdan keyin qayta urinib ko'ring.", "⚠️ Сейчас не удалось прочитать баланс. Попробуйте чуть позже.", "⚠️ Could not read your balance right now. Please try again shortly."),
    ("⚠️ Balansni hozir o'qib bo'lmadi. «💳 Balans» tugmasini bosib qayta urinib ko'ring.", "⚠️ Не удалось прочитать баланс. Нажмите «💳 Баланс» и попробуйте снова.", "⚠️ Could not read your balance. Tap «💳 Balance» and try again."),
    ("♾ Varaqlar: <b>cheksiz</b>", "♾ Листы: <b>безлимит</b>", "♾ Pages: <b>unlimited</b>"),
    # ---- to'lov ----
    ("To'lovdan so'ng varaqlar darhol qo'shiladi.", "После оплаты листы начислятся сразу.", "Pages are added right after payment."),
    ("⚙️ To'lov hozircha ishlamayapti. Birozdan keyin urinib ko'ring.", "⚙️ Оплата сейчас недоступна. Попробуйте чуть позже.", "⚙️ Payment is not available right now. Please try again later."),
    ("✅ To'lov qabul qilindi: <b>+", "✅ Оплата получена: <b>+", "✅ Payment received: <b>+"),
    ("↩️ To'lov qaytarildi: <b>−", "↩️ Возврат оплаты: <b>−", "↩️ Payment refunded: <b>−"),
    ("</b> varaq!", "</b> листов!", "</b> pages!"),
    ("</b> varaq.", "</b> листов.", "</b> pages."),
    ("😔 <b>Varaqlar tugadi.</b>", "😔 <b>Листы закончились.</b>", "😔 <b>You are out of pages.</b>"),
    ("Davom etish uchun varaq sotib oling 👇", "Чтобы продолжить, купите листы 👇", "Buy pages to continue 👇"),
    ("Bepul varaqlar <b>", "Бесплатные листы обновятся через <b>", "Free pages refresh in <b>"),
    ("</b> dan keyin yangilanadi.", "</b>.", "</b>."),
    # ---- yaratish ----
    ("Mavzu tahlili", "Анализ темы", "Topic analysis"),
    ("Slayd matnlari", "Тексты слайдов", "Slide texts"),
    ("Fayllar (PPTX · PDF · HTML)", "Файлы (PPTX · PDF · HTML)", "Files (PPTX · PDF · HTML)"),
    ("⏳ AI mavzuni tahlil qilmoqda…", "⏳ AI анализирует тему…", "⏳ AI is analysing the topic…"),
    ("🧠 Slayd tuzilishi va matnlari yozilmoqda…", "🧠 Пишутся структура и тексты слайдов…", "🧠 Writing the slide structure and texts…"),
    ("🖼 Rasmlar tanlanmoqda…", "🖼 Подбираются изображения…", "🖼 Choosing images…"),
    ("📦 Fayl yuborilmoqda...", "📦 Файл отправляется...", "📦 Sending the file..."),
    ("Rasmlar", "Изображения", "Images"),
    ("<i>Chuqur rejim 1–2 daqiqa olishi mumkin.</i>", "<i>Глубокий режим может занять 1–2 минуты.</i>", "<i>Deep mode may take 1–2 minutes.</i>"),
    ("ℹ️ Balansingizda ", "ℹ️ На балансе ", "ℹ️ Your balance has "),
    (" varaq bor — shuncha slayd yaratiladi.", " листов — столько слайдов и будет создано.", " pages — that many slides will be created."),
    ("⛔ Akkauntingiz bloklangan.", "⛔ Ваш аккаунт заблокирован.", "⛔ Your account is blocked."),
    ("⚠️ AI to'g'ri javob bermadi. Hech narsa yechilmadi — mavzuni qayta yuboring.", "⚠️ AI ответил некорректно. Ничего не списано — отправьте тему ещё раз.", "⚠️ The AI did not answer correctly. Nothing was charged — send the topic again."),
    ("⌛ AI juda uzoq o'ylandi. Hech narsa yechilmadi — qayta urinib ko'ring (yoki ⚡ Tez AI rejimini tanlang: /mode).", "⌛ AI думал слишком долго. Ничего не списано — попробуйте снова (или выберите ⚡ Быстрый AI: /mode).", "⌛ The AI took too long. Nothing was charged — try again (or choose ⚡ Fast AI: /mode)."),
    ("⌛ AI juda uzoq o'ylandi. Hech narsa yechilmadi — qayta urinib ko'ring.", "⌛ AI думал слишком долго. Ничего не списано — попробуйте снова.", "⌛ The AI took too long. Nothing was charged — please try again."),
    ("⌛ AI juda uzoq o'ylandi. Hech narsa yechilmadi — qayta yozing.", "⌛ AI думал слишком долго. Ничего не списано — напишите ещё раз.", "⌛ The AI took too long. Nothing was charged — please write again."),
    ("⌛ AI juda uzoq o'ylandi. Qayta urinib ko'ring.", "⌛ AI думал слишком долго. Попробуйте снова.", "⌛ The AI took too long. Please try again."),
    ("⚙️ Akkauntni ochib bo'lmadi. Birozdan keyin urinib ko'ring.", "⚙️ Не удалось открыть аккаунт. Попробуйте чуть позже.", "⚙️ Could not open your account. Please try again shortly."),
    ("⚠️ Akkauntni ochib bo'lmadi. Birozdan keyin urinib ko'ring.", "⚠️ Не удалось открыть аккаунт. Попробуйте чуть позже.", "⚠️ Could not open your account. Please try again shortly."),
    ("⚠️ Xatolik yuz berdi. Hech narsa yechilmadi — birozdan keyin qayta urinib ko'ring.", "⚠️ Произошла ошибка. Ничего не списано — попробуйте чуть позже.", "⚠️ Something went wrong. Nothing was charged — please try again shortly."),
    ("⏳ Hozir so'rovlar juda ko'p. 1–2 daqiqadan keyin qayta urinib ko'ring — hech narsa yechilmadi.", "⏳ Сейчас слишком много запросов. Попробуйте через 1–2 минуты — ничего не списано.", "⏳ Too many requests right now. Try again in 1–2 minutes — nothing was charged."),
    ("⏳ Oldingi so'rov hali bajarilmoqda — biroz kuting.", "⏳ Предыдущий запрос ещё выполняется — подождите немного.", "⏳ The previous request is still running — please wait."),
    ("⏳ Oldingi so'rov bajarilmoqda, biroz kuting.", "⏳ Предыдущий запрос выполняется, подождите немного.", "⏳ The previous request is running, please wait."),
    # ---- tayyor karta / fayllar ----
    ("<i>✏️ O'zgartirish kerak bo'lsa — «Tahrirlash» ni bosing, keyin AI'ga oddiy yozing (u slaydni ko'rib turadi).</i>", "<i>✏️ Нужно изменить — нажмите «Изменить» и просто напишите AI (он видит слайды).</i>", "<i>✏️ Need changes? Tap «Edit» and just write to the AI (it sees the slides).</i>"),
    ("<b>Yuklab olish uchun formatni tanlang</b> 👇", "<b>Выберите формат для скачивания</b> 👇", "<b>Choose a format to download</b> 👇"),
    (" ta slayd · 🎨 ", " слайдов · 🎨 ", " slides · 🎨 "),
    ("… va yana ", "… и ещё ", "… and "),
    ("✅ Tayyor! Yana format kerakmi yoki o'zgartirish qilamizmi?\n<i>Masalan: «3-slaydni qisqartir», «sarlavhasini o'zgartir».</i>", "✅ Готово! Нужен другой формат или что-то изменить?\n<i>Например: «сократи 3-й слайд», «измени заголовок».</i>", "✅ Done! Need another format or any changes?\n<i>For example: «shorten slide 3», «change the title».</i>"),
    ("⚠️ Faylni yuborib bo'lmadi. Qayta urinib ko'ring.", "⚠️ Не удалось отправить файл. Попробуйте снова.", "⚠️ Could not send the file. Please try again."),
    ("⚠️ Faylni tayyorlashda xatolik. Qayta urinib ko'ring.", "⚠️ Ошибка при подготовке файла. Попробуйте снова.", "⚠️ Error while preparing the file. Please try again."),
    ("<i>Brauzerda oching: ← → tugmalar yoki barmoq bilan suring, F — to'liq ekran.</i>", "<i>Откройте в браузере: клавиши ← → или свайп, F — полный экран.</i>", "<i>Open in a browser: ← → keys or swipe, F — full screen.</i>"),
    ("<i>PowerPoint'da oching va «Slide Show» ni bosing — o'tish effektlari va GIF'lar ishlaydi. Google Slides, WPS yoki telefon ilovalarida ba'zi effektlar ishlamasligi mumkin; 100% bir xil ko'rinish — HTML formatda.</i>", "<i>Откройте в PowerPoint и нажмите «Slide Show» — переходы и GIF работают. В Google Slides, WPS и мобильных приложениях часть эффектов может не работать; 100% одинаковый вид — в формате HTML.</i>", "<i>Open in PowerPoint and press «Slide Show» — transitions and GIFs work. In Google Slides, WPS or phone apps some effects may not work; for an identical look use HTML.</i>"),
    ("Slayd topilmadi (bot qayta ishga tushgan bo'lishi mumkin). Mavzuni yozing — yangisini yarataman 🙂", "Слайды не найдены (бот мог перезапуститься). Напишите тему — создам новые 🙂", "Slides not found (the bot may have restarted). Write a topic — I'll create new ones 🙂"),
    # ---- tahrirlash ----
    ("✏️ <b>Tahrirlash oynasi</b>", "✏️ <b>Режим правки</b>", "✏️ <b>Edit mode</b>"),
    ("<b>Nimani o'zgartiray? Oddiy matn bilan yozing:</b>", "<b>Что изменить? Напишите обычным текстом:</b>", "<b>What should I change? Just write it:</b>"),
    ("• <i>3-slaydni qisqartir</i>", "• <i>сократи 3-й слайд</i>", "• <i>shorten slide 3</i>"),
    ("• <i>sarlavhasini o'zgartir: «Yangi nom»</i>", "• <i>измени заголовок: «Новое название»</i>", "• <i>change the title: «New name»</i>"),
    ("• <i>yana 2 ta slayd qo'sh: xavflar va xulosa</i>", "• <i>добавь ещё 2 слайда: риски и вывод</i>", "• <i>add 2 more slides: risks and conclusion</i>"),
    ("• <i>ruscha tarjima qil</i>", "• <i>переведи на английский</i>", "• <i>translate into Russian</i>"),
    ("💬 <b>AI'ga oddiy yozsangiz ham bo'ldi</b> — u slaydlarni ko'rib turibdi va aytganingizni qiladi. ", "💬 <b>Можно просто написать AI</b> — он видит слайды и сделает, что скажете. ", "💬 <b>You can simply write to the AI</b> — it sees the slides and does what you say. "),
    ("«Hammasini boshidan qil» yoki yangi mavzu yozsangiz — eski slayd yopilib, butunlay yangisi yaratiladi.", "Если напишете «сделай всё заново» или новую тему — старые слайды закроются и будут созданы новые.", "If you write «start over» or a new topic — the old slides close and completely new ones are created."),
    ("<i>Faqat kerakli slaydlar o'zgaradi. Yoki «🚀 Muharrirdan» o'zingiz tahrirlang — shu slaydning o'zi ochiladi.</i>", "<i>Меняются только нужные слайды. Или отредактируйте сами в «🚀 Редакторе» — откроются эти же слайды.</i>", "<i>Only the needed slides change. Or edit them yourself in the «🚀 Editor» — these same slides open.</i>"),
    ("Avval slayd yarating — mavzuni yozing 🙂", "Сначала создайте слайды — напишите тему 🙂", "Create slides first — write a topic 🙂"),
    ("✏️ <b>AI o'qimoqda…</b>", "✏️ <b>AI читает…</b>", "✏️ <b>The AI is reading…</b>"),
    ("🆕 Eski slayd yopildi — butunlay yangidan yarataman.", "🆕 Старые слайды закрыты — создаю заново.", "🆕 Old slides closed — creating new ones from scratch."),
    ("Tushunmadim, iltimos aniqroq yozing — masalan: «3-slaydni qisqartir».", "Не понял, напишите точнее — например: «сократи 3-й слайд».", "I didn't understand, please be more specific — for example: «shorten slide 3»."),
    ("⚠️ O'zgartirishni qo'llab bo'lmadi. Hech narsa yechilmadi — boshqacha yozib ko'ring.", "⚠️ Не удалось применить изменение. Ничего не списано — попробуйте сформулировать иначе.", "⚠️ Could not apply the change. Nothing was charged — try writing it differently."),
    ("😔 Bu o'zgarish ", "😔 Это изменение требует ", "😔 This change needs "),
    (" varaq talab qiladi, sizda ", " листов, у вас ", " pages, you have "),
    (" varaq bor. Kichikroq o'zgarish so'rang yoki varaq oling.", " листов. Попросите изменение поменьше или купите листы.", " pages. Ask for a smaller change or buy pages."),
    ("</b>\n<i>Yana o'zgartirish kerak bo'lsa — shu yerga yozing.</i>", "</b>\n<i>Нужно ещё что-то изменить — пишите сюда.</i>", "</b>\n<i>Need more changes? Write here.</i>"),
    ("Rang: <b>", "Цвет: <b>", "Color: <b>"),
    ("Slayd topilmadi. «🎨 Yangi slayd» ni bosing.", "Слайды не найдены. Нажмите «🎨 Новые слайды».", "Slides not found. Tap «🎨 New slides»."),
    ("Bu slayd topilmadi (o'chirilgan bo'lishi mumkin).", "Эти слайды не найдены (возможно, удалены).", "These slides were not found (they may have been deleted)."),
    ("Slayd topilmadi.", "Слайды не найдены.", "Slides not found."),
    ("Mavzu topilmadi — iltimos, mavzuni qayta yozing.", "Тема не найдена — пожалуйста, напишите её ещё раз.", "Topic not found — please write it again."),
    # ---- yangi slayd / suhbat ----
    ("🎨 <b>Yangi slayd</b>\nMavzuni yozing — AI slayd tayyorlaydi.\nYoki oddiy savol bering — slayd yasamasdan javob beraman.\n\n<i>Masalan: «Sun'iy intellekt, 8 ta slayd»</i>", "🎨 <b>Новые слайды</b>\nНапишите тему — AI подготовит слайды.\nИли задайте вопрос — отвечу без создания слайдов.\n\n<i>Например: «Искусственный интеллект, 8 слайдов»</i>", "🎨 <b>New slides</b>\nWrite a topic — the AI prepares slides.\nOr ask a question — I'll answer without making slides.\n\n<i>For example: «Artificial intelligence, 8 slides»</i>"),
    ("✅ Mavzu: <b>", "✅ Тема: <b>", "✅ Topic: <b>"),
    ("</b>\n\n<b>Nechta slayd kerak?</b> Tugmani bosing (yoki «10 ta slayd» deb yozing).\n<i>1 slayd = 1 varaq", "</b>\n\n<b>Сколько слайдов нужно?</b> Нажмите кнопку (или напишите «10 слайдов»).\n<i>1 слайд = 1 лист", "</b>\n\n<b>How many slides?</b> Tap a button (or write «10 slides»).\n<i>1 slide = 1 page"),
    ("💳 Balans: <b>", "💳 Баланс: <b>", "💳 Balance: <b>"),
    ("<i>Slayd kerak bo'lsa — mavzuni yozing.</i>", "<i>Нужны слайды — напишите тему.</i>", "<i>Need slides? Write a topic.</i>"),
    ("💬 <i>O'ylayapman…</i>", "💬 <i>Думаю…</i>", "💬 <i>Thinking…</i>"),
    ("Tushunmadim, qayta yozing.", "Не понял, напишите ещё раз.", "I didn't understand, please write again."),
    ("Mavzuni <b>matn</b> ko'rinishida yozib yuboring, masalan: <i>«Sun'iy intellekt kelajagi»</i>.\nRasm yoki fayl yuborsangiz — muharrirda ochib beraman.", "Отправьте тему <b>текстом</b>, например: <i>«Будущее искусственного интеллекта»</i>.\nПришлёте изображение или файл — открою в редакторе.", "Send the topic as <b>text</b>, for example: <i>«The future of artificial intelligence»</i>.\nSend an image or a file — I'll open it in the editor."),
    ("Bunday buyruq mavjud emas.", "Такой команды нет.", "There is no such command."),
    ("Tez va tejamkor: 1 slayd = 1 varaq.", "Быстро и экономно: 1 слайд = 1 лист.", "Fast and economical: 1 slide = 1 page."),
    ("Murakkab mavzular uchun, 1 slayd = ", "Для сложных тем, 1 слайд = ", "For complex topics, 1 slide = "),
    (" Tez-varaq, sekinroq.", " быстрых листа, медленнее.", " fast pages, slower."),
    ("Rejim: <b>", "Режим: <b>", "Mode: <b>"),
    ("🆔 Sizning Telegram ID: <code>", "🆔 Ваш Telegram ID: <code>", "🆔 Your Telegram ID: <code>"),
    # ---- slaydlarim ----
    ("📂 Saqlangan slaydlar yo'q.", "📂 Сохранённых слайдов нет.", "📂 No saved slides."),
    ("📂 <b>Slaydlarim</b> (oxirgi ", "📂 <b>Мои слайды</b> (последние ", "📂 <b>My slides</b> (last "),
    (" ta, faqat matn saqlanadi)\nOchish uchun tanlang:", ", хранится только текст)\nВыберите, чтобы открыть:", ", text only)\nChoose one to open:"),
    ("🗑 <b>Barcha slaydlaringiz tarixi o'chiriladi.</b>\nBalans va akkaunt saqlanib qoladi. Davom etamizmi?", "🗑 <b>История всех ваших слайдов будет удалена.</b>\nБаланс и аккаунт сохранятся. Продолжить?", "🗑 <b>Your whole slide history will be deleted.</b>\nYour balance and account stay. Continue?"),
    ("</b> ta saqlangan slayd o'chirildi.\n💳 Balansingiz va akkauntingiz joyida.", "</b> сохранённых слайдов удалено.\n💳 Баланс и аккаунт на месте.", "</b> saved slides deleted.\n💳 Your balance and account are safe."),
    ("↩️ Bekor qilindi. Hech narsa o'chirilmadi.", "↩️ Отменено. Ничего не удалено.", "↩️ Cancelled. Nothing was deleted."),
    ("⌛ Fayl muddati tugagan — qayta yuboring.", "⌛ Срок файла истёк — отправьте снова.", "⌛ The file expired — please send it again."),
    # ---- fayl qabul qilish ----
    ("📎 Bu turdagi fayl muharrirda ochilmaydi.\nQo'llanadi: <b>rasm, GIF, video, PPTX, PDF, HTML</b>.", "📎 Такой файл не открывается в редакторе.\nПоддерживаются: <b>изображения, GIF, видео, PPTX, PDF, HTML</b>.", "📎 This file type cannot be opened in the editor.\nSupported: <b>images, GIF, video, PPTX, PDF, HTML</b>."),
    ("⚠️ Faylni yuklab bo'lmadi (15 MB dan oshmasin). Qayta yuboring.", "⚠️ Не удалось загрузить файл (не больше 15 МБ). Отправьте снова.", "⚠️ Could not download the file (max 15 MB). Please send it again."),
    ("⚠️ Faylni qabul qilib bo'lmadi. Keyinroq qayta urinib ko'ring.", "⚠️ Не удалось принять файл. Попробуйте позже.", "⚠️ Could not accept the file. Please try again later."),
    ("📎 <b>PPTX o'qilmoqda…</b>", "📎 <b>Читаю PPTX…</b>", "📎 <b>Reading the PPTX…</b>"),
    ("⚠️ Faylni yuklab bo'lmadi. <b>.pptx</b> bo'lsin va 12 MB dan oshmasin.", "⚠️ Не удалось загрузить файл. Нужен <b>.pptx</b> не больше 12 МБ.", "⚠️ Could not download the file. It must be a <b>.pptx</b> up to 12 MB."),
    ("⚠️ PPTX ichida o'qiladigan matn topilmadi (faqat rasmli slaydlar bo'lishi mumkin).", "⚠️ В PPTX не найден текст (возможно, там только изображения).", "⚠️ No readable text found in the PPTX (it may contain only images)."),
    ("⚠️ PPTX ni o'qib bo'lmadi. Boshqa fayl yuboring yoki mavzuni yozing.", "⚠️ Не удалось прочитать PPTX. Отправьте другой файл или напишите тему.", "⚠️ Could not read the PPTX. Send another file or write a topic."),
    ("ℹ️ Matn olindi; asl dizayn va rasmlar o'qilmaydi — yangi fayl bot dizaynida chiqadi.\n✏️ O'zgartirish uchun <b>«Tahrirlash»</b> tugmasini bosing.", "ℹ️ Текст получен; исходный дизайн и изображения не читаются — новый файл будет в дизайне бота.\n✏️ Чтобы изменить, нажмите <b>«Изменить»</b>.", "ℹ️ Text extracted; the original design and images are not read — the new file uses the bot's design.\n✏️ To change it, tap <b>«Edit»</b>."),
    ("Muharrirda ochish uchun tugmani bosing.", "Нажмите кнопку, чтобы открыть в редакторе.", "Tap the button to open it in the editor."),
    # ---- Google ulash / sozlamalar ----
    ("🔗 <b>Sayt akkauntini ulash</b> (Google)\n\n1️⃣ Pastdagi tugmani bosing — sayt ochiladi\n2️⃣ Google bilan kiring — ulash <b>o'zi</b> tugaydi ✅\n\n", "🔗 <b>Подключение аккаунта сайта</b> (Google)\n\n1️⃣ Нажмите кнопку ниже — откроется сайт\n2️⃣ Войдите через Google — подключение завершится <b>само</b> ✅\n\n", "🔗 <b>Connect your website account</b> (Google)\n\n1️⃣ Tap the button below — the website opens\n2️⃣ Sign in with Google — linking finishes <b>by itself</b> ✅\n\n"),
    ("<i>Telegram ichida Google kirishga ruxsat bermasa: havolani ⋮ → «Brauzerda ochish» orqali oching.</i>\n", "<i>Если Google не пускает внутри Telegram: откройте ссылку через ⋮ → «Открыть в браузере».</i>\n", "<i>If Google sign-in is blocked inside Telegram: open the link via ⋮ → «Open in browser».</i>\n"),
    ("Yoki saytda: ⚙️ Sozlamalar → <b>«Telegram botni ulash»</b> (bir bosish).", "Или на сайте: ⚙️ Настройки → <b>«Подключить Telegram-бота»</b> (в один клик).", "Or on the website: ⚙️ Settings → <b>«Connect the Telegram bot»</b> (one tap)."),
    ("✅ <b>Ulandi!</b> Sayt akkauntingiz (", "✅ <b>Подключено!</b> Теперь баланс с аккаунтом сайта (", "✅ <b>Connected!</b> Your balance with the website account ("),
    (") bilan balans endi <b>bir xil</b>.", ") <b>общий</b>.", ") is now <b>shared</b>."),
    ("💎 Botdagi ", "💎 ", "💎 "),
    (" pullik varaq sayt akkauntingizga ko'chirildi.", " платных листов из бота перенесено на аккаунт сайта.", " paid pages from the bot moved to your website account."),
    ("❌ Kod noto'g'ri yoki eskirgan (30 daqiqa yashaydi). Saytda «Telegram botni ulash» ni bosib yangi kod oling.", "❌ Код неверный или устарел (живёт 30 минут). На сайте нажмите «Подключить Telegram-бота» и получите новый.", "❌ The code is wrong or expired (valid for 30 minutes). On the website tap «Connect the Telegram bot» to get a new one."),
    ("⚙️ Ulashni hozir bajarib bo'lmadi. 1 daqiqadan keyin saytdagi o'sha tugmani qayta bosing — kod hali ishlaydi.", "⚙️ Сейчас не удалось подключить. Через минуту нажмите ту же кнопку на сайте ещё раз — код ещё действует.", "⚙️ Could not link right now. In a minute, press the same button on the website again — the code still works."),
    ("⚙️ Ulashni hozir bajarib bo'lmadi (baza sozlanmagan). Keyinroq urinib ko'ring.", "⚙️ Сейчас не удалось подключить (база не настроена). Попробуйте позже.", "⚙️ Could not link right now (database not set up). Please try again later."),
    ("⚙️ <b>Sozlamalar</b>", "⚙️ <b>Настройки</b>", "⚙️ <b>Settings</b>"),
    ("🔗 Google: <b>ulangan</b>", "🔗 Google: <b>подключён</b>", "🔗 Google: <b>connected</b>"),
    ("🔗 Google: <b>ulanmagan</b>", "🔗 Google: <b>не подключён</b>", "🔗 Google: <b>not connected</b>"),
    ("🧠 Chuqur", "🧠 Глубокий", "🧠 Deep"),
    ("⚡ Tez", "⚡ Быстрый", "⚡ Fast"),
    ("🔓 <b>Google akkaunt uzilsinmi?</b>\nBot o'zining Telegram akkauntiga qaytadi. Sayt akkauntingiz va uning balansi o'zgarmaydi.", "🔓 <b>Отключить аккаунт Google?</b>\nБот вернётся к своему Telegram-аккаунту. Аккаунт сайта и его баланс не изменятся.", "🔓 <b>Disconnect the Google account?</b>\nThe bot goes back to its own Telegram account. Your website account and its balance do not change."),
    ("🔓 Google akkaunt uzildi. Qayta ulash: «⚙️ Sozlamalar» → «Google akkauntni ulash».", "🔓 Аккаунт Google отключён. Подключить снова: «⚙️ Настройки» → «Подключить Google».", "🔓 Google account disconnected. To reconnect: «⚙️ Settings» → «Connect Google»."),
    ("🔓 Sayt akkaunti uzildi. Bot endi o'zining Telegram akkauntidan foydalanadi.", "🔓 Аккаунт сайта отключён. Теперь бот использует свой Telegram-аккаунт.", "🔓 Website account disconnected. The bot now uses its own Telegram account."),
    ("🔌 Sayt akkauntingiz (Google) bu Telegram'dan <b>uzildi</b>. Qayta ulash: /link", "🔌 Ваш аккаунт сайта (Google) <b>отключён</b> от этого Telegram. Подключить снова: /link", "🔌 Your website account (Google) was <b>disconnected</b> from this Telegram. To reconnect: /link"),
    ("⚙️ Hozir bajarib bo'lmadi. Keyinroq urinib ko'ring.", "⚙️ Сейчас не получилось. Попробуйте позже.", "⚙️ Could not do it right now. Please try again later."),
    ("⚙️ Hozir bajarib bo'lmadi.", "⚙️ Сейчас не получилось.", "⚙️ Could not do it right now."),
    # ---- do'st taklif ----
    ("🎁 <b>Do'st taklif qilish</b>", "🎁 <b>Пригласить друга</b>", "🎁 <b>Invite a friend</b>"),
    ("⚙️ Taklif tizimi hozircha mavjud emas.", "⚙️ Реферальная система пока недоступна.", "⚙️ The referral system is not available yet."),
    ("⚙️ Taklif tizimi hozir ishlamayapti. Keyinroq urinib ko'ring.", "⚙️ Реферальная система сейчас не работает. Попробуйте позже.", "⚙️ The referral system is not working right now. Please try later."),
    ("🎁 <b>Do'st taklif qiling — har biri uchun +", "🎁 <b>Приглашайте друзей — за каждого +", "🎁 <b>Invite friends — for each one +"),
    ("varaq</b>\nDo'stingiz havolangiz orqali kirib Google akkaunt ulasa, balansingizga", "листов</b>\nЕсли друг войдёт по вашей ссылке и подключит Google, на ваш баланс начислится", "pages</b>\nWhen a friend signs in via your link and connects Google, your balance gets"),
    ("ta pullik varaq qo'shiladi.\n\n🤖 Bot havolasi:\n<code>", "платных листов.\n\n🤖 Ссылка на бота:\n<code>", "paid pages.\n\n🤖 Bot link:\n<code>"),
    ("</code>\n\n🌐 Sayt havolasi:\n<code>", "</code>\n\n🌐 Ссылка на сайт:\n<code>", "</code>\n\n🌐 Website link:\n<code>"),
    ("</code>\n\n👥 Taklif qilinganlar: <b>", "</code>\n\n👥 Приглашено: <b>", "</code>\n\n👥 Invited: <b>"),
    ("Slide Studio — AI bilan slayd yarating. Mening havolam orqali kiring:", "Slide Studio — создавайте слайды с AI. Заходите по моей ссылке:", "Slide Studio — create slides with AI. Join via my link:"),
    ("🎉 Taklif qabul qilindi! Sizni taklif qilgan do'stingizga bonus varaqlar berildi. Xush kelibsiz!", "🎉 Приглашение принято! Вашему другу начислены бонусные листы. Добро пожаловать!", "🎉 Invitation accepted! Your friend got bonus pages. Welcome!"),
    ("🎁 Do'stingiz sizni taklif qildi!\nBonus hisoblanishi uchun avval <b>Google akkauntni ulang</b>.", "🎁 Вас пригласил друг!\nЧтобы бонус засчитался, сначала <b>подключите аккаунт Google</b>.", "🎁 A friend invited you!\nFor the bonus to count, first <b>connect your Google account</b>."),
    # ---- v76: «Yangi slayd» oqimi va dizayn ----
    ("🆕 <b>Yangi slayd</b>\n1️⃣ Dizaynni tanlang (ixtiyoriy) 👇\n2️⃣ Mavzuni yozing — AI slayd tayyorlaydi.",
     "🆕 <b>Новые слайды</b>\n1️⃣ Выберите дизайн (необязательно) 👇\n2️⃣ Напишите тему — AI подготовит слайды.",
     "🆕 <b>New slides</b>\n1️⃣ Choose a design (optional) 👇\n2️⃣ Write a topic — AI will prepare the slides."),
    ("<i>Masalan: «Sun'iy intellekt, 8 ta slayd»</i>", "<i>Например: «Искусственный интеллект, 8 слайдов»</i>", "<i>For example: «Artificial intelligence, 8 slides»</i>"),
    ("🆕 Slayd yaratish uchun avval <b>«Yangi slayd»</b> ni bosing.", "🆕 Чтобы создать слайды, сначала нажмите <b>«Новые слайды»</b>.", "🆕 To create slides, first tap <b>«New slides»</b>."),
    ("<i>Shunda eski slayd bilan aralashib ketmaydi.</i>", "<i>Так они не смешаются со старыми слайдами.</i>", "<i>This way they won't mix with your old slides.</i>"),
    ("⌛ Oldingi «Yangi slayd» sessiyasi eskirdi.", "⌛ Прошлая сессия «Новые слайды» истекла.", "⌛ The previous «New slides» session has expired."),
    ("🆕 Shu matn bilan yangi slayd", "🆕 Новые слайды по этому тексту", "🆕 New slides from this text"),
    ("✏️ Oxirgi slaydga qo'llash", "✏️ Применить к последним слайдам", "✏️ Apply to my last slides"),
    ("🎨 Dizaynni almashtirish", "🎨 Сменить дизайн", "🎨 Change design"),
    ("🔁 Qayta yaratish", "🔁 Создать заново", "🔁 Regenerate"),
    ("✨ Zamonaviy", "✨ Современный", "✨ Modern"),
    ("💼 Biznes", "💼 Бизнес", "💼 Business"),
    ("◻️ Minimalist", "◻️ Минимализм", "◻️ Minimalist"),
    ("🤖 Avto rang", "🤖 Авто цвет", "🤖 Auto colour"),
    ("<i>Qotib qolgan bo'lsa — «🆕 Yangi slayd» ni bosing.</i>", "<i>Если всё зависло — нажмите «🆕 Новые слайды».</i>", "<i>If it is stuck — tap «🆕 New slides».</i>"),
    ("Mavzu topilmadi. «🆕 Yangi slayd» ni bosing.", "Тема не найдена. Нажмите «🆕 Новые слайды».", "Topic not found. Tap «🆕 New slides»."),
    ("Slayd topilmadi. «🆕 Yangi slayd» ni bosing.", "Слайды не найдены. Нажмите «🆕 Новые слайды».", "Slides not found. Tap «🆕 New slides»."),
    # ---- boshqa ----
    ("Slayd mavzusini yozing…", "Напишите тему слайдов…", "Write a slide topic…"),
    (" ta slayd", " слайдов", " slides"),
    ("1 slayd = 1 varaq", "1 слайд = 1 лист", "1 slide = 1 page"),
    ("Tez-varaq)", "быстрых листов)", "fast pages)"),
    ("</b> varaq · Qoldi: <b>", "</b> листов · Осталось: <b>", "</b> pages · Left: <b>"),
]

_SORTED = sorted({p[0]: p for p in PHRASES}.values(), key=lambda p: -len(p[0]))
_IDX = {"ru": 1, "en": 2}


def norm_lang(code: Optional[str]) -> Optional[str]:
    c = str(code or "").lower()
    if c in LANGS:
        return c
    if c.startswith("uz"):
        return "uz"
    if c[:2] in ("ru", "be", "uk", "kk", "ky", "tg"):
        return "ru"
    if c.startswith("en"):
        return "en"
    return None


def guess(language_code: Optional[str]) -> str:
    """Telegram language_code bo'yicha taxmin (til hali tanlanmagan bo'lsa). Asosiy til — ingliz."""
    return norm_lang(language_code) or "en"


def translate(text: Any, lang: Optional[str]) -> Any:
    if not isinstance(text, str) or not text or lang not in _IDX:
        return text
    i = _IDX[lang]
    for p in _SORTED:
        if p[0] in text:
            text = text.replace(p[0], p[i])
    return text


def translate_markup(kb: Any, lang: Optional[str]) -> Any:
    """Inline / reply klaviatura tugmalari va placeholder."""
    if lang not in _IDX or not isinstance(kb, dict):
        return kb
    out = copy.deepcopy(kb)
    for key in ("inline_keyboard", "keyboard"):
        rows = out.get(key)
        if isinstance(rows, list):
            for row in rows:
                if isinstance(row, list):
                    for b in row:
                        if isinstance(b, dict) and isinstance(b.get("text"), str):
                            b["text"] = translate(b["text"], lang)
    if isinstance(out.get("input_field_placeholder"), str):
        out["input_field_placeholder"] = translate(out["input_field_placeholder"], lang)
    return out


def button_aliases(uz_label: str) -> List[str]:
    """Menyu tugmasining boshqa tillardagi yozuvlari (foydalanuvchi bosganda tanish uchun)."""
    for uz, ru, en in BUTTONS:
        if uz == uz_label:
            return [ru, en]
    return []


def picker_markup() -> Dict[str, Any]:
    return {"inline_keyboard": [[{"text": NAMES[l], "callback_data": f"lang:{l}"}] for l in LANGS]}


COMMANDS = {
    "ru": [("new", "Новые слайды"), ("my", "Мои слайды"), ("credits", "Баланс"), ("buy", "Купить листы"),
           ("invite", "Пригласить друга (+15 листов)"), ("settings", "Настройки"), ("support", "Написать админу"), ("lang", "Язык"), ("help", "Помощь")],
    "en": [("new", "New slides"), ("my", "My slides"), ("credits", "Balance"), ("buy", "Buy pages"),
           ("invite", "Invite a friend (+15 pages)"), ("settings", "Settings"), ("support", "Contact support"), ("lang", "Language"), ("help", "Help")],
}
