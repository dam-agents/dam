# ADR-064: Slack E2E — Bolt behind a swappable port, fork path exercised end-to-end

**Date:** 2026-06-10
**Status:** Accepted
**Owner:** @tomkis
**Builds on:** ADR-056, ADR-018, ADR-027

## Context

Slack is the hardest surface to test by hand: it needs a real workspace, two linked humans, and a foreign-user reply to hit the fork path. #444 is exactly that path — a linked non-owner in an unrestricted channel gets `Authentication required (code -32000)`, which is a fork-pod credential failure (the foreign user's egress credential never reaches the forked Job) surfaced back through ACP, not a Slack-layer fault. There is no automated Slack coverage today: the Bolt app is constructed inline and only when real Slack tokens are present, so the e2e cluster (ADR-056) runs no Slack at all. ADR-056 built the e2e harness — values-gated affordances, a scripted mock agent, an in-process control namespace — but explicitly left Slack out of the first slice.

## Decision

Hide the Bolt SDK behind a narrow first-party Slack port: production wires a real adapter that wraps Bolt, and the e2e build wires an in-process fake. Everything past the port — identity resolution, allow-list gating, owner/foreign routing, the fork — stays the one real code path and is what the test exercises. The foreign-user case runs the **real** fork (real K8s Job, real paired gateway, real authenticated egress), so the assertion is the egress outcome, not the routing decision.

- **The port is first-party, not Bolt's types.** Inbound is a mention event and a slash command in our own shapes; outbound is the handful of post / ephemeral / reaction / conversation-read / file-upload calls the relay makes; plus start/stop. The real adapter translates Bolt's middleware args into these shapes. The fake records outbound into a buffer and exposes inbound injection.
- **The control plane is in-process.** The fake lives inside the api-server, so the e2e control namespace (ADR-056) drives it directly — inject a mention or command as a given Slack user, read back the outbound buffer. No second pod, no riding the ACP channel.
- **Identity is linked through the real OAuth flow.** The login slash command returns its Keycloak URL into the outbound buffer; the browser test drives that URL through Keycloak per user and the callback links the identity. Two Keycloak users are seeded (owner + foreign); the Slack↔Keycloak link is never seeded.
- **The fork case is end-to-end.** A foreign mention provisions the real fork Job with the foreign user's secrets and makes a real authenticated egress call (the mock agent's scripted proxy fetch), over the same direct pod-IP ACP path production uses. This requires RWX storage in the test cluster (the dev install already ships one).
- **First slice scope.** Owner mention round-trips; foreign mention in an unrestricted channel (empty allow-list) succeeds — the #444 scenario. Thread-history reads return empty; image fetch is out of scope.

## Alternatives Considered

- **Fake Slack server (real Bolt → faked Socket Mode + Web API)** — reimplements Slack's wire protocol to test vendor parsing we trust; high cost for the layer where bugs don't live.
- **Swap the whole Slack worker** — drops the relay and fork code from coverage, which is precisely where #444 lives.
- **Relay-only (stub the fork outcome)** — proves routing chose to fork, reproduces no credential bug; #444 would pass green.
- **Seed the identity links directly** — faster and deterministic, but skips the OAuth-and-callback linking that is the point of an e2e.
- **Pass Bolt's middleware args through the port** — forces the fake to construct Bolt's fat arg objects, defeating the narrow port.

## Consequences

- **Easier:** Slack relay and fork regressions fail at PR time, where there is zero automated coverage today; #444-class credential bugs become reproducible in CI because the test runs the real fork egress.
- **Easier:** production Slack keeps a single real path — the only seam is which adapter is constructed, with no test branches inside the relay (mirrors ADR-056 keeping agent-runtime test-branch-free).
- **Harder:** the e2e cluster must provision RWX and run fork Jobs plus paired gateways; per-foreign-turn cold start adds seconds and moving parts to each run.
- **Harder:** two-user OAuth linking via the buffer-extracted login URL is more browser choreography than seeding rows, adding flake surface.
- **Committed-to:** the first-party port is now the contract — every Bolt call the relay makes must route through it, or the fake diverges from production and the test lies; adding a Slack API call means extending the port and the fake together.
