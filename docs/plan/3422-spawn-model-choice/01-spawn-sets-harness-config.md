# 01 — A spawn sets its child's harness config

**Part of:** A spawn chooses the model its sub-agent runs — see [README](./README.md)

## Context

This slice makes a spawn carry an optional harness config and applies it to the child before
the child's first turn. It covers the whole path: the REST contract, the invocations service,
the `/images` harness family, both driver SDKs, both skills and the architecture docs. When a
harness cannot apply the config, the event is a no-op in this slice; slice 02 adds the
fail-fast. The README pins the contract and explains why the event needs its own bump.

## Implementation plan

Apply `/typescript-engineering` to every TS change.

1. **Contract** in `packages/api-server-api/src/modules/invocations/schemas.ts`:
   - Add `invocationHarnessConfigSchema`: an object with `model` and `mode` (both
     `z.string().min(1).optional()`) and `configOptions` (reuse `agentConfigOptionsSchema` from
     `../harness-config/schemas.js`, optional). Add a `.refine` that requires at least one of
     the three.
   - Add `harnessConfig: invocationHarnessConfigSchema.optional()` inside the
     `spawnInvocationRequestSchema` object, before its existing `image`/`templateId` refine.
   - Add the inferred type `InvocationHarnessConfig` to `types.ts`. Export the schema and the
     type from `packages/api-server-api/src/index.ts`, next to the other invocations exports.
2. **Service** in `packages/api-server/src/modules/invocations/services/invocations-service.ts`:
   - Add `harnessConfig?: InvocationHarnessConfig` to `SpawnInput`.
   - In `spawn`, after `agents.create` succeeds and before the trigger `bump`, queue the config
     when one is present:
     `deps.runtimeMutator.bump(agent.id, [{ id: \`harness-config:${agent.id}:${ts}\`, kind: "harness-config", payload: input.harnessConfig, expiresAt }])`.
     Use the invocation's `expiresAt`, the same as the trigger's.
   - Keep it a **separate** `bump` call from the trigger's. Events in one bump share a version,
     and `pendingEvents` orders by version only (see README).
   - The id must end in `:<ms>`, because the agent's event loop splits the dedupe key from the
     fire timestamp at the last `:` (`packages/agent-runtime/src/modules/runtime-channel/event-loop.ts`).
   - Do not call `HarnessConfigService.apply`. That path emits the `HarnessConfigChanged`
     activity event and writes a snapshot, and a spawn wants neither. The payload type is
     `HarnessConfigEventPayload` from `agent-runtime-api`; `InvocationHarnessConfig` is a subset
     of it (no `unset`).
   - A spawn without `harnessConfig` must behave exactly as today: one bump, the trigger.
3. **Route** in `packages/api-server/src/apps/harness-api-server/invocation-endpoints.ts`:
   - Pass `body.harnessConfig` into `spawn(...)`, using the same conditional-spread idiom as the
     other optional fields.
   - In `GET /api/agents/:id/images`, add `harness: t.spec.harness` to each entry.
4. **JS SDK** in `packages/driver-sdk/src/spawn.ts`:
   - Add `model?`, `mode?` and `configOptions?: Record<string, string>` to `SpawnOptions`.
   - Build `body.harnessConfig` from them only when at least one is set.
   - Add `harness?: string` to `ImageInfo`.
   - The SDK ships as `/usr/local/lib/driver-sdk.mjs` in `platform-base`, so a cluster check
     needs `cluster:build-agent`.
5. **Python SDK** in `packages/experiment-sdk/src/experiment_sdk.py`, `spawn()`:
   - Add keyword-only `model=`, `mode=` and `config_options=`. Map them to
     `body["harnessConfig"] = {"model": …, "mode": …, "configOptions": …}`, omitting the unset
     keys and the whole object when all three are unset.
   - Extend the docstring in a few sentences. The values are the target harness's own catalog
     values and pass through unchecked. A wrong name fails the child's first turn and burns
     the TTL.
