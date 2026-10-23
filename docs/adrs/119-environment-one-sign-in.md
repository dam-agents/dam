---
id: 119
title: An Environment is one sign-in, and an app that signs its own users in works behind it
status: accepted
subsystem: environments
tags: [environments, sign-in, cors]
summary: Signing in to one endpoint of an Environment gives the visitor a session on every endpoint of it, through a chain of the same one-time hand-offs; the gate answers CORS preflights from the Environment's own endpoints and lets their pages read its refusals; an app's own Authorization header reaches it, and only the platform's credentials are removed.
---

# ADR-119: An Environment is one sign-in, and an app that signs its own users in works behind it

**Date:** 2026-10-22
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-117

## Context

An agent installed DAM in an Environment, with an endpoint each for the UI, Keycloak, the share host and the content host, as DAM runs on its own cluster ([#5738](https://github.com/dam-agents/dam/issues/5738)).
The UI could not sign anyone in, because each endpoint admitted only the visitor who had signed in to that one address.
The UI asks the Keycloak endpoint for its settings before sign-in starts, and that call arrived with no session and was refused.
The browser also sends a CORS preflight with no cookies at all, and the gate removed every `Authorization` header, so a signed-in app never got its users' tokens.

## Decision

An Environment is one sign-in, and an app that signs its own users in works behind it.

- **One sign-in, every endpoint.** Signing in to one endpoint gives the visitor a session on each endpoint of that Environment: the browser passes through each other endpoint, which trades a one-time code bound to a secret of its own, as ADR-117's hand-off does, and then returns to the page it asked for.
- **Sessions stay per address.** Each endpoint keeps its own session cookie, scoped to its own origin.
- **The gate answers preflights from the Environment's own endpoints** with credentials allowed, and lets their pages read its refusals. The app still decides who may read its own answers.
- **An app's own `Authorization` header reaches the app.** Only the platform's credentials are removed: its API keys, and bearer tokens that name the platform's identity provider as their issuer, or name none.

This amends ADR-117's single-address sign-in and its rule that no `Authorization` header passes.

## Alternatives Considered

- **One cookie for the whole environments domain** — it has to give up the `__Host-` prefix, and the browser would send it to every Environment's app.
- **Endpoints on their own domain, `<endpoint>.<environment>.<domain>`** — one certificate and route per Environment, which counts against the shared Let's Encrypt limit of 50 a week, and a cross-origin call still needs credentials.
- **Endpoints that skip the sign-in** — a login server then opens to anyone with the link, while the Environment exists for invited reviewers.
- **One endpoint with a path per service** — every app would need a proxy in front of it, and the separate share and content origins are what keep artifacts from acting as the user.

## Consequences

- **Easier:** an app with a separate login server or API runs in an Environment with the addresses it has on its own cluster; DAM itself is one such app.
- **Harder:** signing in to an Environment with N endpoints takes N hand-offs, one more page load each; a page that calls another endpoint must send its cookies, as DAM's UI now does.
- **Harder:** an app's own bearer token now reaches the app, and a token that only claims another issuer passes too: the gate reads a token's issuer and does not check its signature.
- **Committed-to:** a session per address, which keeps the single wildcard certificate and the `__Host-` prefix for every endpoint.
