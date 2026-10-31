-- Wams Tube schema. Run this in the Supabase SQL editor.
-- Then run achievements-channel.sql to add achievements, custom badges, and channel transfer.
-- Then create a private Storage bucket named `wams-media`.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  channel_name text not null default 'New channel',
  is_admin boolean not null default false,
  is_banned boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists admin_verified boolean not null default false;
alter table public.profiles add column if not exists avatar_path text;

create table if not exists public.badge_types (
  badge_type text primary key,
  label text not null,
  description text not null
);

-- Allow trusted SQL-editor migrations (auth.uid() is null) to refresh badge definitions,
-- while requiring admin access for authenticated application requests.
create or replace function public.guard_custom_badge_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_wams_admin() then
    raise exception 'Administrator access required';
  end if;
  if new.badge_type !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'Badge key must use 2–40 lowercase letters, numbers, or underscores';
  end if;
  if char_length(trim(new.label)) not between 1 and 32 then
    raise exception 'Badge name must be 1–32 characters';
  end if;
  if char_length(coalesce(new.description, '')) > 160 then
    raise exception 'Badge description is too long';
  end if;
  return new;
end;
$$;

insert into public.badge_types (badge_type, label, description) values
  ('verified', 'Verified', 'This channel is verified by an admin grant or by reaching more than 100 followers.'),
  ('admin', 'Admin', 'A WamsTube administrator who helps manage the platform.'),
  ('owner', 'Owner', 'The owner of the WamsTube platform.'),
  ('co_owner', 'Co-Owner', 'A trusted co-owner who helps lead the WamsTube platform.'),
  ('partner', 'Partner', 'An officially recognized WamsTube partner.'),
  ('developer', 'Developer', 'A developer who builds or maintains WamsTube.'),
  ('moderator', 'Moderator', 'A moderator who helps keep the community safe.'),
  ('creator', 'Creator', 'A creator recognized for contributing videos to the community.'),
  ('early_supporter', 'Early Supporter', 'A supporter who joined and helped WamsTube in its early days.'),
  ('founding_member', 'Founding Member', 'A member recognized for helping establish the WamsTube community.'),
  ('premium', 'Plus Member', 'A WamsTube Plus member supporting the platform and enjoying the Plus experience.')
on conflict (badge_type) do update set label = excluded.label, description = excluded.description;

create table if not exists public.profile_badges (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  badge_type text not null references public.badge_types(badge_type) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (profile_id, badge_type)
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  visibility text not null default 'public' check (visibility in ('public','private')),
  storage_path text not null,
  media_type text not null,
  is_short boolean not null default false,
  is_deleted boolean not null default false,
  takedown_reason text,
  takedown_by uuid references public.profiles(id) on delete set null,
  admin_view_adjustment bigint not null default 0 check (admin_view_adjustment >= 0),
  admin_like_adjustment bigint not null default 0 check (admin_like_adjustment >= 0),
  created_at timestamptz not null default now()
);

alter table public.videos add column if not exists takedown_reason text;
alter table public.videos add column if not exists takedown_by uuid references public.profiles(id) on delete set null;

create table if not exists public.video_views (
  video_id uuid not null references public.videos(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (video_id, viewer_id)
);

create table if not exists public.video_likes (
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (video_id, user_id)
);

create table if not exists public.video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.channel_follows (
  channel_id uuid not null references public.profiles(id) on delete cascade,
  follower_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, follower_id),
  check (channel_id <> follower_id)
);

create index if not exists videos_public_feed on public.videos (created_at desc) where visibility = 'public' and not is_deleted;
create index if not exists comments_by_video on public.video_comments (video_id, created_at desc);

-- Account creation is restricted server-side; client checks are not security controls.
create or replace function public.create_wams_profile()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare channel text;
begin
  if lower(coalesce(new.email, '')) not like '%@mtps.us' then
    raise exception 'Only @mtps.us email addresses can create accounts';
  end if;
  channel := coalesce(nullif(trim(new.raw_user_meta_data ->> 'channel_name'), ''), split_part(new.email, '@', 1));
  insert into public.profiles(id, email, channel_name)
  values (new.id, lower(new.email), left(channel, 40));
  return new;
end;
$$;
drop trigger if exists create_wams_profile_after_signup on auth.users;
create trigger create_wams_profile_after_signup after insert on auth.users
for each row execute procedure public.create_wams_profile();

-- Backfill eligible accounts created before this profile trigger was installed.
insert into public.profiles(id, email, channel_name)
select
  u.id,
  lower(u.email),
  left(coalesce(nullif(trim(u.raw_user_meta_data ->> 'channel_name'), ''), split_part(u.email, '@', 1)), 40)
from auth.users u
where lower(coalesce(u.email, '')) like '%@mtps.us'
on conflict (id) do nothing;

create or replace function public.is_wams_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin and not is_banned);
$$;

create table if not exists public.platform_settings (
  setting text primary key,
  enabled boolean not null default true
);
insert into public.platform_settings (setting, enabled)
values ('uploads_enabled', true)
on conflict (setting) do nothing;

-- Verification is derived from more than 100 followers or an admin-granted mark.
create or replace function public.channel_is_verified(channel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = channel and (
      p.admin_verified or
      (select count(*) from public.channel_follows f where f.channel_id = p.id) > 100
    )
  );
$$;

create or replace function public.guard_admin_verified()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id and not public.is_wams_admin()
     and new.admin_verified is distinct from old.admin_verified then
    raise exception 'Only an admin can grant or remove verification';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_admin_verified_update on public.profiles;
create trigger guard_admin_verified_update before update on public.profiles
for each row execute procedure public.guard_admin_verified();

