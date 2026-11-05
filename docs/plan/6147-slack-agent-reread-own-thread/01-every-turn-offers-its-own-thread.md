# 01 — Every turn offers its own thread

**Part of:** A Slack agent can read and link the thread it is answering in — see [README](./README.md)

## Context

An agent can read its own Slack thread with `read_thread` only by chance: a fresh turn offers the thread only when its history was cut short, and a resumed turn never offers it.
This slice makes every turn in a thread offer that thread, so `read_thread` always accepts the thread the agent is answering in, and the 48 h count from the newest turn there.
It also corrects the copy that tells the agent what it can read.

## Implementation plan

Apply the `/typescript-engineering` skill (code mode).
All code changes are in `packages/api-server/src/modules/channels/infrastructure/slack.ts` unless stated.

1. **Fresh turn.**
   In `buildThreadPrompt`, the `noteOfferedThreads` call offers `ctx.threadTs` only when `threadWindow.cursor !== null`.
   Offer it whenever `ctx.hasThread` is true.
   Keep the channel-window markers (`offeredHere`) as they are.
2. **Resumed turn.**
   In `buildCatchUp`, offer `ctx.threadTs` when `ctx.hasThread` is true, on every call.
   Put the write before the `try`, so that the early return for an empty catch-up (`lines.length === 0`) and a failed catch-up read still offer the thread.
   Keep the existing `noteOfferedThreads(…, offeredHere)` for the catch-up block's markers.
3. **One owner for the rule.**
   Both builders now offer the turn's own thread.
   Give that one rule one helper next to `noteOfferedThreads` (for example `noteTurnThread(ctx)`), and call it from both builders, so the two paths cannot drift.
   Both builders serve the addressed path and the read-along path (`runSessionTurn` call sites near the two `buildCatchUp` calls); do not add a third call site.
4. **Refusal copy.**
   `readThread` refuses an unoffered thread with "… If someone wants you on an older thread, ask them to reply in it — it will reach you with its full history".
   That promise is false: a reply brings only the catch-up since the agent's last turn.
   Rewrite the refusal so it says what is readable (the thread you are answering in, a thread you started, a thread from a `[thread: …]` tag in your history; tags age out) and what helps (ask a person to tag you in that thread, which makes it readable).
5. **Tool description.**
   In `packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts`, the `read_thread` description says "Read the replies inside a Slack thread you were shown … Only threads from such tags are readable".
   Add that it also reads the thread you are answering in (pass the `threadTs` shown in your turn's instructions) and a thread you started with `start_thread`.
   Update the `threadTs` parameter description the same way.
6. **Capped catch-up in a thread.**
   When a thread's catch-up is capped, `catchUpLegend` says "Some messages from this gap were left out, so this is not everything you missed".
   In a thread's catch-up, add that `read_thread` with this thread's `ts` reads them.
   `catchUpLegend` lives in `packages/api-server/src/modules/channels/infrastructure/agent-footer.ts`; pass it the thread `ts` only for a thread's catch-up, and leave the channel case as it is.
7. **Existing tests.**
   Update expectations that pin the old copy, for example the `unoffered` refusal in `packages/api-server/src/__tests__/unit/slack-thread-visibility.test.ts`.
   Do not add tests.
8. **Docs** (one sentence per line, simple words):
   - `docs/architecture/channel-turns.md`:
     in "Injected history says what it is", the sentence "the thread counts as offered to that Agent so the handle is honoured" becomes a statement that every turn offers the thread it runs in.
     The `read_thread` bullet stops calling it a tool for "a thread the Agent is not inside": it reads the thread the Agent is answering in, a thread it owns, and a thread it was shown.
     Its "Its reach is what the platform offered" sentence adds that the platform offers each turn's own thread, so the 48 h count from the newest turn there.
     Keep the restart limit.
   - `docs/architecture/slack-guarantees.md`:
     the "Can read" row adds the thread the agent is answering in;
     the capabilities row "`read_thread` only on threads it was shown, 48 h" names the thread it is answering in;
     the row "After an api-server restart: re-answers old messages, or can't read a thread it was just shown" says a restart clears the offer until the next turn in that thread.
   - Update `Last verified:` on each page you change, per the documentation guidelines.

## Acceptance criteria

- [ ] On a fresh turn in a thread that fits one history read, `read_thread` with that thread's `ts` returns the thread instead of a refusal.
- [ ] On a resumed turn with nothing new to catch up, `read_thread` with the turn's thread `ts` returns the thread.
- [ ] After the offer map is cleared (api-server restart), the next turn in the thread makes it readable again.
- [ ] A thread the agent was never shown and is not answering in is still refused.
- [ ] A thread whose conversation is no longer bound to the agent is still refused.
- [ ] The refusal no longer promises "full history", and says that a tag in the thread makes it readable.
- [ ] A capped catch-up in a thread names `read_thread` and the thread's `ts`; a channel's capped catch-up is unchanged.
- [ ] `channel-turns.md` and `slack-guarantees.md` describe the new reach.
- [ ] `mise run //packages/api-server:test`, `mise run check` and `mise run check:comment-types` pass.

## Smoke test

1. Run `mise run //packages/api-server:test` and `mise run check`.
2. On the local dev cluster with Slack wired (`cluster-ops` skill), install the branch's api-server.
3. Post a top-level message in a channel bound to an agent, reply once in its thread, then tag the agent in the thread and wait for its answer.
4. Restart the api-server: `mise run cluster:kubectl -- rollout restart deploy/platform-apiserver`, then `mise run cluster:kubectl -- rollout status deploy/platform-apiserver`.
5. Tag the agent in the same thread: "Use read_thread on this thread and quote its first reply word for word."
6. Expect the quote in its answer, and a success line in `mise run cluster:kubectl -- logs deploy/platform-apiserver --since=10m | grep channel.thread_read`.
   On `main`, the same step logs a failure with "not a thread you were shown".

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
