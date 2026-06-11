# ADR-067: Local model gateway fronts custom Anthropic upstreams for claude-code

**Date:** 2026-06-10
**Status:** Accepted
**Owner:** @Tomas2D

## Context

When claude-code is pointed at a custom Anthropic-compatible upstream (e.g.
the IBM LiteLLM ETE proxy), the usable model set is whatever that upstream
serves — under upstream-specific ids Claude Code's built-in names don't match.
The provider presets pinned those ids by hand in the env bundle, so the
catalog silently went stale as models were added or retired, and every change
meant editing pins ([#702](https://github.com/dam-agents/dam/issues/702)).
Claude Code can discover models live from the endpoint it talks to, but it
discards catalog entries without a recognized provider prefix (verified
empirically: raw upstream ids never reach the `/model` picker; `claude/`-
prefixed ones do) — so something the agent controls must serve a renamed
catalog and translate the names back on each request.

## Decision

**When the agent's Anthropic base URL points at a custom upstream, the
claude-code image fronts it with a loopback passthrough gateway — run as the
runtime-supervised pod service ([ADR-066](066-pod-service-supervision.md)) —
and the harness entry paths re-point Claude Code at it.** The gateway serves
the upstream's live catalog with chat-capable models renamed into the prefix
namespace Claude Code's discovery accepts, maps names back to the verbatim
upstream id on each request, and otherwise forwards requests byte-for-byte —
it does not re-encode bodies, so unknown fields and beta headers survive. It
also derives Claude Code's tier-default vars
(`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`) — the latest model per tier
by a version-ordering heuristic (numeric components compared in order;
8-digit date stamps only break ties) — served as a loopback env endpoint the
harness entry paths fetch and eval before launching Claude Code, applied
assign-if-unset so a value set manually on the agent wins; the same fetch is
the readiness probe. The main and subagent models are deliberately *not*
pinned: Claude Code's own tier selection stays in charge. Model ownership
moves out of the provider presets entirely: presets carry credentials and
endpoints, the gateway derives tier defaults, and an idempotent api-server
boot sweep strips the pins that pre-gateway preset saves snapshotted into
stored secrets — assign-if-unset would otherwise let those stale pins mask
discovery forever. Env changes reach the running gateway as an ADR-066
SIGHUP reload: it re-reads the runtime's env snapshot and re-points in
place, so in-flight streams survive a mid-turn provider re-save. Its upstream hop rides the same egress path as everything else in
the pod (the HTTP(S)_PROXY Envoy chain with credential injection). With no
custom upstream the gateway never runs and Claude Code talks to the
Anthropic API directly.

## Alternatives Considered

- **Hand-pinned model ids in provider presets (status quo)** — stale the day
  the upstream catalog changes; pins live in stored secrets, so fixes require
  every user to re-save the provider.
- **No gateway: point Claude Code's discovery at the upstream directly** —
  routing works, but discovery silently drops the upstream's unprefixed ids,
  so the live catalog never reaches the model picker — the core of #702.
- **A full LiteLLM proxy as the gateway (first implementation)** — does the
  same renaming but costs a Python + LiteLLM tree (~700 MB image growth, its
  own CVE surface, ~0.5 GiB RSS forcing a bigger pod memory limit, 10–25 s
  cold start), and its `litellm_proxy` mode re-encodes requests through its
  SDK, silently dropping API fields it doesn't know. Kept as the fallback if
  a future upstream is *not* Anthropic-compatible and needs real protocol
  translation (the OpenAI-compatible provider track, #393).
- **api-server-side discovery injected over the runtime channel** — the
  api-server holds no upstream credentials by design (they live in the
  gateway pod's Envoy); it cannot call the upstream's model endpoint.
- **Rename rule in the paired gateway pod's Envoy** — body rewrites on
  streaming requests in Envoy filters are awkward, and a claude-code-specific
  model-name rule would leak harness knowledge into controller-rendered
  shared infrastructure.

## Consequences

- **Easier:** connect the provider once and every model the token can reach
  is usable; catalog changes propagate at each session start (Claude Code's
  discovery fetch re-pulls the upstream catalog) with no stored-secret edits
  (the pins this replaces were snapshotted into each saved secret).
- **Easier:** the gateway is a single dependency-free script on the Node
  runtime the image already ships — no new interpreter, no Trivy surface
  growth, RSS in the tens of MB, sub-second cold start.
- **Harder:** the platform owns passthrough correctness (streaming, header
  hygiene, request cancellation) instead of delegating it to an off-the-shelf
  proxy; protocol translation for non-Anthropic upstreams is explicitly out
  of scope.
- **Committed-to:** the loopback port (24180 — below the ephemeral range and
  away from common dev-server defaults, since agent workloads share the
  network namespace) and the env-endpoint handshake between the gateway and
  the harness entry paths (shims, SSH login hook) are now image-internal ABI;
  the
  upstream must keep serving an OpenAI-compatible model-list endpoint; and
  the prefix namespace is load-bearing — Claude Code dropping or changing its
  discovery prefix rules breaks the catalog path, which is why the image pins
  the Claude Code version and bumps it deliberately with a discovery
  smoke-check.
