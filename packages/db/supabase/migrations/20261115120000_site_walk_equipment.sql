-- Pre-season site walks, trucks and the equipment log (Nov 15, 2026).
-- Additive: three new tables and two nullable columns. Code that predates it never reads or writes them.

-- What a lot looked like before the first snow: existing damage, where the piles go, hazards. Photos are evidence
-- in a spring damage dispute, so each keeps its hash and the time it was taken.
create table site_walk_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  site_id uuid not null references site,
  season text not null check (season ~ '^\d{4}-\d{2}$'),
  kind text not null check (kind in ('damage', 'pile', 'hazard', 'drain', 'note')),
  note text check (note is null or char_length(note) <= 1000),
  photo_path text,
  photo_sha256 text,
  lat double precision,
  lon double precision,
  taken_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index site_walk_item_site on site_walk_item (site_id, season, created_at);

-- Trucks, loaders and other equipment a company runs.
create table truck (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null default 'truck' check (kind in ('truck', 'loader', 'skid_steer', 'spreader', 'other')),
  plate text check (plate is null or char_length(plate) <= 20),
  notes text check (notes is null or char_length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index truck_name on truck (tenant_id, lower(name)) where active;

-- Fuel, engine or blade hours, and maintenance, each against a truck and, when it happened in one, a storm.
create table equipment_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  truck_id uuid not null references truck,
  storm_id uuid references storm on delete set null,
  kind text not null check (kind in ('fuel', 'hours', 'maintenance', 'note')),
  gallons numeric check (gallons is null or (gallons > 0 and gallons <= 1000)),
  cost_cents integer check (cost_cents is null or (cost_cents >= 0 and cost_cents <= 100000000)),
  hours numeric check (hours is null or (hours >= 0 and hours <= 100000)),
  note text check (note is null or char_length(note) <= 1000),
  at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index equipment_log_truck on equipment_log (truck_id, at desc);
create index equipment_log_storm on equipment_log (storm_id);

-- Which truck runs a route by default, and which one ran it in a storm.
alter table route add column if not exists default_truck_id uuid references truck on delete set null;
alter table storm_run add column if not exists truck_id uuid references truck on delete set null;

-- Every foreign key indexed, as the advisor checks ask.
create index site_walk_item_tenant on site_walk_item (tenant_id);
create index site_walk_item_created_by on site_walk_item (created_by);
create index truck_tenant on truck (tenant_id);
create index equipment_log_tenant on equipment_log (tenant_id);
create index equipment_log_created_by on equipment_log (created_by);
create index route_default_truck on route (default_truck_id);
create index storm_run_truck on storm_run (truck_id);

-- Members read; owners and dispatchers write. The same rules as the other tenant tables.
do $$
declare t text;
begin
  foreach t in array array['site_walk_item', 'truck', 'equipment_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id in (select private.auth_tenant_ids()))', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (tenant_id in (select private.auth_write_tenant_ids()))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (tenant_id in (select private.auth_write_tenant_ids())) with check (tenant_id in (select private.auth_write_tenant_ids()))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (tenant_id in (select private.auth_write_tenant_ids()))', t || '_delete', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

-- A row can only point at its own company's lot, truck or storm.
create trigger tenant_ref before insert or update on site_walk_item for each row execute function private.check_tenant_ref('site', 'site_id');
create trigger tenant_ref before insert or update on equipment_log for each row execute function private.check_tenant_ref('truck', 'truck_id', 'storm', 'storm_id');
drop trigger if exists tenant_ref on route;
create trigger tenant_ref before insert or update on route for each row execute function private.check_tenant_ref('crew_member', 'default_crew_id', 'truck', 'default_truck_id');
drop trigger if exists tenant_ref on storm_run;
create trigger tenant_ref before insert or update on storm_run for each row execute function private.check_tenant_ref('storm', 'storm_id', 'route', 'route_id', 'crew_member', 'crew_id', 'truck', 'truck_id');
