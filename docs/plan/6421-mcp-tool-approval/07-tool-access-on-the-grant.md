# 07 — Tool access on the grant

**Depends on:** 01 to 06 (already on the branch)
**Part of:** MCP tool approval — see [README](./README.md), section "Second round"

## Context

The mode lives on the Connection, so one change reaches every Agent that holds it.
This slice moves the choice to the grant: one Agent on one Connection has its own tool access, and each tool is allow, ask or block.
The gate decides per tool from the grant.
Nothing a person sees changes in this slice.

## Implementation plan

Apply `/typescript-engineering`.
The contract is pinned in `packages/api-server-api/src/modules/connections/types.ts` (`ToolRule`, `GrantToolAccess`); do not change it, report a gap.

1. **Storage** (`packages/db`).
   Add a nullable `tool_access jsonb` column to `connection_grants` (`src/schema.ts`, `connectionGrants`) with a new migration after `0161`.
   No backfill: a grant with no value follows its Connection's mode (step 2).
   The trigger `connection_grants_bump_generation` fires only on `connection_id` and `agent_id`, so a write of the new column does not bump the Agent's generation; keep it that way and cover it in `packages/db/.mise/tasks/test/control-schema`.
2. **Domain** (`packages/api-server/src/modules/connections/domain/tool-access.ts`).
   A mode maps to an access: read only is `{ read: allow, write: block }`, needs approval `{ read: allow, write: ask }`, allow all `{ read: allow, write: allow }`, each with no overrides.
   The access of a grant is its stored value, else the mapping of `toolModeOf(connection, template)`.
   The rule of a tool is its override, else `read` for a read tool (`readToolsOf`), else `write`; a tool the stored list does not name takes `write`.
   `ToolAccessLimit` stops carrying `mode` and `readTools` and answers the rule of a tool.
3. **Repository** (`infrastructure/connections-repository.ts`).
   Read the Agent's granted Connections with each grant's `tool_access` in one query, and add the writes slice 08 needs: set one grant's access, and clear the access of every grant of one Connection.
4. **Gate** (`packages/api-server/src/modules/approvals/services/tool-access-gate.ts`, `domain/tool-access-refusal.ts`, `modules/connections/compose.ts` `createToolAccessConnections`).
   Allow passes, ask holds as a tool-call approval exactly as needs approval does today, block refuses at once.
   A request that names a Connection the Agent holds takes that grant's rule.
   Any other request to the host takes the strictest rule among the Agent's grants there: block, then ask, then allow.
   `held()` answers whether any grant of the Agent has a rule other than allow.
   The refusal names the Connection and says the tool is blocked for this Agent; it no longer names a mode.
5. **Tests.**
   `__tests__/unit/ext-authz-tool-access.test.ts`, `connections-tool-access.test.ts`, `ext-authz-gate.test.ts` and `helpers/approvals-fakes.ts`: one Agent blocked while another on the same Connection is allowed, an override in each direction, a tool the list does not name, the strictest rule for an unnamed request, and a grant with no value following its Connection's mode.

## Acceptance criteria

- [ ] Two Agents hold one Connection with different access, and the gate answers each from its own grant.
- [ ] A grant with no stored access behaves exactly as the Connection's mode did before this slice.
- [ ] An override beats its group in both directions.
- [ ] A write of `tool_access` does not bump the Agent's generation.
- [ ] `mise run //packages/api-server:check`, `mise run //packages/api-server:test` and the `packages/db` checks pass.
