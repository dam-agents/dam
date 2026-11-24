# 08 — Set and read a grant's tool access

**Depends on:** 07-tool-access-on-the-grant
**Part of:** MCP tool approval — see [README](./README.md), section "Second round"

## Context

Slice 07 made the gate read the grant.
This slice lets the owner set a grant's tool access and lets every client read it.
It also fixes what a new grant starts with, and keeps the Connection-wide choice working while the `mcp-tool-approval` feature is off.

## Implementation plan

Apply `/typescript-engineering`.
The contract is pinned (`setGrantToolAccess`, `AgentConnections.connections[].toolAccess`); do not change it, report a gap.

1. **`setGrantToolAccess`** (`packages/api-server/src/modules/connections/services/connections-service.ts`, replacing the placeholder).
   Only the Connection's owner may call it (`deps.repo.get(connectionId, deps.ownerId)`), and only while the owner has the feature (`toolApprovalOffered`).
   The Agent must hold the Connection, and the Connection must be one the gateway reads (`mcpServerOf` is not null).
   Drop an override equal to its group's rule, and cap the number of overrides and the length of a tool name.
   A rule that limits tool calls writes the Secret again first when it does not ask for request bodies yet, as `setToolMode` does.
2. **Read** (`getAgentConnections`).
   Each grant of a Connection the gateway reads carries `toolAccess`: the stored value, else the mapping of the Connection's mode from slice 07.
   A grant of any other Connection carries none.
3. **What a new grant starts with** (every path that grants: `setAgentConnections`, the CLI grant, agent create, starter kits).
   Feature on for the Connection's owner: store `{ read: allow, write: block }` where the Template's default mode is read only (the Slack Account), else `{ read: allow, write: ask }`.
   Feature off: store nothing, so the grant follows the Connection's mode as on main.
   A new grant never copies another Agent's access.
4. **The Connection-wide choice** (`setToolMode`).
   It stays for the feature-off Slack choice between read only and "Can post as me".
   It writes the Connection's mode and clears the access of every grant of that Connection, so all of them follow the mode again.
5. **Tests** (`__tests__/unit/connections-tool-access.test.ts` and a new topic file for the grant).
   Who may set, the refusals, normalisation, the starting access with the feature on and off, and `setToolMode` clearing the grants.

## Acceptance criteria

- [ ] The owner sets one Agent's access and no other Agent's access changes.
- [ ] Someone who is not the Connection's owner is refused, also an Editor of the Agent.
- [ ] Feature on: a new grant of a Slack Account starts read only, and of any other MCP Connection with reads allowed and writes asking.
- [ ] Feature off: a new grant and `setToolMode` behave as on main.
- [ ] `getAgentConnections` returns the access of each grant.
- [ ] `mise run //packages/api-server:check` and `mise run //packages/api-server:test` pass.
