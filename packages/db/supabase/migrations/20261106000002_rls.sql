-- Row level security. Every tenant table is isolated by tenant_id, viewers read only,
-- and the evidence tables reject UPDATE and DELETE for every role.

create or replace function public.auth_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = auth.uid()
$$;

create or replace function public.auth_write_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = auth.uid() and role in ('owner','dispatcher')
$$;

create or replace function public.auth_owner_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = auth.uid() and role = 'owner'
$$;

-- Ordinary tenant tables: members read, owners and dispatchers write.
do $$
declare t text;
begin
  foreach t in array array['crew_member','customer','site','site_pin','contract','route','route_stop','trigger_alert',
    'storm','storm_run','run_stop','problem_report','invoice_draft','installment_invoice','sms_consent'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id in (select auth_tenant_ids()))', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (tenant_id in (select auth_write_tenant_ids()))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (tenant_id in (select auth_write_tenant_ids())) with check (tenant_id in (select auth_write_tenant_ids()))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (tenant_id in (select auth_write_tenant_ids()))', t || '_delete', t);
  end loop;
end $$;

-- Read-only to members; written by the server. No UPDATE or DELETE policies exist on these.
do $$
declare t text;
begin
  foreach t in array array['visit','visit_photo','message_log','driver_action','driver_position','proof_packet'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id in (select auth_tenant_ids()))', t || '_select', t);
  end loop;
end $$;

-- Corrections are the only way an office user changes a visit, and they are insert-only.
alter table visit_correction enable row level security;
create policy visit_correction_select on visit_correction for select to authenticated using (tenant_id in (select auth_tenant_ids()));
create policy visit_correction_insert on visit_correction for insert to authenticated
  with check (tenant_id in (select auth_write_tenant_ids()) and by_user = auth.uid());

alter table tenant enable row level security;
create policy tenant_select on tenant for select to authenticated using (id in (select auth_tenant_ids()));
create policy tenant_update on tenant for update to authenticated using (id in (select auth_owner_tenant_ids())) with check (id in (select auth_owner_tenant_ids()));

alter table membership enable row level security;
create policy membership_select on membership for select to authenticated using (tenant_id in (select auth_tenant_ids()));
create policy membership_write on membership for all to authenticated using (tenant_id in (select auth_owner_tenant_ids())) with check (tenant_id in (select auth_owner_tenant_ids()));

-- Server-only tables: RLS on and no policies at all.
alter table weather_snapshot enable row level security;
alter table job enable row level security;
alter table stripe_event enable row level security;
alter table lead enable row level security;
alter table short_link enable row level security;
alter table cached_lookup enable row level security;
alter table app_setting enable row level security;

-- Least privilege on top of policies.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on job, stripe_event, lead, short_link, cached_lookup, app_setting, weather_snapshot from authenticated;
revoke insert, update, delete on visit, visit_photo, message_log, driver_action, driver_position, proof_packet from authenticated;
revoke update, delete on visit_correction from authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Append-only enforcement that also binds the service role and superusers.
create or replace function public.reject_change() returns trigger language plpgsql as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name using errcode = 'P0001';
end $$;

create trigger visit_photo_append_only before update or delete on visit_photo for each row execute function reject_change();
create trigger weather_snapshot_append_only before update or delete on weather_snapshot for each row execute function reject_change();
create trigger visit_correction_append_only before update or delete on visit_correction for each row execute function reject_change();
create trigger driver_action_append_only before update or delete on driver_action for each row execute function reject_change();

-- A visit is one row with arrival and departure columns, and a driver's Done arrives after their Arrive.
-- So exactly one transition is allowed: filling the departure side while it is still empty.
-- Arrival, identity and GPS never change, and a completed visit can never change at all.
create or replace function public.visit_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DELETE on visit is not allowed: this table is append-only' using errcode = 'P0001';
  end if;
  if old.departed_device_at is not null then
    raise exception 'UPDATE on a completed visit is not allowed: add a visit_correction instead' using errcode = 'P0001';
  end if;
  if new.departed_device_at is null then
    raise exception 'UPDATE on visit may only complete it' using errcode = 'P0001';
  end if;
  if (new.id, new.tenant_id, new.client_uuid, new.storm_id, new.run_stop_id, new.site_id, new.crew_id,
      new.arrived_device_at, new.arrived_received_at, new.arrive_lat, new.arrive_lon, new.arrive_acc_m, new.gps_match)
     is distinct from
     (old.id, old.tenant_id, old.client_uuid, old.storm_id, old.run_stop_id, old.site_id, old.crew_id,
      old.arrived_device_at, old.arrived_received_at, old.arrive_lat, old.arrive_lon, old.arrive_acc_m, old.gps_match) then
    raise exception 'Arrival, identity and GPS fields on visit are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger visit_guard before update or delete on visit for each row execute function visit_guard();

