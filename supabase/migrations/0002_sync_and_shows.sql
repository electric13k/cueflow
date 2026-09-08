-- Sync timestamps, real tombstones, and the show state the client has always needed.
--
-- READ THIS BEFORE APPLYING. This runs against a live database with real shows in it. Take a backup
-- first, and confirm it restores. Everything here is additive and guarded, so it is safe to run
-- twice, and safe to run against a database whose exact shape is not in version control -- which is
-- the case today: `0001_cueflow.sql` describes three tables, and the app also uses `shows`,
-- `show_roles`, `show_members`, `projects`, `project_members`, `profiles` and `editor_sessions`,
-- none of which are checked in. Run `supabase db pull --schema public,storage` and commit the real
-- baseline; this file is written to sit on top of whatever that turns out to be.
--
-- Apply during a window with no live show. `supabase db push` wraps the file in one transaction, so
-- every lock it takes is held until the last statement commits: on a large library the tables below
-- are unavailable for the duration. Check `select count(*) from shows where started_at is not null`
-- first. A performance running through this loses its cue list.
--
-- The client works either side of this migration. It probes for `tracks.updated_at` once per
-- session and falls back to comparing row content when it is absent.

-- --------------------------------------------------------------------------------------------
-- 1. Sync timestamps
--
-- Two devices editing one library could not tell whose copy of a row was newer, so the merge could
-- only ever add rows: a rename made on one device was discarded by the other, and then destroyed in
-- the cloud by that device's next save. The trigger sets the value, never the client, so a device
-- with a wrong clock cannot win an argument it should lose.
-- --------------------------------------------------------------------------------------------

create or replace function public.touch_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
  fresh boolean;
begin
  foreach t in array array['tracks', 'sequences', 'sequence_items'] loop
    fresh := not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at');

    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);

    -- Only on the run that creates the column. The backfill is an UPDATE, so on a second run it
    -- would fire the touch trigger installed below and stamp now() over every real edit time --
    -- turning the documented recovery action, running this file again, into silent data loss.
    if fresh and t <> 'sequence_items' then
      execute format('update public.%I set updated_at = created_at where updated_at > created_at', t);
    end if;

    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 2. Tombstones that other devices can see
--
-- Deleting is currently recorded in one device's localStorage, capped at 500 entries and never
-- uploaded. Every other device re-inserts the row on its next save, and because the storage object
-- is already gone the resurrected row points at nothing.
-- --------------------------------------------------------------------------------------------

alter table public.tracks add column if not exists deleted_at timestamptz;
alter table public.sequences add column if not exists deleted_at timestamptz;
alter table public.sequence_items add column if not exists deleted_at timestamptz;

create index if not exists tracks_live_idx on public.tracks (project_id) where deleted_at is null;
create index if not exists sequences_live_idx on public.sequences (project_id) where deleted_at is null;

-- --------------------------------------------------------------------------------------------
-- 3. Where the show actually is
--
-- The running show is a broadcast and nothing about it is written down, so a device that joins late
-- or reloads has to ask the host and hope. `cue_index` and `live_sequence_id` make the position a
-- fact the database holds, which is also what stops a crew "Go" on cue 4 firing whatever happens to
-- sit at position 4 in whichever sequence the operator has open.
-- --------------------------------------------------------------------------------------------

alter table public.shows add column if not exists cue_index integer not null default -1;
alter table public.shows add column if not exists live_sequence_id uuid;
alter table public.shows add column if not exists updated_at timestamptz not null default now();
-- Admission is off by default: a show that worked yesterday keeps working the same way today.
alter table public.shows add column if not exists admission boolean not null default false;

drop trigger if exists shows_touch on public.shows;
create trigger shows_touch before update on public.shows
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------------------------------
-- 4. The waiting room
--
-- `show_members` already exists and no client code reads it: there is no roster anywhere in the
-- app, and the host's only sign that somebody arrived is a toast that accumulates nothing.
-- --------------------------------------------------------------------------------------------

