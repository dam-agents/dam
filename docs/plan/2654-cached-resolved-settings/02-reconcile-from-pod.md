# 02 — Reconcile the snapshot from the pod

**Depends on:** 01
**Part of:** cached agent-resolved settings — see [README](./README.md)

## Context

01 records what the platform *declared*. That is not enough: `harness-config` writes the harness's
config file once and never re-asserts, so a hand-edit stands and the declared value silently goes
wrong. This slice makes the pod report its real values, so the snapshot converges on the file.

It also fills `availableModels`, which only the pod can resolve — discovery reads the provider base
URL from materialized connection env.

Apply the `/typescript-engineering` skill.

## Implementation plan

### Pod side

1. **Split the file read from discovery.** In
   [`harness-config-plugin.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/drivers/harness-config-plugin.ts),
   `readCurrent` does both, and discovery carries a 5-second timeout. Expose the file-only read on
   the plugin interface too — `readCurrentValues` already exists as a module-level function, so this
   is surfacing it, not writing it. `hello` must not wait on a network call.

2. **Report on `hello`.** [`hello.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/hello.ts)
   already receives capabilities from `compose.ts` (~line 147, where `harnessConfig` and
   `harnessConfigCatalog` are advertised). Add the file-only values to the `hello` mutate payload.
   No `availableModels` here — env has not materialized at boot, so discovery would return `null`
   and, without the merge semantics from 01, would clobber a good list.

3. **Report in the apply result.** In
   [`service.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/service.ts), `applyState`
   returns from **three** places — the contributions-stale branch, the driver-failure branch, and the
   clean path. Read the plugin's full `readCurrent` (file values plus discovery) **once, after the
   drivers have run**, and attach it to all three returns. After the drivers is what matters: the env
   driver has just materialized the provider base URL by then.

   Guard it: the plugin is only registered when the manifest declares a `harness-config` driver
   (`compose.ts` ~line 105), so omit the field entirely when `supported` is false. Never let a
   discovery failure fail an apply — `readCurrent` already swallows failures into `null`.

### Contract

4. In [`packages/agent-runtime-api/src/modules/runtime/types.ts`](../../../packages/agent-runtime-api/src/modules/runtime/types.ts):

   - Add an optional `harnessConfigCurrent` to `helloInput` (~line 311), carrying `model`, `mode` and
     `configOptions`.
   - Add an optional `harnessConfigCurrent` to **both** members of the `applyStateResult` discriminated
     union (~line 293), carrying the same plus `availableModels`.

   Both optional, so a pod predating this omits them and the api-server keeps whatever it holds. This
   is the same forward-compatibility shape the existing optional fields on these schemas use.

### api-server side

5. **Declare the port in the consumer.** `runtime-delivery` must not import harness-config's
   infrastructure. Declare a narrow writer interface inside
   `packages/api-server/src/modules/runtime-delivery/` — one method, the `merge` shape from 01 — and
   satisfy it at composition with the snapshot repo. Dependency direction stays outward-in.

6. **Hello.** In
   [`hello-handler.ts`](../../../packages/api-server/src/modules/runtime-delivery/services/hello-handler.ts),
   after `upsertHello`, merge the reported values with `confirmed: true` when the field is present.
   Do not touch `availableModels`.

7. **Apply.** In
   [`worker-handler.ts`](../../../packages/api-server/src/modules/runtime-delivery/services/worker-handler.ts),
   the outcome is already narrowed through a `switch` on `outcome.status` with an exhaustive default.
   Merge the reported values (including `availableModels`) with `confirmed: true` after
   `recordOutcome` — the snapshot is display state and must never be the reason an apply cycle fails.
   Wrap it so a snapshot write error is logged and swallowed.

8. **Docs.** Update the `harness-config` paragraph in
   [`docs/architecture/connections.md`](../../architecture/connections.md): the pod reports its current
   values on `hello` and its values plus the discovered model list in the apply result; the platform
   merges them into the snapshot and marks it confirmed; the live pod read stays authoritative while
   running. State why the split exists — `hello` is too early for discovery, and a clean boot never
   applies. Refresh `Last verified:`.

## Acceptance criteria

- [ ] `hello` carries the harness config file's values, and the api-server marks the snapshot `confirmed: true`.
- [ ] The apply result carries those values plus `availableModels`, and the api-server merges both.
- [ ] A `hello` that reports no `availableModels` leaves a previously captured list intact.
- [ ] An agent whose manifest declares no `harness-config` driver reports neither field, and its snapshot stays `null`.
- [ ] A hand-edit to the harness config file is reflected in the snapshot after the next boot, overriding an earlier declared value.
- [ ] A failure inside the snapshot write does not fail `hello` or the apply cycle.
- [ ] `hello` issues no network request for model discovery (verify from the agent-runtime log ordering).
- [ ] `connections.md` documents the two report points and why they differ; `Last verified:` refreshed.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster:

1. Start a sandbox and apply a model. Stop it. `harnessConfig.snapshot` shows that model with
   `confirmed: true` and, if the agent declares a `modelDiscovery` source, a populated
   `availableModels`.
2. Start it again, edit `~/.claude/settings.json` through the Files panel to a different model,
   restart, then stop. The snapshot now reports the edited model.
3. Tail the agent-runtime log during boot and confirm `hello` precedes any model-discovery line.

Print a short manual guide so the user can repeat this by hand.
