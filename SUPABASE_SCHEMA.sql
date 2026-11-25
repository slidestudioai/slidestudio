-- ============================================================================
-- Slide Studio — YAGONA Supabase sozlash fayli (noldan).
--
-- Supabase → SQL Editor → New query → shu faylning BUTUN matnini qo'yib, Run bosing.
-- Qayta ishga tushirish xavfsiz (hammasi "if not exists" / "or replace").
-- Bu fayl avvalgi 5 ta faylni almashtiradi:
--   SETUP + ADMIN + TELEGRAM + AD_SENT + FIX_AUTH_TRIGGER
--
-- Balans BIRLIKDA: 1 Tez-varaq = 20 birlik, 1 Chuqur-varaq = 60 birlik
--   bepul kuniga 200 birlik = 10 Tez-varaq = 5 Chuqur-varaq
--   $1.58 = 2000 birlik     = 100 Tez-varaq = 50 Chuqur-varaq
--
-- Bazada FAQAT: akkauntlar (Auth), balans, to'lovlar, referal, fikrlar, reklama,
-- sozlamalar, Telegram bog'lanishlari. Slaydlar (fayllar) saqlanmaydi.
-- Barcha jadvallarda RLS yoqilgan, policy yo'q: faqat server (service_role kaliti)
-- kira oladi, brauzer bevosita jadvallarga murojaat qila olmaydi.
-- ============================================================================


-- ============================================================================
-- 0) "Database error saving new user" xatosining oldini olish.
--    auth.users dagi eski loyihadan qolgan triggerlarni olib tashlaymiz
--    (balans qatorini backend o'zi yaratadi, INSERT trigger kerak emas).
--    Faqat bitta AFTER DELETE trigger (o'chirilgan akkauntni tozalash) 11-bo'limda qayta yaratiladi.
-- ============================================================================
do $$
declare r record;
begin
  for r in select tgname from pg_trigger
            where tgrelid = 'auth.users'::regclass and not tgisinternal loop
    execute format('drop trigger if exists %I on auth.users', r.tgname);
  end loop;
end $$;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.create_user_usage() cascade;


-- ============================================================================
-- 1) Foydalanuvchi balansi, statistikasi, rejasi (free | pro | vip)
-- ============================================================================
create table if not exists public.user_usage (
  user_id              text primary key,
  email                text,
  free_credits         int          not null default 200,
  paid_credits         int          not null default 0,
  slide_credits        int          not null default 200,
  prompt_count         int          not null default 0,
  search_count         int          not null default 0,
  last_reset_time      timestamptz  not null default now(),
  total_tokens         bigint       not null default 0,
  daily_tokens         bigint       not null default 0,
  daily_reset          timestamptz,
  blocked              boolean      not null default false,
  last_active          timestamptz,
  created_at           timestamptz  not null default now(),
  -- admin / Pro
  plan                 text         not null default 'free',   -- free | vip
  plan_until           timestamptz,                            -- VIP tugash vaqti (NULL = muddatsiz)
  unlimited            boolean      not null default false,    -- admin "cheksiz" qilib bergan
  daily_units_override integer,                                -- shaxsiy kunlik bepul limit (birlik)
  admin_note           text                                    -- admin izohi
);
create index if not exists user_usage_email_idx on public.user_usage (email);

-- Eski bazadan yangilash uchun (yangi bazada hech narsa qilmaydi)
alter table public.user_usage add column if not exists email                text;
alter table public.user_usage add column if not exists free_credits         int         not null default 200;
alter table public.user_usage add column if not exists paid_credits         int         not null default 0;
alter table public.user_usage add column if not exists slide_credits        int         not null default 200;
alter table public.user_usage add column if not exists prompt_count         int         not null default 0;
alter table public.user_usage add column if not exists search_count         int         not null default 0;
alter table public.user_usage add column if not exists last_reset_time      timestamptz not null default now();
alter table public.user_usage add column if not exists total_tokens         bigint      not null default 0;
alter table public.user_usage add column if not exists daily_tokens         bigint      not null default 0;
alter table public.user_usage add column if not exists daily_reset          timestamptz;
alter table public.user_usage add column if not exists blocked              boolean     not null default false;
alter table public.user_usage add column if not exists last_active          timestamptz;
alter table public.user_usage add column if not exists plan                 text        not null default 'free';
alter table public.user_usage add column if not exists plan_until           timestamptz;
alter table public.user_usage add column if not exists unlimited            boolean     not null default false;
alter table public.user_usage add column if not exists daily_units_override integer;
alter table public.user_usage add column if not exists admin_note           text;


-- ============================================================================
-- 2) Balans jurnali (BIRLIKda)
-- ============================================================================
create table if not exists public.usage_ledger (
  id          bigint generated always as identity primary key,
  user_id     text        not null,
  created_at  timestamptz not null default now(),
  kind        text        not null,
  amount      int         not null,
  free_after  int,
  paid_after  int,
  searches    int         not null default 0,
  details     jsonb       not null default '{}'::jsonb
);
create index if not exists usage_ledger_user_time_idx on public.usage_ledger (user_id, created_at desc);


-- ============================================================================
-- 3) To'lovlar (webhook ikki marta hisoblanmasligi uchun)
-- ============================================================================
create table if not exists public.payment_events (
  order_id    text primary key,
  user_id     text,
  pages       int,
  created_at  timestamptz default now()
);