create or replace function public.record_video_view(video uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to record a view'; end if;
  insert into public.video_views(video_id, viewer_id)
  select v.id, auth.uid() from public.videos v
  where v.id = video and not v.is_deleted
    and (v.visibility = 'public' or v.owner_id = auth.uid())
  on conflict do nothing;
end;
$$;

create or replace function public.get_video_view_count(video uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.video_views where video_id = video;
$$;

create or replace function public.get_video_like_count(video uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from public.video_likes where video_id = video;
$$;

alter table public.profiles enable row level security;
alter table public.badge_types enable row level security;
alter table public.profile_badges enable row level security;
alter table public.videos enable row level security;
alter table public.video_views enable row level security;
alter table public.video_likes enable row level security;
alter table public.video_comments enable row level security;
alter table public.channel_follows enable row level security;
alter table public.platform_settings enable row level security;

-- Drop existing policies first so this schema can be safely rerun.
drop policy if exists "profiles are readable" on public.profiles;
drop policy if exists "badge catalog is readable" on public.badge_types;
drop policy if exists "profile badges are readable" on public.profile_badges;
drop policy if exists "admins manage profile badges" on public.profile_badges;
drop policy if exists "users update their channel name" on public.profiles;
drop policy if exists "admin manages profiles" on public.profiles;
drop policy if exists "admin deletes profiles" on public.profiles;
drop policy if exists "public and owner video read" on public.videos;
drop policy if exists "active users upload videos" on public.videos;
drop policy if exists "owners update own videos" on public.videos;
drop policy if exists "owners delete own videos" on public.videos;
drop policy if exists "admin manages videos" on public.videos;
drop policy if exists "view counts readable" on public.video_views;
drop policy if exists "likes readable" on public.video_likes;
drop policy if exists "signed in users like" on public.video_likes;
drop policy if exists "users remove own like" on public.video_likes;
drop policy if exists "comments readable" on public.video_comments;
drop policy if exists "signed in users comment" on public.video_comments;
drop policy if exists "comment owner or admin deletes" on public.video_comments;
drop policy if exists "follows readable" on public.channel_follows;
drop policy if exists "signed in users follow" on public.channel_follows;
drop policy if exists "users unfollow" on public.channel_follows;
drop policy if exists "platform settings are readable" on public.platform_settings;
drop policy if exists "admins update platform settings" on public.platform_settings;

create policy "platform settings are readable" on public.platform_settings for select using (true);
create policy "admins update platform settings" on public.platform_settings for update using (public.is_wams_admin()) with check (public.is_wams_admin());

create policy "profiles are readable" on public.profiles for select using (true);
create policy "badge catalog is readable" on public.badge_types for select using (true);
create policy "profile badges are readable" on public.profile_badges for select using (true);
create policy "admins manage profile badges" on public.profile_badges for all using (public.is_wams_admin()) with check (public.is_wams_admin());
create policy "users update their channel name" on public.profiles for update using (id = auth.uid() and not is_banned) with check (id = auth.uid() and not is_admin and not is_banned);
create policy "admin manages profiles" on public.profiles for update using (public.is_wams_admin()) with check (public.is_wams_admin());
create policy "admin deletes profiles" on public.profiles for delete using (public.is_wams_admin());

create policy "public and owner video read" on public.videos for select using ((visibility = 'public' or owner_id = auth.uid()) or public.is_wams_admin());
create policy "active users upload videos" on public.videos for insert with check (owner_id = auth.uid() and not is_deleted and exists(select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned) and exists(select 1 from public.platform_settings where setting = 'uploads_enabled' and enabled));
create policy "owners update own videos" on public.videos for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owners delete own videos" on public.videos for delete using (owner_id = auth.uid());
create policy "admin manages videos" on public.videos for all using (public.is_wams_admin()) with check (public.is_wams_admin());

create policy "view counts readable" on public.video_views for select using (true);
create policy "likes readable" on public.video_likes for select using (true);
create policy "signed in users like" on public.video_likes for insert with check (user_id = auth.uid() and exists(select 1 from public.profiles where id = auth.uid() and not is_banned));
create policy "users remove own like" on public.video_likes for delete using (user_id = auth.uid());
create policy "comments readable" on public.video_comments for select using (true);
create policy "signed in users comment" on public.video_comments for insert with check (user_id = auth.uid() and exists(select 1 from public.profiles where id = auth.uid() and not is_banned));
create policy "comment owner or admin deletes" on public.video_comments for delete using (user_id = auth.uid() or public.is_wams_admin());
create policy "follows readable" on public.channel_follows for select using (true);
create policy "signed in users follow" on public.channel_follows for insert with check (follower_id = auth.uid() and exists(select 1 from public.profiles where id = auth.uid() and not is_banned));
create policy "users unfollow" on public.channel_follows for delete using (follower_id = auth.uid());

-- The Storage bucket must be private. Paths are <auth-user-uuid>/<random-filename>.
insert into storage.buckets (id, name, public, file_size_limit) values ('wams-media', 'wams-media', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = 524288000;
insert into storage.buckets (id, name, public) values ('wams-avatars', 'wams-avatars', true)
on conflict (id) do update set public = true;
drop policy if exists "owners upload channel avatars" on storage.objects;
create policy "owners upload channel avatars" on storage.objects for insert to authenticated
with check (bucket_id = 'wams-avatars' and (storage.foldername(name))[1] = auth.uid()::text and exists(select 1 from public.profiles where id = auth.uid() and not is_banned));
drop policy if exists "owners upload media" on storage.objects;
drop policy if exists "public videos media read" on storage.objects;
drop policy if exists "owners and admins read media" on storage.objects;
drop policy if exists "owners delete media" on storage.objects;

create policy "owners upload media" on storage.objects for insert to authenticated
with check (bucket_id = 'wams-media' and (storage.foldername(name))[1] = auth.uid()::text and exists(select 1 from public.profiles where id = auth.uid() and not is_banned) and exists(select 1 from public.platform_settings where setting = 'uploads_enabled' and enabled));
create policy "public videos media read" on storage.objects for select to anon, authenticated
using (bucket_id = 'wams-media' and exists(select 1 from public.videos v where v.storage_path = name and v.visibility = 'public' and not v.is_deleted));
create policy "owners and admins read media" on storage.objects for select to authenticated
using (bucket_id = 'wams-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_wams_admin()));
create policy "owners delete media" on storage.objects for delete to authenticated
using (bucket_id = 'wams-media' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_wams_admin()));

grant usage on schema public to anon, authenticated;
grant select on public.platform_settings to anon, authenticated;
grant update (enabled) on public.platform_settings to authenticated;
grant select (id, channel_name, is_admin, is_banned, created_at) on public.profiles to anon, authenticated;
grant select (admin_verified) on public.profiles to anon, authenticated;
grant select (avatar_path) on public.profiles to anon, authenticated;
grant select on public.badge_types, public.profile_badges to anon, authenticated;
grant insert, delete on public.profile_badges to authenticated;
grant delete on public.profiles to authenticated;
grant select on public.videos, public.video_views, public.video_likes, public.video_comments, public.channel_follows to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant insert, update, delete on public.videos to authenticated;
grant insert, delete on public.video_likes, public.channel_follows to authenticated;
grant insert, delete on public.video_comments to authenticated;
grant execute on function public.record_video_view(uuid) to authenticated;
grant execute on function public.get_video_view_count(uuid) to anon, authenticated;
grant execute on function public.get_video_like_count(uuid) to anon, authenticated;
grant execute on function public.is_wams_admin() to authenticated;
grant execute on function public.channel_is_verified(uuid) to anon, authenticated;

-- Promote a trusted account manually after it has signed up:
-- update public.profiles set is_admin = true where email = 'admin@mtps.us';
-- Assign initial Owner access to explicitly selected people after applying the Owner schema below:
-- update public.profiles set is_owner = true where email = 'owner@mtps.us';

-- Grant a manually assigned badge to a channel (replace UUIDs):
-- insert into public.profile_badges (profile_id, badge_type, granted_by)
-- values ('CHANNEL_PROFILE_UUID', 'developer', 'ADMIN_PROFILE_UUID')
-- on conflict (profile_id, badge_type) do nothing;
-- Valid badge_type values: verified, admin, owner, co_owner, partner,
-- developer, moderator, creator, early_supporter, founding_member, premium.
-- Grant `premium` only to active Plus members. The verified badge is displayed automatically for admin-verified channels
-- or channels with more than 100 followers; no manual grant is needed.

-- Wams Bucks wallet and auditable transaction ledger.
create table if not exists public.wams_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.wams_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null,
  event_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, event_key)
);
alter table public.profiles add column if not exists plus_expires_at timestamptz;
alter table public.profiles add column if not exists monetization_enabled boolean not null default false;
insert into public.wams_wallets(user_id)
select id from public.profiles on conflict (user_id) do nothing;

alter table public.wams_wallets enable row level security;
alter table public.wams_transactions enable row level security;
drop policy if exists "users read own Wams Bucks wallet" on public.wams_wallets;
drop policy if exists "users read own Wams Bucks transactions" on public.wams_transactions;
create policy "users read own Wams Bucks wallet" on public.wams_wallets for select to authenticated
using (user_id = auth.uid() or public.is_wams_admin());
create policy "users read own Wams Bucks transactions" on public.wams_transactions for select to authenticated
using (user_id = auth.uid() or public.is_wams_admin());
grant select on public.wams_wallets, public.wams_transactions to authenticated;
grant select (plus_expires_at) on public.profiles to anon, authenticated;

create or replace function public.create_wams_wallet()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.wams_wallets(user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists create_wams_wallet_after_profile on public.profiles;
create trigger create_wams_wallet_after_profile after insert on public.profiles
for each row execute procedure public.create_wams_wallet();

-- This helper is only called by trusted database triggers and admin-only RPCs.
create or replace function public.award_wams_bucks(target uuid, bucks integer, note text, event text)
returns void language plpgsql security definer set search_path = public as $$
declare inserted_amount integer;
begin
  if bucks <= 0 or length(event) > 180 then raise exception 'Invalid reward'; end if;
  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (target, bucks, left(note, 160), event)
  on conflict (user_id, event_key) do nothing
  returning amount into inserted_amount;
  if found then
    insert into public.wams_wallets(user_id, balance) values (target, inserted_amount)
    on conflict (user_id) do update set balance = public.wams_wallets.balance + excluded.balance, updated_at = now();
  end if;
end;
$$;
revoke all on function public.award_wams_bucks(uuid, integer, text, text) from public, anon, authenticated;

create or replace function public.reward_comment_wams_bucks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_wams_bucks(new.user_id, 1, 'Daily comment reward', 'comment-day:' || (now() at time zone 'utc')::date::text);
  return new;
end;
$$;
drop trigger if exists reward_comment_wams_bucks on public.video_comments;
create trigger reward_comment_wams_bucks after insert on public.video_comments
for each row execute procedure public.reward_comment_wams_bucks();

create or replace function public.reward_follow_wams_bucks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.award_wams_bucks(new.channel_id, 5, 'New subscriber reward', 'follow:' || new.channel_id::text || ':' || new.follower_id::text);
  return new;
end;
$$;
drop trigger if exists reward_follow_wams_bucks on public.channel_follows;
create trigger reward_follow_wams_bucks after insert on public.channel_follows
for each row execute procedure public.reward_follow_wams_bucks();

create or replace function public.reward_like_wams_bucks()
returns trigger language plpgsql security definer set search_path = public as $$
declare creator uuid;
begin
  select owner_id into creator from public.videos where id = new.video_id;
  if creator is not null and creator <> new.user_id then
    perform public.award_wams_bucks(creator, 1, 'Video liked by a viewer', 'like:' || new.video_id::text || ':' || new.user_id::text);
  end if;
  return new;
end;
$$;
drop trigger if exists reward_like_wams_bucks on public.video_likes;
create trigger reward_like_wams_bucks after insert on public.video_likes
for each row execute procedure public.reward_like_wams_bucks();

create or replace function public.admin_grant_wams_bucks(target uuid, bucks integer, note text default 'Administrator grant')
returns integer language plpgsql security definer set search_path = public as $$
declare new_balance integer;
begin
  if not public.is_wams_admin() then raise exception 'Administrator access required'; end if;
  if bucks < 1 or bucks > 100000 then raise exception 'Grant amount must be between 1 and 100000'; end if;
  if not exists (select 1 from public.profiles where id = target) then raise exception 'Channel not found'; end if;
  perform public.award_wams_bucks(target, bucks, left(coalesce(nullif(trim(note), ''), 'Administrator grant'), 160), 'admin-grant:' || gen_random_uuid()::text);
  select balance into new_balance from public.wams_wallets where user_id = target;
  return new_balance;
end;
$$;

create or replace function public.purchase_wams_plus()
returns table(balance integer, expires_at timestamptz) language plpgsql security definer set search_path = public as $$
declare buyer uuid := auth.uid(); current_expiry timestamptz; current_balance integer;
begin
  if buyer is null then raise exception 'Sign in to check out'; end if;
  if not exists (select 1 from public.profiles where id = buyer and not is_banned) then raise exception 'This account cannot make purchases'; end if;
  insert into public.wams_wallets(user_id) values (buyer) on conflict (user_id) do nothing;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = buyer for update;
  select p.plus_expires_at into current_expiry from public.profiles p where p.id = buyer;
  if current_expiry > now() then raise exception 'WamsTube Plus is already active until %', current_expiry; end if;
  if current_balance < 100 then raise exception 'You need 100 Wams Bucks to check out'; end if;
  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (buyer, -100, 'WamsTube Plus · 30 days', 'plus-purchase:' || gen_random_uuid()::text);
  update public.wams_wallets as wallet set balance = wallet.balance - 100, updated_at = now() where user_id = buyer returning wallet.balance into current_balance;
  update public.profiles set plus_expires_at = now() + interval '30 days' where id = buyer;
  insert into public.profile_badges(profile_id, badge_type, granted_by)
  values (buyer, 'premium', buyer) on conflict (profile_id, badge_type) do nothing;
  return query select current_balance, now() + interval '30 days';
end;
$$;

grant execute on function public.admin_grant_wams_bucks(uuid, integer, text) to authenticated;
grant execute on function public.purchase_wams_plus() to authenticated;
grant select (plus_expires_at, monetization_enabled) on public.profiles to anon, authenticated;
-- Membership expiry is only changed by the trusted checkout RPC, not direct profile updates.
revoke update on public.profiles from authenticated;
grant update (channel_name, avatar_path, is_admin, is_banned, admin_verified, monetization_enabled) on public.profiles to authenticated;
create table if not exists public.video_reports (
    id uuid primary key default gen_random_uuid(),
    video_id uuid not null references public.videos(id) on delete cascade,
    reporter_id uuid not null references public.profiles(id) on delete cascade,
    reason text not null check (char_length(trim(reason)) between 1 and 120),
    details text check (
        details is null
        or char_length(details) <= 2000
    ),
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'rejected')),
    reviewed_by uuid references public.profiles(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists video_reports_status_created_idx
on public.video_reports(status, created_at desc);

create index if not exists video_reports_video_idx
on public.video_reports(video_id);

alter table public.video_reports enable row level security;

drop policy if exists "users submit video reports"
on public.video_reports;

drop policy if exists "users read own video reports"
on public.video_reports;

drop policy if exists "admins manage video reports"
on public.video_reports;

create policy "users submit video reports"
on public.video_reports
for insert
to authenticated
with check (
    reporter_id = auth.uid()
    and exists (
        select 1
        from public.profiles
        where id = auth.uid()
          and not is_banned
    )
    and exists (
        select 1
        from public.videos
        where id = video_id
          and visibility = 'public'
          and not is_deleted
    )
);

create policy "users read own video reports"
on public.video_reports
for select
to authenticated
using (reporter_id = auth.uid());

create policy "admins manage video reports"
on public.video_reports
for all
to authenticated
using (public.is_wams_admin())
with check (public.is_wams_admin());

grant select on public.video_reports to authenticated;
grant insert on public.video_reports to authenticated;
grant update on public.video_reports to authenticated;

create or replace function public.review_video_report(
    report_id uuid,
    decision text,
    takedown_note text default null
)
returns public.video_reports
language plpgsql
security definer
set search_path = public
as $$
declare
    current_report public.video_reports;
    updated_report public.video_reports;
begin
    if not public.is_wams_admin() then
        raise exception 'Administrator access required';
    end if;

    if decision not in ('accepted', 'rejected') then
        raise exception 'Decision must be accepted or rejected';
    end if;

    select *
    into current_report
    from public.video_reports
    where id = report_id
    for update;

    if current_report.id is null then
        raise exception 'Report not found';
    end if;

    update public.video_reports
    set
        status = decision,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = report_id
    returning *
    into updated_report;

    if decision = 'accepted' then
        update public.videos
        set
            is_deleted = true,
            takedown_reason = left(
                coalesce(
                    nullif(trim(takedown_note), ''),
                    current_report.reason
                ),
                500
            ),
            takedown_by = auth.uid()
        where id = current_report.video_id
          and not is_deleted;
    end if;

    return updated_report;
end;
$$;

grant execute
on function public.review_video_report(uuid, text, text)
to authenticated;

-- Creator monetization is opt-in and can only be enabled by verified channels.
create or replace function public.guard_channel_monetization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id
     and new.monetization_enabled is distinct from old.monetization_enabled
     and new.monetization_enabled
     and not public.channel_is_verified(new.id) then
    raise exception 'Only verified channels can enable monetization';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_channel_monetization_update on public.profiles;
create trigger guard_channel_monetization_update before update on public.profiles
for each row execute procedure public.guard_channel_monetization();

-- Track only new, unique public views made while the creator is verified and monetized.
create table if not exists public.creator_view_rewards (
  creator_id uuid primary key references public.profiles(id) on delete cascade,
  qualifying_views bigint not null default 0 check (qualifying_views >= 0)
);
alter table public.creator_view_rewards enable row level security;

create or replace function public.reward_verified_creator_view()
returns trigger language plpgsql security definer set search_path = public as $$
declare creator uuid; view_total bigint;
begin
  select v.owner_id into creator
  from public.videos v
  join public.profiles p on p.id = v.owner_id
  where v.id = new.video_id
    and v.visibility = 'public'
    and not v.is_deleted
    and p.monetization_enabled
    and public.channel_is_verified(v.owner_id)
    and new.viewer_id <> v.owner_id;

  if creator is null then return new; end if;

  insert into public.creator_view_rewards(creator_id, qualifying_views)
  values (creator, 1)
  on conflict (creator_id) do update
    set qualifying_views = public.creator_view_rewards.qualifying_views + 1
  returning qualifying_views into view_total;

  if view_total % 10 = 0 then
    perform public.award_wams_bucks(
      creator,
      5,
      'Verified channel reward: 10 monetized views',
      'creator-views:' || creator::text || ':' || (view_total / 10)::text
    );
  end if;
  return new;
end;
$$;
drop trigger if exists reward_verified_creator_view on public.video_views;
create trigger reward_verified_creator_view after insert on public.video_views
for each row execute procedure public.reward_verified_creator_view();

create or replace function public.claim_daily_wams_bucks()
returns table(balance integer, claimed boolean)
language plpgsql security definer set search_path = public as $$
declare claimant uuid := auth.uid(); today_key text; current_balance integer;
begin
  if claimant is null then raise exception 'Sign in to claim your daily Wams Bucks'; end if;
  if not exists (select 1 from public.profiles where id = claimant and not is_banned) then
    raise exception 'This account cannot claim Wams Bucks';
  end if;
  today_key := (now() at time zone 'utc')::date::text;
  insert into public.wams_wallets(user_id) values (claimant) on conflict (user_id) do nothing;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = claimant for update;
  if exists (
    select 1 from public.wams_transactions t
    where t.user_id = claimant and t.event_key = 'daily-claim:' || today_key
  ) then
    return query select current_balance, false;
    return;
  end if;
  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (claimant, 10, 'Daily Wams Bucks reward', 'daily-claim:' || today_key);
  update public.wams_wallets w set balance = w.balance + 10, updated_at = now()
  where w.user_id = claimant returning w.balance into current_balance;
  return query select current_balance, true;
end;
$$;

create table if not exists public.video_donations (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null check (amount between 1 and 1000),
  created_at timestamptz not null default now()
);

create or replace function public.donate_wams_bucks_to_video(target_video uuid, bucks integer)
returns table(balance integer, donated integer, plus_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare sender uuid := auth.uid(); creator uuid; current_balance integer; expiry timestamptz; donation_id uuid := gen_random_uuid();
begin
  if sender is null then raise exception 'Sign in to donate Wams Bucks'; end if;
  if bucks < 1 or bucks > 1000 then raise exception 'Donation must be between 1 and 1000 Wams Bucks'; end if;
  if not exists (select 1 from public.profiles where id = sender and not is_banned) then
    raise exception 'This account cannot make donations';
  end if;
  select v.owner_id into creator from public.videos v
  where v.id = target_video and v.visibility = 'public' and not v.is_deleted;
  if creator is null then raise exception 'This public video is unavailable'; end if;
  if creator = sender then raise exception 'You cannot donate to your own channel'; end if;
  if not public.channel_is_verified(creator)
     or not exists (select 1 from public.profiles p where p.id = creator and p.monetization_enabled) then
    raise exception 'Donations are available only on verified channels with monetization enabled';
  end if;

  insert into public.wams_wallets(user_id) values (sender) on conflict (user_id) do nothing;
  insert into public.wams_wallets(user_id) values (creator) on conflict (user_id) do nothing;
  perform 1 from public.wams_wallets w
  where w.user_id in (sender, creator) order by w.user_id for update;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = sender;
  if current_balance < bucks then raise exception 'Not enough Wams Bucks for this donation'; end if;

  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (sender, -bucks, 'Video donation', 'donation-sent:' || donation_id::text);
  update public.wams_wallets w set balance = w.balance - bucks, updated_at = now()
  where w.user_id = sender returning w.balance into current_balance;
  perform public.award_wams_bucks(creator, bucks, 'Wams Bucks video donation', 'donation-received:' || donation_id::text);
  insert into public.video_donations(id, video_id, sender_id, recipient_id, amount)
  values (donation_id, target_video, sender, creator, bucks);

  update public.profiles p
  set plus_expires_at = greatest(coalesce(p.plus_expires_at, now()), now()) + interval '30 days'
  where p.id = creator returning p.plus_expires_at into expiry;
  insert into public.profile_badges(profile_id, badge_type, granted_by)
  values (creator, 'premium', creator) on conflict (profile_id, badge_type) do nothing;
  return query select current_balance, bucks, expiry;
end;
$$;

alter table public.video_donations enable row level security;
drop policy if exists "users read related video donations" on public.video_donations;
create policy "users read related video donations" on public.video_donations for select to authenticated
using (sender_id = auth.uid() or recipient_id = auth.uid() or public.is_wams_admin());
grant select on public.video_donations to authenticated;
grant select (monetization_enabled) on public.profiles to anon, authenticated;
grant update (monetization_enabled) on public.profiles to authenticated;
grant execute on function public.claim_daily_wams_bucks() to authenticated;
grant execute on function public.donate_wams_bucks_to_video(uuid, integer) to authenticated;

-- Inbox notifications are private to their recipient. Admin announcements are always important.
create table if not exists public.inbox_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null check (type in ('new_subscriber', 'video_like', 'comment_like', 'admin_message')),
  title text not null,
  body text not null,
  target_url text,
  important boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists inbox_notifications_recipient_created_idx
  on public.inbox_notifications(recipient_id, created_at desc);
create index if not exists inbox_notifications_unread_idx
  on public.inbox_notifications(recipient_id) where read_at is null;
alter table public.inbox_notifications enable row level security;
drop policy if exists "users read own inbox notifications" on public.inbox_notifications;
drop policy if exists "users mark own inbox notifications read" on public.inbox_notifications;
create policy "users read own inbox notifications" on public.inbox_notifications
  for select to authenticated using (recipient_id = auth.uid());
create policy "users mark own inbox notifications read" on public.inbox_notifications
  for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
grant select on public.inbox_notifications to authenticated;
grant update (read_at) on public.inbox_notifications to authenticated;

-- Comment likes power both the comment's like control and its owner's inbox alert.
create table if not exists public.video_comment_likes (
  comment_id uuid not null references public.video_comments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.video_comment_likes enable row level security;
drop policy if exists "comment likes are readable" on public.video_comment_likes;
drop policy if exists "active users like comments" on public.video_comment_likes;
drop policy if exists "users remove own comment likes" on public.video_comment_likes;
create policy "comment likes are readable" on public.video_comment_likes for select using (true);
create policy "active users like comments" on public.video_comment_likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned));
create policy "users remove own comment likes" on public.video_comment_likes for delete to authenticated
  using (user_id = auth.uid());
grant select on public.video_comment_likes to anon, authenticated;
grant insert, delete on public.video_comment_likes to authenticated;

create or replace function public.notify_new_subscriber()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  if new.channel_id = new.follower_id then return new; end if;
  select channel_name into actor_name from public.profiles where id = new.follower_id;
  insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, target_url)
  values (new.channel_id, new.follower_id, 'new_subscriber', 'New subscriber',
    coalesce(actor_name, 'Someone') || ' subscribed to your channel.',
    'channel.html?channel=' || new.channel_id::text);
  return new;
end;
$$;
drop trigger if exists inbox_new_subscriber on public.channel_follows;
create trigger inbox_new_subscriber after insert on public.channel_follows
  for each row execute procedure public.notify_new_subscriber();

create or replace function public.notify_video_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare creator uuid; creator_name text; liked_title text;
begin
  select v.owner_id, v.title into creator, liked_title from public.videos v where v.id = new.video_id;
  if creator is null or creator = new.user_id then return new; end if;
  select channel_name into creator_name from public.profiles where id = new.user_id;
  insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, target_url)
  values (creator, new.user_id, 'video_like', 'Your video got a like',
    coalesce(creator_name, 'Someone') || ' liked your video “' || coalesce(liked_title, 'your video') || '”.',
    'watch.html?videoId=' || new.video_id::text);
  return new;
end;
$$;
drop trigger if exists inbox_video_like on public.video_likes;
create trigger inbox_video_like after insert on public.video_likes
  for each row execute procedure public.notify_video_like();

create or replace function public.notify_comment_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient uuid; video uuid; actor_name text;
begin
  select c.user_id, c.video_id into recipient, video from public.video_comments c where c.id = new.comment_id;
  if recipient is null or recipient = new.user_id then return new; end if;
  select channel_name into actor_name from public.profiles where id = new.user_id;
  insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, target_url)
  values (recipient, new.user_id, 'comment_like', 'Someone liked your comment',
    coalesce(actor_name, 'Someone') || ' liked your comment.',
    'watch.html?videoId=' || video::text || '#comment-' || new.comment_id::text);
  return new;
