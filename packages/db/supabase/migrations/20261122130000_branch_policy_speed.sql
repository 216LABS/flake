-- 228 and 227. The branch policies from 20261122120000 called a lookup function on every row, even for a member with
-- no branch limit: a 3,000-visit storm board read took 155 ms in the visit policy alone instead of under 1 ms. Now the
-- policies first ask once per query whether the signed-in member is limited to branches at all (an InitPlan), and only
-- a limited member pays the per-row check. Same rules, same results.

create or replace function private.auth_branch_unlimited() returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from membership where user_id = (select auth.uid()) and branch_ids is not null)
$$;
revoke all on function private.auth_branch_unlimited() from public, anon;
grant execute on function private.auth_branch_unlimited() to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['site', 'route', 'crew_member', 'yard', 'storm'] loop
    execute format('drop policy if exists %I on %I', t || '_branch', t);
    execute format('create policy %I on %I as restrictive for all to authenticated using ((select private.auth_branch_unlimited()) or private.branch_ok(tenant_id, branch_id)) with check ((select private.auth_branch_unlimited()) or private.branch_ok(tenant_id, branch_id))', t || '_branch', t);
  end loop;
end $$;

drop policy if exists invoice_draft_branch on invoice_draft;
create policy invoice_draft_branch on invoice_draft as restrictive for all to authenticated
  using ((select private.auth_branch_unlimited()) or private.storm_branch_ok(tenant_id, storm_id))
  with check ((select private.auth_branch_unlimited()) or private.storm_branch_ok(tenant_id, storm_id));

drop policy if exists visit_branch on visit;
create policy visit_branch on visit as restrictive for all to authenticated
  using ((select private.auth_branch_unlimited()) or private.site_branch_ok(tenant_id, site_id))
  with check ((select private.auth_branch_unlimited()) or private.site_branch_ok(tenant_id, site_id));
