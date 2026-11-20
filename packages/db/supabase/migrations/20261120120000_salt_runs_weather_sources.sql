-- Issue 204: a "salt run" alert per service area for salt lots (snow under the plow trigger, ice, freezing rain,
-- refreeze). The refreeze alerts written earlier were refused by the old check, so they never reached the office;
-- both kinds are allowed now.
alter table trigger_alert drop constraint if exists trigger_alert_kind_check;
alter table trigger_alert add constraint trigger_alert_kind_check check (kind in ('forecast','depth_report','nws_alert','refreeze','salt_run'));

-- Issue 203: more forecast and observation sources, archived like the NWS grid. nbm is the National Blend of Models
-- (with snowfall percentiles), nowcast is the hourly short-range model during storms, mrms is radar-estimated
-- precipitation, station_obs and cocorahs are observed totals after a storm.
alter table weather_snapshot drop constraint if exists weather_snapshot_source_check;
alter table weather_snapshot add constraint weather_snapshot_source_check check (source in ('nws_grid','nws_alerts','nws_obs','nohrsc','nbm','nowcast','mrms','station_obs','cocorahs'));
