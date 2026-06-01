# ADR-056: Browser-driven E2E tracer with values-gated test affordances

**Date:** 2026-05-28
**Status:** Accepted
**Owner:** @tomkis

## Context

ADR-014 set up API-level vitest tests against a dedicated `platform-k3s-test` VM, asserting against the tRPC surface. The interesting failure modes have since moved up the stack — login + T&C, Connection configuration, agent-create dialog, ACP chat rendering — none of which the API-level layer exercises. Bugs in any of those slip through unit tests and manual verification doesn't happen consistently.

The in-flight Connections subsystem (ADR-051/052/053) is still proposed; building a first tracer against today's Connection-Template registry would test code about to be replaced.

## Decision

A browser-driven Playwright tracer is the canonical E2E layer. ADR-014's API-level vitest e2e is superseded and its tests are removed. The first tracer is a two-spec story — login + T&C, then drive a scripted mock Agent end-to-end and assert ACP frames flow both ways through the UI — running against a fresh values-gated test cluster.

Scope of the first tracer is deliberately narrow: no OAuth flow, no mock upstream service, no Custom Connection, no credential mounting. The credential layer is deferred because today's Secret system substitutes a placeholder in the agent pod env, so a user-typed value never reaches the agent process — that assertion chain can only be closed via Envoy injection, which is out of scope here.

Test-only artifacts ship in the production Helm chart behind `e2e.*` values flags, default off: a pre-seeded Keycloak user and a mock Agent Template (`packages/e2e/agents/mock/`). The mock agent is controllable at runtime via a test-only tRPC namespace on the api-server (gated by the same `e2e.enabled` flag). The namespace runs a tRPC WebSocket client against the same `ws://${podBaseUrl}/api/acp` endpoint the UI uses; agent-runtime's relay forwards arbitrary JSON-RPC frames over stdio to the harness without method validation, so tRPC envelopes ride the ACP channel transparently. The mock harness detects `method: "query" | "mutation"` on stdin and dispatches to its existing `scriptedMock` router; ACP frames continue to flow as before. The surface covers ACP-frame-level scripting (set the sequence of frames the mock emits in response to prompts) and inbound observation (read back the frames the mock received from agent-runtime). Single transport, single pod port, full tRPC typing end-to-end, zero changes to agent-runtime, the agent StatefulSet, or the K8s Service. The test cluster install flips the flags on; prod installs never see the affordances or the tRPC namespace.

Cluster lifecycle is owned by a single `mise run e2e` task — delete any prior test cluster, install fresh, run Playwright, tear down in trap. CI calls the one command; local runs are bit-identical. The CI workflow runs on every PR push, advisory until ten clean merges then promoted to required.

OAuth coverage, the Custom Connection flow, and additional tracers are out of scope for the first slice and tracked as follow-ups on the seeding issue. The harness must accommodate them without re-architecture once Connections lands.

## Alternatives Considered

- **Keep ADR-014's API-level vitest e2e and add Playwright alongside it** — two parallel e2e tracks, doubled cluster spin-up in CI, two failure modes to triage, two definitions of "fresh."
- **First tracer includes Custom OAuth + mock upstream** — couples the test architecture to the in-flight Connections subsystem; mock OAuth provider is meaningful code to maintain for a tracer.
- **Echo a credential through the Envoy injection layer** — proves the full trust-boundary plumbing but reintroduces the in-cluster mock upstream and tests a surface that has its own ADRs and tests already.
- **Mock agent echoes a user-typed env var** — closes a "UI input → agent process" loop but only against the agent's free-form env field; today's Secret-driven envs are placeholders, so the loop's coverage is narrow and the mock has to read pod env instead of being controllable per-spec.
- **Mock agent with hardcoded one-shot behavior** — saves implementation cost but blocks every future tracer (multi-turn, HITL, tool calls) on a redesign; the control plane is the affordance that lets one mock image serve many tracers.
- **Three-spec story with a separate "configure a credential" step** — the credential step is theater when the assertion can't tell whether the user-typed value reached anywhere meaningful.
- **Per-pod mock control plane (own Service + Ingress per Agent)** — per-Agent ingress entries are fiddly; the chosen design reuses api-server's addressing of agent pods one step further by riding the existing ACP channel itself.
- **Separate HTTP control endpoint on a second mock pod port** — api-server makes a typed HTTP call to the mock's tRPC, but requires either declaring a test-only `containerPort` on the agent StatefulSet, an `extraPorts` knob on the AgentTemplate, or relying on undeclared pod-IP-port reachability. Each option pushes test-shaped surface into production code paths (chart templates, controller render, AgentTemplate schema). Riding the existing ACP channel adds zero ports to the prod surface.
- **Custom ACP method names (`mock/setScript` etc.) instead of tRPC over WS** — works the same way at the transport level since the relay forwards any JSON-RPC method, but the schemas would have to be hand-written on both sides instead of reusing the existing `mock-api` tRPC router, and the typed `api-server-api` dependency on Playwright loses the same call-site ergonomics as the rest of the surface.
- **Cluster lifecycle in GH Actions steps** — locally `mise run e2e` would no-op the provision; "fresh per run" guarantee splits between the workflow YAML and developer memory.
- **Required check from day one** — unknown flake rate; a single false positive blocks merges for ~5 minutes per re-run while the harness stabilizes.
- **Test user created via Keycloak admin API at test-setup time** — chart stays clean but admin creds have to live in the test environment; one more moving piece.

## Consequences

- **Easier:** UI-level regressions in login, T&C, agent creation, or ACP chat rendering now fail-fast at PR time. None of those layers had pre-merge automation before this.
- **Easier:** the harness is one task. `mise run e2e` is what CI runs and what a developer runs locally; the "fresh cluster" guarantee lives in one place.
- **Easier:** scope is narrow enough that the tracer's failure mode is almost always the change under test, not the tracer itself — 2 specs, one mock image, no mock upstreams, no OAuth, no separate Connection resource.
- **Easier:** future tracers (multi-turn, HITL, tool-call, schedule fire) reuse the existing mock image; per-spec behavior is the script the spec passes over tRPC, not a new agent build.
- **Harder:** per-PR cluster spin is ~5 min on warm CI runners (VM creation, cert-manager, helm install, Playwright run). Doc-only PRs pay the cost; path-filtered gating is a follow-up if minutes become a problem.
- **Harder:** the production chart now carries test-only resources behind values flags, and api-server carries a test-only tRPC namespace conditionally registered on `e2e.enabled` plus a small tRPC-over-WS client used only by that namespace. agent-runtime is unchanged; no test branches in the agent StatefulSet, Service, or controller. The mock harness recognises tRPC frames on stdin alongside ACP frames, but the dispatch is inert outside the test gate. Reviewers have to remember the chart and api-server affordances exist and that flipping defaults on would surface a fake user, a mock Template, and the control namespace in real installs.
- **Committed-to:** the chart is the source of truth for test-only seed data. Moving the test-user or mock-Template provisioning out of Helm later means rewriting the bootstrap step in the e2e task.
- **Committed-to:** the tracer covers the API-level surface only through the browser. API-only contract regressions that don't manifest as UI failures are no longer caught by e2e; they have to be caught by unit/integration tests at the api-server package.
