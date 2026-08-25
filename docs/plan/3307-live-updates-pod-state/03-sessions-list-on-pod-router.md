# 03 — `sessions.list` on the pod router

**Depends on:** 02-ui-per-agent-client-websocket
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

Listing sessions today means opening a throwaway passive ACP WebSocket, calling `session/list`, and closing it — `withConnection(..., {passive: true})` in `packages/ui/src/modules/sessions/api/acp-session-ops.ts`. The pod answers by proxying to the harness and rewriting the response on the way out, injecting platform metadata the harness silently drops.

This slice moves the read to the pod's own tRPC router and has agent-runtime **compose** the list rather than enrich a passthrough. That is what closes the ADR-055 gap: the ADR promised that sessions in the pod's own store but not yet in the harness's would be listed with a null title, but `injectPlatformMetaIntoList` only maps over what the harness returned and never consults the store's `all()` — which has no non-test caller in the repo. Since the harness persists on the *first turn*, a schedule-fired session is invisible rather than merely late. That is the mechanism behind the issue's headline complaint, and no amount of pushing fixes it.

Read [ADR-084](../../adrs/084-pod-owned-live-updates.md)'s `Amends` section: ADR-055's core holds — the agent is still the sole source of truth and there is still no server-side session store. Only the wire format for *reads* changes.

## Implementation plan

Apply `/typescript-engineering`.

1. **Contract** — add a `sessions` router to `packages/agent-runtime-api/src/router.ts` alongside `files`, `skills`, `ssh`, `runtime` and `harnessConfig`, with a `list` query. Define the returned shape in that module's `types.ts` / `schemas.ts`. The fields the UI renders today are: session id, title, `updatedAt`, plus mode, type, `scheduleId`, `experimentId`, `threadTs`, `createdAt`, `seenAt` and the live `running` flag. Model it as a flat, explicit shape — do not carry `_meta.platform` through as an opaque blob; the whole point is that this is the platform's own contract now.
2. **Composition in the pod.** Implement it in the ACP module, which already owns both inputs. It needs to:
   - ask the harness for its list — agent-runtime already does this kind of thing on its own behalf, see `session-bootstrap.ts` issuing `session/load` for waiters and `trigger-session-driver.ts` using an in-memory channel, so reuse that mechanism rather than inventing one;
   - **union** with `sessionMetadataStore.all()`, so store-only sessions appear with a null title — the ADR-055 behaviour that was never implemented;
   - filter tombstoned ids, exactly as the current intercept does;
   - apply the "no store entry ⇒ terminal session" default that ADR-055 makes the discriminator for harness-internal mintings;
   - compute `running` from `promptScheduler.hasTurnInFlight(sid) || isTerminalSessionActive(sid)`, the same pair the intercept uses today.
3. **Reuse, don't fork.** The per-session mapping currently lives in `withPlatformMeta` / `injectPlatformMetaIntoList` in `packages/agent-runtime/src/modules/acp/services/acp-runtime/acp-runtime.ts`. Extract the shared logic so the tRPC composition and the surviving ACP intercept produce the same view. Two independent compositions of one list is precisely the divergence ADR-055 was written to remove.
4. **Keep the ACP intercept.** Channel workers (`packages/api-server/src/core/acp-client.ts`, used by the Slack and Telegram adapters to match a thread by `threadTs`) and the CLI (`packages/cli/src/modules/chat/infrastructure/acp-session-client.ts`) still read over ACP. Migrating them is out of scope; the intercept stays until they do. ADR-084 records this as a known cost.
5. **UI** — point `listAgentSessions` at the new procedure over the per-agent client from 02. **Home stays on the ACP read for now**, as `listAgentSessionsOverAcp`. Its `useFeed` polls every running agent every 15s, so moving it onto per-agent WS clients would hold one connection per running agent, and the relay's activity stamp would then keep the whole fleet from hibernating — the opposite of what today's `passive=1` reads deliberately do. Sub-issue 07 replaces that poll outright and removes `listAgentSessionsOverAcp` with it. Keep `toSessionView`'s consumers working; the decode step largely disappears because the contract is now explicit. Leave `refetchInterval: STATUS_POLL_MS` in `packages/ui/src/modules/sessions/api/queries.ts` in place — 04 removes it.
6. Session **creation, deletion and mode changes stay on ACP.** `session/new` mints the id in the harness, `platform/deleteSession` and the resume-carried mode write are already runtime-answered ACP methods. Do not move them.
7. Run `mise run ui:fix` and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] The sidebar renders identically to before for an agent with a mix of chat, terminal, scheduled and channel sessions.
- [ ] A session created but not yet prompted appears in the list with a null title — verify by creating a session and inspecting the response before sending a first prompt.
- [ ] A schedule-fired session appears as soon as it is created, not only after its first turn completes.
- [ ] Listing sessions no longer opens an ACP WebSocket — DevTools shows no socket churn on the sessions query.
- [ ] Terminal sessions still default correctly when they have no store entry.
- [ ] Deleting a session still hides it (tombstone respected), and mode switching still works over ACP.
- [ ] Channel workers and the CLI still resolve sessions over ACP — the intercept is intact.

## Smoke test

`mise run check && mise run test`, then against a cluster:

1. Open an agent with several sessions. The sidebar looks unchanged.
2. In DevTools → Network → WS, confirm the sessions query no longer creates and closes a socket each tick; there is one per-agent socket and nothing else.
3. Attach a schedule set to fire within a minute. Watch the sidebar: the new session appears when the schedule fires. Before this slice it appears only once the first turn lands.
4. Send a Slack message to a channel-connected agent and confirm it still lands in the right thread's session — this exercises the ACP path that must keep working.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.

## Divergences taken while implementing

- **`createInProcessCaller` extracted** (`modules/acp/infrastructure/in-process-request.ts`). The trigger driver already had ~45 lines of JSON-RPC request plumbing inline; the sessions service needs the same. Rather than a second copy, it is now shared and the trigger driver migrated onto it — covered by `__tests__/unit/trigger-session-driver.test.ts`.
- **`AcpRuntime.isSessionRunning` added.** The turn-in-flight predicate (`hasTurnInFlight || isTerminalSessionActive`) was an inline closure at the intercept's call site and is now one named function on the runtime, so the ACP intercept and the tRPC service cannot drift on what "running" means.
- **The ACP intercept now composes through the same domain function** and re-emits `_meta.platform`, spreading the harness's original entry underneath so any field the platform does not model survives.