end;
$$;
drop trigger if exists inbox_comment_like on public.video_comment_likes;
create trigger inbox_comment_like after insert on public.video_comment_likes
  for each row execute procedure public.notify_comment_like();

create or replace function public.admin_send_inbox_message(target uuid, message_title text, message_body text)
returns integer language plpgsql security definer set search_path = public as $$
declare delivered integer;
begin
  if not public.is_wams_admin() then raise exception 'Administrator access required'; end if;
  if message_title is null or char_length(trim(message_title)) not between 1 and 120 then
    raise exception 'Subject must be between 1 and 120 characters';
  end if;
  if message_body is null or char_length(trim(message_body)) not between 1 and 2000 then
    raise exception 'Message must be between 1 and 2000 characters';
  end if;
  if target is null then
    insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, important)
    select p.id, auth.uid(), 'admin_message', trim(message_title), trim(message_body), true
    from public.profiles p;
  else
    insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, important)
    values (target, auth.uid(), 'admin_message', trim(message_title), trim(message_body), true);
  end if;
  get diagnostics delivered = row_count;
  return delivered;
end;
$$;
revoke all on function public.admin_send_inbox_message(uuid, text, text) from public, anon;
grant execute on function public.admin_send_inbox_message(uuid, text, text) to authenticated;

