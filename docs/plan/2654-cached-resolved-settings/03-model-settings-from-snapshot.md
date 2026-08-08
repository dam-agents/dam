# 03 — Model settings render from the snapshot

**Depends on:** 01, 02
**Part of:** cached agent-resolved settings — see [README](./README.md)

## Context

The sandbox-home Model settings section already degrades when the agent is not operable: it renders
read-only with a "Start agent to edit" action, and falls back to "Start the agent to load and edit
its model settings" when no catalog has arrived
([`sandbox-model-settings.tsx`](../../../packages/ui/src/modules/sandboxes/components/sandbox-model-settings.tsx)).
What it cannot do is show *which* model the sandbox uses, because the only source is a live pod read.

This slice swaps in the snapshot, dates it, tells a never-run sandbox apart from a stopped one, and
surfaces the stale-model failure the issue's Problem section names.

Apply the `/react-ui-engineering` skill.

## Implementation plan

1. **Query hook.** In
   [`packages/ui/src/modules/agents/api/harness-config.ts`](../../../packages/ui/src/modules/agents/api/harness-config.ts),
   add `useHarnessConfigSnapshot(agentId)` over the new platform proc. It is a plain
   `trpc.harnessConfig.snapshot.queryOptions` call — unlike `useHarnessConfigCurrent`, it does not go
   through `createAgentTrpc` and is not gated on `useIsAgentOperable`, which is the whole point.

2. **Resolve live-or-snapshot in one place.** Add a hook next to the two above that returns the
   values the panel should render plus how they were obtained. Live wins while operable, so a running
   sandbox behaves exactly as today; the snapshot fills in otherwise. Keep the shape assignable to
   what the panel already consumes (`model`, `mode`, `configOptions`, `availableModels`) so the panel
   body does not fork.

   ```ts
   type ResolvedHarnessConfig = {
     values: HarnessConfigCurrent | null;
     origin: "live" | "snapshot" | "none";
     capturedAt: string | null;
     hasRun: boolean;
   };
   ```

3. **Panel.** In
   [`model-settings-panel.tsx`](../../../packages/ui/src/modules/sessions/components/model-settings-panel.tsx),
   replace the single `useHarnessConfigCurrent(agentId)` call (~line 55) with the resolver. Everything
   downstream already reads through `current?.…` — `current.model` for model constraints (~line 103)
   and `current.availableModels` for the model group (~line 132) — so those sites need no change once
   the shape matches. The panel serves the chat rail too, where the agent is operable by definition,
   so `variant="chat"` behaviour must not shift.

4. **Captured-at note.** When `origin === "snapshot"`, render a line above the controls saying the
   values are the last known configuration and when they were captured, using the existing
   `timeAgo` / `formatTimestamp` helpers from `@/lib/format-time` (the skill source cards already use
   both — match that treatment). Only in the `page` variant.

5. **Never-run state.** `sandbox-model-settings.tsx` currently branches on `!hasCatalog && !operable`.
   Change the discriminator to `hasRun` from the proc, which is exact where a null catalog is only a
   proxy. Copy follows the design prototype attached to
   [#3208](https://github.com/dam-agents/dam/issues/3208): this sandbox has not run yet, its settings
   are resolved inside the sandbox, so there is nothing recorded to show — start it once and the page
   fills in. Keep the existing `WakeToEditButton`.

   Keep a distinct case for "has run, but no model was ever chosen": the harness's built-in default
   applies, which is not the same as nothing being known.

6. **Stale-model callout.** When `origin === "snapshot"` and the snapshot's `availableModels` is
   non-null and does not contain its `model`, render a warning above the section: the saved model is
   not offered by the provider the sandbox last reached, and chatting will fail until it is changed.
   The action starts the sandbox — reuse `WakeToEditButton`'s start path rather than adding a second
   way to wake an agent.

   **Deviation from the prototype, deliberate:** its copy names the provider ("which Bedrock doesn't
   list"). The platform has no provider display name — discovery resolves a base URL out of
   materialized env ([`model-discovery.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/infrastructure/model-discovery.ts)),
   and mapping that back to a connection's friendly name is inference. Name the model, not the
   provider. A provider label would be its own issue.

7. **Verify the prototype before building 4–6.** Pull the attachment from #3208
   (`issue-3022-prototype.html`) and read the Stopped and Never-run panels. The frame beats this
   prose for copy and placement.

## Acceptance criteria

- [ ] A running sandbox's Model settings behaves exactly as before — live values, editable, chat rail unchanged.
- [ ] A stopped sandbox that has run shows its last known model, mode and options, read-only, with a captured-at line and a start action.
- [ ] A sandbox that has never run shows the never-run copy, not blanks, a spinner, or a stale snapshot.
- [ ] A sandbox that has run without a model ever being chosen is distinguishable from one that has never run.
- [ ] The stale-model callout appears only when the snapshot's model is absent from its own non-null `availableModels`, and never while the sandbox is running.
- [ ] The callout names the model and does not claim a provider name.
- [ ] `mise run lint:fix` leaves the diff clean (it auto-fixes import order and `import type`).

## Smoke test

```bash
mise run check && mise run test
```

Then on the dev cluster, at `http://localhost:4444` (http — https 404s at Traefik):

1. Start a sandbox, pick a model, stop it, reload. The section shows that model read-only with
   "captured …" and a start action.
2. Create a sandbox and never start it. The section shows the never-run copy.
3. Force the callout: apply a model, let the snapshot confirm, then stop the sandbox and edit the
   stored snapshot's `availableModels` so it excludes that model. Reload — the callout appears.
   Start the sandbox and confirm it disappears.

If the page looks stale or a field reads as missing, check the served bundle before debugging — the
service worker caches an old one after `build-ui`, and an out-of-date api-server strips unknown
fields.

Print a short manual guide so the user can repeat this by hand.
