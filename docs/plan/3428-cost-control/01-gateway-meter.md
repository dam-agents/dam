# 01 — Gateway meter and ADR-104

**Part of:** Cost control — see [README](./README.md)

## Context

This slice puts the trusted spend meter into each agent's gateway.
On every model-provider chain, the gateway gives each call a call id, removes `accept-encoding`, reads the usage in the reply with a Lua filter, and sends one record per call to the api-server through a gRPC access log.
The api-server receiver comes in slice 03, so in this slice the records are refused by the api-server and are lost.
That is expected.
The slice also records the decision in ADR-104.

The meter design was tested on 2026-10-09 and 2026-10-13 (research page, sections "Test of the meter" and "Records lost when a gateway restarts").
The test files of that spike are gone.
The Lua code is new, but the rules below come from the tested spike.

## Implementation plan

Apply `/adr` for step 1.
The controller is Go: run its tasks with `mise run //packages/controller:<task>`.

1. **ADR-104.**
   Use the `/adr` skill.
   - Number 101: 098 belongs to open PR #4620, and 099 and 100 are on main.
   - Status accepted, owner `@PetrBulanek`, date 2026-10-13 (Petr approved it on that day).
   - Thesis: "DAM measures model spend in each agent's gateway and enforces spend limits there.
     The spend that a harness or an in-pod component reports stays for display only."
   - Context: no trusted meter exists; Claude Code's cost is agent-reported, optional and wrong for unknown models; Codex and Pi report none.
   - Decision: the Lua response meter with a gRPC access log to the api-server; a daily ledger in Postgres with Redis counters; the layered price lookup; soft owner limits that refuse and ask, and a hard operator ceiling; a refusal shaped by API path.
   - Alternatives: a Cortex ext_proc meter (breaks requests above 1 MB, keeps records in memory); harness telemetry; provider-side key limits; stopping the agent; the Model Router's record.
   - Consequences: each gateway restarts once at the upgrade; Lua is hard to test in this repo; a reply that already streams finishes after a limit.
   - Relation to the Model Router: the in-pod router's record (PR #4620, ADR-098 if it merges) gives the per-session split for display; the gateway meter gives the totals for limits; one price table in the api-server.
   - Run `mise run //docs:fix:adr-index` to regenerate `docs/adrs/index.md`.
2. **Mark model-provider chains** in `packages/controller/pkg/reconciler/envoy.go`.
   - Connection Secrets carry the annotation `agent-platform.ai/secret-purpose: connection:<templateId>`.
     The api-server writes it (`packages/api-server/src/modules/secret-store/infrastructure/k8s-secret-store.ts`, `connections-service.ts`).
     The controller does not read it today.
   - Read it in `expandConnectionSecret`, and keep the template id on `envoyCredential` and `envoySigner`.
   - Add a Go set of the metered provider templates: `anthropic`, `anthropic-oauth`, `openai`, `ibm-litellm`, `curve-bender`, `bob`, `bedrock`.
     It mirrors `PROVIDER_TEMPLATE_IDS` in `packages/api-server-api/src/modules/connections/providers.ts`.
     `custom-header` is not metered.
   - A chain is a model chain when any of its credentials or signers comes from a metered template.
     Add a method on `envoyHostChain` for this, next to `ConnectionIDs()`.
   - Add the purpose to the `envoySecretsRev` hash, so that a changed purpose re-renders the gateway.
   - Bump `envoyBootstrapTemplateRev`, so that every gateway rolls once and gets the meter.
3. **The meter filter** in a new file `packages/controller/pkg/reconciler/envoy_spend_meter.go`.
   Follow `envoy_connection_address.go`: the Lua script is a Go string constant, rendered with per-gateway values.
   One `envoy.filters.http.lua` filter, named `spend_meter`.
   - **Position** in `buildChainHTTPFilters` (`envoy_bootstrap.go`): on model chains only, directly after `connection_address` and before `ext_authz`.
     So the request part runs after the address step and before the gate.
   - **`envoy_on_request`:**
     - Create a call id that the agent cannot set and that does not repeat across workers or restarts.
       For example: time in milliseconds, a per-worker random seed made from `tostring({})`, and a counter.
     - Replace the request header `x-platform-call` with it.
       The gate reads it in slice 03.
     - Remove `accept-encoding`.
       Without this, Anthropic sends compressed streams, and the meter reads 0 tokens.
     - Write the dynamic metadata namespace `platform.spend`: `call_id`; `conn` (the `x-platform-conn` value, if any); `payer` (the attribution id that the controller renders for this gateway, which is the root driver for an Invocation target); `path` without the query; `dialect`; `billable`.
   - **Billable paths** (match the end of the path, so a path prefix or `/inference` for Bob does not matter):
     - `…/v1/messages`, but not `…/v1/messages/count_tokens`;
     - `…/chat/completions`;
     - `…/responses`, but not `…/responses/<id>`;
     - `…/embeddings`;
     - Bedrock `…/model/<id>/invoke`, `…/invoke-with-response-stream`, `…/converse`, `…/converse-stream`.
     - Every other path is not billable: model lists, account and key paths.
   - **`envoy_on_response`:** read the status and the content type.
     Iterate `bodyChunks()`.
     This passes each chunk through at once and does not buffer the reply.
     - Keep a small tail of the last chunk, so that a number cut between two chunks is read correctly.
       The spike used chunks down to 5 bytes.
     - Read only inside `"usage":{…}` objects.
       Text from the model is inside JSON strings, where quotes are escaped, so it cannot fake a usage object.
     - Formats: Anthropic SSE (`message_start` and `message_delta` usage) and JSON; OpenAI Chat SSE (the final usage chunk) and JSON; OpenAI Responses SSE (`response.completed`) and JSON; the Bedrock event stream (base64 payloads in binary frames).
       That is 7 formats.
       The meter decides by the content type, because a streamed request can get a JSON reply.
     - Fields: input, output, cache read, cache write total and its 5-minute and 1-hour parts (`cache_creation.ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`), OpenAI cached tokens (`prompt_tokens_details.cached_tokens`, `input_tokens_details.cached_tokens`), `server_tool_use.web_search_requests`, the count of `"type":"web_search_call"` output items, Bob's `credits`, `service_tier`, and the reply's `model`.
     - Keep the raw numbers and the dialect.
       Do not compute "uncached input" in Lua: slice 03 does that.
     - Update `platform.spend` after each chunk that changes a count, so that a periodic record has the current counts.
     - At the end, write the total reply bytes and `complete`: true only when the format's end event arrived (`message_stop`, `[DONE]`, `response.completed`, or a complete JSON body).
