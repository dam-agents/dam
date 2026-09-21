# 03 — Fan-out contract in the SDK

**Part of:** Delegation visibility — see [README](./README.md)

## Context

The UI will recognise a fan-out from the SDK's stderr lines inside the Bash tool chip. Those
lines already carry the child id, so the contract mostly exists; this slice makes it
deliberate, adds the label to the spawn request so the record can show the same name the
driver printed, and verifies the assumption everything else rests on: the replayed chip
content still holds the lines after the driver's history is reloaded.

Apply `/typescript-engineering`.

## Implementation plan

1. **Verify first.** On the dev cluster, run the README fan-out prompt, let it finish,
   reload the driver's chat and inspect the Bash tool chip content in the UI (or the
   `session/update` frames on the ACP WebSocket). Confirm the `[invoke] spawned … -> …` and
   `[invoke] done … (…)` lines are present after replay. Claude Code shortens long Bash
   output; if the lines are cut, fix it on the SDK side by moving every progress line to a
   compact final `[invoke] summary` line printed last, and adapt the README recogniser.
   Record the outcome in this file.
2. **Label on the wire.** `packages/api-server-api/src/modules/invocations/schemas.ts:7-32`:
   add `label: z.string().min(1).max(120).optional()` to `spawnInvocationRequestSchema`.
   `packages/api-server/src/apps/harness-api-server/invocation-endpoints.ts:38-93`: pass
   it into `SpawnInput.label` (slice 02 added the field).
3. **SDK sends it.** `packages/driver-sdk/src/spawn.ts:86-93`: include `label: tag` in the
   POST body, where `tag` is what the progress lines already print. Keep the three progress
   lines exactly as they are (`spawned`, `done`, `failed`); they are now the contract, so
   name the format once in a comment-free constant and use it for all three.
4. **Skill text.** `packages/agents/claude-code/workspace/.agents/skills/dam-invoke/SKILL.md`
   `spawn(opts)` table: `label` is now also shown in the UI, so recommend a short
   meaningful one.
5. Rebuild the bundle: `mise run //packages/driver-sdk:build`. The image build copies
   `dist/driver-sdk.mjs` into every harness image (`packages/platform-base/Dockerfile`).

## Acceptance criteria

- [ ] Step 1's finding is written into this file; the README recogniser matches what replay
      actually contains.
- [ ] A spawn with `label: "six"` produces a row with `label = 'six'`.
- [ ] A spawn without a label produces a row whose label is the template id, since the SDK
      falls back to it for the tag.
- [ ] `mise run check` and `mise run test` pass (driver-sdk and api-server-api suites).

## Smoke test

`mise run test` for the SDK and api-server-api packages. Then rebuild the images and run the
README prompt on the dev cluster; confirm the two rows carry labels `six` and `eight` and
that the reloaded chip still shows both `spawned` lines.
