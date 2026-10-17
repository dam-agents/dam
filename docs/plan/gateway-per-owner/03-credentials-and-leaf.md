# 03 — Per-owner credential Secret and leaf

**Part of:** gateway per owner — see [README](./README.md)

## Context

Each gateway pod mounts one volume per granted credential Secret (`envoyVolumes` in `envoy.go`), so adding a Connection changes the pod spec and restarts it.
With one pod per owner that would restart every agent of the owner, so the owner pod mounts one controller-written Secret holding the credential keys of every Secret granted to any of the owner's vm Agents.
The controller already has full Secret RBAC (`helm/templates/controller/rbac.yaml`) and reads these Secrets to render chains, but has never written credential bytes; this slice makes it do so.

## Implementation plan

1. Collect per agent with `listAgentCredentialSecrets` (grants filtered as today), take the union by Secret name, and copy only the keys `gatewayDataKeys` names into `<runner name>-gateway-credentials`, each key prefixed `<secret name>.` so files never collide.
   The Secret carries the owner and runner labels and no owner reference to an Agent, so the runner's sweep collects it.
2. Chain renders in 01 point SDS and signing files at `/etc/envoy/credentials/<secret>.<key>`.
3. Write the Secret only when its content hash changes; log names and counts, never values.
4. Rotation: keep `refreshGatewayCredentials`'s annotation stamp, computed over the source Secrets' resource versions, on the owner pod.
5. Leaf: one `Certificate` per owner, SANs the union of every agent's intercepted hosts, built with `BuildEnvoyLeafCertificate`'s rules (`leaf.go`).
   A new host re-issues the leaf; Envoy reads the cert files via the watched directory, so no restart.
   The CA a machine trusts (`machineTrustedCAs` from the leaf's `ca.crt`) is unchanged, so no machine reboots.
6. A Secret the controller cannot read, or a missing SDS key, degrades that host to allow-only exactly as `chainsFromSecrets` does today.

## Acceptance criteria

- [ ] Unit test (exception: this is a trust boundary): a Secret granted to no vm Agent of the owner never appears in the per-owner Secret, and a Secret of another owner never does even if an Agent names it.
- [ ] Revoking a grant removes its keys on the next reconcile.
- [ ] No credential value reaches a log line or an event (grep the new code paths for `slog` arguments).

## Smoke test

`mise run //packages/controller:test`; on the local cluster with the flag on, `kubectl get secret <runner>-gateway-credentials -o jsonpath='{.data}' | jq 'keys'` lists only keys of granted Connections (local cluster only, never prod).
