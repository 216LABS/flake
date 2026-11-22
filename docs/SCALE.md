# Scale: a 600-lot, 60-truck company (issue 228)

What a big firm's busy night needs to feel like, how it is measured, and the latest results.

## Targets

| What | Target |
| --- | --- |
| Storm board, first load | under 2.5 s |
| Storm board, each poll | under 500 ms p95 |
| Driver action API (Arrive, Done, photo) | under 300 ms p95 |
| Close storm and draft 3,000 visits | under 60 s, no function timeout |
| Queries | no N+1 on the board, billing or close (#185) |
| Lists | customers, route stops, billing review, proof history, receivables and the lot picker page or cap what they draw; still usable at 390 px |
| Weather and trigger crons | finish inside their time limits with 600 lots across many grid cells |

## How to run it

Both scripts are QA only. They refuse a non-local app, and the seed refuses any database but a local one unless
`LOAD_ALLOW_DB` names the exact host of a QA or preview database. Each one makes a new company of its own (`zz Load ...`
or `Load Plow ...`) and never touches the demo company or any real company. Neither uses `pnpm db:schedule`.

```
pnpm build && APP_ENV=test PROVIDERS_MODE=mock pnpm exec next start -p 3200
# The office side: 600 lots, 60 routes, 60 drivers, one storm with 5 passes = 3,000 visits and 6,000 photo rows.
pnpm tsx --env-file=.env.local scripts/load-seed.ts http://localhost:3200
# The driver side: 60 phones working 10 lots each at once while dispatchers watch, then close and bill.
pnpm tsx --env-file=.env.local scripts/load-storm.ts http://localhost:3200 60 10
```

## Results, Nov 22, 2026 (local laptop: one Next.js process, Postgres in Docker)

Office side, `load-seed.ts`, 3,000-visit storm:

| What | p50 | p95 | Target |
| --- | --- | --- | --- |
| Board first load (page) | 493 ms | 493 ms | 2,500 ms, met |
| Board poll (live API), one dispatcher | 296 ms | 329 ms | 500 ms, met |
| Board poll, 5 dispatchers at once | 1,083 ms | 1,097 ms | (one process) |
| Close storm, then draft 600 bills from 3,000 visits | 7.5 s total | | 60 s, met |
| Billing review, 600 bills | 498 ms | | |
| Dashboard, Reports, Profit per lot | 170 to 250 ms | | |
| Customers, proof, receivables, settings | 30 to 65 ms | | |

Driver side, `load-storm.ts 60 10` (60 phones at once, 600 lots, 1,200 photos):

| What | p50 | p95 | Target |
| --- | --- | --- | --- |
| Driver actions, 60 phones at once | 280 ms | 392 ms | 300 ms, see below |
| Driver photo, 60 phones at once | 301 ms | 436 ms | |
| Driver actions, one phone | 17 ms | 25 ms | 300 ms, met |
| Driver photo, one phone | 22 ms | 36 ms | |
| Board poll while 60 phones post | 1,128 ms | 1,224 ms | 500 ms, see below |
| Close, draft and approve 600 | about 1.5 s each; 600 billed in 46 s | | |

No visit, photo, bill or message was lost or doubled, and no job died.

**What the two misses mean.** One request costs 17 to 36 ms. With 60 phones and the board all hitting one local process,
requests wait for each other on one CPU, which is where 392 ms and 1.2 s come from. On Vercel each request at the same
moment gets its own function instance, so this queueing doesn't happen the same way. The next step is the same run
against a preview deploy with its own QA database (`LOAD_ALLOW_DB`), which is the environment the targets are for.

## What was slow, and what changed

- **The branch policies ran a lookup per row.** The first branch migration (20261122120000) checked each visit's branch
  with a function call, even for an owner with no branch limit: the board's visit read took 155 ms in the policy alone
  instead of under 1 ms. 20261122130000 asks once per query whether the member is limited at all. Board read: 580 ms to
  205 ms.
- **The board matched stops, visits and photos by scanning.** With 3,000 of each, every stop scanned every visit and every
  visit scanned every photo count, about 9 million comparisons. They are now looked up by key.
- **Photo counts were fetched by a list of 3,000 visit ids.** Now by the storm.
- **Indexes added** (20261122120000): run stops by run and order, visits by storm and lot and by run stop, photos by visit,
  driver actions and positions by run and time, bills by storm and status, customers by company and date, lots by
  customer.
- **Lists.** Billing review shows 100 bills at a time with "Show the next 100" (Approve and the filters still cover all of
  them). Past proof packets page 20 at a time. Receivables page 100 bills at a time, with totals over all. Customers
  already paged; the lot picker already draws at most 60 matches.

## Not done yet

- The run against a preview deploy, above.
- The routes editor still draws every route's lots at once. At 600 lots it loads in about 200 ms on the server; the
  drag-and-drop list is the part to watch on an older phone.
- The board's poll returns about 1.4 MB for a 3,000-stop storm. It could send only what changed since the last poll.
- Weather and trigger crons with 600 lots across many grid cells weren't timed in this run (the seed spreads lots over
  many cells, but the crons need the scheduler, which these scripts don't start).
