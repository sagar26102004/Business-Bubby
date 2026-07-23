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

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user (data = domain User)
-- ---------------------------------------------------------------------------
create table profiles (
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- businesses (data = domain Business)
-- ---------------------------------------------------------------------------
create table businesses (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles (id) on delete cascade,
  type       text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index businesses_owner_idx on businesses (owner_id);
create index businesses_type_idx on businesses (type);
create trigger businesses_updated before update on businesses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- employees (data = domain Employee)
-- ---------------------------------------------------------------------------
create table employees (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id     uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index employees_business_idx on employees (business_id);
create index employees_user_idx on employees (user_id);

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
create table saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index saved_places_user_idx on saved_places (user_id);

-- ---------------------------------------------------------------------------
-- Transactional & messaging tables. Each carries the scoping columns its RLS
-- needs and the domain object in `data`.
-- ---------------------------------------------------------------------------
create table bookings (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index bookings_business_idx on bookings (business_id);
create index bookings_customer_idx on bookings (customer_id);

create table orders (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index orders_business_idx on orders (business_id);
create index orders_customer_idx on orders (customer_id);

create table bills (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index bills_business_idx on bills (business_id);
create index bills_customer_idx on bills (customer_id);

-- B2C chat: participant_id is a user id or the literal 'guest'.
create table chat_messages (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references businesses (id) on delete cascade,
  participant_id text not null,
  data           jsonb not null,
  created_at     timestamptz not null default now()
);
create index chat_thread_idx on chat_messages (business_id, participant_id);

-- B2B chat: one thread per pair of businesses.
create table biz_chat_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_key       text not null,
  from_business_id uuid not null references businesses (id) on delete cascade,
  to_business_id   uuid not null references businesses (id) on delete cascade,
  data             jsonb not null,
  created_at       timestamptz not null default now()
);
create index biz_chat_thread_idx on biz_chat_messages (thread_key);

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles (id) on delete cascade,
  data         jsonb not null,
  read         boolean not null default false,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on notifications (recipient_id, created_at desc);

-- Calls embed their participants inside `data` (updated in place).
create table calls (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index calls_business_idx on calls (business_id);
create trigger calls_updated before update on calls
  for each row execute function set_updated_at();

create table reviews (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (business_id, customer_id)
);
create index reviews_business_idx on reviews (business_id);

-- Public product thread. product_id is the app-assigned id inside the stall.
create table product_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  product_id  text not null,
  author_id   uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index product_messages_product_idx on product_messages (business_id, product_id);

create table vehicles (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index vehicles_business_idx on vehicles (business_id);

create table tracked_items (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  vehicle_id  uuid references vehicles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index tracked_items_business_idx on tracked_items (business_id);
create index tracked_items_customer_idx on tracked_items (customer_id);

create table location_shares (
  business_id uuid not null references businesses (id) on delete cascade,
  user_id     uuid not null references profiles (id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

create table memberships (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references profiles (id) on delete set null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index memberships_business_idx on memberships (business_id);
create index memberships_customer_idx on memberships (customer_id);

create table membership_payments (
  id            uuid primary key default gen_random_uuid(),
  membership_id uuid not null references memberships (id) on delete cascade,
  data          jsonb not null,
  created_at    timestamptz not null default now()
);
create index membership_payments_membership_idx on membership_payments (membership_id);

create table log_entries (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
create index log_entries_business_idx on log_entries (business_id);
