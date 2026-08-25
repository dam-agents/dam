# 02 — Per-agent UI client moves to WebSocket

**Depends on:** 01-pod-trpc-websocket-relay
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

The UI has two tRPC clients: the api-server one in `packages/ui/src/api.ts`, already WebSocket-only, and the per-agent one in `packages/ui/src/modules/agents/agent-trpc.ts`, an `httpBatchLink` through the api-server's HTTP proxy. This slice moves the second onto the relay from 01, making the two structurally the same and giving later slices somewhere to put subscriptions.

The surface is smaller than it looks. Only three places construct the per-agent client: the Files panel's queries, the reachability probe, and `harnessConfig.current`. UI `skills.*` calls go through the api-server router, not this client.

This slice is also where the readiness churn dies. `ensureReady` runs on *every* proxied call and its `bumpLastActivity` has no debounce, so an open Files panel patches the Agent record every 2 seconds. With a relay, readiness is checked once per upgrade.

## Implementation plan

Apply `/react-ui-engineering`.

1. **`packages/ui/src/modules/agents/agent-trpc.ts`** — rebuild `createAgentTrpc` as `createWSClient` + `wsLink`, mirroring `packages/ui/src/api.ts`. Point the URL at `/api/agents/${agentId}/trpc-ws`, pass the token through `connectionParams` the way `api.ts` does rather than as a header (headers are not available on a WS upgrade from the browser), and keep `lazy` and `keepAlive` consistent with `api.ts`.
2. **Unreachability moves to connection state.** Today the client's `fetch` wrapper scrapes HTTP 502 to call `markAgentUnreachable` / `clearAgentUnreachable`. A WebSocket has no per-call status, so drive those from `createWSClient`'s `onOpen` / `onClose` / `onError` — the same pattern `api.ts` uses to feed the api-health tracker. This is strictly better than the status-scraping it replaces, which treated any 502 from any procedure as agent-level unreachability.
3. **Client cache.** Three call sites each memoize their own client (`files/api/queries.ts` has a module-level `Map`, `harness-config.ts` has `agentTrpcFor`, the probe memoizes per render). A WebSocket per client instance makes duplication expensive where it previously was not — consolidate to one shared per-agent client cache and have all three use it. Make sure the cache disposes the socket when an agent is no longer in use, or a session of agent-hopping leaks sockets.
4. **Retire the reachability probe.** `packages/ui/src/modules/agents/hooks/use-agent-reachability-probe.ts` polls `files.listDirs({paths:[""]})` every 3s while an agent is marked unreachable. Connection state now carries that signal, so delete the hook and its call site rather than leaving a vestigial poller.
5. **Leave the polls alone.** The 5s session poll and both 2s file polls stay exactly as they are; they move transport but not mechanism. Sub-issues 04, 05 and 06 remove them.
6. Run `mise run ui:fix`.

## Acceptance criteria

- [ ] `mise run check`, `mise run test` and `mise run ui:fix` are clean.
- [ ] Every existing per-agent call still works from the UI: file listing, read, write, create, mkdir, rename, delete, attachment upload, and `harnessConfig.current`.
- [ ] One WebSocket per open agent, not one per call site — verifiable in DevTools' network tab.
- [ ] With the chat view open, `last-activity` is patched on a ~30s cadence rather than every 2s.
- [ ] Stopping an agent while its view is open marks it unreachable through connection state, and starting it again clears that without a probe.
- [ ] `use-agent-reachability-probe.ts` is deleted and has no remaining references.
- [ ] Switching between several agents in one session does not accumulate open sockets.

## Smoke test

Against a cluster with an agent running, open the chat view and in DevTools:

1. Network → WS: exactly one socket to `/api/agents/<id>/trpc-ws`.
2. Exercise the Files panel — expand directories, open a file, rename it, upload an attachment in the composer. All succeed.
3. Confirm the annotation cadence has changed, which is the measurable win:

```
kubectl get agent <id> -o jsonpath='{.metadata.annotations.agent-platform\.ai/last-activity}'
```

Read it twice 10 seconds apart with the panel open. Before this slice the value moves every read; after it, it should be unchanged across a 10s gap.

4. `mise run cluster:stop-agent <id>` (or hibernate it) with the view open, and confirm the UI shows it as unreachable without any repeating request in the network tab.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
