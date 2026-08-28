# 10 — A page asks in the conversation it belongs to

**Depends on:** 09-artifact-brief
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

"One conversation per artifact" was settled early and it is right for one kind of page: the
dashboard, the poll, the status board, anything built to outlive the chat that made it. Those
pages have no conversation to belong to. Their own Artifact Session is the only sensible home.

It is wrong for the other kind. Some pages are not an appliance bolted onto a conversation, they
*are* the conversation in a different input mode: a grilling, a decision matrix, a form that
collects a spec one field at a time. A page like that is built halfway through a long thread,
answered against everything said before it, and its answers are what the rest of the thread is
about. Sending it to its own session does two kinds of damage. The session answering it cannot
see the two hours that made the page worth building. And the person cannot watch the answers
arrive, because the Artifact Session is filtered out of the session list on purpose
([`queries.ts`](../../../packages/ui/src/modules/sessions/api/queries.ts) builds an allow-list
and `artifact` is not on it under any filter).

The brief from 09 was built to patch the first half. It cannot. A paragraph written at publish
time is a lossy stand-in for a thread, and it is at its weakest exactly where the page matters
most. Nothing patches the second half at all.

So the page picks. It asks in the conversation it belongs to by default, and takes its own
Artifact Session only when it has to.

## Implementation plan

Apply the `/typescript-engineering` skill, and `/react-ui-engineering` for step 7.

1. **Bound at first ask, not at create, and here is why.** The obvious design is to bind at
   create, the way `interactive` is settled at create. It is not reachable. The platform's MCP
   server is mounted per **agent** at `/api/agents/:id/mcp`
   ([`builtin-contributions.ts`](../../../packages/api-server/src/modules/runtime-delivery/services/builtin-contributions.ts),
   [`mcp-endpoint.ts`](../../../packages/api-server/src/apps/harness-api-server/mcp-endpoint.ts)),
   written once into a config file in the agent's home by the mcp-entry plugin, and
   `registerArtifactLibraryTools` receives only `agentId`
   ([`mcp-tools.ts`](../../../packages/api-server/src/modules/artifact-library/mcp-tools.ts)).
   Nothing in that path carries an ACP session. Learning it would mean a per-session MCP
   transport, which is a harness spike, not a slice.

   The app already knows both facts. It is signed in, it renders the docked panel inside the
   chat, and the open session is `useStore(s => s.sessionId)`. So `requests.create` carries the
   open session id, the server **pins the first ask that carries one** and stores it, and every
   later ask uses the pinned one no matter where the page is opened from. An ask with no chat
   open, from the Artifacts destination, pins nothing and falls back to an Artifact Session — and
   leaves the page free to bind the next time it is asked from a chat.

   This does deviate from "settled at create". Accept it and say so: what is settled is where a
   page asks *for its whole life*, and it is settled by the first ask that has a conversation to
   offer, and never again. Pinning on the page's literal first ask was tried and reverted: one
   ask from the Artifacts destination, or from a browser tab holding a stale bundle, settled the
   page as sessionless for life with nothing said about it.

2. **Storage.** `library_artifacts.session_id`, text, nullable, written once and never
   rewritten, generated through `mise run db:generate`. Null means the page has no bound
   conversation and uses its own Artifact Session, so every artifact published before this
   change keeps behaving exactly as it does today.

3. **`own_session` at create.** `create_artifact` takes `own_session`, settled at create like
   `interactive` and unchangeable after. True means the row never takes a session id, which is
   today's behaviour, and it is the right answer for a page that must still work next month.
   Default false. Refuse it on a non-interactive artifact, for the same reason 09 refuses a
   brief on one: nothing would ever read it. Its tool description has to make the choice
   decidable from inside the create call, so frame it as lifetime, not plumbing: does this page
   belong to this conversation, or does it have to outlive it?

