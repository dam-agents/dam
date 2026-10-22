---
id: 098
title: The Model Router in agent-runtime routes model calls by provider-qualified name
status: accepted
supersedes: 067
subsystem: harness-config
tags: [model-router, providers, sessions, spend]
summary: One loopback router inside agent-runtime takes every harness's model calls and forwards each by its provider-qualified model name to that provider's Connection, so a session picks any granted provider's model per turn and one harness process serves them all.
---

# ADR-098: The Model Router in agent-runtime routes model calls by provider-qualified name

**Date:** 2026-10-12
**Status:** Accepted
**Owner:** @janjeliga

## Context

A harness process reads one provider's credentials and endpoint from its
env, so an agent could use models from one provider per session, and a
session that wanted another provider's model needed a new session on a
new process. The agent-runtime kept one harness process per harness,
provider and model triple, and each provider's requests left the pod on
their own gateway chain. Claude Code already needed a loopback gateway to
rename a custom upstream's catalog (ADR-067); the other harnesses had
nothing of the kind, and the platform's spend figures came from Claude
Code's own export alone ([#4380](https://github.com/dam-agents/dam/issues/4380)).

## Decision

**The agent-runtime runs one Model Router on the pod's loopback that every
harness process points its single base URL at, and the router forwards each
call by the provider-qualified model name in its body (`<alias>/<upstream
id>`) to that provider's Connection, with the Connection's placeholder
credential, which the credential gateway swaps for the real key.** The
harness process is therefore per harness, not per provider or model, and
a session changes its model, on any granted provider, per turn.

The rules of the decision:

- Model names are qualified with a fixed provider alias per provider
  preset; a bare name is not a model on this runtime. An agent holds at
  most one Connection per alias.
- The router passes requests through in the dialect the harness speaks
  (Messages, Chat Completions, Responses) and refuses a dialect the
  provider does not serve; it does not translate between dialects.
- A session's model is a per-turn choice the runtime applies inside the
  live harness, through the harness's own per-session call or, for a
  harness that cannot switch, by the router on the session's marker; the
  Config panel offers no model.
- The router writes one spend record per call, with the usage read off
  the response and the cost from the model catalog's price, exported on
  the pod's telemetry rail. It is the spend source per session, which the
  credential gateway cannot see; it runs inside the agent's pod, so a spend
  limit does not rest on it. The spend reader prefers these records over a
  harness's own.
- Each harness defaults to its home provider when the agent holds it
  (Claude Code: Anthropic, Codex: OpenAI, Bob: Bob's gateway); Pi has none
  and takes the shared alias order.
- A session's subagent model binds every subagent the session starts:
  Claude Code's through its env with the force flag, Bob's and Codex's by
  the router on their parent marker, and platform sub-agents spawned from
  the session, whatever model the spawn names.
- The Anthropic subscription token is routed too, the router adding its
  OAuth beta flag, and offered to Claude Code alone; Bedrock, whose SigV4
  signing is no header swap, keeps reaching the harness process as env.

This supersedes ADR-067's routing: the Claude Code gateway's catalog
renaming and name mapping now happen in the router for every harness, and
each provider is no longer fronted apart.

## Alternatives Considered

- **One harness process per provider, as before**: a session is pinned to
  one provider for its life, and a fleet of processes per agent for a
  choice a session makes per turn.
- **A full proxy (LiteLLM) in the pod**: the image, memory and cold-start
  costs ADR-067 measured, and its re-encoding drops API fields.
- **Route in the credential gateway (Envoy) by model name**: the gateway
  sees the body only on its own MITM chain, and the harness still needs one
  base URL and one catalog per process; the renaming has to happen in the
  pod anyway.

## Consequences

- **Easier:** a session mixes providers per turn, and a schedule names a
  model on any granted provider; one harness process per harness instead of
  one per triple (the runtime keeps a lease per harness and settings set).
- **Easier:** spend is counted once, by the same code, on every harness,
  with the provider and session on each record; Bob's spend reaches Usage,
  which its own export never did.
- **Harder:** every model call passes an extra in-pod hop and the usage
  scanner; the router is one more process-wide failure point in the pod.
- **Harder:** passing through without translating means each harness and
  provider pair can hit a dialect quirk (a field one provider refuses, a
  reasoning item another cannot replay); each costs a small rule in the
  router or a manifest, and the set grows with every model family.
- **Harder:** stored bare model names (schedules, saved pairs) had to be
  qualified or cleared by a one-shot migration, and two runtime shapes run
  in the fleet until every agent carries the router image.
- **Committed-to:** the qualified name format and the alias per preset are
  now a contract across the api-server, the UI, the CLI and the runtime; the
  router's record is the spend source per session.
