---
id: 121
title: Agents and user budgets live in Postgres, not in the Kubernetes API
status: accepted
subsystem: persistence
tags: [postgres, custom-resources, controller, migration]
summary: Agent definitions, signals, observations and user budgets become rows in a `control` schema owned by the api-server; the controller reads them over a change feed under its own least-privilege login, and Kubernetes keeps only the infrastructure, Events and Leases it renders from them.
---

# ADR-121: Agents and user budgets live in Postgres, not in the Kubernetes API

**Date:** 2026-10-24
**Status:** Accepted
**Owner:** @JanPokorny

## Context

Two custom resources carry the platform's own desired and observed state: `Agent` and `UserBudget`.
The rule the platform recorded for choosing a substrate says a resource belongs on a CRD exactly when the controller reconciles it, which these two do, so the choice was consistent when it was made.
What it did not account for is that every install in a cluster shares one CRD, and the resources are namespaced per install: an install's controller holds a cluster-wide role on both kinds, so one install's controller can write another install's Agent status, and nothing about the API separates them.
The schema also arrives as a chart artifact with a generation counter and an operator step to upgrade it, and the CRDs cannot be retired while any install still reads them.

## Decision

Agents and user budgets are rows in a `control` schema in each install's platform database, and Postgres is their authority.
The api-server remains the sole writer of definitions, lifecycle signals and budgets; the controller observes and writes only status and conditions, and reaches nothing else — its own login is confined by column grants to the definition columns it renders, to the reclaim columns of the signals row, and to its observation tables.
Kubernetes keeps what is rendered from those rows: the machines, their Services, credentials and policies, the Events published against them, and the controller's Lease.
The controller learns of changes from the database's change feed rather than a watch on the API server.

The move lands in three releases: one adds the tables, the login and a startup fence to both components; one absorbs the stored resources into rows and switches both components to them; one stops writing the custom resources and deletes the cluster-wide CRD only after every install has passed its rollback window.
Each component refuses to start when the store it is configured for disagrees with the marker the switch leaves behind.

The rule that governed the choice changes with it: platform state belongs in Postgres, and the Kubernetes API holds only what is rendered from it, what the cluster itself owns (Events, Leases), and the infrastructure's own objects.

## Alternatives Considered

- **Keep the custom resources, fix the sharing** — per-install CRDs or a controller confined to one namespace would keep the shared-owner problem, and leave the schema generation and the operator upgrade step in place.
- **Mirror the rows back onto the resources** — a second authority, with a reconciliation problem between the two copies that nothing needs.
- **Move only what the controller does not reconcile** — the small, safe subset; every pain above stays.

## Consequences

- **Easier:** one install's controller can no longer reach another install's data: what bounds it is a database grant inside one install's database, not a cluster role over a shared kind.
  An Agent's definition, its signals and its observations are written by different writers with different privileges in the same store, so a query for one install's inventory is a query rather than a list across a namespace.
  Nothing needs a CRD schema generation, an `upgrade-crds.sh` step, or a cluster-wide delete per install.
- **Harder:** the controller is now a database client: it needs a connection, a login created per install (chart-provisioned on the bundled database, operator-created on an external one), and a reconnect path, and a database outage makes it fail static rather than reconcile.
  The switch is an outage of a minute or two per install, with a coordinated stop of both components, a one-way absorb and a snapshot archive kept for a rollback window.
  Rolling back after the switch needs a reverse exporter, not a redeploy; below the release that added the fence there is no supported rollback at all.
- **Committed-to:** the marker and its two startup refusals, the archive the rollback depends on, and the controller's login as the boundary that replaces the status subresource.
