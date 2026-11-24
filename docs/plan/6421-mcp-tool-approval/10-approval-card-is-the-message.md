# 10 — The approval card reads as the message

**Depends on:** nothing new (builds on 06)
**Part of:** MCP tool approval — see [README](./README.md), section "Second round"

## Context

A held Slack post shows as a question, a tool name, a grey line and the raw text.
Slack formatting shows as stars and brackets, and the buttons do not say what will happen.
This slice makes the card read as the message it will send.

## Implementation plan

Apply `/react-ui-engineering`.
Files: `packages/ui/src/modules/approvals/` (`components/tool-call-view.tsx`, `components/slack-message-preview.tsx`, `lib/slack-target-line.ts`, `lib/tool-call-renderers.ts`, `hooks/use-approval-actions.ts`), `sessions/components/egress-approval-prompt.tsx`, `home/lib/approval-copy.ts` and the Home approval card.
The card must look the same wherever a tool-call approval shows.

1. **Title.**
   It says who wants to do what where: "Standup writer wants to post in #launch-team", with "As you, <account name>" under it.
   A reply says "in a thread", a scheduled message says when it goes out, a draft says it is saved as a draft.
2. **Message.**
   The text shows as Slack will show it, under the owner's name: bold, italic, strike, code, lists, links, mentions and channel references.
   Build the text as React nodes from the parsed marks; never set HTML from the message.
   A mark the renderer does not know shows as typed.
3. **Buttons.**
   They name the action: "Post" / "Don't post", "Schedule" / "Don't schedule", "Save draft" / "Don't save".
   A tool with no renderer of its own keeps "Allow once" / "Deny".
4. **Details.**
   The Connection, the tool name, the raw arguments and the note that the answer is for this one call move behind "Details".
5. **Other tools.**
   A tool with no renderer shows its arguments as a list of names and values, not as one JSON block; a value that is not a string or number shows as JSON.
6. **Time left.**
   The card says when the call is refused, counted from the approval's `expiresAt`.
7. **After the answer.**
   The card says what happened: "Posted in #launch-team as you", or that it was not posted and the agent was told.

## Acceptance criteria

- [ ] A Slack post, a thread reply, a scheduled message and a draft each show their own title, message and buttons.
- [ ] Slack formatting renders, and a message with HTML in it shows that HTML as text.
- [ ] A tool with no renderer shows names and values and keeps "Allow once" / "Deny".
- [ ] The chat card and the Home card show the same call the same way.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.
