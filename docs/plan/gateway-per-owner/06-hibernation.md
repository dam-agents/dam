# 06 — Hibernation and wake without the gateway

**Depends on:** 05
**Part of:** gateway per owner — see [README](./README.md)

## Context

For vm Agents, "should the pair be up" is the per-agent gateway StatefulSet's replica count: `pairAwake` and `applyGateway` in `agent_reconciler.go`, `agentDesiredUp` in `budget.go`, `scaleAgentPairToZero` in `idlechecker.go`, and the wake ordering comment that scales the gateway before the agent side.
With the owner gateway, hibernation stops only the machine.

## Implementation plan

1. Record desired-up for an owner-gateway agent as a controller-owned annotation on its gateway Service, written by the reconcile and by `scaleAgentPairToZero`; read it in `pairAwake` and `agentDesiredUp`.
2. Skip `applyGateway` for these agents, and drop the "gateway before agent side" ordering and its `runnerAccepted` special case for them; `publishGatewayTurnedReady` becomes a no-op since the listener is up while the agent sleeps (README Q5: listeners stay configured while hibernated).
3. The idle checker's hibernated status (`idlechecker.go` sets `GatewayPodReady` false with `Hibernated`) stays, so the api-server's state projection is unchanged.
4. Budgets (`budgets.md`) exclude vm Agents already; check nothing else counts a gateway replica.

## Acceptance criteria

- [ ] A warm wake publishes `Ready` once the guest answers; the controller timing trace has no `gatewayStatefulSet`/`gatewayReadiness` marks for the agent and the runtime's first hello succeeds (no retry in the runtime log).
- [ ] Hibernation is still published only after the runner reports the machine stopped.
- [ ] Existing `vm_agent_lifecycle_test.go`, `idlechecker_test.go` and `budget_test.go` pass, with expectations changed only where they asserted the gateway replica count for an owner-gateway agent.

## Smoke test

Local cluster: hibernate a vm Agent, wake it from the UI, and read the controller's reconcile timing log for that agent; compare wake-to-Ready with and without the flag.
