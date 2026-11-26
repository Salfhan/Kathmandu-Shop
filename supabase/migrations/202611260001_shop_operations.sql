-- Kathmandu SMP Shop: secure Supabase operations
-- Apply after supabase/schema.sql in the Supabase SQL Editor.
-- All balance-changing operations run atomically inside PostgreSQL.

create or replace function public.kc_get_my_wallet()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_balance bigint;
  v_transactions jsonb;
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  insert into public.kc_wallets(user_id, balance) values (v_user, 0)
  on conflict (user_id) do nothing;
  select balance into v_balance from public.kc_wallets where user_id = v_user;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'amount', t.amount,
    'balanceAfter', t.balance_after, 'description', t.description,
    'createdAt', t.created_at
  ) order by t.created_at desc), '[]'::jsonb)
  into v_transactions
  from (select * from public.kc_transactions where user_id = v_user
        order by created_at desc limit 100) t;
  return jsonb_build_object('balance', v_balance, 'transactions', v_transactions);
end;
$$;

create or replace function public.kc_submit_topup(p_rupees integer, p_utr text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_utr text := btrim(coalesce(p_utr, ''));
begin
  if v_user is null then raise exception 'Sign in required'; end if;
  if p_rupees is null or p_rupees < 1 or p_rupees > 10000 then
    raise exception 'Enter an amount from ₹1 to ₹10,000';
  end if;
  if length(v_utr) < 6 or length(v_utr) > 40 then
    raise exception 'Enter a valid UTR/reference';
  end if;
  insert into public.kc_wallets(user_id, balance) values (v_user, 0)
  on conflict (user_id) do nothing;
  insert into public.kc_topups(user_id, rupees, coins, utr)
  values (v_user, p_rupees, p_rupees * 5, v_utr)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'rupees', p_rupees,
    'coins', p_rupees * 5, 'status', 'pending');
end;
$$;