-- ============================================================================
-- 4) Referal
-- ============================================================================
create table if not exists public.referral_codes (
  user_id text primary key,
  code    text unique not null
);
create table if not exists public.referrals (
  invitee_id text primary key,
  inviter_id text not null,
  code       text,
  pages      int default 15,
  created_at timestamptz default now()
);
create index if not exists referrals_inviter_idx on public.referrals (inviter_id);


-- ============================================================================
-- 5) Fikrlar (izohlar + layklar)
-- ============================================================================
create table if not exists public.feedback_posts (
  id         uuid primary key,
  user_id    text not null,
  author     text,
  body       text not null,
  parent_id  uuid references public.feedback_posts(id) on delete cascade,
  created_at timestamptz default now()
);
create table if not exists public.feedback_likes (
  post_id uuid not null references public.feedback_posts(id) on delete cascade,
  user_id text not null,
  primary key (post_id, user_id)
);
create index if not exists idx_feedback_posts_created on public.feedback_posts (created_at desc);
create index if not exists idx_feedback_posts_parent  on public.feedback_posts (parent_id);
create index if not exists idx_feedback_likes_post    on public.feedback_likes (post_id);
-- v60: admin izohni tepaga qadaydi (pin)
alter table public.feedback_posts add column if not exists pinned_at timestamptz;
create index if not exists idx_feedback_posts_pinned on public.feedback_posts (pinned_at desc nulls last);


-- ============================================================================
-- 6) Reklamalar (admin paneldan boshqariladi)
-- ============================================================================
create table if not exists public.ads (
  id            bigserial primary key,
  title         text not null default '',
  body          text not null default '',
  media_type    text not null default 'none' check (media_type in ('none','image','video')),
  media_url     text not null default '',
  link_url      text not null default '',
  button_text   text not null default 'Batafsil',
  placement     text not null default 'both' check (placement in ('both','site','bot')),
  active        boolean not null default true,
  weight        integer not null default 1,
  starts_at     timestamptz,
  ends_at       timestamptz,
  impressions   bigint not null default 0,
  clicks        bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ads_active_idx on public.ads (active, placement);
-- v55: 'ad' = reklama (pastida «Reklama» yozuvi, VIP ko'rmaydi), 'notice' = e'lon (yozuvsiz, saytda popup, hammaga)
alter table public.ads add column if not exists kind text not null default 'ad';
do $$ begin
  alter table public.ads add constraint ads_kind_chk check (kind in ('ad','notice'));
exception when duplicate_object then null; end $$;

-- Reklama hisoblagichi (race-condition yo'q: bitta atomik UPDATE)
create or replace function public.ad_bump(p_id bigint, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'click' then
    update public.ads set clicks = clicks + 1 where id = p_id;
  else
    update public.ads set impressions = impressions + 1 where id = p_id;
  end if;
end $$;

-- Botga yuborilgan reklama xabarlari (reklama o'chirilganda chatdan ham o'chirish uchun)
create table if not exists public.ad_sent (
  id       bigint generated always as identity primary key,
  ad_id    bigint      not null,
  chat_id  bigint      not null,
  msg_id   bigint      not null,
  sent_at  timestamptz not null default now()
);
create index if not exists ad_sent_ad_idx   on public.ad_sent (ad_id);
create index if not exists ad_sent_time_idx on public.ad_sent (sent_at);


-- ============================================================================
-- 7) Umumiy sozlamalar va admin harakatlari jurnali
-- ============================================================================
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit (
  id         bigserial primary key,
  actor      text not null default '',
  action     text not null default '',
  target     text not null default '',
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);


-- ============================================================================
-- 8) Telegram bot jadvallari
-- ============================================================================
-- Telegram ID <-> sayt akkaunti (Google orqali kirgan) bog'lanishi
create table if not exists public.tg_links (
  tg_id      bigint primary key,
  user_id    uuid   not null unique,
  email      text   not null,
  created_at timestamptz not null default now()
);

-- Bir martalik ulash kodlari (10 daqiqa yashaydi)
create table if not exists public.tg_link_codes (
  code       text primary key,
  user_id    uuid not null,
  email      text not null,
  expires_at timestamptz not null
);
create index if not exists tg_link_codes_user_idx on public.tg_link_codes (user_id);

-- Oxirgi slaydlar (har foydalanuvchiga eng ko'pi 5 ta; faqat qisqa JSON matn)
create table if not exists public.tg_decks (
  id         bigint generated always as identity primary key,
  tg_id      bigint not null,
  user_id    uuid,
  title      text not null default '',
  topic      text not null default '',
  lang       text not null default 'uz',
  deck       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tg_decks_tg_idx on public.tg_decks (tg_id, created_at desc);


-- ============================================================================
-- 9) Xavfsizlik (RLS): policy yo'q = anon/authenticated hech narsa o'qiy olmaydi.
--    service_role (SUPABASE_SECRET_KEY) RLS ni chetlab o'tadi.
-- ============================================================================
alter table public.user_usage      enable row level security;
alter table public.usage_ledger    enable row level security;
alter table public.payment_events  enable row level security;
alter table public.referral_codes  enable row level security;
alter table public.referrals       enable row level security;
alter table public.feedback_posts  enable row level security;
alter table public.feedback_likes  enable row level security;
alter table public.ads             enable row level security;
alter table public.ad_sent         enable row level security;
alter table public.app_settings    enable row level security;
alter table public.admin_audit     enable row level security;
alter table public.tg_links        enable row level security;
alter table public.tg_link_codes   enable row level security;
alter table public.tg_decks        enable row level security;

-- Eski ochiq policy'larni (agar bo'lsa) olib tashlash
drop policy if exists "public_read_posts"  on public.feedback_posts;
drop policy if exists "public_read_likes"  on public.feedback_likes;
drop policy if exists "allow_insert_posts" on public.feedback_posts;
drop policy if exists "allow_delete_posts" on public.feedback_posts;
drop policy if exists "allow_insert_likes" on public.feedback_likes;
drop policy if exists "allow_delete_likes" on public.feedback_likes;

-- Reklama hisoblagich funksiyasini faqat server chaqira olsin
revoke all on function public.ad_bump(bigint, text) from public, anon, authenticated;
grant execute on function public.ad_bump(bigint, text) to service_role;

-- Eski bazada qolgan 300 (=15 varaq) boshlang'ich qiymatni 200 (=10 varaq) ga tuzatish (xavfsiz, qayta ishga tushirsa bo'ladi)
alter table public.user_usage alter column free_credits  set default 200;
alter table public.user_usage alter column slide_credits set default 200;


-- ============================================================================
-- 10) v52: ATOMIK to'lov (Dodo Payments webhook) — idempotent + tranzaksiya
--     Bitta SQL tranzaksiyada: payment_events ga yozadi VA balansni oshiradi/kamaytiradi.
--     Webhook 2 marta (yoki bir vaqtda 2 ta nusxada) kelsa ham balans FAQAT BIR MARTA o'zgaradi.
--     p_sign = +1 (payment.succeeded) | -1 (refund.succeeded). p_units = varaq * 20. Kalit: dodo-<payment_id>.
-- ============================================================================
alter table public.payment_events add column if not exists event_name text;
alter table public.payment_events add column if not exists units      int;