6. **Skills.** Keep them general guides, not per-case recipes.
   - `packages/agents/claude-code/workspace/.agents/skills/dam-invoke/SKILL.md`:
     - Add `model`, `mode` and `configOptions` rows to the `spawn(opts)` table.
     - Add a short "Choose the model per spawn" section. It covers: why (compare models, cheap
       models for mechanical steps); the per-harness value table from the README (Claude
       Code, Pi, Bob; slice 03 adds Codex); that `listImages()` now returns each image's
       `harness`; that the discovered names are the ones the Config panel lists for any agent
       on the same connection; the warning that `mode` values which ask approvals stall an
       unattended child; and the advice to use a short `ttlMs` when trying a new name.
   - `packages/agents/claude-code/dam-skills/dam-experiment/SKILL.md`:
     - Add the per-worker model (and effort) to the envelope the human approves in "Get the
       configuration approved before you author".
     - Show `model=` on one existing `x.spawn(...)` example.
     - Point to dam-invoke's value table, or restate it in one line. Do not copy it twice.
7. **Architecture docs.** Pitch the changes at the level of meaning, and bump `Last verified:`
   on each page.
   - `docs/architecture/harness-config.md`:
     - The Overview names the owner as the only chooser. Make it "an owner's, or a driver's
       for an agent it spawns".
     - In "The event", add that a spawn is a second producer. It carries the driver's choice
       for the child and is queued ahead of the child's first turn, so that turn already runs
       on it. It is not a person's action, so it records no activity and no snapshot.
   - `docs/architecture/experiments.md`: in "The worker image is a design-time choice", make
     the worker's model part of the approved envelope, and say that the catalogue names each
     image's harness family.
   - `docs/architecture/runtime-delivery.md`: the `harness-config` line says the choices are
     "a user makes in the Config panel". Extend it with "or a driver makes for an agent it
     spawns". This page has about 150 chars of headroom, so keep the edit to that clause.

## Acceptance criteria

- [ ] A spawn with `harnessConfig` queues a `harness-config` event for the target at a lower
      outbox version than its trigger event.
- [ ] A spawn without `harnessConfig` queues only the trigger, as on `main`.
- [ ] `harnessConfig: {}`, an empty `model` string, and a non-string option value are rejected
      with `400`.
- [ ] No `HarnessConfigChanged` activity event and no harness-config snapshot row is written
      for a target.
- [ ] Each `GET /images` entry carries `harness` when the template declares one.
- [ ] Both SDKs send `harnessConfig` only when at least one of its options is given.
- [ ] Both skills and the three architecture pages describe the choice, and
      `mise run //docs:check:doc-size` passes.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

1. Run `mise run check` and `mise run test`.
2. Run `mise run cluster:build-apiserver`, then `mise run cluster:build-agent`.
3. On `http://localhost:4444`, create a Claude Code driver agent with a model connection.
   Open a shell in its pod.
4. Write `~/model-smoke.mjs`. It imports `spawn`, `listImages` and `listConnections` from
   `/usr/local/lib/driver-sdk.mjs`, prints `listImages()` (expect a `harness` on each entry),
   and runs two spawns in parallel:
   - `template: "claude-code", model: "haiku"`
   - `template: "claude-code"` with no model

   Both get the model connection, the prompt "Report the exact model id you are running as.",
   `schema: "string"` and `ttlMs: 10 * 60_000`. Run it with `node ~/model-smoke.mjs`. Expect
   a Haiku model id from the first spawn and the template default from the second.
5. Repeat with `configOptions: { effort: "low" }` and `model: "opus"`. While the target lives,
   read its agent-runtime log with `mise run cluster:kubectl -- logs <target-pod>`. Expect a
   `[harness-config] … set model, effortLevel` line before the trigger opens its session.
6. Python path: in the same pod, run
   `python3 -c 'import experiment_sdk as x; print(x.spawn("Report the exact model id you are running as.", "string", template="claude-code", model="haiku", connections=["<id>"], ttl_ms=600000))'`.
   Expect a Haiku model id.
7. Rejection: `curl -s -XPOST "${PLATFORM_MCP_URL%/mcp}/invocations" -H 'content-type: application/json' -d '{"templateId":"claude-code","prompt":"x","schema":{},"harnessConfig":{}}'`.
   Expect a `400`.
