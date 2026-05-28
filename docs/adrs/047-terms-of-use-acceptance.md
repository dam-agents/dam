# ADR-047: Terms of Use acceptance — api-server gate with hash-as-proof

**Date:** 2026-05-25
**Status:** Accepted
**Owner:** @tomkis

## Context

Users sign in via Web UI OIDC and start using Platform without ever being shown the Terms of Use. There is no record they read or agreed, no in-app way to review what they agreed to, and no signal when terms change — existing users keep operating under stale text. Issue #372 sets the requirement.

Keycloak ships a built-in `terms_and_conditions` Required Action that fits inside the OIDC flow, but it records only an acceptance timestamp — no version, no content binding — and gating CLI / Slack / Telegram surfaces on top of it still requires Platform-side enforcement.

## Decision

Acceptance is gated by an api-server middleware on the public port. Every JWT-authenticated route — UI tRPC + ACP, CLI tRPC, Slack and Telegram inbound — refuses with HTTP 412 when the requesting sub has no Acceptance row for the current Terms Version. The bootstrap routes (`/api/health`, `/api/brand`, `/api/version`, `/api/auth/config`, `/api/oauth/callback`, `/api/terms`, `/api/terms/accept`) are exempt.

The re-prompt trigger is a free-form `terms.version` string in Helm values that the operator bumps when a change is material. Whitespace fixes and typo corrections that don't bump the version don't re-prompt anyone.

Proof is recorded as `sha256(terms.text)` computed at api-server boot. Every Acceptance row stores both the `version` (trigger) and the `hash` (proof). The hash binds an Acceptance to the exact text shown; the gate never compares hashes.

State lives in a new Postgres table `terms_acceptances`, composite PK `(sub, version)`, append-only history. Acceptance is idempotent (`ON CONFLICT DO NOTHING`).

`terms.text` is markdown. Both `terms.text` and `terms.version` are required Helm values; the chart refuses to install when either is unset. `GET /api/terms` is public so the login page and any pre-signup link can render the document.

The harness port stays ungated — scheduled and autonomous agent runs survive a version bump, treated as consequences of prior consent.

## Alternatives Considered

- **Keycloak built-in `terms_and_conditions` Required Action** — records only a timestamp; re-prompt on version bump needs a Helm post-upgrade Job calling Keycloak admin API; UI is Keycloak-themed; can't gate CLI / Slack / Telegram on its own.
- **Custom Keycloak SPI (Required Action JAR with hash compare)** — adds a Java artifact pinned to the running Keycloak version; build + image + version-bump pipeline for one TOS flow.
- **Hash-as-trigger (any edit re-prompts)** — contradicts the "material change" framing; typo fixes would force every user through the prompt.
- **Keycloak user attribute as the acceptance store** — the JWT was minted before accept, so the claim is stale until a token refresh; departs from the existing pattern where Platform-owned state lives in Postgres (cf. `identity_links`).
- **UI-only gate** — CLI device-flow lets a user authenticate without ever loading the UI; "no use without acceptance" requires server-side enforcement on every authenticated surface.

## Consequences

- **Easier:** re-prompt is structural — `helm upgrade --set terms.version=v2` and every stale sub starts hitting 412 on the next gated call. No bulk Keycloak admin API operation, no JAR redeploy, no operator-side runbook.
- **Easier:** legal audit is one SQL query — `SELECT sub, version, hash, accepted_at FROM terms_acceptances WHERE sub = ?`. The hash binds proof to an exact text, recoverable from git history of the Helm values file.
- **Easier:** TOS prompt is brand-consistent with the rest of the UI; no Keycloak-themed page in the middle of an otherwise Platform-themed flow.
- **Harder:** the prompt fires *after* sign-in completes rather than inside the OIDC flow. Users land in the UI for a moment before the modal renders. One extra paint vs the Keycloak-native path.
- **Harder:** every new install must supply legal content at install time. Chart fails fast when `terms.text` / `terms.version` are unset; documented as required Helm values.
- **Committed-to:** Postgres as the substrate for Acceptance state. Moving back to Keycloak attributes later means migrating the history table and reissuing tokens.
- **Committed-to:** free-form `terms.version` as the re-prompt signal — admin judgment, not text-derived. The operator owns the call on whether a change is material; whitespace edits don't re-prompt.
