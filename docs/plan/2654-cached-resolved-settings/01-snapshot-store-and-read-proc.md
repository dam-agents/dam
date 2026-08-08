# 01 — Snapshot column, write-through on apply, and the read proc

**Part of:** cached agent-resolved settings — see [README](./README.md)

## Context

The platform has nowhere to keep the harness config a user applies: `harnessConfig.apply` bumps a
runtime event and returns, so nothing queryable records what was set
([`harness-config-service.ts`](../../../packages/api-server/src/modules/harness-config/services/harness-config-service.ts)).
This slice adds the storage, records what an apply *declared*, and exposes a read that works without
a running pod. It does not talk to the pod at all — 02 does that.

Apply the `/typescript-engineering` skill.

## Implementation plan

1. **Schema.** In [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts), add to the
   `agents` table, next to `runtimeCapabilities` (~line 261):

   ```ts
   // Last known harness-resolved config (model/mode/options + the discovered
   // model list). A snapshot, never authoritative: `harness-config` writes the
   // harness's file once and never re-asserts, so the file can move underneath.
   harnessConfigSnapshot: jsonb("harness_config_snapshot"),
   ```

   Generate the migration with `mise run db:generate`. Commit the generated `.sql`, its journal
   entry, and the snapshot together with the schema change — `mise run db:check` fails otherwise.

2. **Contract.** In
   [`packages/api-server-api/src/modules/harness-config/schemas.ts`](../../../packages/api-server-api/src/modules/harness-config/schemas.ts):

   ```ts
   export const harnessConfigSnapshotSchema = z.object({
     model: z.string().nullable(),
     mode: z.string().nullable(),
     configOptions: agentConfigOptionsSchema,
     /** Models the provider offered at capture time; null when the manifest
      *  declares no `modelDiscovery` source, or discovery failed. */
     availableModels: z.array(harnessConfigChoice).nullable(),
     capturedAt: z.string().datetime(),
     /** False while the only source is an apply the pod has not reported back. */
     confirmed: z.boolean(),
   });
   ```

   Reuse `harnessConfigChoice` from `agent-runtime-api` (already imported in this file for
   `harnessConfigCatalog`). Wrap it for the proc rather than returning a bare nullable:

   ```ts
   export const harnessConfigSnapshotResultSchema = z.object({
     /** The agent has sent `hello` at least once, so a snapshot is possible.
      *  False means "never run" — genuinely nothing to show, not a miss. */
     hasRun: z.boolean(),
     snapshot: harnessConfigSnapshotSchema.nullable(),
   });
   ```

   `hasRun` comes from `agents.runtime_capabilities` being non-null. It exists so the UI never has to
   infer "never run" from a null catalog — the catalog is also null when an agent advertised a
   malformed one, which is a different situation. Re-export both from
   [`packages/api-server-api/src/index.ts`](../../../packages/api-server-api/src/index.ts) beside the
   existing harness-config exports, and add `snapshot` to `HarnessConfigService` in
   [`types.ts`](../../../packages/api-server-api/src/modules/harness-config/types.ts).

3. **Router.** Add a `snapshot` query to
   [`router.ts`](../../../packages/api-server-api/src/modules/harness-config/router.ts), taking the
   existing `harnessConfigStatusInputSchema` and returning `harnessConfigSnapshotResultSchema`.
   Mirror how `status` and `settled` are wired.

4. **Repository.** New
   `packages/api-server/src/modules/harness-config/infrastructure/snapshot-repo.ts` holding the only
   code that touches the column:

   - `read(agentId): Promise<HarnessConfigSnapshot | null>` — parse the jsonb through the schema and
     return `null` on a parse failure rather than throwing, so a shape change from an older write
     degrades to "no snapshot" instead of breaking the page.
   - `merge(agentId, patch, opts: { confirmed: boolean }): Promise<void>` — read, shallow-merge the
     supplied fields over the existing snapshot, stamp `capturedAt`, and write. **Skip the write
     entirely when the merged value equals the stored one apart from `capturedAt`** — this is what
     keeps 04's poll-driven writes off the hot path, and the same helper serves both slices.
   - Merge, not replace, so a `hello` that carries no `availableModels` (02) cannot null out a list
     an earlier apply established.

5. **Service.** In
   [`harness-config-service.ts`](../../../packages/api-server/src/modules/harness-config/services/harness-config-service.ts):

   - Take the repo as a new dep on `createHarnessConfigService`.
   - In `apply`, after the outbox bump succeeds, `merge` the fields the change carried with
     `confirmed: false`. Honour `unset`: a field listed there becomes `null` in the snapshot, not
     absent. Keep this after the bump — a failed bump must not leave a snapshot claiming a change
     that never fired.
   - Add `snapshot(agentId)`: `requireOwned` first, then return `{ hasRun, snapshot }`. `hasRun`
     reads `runtime_capabilities`; the service already has a `getCapabilities` dep it can reuse
     rather than a second query.

6. **Composition.** Build the repo in
   [`compose.ts`](../../../packages/api-server/src/modules/harness-config/compose.ts) and pass it
   through. Check whether `app.ts` (~line 977) needs the `db` handle threaded into
   `composeHarnessConfigModule`; follow whatever the neighbouring modules do.

7. **Docs.** Extend the `harness-config` paragraph in
   [`docs/architecture/connections.md`](../../architecture/connections.md) (~line 111): the platform
   now records what an apply declared and serves it as a snapshot, the pod stays authoritative while
   running, and a snapshot is never re-asserted onto the harness. Update `Last verified:`.

## Acceptance criteria

- [ ] `agents.harness_config_snapshot` exists with a committed generated migration; `mise run db:check` passes.
- [ ] `harnessConfig.apply` records model, mode and config options, with `confirmed: false`, and represents an `unset` field as `null`.
- [ ] A second apply that changes nothing performs no write (verify by log or by an unchanged row).
- [ ] `harnessConfig.snapshot` returns the recorded values for a **stopped** agent, and `snapshot: null` for an agent that has never been applied to.
- [ ] `hasRun` is false for an agent that has never sent `hello`, and true afterwards — independently of whether a snapshot exists.
- [ ] `harnessConfig.snapshot` rejects an agent the caller does not own, matching `status`.
- [ ] A snapshot whose stored jsonb fails schema parsing reads as `null` rather than throwing.
- [ ] `connections.md` describes the snapshot, with a refreshed `Last verified:`.

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster: start a sandbox, apply a model from Model settings, stop the sandbox, and
call `harnessConfig.snapshot` for it (the CLI's authenticated tRPC path, per
[`reference_cli_smoke_auth`](../../../.claude/skills/cluster-ops/SKILL.md) — mint a token via the
`platform-ui` password grant). The applied model comes back with `confirmed: false` while the
sandbox is stopped. Query a freshly created sandbox and confirm `null`.

Print a short manual guide so the user can repeat this by hand.
