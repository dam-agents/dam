# 02 — The Claude Code image cuts a session in place

**Part of:** A rewind keeps the session — see [README](./README.md)

## Context

This slice adds the session-cut provider: a module in the Claude Code image that cuts a closed Session's stored conversation in place, the `sessionCut` manifest field that declares it, and a runtime-side way to call it.
Nothing calls it yet; slice 03 does.

## Implementation plan

1. **Generic worker call** — `packages/agent-runtime/src/modules/acp/infrastructure/history-worker.ts` and `history-provider.ts`.
   The worker bootstrap (`WORKER_BOOTSTRAP`) calls `fn(msg.sessionId)` and posts `{id, lines}`.
   Generalize it to call `fn(msg.input)` and post `{id, result}`, and add a small `createWorkerCall({modulePath, exportName, log})` that returns `call(input, timeoutMs): Promise<unknown>`, rejecting on error and on timeout.
   Rebuild the history provider on top of it (its `validateLines` and null-on-failure stay), so there is one worker protocol.
   A timeout does not stop the call in the worker: for the cut, slice 03 treats a timeout as an unexpected failure and reloads the history, never as "nothing changed".

2. **Manifest** — `packages/agent-runtime/src/modules/runtime-channel/manifest.ts` (`runtimeManifestSchema`, beside `sessionHistory` at ~164): add `sessionCut: z.object({ module: z.string().min(1), exportName: z.string().min(1).optional() }).optional()`.
   Add the field to `HarnessRuntime` in `packages/agent-runtime/src/modules/acp/compose.ts` (~112) and pass it through in `packages/agent-runtime/src/server.ts` (~459), the same way `sessionHistory` goes through.
   In `compose.ts`, build one `SessionCutProvider` per harness beside `historyProviders` (`historyProviderOf`, ~201), and hand each lease's runtime its own (`ownHistory`, ~335), as `deps.sessionCut`:
   ```ts
   interface SessionCutProvider {
     cut(input: {
       sessionId: string;
       before: string;
       dropsTurn?: string;
     }): Promise<
       { ok: true } | { ok: false; refused: boolean; message: string }
     >;
   }
   ```
   No prestart (a cut is rare); the worker starts on first use and stays.

3. **The module** — new `packages/agents/claude-code/rootfs/usr/local/lib/harness-cut-lib.mjs`, importing the SDK from the adapter bundle as `harness-history-lib.mjs` does (`/usr/local/lib/harness/claude-code/adapter/claude-agent-sdk.js`).
   `cutSession({ sessionId, before, dropsTurn })`:
   - Read the chain with `sdk.getSessionMessages(sessionId, { includeSystemMessages: true })`; find the entry whose `uuid === before`.
     Not found → `{ ok: false, refused: true, message: "this message is not in the agent's own history" }`.
   - The cut point is the **parent** of that entry: the last chain entry before it.
     Read it from the transcript entry's `parentUuid`; `getSessionMessages` does not expose it, so read the session's JSONL line for `before` (the file sits under `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`; use `sdk.getSessionInfo` to confirm the session exists).
     The parent may be an attachment or another non-message entry; that is right, since the SDK asks for the kept turn's **last** chain entry.
   - Run `sdk.query({ prompt, options })` with `options = { cwd: process.cwd(), resume: sessionId, resumeSessionAt: parent, ...(dropsTurn && { resumeDropsTurn: dropsTurn }), persistSession: true, settingSources: [], tools: [], pathToClaudeCodeExecutable: <the CLI harness-chat names> }`, and `prompt` an async iterable that yields one `{ type: "user", message: { role: "user", content: [] }, parent_tool_use_id: null, session_id: "", shouldQuery: false }` and ends.
     Drain the iterator; the `result` message's `subtype` is `success` on a cut.
     An error whose message starts with `Resume rejected by --resume-drops-turn:` → `{ ok: false, refused: true, message: "the agent already answered this message" }`; any other error or a non-success result → `{ ok: false, refused: false, message }`.
   - The query runs with the pod's own environment, so it reaches the model router like every other harness process.
     The study saw no model call; confirm that on the cluster (no new spend row after a cut).
     Find the CLI path from `packages/agents/claude-code/rootfs/usr/local/bin/harness-chat` (it sets the executable for the bundled adapter); reuse the same variable or path.

4. **Declaration** — `packages/agents/claude-code/rootfs/app/runtime-manifest.yaml`, beside `sessionHistory` (~39): `sessionCut: { module: "/usr/local/lib/harness-cut-lib.mjs", exportName: "cutSession" }`.
   Check `packages/agents/.mise/tasks/oci` copies `rootfs/usr/local/lib/*` into the image (it copies the whole rootfs; confirm).

5. Docs: one line in `packages/agents/claude-code/` README if it lists the image's libs.

Apply `/typescript-engineering`.

## Acceptance criteria

- [ ] A manifest without `sessionCut` still loads; one with `sessionCut` and no `module` is refused.
- [ ] The history provider behaves as before on the generic worker call (existing `history-provider.test.ts` passes unchanged).
- [ ] `harness-cut-lib.mjs` cuts a real session: the dropped batch is gone from `getSessionMessages`, and the next resume answers without it.
- [ ] With `dropsTurn` naming a batch that is not the last, it returns `refused: true` and the history is unchanged.
- [ ] `mise run //packages/agent-runtime:check`, `:check:format`, `:check:lint` and `:test` pass.

## Smoke test

The existing suites: `mise run //packages/agent-runtime:test` (covers `manifest-resolve.test.ts` and `history-provider.test.ts`).

Then, in any sandbox with the image's adapter installed (`npm:@agentclientprotocol/claude-agent-acp@0.88.0` via mise), run the module against a throwaway session, the same way the feasibility study did:

1. With a node script, `query()` two turns, "Remember APPLE" then "Remember BANANA", in a scratch `cwd`.
2. `cutSession({ sessionId, before: <uuid of the BANANA user entry>, dropsTurn: <same> })` → `{ ok: true }`.
3. `getSessionMessages` shows only the APPLE turn; a resume asking "which words?"
   answers APPLE only.
4. Repeat with `dropsTurn` set to the APPLE entry while BANANA follows → `{ ok: false, refused: true }`.

Point the module's SDK import at the installed SDK for this run (an env override or a copy that rewrites the import); do not change the shipped path.
