# 01 — Tool mode on the Connection

**Part of:** MCP tool approval — see [README](./README.md)

## Context

The Slack Account's read-only choice is `auth.fullAccess` today.
This slice gives every MCP Connection a tool mode of its own, stored in a new column, and makes the gate's read-only step read it.
It moves Slack's existing choice into the mode with a migration, keeps the shipped UI and CLI working through `setFullAccess` (now a thin mapping onto the mode), and declares the `mcp-tool-approval` feature flag.
"Needs approval" can be stored, and until slice 03 the gate refuses every tool call of such a Connection: fail closed, never open.

## Implementation plan

Apply `/typescript-engineering`.

1. **DB.**
   Add a nullable jsonb column `tool_access` to `connections` (`packages/db/src/schema.ts`, the `connections` table around `inputs` / `auth` / `contributions`).
   Shape: `{ mode: ToolMode, tools: ConnectionTool[] | null, listedAt: string | null, listError: string | null }`.
   Null means the Connection is not an MCP Connection, or was made before this column and is treated as its Template's default (step 3).
   Generate the migration with the db package's mise task (`mise tasks --all | grep db`), then append to the same migration file the data step:
   - for `template_id = 'slack'`: `tool_access = {mode: "allow-all"}` where `auth ? 'fullAccess'`, else `{mode: "read-only"}`, `tools`, `listedAt`, `listError` null;
   - then remove `fullAccess` from `auth` for `template_id = 'slack'` only (`auth - 'fullAccess'`).
   GitHub rows keep `auth.fullAccess`.
2. **Upgrade rehearsal** (`packages/db/scripts/upgrade-rehearsal-snapshot.sql`, `upgrade-rehearsal-assert.sql`).
   The `connections.full_access` count loses the Slack rows (the expected delta from 0118 + 0160 drops by the Slack rows the fixture holds).
   Replace `kept.connections.slack_full_access` with an assertion that every Slack row has `tool_access->>'mode'` of `allow-all` exactly where the snapshot had `fullAccess`, and `read-only` elsewhere.
   Say in the PR body under "Gates you changed" why the delta moved.
3. **Contract** (`packages/api-server-api/src/modules/connections/{types,schemas,router}.ts`).
   Add `ToolMode`, `ConnectionTool`, `ConnectionToolAccess` as pinned in the README, `toolAccess?: ConnectionToolAccess` on `connectionView`, and `setToolMode` (`manageCredentialsProcedure`, input `{ id, mode }`).
   Keep `accessChoice` on the views and `setFullAccess` for now (the shipped UI uses them); slice 05 removes them.
   `oauthCreateInput.fullAccess` stays as an input and maps to the mode at create.
4. **Template default.**
   In `packages/api-server/src/modules/connections/domain/connection-template.ts`, add `defaultToolMode?: ToolMode` to `TemplateCommon`; Slack sets `"read-only"` (`catalog.ts`, `slack()`).
   A Template without it defaults to `"allow-all"`.
   `TemplateToolAccess` keeps `host` and `readTools`; `fullAccessLabel` stays until slice 05.
5. **Domain.**
   Replace `readOnlyAccessFor` in `domain/read-only-access.ts` with `toolAccessFor(granted, templateOf, request)`: it returns `{ connection, mode, readTools }` or null, with the same rule for which Connection a request is subject to (the named Connection, else the strictest Connection on that host).
   Strictest order: `needs-approval` and `read-only` both stricter than `allow-all`; between them pick `read-only` (it refuses at once and never files an approval a person did not expect).
   The mode is `connection.toolAccess?.mode ?? template.defaultToolMode ?? "allow-all"`.
   Read tools are the Template's `toolAccess.readTools` when the Template declares them, else the stored tools with `readOnly: true` (none yet before slice 02).
