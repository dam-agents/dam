# 07 — Home feed on an owner subscription

**Depends on:** 04-session-watch
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

The Home feed's `useFeed` (`packages/ui/src/modules/home/api/queries.ts`) runs `useQueries` over every *running* agent, calling `listAgentSessions` every 15s. Before sub-issue 03 each of those calls opened and closed an ACP WebSocket, so an open Home tab churned one socket per running agent per tick.

The other slices all scope a subscription to the one agent a tab is looking at. Home cannot work that way: doing the same thing here would mean N *persistent* relays per tab, each pinning a pod-side Watch, which is worse than the poll it replaces. So this is the one place where the api-server holds the pod-facing streams and fans out — moving the connection count off the tab axis and onto the agent axis.

Two things this slice must **not** do. It must not fold into `events.owner`: that subscription takes no input and every tab mounts it unconditionally, so keying pod streams off it would hold a stream to every running agent of every logged-in owner forever, breaking the issue's central requirement. And its streams must stamp no activity — they exist for every running agent of every watching owner, so one stamp would pin the whole fleet awake.

Scope note: hibernated agents contribute nothing to the feed, and that stays true. The Home PR documents it as a deliberate limitation ("read state lives in the sandbox pod, so unread is knowable only for running sandboxes"), with a server-side projection named as a separate decision. See ADR-084's alternatives. This slice fixes the fan-out only.

## Implementation plan

Apply `/typescript-engineering` for the server, `/react-ui-engineering` for the UI.

1. **Contract** — a new subscription on the api-server's router, owner-scoped and input-less, yielding notices that carry an `agentId`. Reuse the existing `LiveEvent` discipline: a topic plus ids, never state, schema-parsed on receipt. Gate it like `events.owner` does — `readAgentProcedure` plus the wildcard-binding check, since the stream spans every agent the owner has. Its **existence is the signal** that someone is watching Home; that is why it is a distinct procedure rather than a topic on the always-mounted stream.
2. **Holder** — a module that, while at least one subscriber exists, maintains a `sessions.watch` subscription to each *running* agent over the pod relay from 01, and republishes each notice to that owner's subscribers tagged with the `agentId`.
3. **Lease it.** Use `createLeaderLease` (`packages/api-server/src/core/leader-lease.ts`) so one replica holds the pod-facing streams, and forward notices to other replicas over the Redis bus (`packages/api-server/src/core/redis-bus.ts`) — the pattern the channel workers and the live-events Agent watch already use. `apiServer.replicas` is 1 by default so the lease is a no-op today, but the design has to be right above one, and this keeps the stream count flat as replicas grow.
4. **Attach and detach off the existing watch, not a poll.** The lease-elected Agent watch in `packages/api-server/src/modules/live-events/infrastructure/k8s-agent-watch.ts` already sees agents becoming Ready and not-Ready. Drive stream attachment from it rather than polling the K8s API.
5. **No activity stamping, no pins, no wakes** on these streams. Reuse the relay's server-held-stream path from 01 and make sure this cannot accidentally take the user-facing path — an agent must still hibernate on schedule with a Home tab open.
6. **UI** — in `useFeed`, delete `refetchInterval: SESSIONS_POLL_MS` and its constant, subscribe to the new procedure, and invalidate only `homeKeys.sessions(agentId)` for the agent named in the notice. That is what makes this cheaper than polling rather than more expensive: one refetch per real change, zero at idle, instead of N every 15s. Debounce the invalidation so several agents changing at once does not produce a burst of refetches.
7. Keep `unreadableAgents` working — an agent that becomes unreachable mid-stream should surface the same way it does today, not vanish silently.
8. Run `mise run ui:fix` and `mise run common:check:comment-types`.

## Acceptance criteria

- [ ] `mise run check`, `mise run test` and `mise run ui:fix` are clean.
- [ ] `SESSIONS_POLL_MS` and its `refetchInterval` are gone from `packages/ui/src/modules/home/api/queries.ts`.
- [ ] A turn starting on one agent refetches **only that agent's** list, not every agent's.
- [ ] With Home open and nothing happening, there is no repeating request or notice traffic.
- [ ] With **no** Home subscriber, the api-server holds no pod streams — verify by closing all Home tabs and checking the pods have no watch subscription.
- [ ] Agents still hibernate normally with a Home tab left open — the streams stamp nothing.
- [ ] An agent hibernating while Home is open drops out of the feed without an error state, and rejoins when it wakes.
- [ ] Nothing was added to `events.owner`.
- [ ] Feed items — approvals, in-progress, unread — render as they did before.

## Smoke test

`mise run check && mise run test`, then against a cluster with several agents running:

1. Open Home. In DevTools → Network, confirm no 15s repeating requests and no per-agent socket churn.
2. Start a turn on one agent from another tab. Home's feed updates, and only that agent's session query refetches (check the query devtools or the network panel).
3. Close every Home tab, then confirm no pod is still being watched for sessions.
4. **The important one** — leave a Home tab open on an idle install and wait out the idle timeout (or set an agent's hibernation timeout to a couple of minutes for the test). The agents must still hibernate. If they do not, the streams are stamping activity.
5. Hibernate an agent manually while Home is open; it should leave the feed cleanly and come back on wake.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.

## Divergences taken while implementing

- **No lease, and no cross-replica presence keys.** The holder runs on whichever replica has the subscribers, deduped per (owner, agent) inside that replica. At `apiServer.replicas: 1` — the chart default — that is byte-identical to the lease-elected design: exactly one pod stream per running agent. Above one replica it becomes at most one per replica rather than exactly one, which still moves the count off the tab axis, the property that mattered. Making it exactly one needs a short-TTL Redis presence key per owner plus a scan loop on the holder (the shape `session-presence.ts` uses for agents); that is worth building when a multi-replica install exists, not before, and it is the piece that would be least verifiable without one.
- **Attach and detach are hint-driven, not polled.** The holder re-evaluates an owner's running set when an `agents` or `sync` notice arrives on that owner's existing Redis channel, which the lease-elected K8s watch already publishes. No new watch, no timer.
- **Home still reads over the passive ACP path.** Only the *trigger* moved. Reading over the per-agent WS client would open one per running agent and the relay's stamp would keep the fleet warm — the regression sub-issue 03 avoided. The api-server holds the pod streams for notices; the browser's read stays passive and now happens only when something changed.
- **No stamping is structural rather than enforced.** The holder dials pods directly, the way `files-service.ts` already does, so it never passes through the relay that stamps.
