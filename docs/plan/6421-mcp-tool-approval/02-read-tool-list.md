# 02 — Read the tool list from the server

**Depends on:** 01-tool-mode-on-connection
**Part of:** MCP tool approval — see [README](./README.md)

## Context

Read only on a generic MCP server needs to know which tools read.
The gate never sees the server's `tools/list` answer, and the agent cannot be trusted to report it, so the api-server reads the list itself with the Connection's own credential and stores each tool's name and `readOnlyHint`.
This slice also puts `checkBody` on every MCP Connection that has a Secret and makes the gate find a limit by each Connection's own host, so every such Connection can take all three modes.

## Implementation plan

Apply `/typescript-engineering`.

1. **Tool lister (infrastructure).**
   New `packages/api-server/src/modules/connections/infrastructure/mcp-tool-lister.ts`: `listMcpTools(url: URL, headers: Record<string, string>): Promise<ConnectionTool[]>` with `Client` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk` (already a dependency; `__tests__/unit/environment-mcp-client.test.ts` shows the client in use).
   Page through `nextCursor`, cap at 1000 tools, time out after 15 s, and map `annotations.readOnlyHint === true` to `readOnly: true`.
   Use it behind a port (`McpToolLister`) so tests fake it.
   It dials the server from the api-server, as `infrastructure/mcp-discovery.ts` already does for OAuth discovery; reuse whatever host checks discovery applies, and do not add a new allow list here.
2. **Credential for the call.**
   OAuth: the access token through `refreshOAuthAccessToken` (`services/oauth-token.ts`) under the refresh lock, as a bearer header.
   Header auth: `auth.valueRef` from the secret store, formatted with `headerName` / `valueFormat`.
   The URL is the `mcp-entry` contribution's `url`.
3. **Service** (`services/connections-service.ts`).
   - `refreshTools(id)`: read the list, write `tools`, `listedAt` and clear `listError` in `tool_access`; on failure keep the old `tools` and write `listError` with a short reason the owner can read (status code or "timed out"), and return the view.
   - Call it after create of every MCP Connection with a Secret (header create, and `completeOAuth` in `services/oauth-flow.ts` once tokens are written), without failing the create when the list fails.
   - For a Template that declares `toolAccess.readTools` (Slack), the stored `readOnly` is the Template's list, not the server's hint: the Template wins.
   - `toolAccess.modes` is all three for every MCP Connection with a Secret (auth kind not `none`), `["allow-all"]` otherwise.
4. **Contract.**
   Add `refreshTools` (`manageCredentialsProcedure`, input `{ id }`, returns `ConnectionToolAccess`) to the connections router.
5. **`checkBody` per Connection.**
   `checkBodyHostsOf(templateId)` becomes `checkBodyHostsOf(connection)`: the host of the `egress-inject` entry that carries the `mcp-entry` URL, for every MCP Connection with a Secret.
   Every caller of `putConnectionSecret` passes the Connection.
   The controller needs no change: it already reads `checkBody` per entry and rolls the gateway once when the flag first appears (`checkBodyRevMark`), and #6760's fail-closed window covers that roll.
   Add a one-time backfill so existing MCP Connections get the annotation: a boot-time pass, or the existing restamp path run once per MCP Connection; pick whichever the connections module already uses for annotation changes and say which in the commit body.
6. **Gate lookup** (`createReadOnlyConnections` / `ToolAccessConnections` in `modules/connections/compose.ts`).
   The limited hosts are no longer static per Template: a request is limited when the Agent holds an MCP Connection on that host whose mode is not `allow-all`.
   Keep the early return cheap: read the Agent's granted Connections once per request, as `limiting()` does today, and do not add a cache that could serve an old mode.
   `held()` (the fail-closed check for a gateway that has not restarted) covers every MCP Connection not on `allow-all`.
7. **Docs.**
   [connections.md](../../architecture/connections.md): where the tool list comes from, when it is read, that the Template's read list wins, and that a tool the list does not name is not a read tool.
   [credential-gateway.md](../../architecture/credential-gateway.md): `checkBody` is on for every MCP Connection with a Secret.
   [mcp-connections.md](../../architecture/mcp-connections.md): the tool list and the no-auth limit.

## Acceptance criteria

- [ ] Creating a header-auth custom MCP Connection stores its tools with `readOnly` from `readOnlyHint`; a server that fails stores `listError` and the Connection is still created.
- [ ] `refreshTools` updates the list and `listedAt`.
- [ ] A Slack Account's stored `readOnly` matches `SLACK_READ_TOOLS`, whatever the server's hints say.
- [ ] The Secret of every MCP Connection with a Secret carries `checkBody` on its MCP host; a non-MCP Connection's Secret does not.
- [ ] A custom MCP Connection in `read-only` refuses a tool the list marks as a write and a tool the list does not name, and passes a read tool.
- [ ] A no-auth custom MCP Connection offers only `allow-all`.
- [ ] `mise run check` and `mise run test` pass.

## Smoke test

- `mise run //packages/api-server:test`.
- On the dev cluster: connect a header-auth custom MCP server and run `dam connection list --json`: `toolAccess.tools` lists its tools.
- The CLI `--mode` comes in slice 05, so set read only with a `curl` to `/api/trpc/connections.setToolMode` with your session token.
  Ask a test agent to call a write tool (refused with a readable error) and a read tool (answers).
