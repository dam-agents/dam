# 04 — The run divider for scheduled runs

**Depends on:** 03-ui-message-times-and-day-divider
**Part of:** Chat timestamps — see [README](./README.md)

## Context

In a schedule's thread, a hairline reading `Yesterday 9AM · Scheduled run` marks where each
scheduled run began. The runtime already records the start of every scheduled run to count runs and
total their duration; this slice keeps the list of those start times beside that count, hands it to
the UI on session load, pushes a live notification when a run starts while someone watches, and
places a divider at each start. Because messages now carry times, a run divider needs no match to
a message — it is placed by time, with one rule that keeps it above the run's own prompt. One
behaviour, both layers. Apply `/typescript-engineering` in the runtime and contract,
`/react-ui-engineering` in the UI.

## Implementation plan

### Contract

1. `packages/api-server-api/src/modules/acp/types.ts`: add `platformRunStartsMetaSchema`,
   `platformRunStartedParamsSchema`, `platformRunStartedNotificationSchema` and
   `buildPlatformRunStartedNotification` exactly as pinned in the README, mirroring the existing
   `platformPromptStarted*` trio. Export the new names from `packages/api-server-api/src/index.ts`.

### Runtime

2. **Keep the start times** —
   `packages/agent-runtime/src/modules/acp/infrastructure/session-metadata-store.ts`:
   - `sessionMetaEntrySchema`: add `runStarts: z.array(z.string()).optional()`.
   - `startRun(sessionId)`: take one `const stamp = now()`, write it to `runStartedAt` as today
     **and** append it to `runStarts`, capped to the newest `RUN_STARTS_CAP = 500` entries
     (evict oldest). Change the method to return the stamp it wrote, or `null` when it wrote
     nothing (the existing early return). `finishRun` is unchanged.
   - Add `runStartsOf(sessionId): string[]` to `SessionMetadataStore` (returns `[]` when unknown).
     `deps.sessionMetadata` in `acp-runtime.ts` is typed `SessionMetadataStore`, and production
     injects `notifyingSessionMetadataStore(...)` from
     `packages/agent-runtime/src/modules/acp/services/session-changes.ts`, which wraps every method
     to emit change hints. Add `runStartsOf` there and forward `startRun`'s new return value; the
     compiler will point at the wrapper as soon as the interface changes.
3. **Surface them on load** —
   `packages/agent-runtime/src/modules/acp/services/acp-runtime/session-bootstrap.ts`:
   `withReplayMeta(value, clip, turn, undelivered, superseded)` gains a `runStarts: string[]`
   argument and sets `extras.runStarts = runStarts` when non-empty. `respondFromLog` already
   sources its extras from bootstrap deps — `deps.turnInFlight(sessionId)`,
   `deps.interruptedAt(sessionId)`, and `kind === "load" ? deps.undeliveredFor(sessionId) : []`,
   `kind === "load" ? deps.supersededFor(sessionId) : []` (around line 179–186). Add
   `deps.runStartsOf(sessionId)` to `SessionBootstrapDeps` and pass it under the same
   `kind === "load"` gate. The second `withReplayMeta` call site, in `replayPage` (around line
   331, `(metadata.value, page.clip, null, [], [])`), passes `[]` — the initial load already
   delivered the list. Wire the dep where the bootstrap is constructed in `acp-runtime.ts`,
   pointing at `deps.sessionMetadata?.runStartsOf(sessionId) ?? []`.
4. **Push it live** — `packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts`,
   in `createPromptScheduler`'s `onTurnStarted` (around line 161), where
   `deps.sessionMetadata?.startRun(sessionId)` already runs behind the
   `nonViewerChannels.has(channel) && isMachineSession(sessionId)` gate: if `startRun` returned a
   stamp, build `buildPlatformRunStartedNotification({ sessionId, at: stamp })` and send the
   serialised line to every **engaged viewer** channel of that session — iterate `engagedSessions`
   as `hasEngagedViewer` does, skipping `nonViewerChannels` and closed channels. Do **not** append
   it to the transcript: it is ephemeral, like `platform/promptAccepted`, and the load response
   carries the full list for anyone who attaches later.

### UI

5. **Store** — `packages/ui/src/modules/sessions/store/sessions.ts`: add `runStarts: string[]`
   (initial `[]`), `setRunStarts(list)`, `addRunStart(at)` (no-op if present), and reset it to `[]`
   in `resetChatContext`.
