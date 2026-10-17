# 04 — Owner gateway workload behind a flag

**Depends on:** 01, 02, 03
**Part of:** gateway per owner — see [README](./README.md)

## Context

This slice creates the owner gateway pod and everything around it, but no agent routes to it yet: agent Services still select their per-agent pods.
It lands behind `virtualization.gateway.perOwner`.

## Implementation plan

1. Chart: `helm/values.yaml` `virtualization.gateway.perOwner: false`, passed to the controller's env; `packages/controller/pkg/config` reads it.
2. In a new `packages/controller/pkg/reconciler/owner_gateway.go`, render under the owner's lock from the agent reconcile that ensures the runner (`ensureRunner` in `vm_runner.go`):
   - a ServiceAccount `<runner>-gateway` (no token mount), so the mesh principal is the owner's;
   - a ConfigMap with the bootstrap, LDS, CDS and Corefile from 01 and 02;
   - a Deployment, 1 replica, `maxSurge: 1, maxUnavailable: 0`, Envoy and CoreDNS containers with today's security contexts, the credential Secret and leaf mounts from 03, labels `role=gateway`, the owner label and the runner's component labels;
   - memory request `40Mi + k × agents` with `k` measured here (README Q2), CPU request as today per pod;
   - one ingress NetworkPolicy: the owner's runner on the agent port range (`endPort`) for TCP and UDP, the controller on the agent proxy ports;
   - one egress NetworkPolicy built by `BuildGatewayEgressNetworkPolicy` with the owner selector;
   - per agent: the harness and ext-authz AuthorizationPolicies admit the owner gateway principal (`authorization_policy.go`) in addition to the agent SA while both gateways exist.
3. The Deployment is removed only by the runner's orphan sweep (`vm_runner.go`, the delete of everything named after the runner), so the gateway lives exactly as long as the runner.
4. Update `runnerEgress` in `vm_runner.go` to admit the owner gateway pod on the agent port range, beside today's per-agent gateways.
5. Add the owner gateway to the runner rollout's pod hash only if it is rendered from runner settings; otherwise its own roll is 07's.

## Acceptance criteria

- [ ] With the flag off, nothing new is rendered (existing tests pass; `vm_backend_test.go` unchanged).
- [ ] With the flag on, an owner with vm Agents gets exactly one gateway Deployment, Ready, while every agent still routes to its old gateway.
- [ ] The sweep that removes a runner removes the owner gateway, its ConfigMap, Secret, Certificate, SA and policies.
- [ ] `k` (MiB per agent listener) and Envoy memory at 1, 5 and 15 agents measured and written in the PR.

## Smoke test

`mise run //packages/controller:test && mise run //packages/controller:check`; on the local cluster with the flag on, `kubectl get deploy,cm,secret,netpol -l <owner label>` shows the owner gateway objects and `kubectl logs` of its Envoy shows the listeners loaded.
