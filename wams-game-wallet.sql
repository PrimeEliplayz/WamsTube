-- Fictional Game USD wallet and Bucks exchange.
-- Apply after supabase.sql. This currency has no real-world value and cannot
-- be purchased with cash, withdrawn, transferred, or redeemed for money.

create table if not exists public.game_usd_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance_cents integer not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.game_usd_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents integer not null check (amount_cents <> 0),
  reason text not null,
  event_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);

insert into public.game_usd_wallets(user_id)
select id from public.profiles
on conflict (user_id) do nothing;

alter table public.game_usd_wallets enable row level security;
alter table public.game_usd_transactions enable row level security;
drop policy if exists "users read own Game USD wallet" on public.game_usd_wallets;
drop policy if exists "users read own Game USD transactions" on public.game_usd_transactions;
create policy "users read own Game USD wallet" on public.game_usd_wallets
  for select to authenticated using (user_id = auth.uid() or public.is_wams_admin());
create policy "users read own Game USD transactions" on public.game_usd_transactions
  for select to authenticated using (user_id = auth.uid() or public.is_wams_admin());
grant select on public.game_usd_wallets, public.game_usd_transactions to authenticated;

create or replace function public.create_game_usd_wallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.game_usd_wallets(user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists create_game_usd_wallet_after_profile on public.profiles;
create trigger create_game_usd_wallet_after_profile after insert on public.profiles
for each row execute procedure public.create_game_usd_wallet();

-- Internal, idempotent credit helper. Only trusted triggers and admin RPC use it.
create or replace function public.award_game_usd(target uuid, cents integer, note text, event text)
returns void language plpgsql security definer set search_path = public as $$
declare credited integer;
begin
  if cents <= 0 or length(event) > 180 then raise exception 'Invalid Game USD reward'; end if;
  insert into public.game_usd_transactions(user_id, amount_cents, reason, event_key)
  values (target, cents, left(note, 160), event)
  on conflict (user_id, event_key) do nothing
  returning amount_cents into credited;
  if found then
    insert into public.game_usd_wallets(user_id, balance_cents)
    values (target, credited)
    on conflict (user_id) do update
      set balance_cents = public.game_usd_wallets.balance_cents + excluded.balance_cents,
          updated_at = now();
  end if;
end;
$$;
revoke all on function public.award_game_usd(uuid, integer, text, text) from public, anon, authenticated;

-- 100 Wams Bucks convert to 100 cents ($1.00) of fictional Game USD.
create or replace function public.exchange_wams_bucks_for_game_usd(bucks integer)
returns table(wams_balance integer, game_balance_cents integer)
language plpgsql security definer set search_path = public as $$
declare
  trader uuid := auth.uid();
  current_bucks integer;
  current_game integer;
  exchange_id uuid := gen_random_uuid();
begin
  if trader is null then raise exception 'Sign in to exchange Wams Bucks'; end if;
  if bucks < 100 or bucks > 1000000 or bucks % 100 <> 0 then
    raise exception 'Exchange a multiple of 100 Bucks, from 100 to 1000000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = trader and not p.is_banned) then
    raise exception 'This account cannot use the wallet';
  end if;

  insert into public.wams_wallets(user_id) values (trader) on conflict (user_id) do nothing;
  insert into public.game_usd_wallets(user_id) values (trader) on conflict (user_id) do nothing;
  select w.balance into current_bucks from public.wams_wallets w where w.user_id = trader for update;
  if current_bucks < bucks then raise exception 'Not enough Wams Bucks for this exchange'; end if;
  select w.balance_cents into current_game from public.game_usd_wallets w where w.user_id = trader for update;

  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (trader, -bucks, 'Exchanged for fictional Game USD', 'game-usd-exchange:' || exchange_id::text);
  update public.wams_wallets w set balance = w.balance - bucks, updated_at = now()
  where w.user_id = trader returning w.balance into current_bucks;
  perform public.award_game_usd(trader, bucks, 'Exchanged Wams Bucks for fictional Game USD', 'bucks-exchange:' || exchange_id::text);
  select w.balance_cents into current_game from public.game_usd_wallets w where w.user_id = trader;
  return query select current_bucks, current_game;
end;
$$;
revoke all on function public.exchange_wams_bucks_for_game_usd(integer) from public, anon;
grant execute on function public.exchange_wams_bucks_for_game_usd(integer) to authenticated;

-- New unique subscribers earn 10 cents of fictional Game USD for the channel.
-- The unique ledger key prevents earning again by unfollowing and resubscribing.
create or replace function public.reward_new_subscriber_game_usd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_game_usd(
    new.channel_id,
    10,
    'New subscriber reward · $0.10 Game USD',
    'subscriber-reward:' || new.follower_id::text
  );
  return new;
end;
$$;
drop trigger if exists reward_new_subscriber_game_usd on public.channel_follows;
create trigger reward_new_subscriber_game_usd after insert on public.channel_follows
for each row execute procedure public.reward_new_subscriber_game_usd();

create or replace function public.admin_grant_game_usd(target uuid, cents integer, note text default 'Administrator grant')
returns integer language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if not public.is_wams_admin() then raise exception 'Administrator access required'; end if;
  if cents < 1 or cents > 100000000 then raise exception 'Grant amount must be between $0.01 and $1,000,000.00 Game USD'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'Channel not found'; end if;
  perform public.award_game_usd(
    target,
    cents,
    left(coalesce(nullif(trim(note), ''), 'Administrator grant'), 160),
    'admin-game-usd:' || gen_random_uuid()::text
  );
  select balance_cents into new_balance from public.game_usd_wallets where user_id = target;
  return new_balance;
end;
$$;
revoke all on function public.admin_grant_game_usd(uuid, integer, text) from public, anon;
grant execute on function public.admin_grant_game_usd(uuid, integer, text) to authenticated;

-- 200 fictional Game USD site themes: 20 color palettes crossed with 10 patterns, applied across WamsTube.
create table if not exists public.game_usd_cosmetics (
  sku text primary key,
  title text not null,
  description text not null,
  palette text not null,
  pattern smallint not null check (pattern between 0 and 9),
  price_cents integer not null check (price_cents > 0),
  created_at timestamptz not null default now()
);
create table if not exists public.game_usd_cosmetic_inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_sku text not null references public.game_usd_cosmetics(sku) on delete cascade,
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_sku)
);
create unique index if not exists one_equipped_wallet_cosmetic_per_user
  on public.game_usd_cosmetic_inventory(user_id) where equipped;