4. **Delivery picks the session.** The outbox payload gains the bound session id. The trigger
   plugin's `serveArtifactRequest`
   ([`trigger-plugin.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/drivers/trigger-plugin.ts))
   resumes the bound one when it is there and otherwise keeps the per-artifact binding it
   already holds in
   [`trigger-state-store.ts`](../../../packages/agent-runtime/src/modules/runtime-channel/infrastructure/trigger-state-store.ts).
   Both paths already go through `driver.start({ resumeSessionId })`, so this is a choice of
   argument, not a new path.

5. **A deleted conversation is a named failure, and the page survives it.** Deleting a session
   only writes a tombstone pod-side
   ([`acp-runtime.ts`](../../../packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts),
   [`session-metadata-store.ts`](../../../packages/agent-runtime/src/modules/acp/infrastructure/session-metadata-store.ts)),
   and `isTombstoned` is consulted in exactly one place: the filter that hides it from the
   session list. `session/resume` never checks it and the harness still holds the history. So
   without an explicit check a bound page would go on driving a conversation the person believes
   they deleted, invisibly, which is the failure this whole slice exists to remove.

   Put the check in the delivery path, which already does this job.
   [`artifact-request-delivery.ts`](../../../packages/api-server/src/modules/artifact-library/services/artifact-request-delivery.ts)
   maps typed wake failures onto named reasons; add one lookup beside it, **before** `bump`, so
   a dead conversation never leaves a stale event in the outbox. The api-server can ask directly:
   `listSessions()` on [`acp-client.ts`](../../../packages/api-server/src/core/acp-client.ts)
   returns the pod's list with tombstones already filtered out, so a pinned id missing from it
   means gone. Settle `session_deleted`.

   The artifact itself is **kept**. It stays in the library and still renders as a document, and
   only its interactivity is dead. That is the same degradation the feature already promises for
   a deleted agent, and it is why this slice needs no cascade, no sweeper and no new pod-to-server
   signal.

6. **A bound prompt is cut to the ask.** Landing in a conversation a person reads turned the
   prompt into something they have to scroll past, and most of it was already written elsewhere.
   [`artifact-request-prompt.ts`](../../../packages/api-server/src/modules/artifact-library/domain/artifact-request-prompt.ts)
   keeps only what the `answer_artifact_request` tool cannot know: the page, the action and
   payload, the request id, and one line that a reply in the chat is not the answer. Three of the
   five sentences of the old directive were already on that tool word for word, and the advice
   about building a page out of small asks belongs in `create_artifact`, where the page is written.

   For a bound page, drop the inlined source (that conversation wrote the file, and the artifact
   id on the first line is enough to read it back) and drop the line about who is waiting (a bound
   page is refused automatic asks, so a person always is). The brief rides only the ask that bound
   the page: the conversation keeps its own history, so repeating standing rules on every ask
   charges the owner for the same bytes every turn. If that conversation is later compacted the
   brief is gone from context and `get_artifact` returns it — accept that, it is the same bet
   compaction already makes about everything else in the thread.

   An `own_session` page keeps both, because its session starts cold and can see nothing else: the
   source on its first request, the brief on every one. Its tool description still has to change,
   since it currently tells the agent the serving session is never this conversation, which for a
   bound page is false. `create_artifact` also gains one line telling the agent to send only what
   changed in a payload, because a page that replays its own history pays for it every turn.

7. **Say where the answers land.** The Session button
   ([`artifact-session-button.tsx`](../../../packages/ui/src/modules/artifacts/components/artifact-session-button.tsx))
   opens whichever session the page is bound to, so the bound case needs no new component. It
   stays hidden before the first ask, when there is nothing to open. Its tooltip should name
   which conversation, because a person looking at a page months later is owed that without a
   database.

   A bound page also removes the reason the Artifact Session was invisible: the conversation is
   one the person already has open. Leave the session-list allow-list alone in this slice. If
   `own_session` pages still need a home in the sidebar, that is its own change.

8. **A bound page cannot self-refresh.** Refuse `own_session: false` together with automatic
   asks. A page polling its agent every 30 seconds inside a conversation someone is reading is
   the noise this design is otherwise careful to avoid, and self-refresh is what an Artifact
   Session is for.

9. **The pinned contract moves first.** The README's approach bullet, vocabulary, Postgres block,
   tRPC block and failure-reason set all change. Change the README before writing code, and mark
   07 as depending on this slice so the architecture pages document what ends up existing.

## Acceptance criteria

- [ ] A page asked from a docked panel binds to the open conversation on its first ask, and the
      turn appears in that conversation.
- [ ] The binding is pinned: a later ask from the Artifacts destination lands in the same
      conversation, not a new one.
- [ ] A first ask with no conversation open falls back to an Artifact Session.
- [ ] `own_session: true` never binds and behaves exactly as the feature does today.
- [ ] `own_session` on a non-interactive artifact is refused with a reason.
- [ ] An artifact published before this change keeps using its Artifact Session.
- [ ] Deleting the bound conversation settles the next ask `session_deleted`, before the event is
      queued, and leaves the artifact readable as a document.
- [ ] A bound prompt carries no inlined source; an `own_session` prompt still does on its first ask.
- [ ] A bound page is refused automatic asks.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand on the dev cluster with the flag on. Have an
agent interview you through an interactive page, mid-conversation, in a chat that already has
real context in it. Confirm every question and answer shows up in that chat as it happens, that
the agent uses what you said earlier in the thread without being re-told, and that no 128 KB
block of HTML appears in the transcript.

Then delete that session and ask again: the page still opens and reads, and the ask is refused as
`session_deleted`. Finally publish a page with `own_session: true`, confirm it gets its own
conversation and that its first ask still carries the source.

The implementing agent runs this itself, then prints a short manual smoke-test guide.