6. **Service** (`services/connections-service.ts`).
   - The view (around the `accessChoice` mapping) fills `toolAccess` for an MCP Connection.
     In this slice `modes` is all three only when the Template declares `toolAccess` (Slack), because only that host gets `checkBody` yet; every other MCP Connection gets `["allow-all"]`.
     Slice 02 widens it to every MCP Connection with a Secret.
   - Create: write `tool_access` with the Template default, or `allow-all` / `read-only` from `fullAccess` when the Template has an access choice (today's create check stays).
   - `setToolMode`: under `connectionLock(connectionRefreshLockKey(id))` as `setFullAccess` does; refuse a mode outside `modes`; refuse a mode other than `allow-all` / `read-only` when `mcp-tool-approval` is off for the owner (the feature check pattern is in `apps/api-server/trpc/context.ts`); write the column; log `connection.access_update` with the old and new mode.
   - `setFullAccess` becomes `setToolMode(id, fullAccess ? "allow-all" : "read-only")`.
   - `fullAccess` on the view is derived: `mode === "allow-all"` for a Template with an access choice.
7. **Gate** (`packages/api-server/src/modules/approvals/services/read-only-gate.ts`, `modules/connections/compose.ts` `createReadOnlyConnections`).
   Rename the step to the tool access step (`tool-access-gate.ts`, `ToolAccessGate`, port `ToolAccessConnections`), keeping every body check it has.
   The port returns the mode with the limit.
   `read-only`: today's behavior.
   `needs-approval`: refuse every `tools/call` with a JSON-RPC error that says the call needs approval and approvals are not available yet (a new helper in `approvals/domain/read-only-refusal.ts`, which you may rename to `tool-access-refusal.ts`).
   The refusal text names the mode instead of `fullAccessLabel`.
   Update the ext_authz basis from `"read-only"` to `"tool-access"` in `ext-authz-gate.ts` and the security log `basis`.
8. **Feature flag.**
   Add `mcp-tool-approval` to `featureIdSchema` (`packages/api-server-api/src/modules/features/schemas.ts`), the install modes in `packages/api-server/src/config.ts`, the Features tab row (`packages/ui/src/modules/features/components/features-tab.tsx`) and [`features.md`](../../architecture/features.md).
9. **Docs.**
   [connections.md](../../architecture/connections.md#connection): replace the read-only paragraphs with the three modes, the Template default and the migration.
   Glossary ([`ubiquitous-language.md`](../../ubiquitous-language.md)), Connection row: the mode instead of "Can post as me".
   [credential-gateway.md](../../architecture/credential-gateway.md) and [security-and-credentials.md](../../architecture/security-and-credentials.md): the step's new name.

## Acceptance criteria

- [ ] After the migration, a Slack Connection that had `fullAccess` has mode `allow-all`, one that had none has `read-only`, and no Slack row keeps `auth.fullAccess`; GitHub rows are unchanged.
- [ ] `connections.list` returns `toolAccess` for MCP Connections only; `modes` has all three for a Slack Account and only `allow-all` for every other MCP Connection.
- [ ] `setToolMode` to `needs-approval` is refused while `mcp-tool-approval` is off and accepted while it is on.
- [ ] The shipped Slack UI (read only / "Can post as me") and `dam connection scope --read-only|--full-access` still work.
- [ ] A Slack Connection in `read-only` refuses `slack_send_message` and passes a read tool, as before.
- [ ] A Connection in `needs-approval` refuses every `tools/call` with a readable JSON-RPC error.
- [ ] `mise run check` and `mise run test` pass, including the upgrade rehearsal assertions this slice changed.

## Smoke test

- `mise run //packages/api-server:test` and `mise run //packages/db:check` (find the exact task names with `mise tasks --all`).
- On the dev cluster: `cluster:build` api-server, then `dam connection list` shows the Slack Account as before; `dam connection scope <slack> --full-access` and back still switches, and the test agent's `slack_send_message` is refused in read only (see #6760's PR body for the manual call it used).
