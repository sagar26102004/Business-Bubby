-- Localo catalog_entries — the app's GROWING collection (document model).
--
-- The code ships a curated head start (dishes in src/domain/dishes.ts, tags in
-- src/domain/tags.ts). This table is how that collection grows at RUNTIME:
--   * every listing quietly contributes the dishes/services/products/tags the
--     code doesn't know (CatalogRepository.capture, from businesses create/update),
--   * a super-admin adds business tags by hand from the admin screen.
--
-- `data jsonb` is the full CatalogEntry (src/domain/types.ts); `kind` + `key`
-- are scoping columns with a unique(kind, key) so there's exactly one row per
-- offering. Entries are LIVE the moment they're captured (data.approved = true);
-- the super-admin hides bad ones after the fact.

create table catalog_entries (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,               -- 'tag' | 'dish' | 'service' | 'product'
  key        text not null,               -- lowercase, whitespace-collapsed name
  data       jsonb not null,
  created_at timestamptz not null default now(),
  unique (kind, key)
);
create index catalog_entries_kind_idx on catalog_entries (kind);

alter table catalog_entries enable row level security;

-- Directory-style data: world-readable (the merge into suggestions is public,
-- and the super-admin needs to see hidden rows too).
create policy catalog_read on catalog_entries for select using (true);

-- Capture writes on behalf of the listing, and a super-admin adds tags: any
-- signed-in user may INSERT. UPDATE is likewise permissive because capturing
-- bumps an existing row's count (and the super-admin toggles `approved`); the
-- admin-only actions are enforced in the app. DELETE is super-admin only.
create policy catalog_insert on catalog_entries for insert
  with check (auth.uid() is not null);
create policy catalog_update on catalog_entries for update
  using (auth.uid() is not null) with check (auth.uid() is not null);
create policy catalog_delete on catalog_entries for delete
  using (public.is_super_admin());