do $$
begin
  -- Namespace-qualified: an enum of this name in any other schema, including a concurrent session's
  -- pg_temp, would otherwise satisfy the guard and leave the `public` one uncreated.
  if not exists (
    select 1 from pg_type
    where typname = 'show_member_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.show_member_status as enum ('waiting', 'admitted', 'denied');
  end if;
end;
$$;

-- Nobody is let in by default once a show asks for a door. `join_show` decides which of the two
-- applies; see the note at the end of this file, because that function is not in version control.
alter table public.show_members add column if not exists status public.show_member_status not null default 'admitted';
alter table public.show_members add column if not exists last_seen_at timestamptz not null default now();
alter table public.show_members add column if not exists user_id uuid;

-- The foreign key is added separately and `not valid` so this does not hold a lock on `auth.users`
-- for the rest of the transaction. It would, and sign-in writes `auth.users`, so every login in the
-- building would block until the migration finished. Validate it afterwards, out of band:
--   alter table public.show_members validate constraint show_members_user_fk;
do $$
begin
  alter table public.show_members
    add constraint show_members_user_fk foreign key (user_id) references auth.users(id) on delete set null not valid;
exception
  when duplicate_object then null;
end;
$$;

create index if not exists show_members_show_idx on public.show_members (show_id);

/**
 * Admit or refuse one person. Owner only, enforced here rather than in the client, because a
 * client-side check is a suggestion.
 */
create or replace function public.admit_member(p_member uuid, p_admit boolean)
returns public.show_member_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_show uuid;
  v_owner uuid;
  v_status public.show_member_status;
begin
  select m.show_id into v_show from public.show_members m where m.id = p_member;
  if v_show is null then
    raise exception 'No such member';
  end if;

  select s.owner into v_owner from public.shows s where s.id = v_show;
  if v_owner is distinct from auth.uid() then
    raise exception 'Only whoever is running the show can admit people';
  end if;

  v_status := case when p_admit then 'admitted' else 'denied' end::public.show_member_status;
  update public.show_members set status = v_status where id = p_member;
  return v_status;
end;
$$;

revoke all on function public.admit_member(uuid, boolean) from public;
grant execute on function public.admit_member(uuid, boolean) to authenticated;

-- --------------------------------------------------------------------------------------------
-- 5. Friends
--
-- A list of people you work with, so adding a collaborator does not mean retyping a username you
-- have typed twenty times. `requester` is whoever asked, so the pair is directional as stored; the
-- index below is what stops the same two people holding a row in each direction.
-- --------------------------------------------------------------------------------------------

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  accepted boolean not null default false,
  created_at timestamptz not null default now(),
  check (requester <> addressee),
  unique (requester, addressee)
);

-- `unique (requester, addressee)` treats (A,B) and (B,A) as different rows, so without this both can
-- exist and each side sees a request it did not make.
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;

drop policy if exists "see your own friendships" on public.friendships;
create policy "see your own friendships" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- `accepted = false` belongs in the check, not just in the default: the column is client-supplied on
-- insert, so without it anyone could post a row naming themselves as an accepted friend of a
-- stranger, and it would show up in that stranger's list as mutual and settled.
drop policy if exists "ask someone" on public.friendships;
create policy "ask someone" on public.friendships
  for insert to authenticated
  with check ((select auth.uid()) = requester and accepted = false);

-- No update policy at all. RLS is row-level, so any policy permissive enough to let the addressee
-- set `accepted` would also let them rewrite `requester` and hand a stranger a friendship they never
-- asked for. Accepting goes through the function below, which can touch exactly one column.
drop policy if exists "answer a request" on public.friendships;

drop policy if exists "walk away" on public.friendships;
create policy "walk away" on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

