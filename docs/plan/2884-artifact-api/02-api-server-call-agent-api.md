# 02: api-server `callAgentApi` mutation

**Depends on:** 01-runtime-relay
**Part of:** Artifact API, see [README](./README.md)

## Context

This slice adds the api-server hop: a tRPC mutation the host UI calls with the user's session. It
decides whether the artifact may call at all, works out the agent from the artifact (never from
the caller), wakes the agent, and relays to the runtime procedure from slice 01. It is where the
security rules of the feature are enforced; the UI gate in slice 03 is only a convenience.

## Implementation plan

Apply `/typescript-engineering`.

1. **Contract, `packages/api-server-api/src/modules/artifact-library/`.**
   - In `schemas.ts`: `artifactApiFailureReasonSchema` with the eight reasons from the README
     table, and `artifactCallAgentApiInputSchema` `{ artifactId, method, path, body?, contentType? }`.
     Reuse the method, path and body rules from `agent-runtime-api` (import the schemas or the
     constants; do not copy the limits).
   - The output type: `{ ok: true, status, contentType, body } | { ok: false, reason }`.
   - In `router.ts`: `callAgentApi: operateAgentsProcedure.input(...).mutation(({ ctx, input }) =>
     ctx.artifactLibrary.callAgentApi(input))`. Import `operateAgentsProcedure` from
     `../../auth-procedures.js`.
   - Export the new schemas and types from `src/index.ts`.
2. **Pod client, `packages/api-server/src/modules/artifact-library/infrastructure/`.** Add
   `agent-api-pod-client.ts` shaped like
   `packages/api-server/src/modules/kb-shares/infrastructure/kb-publish-client.ts`:
   `createAgentApiPodClient(namespace)` returning `{ request(agentId, input) }` over `httpLink` to
   `http://${podBaseUrl(agentId, namespace)}/api/trpc`, with a fetch timeout a little above the
   runtime's 30 s so the runtime's own `timeout` answer wins. Map a tRPC `NOT_FOUND` for the
   procedure to `unsupported-runtime`, and any other transport failure to `agent-unreachable`.
3. **Service, `services/artifact-library-service.ts`.** Add `callAgentApi(input)` to the service and
   its interface. Order of checks:
   1. Load the artifact through the owner-scoped repository. Missing, or owned by someone else →
      `not-allowed` (do not tell them apart).
   2. Require `kind === "html"`, `interactive === true`, `visibility === "private"`, and
      `agentId !== null`, else `not-allowed`.
   3. `ensureReady(agentId)`; a failure → `agent-unreachable`.
   4. `pod.request(agentId, { method, path, body, contentType })` and return its answer as is.
   - On every `not-allowed`, call `securityLog("warn", "authz.artifact_api_denied", …)` from
     `packages/api-server/src/core/security-log.ts` with the artifact id, actor and which check
     failed, in the same shape `trpc-proxy.ts` uses.
   - The feature flag is **not** checked here; it is progressive disclosure, not authorization.
4. **Wiring.** Extend `ComposeArtifactLibraryForOwnerOpts` in `compose.ts` with required
   `ensureReady: (agentId) => Promise<void>` and `agentApi: AgentApiPodClient` deps (required, not
   optional; callers that never relay pass a client that is still real). Pass them from every
   `composeArtifactLibraryForOwner` caller:
   `apps/api-server/trpc/context.ts` (use `agentsRepo.ensureReady` and `config.namespace`, as the
   kb-shares wiring right above it does), `apps/api-server/routes/index.ts`,
   `apps/harness-api-server/app.ts` and `bootstrap.ts`.
5. Agent-bound API keys: check `checkAgentBinding(ctx, artifact.agentId)` semantics the same way
   the other agent-scoped procedures do, so a key bound to agent X cannot relay to agent Y.

## Acceptance criteria

- [ ] `artifactLibrary.callAgentApi` exists, requires `agents:operate`, and takes an artifact id,
      not an agent id.
- [ ] A non-owned, missing, non-html, non-interactive, non-private, or user-uploaded artifact gives
      `{ ok: false, reason: "not-allowed" }` and a security log line, and never wakes an agent.
- [ ] An allowed call wakes a hibernated agent and returns the runtime's answer unchanged.
- [ ] A runtime without `artifactApi` gives `unsupported-runtime`; an unreachable pod gives
      `agent-unreachable`.
- [ ] `mise run //packages/api-server:check`, `mise run //packages/api-server-api:check`,
      `mise run //packages/api-server:test` and `mise run check:comment-types` pass.

## Smoke test

1. `mise run //packages/api-server:test` (existing suite stays green after the new required deps
   are wired).
2. On the dev cluster with slice 01 installed: get a UI access token, then call the mutation with
   curl against `/api/trpc/artifactLibrary.callAgentApi`:
   - for an interactive artifact your agent published, with `python3 -m http.server 5555 --bind
     127.0.0.1` running in the agent: expect `ok: true, status: 200`;
   - for a non-interactive artifact: expect `not-allowed`, and a `authz.artifact_api_denied` line
     in the api-server logs;
   - after stopping the server: expect `app-not-listening`.
