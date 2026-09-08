# ZAP scan of the dev deployment

Headless [ZAP](https://www.zaproxy.org/) 2.17 run against `dam-dev`, driven by the Automation Framework.

```
./scan.sh            # crawl + API seed + active scan, ~2 h
./scan.sh api        # one plan only
python3 cleanup.py   # delete what the last run created under the zap user (--all wipes the account)
```

Three plans, run in order:

- `crawl.yaml` — browser-based Keycloak login (`zap`/`zap`) and the AJAX spider over the UI; the UI talks tRPC over WebSocket only, so this is passive coverage.
- `api.yaml` — the same login through Keycloak's password grant, then one request per tRPC procedure over the HTTP transport (`/api/trpc/*`). `enumerate.mts` walks `appRouter` and samples each input schema; `gen-requests.py` writes the list into the plan. `e2e.*` and `egressRules.applyPreset` are excluded.
- `active.yaml` — the active scan over the seeded API context, throttled to 250 ms between requests (dev is shared).

Reports go to `reports/` (gitignored, only the latest run is kept). `cleanup.py` removes items that carry a sampler literal (`zap`, `zap-1`, `https://example.com/zap`, …) or a `createdAt` at or after `reports/started-at`; anything else under the zap account is listed and kept. The enumerator fails closed: an input pattern it has no sample for, or an empty router, aborts the run before `api.yaml` is rewritten. Known ZAP quirks: never set `failOnError: true` against a daemon (a failing job exits ZAP); call the API via `127.0.0.1`, not `localhost`; keep the chromedriver under `browsers/` on the same major version as the Playwright Chrome it drives. Boolean-based "SQL Injection" alerts on this API have so far always been false positives (two Zod validation errors compared as different pages). Host-header probes produce router 503s ("Application is not available"), not capacity problems.
