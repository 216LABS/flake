-- Web Push: one row per browser or phone that turned on alerts for an office user.
create table push_subscription (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
create index push_subscription_tenant on push_subscription (tenant_id);
create index push_subscription_user on push_subscription (user_id);

alter table push_subscription enable row level security;
create policy push_subscription_select on push_subscription for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscription_delete on push_subscription for delete to authenticated
  using (user_id = (select auth.uid()));

-- Inserts go through the server, which checks the endpoint is a real push service before it will ever call it.
revoke all on push_subscription from anon, authenticated;
grant select, delete on push_subscription to authenticated;
grant all on push_subscription to service_role;

alter table message_log drop constraint message_log_channel_check;
alter table message_log add constraint message_log_channel_check check (channel in ('sms', 'email', 'push'));
