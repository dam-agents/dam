---
id: 117
title: Environments sign their visitors in through the share host
status: accepted
subsystem: environments
tags: [environments, share, sign-in]
summary: An Environment address without a session sends its visitor to a front door on the share host, which signs them in with the share session and client, decides access and hands the address a one-time code bound to the visitor's browser; the address's session lasts while the share session does, and the address refuses requests other origins make in the visitor's name. The Environments sign-in host and its Keycloak client are removed.
---

# ADR-117: Environments sign their visitors in through the share host

**Date:** 2026-10-21
**Status:** Accepted
**Owner:** @jezekra1
**Amends:** ADR-109

## Context

ADR-109 gave Environments a sign-in of their own: a fixed host under the environments domain with an identity provider client of its own.
The share host already signs visitors in for restricted artifacts with its own client and session, so a reviewer signed in twice for the same person, the platform ran two flows that do the same thing, and a refused visitor saw the refusal on a page under the Environment's own domain, which the app otherwise owns.

## Decision

The share host is the front door of every Environment; this replaces only how ADR-109's people sign in.

- **One sign-in.** An address without a session sends a page load to `/e/<address>` on the share host, which signs the visitor in with the share session and the share client. A visitor already signed in passes straight through, with no page and no click.
- **The decision is shown on a trusted host.** The share host checks the owner and the effective list and either shows the refusal, naming the account and offering to switch it, or hands the address a code that works once, for that address only, within a minute.
- **The code is bound to the browser.** The address gives the browser a sign-in secret in a cookie of its own and sends only its hash to the share host; the code is accepted only with the secret, so a code that leaks from a URL opens nothing in another browser.
- **The address stays the gate.** It trades the code for a session cookie of its own, scoped to its origin, and checks the list again on every request.
- **One sign-in, one sign-out.** The address's session lasts only while the share session it came from does; signing out of an address ends both and the identity provider's session, so the next person on a shared device does not pass straight through.
- **Only the visitor's own pages act in their name.** Every page under the platform's parent domain, an artifact or another Environment's app among them, is the same site as an address, so the browser sends the session cookie with any request they make. The address refuses a request whose `Origin` is not an endpoint of its own Environment, whatever cookie it carries.
- **Removed:** the sign-in host under the environments domain and its identity provider client.

## Alternatives Considered

- **Keep a sign-in of the Environments' own** — two sign-ins and two clients for one person, and the refusal on an untrusted origin.
- **The app's own client and session** — its tokens are valid on the platform API, which no host that untrusted code shares may hold.
- **A session cookie for the whole environments domain** — every Environment app could read or set it.
- **A short-lived token in each page, sent with every request**, as [#5706](https://github.com/dam-agents/dam/issues/5706) proposes for the share relay — an Environment's pages are the app's own, which the platform cannot change, so only the `Origin` the browser sends is left to tell them from another site's.
- **An unbound code** — anyone who reads the code from a log, the history or a referrer before it is used would get the visitor's session.

## Consequences

- **Easier:** a reviewer who opened a restricted artifact opens an Environment link without signing in again; the chart and realm carry one by-link client instead of two.
- **Harder:** the share host now serves a route of the Environments module, so a change to the share session or its sign-in reaches Environments too.
- **Harder:** an app whose own pages call another of its Environment's endpoints passes, but one that calls an address from a page elsewhere, such as an app on another host that embeds it, is refused.
- **Committed-to:** the share host as the one place by-link visitors sign in, and a one-time code bound to the browser, never a token, as what crosses from it to an Environment address.
