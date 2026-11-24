# 09 — Tool access dialog and rows

**Depends on:** the pinned contract (builds in parallel with 07 and 08)
**Part of:** MCP tool approval — see [README](./README.md), section "Second round"

## Context

With the `mcp-tool-approval` feature on, the owner sets tool access for one Agent on one Connection.
The Connections page row goes back to the account only, and the per-agent access shows inside the row.
With the feature off every screen stays as on main.

## Implementation plan

Apply `/react-ui-engineering`.
Do not edit `packages/api-server-api`; build against the pinned types and report a gap.
All of this is behind `useToolApprovalOffered()`.

1. **Lib** (`packages/ui/src/modules/connections/lib/`, a new `grant-tool-access.ts`).
   The rule of a tool (override, else its group), and the summary of an access with its tone: "Read only", "Asks before writing", "Allows everything", "Blocks everything", else the counts ("Asks before 5 tools · 1 writes without asking · 1 blocked").
   The tone is a warning where a write tool is allowed without asking.
2. **Dialog** (`components/connection-tool-access-dialog.tsx`).
   Feature on: it opens for one Agent and one Connection, and its subtitle names both.
   Two group rows, "Tools that read" and "Tools that post or change", each with an Allow / Ask / Block control and a count.
   A group opens to its tools, each with the same control; a tool that differs from its group shows as an exception with a reset, and a closed group names its exceptions.
   One line says a tool the server adds later follows "Tools that post or change".
   The tool list keeps "Tools listed …" and Refresh (`refreshTools`).
   Save calls `setGrantToolAccess` and invalidates `getAgentConnections`.
   Feature off: the dialog stays as it is, for the Slack choice.
3. **Agent's Connections** (`packages/ui/src/modules/sandboxes/components/granted-connections-panel.tsx`, `connections-section.tsx`, and the shared row in `connections/components/`).
   Same rows as on main.
   Feature on: the line under the name says this Agent's access, "Tool access" shows as a button on the row and opens the dialog for this Agent, and the mark "Writes without asking" shows where it applies.
4. **Connections page** (`components/connection-used-by.tsx`, `catalog-connection-row.tsx`, `connection-row-actions.tsx`, `full-access-mark.tsx`, `connection-row-detail.tsx`).
   Feature on: the row drops the mode pill, the mode sentence and the "Tool access" button.
   "Used by N agents" opens a list inside the row, not a popover: one line per Agent with its name, its access and "Tool access".
   Agents that write without asking come first; a list longer than six shows "Show N more".
   The row carries the mark "N agents write without asking" only where it applies.
   Feature off: the popover with names stays.
5. **Connect forms** (`forms/tool-mode-field.tsx` and where it renders).
   Feature on: no mode question at connect, for a Slack Account and for a custom MCP server.
   Feature off: the Slack two-way choice stays.
6. **Other readers of the mode** (`agents/hooks/use-agent-shared-access.ts`, `agents/components/bind/bind-sharing-text.tsx`, `agents/hooks/use-bind-sharing-confirm.tsx`, `components/channel-connection-explainer.tsx`, the chat plus menu's `quick-connection-group.tsx`).
   Where they speak about one Agent, they read that Agent's grant.

## Acceptance criteria

- [ ] Feature off: the Connections page, the Agent's Connections and the connect forms look and behave as on main.
- [ ] Feature on: changing access for one Agent changes that Agent's row only.
- [ ] A group control and a tool exception both save and show again after a reload.
- [ ] "Used by" opens inside the row and holds twelve Agents without crowding.
- [ ] `mise run //packages/ui:check` and `mise run //packages/ui:test` pass.
