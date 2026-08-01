create table public.tracks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text not null, storage_path text, source_url text, effects jsonb not null default '{"speed":1,"volume":0.9,"gain":1,"reverb":0,"fadeIn":0,"fadeOut":0,"distortion":0,"reverse":false}', created_at timestamptz not null default now(),
  check (storage_path is not null or source_url is not null)
);
create table public.sequences (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, name text not null, created_at timestamptz not null default now());
create table public.sequence_items (id uuid primary key default gen_random_uuid(), sequence_id uuid not null references public.sequences(id) on delete cascade, track_id uuid not null references public.tracks(id) on delete cascade, position integer not null, label text not null, effects jsonb not null, unique(sequence_id, position));
alter table public.tracks enable row level security; alter table public.sequences enable row level security; alter table public.sequence_items enable row level security;
create policy "users own tracks" on public.tracks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users own sequences" on public.sequences for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users own sequence items" on public.sequence_items for all to authenticated using (exists (select 1 from public.sequences s where s.id = sequence_id and s.user_id = (select auth.uid()))) with check (exists (select 1 from public.sequences s where s.id = sequence_id and s.user_id = (select auth.uid())));
insert into storage.buckets (id, name, public) values ('audio', 'audio', true) on conflict (id) do nothing;
create policy "users manage own audio" on storage.objects for all to authenticated using (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid()::text)) with check (bucket_id = 'audio' and (storage.foldername(name))[1] = (select auth.uid()::text));
