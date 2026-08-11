-- Localo media storage — the one bucket every uploaded photo and video lands in.
--
-- WHY THIS EXISTS
-- Until now `PhotosField` handed back the picker's LOCAL uri (file:// on a
-- phone, blob: on web) and that string was stored on the domain object. It
-- renders for the session and dies with it: another device sees nothing, and a
-- reload sees nothing. That was survivable for a stall photo. It is not
-- survivable for an ad reel — a business that films a video ad, pays to promote
-- it, and finds it blank on every phone but its own has been sold nothing.
--
-- So: one public bucket, `media`, holding every upload the app makes (offer
-- photos, offer videos/reels, stall product photos, business display pictures).
--
-- WHY PUBLIC READ
-- Everything in here is advertising. An ad card is shown to strangers, guests
-- included, on the Home screen and the /deals feed — so the read has to work
-- without a session, exactly like `businesses` and `reviews` do. Nothing
-- private is ever uploaded through this path; anything that later needs privacy
-- gets its own bucket rather than a policy exception on this one.
--
-- WHY THE UID FOLDER
-- Writes are pinned to `media/<auth.uid()>/…`. The uploader may only create
-- files under their own id, so one user can never overwrite another's ad
-- creative by guessing a path. `src/lib/upload.ts` builds exactly that path.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. The bucket
-- ---------------------------------------------------------------------------
-- 50 MB ceiling: enough for a short vertical ad filmed on a phone at the
-- quality expo-image-picker gives us, small enough that a bad upload fails fast
-- on a 4G connection instead of hanging for minutes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  true,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Policies
-- ---------------------------------------------------------------------------

-- READ. Public, and deliberately not `to authenticated` — guests browse Home
-- and the deals feed, and an ad they cannot see is an ad nobody bought.
drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects for select
  using (bucket_id = 'media');

-- INSERT. Signed in, and only into your own folder. `foldername(name)[1]` is
-- the first path segment, which upload.ts sets to the uploader's user id.
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE / DELETE. Your own files only. Replacing a photo goes through a fresh
-- path rather than an overwrite (upload.ts never reuses a name), so this is
-- really just tidy-up power over what you put there.
drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);

-- AFTER RUNNING: nothing else is needed — the bucket is served from
-- <project>/storage/v1/object/public/media/<path>, which is what
-- `getPublicUrl` returns and what gets stored on the domain object.
