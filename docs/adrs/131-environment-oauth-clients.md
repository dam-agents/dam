---
id: 131
title: A person's own OAuth clients sign in to an Environment through Keycloak, with a token for that one address
status: accepted
subsystem: environments
tags: [environments, oauth, mcp, keycloak]
summary: An Environment address is an OAuth protected resource whose authorization server is the platform's Keycloak; a client registers itself, signs the person in with PKCE and consent, and gets a token whose only audience is the one address it asked for, which the gate checks with the same lists a browser session gets.
---

# ADR-131: A person's own OAuth clients sign in to an Environment through Keycloak, with a token for that one address

**Date:** 2026-11-06 **Status:** Accepted **Owner:** @jezekra1 **Amends:** ADR-117, ADR-119

## Context

ADR-117 let a person reach an Environment address only through a browser: the share host signs them in and hands the address a one-time code.
Agents now build MCP servers in Environments, and people want to use them from their own MCP clients — IDEs, desktop apps, CLIs (#6318).
Such a client gets an HTML sign-in page with status 401, which tells it nothing, and fails.

## Decision

Each Environment address is an OAuth protected resource (RFC 9728), and the platform's Keycloak is its authorization server.

- **The gate points a client at Keycloak.** A request with no credential that is not a page load gets a 401 naming the address's resource metadata, which the gate serves before the app; a page load keeps ADR-117's front door.
- **A token is for one address.** A client registers itself with Keycloak anonymously, signs the person in with PKCE, and asks for the `environments` scope with the address as its `resource` (RFC 8707). A Keycloak extension makes that address the token's only audience and keeps it on every refresh; a sign-in without one valid address, or without an offline session, is refused.
- **The same lists decide.** The gate checks the token's signature, issuer, audience and expiry, then admits its person as a browser session's: the owner by `sub`, anyone else by a verified email on the lists at that request.
- **Clients and callbacks are bounded.** Anonymous registration requires the person's consent, allows only the two scopes and callbacks on the install's list, caps the number of clients, and unused clients are deleted after 30 days.
- **A token-carrying request waits for a sleeping Environment**, up to a minute.

## Alternatives Considered

- **Each address its own authorization server** — duplicates Keycloak's sign-in, consent and refresh in the api-server.
- **Keycloak with one shared audience for all Environments** — a token one untrusted MCP server collects would open every Environment the person may open.
- **A Keycloak client per Environment with the experimental resource-indicators feature** — the api-server would need `manage-clients`, which can rewrite the platform UI client's redirects.
- **A pre-registered client** — a client cannot discover its id; the person would have to type it into each tool.

## Consequences

- **Easier:** a person adds an Environment's address to any client that follows the MCP authorization standard and signs in once with their platform account; removing them from the Share dialog stops their client at its next request.
- **Harder:** the platform's Keycloak image now carries Java code of the platform's own that implements internal SPIs, which Keycloak may change in any release; anyone may register a client, bounded by consent, the callback list and the cap; a sign-in needs an offline session, which outlives the person's sign-out until it is unused for 30 days or revoked.
- **Committed-to:** an address's exact form as a token audience, shared byte for byte by the gate and the extension; the path `/.well-known/oauth-protected-resource` on every address, which no app can serve.
