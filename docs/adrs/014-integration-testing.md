# ADR-014: E2E integration testing against dedicated k3s cluster

**Date:** 2026-04-08
**Status:** Superseded by ADR-056
**Owner:** @tomkis

## Context

Schedule CRUD was the first feature requiring API-level tests. The API server is a thin tRPC layer over K8s ConfigMap CRUD — most logic lives in label selectors, YAML serialization, and cross-resource validation. The system has two producers/consumers of schedule ConfigMaps: the API server (writes spec.yaml, reads status.yaml) and the Go controller (reads spec.yaml, writes status.yaml via in-process cron scheduler — see ADR-008).

## Decision

Full e2e tests that spin up a dedicated test cluster (`mise run cluster:install --vm-name=platform-k3s-test`), deploy the complete Platform stack, and test against it.

### Test layers

**Layer 1: API server CRUD** — calls real tRPC endpoints via ingress, verifies responses, error handling, and input validation.

**Layer 2: Controller reconciliation** (skipped pending #34) — creates a schedule with `* * * * *` cron, waits for the controller to fire and write `status.yaml`. Currently blocked by controller informer stalling after OneCLI registration errors.

### Infrastructure

- **Dedicated Lima VM** (`platform-k3s-test`) with separate ports (5555 Traefik, 16445 k8s API) to avoid collisions with dev cluster
- **Full Platform chart** deployed (API server, controller, UI, OneCLI, PostgreSQL)
- **`mise run api-server:e2e`** orchestrates: build images → create cluster → run vitest → tear down cluster
- **Vitest** as test framework, `@trpc/client` for endpoint calls, `@kubernetes/client-node` for K8s assertions
- **Cluster parameterization** via `--vm-name` and `--lima-template` flags on `cluster:install`/`cluster:delete`

## Alternatives Considered

**Ephemeral namespace in existing dev cluster** — faster (~3s) but doesn't test the full stack (no controller, no OneCLI). Also pollutes the dev cluster state and couples test runs to dev cluster availability.

**Ephemeral namespace in dev cluster with test code deployed** — reuses the existing VM but deploys test-specific resources into a separate namespace. Avoids VM creation overhead but shares controller/OneCLI with dev, making tests non-isolated and order-dependent.

**Unit tests with mocked contexts** — rejected because the interesting logic lives in K8s interactions, not the tRPC router.

## Consequences

- Full test run takes ~3 min (image builds cached, VM creation ~1 min, cert-manager ~30s, helm install ~30s)
- Test cluster is torn down after each run
- `cluster:install`/`cluster:delete` now accept `--vm-name` and `--lima-template`, enabling multiple concurrent clusters
