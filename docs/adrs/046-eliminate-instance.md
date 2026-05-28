# ADR-046: Eliminate Instance — collapse into Agent

**Date:** 2026-05-19
**Status:** Proposed
**Owner:** @jezekra1

## Context

The agents bounded context carries three durable concepts: Template (read-only blueprint), Agent (user-owned definition), Instance (running deployment). Cardinality of Agent → Instance has always been 1:1 in practice — the UI's `useCreateAgent` mutation creates one of each back-to-back, no `listByAgent` query exists on the api-server, and no roadmap item needs N instances per agent. The split shows in Postgres as asymmetric FKs: `egress_rules` and `pending_approvals` key on `agent_id`, while `channels`, `instance_allowed_users`, `sessions`, `installed_skill_refs`, and `skill_publish_records` key on `instance_id` — no semantic boundary, just inherited inconsistency. Template was always intended as a suggestion: `assembleSpecFromTemplate` copies values into the Agent at create time and the controller's pod-env composition at `packages/controller/pkg/reconciler/resources.go:151-162` reads only `platform → credentialEnvVars → agentSpec.Env → instance.Env` — never template envs live. ADR-024 and `docs/architecture/agent-lifecycle.md` misstate this by listing template envs as a runtime layer.

## Decision

**Eliminate `Instance` as a concept.** The merged `Agent` carries definition, runtime state, and lifecycle. `Template`, `Agent`, and `Fork` are the only durable concepts in this bounded context.

- The merged Agent ConfigMap (`agent-platform.ai/type=agent`) is the sole resource per agent. The api-server writes `spec.yaml`; the controller writes `status.yaml` on the same CM. All instance-side fields move to Agent: `desiredState`, `secretRef`, `allowedUserEmails`, a single `env` list, channels, and the runtime annotations (`granted-secret-ids`, `granted-connection-ids`, `secrets-rev`, `last-activity`).
- Env composition at pod start is `platform → credentialEnvVars → agent.env` — Template contributes at create-time only, never read at runtime.
- One ID prefix: `agent-`. The reserved `inst-` prefix retires.
- Fork survives as the third concept and now derives from Agent. Forks remain Job-shaped (run-to-completion) and stay distinct from Agent (StatefulSet, durable).
- Upgrades preserve data. A Helm post-upgrade Job folds each existing `agent-instance` ConfigMap's runtime fields into its parent `agent` ConfigMap, re-points every Postgres row's `instance_id` value to the parent `agent_id`, and deletes the Instance CM with orphan propagation so the StatefulSet, Service, and NetworkPolicy survive and are adopted by the new controller. Existing agents keep their `agent-` IDs; their schedules, channels, allowed users, sessions, and installed skills survive.
- Glossary realignment: Instance, Instance Ref, Instance Resolver, and the `inst-` Reserved ID Prefix retire. Agent, Schedule, Desired State, Wake, Heartbeat, Channel Binding, Foreign Replier, Installed Skill Ref, Skill Publish Record, and Fork redefine against Agent.

## Alternatives Considered

- **Keep Instance and Agent distinct.** No feature uses N:1; the FK split between `agent_id` and `instance_id` reflects the absence of a real boundary, not its presence.
- **Collapse Fork too.** Fork is a turn-scoped, Job-shaped impersonation envelope — a different axis from "the durable runtime." Folding it would make Agent a sum type and complicate every selector that distinguishes durable from ephemeral resources.
- **Two-layer env composition on merged Agent (`envDefaults` vs `envOverrides`).** One writer (the api-server) owns both; the boundary buys no enforcement, last-write-wins already covers the semantic.
- **Wipe data on cutover; drop all backwards compatibility.** Was the original direction. Rejected once the migration cost turned out to be small: a single post-upgrade Job that folds two CMs into one and rewrites a handful of `instance_id` columns is cheaper than asking every deployment to recreate its agents.

## Consequences

- **Easier:** One ConfigMap per agent — `kubectl get cm <id>` returns the full agent, no follow-up lookup; the inbox's per-agent tray finally matches its `agent_id` key; provisioning is one CM create instead of two; env composition narrows from four claimed layers to three actual ones, eliminating the documented-but-fictional `template-envs` runtime layer.
- **Harder:** The cutover PR touches 100+ files (the entire `packages/api-server/src/modules/instances/` tree, the controller reconciler's CM-type watch, all `/api/instances/:id/*` HTTP routes plus their Istio path matchers, UI and CLI namespaces, ~28 ADRs with passing mentions, the ubiquitous-language doc, five architecture docs). The upgrade introduces a brief window between the new images rolling out and the post-upgrade fold Job finishing where existing agents are unreconciled but not deleted; new agents created during that window land on the new shape directly.
- **Committed-to:** `agent-` is the sole ID prefix for newly minted agents; legacy `inst-` IDs survive on the merged Agent CMs they were folded into (no further renaming). The merged Agent CM carries both `spec.yaml` and `status.yaml`; the persistence model from `docs/architecture/persistence.md` (api-server owns spec, controller owns status) now applies to the new CM type. Template is suggestion-only forever — any future feature that wants "template defaults at pod start" must add the layer back explicitly. Fork is the only ephemeral runtime in this context. The Helm chart ships a one-shot post-upgrade fold Job (`migrate-fold-instances`) that every deployment runs once on the upgrade across this ADR; the Job itself stays in the chart so re-runs after partial-progress are safe.

## Supersedes

Existing ADRs that made an Instance-vs-Agent decision; their rationale is preserved for historical reading but the canonical position is this ADR:

- ADR-027 (Slack user impersonation) — allowedUsers now per Agent.
- ADR-029 (Per-instance channels) — channels now per Agent.
- ADR-030 (Skills marketplace) — installed skill ref identity is `(agentId, source, name)`.
- ADR-033 (Envoy credential gateway) — per-Agent Envoy bootstrap CM and leaf cert.
- ADR-038 (Paired gateway pod) — pairing is Agent ↔ Gateway.
- ADR-041 (Istio ambient mesh) — AuthorizationPolicy path matchers move to `/api/agents/<id>/*`.

`DRAFT-multi-agent.md` is revised in place (still Proposed, not yet immutable) to use Agent terminology exclusively. Pass-through mentions of "Instance" in other ADRs (017, 018, 019, 021, 025, 031, 034, 035, 036, 039, 040, 042, 043, 044) remain unedited per the project's ADR-immutability convention.
