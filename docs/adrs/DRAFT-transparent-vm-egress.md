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

- **Nothing reaches an upstream it could not reach through the proxy.** The proxy listener tells a TLS handshake from a CONNECT or plain HTTP by its first bytes, and hands transparent TLS to the same internal listener a CONNECT tunnel is unwrapped into, so no new listener or port is opened for it. Every chain there that dials a host checks egress first — the credential chains, the chains a path rule promotes, and the chain for a host with none, which holds a never-approved host for approval exactly as a CONNECT to it does. The one chain without a check is the telemetry collector's: it reaches only the platform's own collector, and a CONNECT to that collector skips the check today too. Plain HTTP goes through the proxy listener's own check. A connection with no name to check — no SNI, no Host, not TLS — is refused.
- **Every DNS query reaches that resolver, by the VMM.** smolvm's network stack already intercepts every guest DNS query over UDP, whatever address it was sent to, and relays it from the runner to one upstream it is configured with; the runner configures that upstream as the machine's own gateway. So a pod with its own nameservers or a hardcoded public resolver gets the same answer, and nothing inside the guest, root included, can route DNS around it. A runner outside the cluster, which cannot reach the gateway's resolver, keeps relaying guest DNS nowhere.
- **The resolver answers and does nothing else.** Every A query gets the gateway's address, AAAA an empty answer, and every other type is refused. It never forwards, recurses or logs. A query name therefore goes no further than the gateway, and a denied host is never resolved anywhere; the gateway resolves only a host it has approved, when it dials it.
- **vm Agents only.** A container Agent's gateway is unchanged.
- **The explicit proxy stays.** Both paths meet the same chains, so a client that honours proxy settings behaves as before.
- **The limits do not move.** Only ports 80 and 443 are carried, and a connection to a literal address has no name to route by, exactly as through the proxy.

## Alternatives Considered

- **Proxy variables injected into every pod** — breaks in-cluster calls by short name and overrides the proxy a nested platform sets for its own agents.
- **Real DNS answers from the cluster's resolver** — every lookup of a name carrying data reaches that name's authoritative server, which is the exfiltration channel this must close.
- **Envoy's own DNS filter** — it answers only names it is configured with, exact or by suffix, so a host no one has approved yet gets no address and never reaches approval.
- **A forwarder inside the guest translating to CONNECT** — a second daemon in every guest, while the gateway already routes by SNI after it unwraps a CONNECT.
- **A separate listener and port for transparent TLS** — one more pod port in the Service and both policies, where the proxy listener can tell TLS from its own traffic by the first bytes.
- **Redirecting all of the machine's traffic with guest packet rules** — still needs every name answered, and a connection redirected away from its destination reaches the gateway without that destination, so carrying literal addresses needs a forwarder in the guest.
- **Pointing the guest's resolver at the gateway from inside the image** — smolvm intercepts every UDP DNS query before it leaves the guest and relays it to its configured upstream, so a resolver the image names is never reached; the relay's upstream is the one setting that decides.
- **smolvm answering names itself** — it answers only its own gateway's name; every other name is relayed or, under a host allowlist, refused, which would keep a never-approved host from reaching approval. A mode answering every name with one address would retire the resolver sidecar, and is the preferred end state if smolvm gains it.

## Consequences

- **Easier:** containers, builds and k3s pods in a machine reach approved hosts with no configuration — verified in a smolvm 1.21 machine (the platform pins 1.16.2; the DNS interception this relies on is the same code in both) with no proxy settings against a gateway rendered by this change (Envoy 1.39, CoreDNS 1.14): a query sent to 8.8.8.8 was answered with the gateway's address, a docker pull and allowed HTTPS and HTTP reached their upstreams, a denied host was dropped at its egress check, and a direct connection to another address was blocked by the allowlist. A platform nested in a machine works unchanged, its own gateways reaching out through the outer one.
- **Easier:** a tool that ignores proxy settings reaches the network from a machine, where before it failed with nowhere to go.
- **Harder:** a vm Agent's gateway runs a second container, the resolver, whose image is one more the install pulls and keeps current, and which keeps one capability: its binary carries the bind capability as a file capability, which the kernel refuses to exec once the capability is dropped.
- **Harder:** the gateway Service gains ports 80, 443 and 53 for vm Agents, and its ingress policy and the runner's egress policy open one more pod port, the resolver's, over UDP and TCP: TLS and HTTP arrive on the proxy port both already admit — and the machine API carries the resolver's address, so a change to it restarts the machine like a new allowlist does.
- **Harder:** a client that checks the address it resolved, or resolves over HTTPS itself, sees the gateway's address or nothing; a connection to a literal address, or to a port other than 80 and 443, still reaches nothing.
- **Committed-to:** the resolver's answer carries no information — the same address for every name — and it never resolves upstream. Loosening either reopens DNS exfiltration.
- **Committed-to:** every chain reachable from transparent TLS that dials a host of the agent's choosing checks egress first. A chain added later without that check is reachable from a machine without approval.
- **Committed-to:** smolvm's relay of guest DNS past the allowlist goes only to the gateway's resolver or nowhere. Pointing it anywhere that forwards reopens DNS exfiltration from inside the VMM.
