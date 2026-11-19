-- A pile counted at 0 tons is a real count (issue 169). The first version refused any zero row.
alter table salt_ledger drop constraint if exists salt_ledger_qty_tons_check;
alter table salt_ledger add constraint salt_ledger_qty_tons_check check (qty_tons between -100000 and 100000 and (qty_tons <> 0 or source = 'count'));