4. **The access log** in `buildTerminatingChain` (`envoy_bootstrap.go`), on model chains only.
   - Today `hcm["access_log"] = hcmAccessLog(...)` replaces the list.
     Change it to add to the list.
   - Add an `envoy.access_loggers.http_grpc` logger:
     - `common_config`: `log_name: spend`, `transport_api_version: V3`, `buffer_size_bytes: 0` (no batching), and `grpc_service.envoy_grpc` with `cluster_name: ext_authz_cluster` and `authority: <ExtAuthzHost>`.
       This is the same cluster and authority as the ext_authz filter.
       The api-server finds the agent from the authority, and the mesh policy already lets only this gateway call it.
     - `additional_response_headers_to_log`: `x-litellm-response-cost`.
     - A filter that keeps only entries whose `platform.spend.billable` metadata is true.
   - Set the chain HCM's `access_log_options.access_log_flush_interval: 2s`.
     Envoy then sends a periodic record every 2 seconds while a call runs.
   - Give the existing stdout and OpenTelemetry loggers on model chains a log-type filter that excludes periodic records.
     Their output then stays as it is today.
   - Add `x-platform-call` to the virtual host's `request_headers_to_remove`, next to `x-platform-conn`.
     The header never reaches the provider.
5. **Existing tests.**
   Run `mise run //packages/controller:test`.
   If a filter-order assertion breaks, for example in `envoy_connection_routes_test.go` or `envoy_test.go`, update the assertion.
   Do not add new tests.
6. **Docs** (same commit):
   - New page `docs/architecture/spend-limits.md` with `Last verified:`, an Overview (trust model, the parts, the diagram from the README in short form) and a "Meter" section.
     Write at the level of the architecture: what the meter reads, why it removes `accept-encoding`, why it reads only usage objects, the record path and the periodic records.
     No file paths, no field names.
     Add the page to the index in `docs/architecture.md`.
   - `docs/architecture/credential-gateway.md`: model-provider chains get the meter and lose `accept-encoding`; the gateway sends spend records to the api-server.
     Link to `spend-limits.md` for the depth.
   - `docs/architecture/observability.md`: correct the sentence that says that the gateway stamps the invocation id "on every route out".
     The terminating per-host chains do not stamp it.
   - `docs/ubiquitous-language.md`: start a "Spend Limits (bounded context)" section with **Metered Spend** only.
     Later slices add the other words.
   - Run `mise run fix:markdown`.

## Acceptance criteria

- [x] ADR-104 exists with the thesis above, and the ADR index is regenerated.
- [x] A gateway of an agent with an IBM LiteLLM Connection has, on that host's chain, the filter order `connection_address`, `spend_meter`, `ext_authz`, then the existing filters.
- [x] A chain of a non-provider Connection (for example GitHub) has no `spend_meter` and no gRPC logger.
- [x] The model chain's HCM has the gRPC logger with `buffer_size_bytes: 0`, the 2-second flush interval, and the existing loggers with the periodic filter.
- [x] `x-platform-call` and `accept-encoding` never reach the provider.
- [x] Model calls through the gateway work as before, streamed and not streamed, for Claude Code and Pi.
- [x] `mise run //packages/controller:check`, `mise run //packages/controller:test` and `mise run check` pass.
- [x] `mise run check:comment-types` passes.

## Smoke test

On the dev cluster (`cluster-ops`):

1. `mise run cluster:build -- controller`.
   Wait until the gateways roll (the gateway pod's AGE resets).
2. Read the rendered bootstrap of one agent with an IBM LiteLLM Connection: `mise run cluster:kubectl -- -n platform-agents get configmap <agent>-envoy-bootstrap -o yaml`.
   This is the dev cluster, so this read is allowed.
   Find the chain of the IBM LiteLLM host, and check the filter order, the logger and the flush interval.
   Find a chain of a non-provider Connection, and check that it has none of them.
3. Send a prompt to a Claude Code agent and to a Pi agent on that Connection.
   Both answer as before.
4. Read the gateway's log: `mise run cluster:kubectl -- -n platform-agents logs <agent>-gateway-0`.
   It shows that the access-log stream to the api-server fails with "unimplemented".
   This is expected until slice 03.

Then print a short guide for Petr, so that he can repeat steps 2 and 3 by hand.