6. **Load response** — `packages/ui/src/modules/sessions/hooks/use-acp-connection.ts`, where the
   load result's `_meta.platform` is parsed (`clipped`, `turn`, `undelivered`, `superseded`, around
   line 313): parse `platformMeta?.runStarts` with `platformRunStartsMetaSchema.safeParse` and, on
   success and when this load is the live one (same guard the existing `setMessages` uses), call
   `setRunStarts`. Absent or failed → `setRunStarts([])`.
7. **Live notification** — `packages/ui/src/modules/acp/ext-notifications.ts`: route
   `platform/runStarted` through `parseExtParams` with `platformRunStartedParamsSchema` to
   `{ sessionUpdate: "platform_run_started", ...p }`; add that variant to `AcpUpdate` in
   `packages/ui/src/modules/acp/types.ts`. In `use-acp-update-handler.ts`, on
   `platform_run_started` call `addRunStart(update.at)` (the viewing-session guard already applies);
   `applyUpdate` ignores it via its `default` branch.
8. **Placement** — `packages/ui/src/modules/sessions/lib/thread-items.ts`: implement the run rules
   from the README. Deduplicate `runStarts`, sort ascending. For each start `T`, place a `run`
   divider immediately before the **user** message with the greatest `at ≤ T`; if there is none,
   before the first message with `at ≥ T`; if none, at the end. Where a run divider lands, no day
   divider is placed at that gap, and a run divider before the first timed message also satisfies
   the "leading day divider" rule. Key: `run:<iso>`.
9. **Label** — `packages/ui/src/modules/sessions/views/chat-view.tsx`: pass the store's `runStarts`
   instead of `[]`; a `run` divider renders `<ThreadDivider label={`${dayLabel(at, now)}
   ${clockLabel(at)} · Scheduled run`} />`.
10. **Existing tests to update, none to add** — there is no `session-metadata-store` test (the
    only infrastructure suite is `history-provider.test.ts`, unaffected). The acp-runtime suites
    that assert on a load response's `_meta.platform` (`history-replay`, `prompt-delivery`,
    `joining`) must tolerate the new optional `runStarts`; `acp-ext-notification-routing.test.ts`
    in the UI changes only if it enumerates routed methods. Update those; add none.
11. `mise run check:comment-types`. The placement rule is documented in the README; no in-code
    comment is needed beyond, at most, a one-line `/** */` on the run-placement helper.

## Acceptance criteria

- [ ] After a scheduled fire, `$HOME/.platform/session-metadata.json` in the agent pod shows the
      session's `runStarts` containing the fire's ISO time, `runCount` unchanged in meaning, and the
      list never exceeding 500 entries.
- [ ] A `session/load` response for that session carries `_meta.platform.runStarts` with the same
      list; a session with no runs carries no `runStarts` key.
- [ ] While a viewer watches a schedule thread, a fire delivers a `platform/runStarted`
      notification to that viewer's channel with the same `at` as stored, and the notification is
      **not** present in a later replay of the log.
- [ ] `threadItems` with one run start `T` and messages `[human 08:00, agent 08:01, echo
      09:00:00.001, agent 09:00:05]` places the run divider immediately before the 09:00 echo —
      not between the echo and its answer, and not before the 08:00 message; with `T` later than
      every message it places the divider at the end; a run divider at a day change suppresses the
      day divider there.
- [ ] In the chat, each scheduled run's prompt sits directly under `<day> <clock> · Scheduled run`;
      a human message typed into the same thread gets no divider; dividers persist across a
      reopen; a fire that lands while watching adds its divider without a reload.
- [ ] `mise run //packages/api-server-api:check`, `//packages/agent-runtime:check`,
      `//packages/agent-runtime:test`, `//packages/ui:check`, `//packages/ui:test` pass with existing
      tests updated, none added; `mise run check:comment-types` passes.

## Smoke test

```bash
mise run //packages/api-server-api:check && mise run //packages/agent-runtime:check && mise run //packages/agent-runtime:test && mise run //packages/ui:check && mise run //packages/ui:test
```

Then on the dev cluster: `mise run cluster:build-agent && mise run cluster:build-ui`. On a Claude
Code agent create a **continuous** schedule with cron `* * * * *` and a short task, and open its
thread at `http://localhost:4444`. Watch one fire land: `Today <clock> · Scheduled run` appears
above the new prompt without a reload. Let a second fire land, close the tab, wait 10 s, reopen:
both dividers are present, each directly above its run's prompt. Type a message into the thread:
no divider above it. Disable the schedule afterwards. For the backend-only check, exec into the
agent pod (`cluster-ops` skill) and inspect `$HOME/.platform/session-metadata.json` for the
session's `runStarts`.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