-- WamsTube Plus Studio: captions, playback trims, channel analytics, and subscriber-only videos.
alter table public.videos add column if not exists description text not null default '';
alter table public.videos add column if not exists caption_path text;
alter table public.videos add column if not exists trim_start_seconds double precision not null default 0;
alter table public.videos add column if not exists trim_end_seconds double precision;
alter table public.videos drop constraint if exists videos_visibility_check;
alter table public.videos add constraint videos_visibility_check
  check (visibility in ('public', 'private', 'subscribers'));
alter table public.videos drop constraint if exists videos_trim_range_check;
alter table public.videos add constraint videos_trim_range_check
  check (trim_start_seconds >= 0 and (trim_end_seconds is null or trim_end_seconds > trim_start_seconds));

create or replace function public.guard_plus_studio_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_wams_admin()
     and not exists (
       select 1 from public.profiles p
       where p.id = new.owner_id and not p.is_banned and p.plus_expires_at > now()
     )
     and (
       tg_op = 'UPDATE'
       or new.visibility = 'subscribers'
       or new.caption_path is not null
       or new.trim_start_seconds > 0
       or new.trim_end_seconds is not null
       or nullif(trim(coalesce(new.description, '')), '') is not null
     ) then
    raise exception 'An active WamsTube Plus membership is required to use Studio editing tools';
  end if;
  if new.caption_path is not null
     and coalesce((storage.foldername(new.caption_path))[1], '') <> new.owner_id::text then
    raise exception 'Caption files must belong to the video owner';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_plus_studio_video on public.videos;
create trigger guard_plus_studio_video before insert or update on public.videos
for each row execute procedure public.guard_plus_studio_video();

-- A subscriber may read subscriber-only metadata; private uploads remain owner-only.
drop policy if exists "public and owner video read" on public.videos;
create policy "public and owner video read" on public.videos for select using (
  owner_id = auth.uid()
  or (
    not is_deleted and (
      visibility = 'public'
      or (visibility = 'subscribers' and exists (
        select 1 from public.channel_follows f
        where f.channel_id = owner_id and f.follower_id = auth.uid()
      ))
    )
  )
);

-- Keep analytics and engagement tied to videos the viewer is allowed to see.
drop policy if exists "view counts readable" on public.video_views;
create policy "view counts readable" on public.video_views for select using (
  public.is_wams_admin()
  or exists (
    select 1 from public.videos v
    join public.profiles p on p.id = v.owner_id
    where v.id = video_id and v.owner_id = auth.uid()
      and not p.is_banned and p.plus_expires_at > now()
  )
);
drop policy if exists "likes readable" on public.video_likes;
create policy "likes readable" on public.video_likes for select using (
  exists (select 1 from public.videos v where v.id = video_id)
);
drop policy if exists "comments readable" on public.video_comments;
create policy "comments readable" on public.video_comments for select using (
  exists (select 1 from public.videos v where v.id = video_id)
);
drop policy if exists "signed in users like" on public.video_likes;
create policy "signed in users like" on public.video_likes for insert
with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned)
  and exists (select 1 from public.videos v where v.id = video_likes.video_id)
);
drop policy if exists "signed in users comment" on public.video_comments;
create policy "signed in users comment" on public.video_comments for insert
with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned)
  and exists (select 1 from public.videos v where v.id = video_comments.video_id)
);
drop policy if exists "comment likes are readable" on public.video_comment_likes;
create policy "comment likes are readable" on public.video_comment_likes for select using (
  exists (select 1 from public.video_comments c where c.id = comment_id)
);
drop policy if exists "active users like comments" on public.video_comment_likes;
create policy "active users like comments" on public.video_comment_likes for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned)
  and exists (select 1 from public.video_comments c where c.id = comment_id)
);

-- Signed media URLs are also protected: the viewer needs a follow for subscriber-only files.
drop policy if exists "public videos media read" on storage.objects;
create policy "public videos media read" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'wams-media' and exists (
    select 1 from public.videos v
    where (v.storage_path = name or v.caption_path = name)
      and not v.is_deleted
      and (
        v.visibility = 'public'
        or (v.visibility = 'subscribers' and exists (
          select 1 from public.channel_follows f
          where f.channel_id = v.owner_id and f.follower_id = auth.uid()
        ))
      )
  )
);

create or replace function public.record_video_view(video uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to record a view'; end if;
  insert into public.video_views(video_id, viewer_id)
  select v.id, auth.uid() from public.videos v
  where v.id = video and not v.is_deleted
    and (
      v.visibility = 'public'
      or v.owner_id = auth.uid()
      or (v.visibility = 'subscribers' and exists (
        select 1 from public.channel_follows f
        where f.channel_id = v.owner_id and f.follower_id = auth.uid()
      ))
    )
  on conflict do nothing;
end;
$$;

-- Plus plan tiers: Day (playback), Week (Studio editing), Month (analytics and subscriber-only uploads),
-- Year (creator monetization), and Lifetime (all Plus features).
alter table public.profiles add column if not exists plus_plan text;
alter table public.profiles drop constraint if exists profiles_plus_plan_check;
alter table public.profiles add constraint profiles_plus_plan_check
  check (plus_plan is null or plus_plan in ('day', 'week', 'month', 'year', 'lifetime'));
-- Existing active memberships predate plan tracking; preserve them as Month memberships.
update public.profiles set plus_plan = 'month'
where plus_plan is null and plus_expires_at > now();
grant select (plus_plan) on public.profiles to anon, authenticated;

create or replace function public.has_wams_plus_feature(feature_name text, account_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case feature_name
      when 'playback' then p.plus_plan in ('day', 'week', 'month', 'year', 'lifetime')
      when 'studio' then p.plus_plan in ('week', 'month', 'year', 'lifetime')
      when 'captions_trim' then p.plus_plan in ('week', 'month', 'year', 'lifetime')
      when 'analytics' then p.plus_plan in ('month', 'year', 'lifetime')
      when 'subscriber_videos' then p.plus_plan in ('month', 'year', 'lifetime')
      when 'monetization' then p.plus_plan in ('year', 'lifetime')
      when 'animated_profile_art' then p.plus_plan in ('day', 'week', 'month', 'year', 'lifetime')
      when 'all' then p.plus_plan = 'lifetime'
      else false
    end
    from public.profiles p
    where p.id = account_id and not p.is_banned
      and (p.plus_plan = 'lifetime' or p.plus_expires_at > now())
  ), false);
$$;
revoke all on function public.has_wams_plus_feature(text, uuid) from public, anon;
grant execute on function public.has_wams_plus_feature(text, uuid) to anon, authenticated;

create or replace function public.purchase_wams_plus(requested_plan text)
returns table(balance integer, expires_at timestamptz, plan text)
language plpgsql security definer set search_path = public as $$
declare
  buyer uuid := auth.uid();
  current_expiry timestamptz;
  current_plan text;
  current_balance integer;
  price integer;
  membership_duration interval;