with palettes(position, palette, label) as (
  values
    (1, 'aurora', 'Aurora'), (2, 'berry', 'Berry'), (3, 'blue', 'Blue'),
    (4, 'coral', 'Coral'), (5, 'cosmic', 'Cosmic'), (6, 'emerald', 'Emerald'),
    (7, 'gold', 'Gold'), (8, 'lavender', 'Lavender'), (9, 'mint', 'Mint'),
    (10, 'ocean', 'Ocean'), (11, 'orchid', 'Orchid'), (12, 'peach', 'Peach'),
    (13, 'pink', 'Pink'), (14, 'plum', 'Plum'), (15, 'rainbow', 'Rainbow'),
    (16, 'ruby', 'Ruby'), (17, 'sapphire', 'Sapphire'), (18, 'sunset', 'Sunset'),
    (19, 'teal', 'Teal'), (20, 'violet', 'Violet')
), patterns(position, pattern, label) as (
  values
    (0, 'glow', 'Glow'), (1, 'stripes', 'Stripes'), (2, 'dots', 'Dots'),
    (3, 'pinstripes', 'Pinstripes'), (4, 'grid', 'Grid'), (5, 'diagonal', 'Diagonal'),
    (6, 'halo', 'Halo'), (7, 'prism', 'Prism'), (8, 'ripples', 'Ripples'),
    (9, 'spark', 'Spark')
)
insert into public.game_usd_cosmetics(sku, title, description, palette, pattern, price_cents)
select
  'wallet_' || palettes.palette || '_' || patterns.pattern,
  palettes.label || ' ' || patterns.label || ' Site Theme',
  'A sitewide ' || lower(patterns.label) || ' theme in the ' || lower(palettes.label) || ' palette for WamsTube pages and controls.',
  palettes.palette,
  patterns.position,
  80 + palettes.position * 10 + patterns.position * 5
