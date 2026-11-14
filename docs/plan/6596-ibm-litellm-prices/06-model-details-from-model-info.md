# 06 — The catalogs read model details from model info

**Depends on:** 03-read-and-keep-ibm-prices
**Part of:** IBM LiteLLM calls priced from LiteLLM's own model info — see [README](./README.md)

## Context

This slice delivers #6488.
The owner model catalog and the Model Router list the IBM LiteLLM and CurveBender proxies through `/v1/models`, because in October their keys got 403 on every model-info route.
`/v1/models` carries no model details, so a model newer than the vendored LiteLLM table gets the preset's endpoint-wide defaults: `gemini-4-argon` runs on Pi with thinking off and a 200,000-token window, where the proxy's model info says it reasons and takes 1,048,576 tokens.
Every IBM and CurveBender key now reads `/v1/model/info`, and slice 03 already fetches it for prices.
This slice lists both proxies from model info, with `/v1/models` as the fallback for a key that is refused.

## Implementation plan

1. **Listing spec** — `packages/api-server-api/src/modules/model-catalog/provider-listing.ts`, `listingForTemplate`:
   - For `ibm-litellm` and `curve-bender`, use `path: "/v1/model/info"`, `shape: "litellm-model-info"` and `fallback: { path: "/v1/models" }` (the same pattern as the Bob listing), with today's `urlEnv` and `tokenEnv`.
     The preset's base URL is the proxy root, so the path joins without a doubled `/v1`.
   - Share the base of this spec with slice 03's `priceListingForTemplate`, so the price read and the catalog ask the same route the same way; the price read keeps `allModes`, and the catalog keeps today's chat-only filter.
   - Keep `/v1/models` for `curve-bender-deployment`.
     Its shared key reaches only an exact list of paths at the gateway (`CURVE_BENDER_DEPLOYMENT_PATHS` in `connections/domain/catalog.ts`), and opening model info there would show every agent the deployment details behind one shared identity.
   - Replace the comment that says IBM's keys get 403 on every model-info route with the current rule.
2. **Metadata** — `metadata.ts`, `layerMetadata`, needs no change: the provider layer already wins for limits, reasoning and vision.
   Check that a model-info entry without `supports_reasoning` still falls through to the table and the family list, as today.
3. **Model Router** — `packages/agent-runtime/src/modules/model-catalog/services/model-catalog.ts` uses the same `listingForTemplate`, so the router's catalog changes with it.
   The router lists through the agent's gateway, which adds the IBM key on the whole host and the own CurveBender key on the whole host, so `/v1/model/info` carries the key.
   Confirm on the local cluster that the gateway does not refuse the path.
4. **Docs**:
   - `docs/architecture/owner-model-catalog.md`, **Listing without an agent:** the LiteLLM proxies are listed from model info, with the model list as the fallback.
   - `docs/architecture/harness-config.md`, the model catalog part (the paragraphs on listing sources and on how each preset lists): replace "`/v1/models` for the LiteLLM proxies (IBM's virtual keys get 403 on every model-info route)" with the new rule, and keep the CurveBender deployment's exception.

Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] The owner catalog describes `ibm/gemini-4-argon` with reasoning on and a 1,048,576-token window, from the provider.
- [ ] The agent's Model Router answers `/v1/model/info` for harness `pi` with the same values for `ibm/gemini-4-argon`.
- [ ] A Pi session on `ibm/gemini-4-argon` with effort High shows High on the model chip, not Off.
- [ ] A key that gets 403 on model info is listed from `/v1/models`, with today's metadata.
- [ ] A CurveBender deployment Connection lists as today.
- [ ] `mise run //packages/api-server-api:check`, `mise run //packages/api-server:check`, `mise run //packages/agent-runtime:check` and `mise run //packages/agent-runtime:test` pass.

## Smoke test

With the IBM VPN on and the branch on the local cluster (api-server and agent runtime images rebuilt):

1. In Settings › Profiles, open the IBM proxy's models: `gemini-4-argon` shows reasoning and a 1,048,576-token window.
2. On a Pi agent with the IBM Connection, start a session on `ibm/gemini-4-argon`, pick High, and check the chip under the chat input.
3. Inside the agent, ask the Model Router for `/v1/model/info` with harness `pi`: `ibm/gemini-4-argon` has `supports_reasoning: true` and `max_input_tokens: 1048576`.

Then print a short manual guide for the user to repeat the three steps.
