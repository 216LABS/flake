-- When a driver first opened their route link (issue 86), so the board can say "Opened 3:12 AM" or "Not opened yet".
-- Additive: one nullable column. Only the server writes it, when the driver app first loads its run, so a link
-- preview that never runs the app doesn't count. Code that predates it never reads or writes it.

alter table storm_run add column if not exists link_opened_at timestamptz;
