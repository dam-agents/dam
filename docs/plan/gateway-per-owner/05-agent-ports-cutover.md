# 05 — Agent ports, Service cut-over, readiness

**Depends on:** 04
**Part of:** gateway per owner — see [README](./README.md)

## Context

The identity of an agent at the owner gateway is the pod port its own Service forwards to.
This slice allocates those ports, points each vm Agent's gateway Service at the owner pod, and makes `GatewayPodReady` mean "this agent's listener is current".
The Service keeps its ClusterIP (`syncGatewayServicePorts` in `iptables_init.go` already updates ports in place), so no machine spec changes.

## Implementation plan

1. Allocation in `owner_gateway.go`, under the owner's lock: each vm Agent of the owner gets a slot `n` in a fixed range; proxy port `20000 + 2n`, resolver port `20001 + 2n`.
   The slot is read back from the agent's gateway Service target port, so a controller restart reallocates nothing; a free slot is the lowest one no Service of the owner holds.
2. Render the agent's listener (01) and resolver block (02) on its slot, then retarget its gateway Service: selector to the owner gateway pod, target ports proxy/80/443 → proxy slot, 53 udp/tcp → resolver slot.
   Retarget only after the owner pod reports the agent's listener current (step 3), so an agent never routes to a pod that does not serve it.
3. Readiness: GET `http://<agent gateway ClusterIP>:<envoyPort>/__platform_healthz` from the controller and compare the body with the listener revision; replace the pod-ready read for vm Agents in `publishReadiness` (`agent_reconciler.go`) with that check, under the same `GatewayPodReady` condition, so the api-server's wake relay (`agent-lifecycle` Wake) needs no change.
   Requeue on a stale revision with a short backoff; Envoy applies a watched file within about a second.
4. Host runner (`vm-host-runner.md`): `exposeGatewayOnHost` keeps making the agent's Service a NodePort; the NodePort follows the retargeted Service, so nothing else changes.
   Verify.
5. Confirm on k3s and on OVN-Kubernetes that a ClusterIP drops traffic to undeclared ports (README Q3); the identity rests on it.

## Acceptance criteria

- [ ] Two agents of one owner route to the owner pod; each reaches only its own listener: a guest's `curl` to its own ClusterIP on a port the Service does not declare fails, and its sibling's ClusterIP is outside its allowlist.
- [ ] `GatewayPodReady` turns false when an agent's listener is missing or stale, and true when current.
- [ ] Controller restart: every agent keeps its slot (target ports unchanged).
- [ ] No machine restarts at cut-over (runner log shows no stop/start for the cut-over agents).

## Smoke test

Local cluster with the flag on, two vm Agents of one owner: chat with each, `vm-runner exec` into one guest and `curl -v https://api.github.com` (through its own listener), then `curl -m3 http://<sibling ClusterIP>:10000/` (fails).