begin
  if buyer is null then raise exception 'Sign in to check out'; end if;
  if not exists (select 1 from public.profiles where id = buyer and not is_banned) then
    raise exception 'This account cannot make purchases';
  end if;
  case requested_plan
    when 'day' then price := 10; membership_duration := interval '1 day';
    when 'week' then price := 35; membership_duration := interval '7 days';
    when 'month' then price := 100; membership_duration := interval '1 month';
    when 'year' then price := 900; membership_duration := interval '1 year';
    when 'lifetime' then price := 5000; membership_duration := null;
    else raise exception 'Choose a valid WamsTube Plus plan';
  end case;

  insert into public.wams_wallets(user_id) values (buyer) on conflict (user_id) do nothing;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = buyer for update;
  select p.plus_expires_at, p.plus_plan into current_expiry, current_plan
  from public.profiles p where p.id = buyer for update;
  if current_plan = 'lifetime' or current_expiry > now() then
    raise exception 'WamsTube Plus is already active';
  end if;
  if current_balance < price then
    raise exception 'You need % Wams Bucks to check out with this plan', price - current_balance;
  end if;

  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (buyer, -price, 'WamsTube Plus · ' || requested_plan, 'plus-purchase:' || gen_random_uuid()::text);
  update public.wams_wallets as wallet set balance = wallet.balance - price, updated_at = now()
  where user_id = buyer returning wallet.balance into current_balance;
  update public.profiles p set
    plus_plan = requested_plan,
    plus_expires_at = case when requested_plan = 'lifetime' then null else now() + membership_duration end
  where p.id = buyer;
  insert into public.profile_badges(profile_id, badge_type, granted_by)
  values (buyer, 'premium', buyer) on conflict (profile_id, badge_type) do nothing;
  return query select current_balance,
    case when requested_plan = 'lifetime' then null::timestamptz else now() + membership_duration end,
    requested_plan;
end;
$$;
revoke all on function public.purchase_wams_plus(text) from public, anon;
grant execute on function public.purchase_wams_plus(text) to authenticated;

-- Keep existing clients working while using the fixed Month price and the same server validation.
create or replace function public.purchase_wams_plus()
returns table(balance integer, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query select purchase.balance, purchase.expires_at
  from public.purchase_wams_plus('month') as purchase;
end;
$$;
revoke all on function public.purchase_wams_plus() from public, anon;
grant execute on function public.purchase_wams_plus() to authenticated;

-- Enforce the same plan thresholds in the database, not just in Studio's interface.
create or replace function public.guard_plus_studio_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_wams_admin() and tg_op = 'UPDATE'
     and not public.has_wams_plus_feature('studio', new.owner_id) then
    raise exception 'An active Week or higher WamsTube Plus plan is required to edit videos in Studio';
  end if;
  if not public.is_wams_admin() and not public.has_wams_plus_feature('studio', new.owner_id)
     and (new.visibility = 'subscribers' or new.caption_path is not null
       or new.trim_start_seconds > 0 or new.trim_end_seconds is not null
       or nullif(trim(coalesce(new.description, '')), '') is not null) then
    raise exception 'An active Week or higher WamsTube Plus plan is required for Studio editing tools';
  end if;
  if new.visibility = 'subscribers'
     and not public.is_wams_admin()
     and not public.has_wams_plus_feature('subscriber_videos', new.owner_id) then
    raise exception 'Subscriber-only videos require a Month or higher WamsTube Plus plan';
  end if;
  if (new.caption_path is not null or new.trim_start_seconds > 0 or new.trim_end_seconds is not null)
     and not public.is_wams_admin()
     and not public.has_wams_plus_feature('captions_trim', new.owner_id) then
    raise exception 'Captions and trimming require a Week or higher WamsTube Plus plan';
  end if;
  if new.caption_path is not null
     and coalesce((storage.foldername(new.caption_path))[1], '') <> new.owner_id::text then
    raise exception 'Caption files must belong to the video owner';
  end if;
  return new;
end;
$$;

-- The analytics view policy must respect the Month tier and Lifetime access.
drop policy if exists "view counts readable" on public.video_views;
create policy "view counts readable" on public.video_views for select to authenticated using (
  public.is_wams_admin()
  or exists (
    select 1 from public.videos v
    where v.id = video_id and v.owner_id = auth.uid()
      and public.has_wams_plus_feature('analytics', v.owner_id)
  )
);

-- Subscriber-only uploads stop being available to subscribers when the creator's Month+ access expires.
drop policy if exists "public and owner video read" on public.videos;
create policy "public and owner video read" on public.videos for select using (
  owner_id = auth.uid()
  or (
    not is_deleted and (
      visibility = 'public'
      or (visibility = 'subscribers'
        and public.has_wams_plus_feature('subscriber_videos', owner_id)
        and exists (
          select 1 from public.channel_follows f
          where f.channel_id = owner_id and f.follower_id = auth.uid()
        ))
    )
  )
);
drop policy if exists "public videos media read" on storage.objects;
create policy "public videos media read" on storage.objects for select to anon, authenticated
using (
  bucket_id = 'wams-media' and exists (
    select 1 from public.videos v
    where (v.storage_path = name or v.caption_path = name)
      and not v.is_deleted
      and (
        v.visibility = 'public'
        or (v.visibility = 'subscribers'
          and public.has_wams_plus_feature('subscriber_videos', v.owner_id)
          and exists (
            select 1 from public.channel_follows f
            where f.channel_id = v.owner_id and f.follower_id = auth.uid()
          ))
      )
  )
);
create or replace function public.record_video_view(video uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in to record a view'; end if;
  insert into public.video_views(video_id, viewer_id)
  select v.id, auth.uid() from public.videos v
  where v.id = video and not v.is_deleted
    and (
      v.visibility = 'public'
      or v.owner_id = auth.uid()
      or (v.visibility = 'subscribers'
        and public.has_wams_plus_feature('subscriber_videos', v.owner_id)
        and exists (
          select 1 from public.channel_follows f
          where f.channel_id = v.owner_id and f.follower_id = auth.uid()
        ))
    )
  on conflict do nothing;
end;
$$;

-- Verified creator monetization is reserved for Year and Lifetime members.
create or replace function public.reward_verified_creator_view()
returns trigger language plpgsql security definer set search_path = public as $$
declare creator uuid; view_total bigint;
begin
  select v.owner_id into creator
  from public.videos v
  join public.profiles p on p.id = v.owner_id
  where v.id = new.video_id
    and v.visibility = 'public'
    and not v.is_deleted
    and p.monetization_enabled
    and public.channel_is_verified(v.owner_id)
    and public.has_wams_plus_feature('monetization', v.owner_id)
    and new.viewer_id <> v.owner_id;
  if creator is null then return new; end if;
  insert into public.creator_view_rewards(creator_id, qualifying_views)
  values (creator, 1)
  on conflict (creator_id) do update
    set qualifying_views = public.creator_view_rewards.qualifying_views + 1
  returning qualifying_views into view_total;
  if view_total % 10 = 0 then
    perform public.award_wams_bucks(
      creator, 5, 'Verified channel reward: 10 monetized views',
      'creator-views:' || creator::text || ':' || (view_total / 10)::text
    );
  end if;
  return new;
end;
$$;

create or replace function public.guard_channel_monetization()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id
     and new.monetization_enabled is distinct from old.monetization_enabled
     and new.monetization_enabled
     and (not public.channel_is_verified(new.id)
       or not public.has_wams_plus_feature('monetization', new.id)) then
    raise exception 'Verified channels with a Year or Lifetime Plus plan can enable monetization';
  end if;
  return new;
end;
$$;

-- Donations continue to grant 30 days of Plus and do not downgrade higher tiers.
create or replace function public.donate_wams_bucks_to_video(target_video uuid, bucks integer)
returns table(balance integer, donated integer, plus_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare sender uuid := auth.uid(); creator uuid; current_balance integer; expiry timestamptz; donation_id uuid := gen_random_uuid();
begin
  if sender is null then raise exception 'Sign in to donate Wams Bucks'; end if;
  if bucks < 1 or bucks > 1000 then raise exception 'Donation must be between 1 and 1000 Wams Bucks'; end if;
  if not exists (select 1 from public.profiles where id = sender and not is_banned) then
    raise exception 'This account cannot make donations';
  end if;
  select v.owner_id into creator from public.videos v
  where v.id = target_video and v.visibility = 'public' and not v.is_deleted;
  if creator is null then raise exception 'This public video is unavailable'; end if;
  if creator = sender then raise exception 'You cannot donate to your own channel'; end if;
  if not public.channel_is_verified(creator)
     or not exists (
       select 1 from public.profiles p
       where p.id = creator and p.monetization_enabled
         and public.has_wams_plus_feature('monetization', p.id)
     ) then
    raise exception 'Donations are available only on verified channels with active Year or Lifetime Plus monetization';
  end if;
  insert into public.wams_wallets(user_id) values (sender) on conflict (user_id) do nothing;
  insert into public.wams_wallets(user_id) values (creator) on conflict (user_id) do nothing;
  perform 1 from public.wams_wallets w
  where w.user_id in (sender, creator) order by w.user_id for update;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = sender;
  if current_balance < bucks then raise exception 'Not enough Wams Bucks for this donation'; end if;
  insert into public.wams_transactions(user_id, amount, reason, event_key)
  values (sender, -bucks, 'Video donation', 'donation-sent:' || donation_id::text);
  update public.wams_wallets w set balance = w.balance - bucks, updated_at = now()
  where w.user_id = sender returning w.balance into current_balance;
  perform public.award_wams_bucks(creator, bucks, 'Wams Bucks video donation', 'donation-received:' || donation_id::text);
  insert into public.video_donations(id, video_id, sender_id, recipient_id, amount)
  values (donation_id, target_video, sender, creator, bucks);
  update public.profiles p
  set plus_expires_at = case when p.plus_plan = 'lifetime' then null
        else greatest(coalesce(p.plus_expires_at, now()), now()) + interval '30 days' end,
      plus_plan = case when p.plus_plan = 'lifetime' then 'lifetime' else coalesce(p.plus_plan, 'month') end
  where p.id = creator returning p.plus_expires_at into expiry;
  insert into public.profile_badges(profile_id, badge_type, granted_by)
  values (creator, 'premium', creator) on conflict (profile_id, badge_type) do nothing;
  return query select current_balance, bucks, expiry;
end;
$$;

-- Suspicion controls are reversible and deliberately require administrator review.
alter table public.profiles add column if not exists is_suspected boolean not null default false;
alter table public.profiles add column if not exists suspicion_reason text;
alter table public.profiles add column if not exists suspected_by uuid references public.profiles(id) on delete set null;
alter table public.profiles add column if not exists suspected_at timestamptz;
grant select (is_suspected) on public.profiles to anon, authenticated;
create or replace function public.is_wams_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin and not is_banned and not is_suspected
  );
$$;
grant execute on function public.is_wams_admin() to anon, authenticated;

alter table public.inbox_notifications drop constraint if exists inbox_notifications_type_check;
alter table public.inbox_notifications add constraint inbox_notifications_type_check
  check (type in ('new_subscriber', 'video_like', 'comment_like', 'admin_message', 'account_suspicion'));

create or replace function public.is_wams_suspected(account_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_suspected or p.is_banned from public.profiles p where p.id = account_id), true);
$$;
revoke all on function public.is_wams_suspected(uuid) from public, anon;
grant execute on function public.is_wams_suspected(uuid) to anon, authenticated;

create or replace function public.admin_set_account_suspicion(target uuid, suspicious boolean, reason text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare target_name text;
begin
  if not public.is_wams_admin() then raise exception 'Administrator access required'; end if;
  if target is null or target = auth.uid() then raise exception 'Choose another account to review'; end if;
  update public.profiles
  set is_suspected = suspicious,
      suspicion_reason = case when suspicious then left(coalesce(nullif(trim(reason), ''), 'Activity is under review'), 500) else null end,
      suspected_by = case when suspicious then auth.uid() else null end,
      suspected_at = case when suspicious then now() else null end
  where id = target
  returning channel_name into target_name;
  if target_name is null then raise exception 'Channel not found'; end if;
  if suspicious then
    insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, important)
    values (target, auth.uid(), 'account_suspicion', 'Account activity under review',
      'This channel is under suspicion. Some features, including Wams Bucks and uploads, are temporarily blocked while activity is reviewed. ' || left(coalesce(nullif(trim(reason), ''), 'Activity is under review'), 500), true);
  end if;
  return suspicious;
end;
$$;
revoke all on function public.admin_set_account_suspicion(uuid, boolean, text) from public, anon;
grant execute on function public.admin_set_account_suspicion(uuid, boolean, text) to authenticated;

-- Suspicious activity is surfaced to admins for review; volume spikes never auto-ban users.
create or replace function public.admin_activity_spike_candidates()
returns table(profile_id uuid, channel_name text, bucks_last_hour bigint, bucks_hourly_baseline numeric,
              follows_last_hour bigint, follows_hourly_baseline numeric, is_suspected boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_wams_admin() then raise exception 'Administrator access required'; end if;
  return query
  with bucks as (
    select t.user_id,
      coalesce(sum(t.amount) filter (where t.amount > 0 and t.created_at >= now() - interval '1 hour'), 0)::bigint as recent,
      coalesce(sum(t.amount) filter (where t.amount > 0 and t.created_at >= now() - interval '24 hours' and t.created_at < now() - interval '1 hour'), 0)::numeric / 23 as baseline
    from public.wams_transactions t
    where t.created_at >= now() - interval '24 hours'
    group by t.user_id
  ), follows as (
    select f.channel_id as user_id,
      count(*) filter (where f.created_at >= now() - interval '1 hour')::bigint as recent,
      count(*) filter (where f.created_at >= now() - interval '24 hours' and f.created_at < now() - interval '1 hour')::numeric / 23 as baseline
    from public.channel_follows f
    where f.created_at >= now() - interval '24 hours'
    group by f.channel_id
  )
  select p.id, p.channel_name, coalesce(b.recent, 0), coalesce(b.baseline, 0),
         coalesce(f.recent, 0), coalesce(f.baseline, 0), p.is_suspected
  from public.profiles p
  left join bucks b on b.user_id = p.id
  left join follows f on f.user_id = p.id
  where not p.is_banned and (
    coalesce(b.recent, 0) > greatest(100, coalesce(b.baseline, 0) * 5)
    or coalesce(f.recent, 0) > greatest(10, coalesce(f.baseline, 0) * 5)
  )
  order by coalesce(b.recent, 0) desc, coalesce(f.recent, 0) desc;
end;
$$;
revoke all on function public.admin_activity_spike_candidates() from public, anon;
grant execute on function public.admin_activity_spike_candidates() to authenticated;

-- Prevent restricted accounts from changing their channel, posting, following, or uploading.
drop policy if exists "users update their channel name" on public.profiles;
create policy "users update their channel name" on public.profiles for update
  using (id = auth.uid() and not is_banned and not is_suspected)
  with check (id = auth.uid() and not is_admin and not is_banned and not is_suspected);
drop policy if exists "active users upload videos" on public.videos;
create policy "active users upload videos" on public.videos for insert with check (
  owner_id = auth.uid() and not is_deleted
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.platform_settings where setting = 'uploads_enabled' and enabled)
);
drop policy if exists "owners update own videos" on public.videos;
create policy "owners update own videos" on public.videos for update
  using (owner_id = auth.uid() and not public.is_wams_suspected(owner_id))
  with check (owner_id = auth.uid() and not public.is_wams_suspected(owner_id));
drop policy if exists "signed in users like" on public.video_likes;
create policy "signed in users like" on public.video_likes for insert with check (
  user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.videos v where v.id = video_likes.video_id)
);
drop policy if exists "signed in users comment" on public.video_comments;
create policy "signed in users comment" on public.video_comments for insert with check (
  user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.videos v where v.id = video_comments.video_id)
);
drop policy if exists "signed in users follow" on public.channel_follows;
create policy "signed in users follow" on public.channel_follows for insert with check (
  follower_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.profiles channel where channel.id = channel_id and not channel.is_suspected and not channel.is_banned)
);
drop policy if exists "active users like comments" on public.video_comment_likes;
create policy "active users like comments" on public.video_comment_likes for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.video_comments c where c.id = comment_id)
);
drop policy if exists "users submit video reports" on public.video_reports;
create policy "users submit video reports" on public.video_reports for insert to authenticated with check (
  reporter_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.videos v where v.id = video_id and v.visibility = 'public' and not v.is_deleted)
);
drop policy if exists "owners upload channel avatars" on storage.objects;
create policy "owners upload channel avatars" on storage.objects for insert to authenticated with check (
  bucket_id = 'wams-avatars' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
);
drop policy if exists "owners upload media" on storage.objects;
create policy "owners upload media" on storage.objects for insert to authenticated with check (
  bucket_id = 'wams-media' and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and exists (select 1 from public.platform_settings where setting = 'uploads_enabled' and enabled)
);

