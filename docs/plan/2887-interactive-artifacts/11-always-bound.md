# 11 — Every page is bound: `own_session`, the brief, and self-refresh are removed

**Depends on:** 10-conversation-binding
**Part of:** Interactive Artifacts — see [README](./README.md)

## Context

Slice 10 let a page pick between two homes: the conversation it belongs to, or its own
Artifact Session. Using it showed the second home is not worth its cost. The Artifact Session
is invisible by design, starts cold, and needed two whole slices to patch that: the brief (09)
to stand in for the missing history, and self-refresh (06) to give the invisible session a
reason to exist. A grilling session settled the removal: **a page always asks in a chat, and
there is no other place a page can live.**

Two constraints were fact-checked and hold:

- **Create cannot know its session.** The platform MCP server is mounted per agent; the
  `create_artifact` call carries only the agent id. The one cheap trick — ask the pod which
  session has a turn in flight — is ambiguous by construction (chat, cron, Slack and terminal
  turns run concurrently) and unsafe for a binding pinned forever. So binding stays
  **pin-at-first-ask**, the mechanism slice 10 built.
- **The edges of pin-at-first-ask are accepted silently** (decided, not overlooked): a page
  whose link is opened in another chat can pin there; a page created by a schedule or channel
  turn pins to the first chat that asks it; a page never asked from a chat stays inert. No
  confirm UI, no harness spike.

## Implementation plan

Apply the `/typescript-engineering` skill, and `/react-ui-engineering` for UI steps.

1. **The pinned contract moves first.** The README's approach bullet, Postgres block, tRPC
   block, prompt block, caps block, failure-reason set, page API and vocabulary all change.
   Rewrite the README before writing code. 07 documents the end state.

2. **Binding has three outcomes, not four.** `resolveBinding` keeps `bound` and `pin` and
   loses both arms that produced an Artifact Session. An ask on an unbound page that offers no
   conversation is **refused** with a new named reason, `not_bound`, and the page renders it
   like any other refusal. No fallback session is ever created.

3. **Delete the Artifact Session concept end to end.** The `artifact` trigger-session kind,
   the per-artifact session binding in the pod's trigger-state-store, and the `sessionId: null`
   branch of the outbox payload all go. Delivery always resumes the bound session carried in
   the payload. The `session_deleted` check stays and is now universal: deleting a chat kills
   the interactivity of every page pinned to it, and the page stays readable as a document.

4. **Delete `own_session` and the brief.** The columns, the `create_artifact`/`update_artifact`
   params, the 8 KB cap and its shared constant, the brief-only metadata patch, the source-view
   display, and every refusal that guarded them (`own_session` on non-interactive, blank brief,
   brief on non-interactive). The branch is unmerged: edit this branch's migration in place so
   neither column ever existed.

5. **Delete self-refresh (revert slice 06's surface).** The `auto` trigger leaves the table,
   the tRPC input, the shim and the bridge: every ask is user-triggered. With it go the
   activation check (`navigator.userActivation`), the client pacing, the hidden-tab pause, the
   idle stop, the held-ask state and the indicator chip. The server caps that are not about
   automation stay: one in flight per artifact (`busy`) and the hourly cap (`rate_limited`).

6. **The prompt never inlines the page source.** The binding chat is usually the chat that
   wrote the HTML, and when it is not (the accepted edges), the artifact id in the prompt is
   enough: the agent calls `get_artifact`. With the brief gone and the source gone, one prompt
   shape serves every ask: which page, the action and payload, the request id, and the line
   that a reply in the chat is not the answer.

7. **Tool descriptions shrink to match.** `answer_artifact_request` loses the sentence about
   serving sessions that no longer exist. `create_artifact` loses `own_session` and `brief`
   and keeps the send-only-what-changed line.

8. **UI keeps what still makes sense.** The Session button stays and always opens the pinned
   chat. The refusal copy for `not_bound` tells the person to ask from the page's conversation.
   The sessions sidebar allow-list stays untouched — nothing invisible is left to expose.

Unchanged and out of scope: the trigger-channel fix and the allow-forms fix (unrelated bugs),
the postMessage/MessagePort transport, the wake rails, the 15-minute TTL and its sweep.

The open item "a failed binding ask spends the brief" disappears with the brief.

## Acceptance criteria

- [ ] `create_artifact` accepts neither `own_session` nor `brief`; the columns do not exist in
      this branch's migration.
- [ ] An ask from a docked chat pins the page; every later ask from anywhere lands in that chat.
- [ ] An ask on an unbound page with no chat open is refused `not_bound`; no session is created.
- [ ] No code path can create or resume an Artifact Session; the `artifact` trigger kind and the
      pod's per-artifact binding are gone.
- [ ] Automatic asks do not exist: no `auto` trigger anywhere in table, tRPC, shim or bridge.
- [ ] No request prompt contains the page source or a brief.
- [ ] Deleting the pinned chat settles the next ask `session_deleted`; the artifact stays
      readable as a document.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

`mise run check && mise run test`, then by hand on the dev cluster with the flag on. Have an
agent build an interview page mid-conversation: every ask lands in that chat, no HTML block and
no brief in the transcript. Open the same page from the Artifacts destination and ask again: it
answers in the original chat. Publish a page, ask it from the Artifacts destination before any
chat has asked it: refused `not_bound`. Delete the pinned chat and ask again: `session_deleted`,
page still reads. Confirm `create_artifact` refuses nothing that no longer exists (no
`own_session`, no `brief` params surfaced to the agent).

The implementing agent runs this itself, then prints a short manual smoke-test guide.
