# ADR-065: Shared CRDs across co-located environments

**Date:** 2026-06-10
**Status:** Accepted
**Owner:** @jezekra1

## Context

Installing two environments of the chart (dev, staging) into one cluster fails: CRDs are cluster-scoped, so the second release is rejected for claiming resources owned by the first. Beyond install, sharing one CRD across environments creates two hazards: the newest schema validates and prunes *every* environment's writes (a breaking dev schema silently breaks staging/prod admission), and deleting the CRDs — e.g. by uninstalling whichever release owns them — cascade-deletes all environments' Agents and Forks.

## Decision

Environments sharing a cluster share one set of CRDs. Exactly one release — the one tracking the newest chart version — installs them via the chart's CRD-install toggle; all other releases disable it. Compatibility is enforced statically: a CI gate in `mise run check` compares the generated CRD manifests against the latest release tag and fails on changes that would break an environment still running that release (removed fields or CRDs, type changes, newly required fields, removed served versions).

Rules:

- The cluster's CRD schema is always the newest release's. Older environments write through it, so schema changes follow the expand/contract discipline already committed to in [ADR-058](058-crds-over-configmaps.md): additive first, removal only once no live environment writes or reads the field.
- The CRDs carry Helm's keep resource policy, so uninstalling the owning release leaves them (and every environment's CRs) in place. Full cluster cleanup deletes them explicitly.
- The gate's baseline (latest release tag) approximates "oldest live environment". The strong form — comparing the dev-pinned chart's CRDs against the prod-pinned chart's — belongs in the GitOps repository that knows the pins.

## Alternatives Considered

- **Per-environment API versions (dev on `vNalphaM`, prod on stable)** — the CRD object stays shared and the dev pipeline still rewrites prod's served schema, so the blast radius is unchanged; divergent per-version schemas additionally require a conversion webhook whose downtime blocks all CRD reads and writes cluster-wide.
- **Configurable API group or name prefix per environment** — the group is baked into generated Go and TS types and doubles as the label/annotation domain across reconcilers and migration jobs (~20 files); making it runtime config forks the API identity per environment.
- **Separate CRD-only chart/release** — solves ownership but not compatibility, which is the actual hazard; adds a second release to sequence. Revisit if the single-owner convention proves error-prone.
- **One cluster per environment** — full isolation, but gives up the shared-cluster deployment this decision exists to support.

## Consequences

- **Easier:** any number of environments install into one cluster (the second `helm install` previously failed on CRD ownership metadata); a breaking CRD change is caught at merge time by the gate instead of at another environment's admission time, where pruning fails silently.
- **Harder:** contract-phase schema changes cannot merge while the latest release still ships the field — removal lands only after a release that no longer uses it; `helm uninstall` no longer removes the CRDs, so full cleanup is a documented extra step.
- **Committed-to:** ADR-058's expand/contract discipline is now load-bearing *across environments*, not just across upgrades — every schema change must assume an older live writer; and the release-tag baseline must keep approximating the oldest deployed environment, which the GitOps pipeline must not outrun.