create or replace function public.apply_payment(
  p_key text, p_user_id text, p_pages int, p_units int, p_sign int, p_event text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int;
  v_paid     int;
  v_free     int;
begin
  if p_sign not in (1, -1) or p_units < 0 then
    raise exception 'bad arguments';
  end if;

  insert into public.payment_events (order_id, user_id, pages, units, event_name)
  values (p_key, p_user_id, p_pages, p_units, p_event)
  on conflict (order_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object('duplicate', true);
  end if;

  -- qator qulflanadi (FOR UPDATE ichida UPDATE) — bir vaqtdagi boshqa yozuvlar kutadi
  update public.user_usage
     set paid_credits  = greatest(0, paid_credits + p_sign * p_units),
         slide_credits = free_credits + greatest(0, paid_credits + p_sign * p_units),
         last_active   = now()
   where user_id = p_user_id
   returning paid_credits, free_credits into v_paid, v_free;

  if not found then
    -- foydalanuvchi qatori yo'q: yozuvni bekor qilamiz (webhook qayta uriniladi / qo'lda ko'rib chiqiladi)
    raise exception 'user_not_found';
  end if;

  return jsonb_build_object('duplicate', false, 'paid_credits', v_paid, 'free_credits', v_free);
end;
$$;

revoke all on function public.apply_payment(text, text, int, int, int, text) from public, anon, authenticated;
grant execute on function public.apply_payment(text, text, int, int, int, text) to service_role;


-- ============================================================================
-- 11) v52: Xavfsizlik — brauzer (anon/authenticated) public jadvallarga HECH QACHON to'g'ridan-to'g'ri tegmasin.
--     Frontend Supabase'dan faqat AUTH uchun foydalanadi; barcha ma'lumot server (service_role) orqali o'tadi.
--     RLS (yuqorida) + jadval huquqlarini ham olib tashlaymiz (ikki qavat himoya).
-- ============================================================================
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;


-- ============================================================================
-- 12) v52: Supabase Storage — foydalanuvchi fayllari (ixtiyoriy; hozir kod fayllarni SAQLAMAYDI, RAMda ishlaydi)
--     Bucket yopiq (private), maks 10 MB, faqat PDF/PNG/JPG/WEBP/GIF.
--     Har kim faqat o'z papkasiga ( <auth.uid()>/fayl ) yoza va o'qiy oladi.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-uploads', 'user-uploads', false, 10485760,
        array['application/pdf','image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists "uploads_owner_select" on storage.objects;
drop policy if exists "uploads_owner_insert" on storage.objects;
drop policy if exists "uploads_owner_delete" on storage.objects;

create policy "uploads_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "uploads_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'user-uploads' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================================
-- 13) v53: Telegram ulashda pullik varaqlarni ATOMIK ko'chirish.
--     tg<ID>@t.me akkauntidagi paid_credits sayt akkauntiga BITTA tranzaksiyada o'tadi:
--     yarim yo'lda xato bo'lsa hech narsa o'zgarmaydi (varaq yo'qolmaydi va ikki baravar bo'lmaydi).
--     Qaytaradi: {"moved": <ko'chirilgan birlik>}
-- ============================================================================
create or replace function public.transfer_paid_credits(p_from text, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid int;
begin
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'bad arguments';
  end if;

  -- ikkala qator ham bir xil tartibda qulflanadi (deadlock bo'lmasin)
  perform 1 from public.user_usage where user_id in (p_from, p_to) order by user_id for update;

  select greatest(0, coalesce(paid_credits, 0)) into v_paid from public.user_usage where user_id = p_from;
  if v_paid is null or v_paid = 0 then
    return jsonb_build_object('moved', 0);
  end if;
  if not exists (select 1 from public.user_usage where user_id = p_to) then
    raise exception 'user_not_found';
  end if;

  update public.user_usage
     set paid_credits = 0, slide_credits = free_credits, last_active = now()
   where user_id = p_from;
  update public.user_usage
     set paid_credits = paid_credits + v_paid, slide_credits = free_credits + paid_credits + v_paid, last_active = now()
   where user_id = p_to;

  return jsonb_build_object('moved', v_paid);
end;
$$;

revoke all on function public.transfer_paid_credits(text, text) from public, anon, authenticated;
grant execute on function public.transfer_paid_credits(text, text) to service_role;


-- ============================================================================
-- 11) TOZALIK: Supabase'dan (Authentication → Users) o'chirilgan akkauntning
--     barcha qoldiqlari ham avtomatik o'chadi — bir email = bitta akkaunt = bitta balans.
--     O'chiriladi: balans (user_usage), sarf tarixi (usage_ledger), referal kodi,
--     Telegram ulanishi, ulash kodlari, bot slaydlari.
--     Saqlanadi: payment_events (to'lov webhook qayta kelsa ikki marta hisoblanmasin), fikrlar, audit.
--     Trigger xato bersa ham foydalanuvchini o'chirish TO'XTAMAYDI (faqat ogohlantirish).
-- ============================================================================
create or replace function public.cleanup_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    delete from public.user_usage     where user_id = old.id::text;
    delete from public.usage_ledger   where user_id = old.id::text;
    delete from public.referral_codes where user_id = old.id::text;
    delete from public.tg_links       where user_id = old.id;
    delete from public.tg_link_codes  where user_id = old.id;
    delete from public.tg_decks       where user_id = old.id;
  exception when others then
    raise warning 'cleanup_deleted_user(%): %', old.id, sqlerrm;
  end;
  return old;
end;
$$;

drop trigger if exists ss_cleanup_deleted_user on auth.users;
create trigger ss_cleanup_deleted_user
  after delete on auth.users
  for each row execute function public.cleanup_deleted_user();

-- Avval (trigger yo'q paytda) o'chirilgan akkauntlardan qolgan "yetim" qatorlarni tozalash.
-- Shu fayl ishga tushganda bir marta bajariladi; keyin ham qo'lda chaqirish mumkin:
--   select public.cleanup_orphan_accounts();
create or replace function public.cleanup_orphan_accounts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_usage int := 0; n_ledger int := 0; n_links int := 0; n_codes int := 0; n_decks int := 0; n_ref int := 0;
begin
  delete from public.user_usage u
   where not exists (select 1 from auth.users a where a.id::text = u.user_id);
  get diagnostics n_usage = row_count;
  delete from public.usage_ledger l
   where not exists (select 1 from auth.users a where a.id::text = l.user_id);
  get diagnostics n_ledger = row_count;
  delete from public.referral_codes r
   where not exists (select 1 from auth.users a where a.id::text = r.user_id);
  get diagnostics n_ref = row_count;
  delete from public.tg_links t
   where not exists (select 1 from auth.users a where a.id = t.user_id);
  get diagnostics n_links = row_count;
  delete from public.tg_link_codes c
   where not exists (select 1 from auth.users a where a.id = c.user_id);
  get diagnostics n_codes = row_count;
  delete from public.tg_decks d
   where d.user_id is not null and not exists (select 1 from auth.users a where a.id = d.user_id);
  get diagnostics n_decks = row_count;
  return jsonb_build_object('user_usage', n_usage, 'usage_ledger', n_ledger, 'referral_codes', n_ref,
                            'tg_links', n_links, 'tg_link_codes', n_codes, 'tg_decks', n_decks);
end;
$$;

revoke all on function public.cleanup_orphan_accounts() from public, anon, authenticated;
grant execute on function public.cleanup_orphan_accounts() to service_role;
revoke all on function public.cleanup_deleted_user() from public, anon, authenticated;

select public.cleanup_orphan_accounts();


-- ============================================================================
-- 12) Telegram bot tili (uz / ru / en) — /start da tanlanadi, Mini App ham shu tilda ochiladi.
--     Telegram ID ga bog'liq (Google ulanmagan foydalanuvchida ham ishlaydi).
-- ============================================================================
create table if not exists public.tg_prefs (
  tg_id      bigint primary key,
  lang       text   not null default 'uz' check (lang in ('uz', 'ru', 'en')),
  updated_at timestamptz not null default now()
);
alter table public.tg_prefs enable row level security;


-- ============================================================================
-- 13) Audit H2: ATOMIC AI charge — one call, one transaction.
--     Replaces "read -> compute in Python -> CAS write (retries) -> ledger insert -> ledger sum"
--     (4-8 HTTP calls, and the last retry could overwrite a payment).
--     Locks the user row (FOR UPDATE), applies the 24h free reset, charges free first, then paid
--     (a bounded debt is allowed, p_max_debt), writes the ledger row and returns the new balance.
--     p_charge_id makes retries safe: the same id is never charged twice.
--     SAFE TO RE-RUN: only "add column if not exists", "create ... if not exists", "create or replace".
--     Nothing is dropped, no user data is changed.
-- ============================================================================
alter table public.usage_ledger add column if not exists charge_id text;
create unique index if not exists usage_ledger_charge_id_uq
  on public.usage_ledger (charge_id) where charge_id is not null;

create or replace function public.charge_units(
  p_user_id     text,
  p_units       int,
  p_reason      text,
  p_daily_units int,
  p_max_debt    int,
  p_tokens      bigint default 0,
  p_searches    int    default 0,
  p_details     jsonb  default '{}'::jsonb,
  p_charge_id   text   default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.user_usage%rowtype;
  v_now      timestamptz := now();
  v_free     int;
  v_paid     int;
  v_last     timestamptz;
  v_susp     boolean;
  v_total0   int;
  v_take     int  := 0;
  v_tf       int;
  v_reason   text := coalesce(nullif(p_reason, ''), 'chat');
  v_spent    bigint;
begin
  if p_user_id is null or p_units < 0 or p_daily_units < 0 or p_max_debt < 0 then
    raise exception 'bad arguments';
  end if;

  -- the row lock comes FIRST: a parallel retry with the same p_charge_id waits here, then sees the committed ledger row
  select * into r from public.user_usage where user_id = p_user_id for update;
  if not found then
    raise exception 'user_not_found';
  end if;

  if p_charge_id is not null and exists (select 1 from public.usage_ledger where charge_id = p_charge_id) then
    return jsonb_build_object('duplicate', true, 'charged', 0, 'reason', 'duplicate',
                              'free_credits', r.free_credits, 'paid_credits', r.paid_credits,
                              'last_reset_time', r.last_reset_time);
  end if;

  v_free := coalesce(r.free_credits, 0);
  v_paid := coalesce(r.paid_credits, 0);
  v_last := r.last_reset_time;

  -- 1) 24h free reset (same rules as backend/monitoring.py apply_24h_reset)
  -- v76: paid balance > 0 -> PAID mode: the daily free limit does not work at all (leftover free is not used)
  v_susp := v_paid > 0;
  if v_susp then
    v_free := 0;
    if v_last is null or v_now - v_last < interval '24 hours' then
      v_last := v_now - interval '24 hours';           -- when paid reaches 0 the free limit is back at once
    end if;
  elsif v_last is null or v_now - v_last >= interval '24 hours' then
    v_free := p_daily_units;
    v_last := v_now;
  else
    v_free := least(v_free, p_daily_units);
  end if;

  -- 2) charge (same rules as monitoring.charge_for_ai_turn). p_units = 0 -> only tokens are counted.
  if p_units > 0 then
    if not v_susp and v_free >= p_daily_units then
      v_last := v_now;                                   -- the 24h window starts with the first spend
    end if;
    v_total0 := greatest(0, v_free + v_paid);
    v_take   := greatest(0, least(p_units, v_free + v_paid + p_max_debt));
    if v_take > 0 then
      v_tf   := least(greatest(0, v_free), v_take);
      v_free := v_free - v_tf;
      v_paid := v_paid - (v_take - v_tf);                -- may go below 0 = debt (bounded by p_max_debt)
      if v_take > v_total0 then
        v_reason := v_reason || '+debt';
      end if;
    else
      v_reason := 'no_credits';
    end if;
    if v_susp and v_paid <= 0 then
      v_last := v_now - interval '24 hours';             -- paid balance used up -> free limit comes back at once
    end if;
  else
    v_reason := 'tokens_only';
  end if;

  update public.user_usage
     set free_credits    = v_free,
         paid_credits    = v_paid,
         slide_credits   = v_free + v_paid,
         last_reset_time = v_last,
         total_tokens    = coalesce(total_tokens, 0) + greatest(0, coalesce(p_tokens, 0)),
         daily_tokens    = coalesce(daily_tokens, 0) + greatest(0, coalesce(p_tokens, 0)),
         last_active     = v_now
   where user_id = p_user_id;

  if v_take > 0 then
    insert into public.usage_ledger (user_id, kind, amount, free_after, paid_after, searches, details, charge_id)
    values (p_user_id, v_reason, -v_take, v_free, v_paid, greatest(0, coalesce(p_searches, 0)),
            coalesce(p_details, '{}'::jsonb), p_charge_id);
  end if;

  select coalesce(sum(-amount), 0) into v_spent
    from public.usage_ledger
   where user_id = p_user_id and amount < 0 and created_at >= v_last;

  return jsonb_build_object('duplicate', false, 'charged', v_take, 'reason', v_reason,
                            'free_credits', v_free, 'paid_credits', v_paid,
                            'last_reset_time', v_last, 'spent_units', v_spent);
end;
$$;

revoke all on function public.charge_units(text, int, text, int, int, bigint, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.charge_units(text, int, text, int, int, bigint, int, jsonb, text) to service_role;


-- ============================================================================
-- 14) Audit H5 + M2 + M3. SAFE TO RE-RUN: only "add column if not exists", "create ... if not exists",
--     "create or replace". Nothing is dropped; existing user data is not changed.
--     purge_old_rows() deletes ONLY old log rows, and only when the server calls it (daily, see AUDIT_REPORT.md).
-- ============================================================================

-- H5: result of an AI turn whose connection dropped (for "resume" after reconnect; kept ~1 day)
create table if not exists public.ai_turn_results (
  request_id   text        primary key,
  user_id      text        not null,
  status       text        not null default 'running',     -- running | done | aborted
  reply        text,
  end_payload  jsonb,
  extra_units  int         not null default 0,             -- charged only when the resume really delivers it
  mode         text,
  created_at   timestamptz not null default now()
);
create index if not exists ai_turn_results_created_idx on public.ai_turn_results (created_at);
alter table public.ai_turn_results enable row level security;
revoke all on public.ai_turn_results from anon, authenticated;
grant all on public.ai_turn_results to service_role;

-- M2: HMAC hash of the sign-up IP (the IP itself is never stored)
alter table public.user_usage add column if not exists signup_ip_hash text;
create index if not exists user_usage_signup_ip_idx
  on public.user_usage (signup_ip_hash, created_at) where signup_ip_hash is not null;
create index if not exists user_usage_created_idx on public.user_usage (created_at desc);

-- M3: faster "last top-up" lookup (balance_cap_units) and time-based purge
create index if not exists usage_ledger_topup_idx
  on public.usage_ledger (user_id, created_at desc)
  where kind in ('purchase', 'refund', 'admin_credit', 'account_merge_in', 'tg_link_in');
create index if not exists usage_ledger_created_idx on public.usage_ledger (created_at);

-- M3: retention. Deletes in small batches (no long table locks). payment_events is NEVER deleted.
create or replace function public.purge_old_rows(
  p_ledger_days int default 365,
  p_audit_days  int default 365,
  p_adsent_days int default 7,
  p_turns_days  int default 1,
  p_batch       int default 5000
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_ledger int := 0; n_audit int := 0; n_adsent int := 0; n_turns int := 0; n int;
begin
  if p_ledger_days < 30 or p_audit_days < 30 or p_adsent_days < 3 or p_turns_days < 1 or p_batch < 1 then
    raise exception 'bad arguments (minimums: ledger/audit 30 days, ad_sent 3, turns 1)';
  end if;
  loop
    delete from public.usage_ledger where id in (
      select id from public.usage_ledger where created_at < now() - make_interval(days => p_ledger_days) limit p_batch);
    get diagnostics n = row_count; n_ledger := n_ledger + n; exit when n < p_batch;
  end loop;
  loop
    delete from public.admin_audit where id in (
      select id from public.admin_audit where created_at < now() - make_interval(days => p_audit_days) limit p_batch);
    get diagnostics n = row_count; n_audit := n_audit + n; exit when n < p_batch;
  end loop;
  loop
    delete from public.ad_sent where id in (
      select id from public.ad_sent where sent_at < now() - make_interval(days => p_adsent_days) limit p_batch);
    get diagnostics n = row_count; n_adsent := n_adsent + n; exit when n < p_batch;
  end loop;
  delete from public.ai_turn_results where created_at < now() - make_interval(days => p_turns_days);
  get diagnostics n_turns = row_count;
  return jsonb_build_object('usage_ledger', n_ledger, 'admin_audit', n_audit, 'ad_sent', n_adsent,
                            'ai_turn_results', n_turns);
end;
$$;

revoke all on function public.purge_old_rows(int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.purge_old_rows(int, int, int, int, int) to service_role;


-- ============================================================================
-- 15) v69: Telegram botdagi do'st taklifi kodi — yangi foydalanuvchi Google'ni ulaguncha kutadi.
--     Avval faqat server xotirasida (RAM) edi: 3 soatdan keyin yoki server qayta ishga tushganda yo'qolib,
--     taklif qilgan odam bonusni olmay qolardi. Qayta ishga tushirish xavfsiz.
-- ============================================================================
create table if not exists public.tg_pending_refs (
  tg_id      bigint primary key,
  code       text   not null,
  created_at timestamptz not null default now()
);
alter table public.tg_pending_refs enable row level security;
revoke all on public.tg_pending_refs from anon, authenticated;


-- ============================================================================
-- 16) v70: Yordam (Support) — foydalanuvchi ⚙️ Sozlamalar → 💬 Yordam orqali adminga shaxsiy xabar yozadi,
--     admin «Admin panel → 💬 Yordam» bo'limida o'qiydi va javob beradi. Faqat server (service_role) o'qiydi.
--     Qayta ishga tushirish xavfsiz.
-- ============================================================================
create table if not exists public.support_messages (
  id            bigserial primary key,
  user_id       text        not null,
  email         text        not null default '',
  author        text        not null default '',
  body          text        not null,
  from_admin    boolean     not null default false,
  read_by_admin boolean     not null default false,
  read_by_user  boolean     not null default true,
  created_at    timestamptz not null default now()
);
-- qayerdan yozilgan: 'site' (sayt) | 'tg' (Telegram bot) | 'admin' (admin javobi)
alter table public.support_messages add column if not exists source text not null default 'site';
create index if not exists support_messages_user_idx   on public.support_messages (user_id, created_at desc);
create index if not exists support_messages_recent_idx on public.support_messages (created_at desc);
create index if not exists support_messages_unread_idx on public.support_messages (read_by_admin) where from_admin = false;
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon, authenticated;
revoke all on sequence public.support_messages_id_seq from anon, authenticated;
grant all on public.support_messages to service_role;
grant all on sequence public.support_messages_id_seq to service_role;


-- ============================================================================
-- 17) v78: MUSTAQIL TELEGRAM AKKAUNTI (Google shart emas). Qayta ishga tushirish xavfsiz.
--   * user_usage.telegram_id   — Telegram foydalanuvchisining ASOSIY identifikatori (unikal; Google akkauntda NULL).
--   * user_usage.auth_provider — 'telegram' | 'google'.
--   * user_usage.contact_email — chek uchun email (Telegram akkauntida ixtiyoriy; Dodo to'lov oynasida kiritilgani saqlanadi).
--   * Supabase Auth login uchun texnik manzil tg<ID>@t.me (eskicha) qoladi — u foydalanuvchiga ko'rinmaydi, unga xat
--     yuborilmaydi va Dodo'ga uzatilmaydi. Shu sababli public.users ko'rinishida (view) Telegram akkauntining
--     email va google_id ustunlari NULL bo'ladi.
--   * Telegram akkauntiga ham boshlang'ich (kunlik) bepul varaq beriladi. Alohida miqdor kerak bo'lsa — server env:
--     TG_FREE_DAILY_PAGES (varaqda; 0 = Telegram akkauntlariga bepul varaq yo'q).
-- ============================================================================
alter table public.user_usage add column if not exists telegram_id   bigint;
alter table public.user_usage add column if not exists auth_provider text not null default 'google';
alter table public.user_usage add column if not exists contact_email text;
do $$ begin
  alter table public.user_usage add constraint user_usage_provider_chk check (auth_provider in ('google','telegram'));
exception when duplicate_object then null; end $$;

-- eski Telegram qatorlarini to'ldirish (tg<ID>@t.me -> telegram_id).
-- v79.1: bir Telegram ID bir nechta qatorda bo'lsa (eski dublikatlar) — FAQAT BITTASIGA yoziladi (pullik balansi ko'prog'i,
-- keyin eng so'nggi faoli). Avval hammasiga yozilib, quyidagi unikal indeks yaratilmay, fayl xato bilan to'xtardi.
update public.user_usage set auth_provider = 'telegram'
 where email ~ '^tg[0-9]+@t\.me$' and auth_provider <> 'telegram';
update public.user_usage u
   set telegram_id = x.tid
  from (select distinct on (s.tid) s.user_id, s.tid
          from (select user_id, substring(email from '^tg([0-9]+)@t\.me$')::bigint as tid,
                       paid_credits, last_active, created_at
                  from public.user_usage
                 where email ~ '^tg[0-9]+@t\.me$' and telegram_id is null) s
         where not exists (select 1 from public.user_usage o where o.telegram_id = s.tid)
         order by s.tid, s.paid_credits desc nulls last, s.last_active desc nulls last, s.created_at asc) x
 where u.user_id = x.user_id and u.telegram_id is null;
create unique index if not exists user_usage_telegram_id_uq on public.user_usage (telegram_id) where telegram_id is not null;
do $$ begin
  alter table public.user_usage add constraint user_usage_contact_email_chk
    check (contact_email is null or (length(contact_email) <= 320 and contact_email like '%_@_%'));
exception when duplicate_object then null; end $$;
-- bot / Mini App «eng oxirgi taqdimot» so'rovi (tg_id bo'yicha, updated_at bo'yicha tartib)
create index if not exists tg_decks_tg_updated_idx on public.tg_decks (tg_id, updated_at desc);

-- Yagona «users» ko'rinishi: bitta qator = bitta akkaunt (Telegram yoki Google). Faqat server o'qiydi.
-- v79.1: loyihada public.users nomli JADVAL allaqachon bo'lsa — unga tegilmaydi (ko'rinish yaratilmaydi, xato ham yo'q).
do $do$ begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'users' and c.relkind <> 'v') then
    raise notice 'public.users jadval sifatida bor — ko''rinish yaratilmadi';
    return;
  end if;
  execute $v$
create or replace view public.users as
select u.user_id,
       u.telegram_id,
       case when u.auth_provider = 'telegram' then null else nullif(u.email, '') end                     as email,
       case when u.auth_provider = 'telegram' then null
            else (select i.provider_id from auth.identities i
                   where i.user_id::text = u.user_id and i.provider = 'google' limit 1) end              as google_id,
       u.contact_email,
       u.auth_provider,
       u.created_at
  from public.user_usage u$v$;
  execute 'revoke all on public.users from anon, authenticated';
  execute 'grant select on public.users to service_role';
end $do$;


-- ============================================================================
-- 18) v79: Admin panel — Telegram foydalanuvchining ismi / @username va to'g'ri «oxirgi faollik».
--   * user_usage.tg_username, display_name — bot va Mini App har kirishda yangilaydi (ID o'rniga ism ko'rinadi).
--   * last_active: yangi qatorda darhol to'ldiriladi (ro'yxatdan o'tgan vaqt), eski bo'sh qatorlar ham to'ldiriladi —
--     admin ro'yxatida eng so'nggi faol odam TEPADA turadi. Endi bot / sayt har qanday harakatda yangilaydi
--     (avval faqat varaq sarflanganda yozilardi). Qayta ishga tushirish xavfsiz.
-- ============================================================================
alter table public.user_usage add column if not exists tg_username  text;
alter table public.user_usage add column if not exists display_name text;
update public.user_usage set last_active = coalesce(created_at, now()) where last_active is null;
alter table public.user_usage alter column last_active set default now();
create index if not exists user_usage_last_active_idx on public.user_usage (last_active desc nulls last);


