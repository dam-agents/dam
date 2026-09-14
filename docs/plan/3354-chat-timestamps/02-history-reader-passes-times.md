# 02 — The Claude Code history reader passes its times through

**Depends on:** 01-runtime-stamps-live-frames
**Part of:** Chat timestamps — see [README](./README.md)

## Context

A reopened thread is rebuilt from the harness's store. For the `claude-code` image that goes
through the declared session-history reader, `harness-history-lib.mjs`, which turns Claude Code's
stored messages into `session/update` frames. Claude Code stamps every stored message with a
`timestamp`. This slice copies that stamp onto every frame the reader emits, at the same
`params._meta.platform.at` slot slice 01 pinned, so a reopened Claude Code thread shows the same
times a live one does — including threads that predate this change. Image-side code, verified by
rebuilding the image. Apply `/typescript-engineering` conventions to the `.mjs` even though it is
plain JavaScript.

## Implementation plan

1. **Read the stamp defensively** — `packages/agents/claude-code/harness-history-lib.mjs`, inside
   the `for (const message of messages)` loop in `loadHistory`. The Claude Agent SDK's
   `getSessionMessages` returns `message.timestamp` as an ISO string at runtime, but the field is
   **absent from the SDK's published `SessionMessage` type**. Treat it as optional: use it only when
   `typeof message.timestamp === "string"` and `Date.parse(...)` is finite. Otherwise emit the
   frame without `at`, exactly as today.
2. **Stamp each emitted frame** — where the loop does
   `lines.push(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: notification }))`,
   build `params` as the notification plus `_meta: { ...notification._meta, platform: {
   ...notification._meta?.platform, at } }` when `at` is known. Every notification derived from one
   stored message shares that message's stamp. Do not alter anything else the reader emits.
3. **Nothing changes on the runtime side.** The provider's line validation
   (`validateLines` in `packages/agent-runtime/src/modules/acp/infrastructure/history-provider.ts`)
   checks only `method === "session/update"` and `params.sessionId`; extra `_meta` passes.
   `serveFromProvider` appends the lines via `appendReplay`, which slice 01 left unstamped, so the
   reader's `at` is the one that reaches the log; `catchUp` merges `replayFor` beside it.
4. **Out of scope, noted for the README's harness table:** `claude-code-vm` has no runtime manifest
   and therefore no reader; `bob`, `pi-agent` and `codex` likewise. Reopened threads there keep
   showing no times. Do not add readers for them.
5. Comments: the manifest already documents the reader (`packages/agents/claude-code/runtime-manifest.yaml`).
   If the undeclared field earns a note, it is one line beside the read, no issue references.
   Run `mise run check:comment-types`.

## Acceptance criteria

- [ ] For a session whose stored messages carry `timestamp`, every line `loadHistory` returns has
      `params._meta.platform.at` equal to that message's stamp (all frames from one message share
      it); lines from a message without a usable `timestamp` have no `at`.
- [ ] Existing `_meta` on a notification, if any, is preserved and `platform.at` is merged in.
- [ ] `validateLines` accepts the stamped output unchanged (no runtime edit needed).
- [ ] A reopened Claude Code thread — including one created before this branch — shows the
      reader's `at` on its replayed frames (visible in the WebSocket frames until slice 03 renders
      it).
- [ ] `mise run check:comment-types` passes.

## Smoke test

Rebuild and load the image, then dump one session's replay by hand from inside the pod (the
manifest describes this one-liner; the `cluster-ops` skill covers exec-ing into an agent pod):

```bash
mise run cluster:build-agent
```

```bash
node -e 'import("/usr/local/lib/harness-history-lib.mjs").then(m=>m.loadHistory(process.argv[1])).then(l=>console.log(l.filter(x=>x.includes("\"at\":\"")).length+" of "+l.length+" frames stamped"))' <sessionId>
```

Take `<sessionId>` from the thread's URL in the UI, or from `~/.claude/projects/*/<id>.jsonl` in
the pod. Expect every frame stamped for a session created by the harness. Then open that thread at
`http://localhost:4444` with devtools on the ACP WebSocket: the replayed `session/update` frames
carry `"platform":{"at":"…","replayFor":"…"}`.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
