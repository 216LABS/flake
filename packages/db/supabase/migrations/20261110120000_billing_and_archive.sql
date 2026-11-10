-- Fixes from the Nov 10 2026 issue sweep. Additive only: no data is rewritten.

-- Seasonal installments: which month each one was billed for, so a retried or re-run monthly job never bills
-- two installments in one month (issue 6). Old rows keep a null month.
alter table installment_invoice add column if not exists period text;
create unique index if not exists installment_invoice_contract_period on installment_invoice (contract_id, period) where period is not null;

-- A quote's link, encrypted like route links, so the office and the customer's records page can open it again
-- (issues 22 and 37). Older quotes have only the hash and keep working by email.
alter table contract add column if not exists quote_token_enc text;

-- Customers and routes can be archived instead of deleted, so history stays intact (issue 23).
alter table customer add column if not exists archived_at timestamptz;
alter table route add column if not exists archived_at timestamptz;

-- Money and signature columns change only through the server (issue 8). RLS decides which rows a signed-in user
-- can reach, not which columns, and the Data API reaches these tables directly with a user's token.

-- Invoice drafts: the app writes them through the server connection after checking the user's role.
revoke insert, update, delete on invoice_draft from authenticated;
revoke insert, update, delete on installment_invoice from authenticated;

-- Customers: Stripe ids, payment method and notification consent are set by Stripe and by the customer.
revoke update on customer from authenticated;
grant update (name, kind, contact_name, phone_e164, email, billing_mode, archived_at) on customer to authenticated;

-- Routes: archiving is an ordinary edit.
grant update (archived_at) on route to authenticated;

-- Contracts: the office writes the offer and can void it. Acceptance, the signer, the signed PDF, the quote link and
-- installment progress are written by the server only. Updates are limited by column. Inserts can't be, because the
-- ORM names every column on insert (unset ones as DEFAULT), so the trigger below checks what a new row says.
revoke update on contract from authenticated;
grant update (season, services, salt_pricing, terms_md, status) on contract to authenticated;

-- Column grants can't stop a user writing status = 'accepted' themselves, which would forge a signature. Only the
-- server connection may accept, and a new row from a user carries no acceptance or progress.
create or replace function private.contract_office_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
    raise exception 'Only the customer can accept a quote' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and tg_op = 'INSERT' and (new.accepted_at is not null or new.accepted_name is not null or new.accepted_ip is not null
      or new.pdf_path is not null or new.installments_billed <> 0 or new.quote_token_hash is not null or new.quote_token_enc is not null) then
    raise exception 'Only the server records acceptance, links and billing progress' using errcode = '42501';
  end if;
  if current_user = 'authenticated' and tg_op = 'UPDATE' and old.status in ('accepted', 'void') and new.status is distinct from 'void' then
    raise exception 'A signed or void contract can only be voided' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function private.contract_office_status() from public;
grant execute on function private.contract_office_status() to authenticated;
drop trigger if exists contract_office_status on contract;
create trigger contract_office_status before insert or update on contract for each row execute function private.contract_office_status();