-- ============================================================================
-- 19) v82: AVTOMATIK TOZALASH — Supabase bepul rejasi (500 MB) to'lib qolmasligi uchun.
--   Server har soatda public.housekeep(false) ni chaqiradi; baza hajmi DB_SOFT_LIMIT_MB (standart 400 MB)
--   dan oshsa — public.housekeep(true) (favqulodda, qattiqroq tozalash) va adminlarga Telegram xabar.
--   HECH QACHON o'chirilmaydi: payment_events (to'lovlar), user_usage (balans), support_messages (oxirgi 1 yil),
--   usage_ledger dagi to'lov / admin / ulash yozuvlari.
--   Oddiy rejim:      ai_turn_results > 2 soat, muddati o'tgan tg_link_codes, tg_pending_refs > 30 kun,
--                     tg_decks: p_deck_days kun ochilmagan taqdimotlar, support_messages > 365 kun.
--   Favqulodda rejim: + ai_turn_results > 10 daqiqa, tg_decks > 30 kun va har odamda faqat ENG OXIRGI 1 ta,
--                     usage_ledger (AI sarfi) > 30 kun, admin_audit > 90 kun, ad_sent > 3 kun, support > 180 kun.
--   O'chirilgan joy PostgreSQL tomonidan qayta ishlatiladi (baza boshqa o'smaydi). Qayta ishga tushirish xavfsiz.
-- ============================================================================
create or replace function public.db_size_mb() returns numeric
language sql
security definer
set search_path = public
as $$ select round(pg_database_size(current_database()) / 1048576.0, 1) $$;

