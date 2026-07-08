---
id: 003
title: "Kubernetes from the start — k3s for local dev, K8s for production"
status: accepted
subsystem: platform-topology
summary: Build on Kubernetes from day one using k3s via lima locally and the same Helm chart in production, skipping a Docker-compose phase.
---
# ADR-003: Kubernetes from the start — k3s for local dev, K8s for production

**Date:** 2026-04-02
**Status:** Accepted — supersedes original "Docker first" plan
**Owner:** @jezekra1

## Context

The team debated whether to build on Kubernetes from the start or use simpler Docker containers for the prototype. Radek advocated for Kubernetes (jobs provide isolation, PVCs handle persistence, built-in scaling). Matous worried Kubernetes is overkill for a prototype and could slow delivery. Tomas W. noted cloud deployment would be hard without Kubernetes.

The original plan was Docker for the prototype and Kubernetes for production. In practice, the team went straight to Kubernetes using k3s via lima for local development — the gap between "simple Docker" and "real K8s" turned out to be smaller than expected, and avoiding a Docker-to-K8s migration saved time.

## Decision

Kubernetes from the start, with k3s (via lima) for local development. No Docker-compose prototype phase.

- **Local dev:** k3s VM managed by lima, full cluster lifecycle automated via mise (`mise run cluster:install`, `cluster:delete`). Developers get a real K8s environment on their laptop with minimal setup.
- **Production:** Same Helm chart, same resource model, same controller. The gap between local and production is cluster configuration, not architecture.

The architecture is the same everywhere: ConfigMaps as the resource model (ADR-006), StatefulSets for agent pods, PVCs for persistence, NetworkPolicies for isolation.

## Alternatives Considered

**Docker for the prototype, Kubernetes for production.** The original plan (this ADR's predecessor). Rejected in practice: k3s setup was fast enough that the Docker detour wasn't worth the migration cost. Docker-compose networking and orchestration patterns would not have mapped cleanly to the K8s resource model.

**Docker only, no Kubernetes path.** Rejected: Kubernetes is necessary for production multi-tenancy, scaling, and integration with the Red Hat/OpenShift ecosystem.

## Consequences

- No migration step — local dev and production use the same K8s primitives
- Slightly higher initial setup cost (lima + k3s) compared to docker-compose, but one-time and automated
- Team validates against real K8s behavior from day one — no surprises at deployment time
- Helm chart is the single source of truth for all environments
