-- Business tools (Nov 19, 2026): insurance certificates and claims (issue 165), bids and renewals (166), payments
-- and due dates for receivables (168), salt yards and stock (169), and employee pay rates for payroll (170).
-- Profit per lot (167) reads these and adds nothing of its own.
-- Additive only: new tables and nullable or defaulted columns. Code that predates it never reads or writes them.

-- 165. Certificates of insurance: the company's own (sent to customers on request) and each sub's.
create table certificate (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  crew_id uuid references crew_member on delete cascade,
  kind text not null check (kind in ('general_liability', 'auto', 'workers_comp', 'umbrella', 'w9', 'other')),
  insurer text check (insurer is null or char_length(insurer) <= 200),
  policy_number text check (policy_number is null or char_length(policy_number) <= 100),
  effective_on date,
  expires_on date,
  file_path text,
  file_sha256 text,
  file_name text check (file_name is null or char_length(file_name) <= 200),
  is_default boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  -- A certificate of insurance needs its end date; a W-9 doesn't expire.
  check (kind = 'w9' or expires_on is not null)
);
create index certificate_tenant on certificate (tenant_id);
create index certificate_crew on certificate (crew_id);
create index certificate_created_by on certificate (created_by);
create index certificate_expires on certificate (tenant_id, expires_on);

-- 165. A claim on a lot (a slip and fall, a damaged curb): who's asking, where it stands, and the incident packets.
create table claim (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  site_id uuid not null references site,
  incident_at timestamptz not null,
  reference text check (reference is null or char_length(reference) <= 100),
  adjuster text check (adjuster is null or char_length(adjuster) <= 300),
  status text not null default 'open' check (status in ('open', 'pending', 'closed', 'denied')),
  notes text check (notes is null or char_length(notes) <= 4000),
  proof_packet_ids uuid[] not null default '{}',
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index claim_tenant on claim (tenant_id);
create index claim_site on claim (site_id);
create index claim_created_by on claim (created_by);

-- 166. Bids: a prospect or customer, the lots, and where the bid stands, from lead to won or lost.
create table bid (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  customer_id uuid references customer on delete set null,
  prospect_name text check (prospect_name is null or char_length(prospect_name) <= 200),
  prospect_contact text check (prospect_contact is null or char_length(prospect_contact) <= 300),
  site_ids uuid[] not null default '{}',
  stage text not null default 'lead' check (stage in ('lead', 'site_walk', 'quote_sent', 'won', 'lost')),
  season text not null check (season ~ '^\d{4}-\d{2}$'),
  estimated_cents integer check (estimated_cents is null or (estimated_cents >= 0 and estimated_cents <= 1000000000)),
  notes text check (notes is null or char_length(notes) <= 4000),
  lost_reason text check (lost_reason is null or char_length(lost_reason) <= 500),
  contract_id uuid references contract on delete set null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (customer_id is not null or prospect_name is not null)
);
create index bid_tenant on bid (tenant_id, season, stage);
create index bid_customer on bid (customer_id);
create index bid_contract on bid (contract_id);
create index bid_created_by on bid (created_by);

-- 166. When renewal reminders start each year, as MM-DD in the company's time zone.
alter table tenant add column if not exists renewal_start text not null default '08-01' check (renewal_start ~ '^\d{2}-\d{2}$');

-- 168. Money received outside a card: a check, ACH, cash. Part payments leave the bill open with a balance.
create table payment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  customer_id uuid not null references customer,
  draft_id uuid references invoice_draft,
  installment_id uuid references installment_invoice,
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 1000000000),
  method text not null check (method in ('check', 'ach', 'cash', 'card', 'other')),
  reference text check (reference is null or char_length(reference) <= 100),
  paid_on date not null,
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 300),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  check ((draft_id is null) <> (installment_id is null))
);
create index payment_tenant on payment (tenant_id, paid_on);
create index payment_customer on payment (customer_id);
create index payment_draft on payment (draft_id);
create index payment_installment on payment (installment_id);
create index payment_created_by on payment (created_by);

-- 168. A due date the office set on one bill, over the default from the customer's billing mode.
alter table invoice_draft add column if not exists due_on date;
alter table installment_invoice add column if not exists due_on date;

