-- Run after supabase.sql in the Supabase SQL editor.
-- Adds claimable milestone rewards, custom admin badges, and channel transfers.

alter table public.profiles add column if not exists is_suspected boolean not null default false;

alter table public.badge_types add column if not exists badge_style text not null default 'solid';
alter table public.badge_types add column if not exists badge_color text;
alter table public.badge_types add column if not exists badge_color_secondary text;
alter table public.badge_types add column if not exists badge_color_tertiary text;
alter table public.badge_types drop constraint if exists badge_types_style_check;
alter table public.badge_types add constraint badge_types_style_check
  check (badge_style in ('solid', 'gradient', 'rainbow'));
alter table public.badge_types drop constraint if exists badge_types_color_check;
alter table public.badge_types add constraint badge_types_color_check check (
  (badge_color is null or badge_color ~ '^#[0-9A-Fa-f]{6}$') and
  (badge_color_secondary is null or badge_color_secondary ~ '^#[0-9A-Fa-f]{6}$') and
  (badge_color_tertiary is null or badge_color_tertiary ~ '^#[0-9A-Fa-f]{6}$')
);

insert into public.badge_types (badge_type, label, description) values
  ('achievement_welcome', 'WamsTube Welcome', 'Created a WamsTube channel.'),
  ('achievement_subscriber_1', 'First Subscription', 'Subscribed to a first channel.'),
  ('achievement_subscriber_5', 'Community Explorer', 'Subscribed to five channels.'),
  ('achievement_first_upload', 'First Upload', 'Published a first video.'),
  ('achievement_uploads_5', 'Creator in the Making', 'Published five videos.'),
  ('achievement_first_comment', 'Conversation Starter', 'Posted a first comment.'),
  ('achievement_comments_10', 'Community Voice', 'Posted ten comments.'),
  ('achievement_first_like', 'Show Some Love', 'Liked a first video.'),
  ('achievement_likes_10', 'Video Fan', 'Liked ten videos.'),
  ('achievement_plus_member', 'Plus Member', 'Purchased WamsTube Plus.'),
  ('achievement_verified_channel', 'Verified Creator', 'Reached a channel verification milestone.'),
  ('achievement_first_follower', 'First Subscriber', 'Earned a first channel subscriber.')
on conflict (badge_type) do nothing;

create or replace function public.guard_custom_badge_catalog()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- SQL-editor migrations run without an end-user auth.uid(); app requests do not.
  if auth.uid() is not null and not public.is_wams_admin() then
    raise exception 'Administrator access required';
  end if;
  if new.badge_type !~ '^[a-z][a-z0-9_]{1,39}$' then raise exception 'Badge key must use 2–40 lowercase letters, numbers, or underscores'; end if;
  if tg_op = 'INSERT' and (new.badge_type like 'achievement_%' or new.badge_type in ('verified', 'admin', 'owner', 'co_owner', 'partner', 'developer', 'moderator', 'creator', 'early_supporter', 'founding_member', 'premium'))
     and not exists (select 1 from public.badge_types existing where existing.badge_type = new.badge_type) then
    raise exception 'That badge key is reserved';
  end if;
  if char_length(trim(new.label)) not between 1 and 32 then raise exception 'Badge name must be 1–32 characters'; end if;
  if char_length(coalesce(new.description, '')) > 160 then raise exception 'Badge description is too long'; end if;
  return new;
end;
$$;
drop trigger if exists guard_custom_badge_catalog on public.badge_types;
create trigger guard_custom_badge_catalog before insert or update on public.badge_types
for each row execute procedure public.guard_custom_badge_catalog();

drop policy if exists "admins manage custom badge catalog" on public.badge_types;
create policy "admins manage custom badge catalog" on public.badge_types
  for all to authenticated using (public.is_wams_admin()) with check (public.is_wams_admin());
grant insert, update, delete on public.badge_types to authenticated;

create table if not exists public.wams_achievement_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_key text not null check (achievement_key in (
    'welcome', 'subscriber_1', 'subscriber_5', 'first_upload', 'uploads_5',
    'first_comment', 'comments_10', 'first_like', 'likes_10', 'plus_member',
    'verified_channel', 'first_follower'
  )),
  claimed_at timestamptz not null default now(),
  primary key (user_id, achievement_key)
);
alter table public.wams_achievement_claims enable row level security;
drop policy if exists "users read own achievement claims" on public.wams_achievement_claims;
create policy "users read own achievement claims" on public.wams_achievement_claims
  for select to authenticated using (user_id = auth.uid() or public.is_wams_admin());
