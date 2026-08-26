# 03 — Pod-side delivery

**Depends on:** 02-artifact-request-lifecycle
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

The agent side of a press. A new runtime-channel event kind opens or resumes that artifact's own
session and submits the prompt. This is the same mechanism a continuous schedule already uses,
with the artifact id in place of the schedule id, so the slice is mostly a second instance of an
existing pattern rather than new machinery.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Session type.** Add `Artifact: "artifact"` to `SessionType` in
   [`packages/api-server-api/src/modules/sessions/types.ts`](../../../packages/api-server-api/src/modules/sessions/types.ts).
2. **Event payload.** Add `ArtifactRequestEventPayload` (`requestId`, `artifactId`, `task`) to
   the agent-runtime contract package alongside `TriggerEventPayload`.
3. **State store.** Extend
   [`trigger-state-store.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/infrastructure/trigger-state-store.ts)
   with `getSessionForArtifact` / `setSessionForArtifact` / `clearSessionForArtifact`, persisted
   on the PVC exactly as the schedule binding is. Same file, same shape: one store, two kinds of
   binding.
4. **Plugin.** In
   [`trigger-plugin.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/drivers/trigger-plugin.ts)
   handle a new kind `artifact-request`: look up the binding, `driver.start({ task, resumeSessionId })`
   when one exists, otherwise start with `platformMeta = { type: SessionType.Artifact, mode: Chat,
   artifactId }` and record the returned session id. Always continuous — there is no fresh mode
   here.
5. **Manifest.** Register the new kind in
   [`manifest.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/manifest.ts) so
   the driver binding accepts it.

Keep the artifact path beside the schedule path rather than generalising the two into one
abstraction. They agree today by coincidence, not by contract, and a shared abstraction would
have to be unpicked the first time one of them changes.

## Acceptance criteria

- [ ] An `artifact-request` event submits its task as a prompt into a session tagged `artifact`.
- [ ] A second event for the same artifact resumes the same session id.
- [ ] An event for a different artifact starts a different session.
- [ ] An unknown event kind still throws as before.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test` (the runtime-channel suite covers the plugin's existing kinds;
the new one follows the same wiring). Then, on the dev cluster, hand-deliver an
`artifact-request` event through the runtime channel to a running agent and confirm from the pod
logs and the session list that a session tagged `artifact` was created and prompted, and that a
second event resumes it rather than opening another.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