-- 169. Where salt is piled. A company's first yard is its tenant.yard; more can be added.
create table yard (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  address text check (address is null or char_length(address) <= 300),
  lat double precision,
  lon double precision,
  reorder_tons numeric check (reorder_tons is null or (reorder_tons >= 0 and reorder_tons <= 100000)),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index yard_tenant on yard (tenant_id);

-- 169. Salt into and out of a yard other than plowing: deliveries (with their cost) and counted adjustments. Salt
-- spread on lots is read from the visits themselves, so a voided or corrected visit is always counted right.
create table salt_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  yard_id uuid not null references yard,
  qty_tons numeric not null check (qty_tons <> 0 and qty_tons between -100000 and 100000),
  cost_cents integer check (cost_cents is null or (cost_cents >= 0 and cost_cents <= 1000000000)),
  source text not null check (source in ('order', 'delivery', 'adjustment', 'count')),
  salt_order_id uuid references salt_order on delete set null,
  supplier text check (supplier is null or char_length(supplier) <= 200),
  note text check (note is null or char_length(note) <= 500),
  at timestamptz not null default now(),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index salt_ledger_yard on salt_ledger (yard_id, at);
create index salt_ledger_tenant on salt_ledger (tenant_id);
create index salt_ledger_order on salt_ledger (salt_order_id);
create index salt_ledger_created_by on salt_ledger (created_by);
alter table salt_order add column if not exists yard_id uuid references yard on delete set null;
create index salt_order_yard on salt_order (yard_id);
alter table storm_run add column if not exists yard_id uuid references yard on delete set null;
create index storm_run_yard on storm_run (yard_id);

-- 170. Employee pay for the payroll export. Ignored for subs, who stay on Sub pay.
alter table crew_member add column if not exists pay_regular_cents integer check (pay_regular_cents is null or (pay_regular_cents >= 0 and pay_regular_cents <= 100000));
alter table crew_member add column if not exists pay_ot_cents integer check (pay_ot_cents is null or (pay_ot_cents >= 0 and pay_ot_cents <= 100000));
alter table crew_member add column if not exists pay_storm_cents integer check (pay_storm_cents is null or (pay_storm_cents >= 0 and pay_storm_cents <= 100000));
alter table crew_member add column if not exists pay_holiday_cents integer check (pay_holiday_cents is null or (pay_holiday_cents >= 0 and pay_holiday_cents <= 100000));
alter table crew_member add column if not exists payroll_id text check (payroll_id is null or char_length(payroll_id) <= 50);
-- 170. Pay period length, the day a workweek starts, and holidays: {"period":"weekly","week_start":0,"holidays":["2027-01-01"]}.
alter table tenant add column if not exists payroll jsonb not null default '{}'::jsonb;
grant update (renewal_start, payroll) on tenant to authenticated;

-- Members read; owners and dispatchers write. Claims, bids and payments are office records like the rest.
do $$
declare t text;
begin
  foreach t in array array['certificate', 'claim', 'bid', 'payment', 'yard', 'salt_ledger'] loop
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

-- References must stay inside the company.
create trigger tenant_ref before insert or update on certificate for each row execute function private.check_tenant_ref('crew_member', 'crew_id');
create trigger tenant_ref before insert or update on claim for each row execute function private.check_tenant_ref('site', 'site_id');
create trigger tenant_ref before insert or update on bid for each row execute function private.check_tenant_ref('customer', 'customer_id', 'contract', 'contract_id');
create trigger tenant_ref before insert or update on payment for each row execute function private.check_tenant_ref('customer', 'customer_id', 'invoice_draft', 'draft_id', 'installment_invoice', 'installment_id');
create trigger tenant_ref before insert or update on salt_ledger for each row execute function private.check_tenant_ref('yard', 'yard_id');
drop trigger if exists tenant_ref on storm_run;
create trigger tenant_ref before insert or update on storm_run for each row execute function private.check_tenant_ref('storm', 'storm_id', 'route', 'route_id', 'crew_member', 'crew_id', 'truck', 'truck_id', 'yard', 'yard_id');
