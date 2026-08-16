-- Localo schema — document model.
--
-- Each entity is stored as a JSONB `data` column holding the full domain object
-- (the same shape as src/domain/types.ts), plus a handful of real columns that
-- exist only so the database can do its two jobs:
--   1. Row-Level Security  — scope rows to an owner / customer / business.
--   2. Ordering & FKs       — created_at, and foreign keys for cascade delete.
--
-- Why documents, not wide relational tables: the domain is rich (~40 fields on
-- Business) and deliberately fast-changing, and the app already filters and
-- aggregates client-side. Documents mean the repositories map with `row.data`
-- (no column drift, no per-field migrations) while RLS still enforces access
-- through the scoping columns. Normalise a table later if it needs SQL-side
-- querying — the repository interface hides the change either way.
--
-- Policies live in 0002_policies.sql; nothing is readable until they're applied.
--
-- Idempotent: safe to run more than once. Every table and index is guarded with
-- IF NOT EXISTS and every trigger is dropped before it is recreated, so replaying
-- the folder in order against a half-built project converges instead of erroring.
-- ⚠️ The guard only checks EXISTENCE, not shape: a table that already exists with
-- the wrong columns is left exactly as it is. Re-running verifies a fresh project;
-- it does not repair a drifted one.

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user (data = domain User)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Copy sign-up metadata into a profile row automatically.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, data)
  values (new.id, jsonb_build_object(
    'id', new.id,
    'name', coalesce(new.raw_user_meta_data ->> 'name', ''),
    'phone', new.raw_user_meta_data ->> 'phone',
    'email', new.email,
    'isProfilePublic', true
  ))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- businesses (data = domain Business)
-- ---------------------------------------------------------------------------
create table if not exists businesses (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles (id) on delete cascade,
  type       text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists businesses_owner_idx on businesses (owner_id);
create index if not exists businesses_type_idx on businesses (type);
drop trigger if exists businesses_updated on businesses;
create trigger businesses_updated before update on businesses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- employees (data = domain Employee)
-- ---------------------------------------------------------------------------
create table if not exists employees (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id     uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists employees_business_idx on employees (business_id);
create index if not exists employees_user_idx on employees (user_id);

-- membership check used throughout RLS. SECURITY DEFINER so it bypasses the
-- row policies of businesses/employees (and never recurses through them).
-- Defined after `employees` so the SQL body validates.
create or replace function is_business_member(bid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select uid is not null and (
       exists (select 1 from businesses b where b.id = bid and b.owner_id = uid)
    or exists (select 1 from employees e where e.business_id = bid and e.user_id = uid)
  );
$$;

-- ---------------------------------------------------------------------------
-- saved_places (data = domain SavedPlace)
-- ---------------------------------------------------------------------------
create table if not exists saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists saved_places_user_idx on saved_places (user_id);

-- ---------------------------------------------------------------------------
-- Transactional & messaging tables. Each carries the scoping columns its RLS
-- needs and the domain object in `data`.
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists bookings_business_idx on bookings (business_id);
create index if not exists bookings_customer_idx on bookings (customer_id);

create table if not exists orders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists orders_business_idx on orders (business_id);
create index if not exists orders_customer_idx on orders (customer_id);

create table if not exists bills (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists bills_business_idx on bills (business_id);
create index if not exists bills_customer_idx on bills (customer_id);

-- B2C chat: participant_id is a user id or the literal 'guest'.
create table if not exists chat_messages (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses (id) on delete cascade,
  participant_id text not null,
  data           jsonb not null,
  created_at     timestamptz not null default now()
);
create index if not exists chat_thread_idx on chat_messages (business_id, participant_id);

-- B2B chat: one thread per pair of businesses.
create table if not exists biz_chat_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_key       text not null,
  from_business_id uuid not null references businesses (id) on delete cascade,
  to_business_id   uuid not null references businesses (id) on delete cascade,
  data             jsonb not null,
  created_at       timestamptz not null default now()
);
create index if not exists biz_chat_thread_idx on biz_chat_messages (thread_key);

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles (id) on delete cascade,
  data         jsonb not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists notifications_recipient_idx on notifications (recipient_id, created_at desc);

-- Calls embed their participants inside `data` (updated in place).
create table if not exists calls (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists calls_business_idx on calls (business_id);
drop trigger if exists calls_updated on calls;
create trigger calls_updated before update on calls
  for each row execute function set_updated_at();

create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (business_id, customer_id)
);
create index if not exists reviews_business_idx on reviews (business_id);

-- Public product thread. product_id is the app-assigned id inside the stall.
create table if not exists product_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  product_id  text not null,
  author_id   uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists product_messages_product_idx on product_messages (business_id, product_id);

create table if not exists vehicles (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists vehicles_business_idx on vehicles (business_id);

create table if not exists tracked_items (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  vehicle_id  uuid references vehicles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists tracked_items_business_idx on tracked_items (business_id);
create index if not exists tracked_items_customer_idx on tracked_items (customer_id);

create table if not exists location_shares (
  business_id uuid not null references businesses (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table if not exists memberships (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists memberships_business_idx on memberships (business_id);
create index if not exists memberships_customer_idx on memberships (customer_id);

create table if not exists membership_payments (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships (id) on delete cascade,
  data          jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists membership_payments_membership_idx on membership_payments (membership_id);

create table if not exists log_entries (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists log_entries_business_idx on log_entries (business_id);
