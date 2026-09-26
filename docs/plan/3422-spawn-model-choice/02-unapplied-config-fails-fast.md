# 02 — A child that cannot apply it fails fast

**Depends on:** 01-spawn-sets-harness-config
**Part of:** A spawn chooses the model its sub-agent runs — see [README](./README.md)

## Context

After slice 01, a spawn that asks a harness without the `harness-config` driver for a model
has no effect. The child runs its default model, and the driver records that result as if it
came from the requested model. This slice closes that gap. The invocation remembers that it
asked for a config. It fails with a reason once its target has registered without the
`harnessConfig` capability. The result path refuses a result in the same case, because the
liveness sweep ticks only every 60 s and a quick child could report before it. Codex is a
real example of such a harness until slice 03 lands, and this slice's smoke test uses it.

## Implementation plan

Apply `/typescript-engineering` to every TS change.

1. **Schema.** In `packages/db/src/schema.ts`, add a nullable `harnessConfig: jsonb("harness_config")`
   column to the `invocations` table. Run `mise run //packages/db:generate`, and add a top
   comment to the generated SQL that says why (`packages/db/CLAUDE.md`). Never hand-write or
   renumber the migration.
2. **Repository** in `packages/api-server/src/modules/invocations/infrastructure/invocations-repository.ts`:
   - `insert` takes `harnessConfig` (`InvocationHarnessConfig | null`).
   - The row type and its mapper carry it, so that `get` and `listRunning` return it.
3. **Port.** The invocations module must not know the capability blob's shape. Give it a
   narrow port, `canApplyHarnessConfig(agentId): Promise<boolean | null>`, where `null` means
   the target has not registered yet.
   - Compose it at the composition root from `runtimeDelivery.agentsRuntimeRepo.get(id)` →
     `runtimeCapabilities`. Map a missing registration to `null`. Otherwise map through
     `harnessConfigSupported` (exported from `packages/api-server/src/modules/harness-config/index.ts`).
   - Note that `harnessConfigSupported(null)` returns `true`, so check for a missing
     registration *before* you call it.
   - Thread the port through `composeInvocationsForOwner` (its caller is
     `packages/api-server/src/apps/harness-api-server/app.ts`; add it to that app's deps from
     `packages/api-server/src/bootstrap.ts`) and through `composeInvocationLivenessSweep` in
     bootstrap.
4. **Domain.** Put the rule and the reason text in `packages/api-server/src/modules/invocations/domain/`:
   a row that requested a config, and whose target answered `false`, cannot run as asked. The
   reason should say what the driver can act on, for example: "target cannot apply the
   requested harness config: its image declares no harness-config driver".
5. **Service** in `invocations-service.ts`:
   - `spawn` stores `input.harnessConfig ?? null` on the row.
   - `recordResult`, before it validates the result: when the row carries a config and the
     port answers `false`, `repo.fail(id, reason)`, then delete the target (best-effort, as
     the success path does), and return `{ ok: false, errors: reason }`.
6. **Sweep** in `invocation-liveness.ts`: in the pass over `listRunning`, for rows that carry
   a config, ask the port. Call `failAndReap(row, reason)` on `false`, and do nothing on `null`
   or `true`. Keep the per-row `try/catch` pattern the restart check uses.
7. **JS SDK** in `packages/driver-sdk/src/spawn.ts`: `InvocationFailed` drops the server's
   `errorReason`, so a driver cannot see why. Carry the reason on the error (message and a
   `reason` property). The Python SDK already passes it.
8. **Skills.** In dam-invoke's model section, add one line: a template that cannot apply the
   choice fails fast with that reason.
9. **Architecture docs.** Bump `Last verified:` on each edited page.
   - `docs/architecture/experiments.md`, "A failed spawn says why": add this failure class
     (asked for a harness config its image cannot apply). Say that the platform refuses such
     a target's result, so a model comparison never records a result from a default model.
   - `docs/architecture/harness-config.md`, the closing sentence about which harnesses honor
     the event: add that a spawn which asks a harness without the driver fails, rather than
     running on its default model.
10. **Existing tests.** The invocations unit tests build the repository fakes, the service and
    the sweep by hand. Thread the new column and the new port through them so they compile
    and pass. Do not add tests.

## Acceptance criteria

- [ ] The migration is generated from `schema.ts`, and `mise run //packages/db:check:generated`
      passes.
- [ ] A running invocation that requested a config fails with the reason on the first sweep
      tick after its target registered with `harnessConfig` not `true`, and its target is
      reaped.
- [ ] `report_result` from such a target returns the reason, and it fails the invocation instead
      of storing the result.
- [ ] An invocation without a requested config is never failed by this rule, even on a
      target that lacks the capability.
- [ ] A target that has not registered yet (`null`) is left alone.
- [ ] The JS SDK error names the reason.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

1. Run `mise run check` and `mise run test`.
2. Run `mise run cluster:build-apiserver` (the migration runs at api-server start). Then run
   `mise run cluster:build-agent` for the JS SDK change.
3. In the Claude Code driver pod from slice 01, spawn
   `template: "codex", model: "gpt-5.5", prompt: "Reply with the number 1.", schema: "integer"`
   with a model connection that Codex accepts (ibm-litellm or openai) and `ttlMs: 30 * 60_000`.
4. Expect the SDK to throw well before the TTL, within about a minute of the target booting.
   The error names the reason. Either path may fire first: the sweep, or a refused
   `report_result` if the child answers fast. Both must end in the same `failed` status and
   reason.
5. Spawn the same Codex call with no `model`. Expect it to succeed with `1`, unchanged from
   `main`.
6. Spawn `template: "claude-code", model: "haiku"`. Expect success, as in slice 01.
