# ADR-NNN: Fake Slack server for e2e testing

**Date:** 2026-05-20
**Status:** Proposed
**Owner:** @tomkis

## Context

The Slack integration ([ADR-018](018-slack-integration.md), [ADR-021](021-slack-outbound.md), [ADR-025](025-thread-session.md), [ADR-027](027-slack-user-impersonation.md)) routes mentions, runs the `/platform login` OAuth flow against Keycloak, resumes thread-bound ACP sessions, forks per-turn pods for foreign repliers, and serves outbound MCP. [ADR-014](014-integration-testing.md) committed to e2e tests against the full stack in a cluster, but Slack cannot be reached from CI, so none of these branches are covered today.

## Decision

Slack e2e tests run against a Platform-managed **fake Slack server** deployed as a sibling component in the e2e cluster. The fake terminates Slack's WebSocket and HTTP surface so the api-server's Bolt App connects to it unmodified, and exposes a separate test-driver API for scripting inbound events and asserting outbound calls.

The fake is a distinct deliverable from the api-server — its own package, image, and deployment, gated by a chart value so production installs never carry it.

Decision rules:

- The fake terminates only Slack's surface — Socket Mode and the Web API methods the worker actually calls. Bolt is not patched, monkey-patched, or run in a custom mode.
- The test-driver API is Slack-shaped (users, channels, messages, slash commands, ephemerals, reactions, files). Platform-vocabulary helpers live in test fixtures, not in the fake.
- A single workspace, isolated across tests by unique per-test identifiers. Multi-workspace was rejected because Bolt binds one Socket Mode connection to one workspace.
- State is in-memory; per-suite cleanup is the cluster recreation [ADR-014](014-integration-testing.md) already pays for.
- The bot identity is chart-configured so the api-server's first `auth.test` call is deterministic.
- Failure injection is per-method, with an explicit count, returned by the fake then cleared.
- The OAuth linking flow stays anchored to **real** Keycloak. The common case pre-seeds `identity_links`; the linking flow itself is covered by a narrow set of tests that drive Keycloak's authorize endpoint via a `fetch` + cookie-jar helper. No headless browser, no fake Keycloak.

Out of the fake's responsibility: Platform instance creation and channel binding (real api-server), `identity_links` pre-seeding (test DB direct), foreign-replier fork credentials per [ADR-038](038-paired-gateway-pod.md) (real K8s Secrets), and the MCP outbound path itself per [ADR-021](021-slack-outbound.md) (real api-server endpoint, fake only records the resulting Web API call).

## Alternatives Considered

- **Swap the worker behind the channel manager interface** — skips the routing, identity, and thread-resume code that is the thing the e2e suite must lock in.
- **Swap the Bolt App instance, keep worker code** — skips Bolt's middleware, ack semantics, and Socket Mode transport; relies on internals that shift across library versions.
- **In-process library fake started by the test runner** — diverges from [ADR-014](014-integration-testing.md)'s cluster-deployed pattern and doubles the testing surface.
- **Fake Keycloak alongside fake Slack** — second substitute to maintain; stops catching real-Keycloak regressions at upgrade time.
- **Headless browser for the OAuth flow** — pulls a browser runtime in for a handful of tests; the `fetch` + cookie-jar helper covers the same ground.
- **Domain-shaped test API (`simulateMention`, etc.)** — hides the Slack vocabulary the worker and [ADR-018](018-slack-integration.md) already use; a domain layer is a cheap helper on top.

## Consequences

- **Easier:** the routing, identity-gating, thread-resume, fork-trigger, and MCP outbound paths in the Slack worker become exercisable from a single cluster-deployed test run — previously zero of them were covered by automated tests.
- **Easier:** the OAuth flow is covered by 3–5 narrow tests using a single ~30-line helper rather than a browser harness.
- **Easier:** the pattern extends to per-instance channels ([ADR-029](029-per-instance-channels.md)) — a Telegram fake follows the same shape when those flows need coverage.
- **Harder:** the fake's protocol implementation is pinned to whatever Slack surface Bolt calls; minor-version bumps of Bolt need a fake re-check before merge.
- **Harder:** two new operational surfaces in the chart — an extra deployment and an extra ingress — to keep green even though they only run in e2e clusters.
- **Committed-to:** the api-server now exposes a way to redirect Bolt's API endpoint. That redirection is part of the api-server's interface contract for as long as e2e tests rely on it.
- **Committed-to:** the test-driver API speaks Slack. New Slack API calls in the worker must be added to the fake before the corresponding e2e test can run.
