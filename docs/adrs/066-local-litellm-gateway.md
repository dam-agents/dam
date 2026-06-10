# ADR-066: Local LiteLLM gateway fronts custom Anthropic upstreams for claude-code

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
Claude Code can discover models live from a gateway, but only by asking the
endpoint it talks to — so something the agent controls must serve that
catalog.

## Decision

**When the agent's Anthropic base URL points at a custom upstream, the
claude-code image fronts it with a loopback LiteLLM proxy — run as the
runtime-supervised pod service ([ADR-065](065-pod-service-supervision.md)) —
and the harness entry paths re-point Claude Code at it.** The gateway
discovers the upstream's live model catalog, serves every chat-capable model
through Claude Code's gateway model discovery, and pins the model env vars to
the latest model per tier — assign-if-unset, so a value set manually on the
agent wins. Model-pin ownership moves out of the provider presets entirely:
presets carry credentials and endpoints, the gateway derives models. With no
custom upstream the gateway never runs and Claude Code talks to the Anthropic
API directly.

## Alternatives Considered

- **Hand-pinned model ids in provider presets (status quo)** — stale the day
  the upstream catalog changes; pins live in stored secrets, so fixes require
  every user to re-save the provider.
- **api-server-side discovery injected over the runtime channel** — the
  api-server holds no upstream credentials by design (they live in the
  gateway pod's Envoy); it cannot call the upstream's model endpoint.
- **Point Claude Code's gateway discovery at the upstream directly** — the
  upstream's catalog ids aren't namespaced the way Claude Code's discovery
  expects, and embedding/utility models would surface as chat models; the
  local proxy is where that normalization happens.

## Consequences

- **Easier:** connect the provider once and every model the token can reach
  is usable; catalog changes propagate on the gateway's refresh interval with
  no stored-secret edits (the pins this replaces were snapshotted into each
  saved secret).
- **Harder:** the claude-code image gains a Python + LiteLLM dependency tree
  (hundreds of MB, its own CVE surface — tracked by the image's Trivy scan)
  and a second proxy hop on every request.
- **Harder:** the gateway's memory footprint (~0.5 GiB) comes out of the
  agent container's budget; the default template limit must account for it.
- **Committed-to:** the loopback port and the pins-file handshake between the
  gateway and the harness entry paths (shims, SSH login hook) are now
  image-internal ABI; and the upstream must keep serving an
  OpenAI-compatible model-list endpoint for discovery to work.
