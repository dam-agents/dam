---
id: 122
title: The Agent and UserBudget CRDs stay on the cluster
status: accepted
subsystem: persistence
tags: [postgres, custom-resources, migration]
summary: The move out of the Kubernetes API is per install and never removes the kinds — another install on the same cluster may still read them — so no release, chart, hook or operator command deletes `Agent` or `UserBudget`, and the chart keeps shipping the CRDs install-only.
---

# ADR-122: The Agent and UserBudget CRDs stay on the cluster

**Date:** 2026-10-25
**Status:** Accepted
**Owner:** @JanPokorny

## Context

This record revises the retirement paragraph of ADR-121; the rest of ADR-121 stands.

ADR-121 decided that Agents and user budgets become rows in each install's `control` schema, in three releases per install: expand, switch, contract.
It also said the kinds themselves would be deleted cluster-wide by a separate operator action, once every install was past contract and its rollback window, on the assumption that a cluster's installs move together.
They do not.
A cluster hosts several installs in different namespaces, on different schedules, and a CRD is shared by all of them: deleting it breaks any install that still reads it, including one that was never part of this platform's move.
The retirement also put an irreversible, data-loss-shaped step in the middle of a change whose actual goal is a change of authority inside one install.

## Decision

The kinds stay.
The move changes only where an install's Agents and user budgets are authoritative, and each install decides that for itself.
An install on `contract` reads no custom resource and holds no RBAC on the group; one still on `crd` keeps reconciling them in its own namespace, beside it.

From PR 5 on:

- the chart keeps shipping `helm/crds/`, install-only as it always was, for as long as any install on a cluster reads the kinds;
- no release, hook, chart or operator command deletes `Agent` or `UserBudget` CRDs, and there is no follow-up release that does;
- `delete-crs` remains an optional, per-install cleanup of that install's own frozen resources after contract.
  It orphans the children because the anchors own them, and it never touches the CRD definitions or another namespace;
- the `crd` authority stays until no install anywhere needs it; removing it is its own decision, made later.

## Alternatives Considered

- **Delete the kinds once every install is past contract (ADR-121's plan)** — rejected: it assumes the cluster's installs move together, and it makes another install's schedule decide this install's outage.
  It also needs a fail-closed cluster-wide gate for a step nothing in the platform's own operation requires.
- **Delete only this install's CRD reference** — there is no per-namespace CRD: the kind is cluster-scoped.

## Consequences

- **Easier:** an install's move touches only its own namespace; a cluster can host installs on both authorities indefinitely, and a CRD-dependent workload that is not part of this platform keeps working.
  The data-loss surface of the move shrinks to the switch and the rollback window, which both remain gated.
- **Harder:** the kinds and their schema generation stay on the cluster, so an install still on the CRDs keeps an operator step (`upgrade-crds.sh`) that an install on the rows does not.
  The chart must keep rendering the CRDs and the `crd`-mode code paths stay until the last install moves.
- **Committed-to:** per-install authority recorded in the store marker, the contract gate that reads it, and no cluster-wide mutation of a shared kind by this platform.
