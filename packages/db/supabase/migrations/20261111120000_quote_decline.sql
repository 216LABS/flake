-- A customer can decline a quote from its page (issue 59), so the office isn't left waiting on it.
-- Additive: a new allowed status and two nullable columns. Code that predates it never writes them.

alter table contract drop constraint if exists contract_status_check;
alter table contract add constraint contract_status_check check (status in ('draft','sent','accepted','void','declined'));
alter table contract add column if not exists declined_at timestamptz;
alter table contract add column if not exists decline_reason text;

-- Only the customer declines, through the server connection, the same as accepting. A declined quote can be voided by
-- the office and nothing else.
create or replace function private.contract_office_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    raise exception 'Only the customer can accept a quote' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and new.status = 'declined' and (tg_op = 'INSERT' or old.status is distinct from 'declined') then
    raise exception 'Only the customer can decline a quote' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and tg_op = 'INSERT' and (new.accepted_at is not null or new.accepted_name is not null or new.accepted_ip is not null
      or new.pdf_path is not null or new.installments_billed <> 0 or new.quote_token_hash is not null or new.quote_token_enc is not null
      or new.declined_at is not null or new.decline_reason is not null) then
    raise exception 'Only the server records acceptance, links and billing progress' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and tg_op = 'UPDATE' and old.status in ('accepted', 'void', 'declined') and new.status is distinct from 'void' then
    raise exception 'A signed, declined or void contract can only be voided' using errcode = '42501';
  end if;
  return new;
end $$;