-- Cross-tenant references: a foreign key alone would let tenant A point at tenant B's rows,
-- because FK checks ignore RLS.
create or replace function public.check_tenant_ref() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  i int := 0;
  ref_table text;
  ref_col text;
  ref_id uuid;
  found_tenant uuid;
begin
  while i < tg_nargs loop
    ref_table := tg_argv[i];
    ref_col := tg_argv[i + 1];
    execute format('select ($1).%I', ref_col) into ref_id using new;
    if ref_id is not null then
      execute format('select tenant_id from %I where id = $1', ref_table) into found_tenant using ref_id;
      if found_tenant is distinct from new.tenant_id then
        raise exception '%.% does not belong to this tenant', tg_table_name, ref_col using errcode = '42501';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end $$;

create trigger tenant_ref before insert or update on site for each row execute function check_tenant_ref('customer','customer_id');
create trigger tenant_ref before insert or update on site_pin for each row execute function check_tenant_ref('site','site_id');
create trigger tenant_ref before insert or update on contract for each row execute function check_tenant_ref('site','site_id');
create trigger tenant_ref before insert or update on route for each row execute function check_tenant_ref('crew_member','default_crew_id');
create trigger tenant_ref before insert or update on route_stop for each row execute function check_tenant_ref('route','route_id','site','site_id');
create trigger tenant_ref before insert or update on storm_run for each row execute function check_tenant_ref('storm','storm_id','route','route_id','crew_member','crew_id');
create trigger tenant_ref before insert or update on run_stop for each row execute function check_tenant_ref('storm_run','storm_run_id','site','site_id');
create trigger tenant_ref before insert on visit for each row execute function check_tenant_ref('storm','storm_id','run_stop','run_stop_id','site','site_id','crew_member','crew_id');
create trigger tenant_ref before insert on visit_photo for each row execute function check_tenant_ref('visit','visit_id');
create trigger tenant_ref before insert on visit_correction for each row execute function check_tenant_ref('visit','visit_id');
create trigger tenant_ref before insert or update on invoice_draft for each row execute function check_tenant_ref('storm','storm_id','customer','customer_id');
create trigger tenant_ref before insert or update on storm for each row execute function check_tenant_ref('trigger_alert','trigger_alert_id');

-- Weather evidence is shared public data, read through this view for the tenant's own cells only.
-- NOHRSC rows list samples per site, so the view strips every other tenant's sites.
create or replace view public.tenant_weather_snapshot with (security_invoker = false) as
select s.id, s.source, s.office, s.grid_x, s.grid_y, s.station, s.fetched_at, s.last_modified, s.request_url, s.storage_path, s.sha256,
  case when s.source = 'nohrsc' then
    (s.summary - 'sites') || jsonb_build_object('sites', coalesce((
      select jsonb_object_agg(e.key, e.value) from jsonb_each(s.summary -> 'sites') e
      where e.key::uuid in (select id from site where tenant_id in (select auth_tenant_ids()))), '{}'::jsonb))
  else s.summary end as summary
from weather_snapshot s
where auth.uid() is not null and (
  s.source in ('nohrsc','nws_alerts')
  or exists (select 1 from site x where x.tenant_id in (select auth_tenant_ids())
    and ((x.nws_office = s.office and x.nws_grid_x = s.grid_x and x.nws_grid_y = s.grid_y) or x.nws_station = s.station))
);
revoke all on public.tenant_weather_snapshot from anon;
grant select on public.tenant_weather_snapshot to authenticated;

-- Storage: every bucket is private; the server reads and writes and hands out signed URLs.
insert into storage.buckets (id, name, public) values
  ('photos','photos',false), ('proof','proof',false), ('contracts','contracts',false), ('weather-archive','weather-archive',false)
on conflict (id) do nothing;
