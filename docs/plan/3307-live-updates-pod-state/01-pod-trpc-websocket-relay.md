# 01 — Pod tRPC over WebSocket, and the agent relay

**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

Everything else in this feature needs a duplex channel to the pod's tRPC router, because tRPC subscriptions cannot travel over the current `httpBatchLink`-through-a-proxy path. This slice builds that channel and nothing else: the pod serves its existing router over WebSocket in addition to HTTP, and the api-server relays it as a fourth relay beside ACP, terminal and SSH. No router procedures change and no UI code changes, so the slice is verifiable on its own and leaves every existing caller on HTTP.

The relay's activity policy is the subtle part and is specified once in the [README](./README.md#the-relay-policy-in-one-place). Read it before writing code — getting it wrong either pins agents awake forever or hibernates a pod under someone's editor.

## Implementation plan

Apply `/typescript-engineering`.

**Pod side — `packages/agent-runtime/src/server.ts`**

1. The tRPC router is already served over HTTP by `createHTTPHandler` at line 180. Add a WebSocket handler for the *same* router and the *same* context factory using `applyWSSHandler` from `@trpc/server/adapters/ws` (already present in `packages/agent-runtime`'s dependency tree). Keep one context factory so the two transports cannot drift.
2. Register a `noServer: true` `WebSocketServer` and dispatch to it from the existing upgrade switch at line 498, which already branches on `/api/acp`, `/api/terminal` and `/api/ssh`. Add `/api/trpc-ws` alongside them, mirroring the naming the api-server already uses for its own endpoint.
3. Set `perMessageDeflate: false`, matching all three api-server relays. This is not cosmetic: permessage-deflate allocates a zlib context per connection, which is the standard way to exhaust a small memory limit.
4. Ensure the handler is torn down on process shutdown alongside the existing servers.

**api-server side**

5. Add `createAgentTrpcRelay` under `packages/api-server/src/apps/api-server/agent-proxies/`. Model it on `acp-relay.ts`, but it is strictly simpler: a **dumb frame relay** that copies text frames both ways without parsing them. It must not interpret tRPC at all.
6. Readiness at upgrade is **passive**: call `agentsRepo.isReady(agentId)` and close the socket if it is not ready. Do **not** call `ensureReady` — see `acp-relay.ts`'s `passive` branch for the existing shape of this.
7. Take **no** session pin. `acp-relay.ts` does `const release = passive ? () => {} : presence.acquire(agentId)`; this relay always takes the no-op path.
8. Start a 30s interval on upgrade that patches `LAST_ACTIVITY_KEY` via `agentsRepo.patchAnnotation`, and clear it on close. Reuse the 30s constant the other three relays already declare. **Do not** trigger this from frame traffic — the README explains why (tRPC's keepalive is a `"PING"` *data* frame every 5s, so any traffic-driven rule fires forever on an idle connection).
9. Wire it into the route map at `packages/api-server/src/apps/api-server/app.ts:148` as `"/api/agents/:id/trpc-ws": relayRoute(relayAdmission, agentTrpcRelay, "trpc")`. The existing `createRelayAdmission` gives you authentication, ownership, the `agents:operate` scope check, the key-to-agent binding check, terms gating, and the WS attach audit event for free.
10. Leave `trpc-proxy.ts` and its HTTP route in place, untouched. Sub-issue 02 moves callers off it; deciding its fate is not this slice's job.

## Acceptance criteria

- [ ] `mise run check` and `mise run test` pass.
- [ ] A tRPC client using `wsLink` against `/api/agents/:id/trpc-ws` can call an existing query (`files.listDirs`) and a mutation, with results identical to the HTTP path.
- [ ] The relay code contains no reference to tRPC message shapes — it relays frames opaquely.
- [ ] Upgrading against a hibernated agent closes the socket and does **not** wake it: the agent stays hibernated and its `last-activity` annotation is unchanged.
- [ ] An open connection patches `last-activity` on a ~30s cadence, and stops when the connection closes.
- [ ] An open connection does **not** set the `active-session` annotation.
- [ ] An unauthenticated upgrade, a non-owner upgrade, and an agent-bound key for a different agent are all refused.

## Smoke test

`mise run check && mise run test` for the suites, then against a cluster (`cluster-ops` skill):

```
mise run cluster:install
mise run cluster:status
```

With an agent running, drive the new endpoint from a scratch script under `.locki/tmp/` using `@trpc/client`'s `createWSClient` + `wsLink` pointed at `/api/agents/<id>/trpc-ws` with a bearer token, and call `files.listDirs({paths:[""]})`. Compare against the same call over `/api/agents/<id>/trpc`.

Then confirm the hibernation properties by hand:

```
kubectl get agent <id> -o jsonpath='{.metadata.annotations}'
```

Read it twice ~40s apart with the socket open (the stamp should move once), then with the socket closed (it should not move). Confirm `agent-platform.ai/active-session` is absent throughout.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
