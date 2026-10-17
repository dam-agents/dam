# 07 — Owner gateway rolls and restarts

**Depends on:** 04
**Part of:** gateway per owner — see [README](./README.md)

## Context

A pod-template change of the owner gateway (Envoy image, resources, trust bundle) restarts egress for every running agent of the owner.
Today such a change rolls each agent's gateway independently; an owner roll needs the pacing runner rolls already have (`vm_runner_rollout.go`, `vm-runner-upgrades.md`).
The superseded-pod eviction (`forceRollStuckPod`) and the gateway failure warning (`credential-gateway` page) must keep working.

## Implementation plan

1. Surge: the Deployment's `maxSurge: 1, maxUnavailable: 0` keeps the old pod serving until the new one is Ready; agent Services select both during the overlap, so new connections move and old ones drain within the termination grace (README Q4: raise from 5 s, measure).
2. Pace template changes across owners with the runner rollout's in-flight limit and idle wait, reusing its bookkeeping rather than a second scheduler.
3. Keep `forceRollStuckPod` for the owner Deployment's pods: a pod not Ready on a superseded template is evicted.
4. Gateway failure surfacing: a crash-looping owner pod marks `GatewayPodReady` false with the failure message on every agent of the owner, so the UI warning appears on each.
5. Credential or listener changes never change the template (03, 01), so they never roll.

## Acceptance criteria

- [ ] An Envoy image bump on the local cluster rolls owner gateways one owner at a time, and a running `curl` stream through the old pod finishes within the grace.
- [ ] Killing the owner gateway pod marks every agent of the owner with the gateway warning until the replacement is Ready.
- [ ] Existing `vm_runner_rollout_test.go` passes.

## Smoke test

Local cluster with two owners: change the Envoy image tag in values, `mise run cluster:install`, and watch `kubectl get pods -l role=gateway -w` roll owners in turn.
