-- Issue 171: Flake sends email and texts for a company only after a platform admin turns it on. Off for every
-- company, old and new. No update grant to authenticated, so an owner can't flip it; only the service role writes it.
alter table tenant add column if not exists outbound_enabled boolean not null default false;
alter table tenant add column if not exists outbound_changed_at timestamptz;
alter table tenant add column if not exists outbound_changed_by text;

-- Issue 172: who agreed to the Terms and Privacy Policy when the company was made, when, and which versions.
-- Written once by the server at onboarding; no update grant, so settings can't clear it.
alter table tenant add column if not exists terms_accepted_at timestamptz;
alter table tenant add column if not exists terms_accepted_by uuid;
alter table tenant add column if not exists terms_version text;

-- Issue 173: the company's logo, a storage path the server writes after checking the file.
alter table tenant add column if not exists logo_path text;

-- Issue 176: rate limits shared by every server instance. One row per key per window; old rows are swept.
create table if not exists rate_limit (
  key text not null,
  window_start timestamptz not null,
  n integer not null default 1,
  primary key (key, window_start)
);
create index if not exists rate_limit_window_idx on rate_limit (window_start);
alter table rate_limit enable row level security;
revoke all on rate_limit from public, anon, authenticated;
