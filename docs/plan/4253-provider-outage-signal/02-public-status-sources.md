# 02 — Public status sources

**Depends on:** 01-gateway-call-outcomes
**Part of:** Users see when a model provider is down — see [README](./README.md)

## Context

The gateway signal needs traffic: a provider that nobody called in the last 5 minutes has no window.
This slice adds the public sources that need no key, as a second signal in the same evaluate job.
For Curve Bender and IBM LiteLLM it adds "unreachable" from the proxy's readiness; for Anthropic, OpenAI and Bob it adds the provider's own status and a link to its status page.

## Implementation plan

Apply `/typescript-engineering`.
The mapping rules are in [README — Detection](./README.md#detection).

1. **Sources** (checked 2026-10-15, all without a key):

   | Templates                      | Request                                             | Signal                                                                                                                                             | Status page                  |
   | ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
   | `curve-bender`                 | `GET https://{CURVE_BENDER_HOST}/health/readiness`  | not 200, timeout, or `status` ≠ `healthy` → reason `unreachable`                                                                                   | none                         |
   | `ibm-litellm`                  | `GET https://{IBM_LITELLM_HOST}/health/readiness`   | same                                                                                                                                               | none                         |
   | `anthropic`, `anthropic-oauth` | `GET https://status.claude.com/api/v2/summary.json` | component "Claude API (api.anthropic.com)" (both) or "Claude Code" (`anthropic-oauth`) in `partial_outage` or `major_outage` → `provider-reported` | `https://status.claude.com`  |
   | `openai`                       | `GET https://status.openai.com/api/v2/summary.json` | component "Chat Completions" or "Responses" in `partial_outage` or `major_outage` → `provider-reported`                                            | `https://status.openai.com`  |
   | `bob`                          | `GET https://status.bob.ibm.com/api/v1/status`      | region `us-east`, service "Chat/Code Completion", status not `operational` → `provider-reported`                                                   | `https://status.bob.ibm.com` |

   Take the proxy hosts from the contract constants `CURVE_BENDER_HOST` and `IBM_LITELLM_HOST` instead of writing them again.
   Bob's region is the one in `BOB_HOST` (`api.us-east.bob.ibm.com`), so read `us-east` from there.
   Match components by name; a missing component gives no signal.
   Bob's API is not documented, so a changed shape must give no signal, never an error that stops the job.

2. **Infrastructure** `infrastructure/public-sources.ts`: one fetcher per source with a 5-second timeout, returning the parsed body or `null`.
   Parse with Zod schemas that accept extra fields.

3. **Domain** `domain/public-signals.ts`: pure functions from a parsed body to the signals per template.
   Extend `nextSnapshot` in `domain/status.ts`: a template is degraded when the gateway or a public source says so; the reason is `failing-calls` when the gateway says so, else the public reason.
   A public signal never makes the DAM-side state.

4. **Only providers in use.** Add a port `listConnectedTemplates(): Promise<string[]>` to the service deps.
   The adapter in `bootstrap.ts` reads the distinct template ids of provider Connections in the install (through the connections module's public API; add a small read there if none exists).
   Fetch only the sources whose templates are in that list.

5. **Status page link:** set `statusPageUrl` on every outage of a template that has a status page, whatever its reason.

6. **Job:** `evaluate(now)` runs the fetches in parallel, then builds the snapshot.
   Log each source's result once per run at debug level, and a warning when a source fails three runs in a row.

7. **Docs:** `docs/architecture/provider-status.md` gets the section on public sources, with the table above and the rule that a source gives a signal only when it answers.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/api-server:test` pass.
- [ ] With every source healthy, the snapshot has no outages.
- [ ] A proxy readiness that times out lists its template with reason `unreachable`.
- [ ] A Statuspage component in `degraded_performance`, or an overall indicator of `minor`, lists nothing.
- [ ] A source that fails or returns an unknown shape gives no signal, and the other sources still count.
- [ ] Sources of templates with no Connection in the install are not fetched.
- [ ] Every Anthropic, OpenAI or Bob outage carries its `statusPageUrl`.

## Smoke test

On the dev cluster, with the api-server image rebuilt:

1. With the IBM VPN on, `providerStatus.list` has no outages, and the api-server debug log shows one result per source in use.
2. Turn the VPN off and send nothing: within about 2 minutes, `ibm-litellm` (and `curve-bender`, if the install has its Connection and the host needs the VPN) is listed with reason `unreachable`, with no gateway traffic.
3. Turn the VPN on: within about 2 minutes, the outage is gone.

Print a short guide so Petr can repeat steps 2–3 by hand.
