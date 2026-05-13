# Phase 1 — Server: widen Instance projection + typed NOT_FOUND

**Issue:** [#188](https://github.com/dam-agents/dam/issues/188), Phase 1 of 5
**Blocks:** Phases 2, 3, 4, 5
**Prerequisites:** None

## Goal

Make the api-server expose the template / image of an instance through the tRPC contract, and convert one untyped error to a typed `TRPCError`. Three small, additive edits in `packages/api-server-api` and `packages/api-server`. No CLI changes in this phase.

## Why this comes first

- Phases 3 and 4 (CLI new verbs) read `templateId` and `image` from `instances.list` / `instances.get`. The schema must be widened first so the contract package is stable.
- Phase 3's `dam instances create` distinguishes "unknown template" from "internal error" in its rollback policy. That requires the server to throw `TRPCError({ code: "NOT_FOUND" })` instead of a bare `Error`.
- All other phases can stack on this without re-thinking the projection.

## Background (what you need to know)

The DAM data model has a 1:N relationship between **Agents** (templates of a desired pod spec) and **Instances** (running pods derived from an agent). In v1 the UI creates one agent per instance, but the contract distinguishes them.

- An **Agent** carries a `templateId` (optional — present when the agent was created from a template, absent when created directly from a raw image).
- An **Instance** points to an agent via `agentId`.
- Today the `Instance` view exposes `agentId` but NOT the upstream `templateId` or `image`. The CLI work in later phases needs both.

The "template" relationship lives in the K8s label `LABEL_TEMPLATE_REF` on the agent's ConfigMap (see [agents-configmap-mappers.ts:15](../../../packages/api-server/src/modules/agents/infrastructure/agents-configmap-mappers.ts)). The `Agent.spec.image` field has the resolved image. Both are already loaded when `getAgent()` runs.

## Concrete changes

### Change 1 — Widen `Instance` Zod-implied output type

The `Instance` interface in the contract is the source of truth for what `instances.list` / `instances.get` return. tRPC's typed router uses TS inference, not a separate Zod output schema, so widening the TypeScript interface is the only schema change required.

**File:** [`packages/api-server-api/src/modules/instances/types.ts`](../../../packages/api-server-api/src/modules/instances/types.ts)

Add two fields to the `Instance` interface:

```ts
export interface Instance {
  id: string;
  name: string;
  agentId: string;
  /** Agent's template id, or null if the agent was created from a raw image. */
  templateId: string | null;
  /** Container image the instance runs. Always populated. */
  image: string;
  description?: string;
  state: InstanceState;
  error?: string;
  channels: ChannelConfig[];
  allowedUserEmails: string[];
}
```

Both fields are **required** (not optional) on the wire — `templateId` uses `null` for the no-template case so consumers can distinguish "not present" from "I forgot to project it".

### Change 2 — Populate the new fields in the service layer

**File:** [`packages/api-server/src/modules/instances/domain/instance-assembly.ts`](../../../packages/api-server/src/modules/instances/domain/instance-assembly.ts)

`assembleInstance()` currently takes `infra: InfraInstance, channels, allowedUserEmails` and emits the `Instance` view. It does not know about templates or the agent image. Extend its signature to accept the agent details and project them:

```ts
import type { Agent } from "api-server-api";

export function assembleInstance(
  infra: InfraInstance,
  agent: Pick<Agent, "templateId" | "spec"> | null,
  channels: ChannelConfig[],
  allowedUserEmails: string[] = [],
): Instance {
  return {
    id: infra.id,
    name: infra.name,
    agentId: infra.agentId,
    templateId: agent?.templateId ?? null,
    image: agent?.spec.image ?? "",
    description: infra.description,
    state: computeState(infra),
    error: infra.currentState === "error" ? infra.error : undefined,
    channels,
    allowedUserEmails,
  };
}
```

If `agent` is `null` (the agent ConfigMap was deleted but its instance ConfigMap is still being reconciled — a transient inconsistency), surface `templateId: null, image: ""`. That's a hint to the operator that the agent is gone; it won't last long since OwnerReferences will cascade-delete the instance.

**File:** [`packages/api-server/src/modules/instances/services/instances-service.ts`](../../../packages/api-server/src/modules/instances/services/instances-service.ts)

`assembleInstance` is called in four places: `list()`, `get()`, `create()`, `update()`, `wake()`, `connectSlack()`, `disconnectSlack()`, `connectTelegram()`, `disconnectTelegram()`. Each needs to be threaded the agent.

**`list()`** — currently calls `assembleInstance` in a loop over `infraInstances`. Batch-load agents up-front:

```ts
const agentIds = [...new Set(infraInstances.map((i) => i.agentId))];
const agents = await Promise.all(agentIds.map((id) => deps.getAgent(id)));
const agentById = new Map(agents.flatMap((a) => a ? [[a.id, a]] : []));
// ...
return infraInstances.map((infra) => {
  const subs = allowedUsersMap.get(infra.id) ?? [];
  const emails = subs.map((s) => subEmailMap.get(s) ?? s);
  return assembleInstance(infra, agentById.get(infra.agentId) ?? null, channelMap.get(infra.id) ?? [], emails);
});
```

**`get()` and every other single-instance path** — fetch the agent inline:

```ts
const agent = await deps.getAgent(infra.agentId);
return assembleInstance(infra, agent, channels, emails);
```

`deps.getAgent` is already a dep (line 22 of `instances-service.ts`): `getAgent: (id: string) => Promise<Agent | null>`. No new dependency needed.

### Change 3 — Convert template-not-found to typed `TRPCError`

**File:** [`packages/api-server/src/modules/agents/services/agents-service.ts`](../../../packages/api-server/src/modules/agents/services/agents-service.ts), line 66.

Replace:

```ts
if (!tmpl || tmpl.isOwned) throw new Error(`Template "${input.templateId}" not found`);
```

With:

```ts
import { TRPCError } from "@trpc/server";
// ...
if (!tmpl || tmpl.isOwned) {
  throw new TRPCError({
    code: "NOT_FOUND",
    message: `template "${input.templateId}" not found`,
  });
}
```

Note: lowercase `template` in the message to match the project's error-message convention (errors start lowercase after the implicit `"error: "` prefix the CLI adds; the api-server forwards the message verbatim).

`TRPCError` is already used elsewhere in this file's module (`api-server` codebase) — see e.g. [`router.ts:43`](../../../packages/api-server-api/src/modules/agents/router.ts) for an existing import pattern. Import from `@trpc/server`.

## Tests

Only add tests that would catch a regression beyond what the compiler already enforces:

- **One unit test** in [`packages/api-server/src/modules/instances/domain/`](../../../packages/api-server/src/modules/instances/domain/) for `assembleInstance`: assert `templateId` is `null` when `agent` is `null`, the template id when present, and the image is sourced from `agent.spec.image`. If a `*.test.ts` file already exists for `instance-assembly.ts`, extend it; otherwise create `instance-assembly.test.ts`.

Skip:
- A test for the typed `TRPCError` — Phase 3's integration test (unknown template path) verifies this end-to-end.
- Tests for `instances-service.ts` `list`/`get` projection — pure plumbing; the integration smoke test below verifies the wire payload.

## Verification (smoke test)

Run these in order; do not proceed to Phase 2 until every step passes.

1. **Compile & lint clean:**
   ```sh
   mise run check
   mise run test
   ```

2. **Bring up the cluster with the new image:**
   ```sh
   mise run cluster:install
   ```
   Wait for `api-server` and `controller` pods to reach `Running`:
   ```sh
   mise run cluster:status
   ```

3. **Verify `Instance` payload includes new fields.** From the host:
   ```sh
   export KUBECONFIG="$(mise run cluster:kubeconfig)"
   mise run cluster:kubectl -- exec deploy/api-server -- \
     curl -s http://localhost:3000/api/trpc/instances.list \
     -H "Authorization: Bearer $(mise run cluster:kubectl -- get secret demo-token -o jsonpath='{.data.token}' | base64 -d)" \
     | jq '.result.data[0] | keys'
   ```
   Output **must include** `templateId` and `image`. If no instances exist yet, create one via the UI (`https://ui.localtest.me:4444`) from the `claude-code` template, then re-run.

4. **Verify projection correctness:**
   - The instance you created in step 3 must show `templateId: "claude-code"` and `image: "<the configured image>"` in the payload.
   - Create a second instance via the UI's `<custom>` image path (paste an image URL instead of picking a template). Its payload must show `templateId: null` and `image: "<your-image>"`.

5. **Verify typed NOT_FOUND.** Trigger the unknown-template path via the UI (try to create an agent with a non-existent template id — easiest via browser devtools tRPC call, or temporarily edit the dropdown). The server response must have `error.data.code === "NOT_FOUND"`, not `"INTERNAL_SERVER_ERROR"`.

6. **UI regression check.** Open the UI's main agent list — all existing instances must still render their name, state, and any other fields the UI shows. The schema widen is purely additive, but verify the UI does not crash on the new fields.

If any step fails, stop and fix before declaring Phase 1 done.

## Out of scope

- Any CLI changes.
- Adding `templateId` to the `Agent.spec` body — the field already lives on the `Agent` type (see [agents/types.ts:35](../../../packages/api-server-api/src/modules/agents/types.ts)). We are only widening the `Instance` projection.
- Migrating existing instances (no migration needed — the fields are derived from the agent ConfigMap labels at read time).
- Changing `instances.create` input shape. The agent-vs-instance split stays as-is at the API layer; the CLI hides it in Phase 3.

## References

- [Issue #188](https://github.com/dam-agents/dam/issues/188)
- [Spec — §3 server changes](../188-instances-create-spec.md#3-server-changes)
- [Analysis — §5 module / code layout](../188-instances-create.md#5--module--code-layout)
- ADR-042 (template spec layers): [docs/adrs/042-template-spec-layers.md](../../adrs/042-template-spec-layers.md) (if relevant for context — the projection change is independent of layer policy)
