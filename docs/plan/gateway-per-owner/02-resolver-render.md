# 02 — Per-owner resolver render

**Part of:** gateway per owner — see [README](./README.md)

## Context

`machineDNSCorefile` in `packages/controller/pkg/reconciler/machine_egress.go` serves one block on 10053 and answers with `{$GATEWAY_IP}`, an env var on the `machine-dns` container.
With one CoreDNS for the owner, each agent needs its own block on its own resolver port answering with that agent's ClusterIP, and a change must not restart the container.

## Implementation plan

1. Turn the Corefile into a function of `[]{port, clusterIP}`: one server block per agent, same templates (NXDOMAIN for single labels and special-use suffixes, A with the agent's ClusterIP as a literal, empty AAAA, REFUSED otherwise), no `forward`, no `log`.
2. Add the `reload` plugin to each block so CoreDNS rereads the Corefile when the ConfigMap file changes (default 30 s check; set `reload 2s`).
3. The owner container drops the `GATEWAY_IP` env var; keep the container for container Agents as today.
4. Keep the comment explaining why there is no forward or log plugin.

## Acceptance criteria

- [ ] Existing `machine_egress_test.go` cases pass for container/legacy rendering.
- [ ] A rendered owner Corefile with two agents loads in the pinned CoreDNS image (`coredns -conf … -dns.port …` with `-plugins` check or a short `dig` against a local run) and answers each port with its own address.
- [ ] Every block lacks `forward` and `log` (assert by string in an existing-style test, or by reading the render).

## Smoke test

`mise run //packages/controller:test`; run the pinned CoreDNS image locally on the rendered file and `dig @127.0.0.1 -p <port> example.com` for each agent port.
