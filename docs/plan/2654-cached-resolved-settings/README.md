# Cache agent-resolved settings so the config page renders while stopped

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/2654

## Goal

Some sandbox settings are resolved inside the sandbox, so the sandbox's own workspace is their
source of truth: the harness's current model, mode and config options, the model list the provider
actually offers, and the skills present on disk. Today the platform only reads them from a running
pod. A stopped sandbox therefore shows nothing for those fields, and a model that the current
provider no longer offers stays invisible until chatting fails.

After this feature the platform holds a durable snapshot of those values, refreshed whenever the
sandbox runs. The config page shows the last known model and skills while the sandbox is stopped,
labels them as a snapshot with the time they were captured, and says plainly that the sandbox must
run to change them. A sandbox that has never run says so instead of showing blanks.

This is Phase 1 of epic [#3022](https://github.com/dam-agents/dam/issues/3022).

## Approach

The subsystem that owns this is the runtime channel, documented in
[`docs/architecture/connections.md`](../../architecture/connections.md) — read the **Event** section
and the `harness-config` paragraph before starting. The skills half is documented in
[`docs/architecture/skills.md`](../../architecture/skills.md) (**Reconciled state**).

Four facts from that page and the code shape the whole design:

1. **`harness-config` never re-asserts.** The event writes the mapped keys into the harness's own
   config file once and is never reconciled again, so a hand-edit through the Files panel or SSH
   stands. The platform therefore can never be *authoritative* for the current model — it can only
   hold a snapshot, and it must distinguish a value it merely *declared* through an apply from one
   the pod *confirmed*.

2. **`applyState` is the only moment when both halves are fresh.** The api-server pushes state to
   the pod and gets a typed `ApplyStateResult` back
   ([`worker-handler.ts`](../../../packages/api-server/src/modules/runtime-delivery/services/worker-handler.ts)).
   Env contributions land in that same call, and model discovery resolves its base URL from
   materialized env
   ([`model-discovery.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/infrastructure/model-discovery.ts)).
   So the apply result is where the discovered model list can be read. `hello` is too early for
   discovery — env has not materialized yet.

3. **`hello` is still needed.** The worker only runs when the outbox is ahead of the agent
   ([`hello-handler.ts`](../../../packages/api-server/src/modules/runtime-delivery/services/hello-handler.ts)),
   so a clean boot with no pending change never calls `applyState`. Without a hello-side report, a
   hand-edit to the config file would go unnoticed for that whole run. The split is therefore:
   **`hello` carries the config-file values; `applyState`'s result carries those plus
   `availableModels`.** Both are optional contract fields, so a pod predating them simply omits
   them and the snapshot keeps whatever it had.

   `availableModels` refreshing only on an apply is correct rather than a compromise: the list
   changes when the provider changes, a provider change is a connection or env change, and that
   bumps the outbox — which is exactly what triggers an apply.

4. **The stale-model verdict is derived, not stored.** Because `model` and `availableModels` are
   captured in the same read, `model ∉ availableModels` is self-consistent at any later time. There
   is no provider fingerprint and no invalidation hook into connection grants. This was weighed
   against the explicit-invalidation approach the issue's discussion suggests and deliberately
   dropped: a fingerprint cannot tell the user what the *new* provider offers without waking the
   pod, so it would only weaken the message.

**Where the snapshot lives:** Postgres, as jsonb columns on the `agents` table in
[`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts), beside `runtime_capabilities`.
That column already persists the *catalog* half of this same data, written on the same `hello`, and
the cold-start discriminator ("has this agent ever run") is already its nullness. Redis was
considered — the issue's discussion suggests it — and rejected: the store there holds short-lived
handoff state (OAuth `state`, chat binds, presence) whereas this is durable state the UI describes
as "captured 2 days ago", and an eviction would make a stopped sandbox read as never-run. Write
amplification is avoided by writing only when the value actually changed.

**Scope boundary against [#3208](https://github.com/dam-agents/dam/issues/3208).** This feature
ships the reads plus the *model* half of the UI, because
[`sandbox-model-settings.tsx`](../../../packages/ui/src/modules/sandboxes/components/sandbox-model-settings.tsx)
and the shared `ModelSettingsPanel` already degrade to a read-only snapshot with a "Start agent to
edit" action — only the data source changes. The stopped and never-run **skills** views belong to
#3208's redesign. Sub-issue 04 ships the read those views consume, and deliberately renders nothing
new.

**Out of scope.** Installing skills on a sandbox that has never run. Every mutating skills
procedure calls `ensureAgentReachable` today, so that is a separate capability with its own issue.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 ✅ | Snapshot column, write-through on apply, and the read proc | `agents.harness_config_snapshot`, a snapshot repo, `harnessConfig.apply` records what it declared, new `harnessConfig.snapshot` query | — |
| 02 ✅ | Reconcile the snapshot from the pod | Pod reports config-file values on `hello` and those plus `availableModels` in the apply result; api-server merges and marks the snapshot confirmed | 01 |
| 03 ✅ | Model settings render from the snapshot | Panel reads live values while operable and the snapshot otherwise; captured-at note; never-run state; stale-model callout | 01, 02 |
| 04 | Skills snapshot read | `skills.state` records the standalone list on change and serves it with a captured-at while stopped | 01 |

01 → 02 → 03 is the linear path and delivers the whole model half. 04 shares only the write-on-change
pattern with 01 and is otherwise independent; it is last because nothing renders it until #3208.

## Conventions & glossary

- **Snapshot** — the platform's durable copy of settings the sandbox resolved for itself. Never
  authoritative; always carries `capturedAt`.
- **Declared vs confirmed** — a snapshot is *declared* when its only source is a `harnessConfig.apply`
  the pod has not reported back yet, and *confirmed* once a pod read produced it. The distinction
  exists because `harness-config` never re-asserts, so a declared value can be wrong the moment a
  user hand-edits the file.
- **Never run** — the agent has never sent `hello`, so `agents.runtime_capabilities` is null and
  there is genuinely nothing to snapshot. Distinct from "ran, but no model was ever chosen", where
  the harness's built-in default applies.

Apply the `/typescript-engineering` skill to every server-side slice (01, 02, 04) and the
`/react-ui-engineering` skill to 03. Both are named again inside each sub-issue.

Schema changes need a generated migration: `mise run db:generate`. `mise run db:check` fails when
`schema.ts` moved without one, so this is not optional.

## Whole-feature smoke test

On the local dev cluster ([`cluster-ops`](../../../.claude/skills/cluster-ops/SKILL.md)):

1. Create a sandbox and start it. Open its home page, pick a model in Model settings, and wait for
   the change to settle.
2. Stop the sandbox. Reload the page. Model settings shows the model you picked, a "captured …"
   note, and a "Start agent to edit" action rather than an empty section.
3. Start the sandbox again. Hand-edit `~/.claude/settings.json` through the Files panel to a
   different model. Restart the sandbox, then stop it. The snapshot follows the file, not the value
   you originally applied.
4. Call `skills.state` for the stopped sandbox. It returns the standalone skills from the last run,
   each with its `origin`, plus a captured-at. The Skills surface itself is unchanged — #3208 renders
   this.
5. Create a second sandbox and never start it. Its Model settings says the sandbox has not run yet
   instead of showing blanks or a spinner.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
[#2654](https://github.com/dam-agents/dam/issues/2654).
