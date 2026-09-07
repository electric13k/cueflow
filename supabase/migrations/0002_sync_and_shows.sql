-- Sync timestamps, real tombstones, and the show state the client has always needed.
--
-- READ THIS BEFORE APPLYING. This runs against a live database with real shows in it. Take a backup
-- first. Everything here is additive and guarded with `if not exists`, so it is safe to run twice
-- and safe to run against a database whose exact shape is not in version control -- which is the
-- case today: `0001_cueflow.sql` describes three tables, and the app also uses `shows`,
-- `show_roles`, `show_members`, `projects`, `project_members`, `profiles` and `editor_sessions`,
-- none of which are checked in. Run `supabase db pull --schema public,storage` and commit the real
-- baseline; this file is written to sit on top of whatever that turns out to be.
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
declare t text;
begin
  foreach t in array array['tracks', 'sequences', 'sequence_items'] loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    -- A row that predates this column gets its creation time where there is one, so an old row does
    -- not read as having been edited this second and win every conflict on first contact.
    if t <> 'sequence_items' then
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
  if not exists (select 1 from pg_type where typname = 'show_member_status') then
    create type public.show_member_status as enum ('waiting', 'admitted', 'denied');
  end if;
end;
$$;

alter table public.show_members add column if not exists status public.show_member_status not null default 'admitted';
alter table public.show_members add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.show_members add column if not exists last_seen_at timestamptz not null default now();

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
-- have typed twenty times. Symmetric by construction: one row per pair, ordered, so the
-- relationship cannot exist in one direction only.
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

alter table public.friendships enable row level security;

drop policy if exists "see your own friendships" on public.friendships;
create policy "see your own friendships" on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester, addressee));

drop policy if exists "ask someone" on public.friendships;
create policy "ask someone" on public.friendships
  for insert to authenticated
  with check ((select auth.uid()) = requester);

-- Only the person who was asked can accept; either side can withdraw by deleting.
drop policy if exists "answer a request" on public.friendships;
create policy "answer a request" on public.friendships
  for update to authenticated
  using ((select auth.uid()) = addressee)
  with check ((select auth.uid()) = addressee);

drop policy if exists "walk away" on public.friendships;
create policy "walk away" on public.friendships
  for delete to authenticated
  using ((select auth.uid()) in (requester, addressee));

-- --------------------------------------------------------------------------------------------
-- 6. Realtime
--
-- Without this the client can subscribe to `postgres_changes` and never hear anything, which looks
-- exactly like a bug in the client. Each is added inside its own block so a table already in the
-- publication does not abort the migration.
-- --------------------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['tracks', 'sequences', 'sequence_items', 'shows', 'show_members', 'show_roles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
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

drop policy if exists "public prefix is writable" on storage.objects;
create policy "public prefix is writable" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = 'public');

drop policy if exists "audio is readable" on storage.objects;
create policy "audio is readable" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'audio');
