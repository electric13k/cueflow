-- The bucket accepts what the app actually uploads.
--
-- `0002` set `allowed_mime_types` on the `audio` bucket to eight audio types, which was right for
-- the bucket's name and wrong for its contents. The client has never uploaded only audio: the one
-- file picker in the Studio takes audio, images, video and PowerPoint (`UPLOAD_ACCEPT` in
-- `src/pages/Studio.tsx`), slide renders go up as PNG, and every one of those goes to this bucket
-- because there is no other. So on any project where the `0002` block actually ran, importing a
-- slide or a video failed at the storage API and surfaced to the operator as "upload failed" with
-- no reason attached. Where the block hit `insufficient_privilege` and only raised a notice, the
-- same import worked -- which is the worse case, because the behaviour then depends on how the
-- project was provisioned rather than on anything in this repository.
--
-- Two other things changed on the client side that this file exists to keep in step with:
--
--   * **Objects are named by the SHA-256 of their own bytes** (`src/lib/compress.ts`). The same
--     file imported by two people is now one object. That makes the missing `update` policy from
--     `0002` a feature rather than a gap: a second upload of identical content is refused with a
--     409, the client reads that as a hit, and nothing existing can be overwritten by anyone.
--
--   * **Edited audio is written as FLAC, not WAV** (`src/lib/flac.ts`). `audio/flac` was already on
--     the `0002` list. `audio/x-flac` was not, and some browsers report that instead.
--
-- Anonymous writes remain possible, because a show has to be usable without an account. The size
-- cap is the limit on that and it is unchanged at 50 MB; repacking WAV as FLAC means an edit that
-- used to come back at forty megabytes now arrives at fifteen, so the cap bites less often than it
-- did rather than more.

do $$
begin
  update storage.buckets
    set file_size_limit = 50 * 1024 * 1024,
        allowed_mime_types = array[
          -- Audio, including both spellings browsers use for WAV and FLAC.
          'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus',
          'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/webm',
          'audio/flac', 'audio/x-flac', 'audio/aiff', 'audio/x-aiff',
          -- Images: imports, crops, and the PNG a slide is rendered to.
          'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml',
          -- Video cues, and what the in-browser trim writes back.
          'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
          -- Slide decks, which ride as an embed rather than being rendered server-side.
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'application/vnd.ms-powerpoint',
          'application/pdf',
          -- The honest fallback for a file the browser would not name. Preferred over letting the
          -- client guess `audio/mpeg`, which is what it used to send for a .pptx.
          'application/octet-stream'
        ]
    where id = 'audio';
exception
  -- Same reason as `0002`: on some project vintages `storage.buckets` is owned by
  -- `supabase_storage_admin` and this raises 42501.
  when insufficient_privilege then
    raise notice 'could not widen the audio bucket MIME list from SQL; set allowed_mime_types in the storage dashboard';
end;
$$;

-- Two objects can no longer hold the same bytes under different names, but rows still can: two
-- people importing the same sound get one object and two `tracks` rows pointing at it. That is
-- correct -- they are two people's libraries -- and it is why deleting a track must not delete the
-- object while another row still references it. Nothing does that today; the retention sweep in
-- `supabase/functions/retention/index.ts` already refuses to delete anything it cannot first prove
-- unclaimed, and this index is what lets a future delete path ask the same question cheaply.
create index if not exists tracks_storage_path_idx on public.tracks (storage_path);
