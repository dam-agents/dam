# 11 — CLI: tool access per agent

**Depends on:** the pinned contract (builds in parallel with 07 and 08)
**Part of:** MCP tool approval — see [README](./README.md), section "Second round"

## Context

The CLI sets the mode of a Connection with `dam connection scope <name> --mode`.
Tool access now belongs to one Agent on one Connection, so the CLI must name the Agent.

## Implementation plan

Apply `/typescript-engineering`.
Files: `packages/cli/src/modules/connection/` and `skills/dam/`.
Do not edit `packages/api-server-api`; report a gap.

1. **Set** (`commands/scope.ts`, `domain/tool-mode.ts`).
   `dam connection scope <connection> --agent <agent>` takes `--read allow|ask|block`, `--write allow|ask|block`, `--tool <name>=allow|ask|block` (repeatable) and `--reset-tool <name>` (repeatable), and calls `setGrantToolAccess` with the grant's current access changed by the flags.
   `--mode` stays as the Connection-wide choice and says in its help that it sets every Agent that holds the Connection.
2. **Read** (`commands/list.ts`, `commands/tools.ts`).
   A listing for one Agent shows each grant's access in one short phrase, and `--json` carries `toolAccess`.
   `dam connection tools <connection> --agent <agent>` prints each tool with its rule for that Agent.
3. **Grant** (`commands/grant.ts`).
   After a grant it prints what the Agent starts with.
4. **Skill** (`skills/dam/SKILL.md`, `skills/dam/references/security-advisory.md`).
   The tool access section names the Agent and the three rules.

## Acceptance criteria

- [ ] `dam connection scope slack-account --agent standup --write ask --tool slack_add_reaction=allow` changes that Agent only.
- [ ] `dam connection list` for an Agent and `dam connection tools --agent` show the access.
- [ ] `--mode` still works and its help says it reaches every Agent.
- [ ] `mise run //packages/cli:check` and `mise run //packages/cli:test` pass.
