-- Maintenance reminders (issue 161) and QuickBooks Online sync (issue 162).
-- Additive: new tables and nullable columns. Code that predates it never reads or writes them.

-- "Oil change every 250 hours", "Blade check every 30 days": due from the truck's meter hours or the calendar.
create table maintenance_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  truck_id uuid not null references truck on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  every_hours numeric check (every_hours is null or (every_hours > 0 and every_hours <= 10000)),
  every_days integer check (every_days is null or (every_days > 0 and every_days <= 3650)),
  last_done_at timestamptz,
  last_done_hours numeric check (last_done_hours is null or last_done_hours >= 0),
  created_at timestamptz not null default now(),
  check (every_hours is not null or every_days is not null)
);
create index maintenance_item_truck on maintenance_item (truck_id);
create index maintenance_item_tenant on maintenance_item (tenant_id);

-- One accounting connection per company. Tokens are encrypted by the server and never readable by browsers.
create table integration (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  provider text not null check (provider in ('qbo')),
  realm_id text,
  token_enc text,
  refresh_enc text,
  expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  status_detail text,
  connected_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index integration_one_per_provider on integration (tenant_id, provider);
create index integration_connected_by on integration (connected_by);

-- Which QuickBooks item each Flake line maps to: plow, salt, walks, haul, seasonal.
create table qbo_item_map (
  tenant_id uuid not null references tenant on delete cascade,
  flake_key text not null check (flake_key in ('plow', 'salt', 'walks', 'haul', 'seasonal', 'other')),
  qbo_item_id text not null,
  qbo_item_name text,
  primary key (tenant_id, flake_key)
);

alter table customer add column if not exists qbo_customer_id text;
alter table invoice_draft add column if not exists qbo_invoice_id text;
alter table invoice_draft add column if not exists qbo_sync_token text;
alter table invoice_draft add column if not exists qbo_synced_at timestamptz;
alter table invoice_draft add column if not exists qbo_error text;
alter table installment_invoice add column if not exists qbo_invoice_id text;
alter table installment_invoice add column if not exists qbo_sync_token text;
alter table installment_invoice add column if not exists qbo_synced_at timestamptz;
alter table installment_invoice add column if not exists qbo_error text;

-- Maintenance: members read, owners and dispatchers write, like the trucks they belong to.
alter table maintenance_item enable row level security;
create policy maintenance_item_select on maintenance_item for select to authenticated using (tenant_id in (select private.auth_tenant_ids()));
create policy maintenance_item_insert on maintenance_item for insert to authenticated with check (tenant_id in (select private.auth_write_tenant_ids()));
create policy maintenance_item_update on maintenance_item for update to authenticated using (tenant_id in (select private.auth_write_tenant_ids())) with check (tenant_id in (select private.auth_write_tenant_ids()));
create policy maintenance_item_delete on maintenance_item for delete to authenticated using (tenant_id in (select private.auth_write_tenant_ids()));
revoke all on maintenance_item from anon;
grant select, insert, update, delete on maintenance_item to authenticated;
grant all on maintenance_item to service_role;
create trigger tenant_ref before insert or update on maintenance_item for each row execute function private.check_tenant_ref('truck', 'truck_id');

-- The connection and item map are server-only: browsers never read or write them (the tokens live here).
alter table integration enable row level security;
alter table qbo_item_map enable row level security;
revoke all on integration, qbo_item_map from anon, authenticated;
grant all on integration, qbo_item_map to service_role;

-- QuickBooks ids and sync state are written by the server's sync job, not by users through the Data API.
revoke update (qbo_invoice_id, qbo_sync_token, qbo_synced_at, qbo_error) on invoice_draft from authenticated;
revoke update (qbo_invoice_id, qbo_sync_token, qbo_synced_at, qbo_error) on installment_invoice from authenticated;
