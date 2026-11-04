---
title: Native Codex subscription credentials
status: proposed
supersedes: "005"
subsystem: security-and-credentials
tags: [codex, credentials]
summary: Permit explicit per-agent native Codex subscription login while keeping platform-managed credentials in the gateway.
---

# Native Codex subscription credentials

**Date:** 2026-11-04
**Status:** Proposed
**Owner:** @ondrejsvec

## Decision

Permit an owner to select native ChatGPT subscription login for Codex on an agent.
Codex holds and refreshes that subscription's credentials in the agent's persistent home; all platform-managed provider and integration credentials remain gateway-side.
This is a narrow exception to the existing prohibition on agents holding upstream credentials.
Managed web, terminal and channel sessions select this mode explicitly through a subscription Connection.
The platform does not import native tokens into its API-key or gateway credential store.

## Context

Codex's supported device-login flow can authorize a headless agent against the owner's ChatGPT subscription.
The current OpenAI Connection and model-router setup support API credentials only, so native login alone does not power managed sessions.
The owner requested subscription selection for web chat and Slack as well as terminal use.

## Consequences

- **Easier:** One authorization on the agent serves Codex's terminal, web and channel sessions through its existing native authentication and token renewal.
- **Harder:** The harness and its tools can read the native credential, whereas gateway-held tokens remain outside the agent.
- **Harder:** Router-based model metering and spend limits do not cover native subscription requests.
- **Committed-to:** Each agent owns its login; the owner must sign in on another agent and explicitly log out to revoke the local session.
- **Committed-to:** API and native sessions must select their authentication paths independently and must not clear or silently reuse the other mode's credentials.

## Alternatives Considered

- **Keep API keys only** — does not provide the requested subscription access.
- **Paste the subscription token as an API key** — mixes authentication protocols and does not give Codex ownership of token renewal.
- **Implement a separate hosted OAuth integration** — requires its own OpenAI application integration and availability validation rather than reusing native Codex login.
