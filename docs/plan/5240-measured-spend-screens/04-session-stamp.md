# 04 — The session stamp

**Part of:** Every screen shows measured spend — see [README](./README.md)

## Context

The gateway meter cannot see which session made a call: the session lives in the agent's pod.
The Model Router already finds the session of each chat call for Claude Code, Codex and Bob, but it keeps it in its own telemetry record.
This slice carries the session and the harness to the meter (decision 8): the router stamps them on the call, the meter copies them into the call's record, and the gateway removes them before the provider.
It also closes the two holes that the planning review found: Pi sends no session marker (G1), and in a terminal session Codex, Bob and Pi run under their own id, not our session id (G8).
The record also gets the call's duration from Envoy.
Nothing is stored yet: the api-server reads the new fields and logs them; slice 05 stores them.
This slice does not depend on slices 01–03, so it can run in parallel with them.

## Implementation plan

Apply `/typescript-engineering` for the agent-runtime, Pi extension and api-server parts.
Read [README — The session stamp](./README.md#the-session-stamp) first.
A change to the Lua meter needs a probe against a real Envoy: the repository has no Lua runtime.

1. **Pi sends its session** in `packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts`:
   - Register a `before_provider_headers` handler (Pi 1.1.0, `ExtensionAPI.on`; handlers change `event.headers` in place) that sets `x-platform-session` to `ctx.sessionManager.getSessionId()`.
   - Set it only on calls to the router provider (`ROUTER_PROVIDER`); find in Pi's `ExtensionContext` how a handler knows the call's provider, and leave other providers' calls unchanged.
   - pi-acp takes the ACP session id from Pi's own session id (`state.sessionId` in pi-acp 0.0.34) and runs one Pi process per session, so in a chat this id is our session id.
2. **The router reads the session** in `packages/agent-runtime/src/modules/model-router/`:
   - `domain/session-of.ts`: for the harness `pi`, read the session from `x-platform-session`.
     Pass the harness to `sessionOf` (today `compose.ts` line 37 drops it).
   - Update `docs/architecture/harness-config.md`, which says that Pi's calls carry no session marker; Pi still has no harness sub-agents.
3. **Terminal ids map back to our session id** in the agent-runtime:
   - In a terminal session, the harness runs under its own id: Codex keeps its thread id in `~/.codex/platform-sessions/<our id>` (`packages/agents/codex/rootfs/usr/local/bin/harness-terminal`), Bob its task id in `~/.bob/platform-sessions/<our id>` (`packages/agents/bob/rootfs/usr/local/bin/harness-terminal`), and Pi writes a new random id into the header line of `~/.pi/agent/sessions/<our id>.jsonl` (`packages/agents/pi-agent/rootfs/usr/local/bin/harness-terminal`).
     Claude Code's terminal runs with `--session-id <our id>`, so it needs nothing.
   - Add a lookup `terminalSessionOf(harnessId): string | null` that reads those files for the runtime's terminal sessions (`sessionMetadata` entries with `mode: "terminal"`, `packages/agent-runtime/src/server.ts` around lines 645–700), keyed by the harness's id.
     Keep the result in memory; on a miss, read the files again, at most once every few seconds, because a harness writes its id only after it starts.
   - Wire it into the router (`composeModelRouter` in `server.ts`, around line 268): when the session that `sessionOf` found is not a session of the runtime, use `terminalSessionOf` to get our id.
     Keep the found id when the lookup has no answer.
   - The same id also reaches `sessionModelOf`; a terminal starts on its model already, so no change in model choice is expected.
4. **The router stamps the call** in `packages/agent-runtime/src/modules/model-router/services/model-router.ts`:
   - Add the constant `SESSION_HEADER = "x-platform-session"` next to `HARNESS_HEADER` (line 38), and add it to `REQ_DROP` (lines 113–128), so a value that a harness sends never passes unchanged.
   - Where the outgoing headers are built (after the credential placeholder, around line 278): set `x-platform-session` to the session from steps 2–3 (`handle.parentSessionId ?? handle.sessionId`, around line 243) when there is one, and set `x-platform-harness` to the call's harness (around line 456).
     `HARNESS_HEADER` stays in `REQ_DROP`.
5. **A new session reaches the directory at once** in `packages/agent-runtime/src/modules/runtime-channel/session-directory-report.ts`:
   when the current set has a session id that the last report did not have, send without the debounce (`SESSION_DIRECTORY_DEBOUNCE_MS` in `runtime-channel/compose.ts` stays for every other change).
   So the first call of a new session finds its session at ingest in slice 05.
6. **The meter copies the stamp** in `packages/controller/pkg/reconciler/envoy_spend_meter.go`, Lua `envoy_on_request` (around lines 413–437):
   - On a billable call, read `x-platform-session` and `x-platform-harness`, keep each only when it is at most 128 characters of printable ASCII, and set them as `session` and `harness` in the `platform.spend` metadata.
   - Do not remove the headers in Lua; the route removes them (next step).
7. **The gateway removes the stamp** in `packages/controller/pkg/reconciler/envoy_bootstrap.go`: add both headers to `request_headers_to_remove` of the terminating chain's virtual host (line 318, next to `x-platform-conn`), so they never reach a provider, also on a chain without a meter.
8. **Bump** `envoyBootstrapTemplateRev` in `packages/controller/pkg/reconciler/envoy.go` (line 925, today `v23-spend-meter-connection-stamp`), so every gateway restarts once with the new chain.
   Update the controller's golden files or bootstrap tests that change.
9. **The record gets the duration** in the api-server:
   - `packages/api-server/proto/accesslog.proto`: add `google.protobuf.Duration duration = 23;` to `AccessLogCommon` (the field number of Envoy v1.39.3's `api/envoy/data/accesslog/v3/accesslog.proto`), then run `mise run //packages/api-server:fix:proto`.
   - `packages/api-server/src/modules/spend/infrastructure/spend-metadata.ts`: parse `session` and `harness` (strings, else null).
   - `packages/api-server/src/modules/spend/domain/call.ts`: `CallRecord` gets `sessionId: string | null`, `harness: string | null` and `durationMs: number`.
   - `packages/api-server/src/apps/ext-authz/spend-records.ts` `callRecordOf`: take `durationMs` from `common.duration` when Envoy sets it; else, for a periodic record, the time from `startTime` to the record's arrival.
     Confirm with the probe whether Envoy sets `duration` on periodic records, and keep the fallback either way.
10. **Log the new fields:** the ingest adds `sessionId`, `harness` and `durationMs` to its existing per-record debug log, or writes one debug line per final record with the call id; follow `docs/architecture/logging.md`.
11. **Docs.**
    - `docs/architecture/spend-limits.md` § Meter "On the request": the meter copies the session and the harness that the Model Router stamps, and the gateway removes them before the provider; § Meter "The record": the record carries them and the call's duration.
    - `docs/architecture/harness-config.md` § The Model Router: the router stamps each forwarded call with the session and the harness, never passes a stamp that a harness sends, reads Pi's session from its extension, and maps a terminal session's harness id back to our session id.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass for `agent-runtime`, `controller` and `api-server`.
- [ ] A chat call of each harness (Claude Code, Codex, Bob, Pi) through the router produces a record whose `sessionId` is the session id of that chat, and whose `harness` names the harness.
- [ ] A call in a terminal session of each harness produces a record with that terminal session's id.
- [ ] Pi's calls to a provider other than the router carry no `x-platform-session`.
- [ ] A final record has a `durationMs` close to the call's time.
- [ ] No provider receives `x-platform-session` or `x-platform-harness` (Envoy probe).
- [ ] A harness that sends its own `x-platform-session` to the router does not reach the gateway with that value.

## Smoke test

1. **Envoy probe.**
   In a scratch worktree, add a throwaway `zz_probe_test.go` in `packages/controller/pkg/reconciler` that builds a model-provider chain with the test helpers, calls `buildTerminatingChain`, and writes the rendered config; run it with `mise run :test -- -run TestProbe ./pkg/reconciler/` from `packages/controller`.
   Run the config in a pod on the local cluster with the chart's Envoy image (`imagePullPolicy: Never`) and a second listener whose Lua filter answers with the headers that it received (an echo upstream).
   Send a billable call with both stamp headers: the echo shows neither header, and the access-log record holds `session`, `harness` and `duration`.
   Delete the probe file afterwards; it is not a test to keep.
2. **Dev cluster:** rebuild every image (the gateway bootstrap and the Pi image changed), then run one prompt in a chat and one in a terminal session of each harness: Claude Code, Codex, Bob and Pi (the Claude subscription works without the IBM VPN).
3. Read the api-server log for the debug lines of those calls (`mise run cluster:kubectl -- logs …`); compare each `sessionId` with the session id in the session's URL.

Print a short manual guide for Petr with these steps.