revoke all on function public.db_size_mb() from public, anon, authenticated;
grant execute on function public.db_size_mb() to service_role;

create or replace function public.housekeep(p_emergency boolean default false, p_deck_days int default 180,
                                            p_batch int default 5000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  c_turns int := 0; c_codes int := 0; c_refs int := 0; c_decks int := 0; c_ledger int := 0;
  c_audit int := 0; c_adsent int := 0; c_support int := 0;
  v_deck_days int := greatest(7, coalesce(p_deck_days, 180));
begin
  if p_batch < 1 then raise exception 'bad arguments'; end if;
  if p_emergency then v_deck_days := least(v_deck_days, 30); end if;

  -- AI javoblari faqat uzilgan ulanishni tiklash uchun kerak (bir necha daqiqa)
  loop
    delete from public.ai_turn_results where request_id in (
      select request_id from public.ai_turn_results
       where created_at < now() - (case when p_emergency then interval '10 minutes' else interval '2 hours' end)
       limit p_batch);
    get diagnostics n = row_count; c_turns := c_turns + n; exit when n < p_batch;
  end loop;

  delete from public.tg_link_codes where expires_at < now() - interval '1 day';
  get diagnostics c_codes = row_count;
  delete from public.tg_pending_refs where created_at < now() - interval '30 days';
  get diagnostics c_refs = row_count;

  -- uzoq vaqt ochilmagan bot taqdimotlari (JSON — eng katta jadval)
  loop
    delete from public.tg_decks where id in (
      select id from public.tg_decks where updated_at < now() - make_interval(days => v_deck_days) limit p_batch);
    get diagnostics n = row_count; c_decks := c_decks + n; exit when n < p_batch;
  end loop;

  if p_emergency then
    delete from public.tg_decks d using (
      select id, row_number() over (partition by tg_id order by updated_at desc, id desc) as rn from public.tg_decks
    ) x where d.id = x.id and x.rn > 1;
    get diagnostics n = row_count; c_decks := c_decks + n;
    loop
      delete from public.usage_ledger where id in (
        select id from public.usage_ledger
         where created_at < now() - interval '30 days'
           and kind not in ('purchase', 'refund', 'admin_credit', 'account_merge_in', 'tg_link_in')
         limit p_batch);
      get diagnostics n = row_count; c_ledger := c_ledger + n; exit when n < p_batch;
    end loop;
    delete from public.admin_audit where created_at < now() - interval '90 days';
    get diagnostics c_audit = row_count;
    delete from public.ad_sent where sent_at < now() - interval '3 days';
    get diagnostics c_adsent = row_count;
  end if;

  delete from public.support_messages
   where created_at < now() - (case when p_emergency then interval '180 days' else interval '365 days' end);
  get diagnostics c_support = row_count;

  return jsonb_build_object('emergency', p_emergency, 'ai_turn_results', c_turns, 'tg_link_codes', c_codes,
                            'tg_pending_refs', c_refs, 'tg_decks', c_decks, 'usage_ledger', c_ledger,
                            'admin_audit', c_audit, 'ad_sent', c_adsent, 'support_messages', c_support,
                            'db_size_mb', public.db_size_mb());
end;
$$;

revoke all on function public.housekeep(boolean, int, int) from public, anon, authenticated;
grant execute on function public.housekeep(boolean, int, int) to service_role;
create index if not exists tg_decks_updated_idx on public.tg_decks (updated_at);
create index if not exists tg_pending_refs_created_idx on public.tg_pending_refs (created_at);
create index if not exists tg_link_codes_expires_idx on public.tg_link_codes (expires_at);
