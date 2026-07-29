# 02 — Spawn resolves root Driver and stamps the target

**Depends on:** 01-gateway-attribution-override
**Part of:** Invocation spend attribution — see [README](./README.md)

## Context

With the CRD field and gateway plumbing in place (01), this slice makes the api-server
set it: every Invocation spawn resolves the root Driver and writes its id into the target
Agent's spec, so the target's gateway attributes all its telemetry to the root Driver
from the first exported record. An unresolvable chain fails the spawn closed. Apply the
`/typescript-engineering` skill throughout.

## Implementation plan

1. **Service-only create field.** In
   `packages/api-server-api/src/modules/agents/types.ts` (the `AgentCreateInput`
   intersection around `:109-117`, next to the pre-minted `id`), add
   `telemetryAttributionId?: string`. Do **not** touch
   `packages/api-server-api/src/modules/agents/schemas.ts` — the field must not be
   wire-settable (a caller could otherwise forge attribution onto an agent they do not
   drive; see README conventions).
2. **Write it into the CR spec.** In
   `packages/api-server/src/modules/agents/services/agents-service.ts` `create`
   (spec mutation block around `:830-928`), when `input.telemetryAttributionId` is set,
   set `spec.telemetryAttributionId` (field exists on `AgentSpecCR` after 01's codegen).
   It belongs in the spec (the controller renders it into the gateway bootstrap), not in
   annotations.
3. **Resolve at spawn.** In
   `packages/api-server/src/modules/invocations/services/invocations-service.ts`:
   - Add a `driverResolution: DriverResolution` dep to `createInvocationsService`.
   - Add an `UnresolvableDriverError` (same style as `AttenuationError`).
   - In `spawn`, before the `repo.insert` (fail at the door, no row to clean up):
     `const rootId = await deps.driverResolution.resolveRoot(input.driverAgentId)`;
     throw `UnresolvableDriverError` when null. Resolution is safe here: every ancestor
     of a spawning target is still `running`, so the chain is fully present (README).
   - Pass `telemetryAttributionId: rootId` in the `deps.agents.create({...})` call
     (`:200-211`).
4. **Wire the dep.** In
   `packages/api-server/src/modules/invocations/compose.ts`
   `composeInvocationsForOwner`, build the resolution from the module's own repository
   (`createDriverResolution({ repo: createInvocationsRepository(opts.db) })`) — same
   construction `createDriverResolutionAdapter` uses.
5. **Map the error.** In
   `packages/api-server/src/apps/harness-api-server/invocation-endpoints.ts` (catch block
   around `:77-96`), map `UnresolvableDriverError` → **409** with a message the Driver
   can read (e.g. "driver chain could not be resolved; refusing to spawn an
   unattributable target"). Keep the existing mappings intact.
6. Update any unit tests of `spawn` that now need the new dep (existing suite,
   `mise run api-server:check` reveals them).

## Acceptance criteria

- [ ] `telemetryAttributionId` is absent from the wire create schema and any tRPC input;
      it is only accepted through the in-process `AgentsService.create` input.
- [ ] A spawned target's Agent CR spec carries the **root** Driver's id — for a
      target-of-a-target chain, the top non-target agent, not the immediate parent.
- [ ] A spawn whose chain fails to resolve returns 409 and leaves no `invocations` row
      and no Agent behind.
- [ ] Ordinary (non-invocation) agent creates are unaffected — no attribution field in
      their spec.
- [ ] `mise run api-server:check` and `mise run api-server-api:check` pass.

## Smoke test

```
mise run api-server:check
```

Then print a short manual guide: on the local cluster (`cluster-ops` skill), spawn an
Invocation via `POST /api/agents/:id/invocations` and run
`kubectl get agent <target-id> -o yaml` — `spec.telemetryAttributionId` equals the
Driver's agent id.
