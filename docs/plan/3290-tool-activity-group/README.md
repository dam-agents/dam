# Collapse an agent's tool activity into one group in chat

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3290

## Goal

A user can follow what an agent says without wading through what it did, and can open the detail when they want it.
Today every tool call is its own row in the chat, so a long run buries the agent's replies under hundreds of one-line rows, and one large expanded output pushes the rest of the conversation off screen.
After this feature, consecutive tool steps in a reply fold into one collapsible **activity group** that is collapsed by default.
While the turn runs, the group says what the current step does.
When the turn ends, it says what was done: the step's own description for a single step ("Sleep for 60 seconds"), or a summary by kind for several ("Ran 2 commands, read 3 files").
A preference lets the user keep groups expanded, and one expanded output is clipped to a fixed number of lines.

## Approach

The feature is UI-only, inside `packages/ui`.
No API, runtime or persistence change is involved, and no architecture page describes chat rendering, so none is updated.

How the chat renders today:

- One assistant reply is one `Message` (`packages/ui/src/types.ts`) whose `parts` interleave text, thoughts, tool chips (`ToolChip`, with `toolCallId`, `title`, `status`, `content`) and other kinds in arrival order.
  A reply with `streaming: true` is the running turn.
- `ChatMessage` (`packages/ui/src/modules/sessions/components/chat-message.tsx`) maps `parts` by index to `ChatMessagePart` (`chat-message-part.tsx`), whose `ToolPart` dispatches a tool chip to `DelegationBlock` (a sub-agent fan-out), to a renamed `ToolChip` (an await) or to `ToolChip` (`tool-chip.tsx`).
- `ActivityBlock` (`activity-block.tsx`) is the shared disclosure primitive every fold uses; `ThoughtBlock` (`thought-block.tsx`) is the model for a fold that is open while streaming and collapses when the turn ends unless the user toggled it.
- Every ACP tool call carries a standard `kind` (`read`, `edit`, `delete`, `move`, `search`, `execute`, `fetch`, `think`, `switch_mode`, `other`, or an unknown string), and Claude Code also sends a one-line `rawInput.description` per command ("Sleep for 60 seconds" for `sleep 60`).
  The projection drops both today; sub-issue 01 keeps them.
- Chips arrive through `applyUpdate` in `packages/ui/src/modules/acp/session-projection.ts` (`handleToolCall`, `patchToolChip`); the feature does not touch projection.
- UI-only preferences persist in localStorage through `readPersistedFlag` / `writePersistedFlag` (`packages/ui/src/lib/persisted-prefs.ts`) from a zustand slice, the way `sessionsSectionOpen` does in `packages/ui/src/modules/sessions/store/sessions.ts`.
  Experimental features (`modules/features`) are server-stored toggles for pre-release surfaces and are not used for a plain preference.

Decisions taken while planning:

- **Collapsed by default.** While the turn runs, the group header shows the current step with a spinner, so the user sees what the agent is doing now without the history.
  When the turn ends the group collapses to a one-line summary.
- **Group per run of steps, not per session.** Consecutive tool chips inside one reply fold into one group; text the agent writes between steps stays in place.
  Delegation blocks and thinking blocks stay outside the group.
- **Clip one expanded output** to a fixed number of lines with a "Show all" control; copy keeps the full text.
- **Kind summary.** A finished group names what was done by `kind`, in order of first appearance, with one verb per kind (table in sub-issue 01); "commands" names only `execute` steps, and MCP or unknown tools count as "tools".
- **A one-step group** shows that step's description when the harness sent one, else the kind summary ("Ran 1 command").
- **No model call.** Group labels come only from what the harness sends; nothing condenses several steps into an intent.
- **Design** is the approved canvas: https://claude.ai/artifact/A6VZscj4u7JuAFyYKnSVYJ (no icon and no accent colour on the group; the live line in Plex Sans from the description, raw command in Plex Mono when there is none; a "step N" counter).

## Sub-issues

| #  | Title                    | Scope                                                                                                   | Depends on |
|----|--------------------------|---------------------------------------------------------------------------------------------------------|------------|
| 01 | Activity group           | Fold consecutive tool chips in a reply into one collapsible group with a live header and a summary     | —          |
| 02 | Tool activity preference | Settings › Appearance switch that makes groups expanded by default, persisted in localStorage           | 01         |
| 03 | Expanded output cap      | Clip one step's expanded output to a fixed number of lines with "Show all"                              | —          |

## Conventions & glossary

- **Step**: one tool call chip (`ToolChip` part) in a reply.
- **Activity group**: a run of consecutive steps in one reply, rendered as one fold.
- **Running turn**: an assistant message with `streaming: true`.
- **Kind summary**: the deterministic "Ran 2 commands, read 3 files" line.
- Apply `/react-ui-engineering` to every change.
  Apply the `frontend-design` plugin skill (`/frontend-design:frontend-design`) when shaping the group's header and the clipped output, so the result is a deliberate design and not a stack of default rows.
  Icons come from `@carbon/icons-react`.
- Never hardcode the brand; nothing in this feature needs it.
- Comments follow `docs/guidelines/comment-guidelines.md`; run `mise run check:comment-types` after each slice.
- Verification is the existing suite (`mise run //packages/ui:check`, `mise run //packages/ui:test`) plus a manual smoke test on the Vite dev server (`mise run //packages/ui:dev`, http://localhost:5173) against the local cluster.
  The implementer does not author new tests unless a slice says so.

## Whole-feature smoke test

1. Run the UI dev server against the local cluster and open an agent with a long past session (one that ran many tool calls, e.g. a knowledge base ingestion).
2. The session shows the agent's text replies with one collapsed group between them where tool rows used to be, each with its kind summary, or the step's description when it holds one step; delegation blocks and thinking blocks are unchanged.
3. Send a prompt that makes the agent run several commands (e.g. "list the files in three directories, one command each").
   While it runs, the group header shows what the current step does with a spinner; when the reply ends it reads "Ran 3 commands".
4. Open the group and open one step with a long output: the output is clipped with a "Show all" control, and the copy button copies the whole text.
5. In Settings › Appearance, switch tool activity to expanded; reload the session: groups open by default.
   Switch back; they are collapsed again.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/3290.
