# ADR-070: API keys with scopes for headless CLI use

**Date:** 2026-06-15
**Status:** Proposed
**Owner:** @jezekra1

## Context

Browser users authenticate with short-lived Keycloak JWTs that the web app silently refreshes. Headless and CI callers — the `dam` CLI in a pipeline, a cron job — have no interactive session to refresh against, and minting a Keycloak service account per pipeline is heavyweight and grants all-or-nothing access. We need a long-lived credential a user can mint for themselves, scope down, and revoke, without standing up a second authentication path through the API.

## Decision

Introduce **API keys**: long-lived, owner-scoped bearer credentials that share the existing `Authorization: Bearer` slot with Keycloak JWTs, distinguished by a `pk_` prefix. The server dispatches on the prefix and both paths resolve to one authenticated-principal shape, so every downstream consumer is unchanged. The plaintext is shown once at creation and only a hash is stored; a key is rejected the moment its owner is deactivated in Keycloak, so offboarding needs no separate revocation sweep. API keys cannot mint or revoke API keys — that surface requires an interactive session.

A key carries the owner's identity, a set of permission **scopes**, and an **agent binding** (wildcard, or a specific set of agent IDs). Authorization is a fixed five-scope vocabulary over two resources:

- `agents:read` — read-only view of agents and their configuration.
- `agents:operate` — run a live agent: approvals, workspace file upload, ACP/terminal attach. Running mutates state through the agent (filesystem, schedules), so this is deliberately *not* a read-only scope.
- `agents:manage` — full agent configuration and lifecycle, including assigning credentials to agents. **Wildcard-bound by design**: a key with this scope cannot be restricted to a subset of agents.
- `credentials:read` / `credentials:manage` — list, versus create/update/delete, of connections and secrets.

Any agent scope grants reading agents; `credentials:manage` implies `credentials:read`; `agents:operate` and `agents:manage` are independent. `agents:read` and `agents:operate` keys may be bound to a specific agent set; the binding is enforced per agent-targeted call.

## Alternatives Considered

- **Keycloak service account per pipeline** — heavyweight to provision and all-or-nothing; no per-agent or per-capability narrowing.
- **A separate API-key header and auth path** — duplicates the auth middleware and doubles the surface that must stay in sync; prefix dispatch in the existing slot avoids it.
- **Per-endpoint ACLs instead of scopes** — finer-grained but unbounded and hard to reason about at mint time; a small fixed scope set is auditable.
- **Per-agent `agents:manage` from day one** — would add a binding check to every management endpoint for a use case not yet demanded; wildcard-only now, downscope when asked.
- **JWT-style self-describing keys** — avoid a storage lookup but cannot be revoked before expiry; hash lookup gives immediate revocation.

## Consequences

- **Easier:** CI and automation authenticate with one env var that accepts either credential type, so the CLI never branches on auth. An exfiltrated key is bounded by its scope and binding — a read-only or single-agent key cannot reconfigure or run other agents. Deactivating an owner in Keycloak invalidates every key they hold on the next request, with no key-table sweep.
- **Harder:** `agents:manage` is coarse — it cannot be scoped to a subset of agents, so a key that provisions agents can also reconfigure every other agent the owner has (egress rules, schedules, channels). A second credential type shares the bearer slot, so every change to the auth surface must be validated against both the JWT and API-key paths.
- **Committed-to:** the `pk_` prefix and the scope names are a public contract — they appear in CLI flags and in stored keys, so renaming them is a breaking change. Hash-only storage means a lost plaintext is unrecoverable; keys are rotated, never recovered.
