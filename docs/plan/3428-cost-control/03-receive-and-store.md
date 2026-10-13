# 03 — Receive, price and store usage

**Depends on:** 01-gateway-meter, 02-price-table
**Part of:** Cost control — see [README](./README.md)

## Context

This slice receives the gateway's spend records in the api-server, prices each call when it arrives, and keeps the ledger: a daily rollup in Postgres and day counters in Redis.
It replaces periodic records with the final record of the same call.
It estimates calls with missing usage, and calls with no record at all.
It closes the record streams cleanly when the api-server stops.
At the end of this slice, DAM has a trusted metered spend for every model call, but no limits yet.
A first read (`spend.daily` and `dam spend daily`) makes the slice verifiable.

## Implementation plan

Apply `/typescript-engineering`.
Server code goes into the `spend` module (`packages/api-server/src/modules/spend/`) and the ext-authz app (`packages/api-server/src/apps/ext-authz/`).

1. **Access-log proto.**
   - Add `packages/api-server/proto/accesslog.proto`, a hand-trimmed subset of Envoy's `envoy.service.accesslog.v3` and `envoy.data.accesslog.v3`.
     Follow `external_auth.proto`.
   - Keep only what the receiver reads:
     - `StreamAccessLogsMessage` (`identifier`, `http_logs`);
     - `HTTPAccessLogEntry` (`common_properties`, `request`, `response`);
     - in `AccessLogCommon`: `start_time`, `metadata` (`filter_metadata` as a map to `google.protobuf.Struct`) and `access_log_type`;
     - the request path and authority, the response code, the response flags and the response headers.
   - Copy the field numbers exactly from the Envoy 1.39.2 protos.
   - Extend `packages/api-server/.mise/tasks/fix/proto` to generate both files.
     Today it names only `external_auth.proto`.
2. **AccessLogService** in a new file next to `apps/ext-authz/grpc.ts`.
   - Register it with `server.addService` on the same `grpc.Server`, before `bindAsync`.
   - Find the agent from `call.getHost()` with the same `parseInstanceFromAuthority` as ext_authz.
     Refuse a stream whose authority does not parse.
   - For each entry, read the `platform.spend` metadata.
     Skip entries that are not billable.
   - Read the path from the metadata, not from the entry's own request path.
     The entry's request path keeps the query, and the meter's path has no query and no Connection address prefix.
   - A call that the gate refuses also sends a billable record, because the meter runs before the gate.
     Envoy marks that entry with the response flag for an external-authorization refusal.
     Do not count such a record as a call or as spend: the gate counts its own refusals (slice 04).
   - Give the spend ingest service one record: agent, call id, payer, address Connection, path, dialect, status, raw counts, model, tier, reply bytes, `complete`, the cost header, and whether the entry is periodic or final (`access_log_type`).
3. **Ingest service** (spend module, services layer).
   - **Payer and owner:** the payer is the record's `payer` (the root driver).
     Find the owner with a port that `bootstrap.ts` wires to `agentsRepo.resolveIdentity`.
   - **Connection:** with a port to the connections module.
     Use the address Connection when the record has one.
     Otherwise use the one Connection of the agent's grants whose injection host is the request authority.
     Cache the agent's metered Connections for 30 seconds.
     When no Connection matches (for example, a grant was removed while the call ran), log a warning, and keep the record under the Connection id `unknown` in the unit `usd`, priced as `estimate`.
     The cost then still counts for the agent and the owner.
   - **Unit:** from the Connection's template, with the README's table.
   - **Usage:** map the raw counts to the normalized usage of slice 02.
     OpenAI counts cached tokens inside the prompt tokens: subtract them.
     When `complete` is false or a count is missing, estimate the missing output tokens from the reply bytes (bytes ÷ 3), and mark the call estimated.
   - **Price:** call the slice 02 lookup and formula.
     A source of `estimate` also marks the call estimated.
   - **Deltas:** keep the last applied amounts of each call in Redis (a hash per call id, TTL 2 hours).
     Apply only the difference between the new record and the last applied amounts.
     A periodic record and the final record of one call then add up to the final amounts.
     Count the call once, on its first record.
     Apply one record in one Redis transaction, so that two api-server replicas never apply the same difference twice.
   - **Proxy cost check:** when the final record has the cost header, compare it with slice 02's function.
     Above 5%, log a warning with the provider, the model, our cost and the header cost.
   - On the final record, remove the call from the in-flight set (step 6).
4. **Postgres `spend_daily`** in `packages/db/src/schema.ts`, exported from `packages/db/src/index.ts`.
   - Key: UTC day, payer agent id, Connection id, model.
   - Columns: owner sub, provider template, unit, cost in micro-units, uncached input, output, cache read, cache write 5 minutes, cache write 1 hour, web searches, calls, estimated calls, refused calls (slice 04 fills it), and the highest single-call cost.
   - An index on owner and day.
   - No foreign key to `agents`: a deleted agent's spend still counts for its owner today.
   - Writes are additive upserts of the deltas, and `GREATEST` for the highest single-call cost.
   - Generate the migration with `mise run //packages/db:generate`.
     It takes the next free number.
     Add the `-- why` line at the top, as `packages/db/AGENTS.md` asks.
