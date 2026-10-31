-- Owner-managed external games catalog.
-- Run this once in the Supabase SQL editor for the project used by this site.

create table if not exists public.arcade_games (
    id uuid primary key default gen_random_uuid(),
    title text not null check (char_length(trim(title)) between 1 and 80),
    website_url text not null check (website_url ~* '^https://[^[:space:]]+$'),
    embed_url text check (
        embed_url is null
        or (char_length(trim(embed_url)) > 0 and embed_url ~* '^https://[^[:space:]]+$')
    ),
    description text not null default '' check (char_length(description) <= 300),
    controls text not null default '' check (char_length(controls) <= 300),
    is_closed boolean not null default false,
    position integer not null default 0 check (position >= 0),
    created_at timestamptz not null default now()
);

-- Add the close control when upgrading an existing catalog table.
alter table public.arcade_games
    add column if not exists is_closed boolean not null default false;

create index if not exists arcade_games_display_order_idx
    on public.arcade_games (position, created_at);

alter table public.arcade_games enable row level security;

drop policy if exists "public can read arcade games" on public.arcade_games;
drop policy if exists "owners manage arcade games" on public.arcade_games;

create policy "public can read arcade games"
    on public.arcade_games for select to anon, authenticated
    using (true);

create policy "owners manage arcade games"
    on public.arcade_games for all to authenticated
    using (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.is_owner
              and not p.is_banned
              and not p.is_suspected
        )
    )
    with check (
        exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and p.is_owner
              and not p.is_banned
              and not p.is_suspected
        )
    );

grant select on public.arcade_games to anon, authenticated;
grant insert, update, delete on public.arcade_games to authenticated;

-- Plus-only community suggestions, reviewed by active Owners.
create table if not exists public.arcade_game_suggestions (
    id uuid primary key default gen_random_uuid(),
    submitter_id uuid not null references public.profiles(id) on delete cascade,
    title text not null check (char_length(trim(title)) between 1 and 80),
    website_url text not null check (website_url ~* '^https://[^[:space:]]+$'),
    embed_url text check (
        embed_url is null
        or (char_length(trim(embed_url)) > 0 and embed_url ~* '^https://[^[:space:]]+$')
    ),
    description text not null default '' check (char_length(description) <= 300),
    controls text not null default '' check (char_length(controls) <= 300),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    reviewed_by uuid references public.profiles(id) on delete set null,
    reviewed_at timestamptz,
    game_id uuid references public.arcade_games(id) on delete set null,
    created_at timestamptz not null default now()
);

alter table public.arcade_game_suggestions enable row level security;
drop policy if exists "Plus members submit game suggestions" on public.arcade_game_suggestions;
drop policy if exists "users read own game suggestions" on public.arcade_game_suggestions;
drop policy if exists "owners read game suggestions" on public.arcade_game_suggestions;
create policy "Plus members submit game suggestions"
    on public.arcade_game_suggestions for insert to authenticated
    with check (
        submitter_id = auth.uid()
        and public.has_wams_plus_feature('playback', auth.uid())
        and exists (select 1 from public.profiles p where p.id = auth.uid() and not p.is_banned and not p.is_suspected)
    );
create policy "users read own game suggestions"
    on public.arcade_game_suggestions for select to authenticated
    using (submitter_id = auth.uid());
create policy "owners read game suggestions"
    on public.arcade_game_suggestions for select to authenticated
    using (exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_owner and not p.is_banned and not p.is_suspected
    ));
grant select, insert on public.arcade_game_suggestions to authenticated;

create or replace function public.owner_review_game_suggestion(suggestion_id uuid, decision text)
returns public.arcade_game_suggestions
language plpgsql
security definer
set search_path = public
as $$
declare
    suggestion public.arcade_game_suggestions;
    published_game public.arcade_games;
begin
    if not exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.is_owner and not p.is_banned and not p.is_suspected
    ) then
        raise exception 'Active Owner access required';
    end if;
    if decision is null or decision not in ('approve', 'reject') then
        raise exception 'Choose approve or reject';
    end if;

    select * into suggestion
    from public.arcade_game_suggestions s
    where s.id = suggestion_id and s.status = 'pending'
    for update;
    if suggestion.id is null then
        raise exception 'Pending game suggestion not found';
    end if;

    if decision = 'approve' then
        insert into public.arcade_games (title, website_url, embed_url, description, controls, position)
        values (
            suggestion.title,
            suggestion.website_url,
            suggestion.embed_url,
            suggestion.description,
            suggestion.controls,
            coalesce((select max(g.position) + 1 from public.arcade_games g), 0)
        ) returning * into published_game;

        update public.arcade_game_suggestions
        set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), game_id = published_game.id
        where id = suggestion.id
        returning * into suggestion;
    else
        update public.arcade_game_suggestions
        set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
        where id = suggestion.id
        returning * into suggestion;
    end if;
    return suggestion;
end;
$$;
revoke all on function public.owner_review_game_suggestion(uuid, text) from public, anon;
grant execute on function public.owner_review_game_suggestion(uuid, text) to authenticated;
