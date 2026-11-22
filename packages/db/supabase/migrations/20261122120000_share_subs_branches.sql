-- Big shops and insurers (Nov 22, 2026): share links with an access log (issue 236), subcontractor companies (226),
-- branches and finer roles (227), and indexes for large companies (228).
-- Additive only: new tables, nullable columns, a wider role check, and RESTRICTIVE policies that only narrow access for
-- a member who is limited to some branches. A company with one branch, and every member today, sees no change.

-- 236. Share a proof packet, incident packet or insurance renewal pack with an agent, adjuster or attorney.
create table share_link (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  kind text not null check (kind in ('proof', 'renewal')),
  proof_packet_id uuid references proof_packet on delete cascade,
  -- A renewal pack's period, and what the office called the link.
  params jsonb not null default '{}'::jsonb,
  label text check (label is null or char_length(label) <= 200),
  token_hash text not null unique,
  token_enc text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'proof' or proof_packet_id is not null)
);
create index share_link_tenant on share_link (tenant_id, created_at desc);
create index share_link_packet on share_link (proof_packet_id);
create index share_link_created_by on share_link (created_by);

create table share_link_open (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  share_link_id uuid not null references share_link on delete cascade,
  opened_at timestamptz not null default now(),
  -- Hashed, never the address itself.
  ip_hash text,
  user_agent text check (user_agent is null or char_length(user_agent) <= 300)
);
create index share_link_open_link on share_link_open (share_link_id, opened_at desc);
create index share_link_open_tenant on share_link_open (tenant_id);

-- 226. A subcontractor company with its own drivers; pay rolls up to one statement per company.
create table sub_company (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text check (email is null or char_length(email) <= 320),
  -- The sub's private portal link, like a customer's records page.
  portal_token_hash text unique,
  portal_token_enc text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index sub_company_tenant on sub_company (tenant_id);

alter table crew_member add column if not exists sub_company_id uuid references sub_company on delete set null;
alter table site add column if not exists sub_company_id uuid references sub_company on delete set null;
create index if not exists crew_member_sub_company on crew_member (sub_company_id);
create index if not exists site_sub_company on site (sub_company_id);

-- A sub's answer to a period statement: it looks right, or a line is disputed, with a note.
create table sub_statement (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  sub_company_id uuid not null references sub_company on delete cascade,
  period_from date not null,
  period_to date not null,
  status text not null check (status in ('acknowledged', 'disputed')),
  note text check (note is null or char_length(note) <= 2000),
  disputed_line text check (disputed_line is null or char_length(disputed_line) <= 500),
  responded_at timestamptz not null default now(),
  unique (sub_company_id, period_from, period_to),
  check (period_to >= period_from)
);
create index sub_statement_tenant on sub_statement (tenant_id);

-- Hard-block a sub with an expired or missing insurance certificate from storm runs (default off: warn, as today).
alter table tenant add column if not exists block_lapsed_coi boolean not null default false;
grant update (block_lapsed_coi) on tenant to authenticated;

-- 227. Branches (yards) with their own sites, routes, crew, salt and storms.
create table branch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  yard jsonb,
  timezone text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, name)
);
create index branch_tenant on branch (tenant_id);

alter table site add column if not exists branch_id uuid references branch on delete set null;
alter table route add column if not exists branch_id uuid references branch on delete set null;
alter table crew_member add column if not exists branch_id uuid references branch on delete set null;
alter table yard add column if not exists branch_id uuid references branch on delete set null;
alter table storm add column if not exists branch_id uuid references branch on delete set null;
create index if not exists site_branch on site (branch_id);
create index if not exists route_branch on route (branch_id);
create index if not exists crew_member_branch on crew_member (branch_id);
create index if not exists yard_branch on yard (branch_id);
create index if not exists storm_branch on storm (branch_id);

-- Finer roles. A member with branch_ids sees and changes only those branches; null is every branch.
alter table membership drop constraint if exists membership_role_check;
alter table membership add constraint membership_role_check check (role in ('owner', 'dispatcher', 'viewer', 'branch_manager', 'billing', 'field_lead'));
alter table membership add column if not exists branch_ids uuid[];

