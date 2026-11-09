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
--    (balans qatorini backend o'zi yaratadi, hech qanday trigger kerak emas).
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