/** Say yes. Only the person who was asked, and only ever to the `accepted` column. */
create or replace function public.accept_friendship(p_request uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_addressee uuid;
begin
  select f.addressee into v_addressee from public.friendships f where f.id = p_request;
  if v_addressee is null then
    raise exception 'No such request';
  end if;
  if v_addressee is distinct from auth.uid() then
    raise exception 'Only the person who was asked can accept';
  end if;

  update public.friendships set accepted = true where id = p_request;
  return true;
end;
$$;

revoke all on function public.accept_friendship(uuid) from public;
grant execute on function public.accept_friendship(uuid) to authenticated;

-- Supabase normally grants these by default. Stated explicitly because if the defaults are not set
-- on this project PostgREST answers 42501, and the client reads that as a hard error rather than as
-- a missing table, so the friends panel throws instead of quietly staying empty.
grant select, insert, delete on public.friendships to authenticated;

-- --------------------------------------------------------------------------------------------
-- 6. Realtime
--
-- Without this the client can subscribe to `postgres_changes` and never hear anything, which looks
-- exactly like a bug in the client. Each is added inside its own block so a table already in the
-- publication does not abort the migration.
--
-- `shows` and `show_roles` carry the join keys in plaintext: `shows.password` is the collaborator
-- key and `show_roles.code` is the per-role one. Publishing those tables whole would stream both to
-- every subscriber RLS lets read the row, so one crew member would be handed every other role's
-- code and could re-enter as the deputy. They go in with an explicit column list instead, built from
-- the live schema because the real shape of these tables is not in version control.
-- --------------------------------------------------------------------------------------------

do $$
declare
  t text;
  secret text[];
  cols text;
begin
  foreach t in array array['tracks', 'sequences', 'sequence_items', 'shows', 'show_members', 'show_roles'] loop
    secret := case t when 'shows' then array['password'] when 'show_roles' then array['code'] else array[]::text[] end;
    begin
      if cardinality(secret) = 0 then
        execute format('alter publication supabase_realtime add table public.%I', t);
      else
        select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
        from information_schema.columns
        where table_schema = 'public' and table_name = t and not (column_name = any (secret));

        if cols is null then
          raise notice 'skipping realtime for %: no such table', t;
        else
          execute format('alter publication supabase_realtime add table public.%I (%s)', t, cols);
        end if;
      end if;
    exception
      when duplicate_object then null;
      -- The publication itself is missing. Swallowing this quietly would leave realtime dead in
      -- exactly the way this section exists to prevent, so it is loud.
      when undefined_object then raise notice 'publication supabase_realtime does not exist; realtime not enabled for %', t;
      -- A missing table raises undefined_table (42P01), which is not undefined_object (42704), so
      -- without this a table named differently in the live schema aborts the whole migration.
      when undefined_table then raise notice 'skipping realtime for %: no such table', t;
      -- Column lists in publications need PostgreSQL 15, and the server rejects one that omits a
      -- replica-identity column, which is what a table set to REPLICA IDENTITY FULL will do. Either
      -- way, leave the table out rather than publishing the join keys to the room. Realtime not
      -- working is a visible bug someone will chase; a leaked join code is not.
      when others then
        raise notice 'skipping realtime for %: % (publishing the whole table would expose its join key)', t, sqlerrm;
    end;
  end loop;
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 7. Storage
--
-- `0001` gives the audio bucket a policy requiring the first path segment to equal the caller's
-- uid, and the client uploads to `public/<uuid>-<name>` for everyone including signed-out users.
-- The two have never agreed. This states the rule the app actually relies on: the bucket is
-- public-read, and the `public/` prefix is writable, which is what makes a show usable without an
-- account. Anything outside that prefix stays owner-only.
-- --------------------------------------------------------------------------------------------

-- Wrapped, because on some project vintages `storage.objects` is owned by `supabase_storage_admin`
-- and a policy change from a migration raises 42501. That should not abort everything above it; the
-- three policies can be entered by hand in the storage dashboard instead.
do $$
declare
  statements text[] := array[
    -- Read is scoped to the same prefix as the write. `using (bucket_id = ''audio'')` alone would
    -- grant SELECT on every object in the bucket to anonymous callers, and SELECT is what `list()`
    -- uses, so anything stored under a user''s own uid prefix goes from unguessable to enumerable.
    $p$create policy "audio is readable" on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'audio' and (storage.foldername(name))[1] = 'public')$p$,
    $p$create policy "public prefix is writable" on storage.objects
        for insert to anon, authenticated
        with check (bucket_id = 'audio' and (storage.foldername(name))[1] = 'public')$p$,
    -- Without a delete policy that matches the prefix the client actually uploads to, deleting a
    -- track removes the row and leaves the audio permanently fetchable at its public URL: `0001`
    -- requires the first path segment to equal the caller''s uid, which never matches `public/`, so
    -- `storage.remove` silently matched nothing and reported success.
    $p$create policy "delete your own audio" on storage.objects
        for delete to authenticated
        using (bucket_id = 'audio' and (storage.foldername(name))[1] = 'public' and owner = (select auth.uid()))$p$
  ];
  s text;
begin
  drop policy if exists "audio is readable" on storage.objects;
  drop policy if exists "public prefix is writable" on storage.objects;
  drop policy if exists "delete your own audio" on storage.objects;
  foreach s in array statements loop
    execute s;
  end loop;
exception
  when insufficient_privilege then
    raise notice 'could not set the audio storage policies from SQL; add them in the storage dashboard';
end;
$$;

-- The bucket is writable by anonymous callers, which is what makes a show usable without an account
-- and also means anyone can push arbitrary bytes into it. A size cap and a MIME allow-list are the
-- cheapest limit on that; `update` is left with no policy so an upload cannot overwrite one already
-- there. Adjust the ceiling to taste.
do $$
begin
  update storage.buckets
    set file_size_limit = 50 * 1024 * 1024,
        allowed_mime_types = array['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/flac']
    where id = 'audio';
exception
  -- On some project vintages `storage.buckets` is owned by `supabase_storage_admin` and this raises
  -- 42501. Not worth aborting the migration for: set the two limits in the dashboard instead.
  when insufficient_privilege then
    raise notice 'could not set the audio bucket limits from SQL; set file_size_limit and allowed_mime_types in the storage dashboard';
end;
$$;

-- --------------------------------------------------------------------------------------------
-- 8. Still to do, and not doable from here
--
-- `join_show`, `show_state`, `add_collaborator` and `touch_last_seen` are not in version control, so
-- this file cannot patch them. Two things above are inert until they are:
--
--   * `show_members.status` defaults to 'admitted'. For the waiting room to gate anything,
--     `join_show` has to insert 'waiting' when `shows.admission` is set, and `show_state` has to
--     return no permissions for a member who is not 'admitted'.
--   * `admit_member` is owner-only and correct, but it is theatre if some other policy already lets
--     a member update their own row. Check: `select * from pg_policies where tablename =
--     'show_members'`. If an UPDATE policy there permits it, a member can PATCH themselves to
--     'admitted' and skip the door entirely.
-- --------------------------------------------------------------------------------------------
