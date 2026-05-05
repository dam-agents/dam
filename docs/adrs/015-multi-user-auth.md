# ADR-015: Multi-user authentication via Keycloak + OneCLI fork with token exchange

**Date:** 2026-04-08
**Status:** Accepted (§3 — OneCLI fork — superseded by [ADR-033](033-envoy-credential-gateway.md); Keycloak login + label-based ownership remain in force)
**Owner:** @tomkis

## Context

Platform is currently single-tenant. There is no authentication on the API server, no ownership on K8s resources, and OneCLI credentials are shared per-template across all instances. To support multiple users, we need: (1) user identity, (2) resource scoping, (3) per-user credential isolation.

OneCLI only supports Google OAuth and has no concept of per-user scoping. Its dashboard is not suitable for end users — OneCLI must remain an invisible implementation detail behind our API server.

## Decision

### 1. Keycloak as the identity provider

Add Keycloak to the cluster (Helm subchart). All user authentication flows through Keycloak via standard OIDC. Users log in through our UI, which obtains a JWT from Keycloak.

### 2. Label-based resource ownership (soft tenancy)

All K8s resources (instance ConfigMaps, schedule ConfigMaps) get a `platform.ai/owner` label set to the authenticated user's ID. The API server filters all queries by this label. No namespace-per-user — everything stays in a single namespace.

Templates remain shared (team-level resources, no owner label).

### 3. Fork OneCLI ~~(removed — see ADR-033)~~

> **Removed by ADR-033.** OneCLI itself was retired in favour of an Envoy
> credential-injector sidecar. Per-user credential isolation now lives in K8s
> Secrets keyed by `platform.ai/owner`; the RFC 8693 token-exchange path against
> a OneCLI audience no longer exists. The Keycloak login surface and the
> label-based ownership decisions in §1 and §2 remain unchanged.

### 4. API server as the OneCLI proxy

Users never talk to OneCLI. The API server:

- Authenticates the user via Keycloak JWT.
- Exchanges the token via RFC 8693 for a OneCLI-scoped token.
- Calls OneCLI's API with the exchanged token.
- Exposes credential management endpoints (add, list, delete) as tRPC procedures.
- Handles OAuth redirect flows for external services (GitHub, Google) and stores resulting tokens in OneCLI via API.

### 5. Network isolation

OneCLI is not exposed to users. NetworkPolicy restricts access to OneCLI pods — only the API server and controller can reach it.

## Alternatives Considered

**Namespace-per-user.** Hard isolation via K8s namespaces. Rejected: operational overhead (one OneCLI + PostgreSQL per namespace), overkill for the current scale, harder to share templates.

**userId as a plain API parameter (no token exchange).** API server passes user-id to OneCLI without cryptographic proof. Rejected: OneCLI blindly trusts the caller — if the API server is compromised, attacker can impersonate any user. Token exchange gives OneCLI a self-enforcing security boundary.

**Keep OneCLI unmodified, use secretRef for user credentials.** Users create K8s Secrets manually, instances reference them via `secretRef`. Rejected: two credential paths (OneCLI for shared, Secrets for personal), poor UX, users need kubectl access.

**Direct user sessions in OneCLI.** Users log into OneCLI dashboard directly via Keycloak SSO. Rejected: OneCLI becomes user-visible, which violates the requirement that it remain an implementation detail.

## Consequences

- Keycloak becomes a required infrastructure dependency (PostgreSQL already exists for OneCLI).
- Fork maintenance burden — must track upstream OneCLI changes and merge selectively.
- Exchanged tokens need caching and refresh logic in the API server to avoid per-request Keycloak round-trips.
- OneCLI's PostgreSQL schema must support per-user scoping — may require migration depending on current schema.
- External service OAuth flows (GitHub, Google) become the API server's responsibility — OneCLI's built-in OAuth for these services may need rework or bypassing.
