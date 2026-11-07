-- RLS decides which rows an owner can update, not which columns, and Supabase's REST API reaches these tables
-- directly with a signed-in user's token. Without this an owner could set their own plan, free season, Stripe
-- status or SMS approval. Those columns now change only through the server connection.
revoke update on tenant from authenticated;
grant update (name, timezone, business_legal_name, ein_last4, address, contact_email, contact_phone, rate_card, sms_verification) on tenant to authenticated;

-- Consent is recorded by the opt-in pages and the STOP webhook, through the server. Nobody in the office can write it.
revoke insert, update, delete on sms_consent from authenticated;

-- The same reasoning for the fields Stripe owns on a draft. A charge recomputes its fee from the plan either way.
revoke update on invoice_draft from authenticated;
grant update (lines, subtotal_cents, flags, status, status_detail, application_fee_cents) on invoice_draft to authenticated;