grant select on public.wams_achievement_claims to authenticated;

create or replace function public.claim_wams_achievement(requested_achievement text)
returns table(balance integer, claimed boolean)
language plpgsql security definer set search_path = public as $$
declare
  claimant uuid := auth.uid();
  reward integer;
  eligible boolean := false;
  current_balance integer;
  inserted_user uuid;
  subscriber_count integer;
  total_count integer;
begin
  if claimant is null then raise exception 'Sign in to claim achievements'; end if;
  if not exists (select 1 from public.profiles p where p.id = claimant and not p.is_banned and not p.is_suspected) then
    raise exception 'This account cannot claim achievements';
  end if;
  select count(*) into subscriber_count from public.channel_follows f where f.channel_id = claimant;
  case requested_achievement
    when 'welcome' then reward := 10; eligible := true;
    when 'subscriber_1' then reward := 10; select count(*) into total_count from public.channel_follows f where f.follower_id = claimant; eligible := total_count >= 1;
    when 'subscriber_5' then reward := 20; select count(*) into total_count from public.channel_follows f where f.follower_id = claimant; eligible := total_count >= 5;
    when 'first_upload' then reward := 20; select count(*) into total_count from public.videos v where v.owner_id = claimant and not v.is_deleted; eligible := total_count >= 1;
    when 'uploads_5' then reward := 35; select count(*) into total_count from public.videos v where v.owner_id = claimant and not v.is_deleted; eligible := total_count >= 5;
    when 'first_comment' then reward := 10; select count(*) into total_count from public.video_comments c where c.user_id = claimant; eligible := total_count >= 1;
    when 'comments_10' then reward := 25; select count(*) into total_count from public.video_comments c where c.user_id = claimant; eligible := total_count >= 10;
    when 'first_like' then reward := 10; select count(*) into total_count from public.video_likes l where l.user_id = claimant; eligible := total_count >= 1;
    when 'likes_10' then reward := 25; select count(*) into total_count from public.video_likes l where l.user_id = claimant; eligible := total_count >= 10;
    when 'plus_member' then reward := 50; eligible := exists (select 1 from public.profiles p where p.id = claimant and (p.plus_plan = 'lifetime' or p.plus_expires_at > now()));
    when 'verified_channel' then reward := 75; eligible := exists (select 1 from public.profiles p where p.id = claimant and p.admin_verified) or subscriber_count > 100;
    when 'first_follower' then reward := 20; eligible := subscriber_count >= 1;
    else raise exception 'Unknown achievement';
  end case;
  if not eligible then raise exception 'Achievement requirements have not been met yet'; end if;

  insert into public.wams_wallets(user_id) values (claimant) on conflict (user_id) do nothing;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = claimant for update;
  insert into public.wams_achievement_claims(user_id, achievement_key)
  values (claimant, requested_achievement) on conflict do nothing returning user_id into inserted_user;
  if inserted_user is null then return query select current_balance, false; return; end if;

  perform public.award_wams_bucks(claimant, reward, 'WamsTube achievement: ' || requested_achievement, 'achievement:' || requested_achievement);
  insert into public.profile_badges(profile_id, badge_type, granted_by)
  values (claimant, 'achievement_' || requested_achievement, claimant) on conflict do nothing;
  select w.balance into current_balance from public.wams_wallets w where w.user_id = claimant;
  return query select current_balance, true;
end;
$$;
revoke all on function public.claim_wams_achievement(text) from public, anon;
grant execute on function public.claim_wams_achievement(text) to authenticated;

