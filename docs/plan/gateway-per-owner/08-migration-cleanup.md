# 08 — Migration on dev and cleanup

**Depends on:** 06, 07
**Part of:** gateway per owner — see [README](./README.md)

## Context

Dev runs 104 vm Agents for 30 owners on per-agent gateways.
With the flag on, each vm Agent moves at its next reconcile: 05 retargets its Service once the owner listener is current, which changes no machine spec.
This slice removes what the move leaves behind and makes the move reversible.

## Implementation plan

1. After an agent's Service is retargeted and `GatewayPodReady` holds, delete its per-agent gateway StatefulSet, Envoy ConfigMap, leaf Certificate and Secret, gateway ingress and egress NetworkPolicies and, once its AuthorizationPolicies admit only the owner principal, its per-agent ServiceAccount.
   Keep the agent's gateway Service and ext-authz Service.
2. Flag off: the reconcile renders the per-agent gateway again, waits for its pod Ready, retargets the Service back to it, and only then lets the sweep drop the agent from the owner gateway; an owner with no owner-gateway agents loses the owner gateway.
3. Runtime migration (`runtime_migration.go`, `vm-runtime-migration.md`): a migrating container Agent keeps its per-agent gateway, which admits the runner, until its Backend switches; the switch hands it to the owner gateway through step 1.
4. Prod order: enable per owner only after the container→VM migration's platform-driven phase has moved that owner's agents, so no owner runs both gateway kinds for long; container Agents stay on per-agent gateways until the container Backend is deleted, when the per-agent code goes with it.

## Acceptance criteria

- [ ] On the local cluster, flipping the flag on moves every vm Agent without a machine restart and leaves no per-agent gateway object for them.
- [ ] Flipping it off moves them back with at most one connection reset per agent.
- [ ] A runtime migration started with the flag on completes and ends on the owner gateway.

## Smoke test

Local cluster with three vm Agents across two owners: flag on, `cluster:install`, `kubectl get sts -l role=gateway` is empty for them; flag off, they return; `mise run e2e:run` passes in both states.