-- Hide account wallets and public channel videos during an active review.
drop policy if exists "users read own Wams Bucks wallet" on public.wams_wallets;
grant execute on function public.is_wams_admin() to anon;
create policy "users read own Wams Bucks wallet" on public.wams_wallets for select to authenticated
  using ((user_id = auth.uid() and not public.is_wams_suspected(user_id)) or public.is_wams_admin());
drop policy if exists "users read own Wams Bucks transactions" on public.wams_transactions;
create policy "users read own Wams Bucks transactions" on public.wams_transactions for select to authenticated
  using ((user_id = auth.uid() and not public.is_wams_suspected(user_id)) or public.is_wams_admin());
create or replace function public.guard_suspected_wallet_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_wams_suspected(new.user_id) and not public.is_wams_admin() then
    if new.user_id = auth.uid() then
      raise exception 'Wams Bucks are locked while this account is under review';
    end if;
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_suspected_wallet_activity on public.wams_transactions;
create trigger guard_suspected_wallet_activity before insert on public.wams_transactions
  for each row execute procedure public.guard_suspected_wallet_activity();

-- Restrict public channel/video discovery and the associated media URLs until review is cleared.
drop policy if exists "public and owner video read" on public.videos;
create policy "public and owner video read" on public.videos for select using (
  public.is_wams_admin()
  or (owner_id = auth.uid() and not public.is_wams_suspected(owner_id))
  or (not is_deleted and not public.is_wams_suspected(owner_id) and (
    visibility = 'public'
    or (visibility = 'subscribers' and public.has_wams_plus_feature('subscriber_videos', owner_id)
      and exists (select 1 from public.channel_follows f where f.channel_id = owner_id and f.follower_id = auth.uid()))
  ))
);
drop policy if exists "public videos media read" on storage.objects;
create policy "public videos media read" on storage.objects for select to anon, authenticated using (
  bucket_id = 'wams-media' and exists (
    select 1 from public.videos v
    where (v.storage_path = name or v.caption_path = name) and not v.is_deleted
      and not public.is_wams_suspected(v.owner_id)
      and (v.visibility = 'public' or (v.visibility = 'subscribers'
        and public.has_wams_plus_feature('subscriber_videos', v.owner_id)
        and exists (select 1 from public.channel_follows f where f.channel_id = v.owner_id and f.follower_id = auth.uid())))
  )
);

create or replace function public.guard_suspected_donation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_wams_suspected(new.recipient_id) and not public.is_wams_admin() then
    raise exception 'Donations to channels under review are temporarily unavailable';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_suspected_donation on public.video_donations;
create trigger guard_suspected_donation before insert on public.video_donations
  for each row execute procedure public.guard_suspected_donation();

-- What’s New: public announcements managed by WamsTube administrators.
create table if not exists public.wams_news (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 120),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  image_path text,
  published boolean not null default true,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint wams_news_image_path_owner check (
    image_path is null or split_part(image_path, '/', 1) = created_by::text
  )
);
create index if not exists wams_news_published_created_idx
  on public.wams_news(published, created_at desc);
alter table public.wams_news enable row level security;
drop policy if exists "everyone reads published WamsTube news" on public.wams_news;
drop policy if exists "admins manage WamsTube news" on public.wams_news;
create policy "everyone reads published WamsTube news" on public.wams_news
  for select to anon, authenticated using (published);
create policy "admins manage WamsTube news" on public.wams_news
  for all to authenticated using (public.is_wams_admin())
  with check (public.is_wams_admin() and created_by = auth.uid());
grant select on public.wams_news to anon, authenticated;
grant insert, update, delete on public.wams_news to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('wams-news', 'wams-news', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;
drop policy if exists "public reads WamsTube news images" on storage.objects;
drop policy if exists "admins upload WamsTube news images" on storage.objects;
drop policy if exists "admins delete WamsTube news images" on storage.objects;
create policy "public reads WamsTube news images" on storage.objects
  for select to anon, authenticated using (bucket_id = 'wams-news');
create policy "admins upload WamsTube news images" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'wams-news'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_wams_admin()
  );
create policy "admins delete WamsTube news images" on storage.objects
  for delete to authenticated using (
    bucket_id = 'wams-news' and public.is_wams_admin()
  );

-- Owner-only controls. Assign is_owner only to explicitly approved profiles.
alter table public.profiles add column if not exists is_owner boolean not null default false;
grant select (is_owner) on public.profiles to anon, authenticated;

create or replace function public.is_wams_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_owner and not p.is_banned and not p.is_suspected
  );
$$;
revoke all on function public.is_wams_owner() from public, anon;
grant execute on function public.is_wams_owner() to authenticated;

-- Owners retain the administrator toolset, while owner-specific RPCs still
-- require the separate owner flag.
create or replace function public.is_wams_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_admin
      and not p.is_banned and not p.is_suspected
  );
