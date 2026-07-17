---
id: 005
title: "Gateway pattern for credentials — agent never sees tokens"
status: accepted
subsystem: security-and-credentials
summary: Route all external service calls through a credential-injecting gateway so the agent never holds tokens, with per-service policy, audit logging, and human-in-the-loop approval.
---
# ADR-005: Gateway pattern for credentials — agent never sees tokens

**Date:** 2026-04-01
**Status:** Accepted
**Owner:** @pilartomas

## Context

Harness agents need access to external services (GitHub, Slack, Cloudflare, etc.) but giving them raw credentials is a security risk. The agent could exfiltrate tokens, use them beyond intended scope, or be tricked via prompt injection into misusing them. Approval fatigue (approving everything after the 10th dialog) makes blanket allow/deny useless.

Radek's example: "Allow all operations in my personal project git repo, but only non-destructive actions in the work repo. Allow deploy to Cloudflare but don't delete projects or steal secrets."

## Decision

The agent never sees a token. All requests to external services go through a gateway that:

1. Decides via deterministic rules whether to inject credentials and let the call through
2. Supports fine-grained, per-service policy (e.g., allow read but block delete on a specific API)
3. Logs every request/response for audit
4. Supports human-in-the-loop approval for sensitive operation classes

A human authorizes a class of requests; the gateway enforces the boundary on every call. Least-privilege enforced structurally, not by trusting the agent.

OneCLI is the reference implementation. NanoClaw already ships this pattern.

## Alternatives Considered

**Pass credentials to the agent (environment variables).** Rejected: agent has full access, no enforcement, no audit trail. One prompt injection away from exfiltration. This is the OpenClaw model and it's the source of their security track record.

**Prompt-based permission control.** Tell the agent "don't use these credentials for X." Rejected: not enforceable. The agent can ignore instructions. Security must be structural, not behavioral.

**Per-request human approval.** Every API call requires human approval. Rejected: approval fatigue makes this useless in practice. The gateway should approve classes of requests, not individual calls.

## Consequences

- Agents are structurally unable to escalate, reuse, or accumulate access beyond what was approved
- The gateway becomes a critical component — it must be reliable, fast, and correct
- Gateway must run outside the agent container (separate process/pod) so a compromised agent can't reach it
- Enables a strong audit trail for compliance (every external request logged with agent identity and outcome)
- Adds latency to every external call (proxy hop)
- Implementation complexity: per-service rules, credential injection, HITL approval flow
