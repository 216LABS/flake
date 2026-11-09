-- Salt ordering: contractors order bulk salt in Flake, partner distributors deliver and bill them directly.
-- Small orders pool with others near the same supplier until they fill a truckload. 216LABS earns a referral fee
-- per ton from the supplier. Nothing here is read by browsers directly: every query goes through the server,
-- which checks the contractor's tenant itself.

create table salt_supplier (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  email text not null,
  phone text,
  lat double precision not null,
  lon double precision not null,
  radius_mi numeric not null default 40 check (radius_mi > 0 and radius_mi <= 300),
  price_per_ton_cents integer not null check (price_per_ton_cents > 0),
  truckload_tons numeric not null default 22 check (truckload_tons > 0),
  stop_fee_cents integer not null default 0 check (stop_fee_cents >= 0),
  referral_fee_per_ton_cents integer not null default 0 check (referral_fee_per_ton_cents >= 0),
  active boolean not null default true,
  link_rev integer not null default 1,
  created_at timestamptz not null default now()
);

create table salt_pool (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references salt_supplier on delete restrict,
  status text not null default 'open' check (status in ('open', 'sent', 'cancelled')),
  truckload_tons numeric not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- At most one open pool per supplier, so two orders placed at once can't start two half-empty trucks.
create unique index salt_pool_one_open on salt_pool (supplier_id) where status = 'open';

create table salt_order (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  supplier_id uuid not null references salt_supplier on delete restrict,
  pool_id uuid references salt_pool on delete restrict,
  tons numeric not null check (tons > 0 and tons <= 500),
  address text not null,
  lat double precision not null,
  lon double precision not null,
  needed_by date,
  contact_name text,
  contact_phone text,
  notes text,
  status text not null default 'pooling' check (status in ('pooling', 'ordered', 'scheduled', 'delivered', 'cancelled')),
  price_per_ton_cents integer not null,
  stop_fee_cents integer not null default 0,
  referral_fee_per_ton_cents integer not null default 0,
  delivery_date date,
  delivered_tons numeric,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index salt_order_tenant on salt_order (tenant_id, created_at desc);
create index salt_order_supplier on salt_order (supplier_id, status);
create index salt_order_pool on salt_order (pool_id);
create index salt_order_created_by on salt_order (created_by);

alter table salt_supplier enable row level security;
alter table salt_pool enable row level security;
alter table salt_order enable row level security;
revoke all on salt_supplier, salt_pool, salt_order from anon, authenticated;
grant all on salt_supplier, salt_pool, salt_order to service_role;
