-- Kathmandu SMP Shop: initial Supabase schema
-- Run in Supabase SQL Editor. This creates empty tables; it does not import old AppDeploy data.

create extension if not exists pgcrypto;

create table if not exists public.shop_settings (
  id text primary key default 'main',
  server_name text not null default 'Kathmandu SMP',
  server_address text not null default 'play.kathmandusmp.net',
  upi_id text not null default '',
  payee_name text not null default 'Kathmandu SMP',
  announcement text not null default 'Adventure starts here. Gear up for your next journey.',
  currency text not null default 'KC' check (currency = 'KC'),
  updated_at timestamptz not null default now()
);

insert into public.shop_settings (id) values ('main') on conflict (id) do nothing;

create table if not exists public.shop_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Ranks','Kits','Coins','Crates','Keys','Custom Items')),
  description text not null default '',
  price integer not null check (price between 1 and 500000),
  currency text not null default 'KC' check (currency = 'KC'),
  active boolean not null default true,
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_team_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','co-owner','admin','staff')),
  created_at timestamptz not null default now()
);

create or replace function public.has_shop_role(allowed_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.shop_team_roles
    where user_id = auth.uid() and role = any(allowed_roles)
  );
$$;

create table if not exists public.kc_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.kc_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('topup','purchase','refund','adjustment')),
  amount bigint not null,
  balance_after bigint not null check (balance_after >= 0),
  description text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.kc_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  rupees integer not null check (rupees between 1 and 10000),
  coins integer not null check (coins = rupees * 5),
  utr text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create table if not exists public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  edition text not null check (edition in ('Java','Bedrock')),
  minecraft_name text not null,
  product_id uuid references public.shop_products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 10),
  unit_price integer not null check (unit_price >= 0),
  subtotal integer not null check (subtotal >= 0),
  discount_amount integer not null default 0 check (discount_amount >= 0),
  total integer not null check (total >= 0),
  currency text not null default 'KC' check (currency = 'KC'),
  utr text,
  status text not null default 'payment_verified' check (status in ('awaiting_payment','payment_submitted','payment_verified','processing','delivered','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shop_orders_user_created_idx on public.shop_orders(user_id, created_at desc);
create index if not exists shop_orders_created_idx on public.shop_orders(created_at desc);
create index if not exists kc_transactions_user_created_idx on public.kc_transactions(user_id, created_at desc);
create index if not exists kc_topups_status_created_idx on public.kc_topups(status, created_at desc);

alter table public.shop_settings enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_team_roles enable row level security;
alter table public.kc_wallets enable row level security;
alter table public.kc_transactions enable row level security;
alter table public.kc_topups enable row level security;
alter table public.shop_orders enable row level security;

-- Public catalogue and store configuration.
drop policy if exists "Public can read shop settings" on public.shop_settings;
create policy "Public can read shop settings" on public.shop_settings for select using (true);
drop policy if exists "Admins manage shop settings" on public.shop_settings;
create policy "Admins manage shop settings" on public.shop_settings for all to authenticated
using (public.has_shop_role(array['owner','co-owner','admin']))
with check (public.has_shop_role(array['owner','co-owner','admin']));

drop policy if exists "Public can read active products" on public.shop_products;
create policy "Public can read active products" on public.shop_products for select using (active = true or public.has_shop_role(array['owner','co-owner','admin','staff']));
drop policy if exists "Admins manage products" on public.shop_products;
create policy "Admins manage products" on public.shop_products for all to authenticated
using (public.has_shop_role(array['owner','co-owner','admin']))
with check (public.has_shop_role(array['owner','co-owner','admin']));

-- Team roles are private; only the owner/co-owner can manage team access.
drop policy if exists "Admins read team roles" on public.shop_team_roles;
create policy "Admins read team roles" on public.shop_team_roles for select to authenticated
using (user_id = auth.uid() or public.has_shop_role(array['owner','co-owner','admin']));
drop policy if exists "Owner manages team roles" on public.shop_team_roles;
create policy "Owner manages team roles" on public.shop_team_roles for all to authenticated
using (public.has_shop_role(array['owner']))
with check (public.has_shop_role(array['owner']));

-- Customer data is readable only by its owner; staff can review orders/top-ups.
drop policy if exists "Users read own wallet" on public.kc_wallets;
create policy "Users read own wallet" on public.kc_wallets for select to authenticated
using (user_id = auth.uid() or public.has_shop_role(array['owner','co-owner','admin','staff']));
drop policy if exists "Users read own transactions" on public.kc_transactions;
create policy "Users read own transactions" on public.kc_transactions for select to authenticated
using (user_id = auth.uid() or public.has_shop_role(array['owner','co-owner','admin','staff']));
drop policy if exists "Users read own topups" on public.kc_topups;
create policy "Users read own topups" on public.kc_topups for select to authenticated
using (user_id = auth.uid() or public.has_shop_role(array['owner','co-owner','admin','staff']));
drop policy if exists "Users read own orders" on public.shop_orders;
create policy "Users read own orders" on public.shop_orders for select to authenticated
using (user_id = auth.uid() or public.has_shop_role(array['owner','co-owner','admin','staff']));

-- No client-side write policies are intentionally provided for balances, ledgers,
-- orders, or top-ups. These must be changed through validated server-side functions
-- so customers cannot mint KC, approve their own top-ups, or alter order totals.

grant usage on schema public to anon, authenticated;
grant select on public.shop_settings, public.shop_products to anon, authenticated;
grant select on public.shop_team_roles, public.kc_wallets, public.kc_transactions, public.kc_topups, public.shop_orders to authenticated;