from palettes cross join patterns
on conflict (sku) do update set
  title = excluded.title,
  description = excluded.description,
  palette = excluded.palette,
  pattern = excluded.pattern,
  price_cents = excluded.price_cents;

alter table public.game_usd_cosmetics enable row level security;
alter table public.game_usd_cosmetic_inventory enable row level security;
drop policy if exists "Game USD cosmetics are readable" on public.game_usd_cosmetics;
create policy "Game USD cosmetics are readable" on public.game_usd_cosmetics
  for select using (true);
drop policy if exists "users read own Game USD cosmetic inventory" on public.game_usd_cosmetic_inventory;
create policy "users read own Game USD cosmetic inventory" on public.game_usd_cosmetic_inventory
  for select to authenticated using (user_id = auth.uid() or public.is_wams_admin());
grant select on public.game_usd_cosmetics to anon, authenticated;
grant select on public.game_usd_cosmetic_inventory to authenticated;

create or replace function public.buy_game_usd_cosmetic(requested_sku text)
returns table(balance_cents integer)
language plpgsql security definer set search_path = public as $$
declare
  buyer uuid := auth.uid();
  item_price integer;
  item_title text;
  new_balance integer;
begin
  if buyer is null then raise exception 'Sign in to unlock a WamsTube site theme'; end if;
  if not exists (select 1 from public.profiles p where p.id = buyer and not p.is_banned and not p.is_suspected) then
    raise exception 'This account cannot use the wallet store';
  end if;
  select c.price_cents, c.title into item_price, item_title
  from public.game_usd_cosmetics c where c.sku = requested_sku;
  if item_price is null then raise exception 'WamsTube site theme not found'; end if;

  insert into public.game_usd_wallets(user_id) values (buyer) on conflict (user_id) do nothing;
  select w.balance_cents into new_balance
  from public.game_usd_wallets w where w.user_id = buyer for update;
  if exists (select 1 from public.game_usd_cosmetic_inventory i where i.user_id = buyer and i.item_sku = requested_sku) then
    raise exception 'You already own this site theme';
  end if;
  if new_balance < item_price then raise exception 'Not enough Game USD for this site theme'; end if;

  update public.game_usd_cosmetic_inventory set equipped = false
  where user_id = buyer and equipped;
  update public.game_usd_wallets w
    set balance_cents = w.balance_cents - item_price, updated_at = now()
    where w.user_id = buyer returning w.balance_cents into new_balance;
  insert into public.game_usd_transactions(user_id, amount_cents, reason, event_key)
  values (buyer, -item_price, 'Unlocked WamsTube site theme: ' || item_title,
    'cosmetic-purchase:' || gen_random_uuid()::text);
  insert into public.game_usd_cosmetic_inventory(user_id, item_sku, equipped)
  values (buyer, requested_sku, true);
  return query select new_balance;
end;
$$;
revoke all on function public.buy_game_usd_cosmetic(text) from public, anon;
grant execute on function public.buy_game_usd_cosmetic(text) to authenticated;

create or replace function public.equip_game_usd_cosmetic(requested_sku text)
returns text language plpgsql security definer set search_path = public as $$
declare buyer uuid := auth.uid();
begin
  if buyer is null then raise exception 'Sign in to equip WamsTube site themes'; end if;
  if not exists (select 1 from public.profiles p where p.id = buyer and not p.is_banned and not p.is_suspected) then
    raise exception 'This account cannot use the wallet store';
  end if;
  if not exists (
    select 1 from public.game_usd_cosmetic_inventory i
    where i.user_id = buyer and i.item_sku = requested_sku
  ) then raise exception 'Unlock this site theme before equipping it'; end if;
  update public.game_usd_cosmetic_inventory set equipped = false
  where user_id = buyer and equipped;
  update public.game_usd_cosmetic_inventory set equipped = true
  where user_id = buyer and item_sku = requested_sku;
  return requested_sku;
end;
$$;
revoke all on function public.equip_game_usd_cosmetic(text) from public, anon;
grant execute on function public.equip_game_usd_cosmetic(text) to authenticated;

notify pgrst, 'reload schema';