-- Office roles write; what each may do in the app (billing can't dispatch, a field lead never sees money) is checked
-- per route. Viewer stays read-only. The owner-only function is unchanged.
create or replace function private.auth_write_tenant_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select tenant_id from membership where user_id = (select auth.uid()) and role in ('owner', 'dispatcher', 'branch_manager', 'billing', 'field_lead')
$$;

-- True when this row's branch is one the signed-in member may see: no branch on the row, or a member with no branch
-- limit, or the branch in their list.
create or replace function private.branch_ok(p_tenant uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_branch is null or exists (
    select 1 from membership m where m.user_id = (select auth.uid()) and m.tenant_id = p_tenant
      and (m.branch_ids is null or p_branch = any (m.branch_ids))
  )
$$;
create or replace function private.storm_branch_ok(p_tenant uuid, p_storm uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.branch_ok(p_tenant, (select s.branch_id from storm s where s.id = p_storm))
$$;
create or replace function private.site_branch_ok(p_tenant uuid, p_site uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.branch_ok(p_tenant, (select s.branch_id from site s where s.id = p_site))
$$;
revoke all on function private.branch_ok(uuid, uuid) from public, anon;
revoke all on function private.storm_branch_ok(uuid, uuid) from public, anon;
revoke all on function private.site_branch_ok(uuid, uuid) from public, anon;
grant execute on function private.branch_ok(uuid, uuid) to authenticated, service_role;
grant execute on function private.storm_branch_ok(uuid, uuid) to authenticated, service_role;
grant execute on function private.site_branch_ok(uuid, uuid) to authenticated, service_role;

-- Restrictive policies AND with the existing ones, so they can only take rows away from a branch-limited member.
do $$
declare t text;
begin
  foreach t in array array['site', 'route', 'crew_member', 'yard', 'storm'] loop
    execute format('create policy %I on %I as restrictive for all to authenticated using (private.branch_ok(tenant_id, branch_id)) with check (private.branch_ok(tenant_id, branch_id))', t || '_branch', t);
  end loop;
end $$;
create policy invoice_draft_branch on invoice_draft as restrictive for all to authenticated using (private.storm_branch_ok(tenant_id, storm_id)) with check (private.storm_branch_ok(tenant_id, storm_id));
create policy visit_branch on visit as restrictive for all to authenticated using (private.site_branch_ok(tenant_id, site_id)) with check (private.site_branch_ok(tenant_id, site_id));

-- The new tables: members read, office roles write; share-link opens and sub answers are written by the server.
do $$
declare t text;
begin
  foreach t in array array['share_link', 'sub_company', 'branch'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id in (select private.auth_tenant_ids()))', t || '_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (tenant_id in (select private.auth_write_tenant_ids()))', t || '_insert', t);
    execute format('create policy %I on %I for update to authenticated using (tenant_id in (select private.auth_write_tenant_ids())) with check (tenant_id in (select private.auth_write_tenant_ids()))', t || '_update', t);
    execute format('create policy %I on %I for delete to authenticated using (tenant_id in (select private.auth_write_tenant_ids()))', t || '_delete', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
  foreach t in array array['share_link_open', 'sub_statement'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (tenant_id in (select private.auth_tenant_ids()))', t || '_select', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

create trigger tenant_ref before insert or update on share_link for each row execute function private.check_tenant_ref('proof_packet', 'proof_packet_id');
create trigger tenant_ref before insert or update on share_link_open for each row execute function private.check_tenant_ref('share_link', 'share_link_id');
create trigger tenant_ref before insert or update on sub_statement for each row execute function private.check_tenant_ref('sub_company', 'sub_company_id');

-- 228. Big companies: the lists and joins a 600-lot, 60-truck storm leans on.
create index if not exists run_stop_run_seq on run_stop (storm_run_id, seq);
create index if not exists visit_storm_site on visit (storm_id, site_id);
create index if not exists visit_run_stop on visit (run_stop_id);
create index if not exists visit_photo_visit on visit_photo (visit_id);
create index if not exists driver_action_run_device on driver_action (storm_run_id, device_at);
create index if not exists driver_position_run_device on driver_position (storm_run_id, device_at desc);
create index if not exists invoice_draft_storm_status on invoice_draft (storm_id, status);
create index if not exists customer_tenant_created on customer (tenant_id, created_at desc);
create index if not exists site_customer on site (customer_id);
