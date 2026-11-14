-- How a company's customers pay a bill it collects itself: "Checks to Flip's Plowing, 12 Main St" or "Zelle to
-- 216-555-0100". Shown on the customer's records page and in the Send bill email, in place of the generic "pay by
-- check or over the phone". Additive: one nullable column. Code that predates it never reads or writes it.

alter table tenant add column if not exists pay_instructions text;

grant update (pay_instructions) on tenant to authenticated;
