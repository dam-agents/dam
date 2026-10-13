# 01 — Activity group

**Part of:** Collapse an agent's tool activity into one group in chat — see [README](./README.md)

## Context

Consecutive tool chips inside one assistant reply fold into one collapsible group.
Collapsed, the group is one line: a kind summary of what happened ("Ran 2 commands, read 3 files, 1 failed") or, while the turn runs, what the step in progress does, with a spinner and a "step N" counter.
Open, it lists the steps exactly as today, each still its own fold.
The group opens and closes only when the user toggles it, and keeps each step's open state across streaming updates.

## Implementation plan

Apply `/react-ui-engineering`.
The design is the approved canvas linked in the README.

0. **Keep `kind` and the description**: in `packages/ui/src/types.ts` add `toolKind?: string` and `description?: string` to `ToolChip`.
   In `packages/ui/src/modules/acp/session-projection.ts`, `handleToolCall` and `patchToolChip` set `toolKind` from `u.kind` and `description` from `u.rawInput?.description` when it is a non-empty string (later updates win, as for `title`).
1. **Grouping**: add `packages/ui/src/modules/sessions/lib/activity-groups.ts` with a pure function that turns `MessagePart[]` into render items: `{ kind: "part", part, index } | { kind: "group", chips: ToolChip[], firstIndex }`.
   A group holds a maximal run of consecutive `kind: "tool"` parts.
   A tool chip that `ToolPart` would render as a `DelegationBlock` (a sub-agent fan-out, see `useOwnedSpawns` in `packages/ui/src/modules/invocations/components/delegation-owners.tsx`) must stay a standalone part; since ownership comes from context, do the split in the component (step 3) or pass a predicate into the function.
   A run of one chip is still a group, so every tool row reads the same way.
2. **Group component**: add `packages/ui/src/modules/sessions/components/activity-group.tsx`, built on `ActivityBlock` (`activity-block.tsx`).
   - Props: `chips: ToolChip[]`, `defaultOpen: boolean` (false for now; sub-issue 02 wires the preference).
   - Open state: `useState(defaultOpen)`; the group never opens or closes by itself.
   - Header label while any chip is `pending` / `in_progress` / `running`: a `Spinner`, the last running chip's `description` in the sans face (or its `title` in `font-mono` when it has none), truncated, then a `text-2xs tabular-nums` "step N" counter where N is that chip's position in the group.
   - Header label otherwise: for a one-chip group with a `description`, that description; else the kind summary from a pure `kindSummary(chips)` in `activity-groups.ts`; plus ", M failed" in `text-danger` when any chip has `status === "failed"`.
     Count chips per kind in order of first appearance and join the phrases with ", ", capitalising the first:

     | kind | one | many |
     |---|---|---|
     | execute | ran 1 command | ran N commands |
     | read | read 1 file | read N files |
     | edit | edited 1 file | edited N files |
     | delete | deleted 1 file | deleted N files |
     | move | moved 1 file | moved N files |
     | search | searched once | searched N times |
     | fetch | fetched 1 page | fetched N pages |
     | think | thought once | thought N times |
     | switch_mode | switched mode | switched mode N times |
     | other, unknown, absent | used 1 tool | used N tools |
   - No icon and no accent colour on the group.
   - Children: the chips, each rendered through the existing `ToolPart` dispatch so await chips keep their renamed titles.
     Key each child by `chip.toolCallId ?? firstIndex + i` so a child's open state survives new chips streaming in.
   - Actions: a `CopyButton` that copies the step titles joined by newlines, labelled "Copy steps".
3. **Wire it in** `packages/ui/src/modules/sessions/components/chat-message.tsx` at the `parts.map` (around line 178): for an assistant message, render the grouped items instead of the flat parts.
   `ChatMessagePart` keeps handling every non-tool part and the standalone fan-out chip; export `ToolPart` from `chat-message-part.tsx` (or move it next to the group) so the group can render its children.
   `isLast` keeps its meaning for the last rendered item.
   User messages are not grouped.
4. **Status settling** needs no change: `settleRunningTools` in `session-projection.ts` already marks chips when a turn ends, so a finished group never shows a spinner.
5. Run `mise run //packages/ui:check`, `mise run //packages/ui:test` and `mise run check:comment-types`.

## Acceptance criteria

- [ ] A reply whose parts are `text, tool, tool, tool, text` renders as text, one group of three steps, text.
- [ ] A reply with a sub-agent fan-out chip keeps its `DelegationBlock` outside any group.
- [ ] A finished one-step group whose chip has a description shows the description.
- [ ] A finished group of two `execute` and three `read` chips reads "Ran 2 commands, read 3 files", with ", 1 failed" added when one failed; an MCP chip counts as "used 1 tool".
- [ ] While the turn runs, the collapsed group shows a spinner, the running step's description (or its title in mono), and "step N".
- [ ] A step the user opened stays open while later steps stream into the same group.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.

## Smoke test

Run `mise run //packages/ui:test` and `mise run //packages/ui:check` in the worktree.
Then start `mise run //packages/ui:dev` against the local cluster, open an agent session, and send "run `ls` in /, /tmp and /etc, one command each".
Expect one group line with a spinner, the running command's description and "step N" while the reply streams, then "Ran 3 commands" when it ends; open it and the three rows are there.
Open a session with a past sub-agent fan-out: the delegation block renders as before.