$$;
grant execute on function public.is_wams_admin() to anon, authenticated;

create or replace function public.admin_set_owner(target uuid, make_owner boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  current_owner boolean;
  active_owners bigint;
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if target is null then raise exception 'Choose a channel'; end if;
  if target = auth.uid() and not make_owner then raise exception 'You cannot remove your own Owner access'; end if;
  select p.is_owner into current_owner from public.profiles p where p.id = target for update;
  if current_owner is null then raise exception 'Channel not found'; end if;
  if current_owner = make_owner then return current_owner; end if;
  if not make_owner then
    select count(*) into active_owners from public.profiles p
    where p.is_owner and not p.is_banned and not p.is_suspected;
    if active_owners <= 1 then raise exception 'The last active owner cannot be removed'; end if;
  end if;
  update public.profiles set is_owner = make_owner where id = target;
  return make_owner;
end;
$$;
revoke all on function public.admin_set_owner(uuid, boolean) from public, anon;
grant execute on function public.admin_set_owner(uuid, boolean) to authenticated;

create table if not exists public.site_lockdown (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint site_lockdown_reason_length check (reason is null or char_length(reason) <= 500)
);
insert into public.site_lockdown(singleton, enabled, reason)
values (true, false, null)
on conflict (singleton) do nothing;
alter table public.site_lockdown enable row level security;
drop policy if exists "site lockdown status is public" on public.site_lockdown;
create policy "site lockdown status is public" on public.site_lockdown
  for select to anon, authenticated using (true);
grant select on public.site_lockdown to anon, authenticated;

create or replace function public.admin_set_site_lockdown(locked boolean, lockdown_reason text default null)
returns public.site_lockdown
language plpgsql security definer set search_path = public as $$
declare result public.site_lockdown;
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if locked and char_length(trim(coalesce(lockdown_reason, ''))) not between 1 and 500 then
    raise exception 'Enter a lockdown reason (1–500 characters)';
  end if;
  insert into public.site_lockdown(singleton, enabled, reason, updated_by, updated_at)
  values (true, locked, case when locked then trim(lockdown_reason) else null end, auth.uid(), now())
  on conflict (singleton) do update set
    enabled = excluded.enabled,
    reason = excluded.reason,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into result;
  return result;
end;
$$;
revoke all on function public.admin_set_site_lockdown(boolean, text) from public, anon;
grant execute on function public.admin_set_site_lockdown(boolean, text) to authenticated;

create or replace function public.is_site_locked_down()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.enabled from public.site_lockdown s where s.singleton), false);
$$;
revoke all on function public.is_site_locked_down() from public;
grant execute on function public.is_site_locked_down() to anon, authenticated;
-- This returns false to signed-out visitors and is used only for the owner bypass in RLS.
grant execute on function public.is_wams_owner() to anon;

-- Database-side maintenance enforcement: non-owners cannot read or change core site data
-- while the public site is locked. The owner remains able to inspect and restore service.
drop policy if exists "site lockdown restricts videos" on public.videos;
create policy "site lockdown restricts videos" on public.videos as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts views" on public.video_views;
create policy "site lockdown restricts views" on public.video_views as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts likes" on public.video_likes;
create policy "site lockdown restricts likes" on public.video_likes as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts comments" on public.video_comments;
create policy "site lockdown restricts comments" on public.video_comments as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts follows" on public.channel_follows;
create policy "site lockdown restricts follows" on public.channel_follows as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts comment likes" on public.video_comment_likes;
create policy "site lockdown restricts comment likes" on public.video_comment_likes as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts reports" on public.video_reports;
create policy "site lockdown restricts reports" on public.video_reports as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts donations" on public.video_donations;
create policy "site lockdown restricts donations" on public.video_donations as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts wallet access" on public.wams_wallets;
create policy "site lockdown restricts wallet access" on public.wams_wallets as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts wallet ledger" on public.wams_transactions;
create policy "site lockdown restricts wallet ledger" on public.wams_transactions as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts inbox" on public.inbox_notifications;
create policy "site lockdown restricts inbox" on public.inbox_notifications as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts news" on public.wams_news;
create policy "site lockdown restricts news" on public.wams_news as restrictive for all to anon, authenticated
  using (not public.is_site_locked_down() or public.is_wams_owner())
  with check (not public.is_site_locked_down() or public.is_wams_owner());
drop policy if exists "site lockdown restricts stored video media" on storage.objects;
create policy "site lockdown restricts stored video media" on storage.objects as restrictive for all to anon, authenticated
  using (bucket_id <> 'wams-media' or not public.is_site_locked_down() or public.is_wams_owner())
  with check (bucket_id <> 'wams-media' or not public.is_site_locked_down() or public.is_wams_owner());

-- Additional owner-only operations: public site notices and an immutable owner action history.
create table if not exists public.site_announcement (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  title text not null default '',
  body text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint site_announcement_title_length check (char_length(title) <= 120),
  constraint site_announcement_body_length check (char_length(body) <= 1000)
);
insert into public.site_announcement(singleton, enabled, title, body)
values (true, false, '', '')
on conflict (singleton) do nothing;
alter table public.site_announcement enable row level security;
drop policy if exists "public reads owner announcement" on public.site_announcement;
create policy "public reads owner announcement" on public.site_announcement
  for select to anon, authenticated using (true);
grant select on public.site_announcement to anon, authenticated;

create table if not exists public.owner_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists owner_audit_log_created_idx on public.owner_audit_log(created_at desc);
alter table public.owner_audit_log enable row level security;
drop policy if exists "owners read owner audit log" on public.owner_audit_log;
create policy "owners read owner audit log" on public.owner_audit_log
  for select to authenticated using (public.is_wams_owner());
grant select on public.owner_audit_log to authenticated;

create or replace function public.owner_set_site_announcement(
  enabled boolean,
  announcement_title text default null,
  announcement_body text default null
)
returns public.site_announcement
language plpgsql security definer set search_path = public as $$
declare result public.site_announcement; safe_title text := trim(coalesce(announcement_title, '')); safe_body text := trim(coalesce(announcement_body, ''));
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if enabled and char_length(safe_title) not between 1 and 120 then
    raise exception 'Announcement title must be between 1 and 120 characters';
  end if;
  if enabled and char_length(safe_body) not between 1 and 1000 then
    raise exception 'Announcement message must be between 1 and 1000 characters';
  end if;
  insert into public.site_announcement(singleton, enabled, title, body, updated_by, updated_at)
  values (true, enabled, case when enabled then safe_title else '' end,
    case when enabled then safe_body else '' end, auth.uid(), now())
  on conflict (singleton) do update set enabled = excluded.enabled,
    title = excluded.title, body = excluded.body, updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
  returning * into result;
  insert into public.owner_audit_log(actor_id, action, details)
  values (auth.uid(), case when enabled then 'announcement_published' else 'announcement_removed' end,
    jsonb_build_object('title', case when enabled then safe_title else null end));
  return result;
end;
$$;
revoke all on function public.owner_set_site_announcement(boolean, text, text) from public, anon;
grant execute on function public.owner_set_site_announcement(boolean, text, text) to authenticated;

