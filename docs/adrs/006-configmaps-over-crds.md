# ADR-006: ConfigMaps over CRDs — namespace-scoped resource model

**Date:** 2026-04-02
**Status:** Accepted
**Owner:** @jezekra1

## Context

The platform needs custom resources (agent templates, instances, schedules) in Kubernetes. The idiomatic choice is CRDs, which give schema validation, a `status` subresource, and native `kubectl` integration (`kubectl get agentinstances`). However, CRDs require cluster-admin privileges to install — a hard blocker in OpenShift and other namespace-scoped environments where teams get a namespace, not a cluster.

Related: the team committed to "K8s is the database" — no external database, ConfigMaps/Secrets/PVCs as the persistence layer, Controller and API Server both stateless.

## Decision

Use labeled ConfigMaps instead of CRDs for all platform resources. Three resource types distinguished by `platform.ai/type` label: `agent-template`, `agent-instance`, `agent-schedule`.

Key design choices within this decision:

- **Single-writer keys.** Each ConfigMap has `spec.yaml` (written only by the API Server) and `status.yaml` (written only by the Controller). This mirrors the CRD spec/status subresource pattern and eliminates write contention. Lightweight metadata (`platform.ai/last-activity`, `platform.ai/active-session`) uses ConfigMap annotations, not `data` keys.
- **Validation.** The API Server validates `spec.yaml` before writing. The Controller validates on read and writes errors to `status.yaml`. Compensates for the lack of CRD schema validation.
- **Discovery.** `kubectl get cm -l platform.ai/type=agent-instance` — not as clean as `kubectl get agents` but functional.
- **Upgrade path.** The ConfigMap schema maps directly to a CRD spec. Swapping the watch source in the Controller's reconcile loop is the only required change.

## Alternatives Considered

**CRDs.** Schema validation, status subresource, native kubectl UX. Rejected: requires cluster-admin to install, blocking namespace-scoped deployments. Can revisit if the project ever targets clusters where cluster-admin is available.

**External database (PostgreSQL, etcd).** Rejected: contradicts the "K8s is the database" principle. Adds operational complexity and a stateful dependency the platform doesn't need.

## Consequences

- Deployable with standard namespace RBAC — no cluster-admin required
- No schema validation at the API server layer — must be enforced in application code
- `kubectl` UX is weaker (no custom resource names, no status column)
- Write contention avoided by convention (single-writer-per-key), not enforced by the API server
- Clean upgrade path to CRDs if the constraint lifts
