# ADR-007: ACP traffic always proxied through the API Server

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @tomkis

## Context

The UI needs to communicate with agent pods over ACP (WebSocket). Two options: the UI connects directly to agent pod Services, or traffic is relayed through the API Server. Direct connections are simpler but expose agent pods to the network. Proxying adds a hop but centralizes access control.

The platform's security model (ADR-005) depends on agents being network-isolated — they should only reach the outside world through the credential-injecting gateway (OneCLI). Allowing arbitrary inbound connections to agent pods weakens this boundary.

## Decision

All ACP traffic flows: UI WebSocket → API Server → agent pod WebSocket. The UI never connects directly to agent pod Services.

The API Server connects to agent pods via stable headless Service DNS (`{instance}-0.{instance}.{ns}.svc:8080`). NetworkPolicy enforces this — only the API Server pod is allowed ingress to agent pods on the ACP port.

When the target instance is hibernated, the API Server auto-wakes it: patches `spec.yaml` with `desiredState: running`, waits for the Pod to reach Ready, then connects and relays normally. The UI also exposes a manual wake endpoint (`POST /api/v1/instances/:id/wake`).

The relay also owns session-row persistence: a session is written to the DB on its first prompt, never on creation alone. Any ACP-speaking client gets this for free; sessions that are never prompted leave no orphan rows.

## Alternatives Considered

**Direct UI-to-pod connections.** Simpler, lower latency. Rejected: breaks the network isolation model. The UI would need to be able to reach every agent pod, and NetworkPolicy couldn't distinguish UI traffic from other inbound connections. Also doesn't work with wake-on-connect since the pod doesn't exist yet.

**Sidecar proxy per pod.** Each pod gets an envoy/nginx sidecar handling auth. Rejected: heavy per-pod overhead, more complex to configure, and still requires the pod to be running.

## Consequences

- Single point of access control for all agent communication — NetworkPolicy is simple and enforceable
- API Server holds relay state and becomes a throughput bottleneck for ACP traffic
- Wake-on-connect works transparently — the UI doesn't need to know whether a pod is running
- Added latency from the extra WebSocket hop
- API Server failure disconnects all active sessions
- Session persistence has a single, authoritative write path; UIs and external clients share it
