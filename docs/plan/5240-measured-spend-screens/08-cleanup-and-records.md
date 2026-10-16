# 08 — Clean-up and records

**Depends on:** 04-session-stamp, 07-agent-metrics-and-cli
**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

After slices 01–07, no screen and no agent reads a spend figure from telemetry, except the earlier-estimates view.
This slice removes the cost from the Model Router's own record (decision 9), so the telemetry store does not hold a second cost for one call.
It makes the proxy cost cross-check work on IBM LiteLLM (decision 13), writes the ADR that amends the spend part of ADR-098 (decision 8), and brings the architecture pages and the glossary in line.

## Implementation plan

Apply `/typescript-engineering`.

1. **The router's record without a cost** in `packages/agent-runtime/src/modules/model-router/`:
   - `services/model-router.ts`: remove `costUsdMicros` and `providerReportedCostUsd` from `ModelCallRecord` (lines 40–58) and from `record()` (lines 291–332); remove the read of `x-litellm-response-cost` (around lines 294–296); remove the `"unpriced"` reason from `uncounted`, and keep `"error"` and `"no-usage-event"`.
   - `infrastructure/call-exporter.ts` `otlpLogRecord` (lines 75–114): stop sending `cost_usd_micros` and `platform.provider.reported_cost_usd`.
   - `domain/usage.ts`: remove `costUsdMicros` when nothing uses it; keep the usage parser, because the record keeps the token counts.
   - Keep the model catalog's price table (`model-catalog/infrastructure/model-prices.json`): the harness catalogs (Bob's model info, Pi's provider metadata) still show its prices.
2. **Dead telemetry reads:** remove `metrics.sessionCosts` (contract, service, reader) and every other read that nothing calls after slices 06 and 07.
   Keep what the earlier-estimates view (`metrics.spendBreakdown`) and the per-call rows (`metrics.overview`'s `contextPerCall`, `get_metrics` `call`) need.
   The agent-runtime's `sessions.spend` and the session list's `spend` field (Bob's own count): remove them only when nothing reads them; else leave them and say so in the commit body.
3. **The proxy cost cross-check** (decision 13):
   - `packages/controller/pkg/reconciler/envoy_spend_meter.go` (`spendRecordAccessLog`, line 46): log `x-litellm-response-cost-original`, `x-litellm-response-cost-discount-amount` and `x-litellm-response-cost-margin-amount` next to `x-litellm-response-cost`.
     Bump `envoyBootstrapTemplateRev` again.
   - `packages/api-server/src/apps/ext-authz/spend-records.ts`: read all four headers into the record.
   - `packages/api-server/src/modules/spend/domain/cost.ts`: the proxy's cost is `x-litellm-response-cost` when it is present and above 0; else `-original − -discount-amount + -margin-amount` when `-original` is present and above 0 (a missing discount or margin counts as 0); else none.
     `proxyCostDifference` compares that cost with ours.
   - `packages/api-server/src/modules/spend/services/spend-ingest.ts` (around lines 198–212): check only a final record in unit `usd` with no cache read and no cache write (all cache counts and OpenAI's cached tokens are 0); log `spend.proxy_cost_mismatch` with the provider, the model, our cost, the four header values and the token counts.
4. **The ADR.** Use the `/adr` skill.
   - Number: the next free one in `docs/adrs/index.md`; owner `@PetrBulanek`; `subsystem: spend-limits`; no `supersedes` (that would mark all of ADR-098 superseded).
   - Thesis, agreed with Petr: "The Model Router stamps each model call that it forwards with the session and the harness, and the gateway meter records them with the call.
     Every spend figure comes from the meter, per session too; the session split is for display only, and the router's own record carries no cost."
   - The body says that it amends the spend part of ADR-098: the router's record is no longer the spend source per session, and the spend reader no longer prefers it for any spend figure.
   - The decision covers the parts that make the stamp work for every routed harness: Pi's extension sends its session id, and the router maps a terminal session's harness id back to our session id.
   - Consequences with evidence: one usage parser for spend instead of two; the session parts add up to the trusted total, with the sub-agents under the session that spawned them; calls that skip the router (Bedrock, a custom template's own harness) still count, with no session; `claude -p` runs inside the agent count as no session; the agent's pod writes the session directory, so the ingest check turns a session that the agent never reported into no session but does not stop a deliberate agent from adding rows under itself; telemetry keeps the per-call rows; the session key multiplies the ledger's rows by the sessions of a day (local measure 2026-10-16: a median of 1 new session per agent per day, at most 26).
   - Run `mise run //docs:fix:adr-index`.
     Never link the ADR from code or from other docs.
5. **Architecture pages and glossary** (Simplified Technical English, one sentence per line, `Last verified:` bumped, `mise run fix:markdown`):
   - `docs/architecture/harness-config.md` § The Model Router: the router reports each call once on the telemetry rail with its tokens, Connection, model, dialect, harness and session, without a cost; it stamps the session and the harness on the forwarded call.
     Replace "the source of [spend](metrics.md)".
   - `docs/architecture/observability.md` (signals, around lines 87–98): the router's record has no cost; the spend figures read the meter; telemetry keeps Claude Code's and Pi's own cost for the earlier estimates.
     Do not grow the page (doc-size cap).
   - `docs/architecture/metrics.md`: § Overview, § Telemetry reader and § Trust story describe telemetry as the source of the earlier-estimates view and of the per-call rows only; Metered Spend is the source of every spend figure.
   - `docs/architecture/spend-limits.md`: § Overview (the harness's reported spend serves only the earlier estimates), § Prices "When a cost is fixed" (the cross-check rule), and § Screens (final check).
   - `docs/ubiquitous-language.md`: the Metered Spend row no longer contrasts with a reported "Spend under Metrics" on the screens.
6. Run the `doc-drift` skill on the branch and fix what it finds.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass for `agent-runtime`, `api-server`, `api-server-api`, `controller` and `docs` (ADR index and doc size).
- [ ] A router record in the telemetry store has token counts and no `cost_usd_micros`.
- [ ] Bob's and Pi's model pickers still show prices.
- [ ] An uncached, non-streamed IBM LiteLLM call logs no `spend.proxy_cost_mismatch`; with a wrong operator price set for that model, it logs one with the four header values.
- [ ] A cached call is never checked.
- [ ] The ADR follows the `/adr` skill's rules and the index lists it.

## Smoke test

1. Rebuild every image (the gateway bootstrap changed again) and deploy on the local cluster; turn on the IBM VPN.
2. From an agent pod, send one non-streamed call without cache to IBM LiteLLM through the gateway (the Connection placeholder as the credential); read the api-server log: no mismatch line.
3. Set a wrong operator price for that model in the chart values for a moment, redeploy the api-server, repeat the call: one `spend.proxy_cost_mismatch` line with the header values; then restore the price.
4. If the telemetry store is on, check one `platform.model_call` record in ClickHouse: no `cost_usd_micros`.
5. Run the whole-feature smoke test in the [README](./README.md#whole-feature-smoke-test).

Print a short manual guide for Petr with these steps.
