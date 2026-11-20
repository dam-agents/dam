# 03 — Hold a tool call for approval

**Depends on:** 01-tool-mode-on-connection
**Part of:** MCP tool approval — see [README](./README.md)

## Context

This slice makes "needs approval" real.
The tool access step holds a `tools/call` of a Connection in `needs-approval` as a new approval type, `mcp_tool_call`, the way the gate holds a network request: it files one pending approval, joins identical calls to it, publishes a synth frame, waits up to the hold window and lets the request through on approve once.
A channel turn with nobody attached is refused at once and the approval is filed, as for network approvals.
Retry after the client gave up is slice 04; here a verdict after the request is gone does nothing.

## Implementation plan

Apply `/typescript-engineering`.
The `web_search` approval type (commit `c807d9d91f`, #6467) is the closest model: follow its files.

1. **Body reader** (`packages/api-server/src/modules/approvals/domain/mcp-tool-calls.ts`).
   `toolCall` keeps `params.arguments` as a raw value besides `name`.
   Add `toolCallKey(connectionId, tool, args)`: sha256 over the Connection id, the tool name and canonical JSON of the arguments (keys sorted, no whitespace), so the JSON-RPC `id` and key order do not change it.
2. **Contract** (`packages/api-server-api/src/modules/approvals/{schemas,types,format}.ts`).
   Add `"mcp_tool_call"` to `approvalTypeSchema` and `McpToolCallPayload` (pinned in the README) to the payload union.
   `describeApprovalPayload` (format.ts): `<tool> on <connectionName>`.
   No DB migration: `type` is text and `payload` is jsonb.
3. **Repository** (`approvals/infrastructure/approvals-repository.ts`).
   `findActivePendingMcpToolCall({ agentId, key })`, as `findActivePendingWebSearch` matches on `payload->>'key'`.
   `dropArguments(id)`: remove `arguments` from the payload; call it wherever an `mcp_tool_call` row leaves `pending` (resolve and expire, `resolvePending`, `expirePending`, `expireOverdue`).
4. **Service** (`approvals/services/approvals-service.ts`).
   `approveOnce` and `dismiss` / `dismissOne` handle `mcp_tool_call` through `resolveOnce` with `allow_once` / `deny_once`, as `web_search`.
   `approvePermanent`, `approveHost`, `denyForever` and `approveForChildren` answer `not_actionable` for it.
   `emitResolved` carries `forAgentId` as for the other types.
5. **Editor permission.**
   `APPROVAL_NEEDS` in `packages/api-server/src/apps/api-server/trpc/agent-target.ts`: `mcp_tool_call` needs `egressRules`.
   Check `modules/agent-store/infrastructure/control-grants.ts` for a type list that needs the new type, as `web_search` was added there.
6. **Gate** (the tool access step from slice 01, and `ext-authz-gate.ts`).
   The step answers `{ pass }`, `{ refuse, response }` or `{ hold, connection, toolCall }`.
   A body with one `tools/call` on a `needs-approval` Connection holds.
   A batch that contains a `tools/call` on such a Connection is refused with a JSON-RPC error per request id that asks the agent to send the calls one by one (a helper beside `refusedToolCalls`).
   The hold runs in `ext-authz-gate.ts` after the tool access step, before platform authorities and rules, by the pattern of the ext_authz hold already there (around `findActivePendingExtAuthz` … `waitForVerdict`):
   - join an open row by `findActivePendingMcpToolCall`, else `insertPending` with type `mcp_tool_call`, the payload (arguments cut at 64 KiB of JSON, `argumentsBytes` the full size), `expiresAt` now plus `holdSeconds`, and emit `ApprovalRequested`;
   - unattended (`attendance.hasOpenChannelTurn && !hasInteractiveSession`, attendee as the ext_authz hold reads it): refuse at once with a JSON-RPC error on HTTP 200 that says the call needs the owner's approval in the app, was not made, and the owner was asked;
   - attended: publish a synth frame and `waitForVerdict`; allow → `"allow"`; deny → JSON-RPC error "the owner denied this call"; hold expired → JSON-RPC error "nobody answered within N minutes; the call was not made".
   Every refusal here is a JSON-RPC error on HTTP 200 with `PLATFORM_REFUSAL_HEADER`, so the agent's session goes on.
   Security log events: `egress.hold` and `egress.decision` with `basis: "tool-approval"`, the Connection id and the tool name (cut to 100 characters), never the arguments.
   Remove the slice-01 refusal for `needs-approval`.
7. **Synth frame** (`approvals/infrastructure/acp-frames.ts`).
   `buildMcpToolCallSynthFrame`, modelled on `buildWebSearchSynthFrame` (once options only): title `<tool> on <connectionName>`, `rawInput` `{ approvalId, connectionId, tool }`.
8. **CLI** (`packages/cli/src/modules/approval/commands/{approve,deny,outcome}.ts`).
   `outcome` special-cases `web_search`; give `mcp_tool_call` the same once-only wording.
   `dam approval approve <id>` without `--once` calls `approvePermanent`, which answers `not_actionable` for this type: for an `mcp_tool_call` approval the CLI approves once whether or not `--once` was given, and `deny` denies once.
   `dam approval list` already uses `describeApprovalPayload`.
9. **Docs.**
   [security-and-credentials.md › HITL ext_authz](../../architecture/security-and-credentials.md#hitl-ext_authz): a paragraph on tool-call approvals (what holds, the join key, unattended, once verdicts only, arguments kept only while pending).
   [connections.md](../../architecture/connections.md): needs approval.
   [logging.md](../../architecture/logging.md): the new basis.
   [home-feed.md](../../architecture/home-feed.md) if it lists approval types.
   Glossary: the Approval row lists `mcp_tool_call`; add a "Tool-call approval" row.

## Acceptance criteria

- [ ] On a `needs-approval` Connection, a `tools/call` files one `mcp_tool_call` approval with tool and arguments and waits; approve once lets it through, deny once returns a JSON-RPC error.
- [ ] The same call sent again while the first waits joins the same approval; a call with other arguments files its own.
- [ ] Arguments over 64 KiB are cut in the payload and `argumentsBytes` holds the full size.
- [ ] Once the approval is resolved or expired, its payload has no `arguments`.
- [ ] With an open channel turn and no attached session, the call is refused at once and the approval is filed.
- [ ] `approvePermanent`, `approveHost` and `denyForever` answer `not_actionable` for an `mcp_tool_call` approval.
- [ ] An editor with `egressRules` on the Agent can approve once; one without cannot.
- [ ] A batch with a held call is refused with one error per request id.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

- `mise run //packages/api-server:test` (the ext-authz and approvals suites).
- On the dev cluster with `mcp-tool-approval` on: set a header-auth custom MCP Connection (or the Slack Account) to `needs-approval` through `setToolMode`, ask a Claude Code agent to call any tool, and see the approval in `dam approval list`; `dam approval approve <id> --once` lets the call run, and the agent shows its answer.
