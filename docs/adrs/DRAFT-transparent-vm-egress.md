---
title: A vm Agent's gateway takes egress without proxy settings and answers the machine's DNS itself
status: proposed
subsystem: security-and-credentials
tags: [gateway, envoy, dns, vm, egress]
summary: A vm Agent's gateway accepts TLS routed by SNI and plain HTTP routed by Host, and resolves every name to itself without resolving upstream, so everything in a machine reaches the network through the same egress-checked chains without proxy settings and no query name leaves the gateway.
---

# ADR: A vm Agent's gateway takes egress without proxy settings and answers the machine's DNS itself

**Date:** 2026-09-29
**Status:** Proposed
**Owner:** @jezekra1

## Context

A machine's only route out is its paired gateway, and until now the only way in was the explicit proxy. Whatever does not honour a proxy setting reaches nothing: a k3s pod gets no proxy variables, since k3s passes its own only to its containerd and kubelet, and fails on DNS before it opens a connection. Handing every pod the machine's proxy is not an answer either. It breaks in-cluster calls by short name, which match no proxy exception, and a platform run inside a machine sets its own proxy on its own agents. The machine cannot resolve names at all, because every resolver is outside its allowlist.

## Decision

A vm Agent's gateway also accepts egress that arrives without an explicit proxy — TLS routed by its SNI, plain HTTP by its Host — and answers the machine's DNS itself, giving its own address for every name and never resolving upstream. Everything in the machine then reaches the network only through the same egress-checked chains as the explicit proxy, with no proxy settings.

- **Nothing passes before its egress check.** Transparent TLS enters the same internal listener a CONNECT tunnel is unwrapped into, where every chain — credential chains and the chain for a host with none — checks egress before it dials. Plain HTTP goes through the proxy listener's own check. A never-approved host is held for approval exactly as a CONNECT to it is. A connection with no name to check — no SNI, no Host, not TLS — is refused.
- **Every DNS query reaches that resolver.** The machine's resolver setting names the gateway, which is what docker and k3s inherit, and a guest packet rule sends every DNS query bound for an address the machine does not treat as local to the gateway too, so software that picks its own server — a pod with its own nameservers, a hardcoded public resolver — gets the same answer. The rule makes such software work, it does not secure anything: without it those queries are dropped by the machine's allowlist.
- **The resolver answers and does nothing else.** Every A query gets the gateway's address, AAAA an empty answer, and every other type is refused. It never forwards, recurses or logs. A query name therefore goes no further than the gateway, and a denied host is never resolved anywhere; the gateway resolves only a host it has approved, when it dials it.
- **vm Agents only.** A container Agent's gateway is unchanged.
- **The explicit proxy stays.** Both paths meet the same chains, so a client that honours proxy settings behaves as before.
- **The limits do not move.** Only ports 80 and 443 are carried, and a connection to a literal address has no name to route by, exactly as through the proxy.

## Alternatives Considered

- **Proxy variables injected into every pod** — breaks in-cluster calls by short name and overrides the proxy a nested platform sets for its own agents.
- **Real DNS answers from the cluster's resolver** — every lookup of a name carrying data reaches that name's authoritative server, which is the exfiltration channel this must close.
- **Envoy's own DNS filter** — it answers only names it is configured with, exact or by suffix, so a host no one has approved yet gets no address and never reaches approval.
- **A forwarder inside the guest translating to CONNECT** — a second daemon in every guest, while the gateway already routes by SNI after it unwraps a CONNECT.
- **Redirecting all of the machine's traffic with guest packet rules** — still needs every name answered, and a connection redirected away from its destination reaches the gateway without that destination, so carrying literal addresses needs a forwarder in the guest; only DNS, whose destination the answer ignores, is redirected by rule.

## Consequences

- **Easier:** containers, builds and k3s pods in a machine reach approved hosts with no configuration — verified against Envoy 1.37 and CoreDNS 1.14 with a client holding no proxy settings: allowed HTTPS and HTTP reached their upstreams, a denied host was dropped at its egress check on both paths, and a connection without SNI was dropped. A platform nested in a machine works unchanged, its own gateways reaching out through the outer one.
- **Easier:** a tool that ignores proxy settings reaches the network from a machine, where before it failed with nowhere to go.
- **Harder:** a vm Agent's gateway runs a second container, the resolver, whose image is one more the install pulls and keeps current, and which keeps one capability: its binary carries the bind capability as a file capability, which the kernel refuses to exec once the capability is dropped.
- **Harder:** the gateway Service, its ingress policy and the runner's egress policy each open two more ports for vm Agents — the transparent TLS listener and the resolver over UDP and TCP.
- **Harder:** a client that checks the address it resolved, or resolves over HTTPS itself, sees the gateway's address or nothing; a connection to a literal address, or to a port other than 80 and 443, still reaches nothing.
- **Harder:** the DNS rule acts only on flows it sees start: a resolver that opened its upstream flows before the rule existed keeps them, observed with a long-running k3s whose CoreDNS kept real answers until it restarted. The image sets the rule at boot, before anything it starts.
- **Committed-to:** the resolver's answer carries no information — the same address for every name — and it never resolves upstream. Loosening either reopens DNS exfiltration.
- **Committed-to:** every chain reachable from the transparent listener checks egress before dialing. A chain added later without that check is reachable from a machine without approval.
