-- Wams Bucks spending, loans, and WamsTube Plus cancellation migration.
-- Apply this after supabase.sql. Bucks and loans are in-site points only; this
-- does not transfer real money or provide cash refunds.

create or replace function public.route_wams_spend_to_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_id uuid;
begin
  if new.amount >= 0 then
    return new;
  end if;

  select p.id into owner_id
  from public.profiles p
  where lower(p.email) = 'wams@mtps.us'
  limit 1;

  if owner_id is null then
    raise exception 'The Wams Bucks destination account wams@mtps.us is not registered; this spend was not processed';
  end if;

  -- Avoid creating a pointless self-transfer if the destination account spends.
  if new.user_id <> owner_id then
    perform public.award_wams_bucks(
      owner_id,
      -new.amount,
      left('Wams Bucks spend routed from: ' || new.reason, 160),
      'routed-spend:' || new.id::text
    );
  end if;

  return new;
end;
$$;

drop trigger if exists route_wams_spend_to_owner on public.wams_transactions;
create trigger route_wams_spend_to_owner
after insert on public.wams_transactions
for each row when (new.amount < 0)
execute procedure public.route_wams_spend_to_owner();

create or replace function public.cancel_wams_plus()
returns table(balance integer, refunded integer, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
  buyer uuid := auth.uid();
  active_plan text;
  expiry timestamptz;
  banned boolean;
  price integer;
  refund_amount integer;
  current_balance integer;
begin
  if buyer is null then
    raise exception 'Sign in to cancel WamsTube Plus';
  end if;

  select p.plus_plan, p.plus_expires_at, p.is_banned
    into active_plan, expiry, banned
  from public.profiles p
  where p.id = buyer
  for update;

  if not found or banned then
    raise exception 'This account cannot cancel a plan';
  end if;
  if active_plan is null or (active_plan <> 'lifetime' and expiry <= now()) then
    raise exception 'There is no active WamsTube Plus plan to cancel';
  end if;

  price := case active_plan
    when 'day' then 10
    when 'week' then 35
    when 'month' then 100
    when 'year' then 900
    when 'lifetime' then 5000
    else null
  end;
  if price is null then
    raise exception 'The active WamsTube Plus plan cannot be cancelled';
  end if;
  refund_amount := floor(price * 0.30)::integer;

  insert into public.wams_wallets(user_id) values (buyer)
  on conflict (user_id) do nothing;
  select w.balance into current_balance
  from public.wams_wallets w
  where w.user_id = buyer
  for update;

  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (
    buyer,
    refund_amount,
    '30% WamsTube Plus cancellation refund · ' || active_plan,
    'plus-cancel-refund:' || gen_random_uuid()::text
  );
  update public.wams_wallets w
  set balance = w.balance + refund_amount, updated_at = now()
  where w.user_id = buyer
  returning w.balance into current_balance;

  update public.profiles
  set plus_plan = null, plus_expires_at = null
  where id = buyer;
  delete from public.profile_badges
  where profile_id = buyer and badge_type = 'premium';

  return query select current_balance, refund_amount, active_plan;
end;
$$;

revoke all on function public.cancel_wams_plus() from public, anon;
grant execute on function public.cancel_wams_plus() to authenticated;

-- Virtual Bucks loans from the registered Wams account, with auditable repayments.
create table if not exists public.wams_loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount between 1 and 1000),
  repaid_amount integer not null default 0 check (repaid_amount >= 0 and repaid_amount <= amount),
  created_at timestamptz not null default now(),
  repaid_at timestamptz
);
create index if not exists wams_loans_borrower_open_idx
  on public.wams_loans(borrower_id, created_at) where repaid_amount < amount;
alter table public.wams_loans enable row level security;
drop policy if exists "users read own Wams Bucks loans" on public.wams_loans;
create policy "users read own Wams Bucks loans" on public.wams_loans
  for select to authenticated using (borrower_id = auth.uid() or public.is_wams_admin());
grant select on public.wams_loans to authenticated;

create or replace function public.borrow_wams_bucks(bucks integer)
returns table(balance integer, owed integer)
language plpgsql security definer set search_path = public as $$
declare
  borrower uuid := auth.uid();
  lender uuid;
  source_balance integer;
  borrower_balance integer;
  loan_id uuid := gen_random_uuid();
