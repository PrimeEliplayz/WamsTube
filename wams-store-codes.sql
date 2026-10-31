-- Apply after supabase.sql. Stores admin-created coupons and in-game gift cards.
-- No payment card data is collected or stored by these tables.

create table if not exists public.wams_store_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  code_type text not null check (code_type in ('gift_card', 'coupon')),
  gift_bucks integer,
  discount_type text,
  discount_value integer,
  max_uses integer not null default 1 check (max_uses > 0),
  uses integer not null default 0 check (uses >= 0 and uses <= max_uses),
  active boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (char_length(trim(code)) between 4 and 64),
  check (
    (code_type = 'gift_card' and gift_bucks is not null and gift_bucks between 1 and 1000000
      and discount_type is null and discount_value is null)
    or
    (code_type = 'coupon' and gift_bucks is null
      and discount_type is not null and discount_type in ('fixed_cents', 'percent')
      and discount_value is not null and discount_value > 0
      and (discount_type <> 'percent' or discount_value <= 100))
  )
);
create unique index if not exists wams_store_codes_code_lower_idx
  on public.wams_store_codes (lower(code));
alter table public.wams_store_codes enable row level security;
drop policy if exists "admins manage store codes" on public.wams_store_codes;
create policy "admins manage store codes" on public.wams_store_codes
  for all to authenticated using (public.is_wams_admin())
  with check (public.is_wams_admin() and created_by = auth.uid());
grant select, insert, update, delete on public.wams_store_codes to authenticated;

create table if not exists public.wams_store_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.wams_store_codes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (code_id, user_id)
);
alter table public.wams_store_code_redemptions enable row level security;
drop policy if exists "admins read store code redemptions" on public.wams_store_code_redemptions;
create policy "admins read store code redemptions" on public.wams_store_code_redemptions
  for select to authenticated using (public.is_wams_admin());
grant select on public.wams_store_code_redemptions to authenticated;

create or replace function public.redeem_wams_gift_card(gift_code text)
returns table(credited integer, balance integer)
language plpgsql security definer set search_path = public as $$
declare
  claimant uuid := auth.uid();
  gift public.wams_store_codes;
  redemption_id uuid;
  new_balance integer;
begin
  if claimant is null then raise exception 'Sign in to redeem a gift card'; end if;
  if public.is_wams_suspected(claimant) then raise exception 'This account cannot redeem Bucks while restricted'; end if;
  if char_length(trim(coalesce(gift_code, ''))) not between 4 and 64 then
    raise exception 'Enter a valid gift card code';
  end if;
  select * into gift from public.wams_store_codes c
    where lower(c.code) = lower(trim(gift_code)) for update;
  if not found or not gift.active or gift.code_type <> 'gift_card' then
    raise exception 'Gift card code is invalid or inactive';
  end if;
  if gift.uses >= gift.max_uses then raise exception 'This gift card has already been redeemed'; end if;
  insert into public.wams_store_code_redemptions(code_id, user_id)
    values (gift.id, claimant) on conflict (code_id, user_id) do nothing
    returning id into redemption_id;
  if redemption_id is null then raise exception 'You have already redeemed this gift card'; end if;
  update public.wams_store_codes set uses = uses + 1 where id = gift.id;
  perform public.award_wams_bucks(
    claimant, gift.gift_bucks, 'Redeemed Wams Bucks gift card',
    'gift-card:' || redemption_id::text
  );
  select w.balance into new_balance from public.wams_wallets w where w.user_id = claimant;
  return query select gift.gift_bucks, new_balance;
end;
$$;
revoke all on function public.redeem_wams_gift_card(text) from public, anon;
grant execute on function public.redeem_wams_gift_card(text) to authenticated;

notify pgrst, 'reload schema';
