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
| NOAA National Blend of Models (NBM), NOMADS `blend/prod/blend.YYYYMMDD/HH/core/*.co.grib2` | 6-hour snowfall percentiles (10th, 50th, 90th) for the next 24 h: how sure a forecast is ("certain", "likely", "possible"), and a second opinion that can raise a "likely" alert the NWS grid misses (issue 203) | 2.5 km CONUS. Percentiles only come with the 00, 06, 12 and 18 UTC runs, about 2 h after; checked hourly, downloaded when a new run is out | Free, public domain. Only the 12 fields used are downloaded, by byte range from each file's `.idx` (about 6 MB a run). NOMADS asks for reasonable use and blocks abusive IPs; 4 runs a day is well inside that. Attribution: NOAA/NWS/MDL |
| NOAA HRRR, NOMADS `hrrr/prod/hrrr.YYYYMMDD/conus/hrrr.tHHz.wrfsfcfNN.grib2` | Hour-by-hour snowfall (`ASNOW`) and freezing rain (`FRZR`) for the next 6 h, replacing the NWS grid's own hours for those 6 h during storms | 3 km CONUS, a new run every hour, about an hour after | Free, public domain. 12 small fields a run (under 2 MB). Fetched hourly only while snow is forecast within 24 h or a storm is running. Attribution: NOAA/NCEP |
| NOAA MRMS radar-only precipitation, NWS map service `mapservices.weather.noaa.gov/raster/rest/services/obs/mrms_qpe/ImageServer` (`getSamples`) | Liquid precipitation that fell in the last 1 h and 3 h at each lot ("Radar: 0.05\" last hour" on the dashboard). Stored per lot for observed totals and bias correction later | About 1 km, updated hourly | Free, public. One request samples up to 200 lots. Negative values mean outside radar coverage and are stored as unavailable, never 0. Attribution: NOAA/NSSL MRMS via NWS |
| Driver depth report | First site of each run; required chip | Real time | — |

**Not used:** Open-Meteo. Its free API is for non-commercial use only, and Flake is a commercial product; the same models come straight from NOAA above. Planned for later phases (the snapshot and provider shapes already fit them): CoCoRaHS daily observer reports and airport station totals stored per lot, a one-tap depth report on Arrive (the existing `depth` action), and per-lot bias correction once a lot has several storms of forecast vs observed.

**GRIB2:** the NBM and HRRR files are read by `packages/providers/src/live/grib2.ts`, a small reader for exactly what these two models use (Lambert conformal grid, template 3.30; simple or complex packing with spatial differencing, templates 5.0 and 5.3). It was checked against NOAA's own station guidance at four snow-belt airports. Anything else it refuses, and the NWS grid carries on.

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
- **Salt runs (issue 204):** `salt_run`, one per service area, only for lots with salt in their signed contract. A lot's salt rule (company default plus per-lot changes, Settings, Snow triggers): snow at or over an amount (default: any measurable snow), freezing rain or ice (`iceAccumulation` > 0 in the next 12 h), and refreeze (snow down, melting above 32°F, then freezing within 18 h). Air temperature only; no free feed gives pavement temperature nationwide. Snow that already puts a lot on a plow alert isn't repeated as a salt run; that plow alert says "plow + salt". Older `refreeze` alerts are the same thing under its first name.
- **How sure (issue 203):** with a Blend run, each plow decision carries `confidence`: `certain` when the Blend's 10th percentile over the next 12 h reaches the trigger, `likely` at the 50th, `possible` below. A plow alert also fires when the Blend's 50th percentile reaches the trigger even if the NWS grid doesn't (marked "likely"). An alert is as sure as its least sure lot. Percentiles over 12 h are summed from the 6-hour windows, each counted for its part inside, which assumes the windows move together: close enough for "how sure", and labelled as model guidance.
- **Nowcast (issue 203):** during storms, HRRR's hourly snow and freezing rain replace the NWS grid's values for the hours HRRR covers (next 6 h); the rest stays NWS.
- **Fallback:** every new source is optional. When one is down, late or stale (Blend over 12 h old, HRRR over 3 h, radar over 2 h), the engine decides from the NWS grid exactly as before. New sources never trip the NWS circuit breaker.

## 4. Polling schedule
- `/api/cron/weather` every 15 min: for each distinct grid cell with an active site, enqueue `weather.fetch_cell` if (last fetch > 60 min) or (cell has forecast snow in next 24 h or an active alert and last fetch > 15 min).
- Alerts: every 15 min per tenant centroid.
- NOHRSC: every 6 h. Sample each active site and store a summary in the snapshot `{site_id: {h6, h24}}`.
- Blend (`weather.nbm`), queued hourly by `/api/cron/weather`: one pass samples every active lot, stored as one `nbm` snapshot `{cycle, windows[], sites: {site_id: {p10[], p50[], p90[]}}}`. Skipped when the newest run is already stored.
- HRRR (`weather.nowcast`) and radar (`weather.radar`), hourly, only while any cell has snow forecast within 24 h, an active alert, or a storm is running. One snapshot each for every lot. A new Blend or HRRR run re-checks every company's triggers.
- Lookups are batched: the newest run of each source is one query for every lot (as `latestGrids` is for the NWS grid, issue 185).
- Back off on 429/5xx with jitter. A circuit breaker pauses for 10 min after 5 consecutive failures and records "weather unavailable" on the dashboard.

## 5. Evidence archive
- Every fetch is gzipped raw → Storage `weather-archive/{source}/{key}/{fetched_at_iso}.json.gz`. Compute the sha256 of the raw bytes and store a row in `weather_snapshot` with summary {snow_next12h_in, snow_elapsed_in, alerts[], temp_f}.
- Snapshots are shared across tenants (public data) and never deleted (retain ≥ 7 years). The bucket has object lock / no delete policy for the app role.
- Blend, HRRR and radar fetches archive a JSON record rather than the raw national GRIB fields (about 6 MB per Blend run, which would fill the free storage plan within weeks): the exact file URLs and byte ranges read, each field's SHA-256, and every value sampled. The `weather_snapshot` sha256 is of that record.
- A storm records `forecast_snapshot_ids` at start and at close. Visits link to the nearest snapshot by time and cell.
- The proof packet prints the source URL, fetched_at, Last-Modified, sha256, and the summary values for each referenced snapshot, plus the plain-language caveat: "Forecast values are National Weather Service gridded forecasts as retrieved at the time shown; observed totals are NOHRSC analyses, which may be revised for up to 5 days."

## 6. Mock mode
`MockWeatherProvider` replays fixtures: `fixtures/weather/lakewood-lake-effect-2025-12.json` (a synthetic 3-day event: 0.5", 3.2", 1.1"), `quiet.json`, `refreeze.json`. Clearly label them synthetic. A dev page `/dev/weather` lets you advance a fake clock to fire triggers; its poll also runs the Blend, HRRR and radar. Mock Blend percentiles are built around the fixture (10th = half, 50th = the fixture, 90th = 1.6 times), mock HRRR is the fixture's own hours, mock radar a tenth of its snow as liquid, so "likely" and "certain" both show. CI never calls NOAA; the GRIB2 reader is tested on two small real HRRR files in `packages/providers/test/fixtures-grib/`.
