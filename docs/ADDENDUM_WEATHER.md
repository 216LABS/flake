# Addendum — Weather, Triggers, Evidence (v1.0)
Sources and rationale: DECISIONS D3.

## 1. Data sources
| Source | Use | Resolution / cadence | Cost / limits |
|---|---|---|---|
| NWS `/points/{lat},{lon}` | Map site → office/gridX/gridY (+ stations, zones) | ~2.5 km grid | Free; required `User-Agent: (flake.216labs.dev, sam@216labs.dev)`; unpublished rate limit, retry after ~5 s [V] |
| NWS `/gridpoints/{office}/{x},{y}` | `snowfallAmount`, `iceAccumulation`, `temperature`, `probabilityOfPrecipitation`, `quantitativePrecipitation` time series | Hourly-ish intervals, 7 days | Free; use `If-Modified-Since` → 304 [V] |
| NWS `/alerts/active?point=` | Winter Storm / Lake Effect Snow / Winter Weather Advisory | Event-driven | Free |
| NWS `/stations/{id}/observations/latest` | Temp, conditions for the visit and the proof packet | ~hourly | Free |
| NOHRSC National Gridded Snowfall Analysis | Observed 6/24/48/72 h snowfall at site points | Issued every 12 h, reprocessed for 5 days [V] | Free; GeoTIFF (sample with `geotiff.js`) [T: confirm the current file URL pattern, e.g. `https://www.nohrsc.noaa.gov/snowfall/data/YYYYMM/sfav2_CONUS_24h_YYYYMMDDHH_grid184.nc`; prefer the GeoTIFF variant] |
| Driver depth report | First site of each run; required chip | Real time | — |

## 2. Units and parsing
- `snowfallAmount.uom` is usually `wmoUnit:mm`. Convert to inches (÷25.4) and keep 1 decimal.
- `validTime` = `start/duration` (ISO 8601). Expand to hourly buckets and pro-rate evenly within an interval.
- `null` means unavailable, never 0.
- Re-map `/points` every 7 days, or on a 404 from gridpoints.

## 3. Trigger engine (packages/core/trigger.ts)
For each active site with contract services that have `trigger_in`:
- `forecastNext12h` = sum of snowfall over [now, now+12h].
- `elapsedSinceOnset` = sum over [onset, now], where onset is the first hour with snowfall > 0 in the current event (the event ends after 6 h of 0).
- `reportedDepth` = the latest driver depth report within 5 km in this event (if any).
- **Alert kinds:**
  - `forecast`: forecastNext12h ≥ trigger. Heads-up, sent once per site per event, sent at ≥ 6 h lead when possible.
  - `depth_report`: max(elapsedSinceOnset, reportedDepth) ≥ trigger. "At trigger now."
  - `nws_alert`: a new active winter alert covering the service area.
- Alerts are grouped per tenant into one `trigger_alert` with site_ids (debounce 30 min). Notify the owner and dispatchers.
- **No auto-dispatch:** the owner taps Start storm (PLAN non-goal).
- Ice/refreeze: if `iceAccumulation` > 0 or temp crosses 32°F downward within 6 h after snow, create a `forecast` alert for salt-only services with the label "refreeze risk."

## 4. Polling schedule
- `/api/cron/weather` every 15 min: for each distinct grid cell with an active site, enqueue `weather.fetch_cell` if (last fetch > 60 min) or (cell has forecast snow in next 24 h or an active alert and last fetch > 15 min).
- Alerts: every 15 min per tenant centroid.
- NOHRSC: every 6 h. Sample each active site and store a summary in the snapshot `{site_id: {h6, h24}}`.
- Back off on 429/5xx with jitter. A circuit breaker pauses for 10 min after 5 consecutive failures and records "weather unavailable" on the dashboard.

## 5. Evidence archive
- Every fetch is gzipped raw → Storage `weather-archive/{source}/{key}/{fetched_at_iso}.json.gz`. Compute the sha256 of the raw bytes and store a row in `weather_snapshot` with summary {snow_next12h_in, snow_elapsed_in, alerts[], temp_f}.
- Snapshots are shared across tenants (public data) and never deleted (retain ≥ 7 years). The bucket has object lock / no delete policy for the app role.
- A storm records `forecast_snapshot_ids` at start and at close. Visits link to the nearest snapshot by time and cell.
- The proof packet prints the source URL, fetched_at, Last-Modified, sha256, and the summary values for each referenced snapshot, plus the plain-language caveat: "Forecast values are National Weather Service gridded forecasts as retrieved at the time shown; observed totals are NOHRSC analyses, which may be revised for up to 5 days."

## 6. Mock mode
`MockWeatherProvider` replays fixtures: `fixtures/weather/lakewood-lake-effect-2025-12.json` (a synthetic 3-day event: 0.5", 3.2", 1.1"), `quiet.json`, `refreeze.json`. Clearly label them synthetic. A dev page `/dev/weather` lets you advance a fake clock to fire triggers.
