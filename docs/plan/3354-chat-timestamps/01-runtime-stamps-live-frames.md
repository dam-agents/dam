# 01 — Runtime stamps live frames with their time

**Part of:** Chat timestamps — see [README](./README.md)

## Context

Every frame the agent-runtime appends to a session log while a turn happens gets the wall-clock
time at `params._meta.platform.at`. That covers the three live producers in one place — the
harness's own `session/update` frames, the runtime-built user echo, and the runtime-built
`platform/turnEnded` — because all three enter the log through `transcript.append` /
`transcript.appendEcho`. Replayed frames (`transcript.appendReplay`) are never stamped: they carry
whatever their source put there, or nothing. This slice also pins the contract field the UI will
read in slice 03. Apply `/typescript-engineering`.

## Implementation plan

1. **Contract** — `packages/api-server-api/src/modules/acp/types.ts`: add `platformFrameMetaSchema`
   and `PlatformFrameMeta` exactly as pinned in the README (`at` and `replayFor`, both optional).
   Place it beside `platformClippedReplayMetaSchema`. Export both from
   `packages/api-server-api/src/index.ts` next to the other `Platform*` exports (around the
   `PlatformTurnEndedParams` line).
2. **Transcript stamping** —
   `packages/agent-runtime/src/modules/acp/services/acp-runtime/session-transcript.ts`:
   - Generalize `stampReplayFor(line, token)` into `withPlatformMeta(line, patch)`: same parsing
     and same shape (`params._meta.platform`), but it merges an arbitrary patch object. Keep its
     current tolerance — an unparseable or non-object line is returned unchanged.
   - Add `now?: () => string` to `SessionTranscriptDeps`, defaulting to
     `() => new Date().toISOString()` (same convention as `createSessionMetadataStore`).
   - In `append` and `appendEcho`, stamp before fanning out:
     `fanOut(sessionId, withPlatformMeta(line, { at: deps.now() }), …)`. Leave `appendReplay`
     exactly as it is — no stamp.
   - `catchUp` and `replayPage` keep calling the helper with `{ replayFor }`. Because the merge
     spreads the existing `platform` object, a stored `at` survives replay unchanged.
   - Stamping lives in the transcript, not at the producers, so no change is needed in
     `acp-runtime.ts` (`appendUserPromptToLog`, the `platform/turnEnded` append, or the live
     agent-frame append). Do not touch them.
3. **Compose** — `packages/agent-runtime/src/modules/acp/compose.ts` constructs the transcript;
   pass nothing for `now` in production. The dep exists for tests that pin frame strings.
4. **Tests that already exist** — the acp-runtime suites under
   `packages/agent-runtime/src/modules/acp/services/acp-runtime/__tests__/` drive the runtime via
   `acp-world.ts` and assert on parsed frames (no byte-for-byte string comparison exists). Five of
   them reference `_meta` or `platform/turnEnded` — `prompt-delivery`, `joining`,
   `history-replay`, `history-provider`, `headless-runs`. Any `toEqual` on a live frame's
   `params._meta` now sees an added `platform.at`. Fix by injecting a fixed `now` through the world
   (thread the new transcript dep) or by loosening to `expect.objectContaining`. Replayed frames in
   `history-replay` / `history-provider` must remain **unstamped** — those assertions are the
   guard for step 2's "never on `appendReplay`". Update tests; add none.
5. **Architecture page** — `docs/architecture/agent-lifecycle.md` §Session inside the pod: one
   sentence stating that live log entries carry `params._meta.platform.at` and that replayed
   entries carry only what their source supplied. Bump `Last verified`. Follow
   `docs/guidelines/documentation-guidelines.md`.
6. Run `mise run check:comment-types`. The helper needs no comment; if `withPlatformMeta` earns
   one, it is a `/** */` block, one line, no issue references.

## Acceptance criteria

- [ ] `platformFrameMetaSchema` parses `{ at: "2026-09-14T09:00:00.000Z", replayFor: "x" }`, `{}`,
      and `{ replayFor: "x" }`; it rejects a non-ISO `at`.
- [ ] A frame passed to `append` or `appendEcho` reaches every engaged channel with
      `params._meta.platform.at` set to the transcript's `now()`; the stored log entry carries the
      same value, so `catchUp` and `replayPage` deliver it unchanged, with `replayFor` merged in
      beside it.
- [ ] A frame passed to `appendReplay` reaches the log and later replays **without** an added
      `at`; if its source already carried `params._meta.platform.at`, that value is preserved.
- [ ] A frame that already has other `_meta` keys (for example the echo's `update._meta.queued`)
      keeps them.
- [ ] `mise run //packages/api-server-api:check`, `mise run //packages/agent-runtime:check` and
      `mise run //packages/agent-runtime:test` pass with existing tests updated, none added.
- [ ] `mise run check:comment-types` passes.

## Smoke test

```bash
mise run //packages/api-server-api:check && mise run //packages/agent-runtime:check && mise run //packages/agent-runtime:test
```

Then a live check on the dev cluster: `mise run cluster:build-agent` (Rancher Desktop must be
running), open a Claude Code agent at `http://localhost:4444`, open the browser devtools Network
tab, select the `/api/agents/<id>/acp` WebSocket, and send a prompt. Every incoming
`session/update` frame and the `platform/turnEnded` frame carry `"platform":{"at":"…"}` under
`params._meta`. Close the tab, reopen the thread, and look at the replayed frames for the same
session: the ones that came back through the harness's own `session/load` carry **no** `at` (slice
02 changes that for Claude Code), and the ones tagged `replayFor` carry it beside the token when
the source had one.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
