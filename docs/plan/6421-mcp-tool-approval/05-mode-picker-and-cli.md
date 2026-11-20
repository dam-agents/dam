# 05 — Mode picker and CLI

**Depends on:** 02-read-tool-list, 03-hold-tool-call
**Part of:** MCP tool approval — see [README](./README.md)

## Context

This slice puts the mode in front of the owner.
With `mcp-tool-approval` on, every MCP Connection that offers more than allow all shows a mode picker (allow all / read only / needs approval) and its tool list, grouped read / write, with a refresh button.
The picker replaces the Slack Account's read only / "Can post as me" choice that #6761 shipped.
With the flag off, the Slack Account keeps that two-way choice, now backed by `setToolMode`, and generic MCP Connections show nothing new.
The CLI gets `--mode`, and `setFullAccess` and `accessChoice` leave the contract.

## Implementation plan

Apply `/react-ui-engineering` for `packages/ui` and `/typescript-engineering` for the CLI and contract.
#6761 (commit `59c24f14f`) is the map of what to replace.

1. **UI, at connect.**
   `packages/ui/src/modules/connections/forms/access-choice-field.tsx` (`AccessChoiceField`, two cards) becomes a mode field with three cards when the flag is on (`useFeatures().data?.["mcp-tool-approval"]`) and the two current cards when it is off.
   Copy lives in `lib/access-choice.ts` (rename to `lib/tool-mode.ts`); needs approval says every tool call waits for an answer in approvals, and allow all keeps the danger tone and warning the "full" card has.
   `forms/template-create-form-body.tsx` renders it for a Template with `toolAccess`, and `components/catalog-mcp-create-pane.tsx` (`McpCreatePane`) renders it for a generic MCP server when the flag is on.
   `lib/build-create-payload.ts` sends the mode (contract: add `toolMode?: ToolMode` to the create inputs; drop `fullAccess` from `oauthCreateInput` in step 4).
2. **UI, on an existing Connection.**
   `components/connection-edit-access-dialog.tsx` becomes the mode dialog: the picker plus the tool list (`toolAccess.tools`, read tools first, then the rest), `listedAt`, `listError` and a refresh button that calls `refreshTools`.
   Its mutation (`api/mutations.ts`, today `useSetConnectionFullAccess`) calls `setToolMode` and invalidates the same queries.
   Routing: `hooks/use-connection-maintenance.ts` (`onEditScope`) and `components/connection-update-credential-dialog.tsx` open it for any Connection whose `toolAccess.modes` has more than one entry.
   The row: `components/connection-row-actions.tsx` (button and menu label "Tool access"), `components/full-access-mark.tsx` (the red mark only for allow all on a Template that defaults to read only, and an amber "needs approval" mark), `lib/connection-detail.ts` (the reach line names the mode).
   Agent side: `agents/hooks/use-agent-shared-access.ts`, `agents/components/bind/bind-sharing-text.tsx`, `agents/hooks/use-bind-sharing-confirm.tsx` and `components/channel-connection-explainer.tsx` read the mode instead of `fullAccess`.
3. **CLI** (`packages/cli/src/modules/connection/`).
   `commands/scope.ts`: `--mode allow-all|read-only|needs-approval` calls `setToolMode`; `--read-only` and `--full-access` are removed (help text too).
   `commands/connect.ts`: `--mode` replaces `--full-access` for a Template with `toolAccess` and for a generic MCP server.
   `commands/list.ts` and `domain/access-choice.ts` (`formatAccess`): show the mode; `--json` carries `toolAccess`.
   Add `dam connection tools <name> [--refresh]` that prints the tool list grouped read / write.
4. **Contract cleanup** (`packages/api-server-api/src/modules/connections/`).
   Remove `setFullAccess`, `connectionSetFullAccessInputSchema`, `connectionAccessChoice`, `accessChoice` on both views, the Slack-only `fullAccess` on `connectionView`, and `oauthCreateInput.fullAccess`.
   GitHub's `fullAccess` inputs and auth key stay.
   Remove `fullAccessLabel` from `TemplateToolAccess` and the catalog.
5. **Profiles and skill.**
   QA profile [`.quality-inspector/qi-profile-dam/SKILL.md`](../../../.quality-inspector/qi-profile-dam/SKILL.md): the Slack Account form and *Change access* lines become the mode picker, the tool list and the marks.
   [`skills/dam/SKILL.md`](../../../skills/dam/SKILL.md) (the Slack read only / `--full-access` / `--read-only` section) and [`skills/dam/references/security-advisory.md`](../../../skills/dam/references/security-advisory.md): `--mode` and `dam connection tools`.
6. **Docs.**
   [cli.md](../../architecture/cli.md) (`connect`, `list`, `scope`, `tools`), [slack-guarantees.md](../../architecture/slack-guarantees.md) (every "Can post as me"), [connections.md](../../architecture/connections.md) (the picker, the flag-off two-way choice).

## Acceptance criteria

- [ ] Flag off: a Slack Account shows read only / "Can post as me" at connect and in the dialog, and switching works; a generic MCP Connection shows no mode.
- [ ] Flag on: every MCP Connection with a Secret shows the three modes at connect and in the dialog, and the tool list with refresh.
- [ ] A no-auth custom MCP Connection shows no picker.
- [ ] The row shows the mode's mark and reach line.
- [ ] `dam connection scope <name> --mode needs-approval`, `dam connection list` and `dam connection tools <name> --refresh` work; `--full-access` and `--read-only` are gone.
- [ ] No code references `setFullAccess` or `accessChoice`; GitHub's full access still works.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

- `mise run //packages/ui:test`, `mise run //packages/cli:test`.
- On the dev cluster, `cluster:build ui` and a hard reload (an open tab keeps the old JS): walk the acceptance criteria in the browser with the flag on and off, and capture screenshots for the PR body.