-- Permit an ownership-only video move during the protected transfer RPC, without bypassing Studio checks for edits.
create or replace function public.guard_plus_studio_video()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id
     and auth.uid() = old.owner_id
     and (to_jsonb(new) - 'owner_id') = (to_jsonb(old) - 'owner_id') then
    return new;
  end if;
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
  if new.visibility = 'subscribers' and not public.is_wams_admin()
     and not public.has_wams_plus_feature('subscriber_videos', new.owner_id) then
    raise exception 'Subscriber-only videos require a Month or higher WamsTube Plus plan';
  end if;
  if (new.caption_path is not null or new.trim_start_seconds > 0 or new.trim_end_seconds is not null)
     and not public.is_wams_admin() and not public.has_wams_plus_feature('captions_trim', new.owner_id) then
    raise exception 'Captions and trimming require a Week or higher WamsTube Plus plan';
  end if;
  if new.caption_path is not null and coalesce((storage.foldername(new.caption_path))[1], '') <> new.owner_id::text then
    raise exception 'Caption files must belong to the video owner';
  end if;
  return new;
end;
$$;

create or replace function public.transfer_wams_channel(target_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  source_id uuid := auth.uid();
  destination_id uuid;
  channel_name_to_move text;
  avatar_to_move text;
  verified_to_move boolean;
begin
  if source_id is null then raise exception 'Sign in to transfer your channel'; end if;
  if lower(trim(coalesce(target_email, ''))) !~ '^[^[:space:]@]+@mtps\.us$' then raise exception 'Enter a valid @mtps.us account email'; end if;
  select p.id into destination_id from public.profiles p
    where lower(p.email) = lower(trim(target_email)) for update;
  if destination_id is null then raise exception 'Recipient account was not found or is restricted'; end if;
  if destination_id = source_id then raise exception 'Choose a different account'; end if;
  if not exists (select 1 from public.profiles p where p.id = source_id and not p.is_banned and not p.is_suspected) then
    raise exception 'This account cannot transfer its channel';
  end if;
  if exists (select 1 from public.profiles p where p.id = destination_id and (p.is_banned or p.is_suspected)) then
    raise exception 'The recipient account is restricted';
  end if;

  select p.channel_name, p.avatar_path, p.admin_verified into channel_name_to_move, avatar_to_move, verified_to_move
    from public.profiles p where p.id = source_id for update;
  update public.profiles p set channel_name = channel_name_to_move,
    avatar_path = avatar_to_move, admin_verified = verified_to_move, monetization_enabled = false
    where p.id = destination_id;

  delete from public.channel_follows old_follow
    where old_follow.channel_id = source_id
      and (old_follow.follower_id = destination_id or exists (
        select 1 from public.channel_follows existing
        where existing.channel_id = destination_id and existing.follower_id = old_follow.follower_id
      ));
  update public.channel_follows set channel_id = destination_id where channel_id = source_id;
  update public.videos set owner_id = destination_id where owner_id = source_id;
  update public.video_donations set recipient_id = destination_id where recipient_id = source_id;

  insert into public.profile_badges(profile_id, badge_type, granted_by)
    select destination_id, badge_type, granted_by from public.profile_badges
    where profile_id = source_id and badge_type not in ('premium', 'admin', 'owner', 'co_owner', 'developer', 'moderator')
    on conflict (profile_id, badge_type) do nothing;
  delete from public.profile_badges where profile_id = source_id and badge_type not in ('premium', 'admin', 'owner', 'co_owner', 'developer', 'moderator');
  update public.profiles set channel_name = 'New channel', avatar_path = null,
    admin_verified = false, monetization_enabled = false where id = source_id;
  return 'Channel identity, videos, subscribers, and badges transferred successfully';
end;
$$;
revoke all on function public.transfer_wams_channel(text) from public, anon;
grant execute on function public.transfer_wams_channel(text) to authenticated;

-- Existing media objects keep their original storage path after a channel handoff.
drop policy if exists "transferred channel owners read media" on storage.objects;
create policy "transferred channel owners read media" on storage.objects for select to authenticated
using (bucket_id = 'wams-media' and exists (
  select 1 from public.videos v
  where (v.storage_path = name or v.caption_path = name)
    and v.owner_id = auth.uid()
));
drop policy if exists "transferred channel owners delete media" on storage.objects;
create policy "transferred channel owners delete media" on storage.objects for delete to authenticated
using (bucket_id = 'wams-media' and exists (
  select 1 from public.videos v
  where (v.storage_path = name or v.caption_path = name)
    and v.owner_id = auth.uid()
));
