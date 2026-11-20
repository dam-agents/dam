# 06 — Tool-call approval views

**Depends on:** 03-hold-tool-call
**Part of:** MCP tool approval — see [README](./README.md)

## Context

A tool-call approval has to show wherever network approvals show, with the tool and its arguments, so the person who answers knows exactly what the agent will do.
The generic view is the tool name plus the arguments as JSON.
A Template can render its own tools better: Slack first, where a call that posts shows the channel and the message as it will appear.
The verdicts are approve once and deny once only.

## Implementation plan

Apply `/react-ui-engineering`.
The `web_search` approval is the model: every UI file that handles it needs the new type too.

1. **Copy and actions** (paths under `packages/ui/src/modules/`).
   - `home/lib/approval-copy.ts`: `approvalHeadline` ("<agent> wants to use <tool> on <connection>"), `approvalPromptTitle`, `approvalDetail`, `approvalReason`, `approvalHideHint` for `mcp_tool_call`.
   - `approvals/hooks/use-approval-actions.ts`: liveness, an `mcpToolCallActions` with approve once and deny once only, the `match(row.type)` that `.exhaustive()` forces, and `expiredNote`.
   - `approvals/lib/waiting-egress.ts` (`egressApprovalsWaiting`): include `mcp_tool_call`, so the chat cards show it.
   - `approvals/lib/group-approvals.ts` (`approvalGroupKey`): group by `payload.key`.
2. **The arguments view.**
   New `approvals/components/tool-call-view.tsx`: picks a renderer by `payload.templateId` and `payload.tool` from a small registry (`approvals/lib/tool-call-renderers.ts`), else the generic view.
   Generic view: the tool name and the arguments pretty-printed in a scrollable code block; when `argumentsBytes` is larger than the shown JSON, a line says the arguments were cut and how large they are.
   When the payload has no `arguments` (settled or expired), say so instead of an empty block.
3. **Slack renderers** (in the registry, keyed by Template id `slack`).
   Read Slack's real `tools/list` on the dev cluster (or the stored `toolAccess.tools` from slice 02) for the exact write tool names and argument names before you write them; #6760 noted its read-tool names were never checked against the server.
   At least the tool that posts a message: the target channel or person, "as you", and the message text rendered as plain text with line breaks (no Slack markup parsing in this slice).
   Any other Slack tool falls back to the generic view.
4. **Surfaces.**
   Use `ToolCallView` in `home/components/feed-approval-card.tsx` (`FeedApprovalCard`), `home/components/approvals-panel.tsx` (list and drawer), `sessions/components/egress-approval-prompt.tsx` (`EgressApprovalPrompt`, the chat card under `chat-network-approvals`) and the side panel's approvals tab.
   Toasts (`home/hooks/use-approval-toasts.tsx`) use the headline only.
   `sessions/components/quiet-turn-line.tsx` reads the waiting filter, so check it still says the right thing.
5. **Profiles.**
   QA profile [`.quality-inspector/qi-profile-dam/SKILL.md`](../../../.quality-inspector/qi-profile-dam/SKILL.md): a waiting tool-call approval in the conversation and on Home, its once-only verdicts, and the Slack view.
6. **Docs.**
   [home-feed.md](../../architecture/home-feed.md) and [chat-view.md](../../architecture/chat-view.md) if they list what an approval card shows; [connections.md](../../architecture/connections.md): a Template may render its tool calls.

## Acceptance criteria

- [ ] A waiting `mcp_tool_call` approval shows on Home, in the approvals panel and drawer, in a toast and, with `chat-network-approvals` on, as a card in every open conversation of the Agent.
- [ ] Every surface offers approve once and deny once and nothing else.
- [ ] The generic view shows the tool and its arguments, and says when they were cut.
- [ ] A Slack call that posts shows the target and the message text.
- [ ] Two waiting approvals with the same key show as one with a count.
- [ ] A settled approval shows no arguments and says why.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

- `mise run //packages/ui:test`.
- On the dev cluster, `cluster:build ui` and a hard reload: with a generic MCP Connection and a Slack Account both in needs approval, ask an agent to call a tool on each; check the cards on Home and in the chat, approve one and deny the other, and capture screenshots for the PR body.
