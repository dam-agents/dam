# 04 — Approve after the client gave up

**Depends on:** 03-hold-tool-call
**Part of:** MCP tool approval — see [README](./README.md)

## Context

MCP clients have their own tool timeouts, and DAM sets none today: a harness can give up on a held call long before the owner answers.
This slice makes such an approval still useful.
An approve once given inside the hold window is used up by the next identical call (same Connection, tool and arguments), exactly once.
A held request whose client went away stops waiting, so it never uses up the approval on a dead request.
Where a harness lets DAM set its MCP tool timeout, DAM sets it to the hold window, so the plain hold works most of the time.

## Implementation plan

Apply `/typescript-engineering`.

1. **Cancel stops the wait** (`packages/api-server/src/apps/ext-authz/grpc.ts`, `approvals/services/held-verdict.ts`).
   Pass an `AbortSignal` from the gRPC call's `cancelled` event into `gateRequest` and on into `waitForVerdict`.
   On abort, `waitForVerdict` settles `{ verdict: "deny", reason: "hold-abandoned" }` without expiring the row: the approval stays pending for a retry to join, and the owner still sees it.
   The ext_authz hold for network requests may take the signal too; keep its behavior unchanged otherwise.
2. **Use up an approval once** (`approvals/infrastructure/approvals-repository.ts`).
   `consumeAllowOnce({ agentId, key })`: one conditional `UPDATE … SET delivered_at = now() WHERE type = 'mcp_tool_call' AND agent_id = $1 AND payload->>'key' = $2 AND status = 'resolved' AND verdict = 'allow_once' AND delivered_at IS NULL AND expires_at > now() RETURNING id` on the oldest such row.
   `delivered_at` is unused for this type today (the delivery sweeper reads only `acp_native` rows); confirm that in `delivery-sweeper.ts` before you rely on it, and name the column's new meaning in the repository's unit description.
3. **Gate** (`ext-authz-gate.ts`, the tool-call hold from slice 03).
   Before joining or filing: `consumeAllowOnce` → `"allow"` when a row comes back.
   After `waitForVerdict` returns allow on a live request, the held request uses up the same row with `consumeAllowOnce` (by id) before it answers `"allow"`; if that fails because a retry got there first, answer the "not made" error instead of a second pass.
   On `hold-abandoned`, return nothing useful (the client is gone) and log `egress.decision` with `reason: "hold-abandoned"`.
4. **Approve inside the window only.**
   `approveOnce` on an `mcp_tool_call` row needs `status = 'pending'` (as today); once the window ends, the sweeper expires it and a late verdict answers `not_actionable`.
   The retry after expiry files a new approval.
5. **Harness MCP timeouts** (`packages/agent-runtime/src/modules/runtime-channel/drivers/mcp-entry-plugin.ts` and the per-harness `agents/*/rootfs/app/runtime-manifest.yaml`).
   - Codex (`$HOME/.codex/config.toml`, `mcp_servers`): write `tool_timeout_sec` equal to the hold window on each entry.
     `extraFields` is `z.record(z.string(), z.string())` today; allow numbers so the TOML gets a number.
   - Claude Code: check whether its MCP entry accepts a per-server timeout; if not, set `MCP_TOOL_TIMEOUT` (milliseconds) in the harness env the runtime already writes.
   - Copilot, Bob, Pi, Hermes: look up each harness's MCP config for a per-server or global tool timeout.
     Set it where one exists; where none exists, write nothing and list the harness in the commit body.
     The hold window reaches the runtime from the api-server's `approvalHoldSeconds`; find how the runtime receives other api-server settings (the `applyState` payload) and add it there, rather than hard-coding 1800.
6. **Docs.**
   [security-and-credentials.md › HITL ext_authz](../../architecture/security-and-credentials.md#hitl-ext_authz): an approve once outlives the client's timeout until the window ends, a call uses it up once, and an abandoned hold leaves the approval open.
   [harness-config.md](../../architecture/harness-config.md): the MCP tool timeout per harness.

## Acceptance criteria

- [ ] A held call whose client closes the request leaves the approval pending; the identical retry joins it.
- [ ] After an approve once given while no request waits, the next identical call passes and the one after it files a new approval.
- [ ] Two identical calls racing after one approve once: exactly one passes.
- [ ] A live held call released by approve once uses up the approval, so an identical retry right after files a new approval.
- [ ] A verdict after the window answers `not_actionable`.
- [ ] Codex's `config.toml` MCP entries carry `tool_timeout_sec` equal to the hold window; the commit body names what each other harness got.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

- `mise run //packages/api-server:test` and `mise run //packages/agent-runtime:test`.
- On the dev cluster: a Codex agent with a `needs-approval` Connection calls a tool; wait two minutes, approve once; the call runs (Codex waited) — then read `~/.codex/config.toml` in the agent's terminal and see `tool_timeout_sec`.
- With a harness that has no timeout setting, let it give up, approve once, and ask the agent to repeat the exact call: it runs without a new approval.
