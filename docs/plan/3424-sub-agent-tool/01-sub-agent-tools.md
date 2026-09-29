# 01 — Sub-agent tools on the platform MCP server

**Part of:** Spawn a sub-agent through a tool call — see [README](./README.md)

## Context

The driver SDK reaches Invocations over HTTP routes on the harness port. This slice gives
the model the same capability as five MCP tools on the platform MCP server:
`spawn_sub_agent`, `await_sub_agents`, `list_harnesses`, `list_connections`, `get_budget`.
The request handling that now lives inline in the HTTP routes moves to one place both
surfaces call, so the tool and the SDK can never disagree on what a spawn means.

## Implementation plan

Apply `/typescript-engineering`.

1. **Extract the spawn-request resolution.** In
   `packages/api-server/src/apps/harness-api-server/invocation-endpoints.ts`, the
   `POST /api/agents/:id/invocations` handler resolves `harness` to a template (and the
   "no harness X — available: …" error), folds `cpu`/`memory` into `resources`, loads the
   driver's grants and derives `driverProviders`, then calls `InvocationsService.spawn` and
   maps errors (`AttenuationError` with its security log, `InvalidSchemaError`,
   `SizeNeverFitsError`, `ProviderMismatchError`, `UnresolvableDriverError`). Move the
   resolution and the call into one function that takes the verified driver (id, owner) and
   a parsed `spawnInvocationRequestSchema` body and returns `{ id }` or a typed refusal
   (reason text plus a kind the route maps to 400/403/409). Do the same for the three read
   routes (`/connections`, `/images`, `/budget`) so each has one function returning its
   JSON shape. Put these where `/typescript-engineering` says an app-level use-case
   belongs — beside the routes in `apps/harness-api-server/` unless the skill points to the
   invocations module's services. Keep the security log on attenuation denial. Routes keep
   their exact HTTP responses.
2. **Register the tools.** Add `packages/api-server/src/modules/invocations/mcp-tools.ts`
   with `registerSubAgentTools(server, deps)`, following
   `packages/api-server/src/modules/satellites/mcp-tools.ts` and `core/mcp-tool-result.ts`
   (`json`, `errorResult`, `run`). Call it from `mcp-endpoint.ts` next to `report_result`.
   Extend `MountMcpDeps` and its wiring in `packages/api-server/src/bootstrap.ts` with what
   the functions from step 1 need (connections, templates, budgets, default limits);
   `invocationsServiceFor` is already there.
   - `spawn_sub_agent`: input is the zod shape of `spawnInvocationRequestSchema`
     (`packages/api-server-api`), with a `.describe()` per field taken from the options
     table in the `dam-invoke` skill. `schema` is required. A refusal returns `errorResult`
     with the platform's reason. Success returns text that includes the line
     `[invoke] spawned <label> -> <id>` (label falls back to harness, image, then id,
     as in `packages/driver-sdk/src/spawn.ts`) and a JSON `{ id }`.
   - `await_sub_agents`: `ids: string[]` (min 1). Reads each through
     `InvocationsService.get(id, driverAgentId)` every ~2 s until at least one is terminal
     or 240 s pass (reuse `DEFAULT_SATELLITE_WAIT_MS` or a sibling constant with the same
     reason). Returns `{ done: [{id, label, result}], failed: [{id, label, reason}],
     running: [id], unknown: [id] }`. Never throws for an unknown id.
   - `list_harnesses`, `list_connections`, `get_budget`: return the step-1 functions'
     JSON.
   - Descriptions: `spawn_sub_agent` carries the need-based rule from the README and says
     the sub-agent is unattended and reports through `report_result`, that the call returns
     an id at once, and to call `await_sub_agents` next. `await_sub_agents` says it waits up
     to four minutes, returns on the first finish, and to call it again with the still
     running ids. Mention that a spawn must not be retried blindly: a duplicate is a second
     sub-agent.
3. **Architecture page.** In `docs/architecture/invocations.md`, change the overview's
   "The Driver is almost always a script" to cover both, and add a section beside
   "Driver SDK" on the tools: what each does, the 240 s bound and why, the spawn line, and
   that both surfaces share one resolution. Follow `docs/guidelines/documentation-guidelines.md`
   and bump `Last verified:`.

## Acceptance criteria

- [ ] The HTTP routes return exactly what they returned before (status codes and bodies).
- [ ] The five tools appear on the platform MCP server for every agent.
- [ ] `spawn_sub_agent` refuses a missing schema, an unknown harness (naming the available
      ones), and an ungranted connection (with the security log line), each as a tool error.
- [ ] `spawn_sub_agent`'s result text contains `[invoke] spawned <label> -> <id>`.
- [ ] `await_sub_agents` returns within ~2 s of a child ending, and after ~240 s with only
      running ids when none ended; foreign ids come back as `unknown`.
- [ ] `docs/architecture/invocations.md` describes the tools.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

`mise run check` and `mise run test` against the current suite (the existing
invocation-endpoint and SDK tests cover the extracted resolution). Then on the local
cluster: in a Claude Code agent's chat, ask it to call `list_harnesses`, then
`spawn_sub_agent` with prompt "Compute 6 * 7", schema `{"type":"integer"}`,
harness `claude-code`, then `await_sub_agents` with the returned id. Expect `done` with
result `42`. Ask for a spawn with harness `nope` and expect the error naming the available
harnesses.
