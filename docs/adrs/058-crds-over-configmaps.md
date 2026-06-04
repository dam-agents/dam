# ADR-058: CRDs over ConfigMaps — reconciled resources become custom resources

**Date:** 2026-06-03
**Status:** Accepted
**Owner:** @jezekra1

## Context

[ADR-006](006-configmaps-over-crds.md) chose labeled ConfigMaps over CRDs for one reason: CRDs require cluster-admin to install, which blocked namespace-scoped (OpenShift) deployments. That constraint no longer holds — every current deployment target realistically grants cluster-admin or CRD-install permission, and ADR-006 explicitly anticipated being revisited if it lifted. With the blocker gone, the ConfigMap model's costs are unmitigated: no schema validation at the K8s layer (the spec shape is validated twice in app code — Zod on write, Go parse on read), weak `kubectl` UX, and write contention avoided only by convention. The spec/status split is already leaky — the controller rewrites `spec.yaml` in the idle-hibernation path, contradicting the documented "controller never writes spec" invariant.

## Decision

**Migrate the controller-reconciled domain resources — Agent and Fork — from labeled ConfigMaps to Kubernetes CRDs with a status subresource. Templates stay ConfigMaps.** The rules and boundaries:

- **Scope.** Agent and Fork become CRDs with a status subresource (both are reconciled). Template stays a ConfigMap — it is chart-rendered, read-only at runtime, and never reconciled, so it earns neither a status subresource nor migration cost. Schedules remain in Postgres, unchanged.
- **Eliminate the desired-state latch.** "Running" is no longer stored intent. Wake is a one-off activity poke; the controller hibernates on idleness and records running-vs-hibernated as observed status. This removes the only field both parties wrote and restores single-writer ownership by elimination, not negotiation.
- **Field placement.** Connection and secret grants are intent and move into `spec` (they were annotations only to avoid rewriting the opaque ConfigMap spec blob; a structured CRD spec removes that reason). High-frequency, out-of-band signals — activity timestamp, active-session, secrets-revision, and the api-server-set roll trigger that forces a rolling restart/re-render — stay annotations: independently patchable, not part of the agent definition, and not subject to the spec/status writer split.
- **One validation point.** The CRD schema is authored Go-first; the K8s API server validates at admission. The controller and api-server consume generated types for typing only and do not re-validate the resource shape. Cross-field and referential rules stay application logic.
- **Bundling.** The CRD ships as a values-gated templated chart manifest so `helm upgrade` propagates schema changes — not the non-upgradable `crds/` directory, and not a controller self-install. Templates-as-ConfigMaps keeps the chart free of custom-resource instances, so no CRD-before-CR install ordering hazard exists.
- **Schema evolution without conversion webhooks.** Agent/Fork CRs are single-writer (api-server) and co-released with the controller, so there is no version skew to bridge. Evolve additively under one served and stored version; for a breaking change, use expand/contract with a Helm post-upgrade backfill (spec backfill runs from the api-server, status backfill from the controller). A conversion webhook plus storage-version migration is the documented escalation, valid only if Agent/Fork CRs ever become externally authored.
- **Cutover is big-bang.** No data migration from existing ConfigMaps — a CRD is a different Kind, which CRD versioning cannot bridge regardless.

## Alternatives Considered

- **Keep ConfigMaps (ADR-006)** — its sole rationale (no cluster-admin) no longer applies, while its costs (no API-layer validation, leaky spec/status) persist.
- **Template as a CRD** — not reconciled and chart-shipped; a CRD without a controller is a typed envelope earning only validation, which the create-time copy into a (validated) Agent already provides.
- **Template to Postgres** — needs an imperative seed/upgrade job and loses the declarative Helm lifecycle for what is operator-authored install config.
- **Conversion webhook for schema evolution** — solves external-client version skew the platform does not have; adds a TLS webhook service for no benefit.
- **Controller self-installs the CRD on boot** — couples schema lifecycle to a cluster-scoped RBAC grant and is GitOps-unfriendly; a Helm-owned CRD keeps the lifecycle declarative.

## Consequences

- **Easier:** malformed specs are rejected by the K8s API at write time, closing the validation gap ADR-006 named; the controller drops its parse-and-validate step (the typed client deserializes); `kubectl get`/`describe` gain real status columns; the single-writer invariant becomes true once no shared desired-state field exists, removing the idle-hibernation spec-write the docs already contradict.
- **Harder:** a build step must generate the CRD schema and consumer types, and CI must fail on drift across Go and TS; CRD installation requires cluster-admin at install time, dropping namespace-scoped install as a supported target — the capability ADR-006 protected is deliberately given up; a breaking schema change now costs a two-release expand/contract with a backfill Job rather than a free in-place edit.
- **Committed-to:** cluster-admin (or CRD-install permission) is required in every deployment target; the api-server remains the sole writer of Agent/Fork CRs — the moment they become externally authored, the no-webhook migration policy is invalid and the conversion-webhook escalation becomes mandatory; running-vs-hibernated is derived status and never stored intent, so any future "pin always-on" or "suspend" capability must add an explicit spec field.

## Supersedes

- **ADR-006** (ConfigMaps over CRDs) — its rationale is preserved for historical reading; the canonical position is this ADR.

This ADR also revises the field-placement specifics of [ADR-046](046-eliminate-instance.md) — grants move from annotations into `spec`, and the `desiredState` field it carried over is eliminated — without disturbing ADR-046's core decision (Instance collapsed into Agent). The persistence-doc refinement rule ("belongs on a ConfigMap iff the controller reconciles it") and the "controller never writes spec" invariant need correcting in the architecture docs; those are doc edits handled outside this ADR.
