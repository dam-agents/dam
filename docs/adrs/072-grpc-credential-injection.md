# ADR-072: Gateway credential injection for gRPC hosts

**Date:** 2026-06-23
**Status:** Accepted
**Owner:** @xjacka

## Context
The agent egress gateway injects upstream credentials on the wire so the live secret never enters the agent pod, but that path was HTTP/1.1-only. Onboarding a gRPC-based upstream (Modal, used by the K-Search kernel-optimization workload) left only two bad options: put the live token in the pod, or open broad egress — both giving up guarantees the gateway exists to provide.

## Decision
A host's terminating chain can opt into HTTP/2 so the gateway's credential injection applies to a gRPC request stream; the default stays HTTP/1.1 and is byte-for-byte unchanged. Credentials the gateway injects still never enter the pod — the existing invariant now holds for gRPC too. Where a protocol requires the client to send a credential's **non-secret** half itself (a public identifier such as an account/token id), that half may be delivered as a plain pod env; only the secret half is gateway-injected.

## Alternatives Considered
- **Live token in the agent pod** — a pod compromise would expose the working credential, the exact failure the gateway prevents for every other host.
- **Open/broad egress for the workload** — the upstream's traffic spans third-party storage on dynamic hostnames, so the only practical broad allow is "allow all," defeating default-deny egress.
- **Transparent egress capture (redirect all)** — reverses the deliberate lockdown-plus-explicit-proxy model and per-pod gateway isolation, with platform-wide blast radius.

## Consequences
- **Easier:** gRPC upstreams onboard as ordinary credentialed connections with the secret off the pod, same boundary as REST hosts — verified end-to-end against Modal (token-secret injected, gRPC eval ran on a remote GPU).
- **Harder:** the per-host chain now negotiates protocol (h2 ALPN downstream, protocol-mirroring upstream); a client that ignores the egress proxy must be adapted to route through it, because the gateway blocks rather than redirects.
- **Committed-to:** the per-host HTTP/2 opt-in is load-bearing for any future gRPC integration; the non-secret-half-in-pod carve-out is an intentional, documented narrowing of "nothing sensitive in the pod" — only the secret half is protected.
