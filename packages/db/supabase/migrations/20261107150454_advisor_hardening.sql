-- Advisor fixes for a database that already has the earlier migrations.
-- No data is rewritten. Helper functions move to schema private (same OIDs,
-- so existing policies and triggers keep working) and stay executable by
-- authenticated, which is what RLS evaluation and row triggers need.
-- private is not part of the Data API. Do not add it to exposed schemas.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;
alter default privileges in schema private revoke execute on functions from public;

alter function public.auth_tenant_ids() set schema private;
alter function public.auth_write_tenant_ids() set schema private;
alter function public.auth_owner_tenant_ids() set schema private;
alter function public.check_tenant_ref() set schema private;

-- (select auth.uid()) is evaluated once per statement. SECURITY DEFINER stays,
-- because these reads of membership would recurse through RLS otherwise.
create or replace function private.auth_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = (select auth.uid())
$$;

create or replace function private.auth_write_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = (select auth.uid()) and role in ('owner','dispatcher')
$$;

create or replace function private.auth_owner_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = (select auth.uid()) and role = 'owner'
$$;

-- Weather rows stay on the server-only table. Callers hit a security-invoker
-- view that delegates to this function, which applies the tenant filter itself.
create or replace function private.tenant_weather_snapshot()
returns table (
  id uuid,
  source text,
  office text,
  grid_x integer,
  grid_y integer,
  station text,
  fetched_at timestamptz,
  last_modified timestamptz,
  request_url text,
  storage_path text,
  sha256 text,
  summary jsonb
)
language sql stable security definer set search_path = public as $$
  select s.id, s.source, s.office, s.grid_x, s.grid_y, s.station, s.fetched_at, s.last_modified, s.request_url, s.storage_path, s.sha256,
    case when s.source = 'nohrsc' then
      (s.summary - 'sites') || jsonb_build_object('sites', coalesce((
        select jsonb_object_agg(e.key, e.value) from jsonb_each(s.summary -> 'sites') e
        where e.key::uuid in (select id from site where tenant_id in (select private.auth_tenant_ids()))), '{}'::jsonb))
    else s.summary end as summary
  from weather_snapshot s
  where (select auth.uid()) is not null and (
    s.source in ('nohrsc','nws_alerts')
    or exists (select 1 from site x where x.tenant_id in (select private.auth_tenant_ids())
      and ((x.nws_office = s.office and x.nws_grid_x = s.grid_x and x.nws_grid_y = s.grid_y) or x.nws_station = s.station))
  );
$$;

drop view if exists public.tenant_weather_snapshot;
create view public.tenant_weather_snapshot
with (security_invoker = true) as
select * from private.tenant_weather_snapshot();

revoke all on public.tenant_weather_snapshot from public, anon, authenticated;
grant select on public.tenant_weather_snapshot to authenticated;

revoke all on function private.auth_tenant_ids() from public, anon, authenticated, service_role;
revoke all on function private.auth_write_tenant_ids() from public, anon, authenticated, service_role;
revoke all on function private.auth_owner_tenant_ids() from public, anon, authenticated, service_role;
revoke all on function private.check_tenant_ref() from public, anon, authenticated, service_role;
revoke all on function private.tenant_weather_snapshot() from public, anon, authenticated, service_role;

grant execute on function private.auth_tenant_ids() to authenticated, service_role;
grant execute on function private.auth_write_tenant_ids() to authenticated, service_role;
grant execute on function private.auth_owner_tenant_ids() to authenticated, service_role;
grant execute on function private.check_tenant_ref() to authenticated, service_role;
grant execute on function private.tenant_weather_snapshot() to authenticated, service_role;

alter function public.reject_change() set search_path = '';
alter function public.visit_guard() set search_path = '';

-- membership_write was FOR ALL, so it overlapped membership_select on SELECT.
drop policy if exists membership_write on membership;
drop policy if exists membership_insert on membership;
drop policy if exists membership_update on membership;
drop policy if exists membership_delete on membership;

create policy membership_insert on membership for insert to authenticated
  with check (tenant_id in (select private.auth_owner_tenant_ids()));
create policy membership_update on membership for update to authenticated
  using (tenant_id in (select private.auth_owner_tenant_ids()))
  with check (tenant_id in (select private.auth_owner_tenant_ids()));
create policy membership_delete on membership for delete to authenticated
  using (tenant_id in (select private.auth_owner_tenant_ids()));

drop policy if exists visit_correction_insert on visit_correction;
create policy visit_correction_insert on visit_correction for insert to authenticated
  with check (tenant_id in (select private.auth_write_tenant_ids()) and by_user = (select auth.uid()));

-- Foreign keys the advisor reported as unindexed. Skip a name that already exists.
create index if not exists membership_user_id_idx on membership (user_id);
create index if not exists crew_member_tenant_id_idx on crew_member (tenant_id);
create index if not exists customer_tenant_id_idx on customer (tenant_id);
create index if not exists site_tenant_id_idx on site (tenant_id);
create index if not exists site_customer_id_idx on site (customer_id);
create index if not exists site_pin_site_id_idx on site_pin (site_id);
create index if not exists contract_site_id_idx on contract (site_id);
create index if not exists route_default_crew_id_idx on route (default_crew_id);
create index if not exists route_stop_site_id_idx on route_stop (site_id);
create index if not exists storm_trigger_alert_id_idx on storm (trigger_alert_id);
create index if not exists storm_run_storm_id_idx on storm_run (storm_id);
create index if not exists storm_run_route_id_idx on storm_run (route_id);
create index if not exists storm_run_crew_id_idx on storm_run (crew_id);
create index if not exists run_stop_site_id_idx on run_stop (site_id);
create index if not exists visit_run_stop_id_idx on visit (run_stop_id);
create index if not exists visit_crew_id_idx on visit (crew_id);
create index if not exists visit_correction_by_crew_idx on visit_correction (by_crew);
create index if not exists invoice_draft_customer_id_idx on invoice_draft (customer_id);
create index if not exists driver_action_storm_run_id_idx on driver_action (storm_run_id);