create or replace function public.kc_approve_topup(p_topup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_topup public.kc_topups%rowtype;
  v_wallet public.kc_wallets%rowtype;
  v_balance bigint;
begin
  if v_actor is null or not public.has_shop_role(array['owner','co-owner','admin','staff']) then
    raise exception 'Staff permission required';
  end if;
  select * into v_topup from public.kc_topups
  where id = p_topup_id for update;
  if not found or v_topup.status <> 'pending' then
    raise exception 'Top-up is not pending or was already reviewed';
  end if;
  insert into public.kc_wallets(user_id, balance) values (v_topup.user_id, 0)
  on conflict (user_id) do nothing;
  select * into v_wallet from public.kc_wallets
  where user_id = v_topup.user_id for update;
  v_balance := v_wallet.balance + v_topup.coins;
  update public.kc_wallets set balance = v_balance, updated_at = now()
  where user_id = v_topup.user_id;
  update public.kc_topups set status = 'approved', reviewed_at = now(),
    reviewed_by = v_actor where id = p_topup_id;
  insert into public.kc_transactions(user_id, kind, amount, balance_after, description)
  values (v_topup.user_id, 'topup', v_topup.coins, v_balance,
    'Approved UPI top-up ' || v_topup.coins || ' KC');
  return jsonb_build_object('approved', true, 'balance', v_balance);
end;
$$;

create or replace function public.kc_review_topup(p_topup_id uuid, p_approve boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_topup public.kc_topups%rowtype;
begin
  if v_actor is null or not public.has_shop_role(array['owner','co-owner','admin','staff']) then
    raise exception 'Staff permission required';
  end if;
  if p_approve then
    return public.kc_approve_topup(p_topup_id);
  end if;
  select * into v_topup from public.kc_topups
  where id = p_topup_id for update;
  if not found or v_topup.status <> 'pending' then
    raise exception 'Top-up is not pending or was already reviewed';
  end if;
  update public.kc_topups set status = 'rejected', reviewed_at = now(),
    reviewed_by = v_actor where id = p_topup_id;
  return jsonb_build_object('approved', false, 'rejected', true);
end;
$$;

create or replace function public.shop_create_order(
  p_product_id uuid, p_edition text, p_minecraft_name text,
  p_quantity integer, p_promo_code text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_product public.shop_products%rowtype;
  v_wallet public.kc_wallets%rowtype;
  v_subtotal bigint;
  v_discount bigint := 0;
  v_total bigint;
  v_balance bigint;
  v_order public.shop_orders%rowtype;
  v_promo text := upper(btrim(coalesce(p_promo_code, '')));
begin
  if v_user is null then raise exception 'Sign in before purchasing'; end if;
  if p_edition not in ('Java','Bedrock') then raise exception 'Choose Java or Bedrock'; end if;
  if (p_edition = 'Java' and coalesce(p_minecraft_name,'') !~ '^[A-Za-z0-9_]{3,16}$')
     or (p_edition = 'Bedrock' and coalesce(p_minecraft_name,'') !~ '^[A-Za-z0-9 _-]{3,16}$') then
    raise exception 'Enter a valid Minecraft username';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    raise exception 'Quantity must be between 1 and 10';
  end if;
  if v_promo not in ('', 'KATHMANDU10') then raise exception 'Invalid promo code'; end if;
  select * into v_product from public.shop_products
  where id = p_product_id and active = true;
  if not found then raise exception 'This product is no longer available'; end if;
  v_subtotal := v_product.price::bigint * p_quantity;
  if v_promo = 'KATHMANDU10' then v_discount := round(v_subtotal * 0.10); end if;
  v_total := v_subtotal - v_discount;
  insert into public.kc_wallets(user_id, balance) values (v_user, 0)
  on conflict (user_id) do nothing;
  select * into v_wallet from public.kc_wallets where user_id = v_user for update;
  if v_wallet.balance < v_total then
    raise exception 'Not enough Kathamandian Coins. Please top up your wallet first.';
  end if;
  v_balance := v_wallet.balance - v_total;
  update public.kc_wallets set balance = v_balance, updated_at = now()
  where user_id = v_user;
  insert into public.shop_orders(user_id, edition, minecraft_name, product_id,
    product_name, quantity, unit_price, subtotal, discount_amount, total, currency, status)
  values (v_user, p_edition, btrim(p_minecraft_name), v_product.id,
    v_product.name, p_quantity, v_product.price, v_subtotal, v_discount,
    v_total, 'KC', 'payment_verified')
  returning * into v_order;
  insert into public.kc_transactions(user_id, kind, amount, balance_after, description)
  values (v_user, 'purchase', -v_total, v_balance, 'Purchase: ' || v_product.name);
  return jsonb_build_object('order', jsonb_build_object(
    'id', v_order.id, 'edition', v_order.edition, 'minecraftName', v_order.minecraft_name,
    'productName', v_order.product_name, 'quantity', v_order.quantity,
    'total', v_order.total, 'currency', v_order.currency, 'status', v_order.status,
    'createdAt', v_order.created_at
  ), 'walletBalance', v_balance);
end;
$$;

create or replace function public.shop_update_order_status(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_shop_role(array['owner','co-owner','admin','staff']) then
    raise exception 'Staff permission required';
  end if;
  if p_status not in ('awaiting_payment','payment_submitted','payment_verified','processing','delivered','rejected') then
    raise exception 'Invalid order status';
  end if;
  update public.shop_orders set status = p_status, updated_at = now()
  where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  return jsonb_build_object('updated', true);
end;
$$;

create or replace function public.shop_track_order(p_order_id uuid, p_minecraft_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_order public.shop_orders%rowtype;
begin
  select * into v_order from public.shop_orders
  where id = p_order_id
    and lower(minecraft_name) = lower(btrim(coalesce(p_minecraft_name,'')));
  if not found then raise exception 'Order not found. Check the order ID and Minecraft username.'; end if;
  return jsonb_build_object('id', v_order.id, 'minecraftName', v_order.minecraft_name,
    'edition', v_order.edition, 'productName', v_order.product_name,
    'quantity', v_order.quantity, 'total', v_order.total,
    'currency', v_order.currency, 'status', v_order.status,
    'createdAt', v_order.created_at);
end;
$$;

-- The browser may read public catalogue/settings and authenticated users may
-- manage them only when their role is authorized by the policies from schema.sql.
grant select on public.shop_settings, public.shop_products to anon, authenticated;
grant insert, update, delete on public.shop_settings, public.shop_products to authenticated;
grant select on public.shop_team_roles, public.kc_wallets, public.kc_transactions,
  public.kc_topups, public.shop_orders to authenticated;

revoke all on function public.kc_get_my_wallet() from public;
revoke all on function public.kc_submit_topup(integer,text) from public;
revoke all on function public.kc_approve_topup(uuid) from public;
revoke all on function public.kc_review_topup(uuid,boolean) from public;
revoke all on function public.shop_create_order(uuid,text,text,integer,text) from public;
revoke all on function public.shop_update_order_status(uuid,text) from public;
revoke all on function public.shop_track_order(uuid,text) from public;

grant execute on function public.kc_get_my_wallet() to authenticated;
grant execute on function public.kc_submit_topup(integer,text) to authenticated;
grant execute on function public.kc_approve_topup(uuid) to authenticated;
grant execute on function public.kc_review_topup(uuid,boolean) to authenticated;
grant execute on function public.shop_create_order(uuid,text,text,integer,text) to authenticated;
grant execute on function public.shop_update_order_status(uuid,text) to authenticated;
grant execute on function public.shop_track_order(uuid,text) to anon, authenticated;


-- Team role assignment replaces AppDeploy email invitations. The target user
-- must already have created an account with that email in Supabase Auth.
create or replace function public.shop_assign_team_role(p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid;
  v_actor_role text;
begin
  select role into v_actor_role from public.shop_team_roles where user_id = v_actor;
  if v_actor is null then raise exception 'Sign in required'; end if;
  if p_role = 'co-owner' and v_actor_role <> 'owner' then
    raise exception 'Only the Owner can appoint a Co-Owner';
  end if;
  if p_role = 'staff' and v_actor_role not in ('owner','co-owner','admin') then
    raise exception 'Admin permission required';
  end if;
  if p_role not in ('co-owner','staff') then raise exception 'Invalid team role'; end if;
  select id into v_target from auth.users where lower(email)=lower(btrim(p_email)) limit 1;
  if v_target is null then raise exception 'That person must sign in to the shop once before you can assign their role'; end if;
  insert into public.shop_team_roles(user_id,role) values(v_target,p_role)
  on conflict(user_id) do update set role=excluded.role;
  return jsonb_build_object('assigned',true,'role',p_role);
end;
$$;
revoke all on function public.shop_assign_team_role(text,text) from public;
grant execute on function public.shop_assign_team_role(text,text) to authenticated;