begin
  if borrower is null then raise exception 'Sign in to borrow Wams Bucks'; end if;
  if bucks < 1 or bucks > 1000 then raise exception 'Borrow between 1 and 1000 Wams Bucks per request'; end if;
  if public.is_wams_suspected(borrower) then raise exception 'This account cannot borrow Wams Bucks while restricted'; end if;
  select p.id into lender from public.profiles p where lower(p.email) = 'wams@mtps.us' limit 1;
  if lender is null then raise exception 'The Wams Bucks account wams@mtps.us is not registered'; end if;
  if borrower = lender then raise exception 'The Wams Bucks account cannot borrow from itself'; end if;
  if public.is_wams_suspected(lender) then raise exception 'The Wams Bucks lending account is unavailable'; end if;

  insert into public.wams_wallets(user_id) values (borrower), (lender) on conflict (user_id) do nothing;
  perform 1 from public.wams_wallets w where w.user_id in (borrower, lender) order by w.user_id for update;
  select w.balance into borrower_balance from public.wams_wallets w where w.user_id = borrower;
  select w.balance into source_balance from public.wams_wallets w where w.user_id = lender;
  if source_balance < bucks then raise exception 'The Wams Bucks account does not have enough available Bucks to lend'; end if;

  insert into public.wams_loans(id, borrower_id, amount) values (loan_id, borrower, bucks);
  insert into public.wams_transactions(user_id, amount, reason, event_key)
    values (lender, -bucks, 'Wams Bucks loan issued', 'loan-issued:' || loan_id::text);
  update public.wams_wallets w set balance = w.balance - bucks, updated_at = now() where w.user_id = lender;
  perform public.award_wams_bucks(borrower, bucks, 'Wams Bucks borrowed from wams@mtps.us', 'loan-received:' || loan_id::text);
  select w.balance into borrower_balance from public.wams_wallets w where w.user_id = borrower;
  return query select borrower_balance,
    (select coalesce(sum(l.amount - l.repaid_amount), 0)::integer from public.wams_loans l where l.borrower_id = borrower);
end;
$$;

create or replace function public.repay_wams_bucks(bucks integer)
returns table(balance integer, owed integer)
language plpgsql security definer set search_path = public as $$
declare
  borrower uuid := auth.uid();
  lender uuid;
  current_balance integer;
  total_owed integer;
  remaining integer;
  payment integer;
  loan_row record;
  repayment_id uuid := gen_random_uuid();
begin
  if borrower is null then raise exception 'Sign in to repay Wams Bucks'; end if;
  if bucks < 1 or bucks > 1000 then raise exception 'Repay between 1 and 1000 Wams Bucks per request'; end if;
  if public.is_wams_suspected(borrower) then raise exception 'This account cannot repay Wams Bucks while restricted'; end if;
  select p.id into lender from public.profiles p where lower(p.email) = 'wams@mtps.us' limit 1;
  if lender is null then raise exception 'The Wams Bucks account wams@mtps.us is not registered'; end if;
  if borrower = lender then raise exception 'The Wams Bucks account cannot repay itself'; end if;
  if public.is_wams_suspected(lender) then raise exception 'The Wams Bucks account is unavailable for repayments'; end if;

  insert into public.wams_wallets(user_id) values (borrower) on conflict (user_id) do nothing;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = borrower for update;
  perform 1 from public.wams_loans l where l.borrower_id = borrower and l.repaid_amount < l.amount order by l.created_at, l.id for update;
  select coalesce(sum(l.amount - l.repaid_amount), 0)::integer into total_owed
    from public.wams_loans l where l.borrower_id = borrower;
  if total_owed = 0 then raise exception 'You do not have any Wams Bucks loans to repay'; end if;
  if bucks > total_owed then raise exception 'Repayment cannot exceed your outstanding balance of % Wams Bucks', total_owed; end if;
  if current_balance < bucks then raise exception 'Not enough Wams Bucks in your wallet to make this repayment'; end if;

  insert into public.wams_transactions(user_id, amount, reason, event_key)
    values (borrower, -bucks, 'Repayment to wams@mtps.us', 'loan-repayment:' || repayment_id::text);
  update public.wams_wallets w set balance = w.balance - bucks, updated_at = now()
    where w.user_id = borrower returning w.balance into current_balance;
  remaining := bucks;
  for loan_row in
    select l.id, l.amount, l.repaid_amount from public.wams_loans l
    where l.borrower_id = borrower and l.repaid_amount < l.amount order by l.created_at, l.id for update
  loop
    exit when remaining = 0;
    payment := least(remaining, loan_row.amount - loan_row.repaid_amount);
    update public.wams_loans l set repaid_amount = l.repaid_amount + payment,
      repaid_at = case when l.repaid_amount + payment = l.amount then now() else null end
      where l.id = loan_row.id;
    remaining := remaining - payment;
  end loop;

  return query select current_balance,
    (select coalesce(sum(l.amount - l.repaid_amount), 0)::integer from public.wams_loans l where l.borrower_id = borrower);
end;
$$;
revoke all on function public.borrow_wams_bucks(integer) from public, anon;
revoke all on function public.repay_wams_bucks(integer) from public, anon;
grant execute on function public.borrow_wams_bucks(integer) to authenticated;
grant execute on function public.repay_wams_bucks(integer) to authenticated;