create or replace function public.admin_set_owner(target uuid, make_owner boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare current_owner boolean; active_owners bigint; target_name text;
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if target is null then raise exception 'Choose a channel'; end if;
  if target = auth.uid() and not make_owner then raise exception 'You cannot remove your own Owner access'; end if;
  select p.is_owner, p.channel_name into current_owner, target_name
  from public.profiles p where p.id = target for update;
  if target_name is null then raise exception 'Channel not found'; end if;
  if current_owner = make_owner then return current_owner; end if;
  if not make_owner then
    select count(*) into active_owners from public.profiles p
    where p.is_owner and not p.is_banned and not p.is_suspected;
    if active_owners <= 1 then raise exception 'The last active owner cannot be removed'; end if;
  end if;
  update public.profiles set is_owner = make_owner where id = target;
  insert into public.owner_audit_log(actor_id, action, details)
  values (auth.uid(), case when make_owner then 'owner_access_granted' else 'owner_access_removed' end,
    jsonb_build_object('channel', target_name, 'target_id', target));
  return make_owner;
end;
$$;
revoke all on function public.admin_set_owner(uuid, boolean) from public, anon;
grant execute on function public.admin_set_owner(uuid, boolean) to authenticated;

create or replace function public.admin_set_site_lockdown(locked boolean, lockdown_reason text default null)
returns public.site_lockdown
language plpgsql security definer set search_path = public as $$
declare result public.site_lockdown; safe_reason text := trim(coalesce(lockdown_reason, ''));
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if locked and char_length(safe_reason) not between 1 and 500 then
    raise exception 'Enter a lockdown reason (1–500 characters)';
  end if;
  insert into public.site_lockdown(singleton, enabled, reason, updated_by, updated_at)
  values (true, locked, case when locked then safe_reason else null end, auth.uid(), now())
  on conflict (singleton) do update set enabled = excluded.enabled, reason = excluded.reason,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into result;
  insert into public.owner_audit_log(actor_id, action, details)
  values (auth.uid(), case when locked then 'site_locked_down' else 'site_restored' end,
    jsonb_build_object('reason', case when locked then safe_reason else null end));
  return result;
end;
$$;
revoke all on function public.admin_set_site_lockdown(boolean, text) from public, anon;
grant execute on function public.admin_set_site_lockdown(boolean, text) to authenticated;

-- Channel banner images are public, while only the channel owner can upload them.
alter table public.profiles add column if not exists banner_path text;
grant select (banner_path) on public.profiles to anon, authenticated;
grant update (banner_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('wams-banners', 'wams-banners', true, 10485760)
on conflict (id) do update set public = true, file_size_limit = 10485760;
drop policy if exists "public reads channel banners" on storage.objects;
drop policy if exists "owners upload channel banners" on storage.objects;
drop policy if exists "owners delete channel banners" on storage.objects;
create policy "public reads channel banners" on storage.objects
  for select to anon, authenticated using (bucket_id = 'wams-banners');
create policy "owners upload channel banners" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'wams-banners'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  );
create policy "owners delete channel banners" on storage.objects
  for delete to authenticated using (
    bucket_id = 'wams-banners' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner-only operational controls and aggregate platform health metrics.
create or replace function public.owner_set_uploads_enabled(enabled boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  insert into public.platform_settings(setting, enabled)
  values ('uploads_enabled', enabled)
  on conflict (setting) do update set enabled = excluded.enabled;
  insert into public.owner_audit_log(actor_id, action, details)
  values (auth.uid(), case when enabled then 'uploads_resumed' else 'uploads_paused' end,
    jsonb_build_object('enabled', enabled));
  return enabled;
end;
$$;
revoke all on function public.owner_set_uploads_enabled(boolean) from public, anon;
grant execute on function public.owner_set_uploads_enabled(boolean) to authenticated;

create or replace function public.owner_platform_metrics()
returns table(
  channels_total bigint,
  active_accounts bigint,
  banned_accounts bigint,
  accounts_under_review bigint,
  active_owners bigint,
  videos_total bigint,
  views_total bigint,
  comments_total bigint,
  likes_total bigint,
  subscriptions_total bigint,
  pending_reports bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  return query select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles p where not p.is_banned and not p.is_suspected),
    (select count(*) from public.profiles p where p.is_banned),
    (select count(*) from public.profiles p where p.is_suspected and not p.is_banned),
    (select count(*) from public.profiles p where p.is_owner and not p.is_banned and not p.is_suspected),
    (select count(*) from public.videos),
    (select count(*) from public.video_views),
    (select count(*) from public.video_comments),
    (select count(*) from public.video_likes),
    (select count(*) from public.channel_follows),
    (select count(*) from public.video_reports r where r.status = 'pending');
end;
$$;
revoke all on function public.owner_platform_metrics() from public, anon;
grant execute on function public.owner_platform_metrics() to authenticated;

-- Owner-managed individual channel closures with a visitor-facing message.
alter table public.profiles add column if not exists channel_closed boolean not null default false;
alter table public.profiles add column if not exists channel_closed_message text;
grant select (channel_closed, channel_closed_message) on public.profiles to anon, authenticated;

create or replace function public.owner_set_channel_closure(
  target uuid,
  closed boolean,
  visitor_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_name text;
  safe_message text := trim(coalesce(visitor_message, ''));
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if target is null then raise exception 'Choose a channel'; end if;
  if closed and char_length(safe_message) not between 1 and 500 then
    raise exception 'Visitor message must be between 1 and 500 characters';
  end if;
  update public.profiles
  set channel_closed = closed,
      channel_closed_message = case when closed then safe_message else null end
  where id = target
  returning channel_name into target_name;
  if target_name is null then raise exception 'Channel not found'; end if;
  insert into public.owner_audit_log(actor_id, action, details)
  values (auth.uid(), case when closed then 'channel_closed' else 'channel_reopened' end,
    jsonb_build_object('channel', target_name, 'target_id', target,
      'message', case when closed then safe_message else null end));
  return closed;
end;
$$;
revoke all on function public.owner_set_channel_closure(uuid, boolean, text) from public, anon;
grant execute on function public.owner_set_channel_closure(uuid, boolean, text) to authenticated;

-- Owner-directed subscriptions are tracked so they do not create fake engagement rewards or alerts.
create table if not exists public.owner_managed_subscriptions (
  subscriber_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.profiles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subscriber_id, channel_id),
  check (subscriber_id <> channel_id)
);
alter table public.owner_managed_subscriptions enable row level security;

create or replace function public.owner_subscribe_account(target_account uuid, target_channel uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare did_insert boolean := false; account_name text; channel_name_value text;
begin
  if not public.is_wams_owner() then raise exception 'Owner access required'; end if;
  if target_account is null or target_channel is null or target_account = target_channel then
    raise exception 'Choose different account and channel profiles';
  end if;
  select p.channel_name into account_name from public.profiles p
  where p.id = target_account and not p.is_banned and not p.is_suspected;
  if account_name is null then raise exception 'The selected account is unavailable'; end if;
  select p.channel_name into channel_name_value from public.profiles p
  where p.id = target_channel and not p.is_banned and not p.is_suspected and not p.channel_closed;
  if channel_name_value is null then raise exception 'The selected channel is unavailable'; end if;
  if exists (select 1 from public.channel_follows f
      where f.follower_id = target_account and f.channel_id = target_channel) then
    return false;
  end if;
  insert into public.owner_managed_subscriptions(subscriber_id, channel_id, created_by)
  values (target_account, target_channel, auth.uid())
  on conflict (subscriber_id, channel_id) do update
    set created_by = excluded.created_by, created_at = now();
  insert into public.channel_follows(channel_id, follower_id)
  values (target_channel, target_account)
  on conflict (channel_id, follower_id) do nothing
  returning true into did_insert;
  if did_insert then
    insert into public.owner_audit_log(actor_id, action, details)
    values (auth.uid(), 'account_subscribed_by_owner',
      jsonb_build_object('account', account_name, 'account_id', target_account,
        'channel', channel_name_value, 'channel_id', target_channel));
  else
    delete from public.owner_managed_subscriptions
    where subscriber_id = target_account and channel_id = target_channel;
  end if;
  return coalesce(did_insert, false);
end;
$$;
revoke all on function public.owner_subscribe_account(uuid, uuid) from public, anon;
grant execute on function public.owner_subscribe_account(uuid, uuid) to authenticated;

create or replace function public.reward_follow_wams_bucks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.owner_managed_subscriptions m
      where m.subscriber_id = new.follower_id and m.channel_id = new.channel_id) then
    return new;
  end if;
  perform public.award_wams_bucks(new.channel_id, 5, 'New subscriber reward',
    'follow:' || new.channel_id::text || ':' || new.follower_id::text);
  return new;
end;
$$;

create or replace function public.notify_new_subscriber()
returns trigger language plpgsql security definer set search_path = public as $$
declare actor_name text;
begin
  if new.channel_id = new.follower_id or exists (
    select 1 from public.owner_managed_subscriptions m
    where m.subscriber_id = new.follower_id and m.channel_id = new.channel_id
  ) then return new; end if;
  select channel_name into actor_name from public.profiles where id = new.follower_id;
  insert into public.inbox_notifications(recipient_id, actor_id, type, title, body, target_url)
  values (new.channel_id, new.follower_id, 'new_subscriber', 'New subscriber',
    coalesce(actor_name, 'Someone') || ' subscribed to your channel.',
    'channel.html?channel=' || new.channel_id::text);
  return new;
end;
$$;

create or replace function public.clear_owner_managed_subscription()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.owner_managed_subscriptions
  where subscriber_id = old.follower_id and channel_id = old.channel_id;
  return old;
end;
$$;
drop trigger if exists clear_owner_managed_subscription on public.channel_follows;
create trigger clear_owner_managed_subscription after delete on public.channel_follows
  for each row execute procedure public.clear_owner_managed_subscription();

-- Closed channels keep their public profile visible for the notice, but videos/media are unavailable.
drop policy if exists "closed channels hide videos" on public.videos;
create policy "closed channels hide videos" on public.videos as restrictive for select to anon, authenticated
using (
  owner_id = auth.uid()
  or public.is_wams_owner()
  or not exists (select 1 from public.profiles p where p.id = owner_id and p.channel_closed)
);
drop policy if exists "closed channels hide stored media" on storage.objects;
create policy "closed channels hide stored media" on storage.objects as restrictive for select to anon, authenticated
using (
  bucket_id <> 'wams-media'
  or (storage.foldername(name))[1] = auth.uid()::text
  or public.is_wams_owner()
  or not exists (
    select 1 from public.videos v
    join public.profiles p on p.id = v.owner_id
    where (v.storage_path = name or v.caption_path = name) and p.channel_closed
  )
);

-- Animated profile art is available on every active WamsTube Plus plan.
create or replace function public.guard_animated_profile_art()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = old.id then
    if new.avatar_path is distinct from old.avatar_path and new.avatar_path is not null then
      if split_part(new.avatar_path, '/', 1) <> new.id::text then
        raise exception 'Profile pictures must belong to your account';
      end if;
      if right(lower(new.avatar_path), 4) = '.gif'
         and not public.has_wams_plus_feature('animated_profile_art', new.id) then
        raise exception 'Animated profile pictures require active WamsTube Plus';
      end if;
    end if;
    if new.banner_path is distinct from old.banner_path and new.banner_path is not null then
      if split_part(new.banner_path, '/', 1) <> new.id::text then
        raise exception 'Banners must belong to your account';
      end if;
      if right(lower(new.banner_path), 4) = '.gif'
         and not public.has_wams_plus_feature('animated_profile_art', new.id) then
        raise exception 'Animated banners require active WamsTube Plus';
      end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_animated_profile_art on public.profiles;
create trigger guard_animated_profile_art before update on public.profiles
for each row execute procedure public.guard_animated_profile_art();

-- Storage rules independently enforce Plus for GIF uploads; client checks are only UX.
drop policy if exists "owners upload channel avatars" on storage.objects;
create policy "owners upload channel avatars" on storage.objects for insert to authenticated
with check (
  bucket_id = 'wams-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and (right(lower(name), 4) <> '.gif' or metadata ->> 'mimetype' = 'image/gif')
  and (coalesce(metadata ->> 'mimetype', '') <> 'image/gif'
    or public.has_wams_plus_feature('animated_profile_art', auth.uid()))
);
drop policy if exists "owners upload channel banners" on storage.objects;
create policy "owners upload channel banners" on storage.objects for insert to authenticated
with check (
  bucket_id = 'wams-banners'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
  and (right(lower(name), 4) <> '.gif' or metadata ->> 'mimetype' = 'image/gif')
  and (coalesce(metadata ->> 'mimetype', '') <> 'image/gif'
    or public.has_wams_plus_feature('animated_profile_art', auth.uid()))
);

-- Video uploads: 100 MiB for standard accounts and 500 MiB for active Plus members.
-- The bucket maximum enforces the upper bound; RLS enforces each account's tier.
update storage.buckets
set file_size_limit = 524288000
where id = 'wams-media';

drop policy if exists "owners upload media" on storage.objects;
create policy "owners upload media" on storage.objects for insert to authenticated
with check (
  bucket_id = 'wams-media'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and not p.is_banned and not p.is_suspected
  )
  and exists (
    select 1 from public.platform_settings
    where setting = 'uploads_enabled' and enabled
  )
  and case
    when coalesce(metadata ->> 'size', '') ~ '^[0-9]+$' then
      (metadata ->> 'size')::bigint <= case
        when public.has_wams_plus_feature('playback', auth.uid()) then 524288000
        else 104857600
      end
    else false
  end
);

NOTIFY pgrst, 'reload schema';