5. **Redis day counters** (spend module, infrastructure).
   - Keys for today, in micro-units: per payer agent and unit, per owner and unit, and per payer agent and Connection.
     TTL 48 hours.
     Follow the key style of `core/ttl-store.ts`: a `spend:` prefix.
   - INCRBY after the Postgres write.
   - When a key for today is missing, rebuild it from `spend_daily`, and set it only if it is still missing.
     If the Redis write fails, log it and delete the key, so that the next read rebuilds it.
   - These are the first counters in the api-server.
     Keep them inside the spend module.
6. **Calls with no record.**
   - The ext_authz gate gets a spend port (`packages/api-server/src/modules/approvals/services/ext-authz-gate.ts`), wired in `bootstrap.ts`.
     After identity, for a billable path on a metered Connection host, the gate tells the spend module that the call started.
     It uses the `x-platform-call` header that slice 01 sets.
     The spend module owns the billable-path rules in TypeScript.
     Keep them the same as the meter's rules in slice 01.
     In this slice the port never refuses.
     Slice 04 adds the verdict to the same port.
   - The spend module adds the call to a Redis sorted set of calls in flight, with the start time.
   - A periodic job (`core/periodic-jobs.ts`), every 5 minutes, takes the calls that started more than 60 minutes ago:
     - with a periodic record: finish the call from its last counts, and mark it estimated;
     - with no record at all: count it as the highest single-call cost of that payer and Connection today, and mark it estimated.
   - Store the estimate as the call's last applied amounts.
     If the real final record arrives later, the delta corrects the estimate.
7. **Clean shutdown** in `packages/api-server/src/index.ts`.
   - Today `extAuthzGrpcServer.tryShutdown` is not awaited.
   - On SIGTERM, first end every open access-log stream with an OK status, so that Envoy reconnects to another replica and loses no record.
     The test of 2026-10-13 lost 0 records in this case.
   - Then await `tryShutdown` with a deadline of 20 seconds, then `forceShutdown`.
8. **First read.**
   - Contract: a new module `packages/api-server-api/src/modules/spend/` with `router.ts` and a browser-safe `schemas.ts`.
     Add `spend.daily({ agentId?, from, to })` as pinned in the README: metered spend per UTC day, payer agent and unit, with the count of estimated calls.
     Owner-scoped: an agent id must be one of the caller's agents.
     Mount it in `packages/api-server-api/src/router.ts`.
   - CLI: a new group `packages/cli/src/modules/spend/` with `dam spend daily [agent] [--days N] [--json]`.
     Follow `packages/cli/src/modules/metrics/` and `connection/`.
9. **Docs** (same commit):
   - `docs/architecture/spend-limits.md`: sections "Ledger" (rollup, counters, deltas, cost at call time) and "Estimates" (the three cases), and the shutdown rule.
   - `docs/architecture/persistence.md`: the new table in the Postgres list, and that the api-server now keeps day counters in Redis.
   - `docs/architecture/metrics.md`: say that Metered Spend exists, is trusted, and is a different number from the agent-reported Spend.
     Fix the two errors: the gateway stamps the agent, not the owner (around line 211); an agent can also report a negative cost (around line 208).
   - `docs/architecture/cli.md`: the `spend` group in "Command surface".
   - Bump `Last verified:` on each page, and run `mise run fix:markdown`.

## Acceptance criteria

- [ ] After a model call on the dev cluster, `dam spend daily <agent>` shows a non-zero cost within 5 seconds.
- [ ] The cost of one call matches the hand calculation of slice 02 within 1 micro-dollar, for a call with known token counts.
- [ ] A long Claude Code reply produces periodic records, and the final total equals the sum that Claude Code reports in tokens (input, output, cache read, cache write).
- [ ] A Pi call on IBM LiteLLM and a Codex call (Responses) are both counted.
- [ ] A Bob call (if a Bob Connection exists) adds Bobcoins, not dollars.
- [ ] A sub-agent's call counts for its root driver.
- [ ] `/v1/messages/count_tokens` calls are not counted.
- [ ] A restart of the api-server during a reply loses no record (`mise run cluster:kubectl -- -n <ns> rollout restart deploy/<api-server>` during a long reply).
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

On the dev cluster:

1. `mise run cluster:build -- controller api-server`.
   Wait for the gateways and the api-server.
2. The gateway log has no access-log errors any more.
3. In a Claude Code agent on IBM LiteLLM, send "Say hello in five words".
   Run `dam spend daily <agent> --json`.
   The cost is non-zero, and the estimated count is 0.
4. In Claude Code, read the turn's tokens in the session.
   Compare them with the ledger's tokens in `--json`.
   They are equal.
5. Send a prompt that makes a long answer (for example "write 3,000 words about rivers").
   While it streams, restart the api-server.
   After the reply ends, `dam spend daily` has the full call, not estimated.
6. Run the same prompt in a Pi agent and a Codex agent.
   Both appear in `dam spend daily`.
7. Read the api-server log for "proxy cost" warnings after a non-streamed call.
   There are none for IBM models with overrides.

Then print a short guide for Petr, so that he can repeat steps 3 and 5 by hand.
