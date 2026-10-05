# 02 — Re-apply the snapshot when the image's driver bindings change

**Depends on:** 01-pi-mcp-entry-override (only for the Pi smoke test; the code is independent)
**Part of:** Pi agents get the platform's MCP tools — see [README](./README.md)

## Context

An agent's applied cursor (version + state hash) lives on its PVC and survives an image
update. After 01, a Pi agent that already exists boots the new image and reports a cursor
that is up to date. The api-server does not dispatch, and even a push would skip the drivers
because the hash is unchanged. So the new `mcp-entry` binding never writes
`~/.pi/agent/mcp.json`, and the agent stays without tools until some grant changes. This slice
makes the agent-runtime detect that its contribution-driver bindings changed since it last
applied, and reset its cursor at boot. The normal `hello` catch-up then pushes the snapshot,
and every driver runs again. The mechanism is general: it covers any future binding change on
any image.

## Implementation plan

Apply the `/typescript-engineering` skill. Read the `hello` section and the invariants of
[runtime delivery](../../architecture/runtime-delivery.md) first.

1. **Fingerprint (pure).** In the runtime-channel module, beside `contributionDrivers` in
   `packages/agent-runtime/src/modules/runtime-channel/manifest.ts`, or in a small sibling
   file if that reads better, add a function that maps the resolved contribution bindings
   (`Record<string, DriverBinding>`) to a stable string: a sha256 of a canonical JSON with
   object keys sorted recursively. Sorted keys make sure that a YAML key reorder alone does
   not trigger a re-apply. Fingerprint only the contribution kinds (`contributionDrivers`).
   Events are not snapshot state, so a change to an event binding needs no re-apply.
2. **Runtime state field.** In
   `packages/agent-runtime/src/modules/runtime-channel/state-store.ts`, add an optional
   recorded fingerprint to `runtimeStateSchema`, for example
   `bindingsFingerprint: z.string().nullable().catch(null).default(null)`. Add it to `initial`
   too. An old state file without the field must parse to `null`, never fail.
3. **Reset at boot.** In `composeRuntimeChannel`
   (`packages/agent-runtime/src/modules/runtime-channel/compose.ts`), after
   `contributionBindings` is resolved, compute the fingerprint and read the state store. If the
   recorded fingerprint differs (including `null`), write in one store write:
   - `lastAppliedVersion: 0` and `lastAppliedHash: null`. This is the existing "never applied"
     state. `hello` already sends `lastAppliedVersion || undefined`, so the api-server sees the
     agent as behind and enqueues a dispatch. The worker always pushes the current row
     version, and `applyState` sees a hash change and runs every driver.
   - the new fingerprint.
   - `eventRuns` unchanged. Event dedupe must survive, or settled events fire again.

   Log one line that names the old and new fingerprint prefixes, in the existing
   `[runtime] …` style. Then the reset is visible in the pod log.
   If the pod dies before the re-apply, the next boot sees a matching fingerprint but a cursor
   that is still 0. It is still behind, so the reset needs no second marker.
4. **Accept the stale-guard gap.** Until the re-apply lands, the agent accepts a push of any
   version, because its local version is 0. A brand-new agent is in the same state. The
   hello-triggered push carries the current version, and the next push or sweep corrects any
   older one. Do not add machinery for this.
5. **Architecture page.** Update [runtime delivery](../../architecture/runtime-delivery.md),
   bump `Last verified:`, and follow the
   [documentation guidelines](../../guidelines/documentation-guidelines.md). Say it
   semantically, not with field names:
   - In the `hello` section: an agent whose image binds its contribution drivers differently
     from the bindings it last applied with reports itself as never applied. So the first
     boot after such an image change re-delivers and re-applies the full snapshot.
   - In the invariants bullet "State snapshots are idempotent…": a change to the image's
     contribution bindings also forces one full re-apply. That re-apply is safe because
     drivers tolerate repeated apply.
6. Run `mise run check:comment-types` after the code change.

## Acceptance criteria

- [ ] With an unchanged image, a restart does not reset the cursor. `hello` reports the stored
      version, and the api-server logs no dispatch for a caught-up row.
- [ ] After a change to a contribution binding (for example 01's Pi manifest, or a local edit
      to any image's `mcp-entry` binding), the first boot logs the reset. `hello` reports no
      cursor, and the next `applyState` logs `hash changed … dispatching N contribution(s)`.
- [ ] `eventRuns` survives the reset. No settled trigger or seed event fires again.
- [ ] An old runtime-state file without the new field loads without error and resets once.
- [ ] `mise run //packages/agent-runtime:test` and `mise run check` pass.
- [ ] `runtime-delivery.md` describes the re-apply on a binding change, and its
      `Last verified:` is today's date.

## Smoke test

1. `mise run //packages/agent-runtime:test` and `mise run check`.
2. On the local dev cluster (read the `cluster-ops` skill first), on the cluster's current
   main images, create a Pi agent and let it settle. In its terminal, `pi mcp list` prints
   "No MCP servers configured", and `~/.pi/agent/mcp.json` does not exist.
3. Build and roll the branch's agent images: `mise run cluster:build -- agents`. Check that
   the pod restarted on the new image (pod AGE, image ID). Do not trust the exit code.
4. Without any grant change:
   - The agent-runtime log (`mise run cluster:logs` or the pod log) shows the binding-reset
     line, then a `[runtime] hello → local v=0` line, then `[applyState] hash changed …
     dispatching`.
   - `~/.pi/agent/mcp.json` now holds `platform-outbound` with `"exposure": "direct"`, and
     `pi mcp list` shows it connected.
5. Restart the same agent again. The log shows no reset line, and `hello` reports the
   applied version.
6. On a Claude Code agent restarted on the same new images, check the log. It resets once on
   its first boot after the rollout, because it had no recorded fingerprint. It does not reset
   on a second restart.

Then print a short manual guide so the user can repeat steps 2–5 by hand.
