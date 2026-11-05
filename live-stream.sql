-- Live streaming schema and RPCs for WamsTube.
-- Run this file in the Supabase SQL Editor after supabase.sql.

create table if not exists public.live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 100),
  status text not null default 'live' check (status in ('live', 'ended')),
  created_at timestamptz not null default now(),
  last_heartbeat timestamptz not null default now()
);

create unique index if not exists live_streams_one_live_per_host
  on public.live_streams(host_id) where status = 'live';
create index if not exists live_streams_live_created_idx
  on public.live_streams(created_at desc) where status = 'live';

create table if not exists public.live_stream_viewers (
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (stream_id, viewer_id)
);

create table if not exists public.live_stream_signals (
  id bigint generated always as identity primary key,
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null check (signal_type in ('join', 'offer', 'answer', 'candidate', 'leave')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists live_stream_signals_recipient_idx
  on public.live_stream_signals(stream_id, to_user, id);

create table if not exists public.live_stream_comments (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists live_stream_comments_stream_created_idx
  on public.live_stream_comments(stream_id, created_at desc);

alter table public.live_streams enable row level security;
alter table public.live_stream_viewers enable row level security;
alter table public.live_stream_signals enable row level security;
alter table public.live_stream_comments enable row level security;

drop policy if exists "live streams are publicly readable" on public.live_streams;
create policy "live streams are publicly readable" on public.live_streams
  for select to anon, authenticated using (status = 'live');

drop policy if exists "live comments are readable by signed-in users" on public.live_stream_comments;
create policy "live comments are readable by signed-in users" on public.live_stream_comments
  for select to authenticated using (
    exists (select 1 from public.live_streams s where s.id = stream_id and s.status = 'live')
  );
drop policy if exists "active users can chat in live streams" on public.live_stream_comments;
create policy "active users can chat in live streams" on public.live_stream_comments
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned)
    and exists (select 1 from public.live_streams s where s.id = stream_id and s.status = 'live')
  );

grant select on public.live_streams to anon, authenticated;
grant select, insert on public.live_stream_comments to authenticated;
grant usage, select on sequence public.live_stream_signals_id_seq to authenticated;

create or replace function public.live_start_stream(stream_title text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  broadcaster uuid := auth.uid();
  created_stream uuid;
begin
  if broadcaster is null then raise exception 'Sign in before starting a live stream'; end if;
  if char_length(trim(coalesce(stream_title, ''))) not between 1 and 100 then
    raise exception 'Stream title must be between 1 and 100 characters';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = broadcaster and not p.is_banned
      and (
        (p.plus_plan = 'lifetime')
        or (p.plus_plan in ('day', 'week', 'month', 'year') and p.plus_expires_at > now())
        or (select count(*) from public.channel_follows f where f.channel_id = broadcaster) >= 20
      )
  ) then
    raise exception 'An active WamsTube Plus membership or at least 20 subscribers is required to stream';
  end if;

  insert into public.live_streams(host_id, title)
  values (broadcaster, trim(stream_title))
  returning id into created_stream;
  return created_stream;
end;
$$;

create or replace function public.live_heartbeat(target_stream uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.live_streams
  set last_heartbeat = now()
  where id = target_stream and host_id = auth.uid() and status = 'live';
  if not found then raise exception 'Live stream not found or no longer active'; end if;
end;
$$;

create or replace function public.live_end_stream(target_stream uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.live_streams
  set status = 'ended'
  where id = target_stream and host_id = auth.uid() and status = 'live';
  if not found then raise exception 'Live stream not found or already ended'; end if;
  delete from public.live_stream_viewers where stream_id = target_stream;
end;
$$;

create or replace function public.live_join_stream(target_stream uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  broadcaster uuid;
  current_viewers integer;
begin
  if viewer is null then raise exception 'Sign in to watch a live stream'; end if;
  select s.host_id into broadcaster
  from public.live_streams s
  where s.id = target_stream and s.status = 'live'
  for update;
  if not found then raise exception 'This live stream is no longer available'; end if;
  if viewer = broadcaster then raise exception 'You cannot join your own live stream as a viewer'; end if;
  if not exists (select 1 from public.profiles p where p.id = viewer and not p.is_banned) then
    raise exception 'This account cannot join live streams';
  end if;

  if not exists (
    select 1 from public.live_stream_viewers v
    where v.stream_id = target_stream and v.viewer_id = viewer
  ) then
    select count(*) into current_viewers
    from public.live_stream_viewers v where v.stream_id = target_stream;
    if current_viewers >= 10 then raise exception 'This live stream has reached its 10-viewer limit'; end if;
    insert into public.live_stream_viewers(stream_id, viewer_id) values (target_stream, viewer);
  end if;
  return broadcaster;
end;
$$;

create or replace function public.live_leave_stream(target_stream uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to leave a live stream'; end if;
  delete from public.live_stream_viewers
  where stream_id = target_stream and viewer_id = auth.uid();
end;
$$;

create or replace function public.live_send_signal(
  target_stream uuid,
  target_user uuid,
  signal_kind text,
  signal_data jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  sender uuid := auth.uid();
  broadcaster uuid;
begin
  if sender is null then raise exception 'Sign in to connect to a live stream'; end if;
  if signal_kind not in ('join', 'offer', 'answer', 'candidate', 'leave') then
    raise exception 'Invalid live connection signal';
  end if;
  select s.host_id into broadcaster
  from public.live_streams s where s.id = target_stream and s.status = 'live';
  if broadcaster is null then raise exception 'This live stream is no longer available'; end if;

  if sender = broadcaster then
    if not exists (
      select 1 from public.live_stream_viewers v
      where v.stream_id = target_stream and v.viewer_id = target_user
    ) then raise exception 'Viewer is not connected to this stream'; end if;
  else
    if target_user <> broadcaster or not exists (
      select 1 from public.live_stream_viewers v
      where v.stream_id = target_stream and v.viewer_id = sender
    ) then raise exception 'You are not connected to this live stream'; end if;
  end if;

  insert into public.live_stream_signals(stream_id, from_user, to_user, signal_type, payload)
  values (target_stream, sender, target_user, signal_kind, coalesce(signal_data, '{}'::jsonb));
end;
$$;

create or replace function public.live_get_signals(target_stream uuid, after_signal bigint)
returns table(id bigint, from_user uuid, signal_type text, payload jsonb)
language plpgsql security definer set search_path = public
as $$
declare
  viewer uuid := auth.uid();
  broadcaster uuid;
begin
  if viewer is null then raise exception 'Sign in to receive live connection data'; end if;
  select s.host_id into broadcaster
  from public.live_streams s where s.id = target_stream and s.status = 'live';
  if broadcaster is null then raise exception 'This live stream is no longer available'; end if;
  if viewer <> broadcaster and not exists (
    select 1 from public.live_stream_viewers v
    where v.stream_id = target_stream and v.viewer_id = viewer
  ) then raise exception 'You are not connected to this live stream'; end if;

  return query
  select sig.id, sig.from_user, sig.signal_type, sig.payload
  from public.live_stream_signals sig
  where sig.stream_id = target_stream and sig.to_user = viewer
    and sig.id > coalesce(after_signal, 0)
  order by sig.id asc
  limit 200;
end;
$$;

revoke all on function public.live_start_stream(text) from public, anon;
revoke all on function public.live_heartbeat(uuid) from public, anon;
revoke all on function public.live_end_stream(uuid) from public, anon;
revoke all on function public.live_join_stream(uuid) from public, anon;
revoke all on function public.live_leave_stream(uuid) from public, anon;
revoke all on function public.live_send_signal(uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.live_get_signals(uuid, bigint) from public, anon;
grant execute on function public.live_start_stream(text) to authenticated;
grant execute on function public.live_heartbeat(uuid) to authenticated;
grant execute on function public.live_end_stream(uuid) to authenticated;
grant execute on function public.live_join_stream(uuid) to authenticated;
grant execute on function public.live_leave_stream(uuid) to authenticated;
grant execute on function public.live_send_signal(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.live_get_signals(uuid, bigint) to authenticated;
