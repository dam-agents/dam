---
id: 085
title: Usage passthrough access via a reconciled group role
status: accepted
subsystem: usage-tracking
tags: [postgres, privileges, analytics]
summary: A credential-less group role holds SELECT on the usage source passthrough views, reconciled by the api-server after each migration run rather than granted inside migrations, with operators granting membership.
---

# ADR-085: Usage passthrough access via a reconciled group role

**Date:** 2026-08-25
**Status:** Accepted
**Owner:** @jjeliga

## Context

An external analytics consumer reads the usage source passthrough views on a
nightly schedule. Privileges in Postgres attach to the object rather than the
name, so recreating a view discards every grant on it — and a passthrough must
be recreated rather than replaced whenever a column is renamed or reordered,
which is exactly the migration that changes what the consumer reads. Granting
the consumer's own login therefore revoked its access on precisely the deploys
it needed to survive, silently until the next nightly run, leaving an operator
to re-grant by hand after every release.

## Decision

Access to the usage source passthrough views is held by a credential-less,
login-less group role, and the api-server reconciles that role's grants after
each migration run rather than granting inside the migrations. An operator
grants a read-only login membership in the group, so who reads the metrics
stays outside the platform's knowledge.

What that commits the platform to:

- **The group is inert until an operator adds a member.** It holds no
  credential and cannot log in, so it is not a connection identity and confers
  nothing on its own. An install with no analytics consumer has nothing to
  turn off.
- **Membership, not per-view grants, is what survives.** It binds a login to
  the group rather than to any object, so no migration can revoke it.
- **Only the passthroughs are granted.** The aggregate views remain behind the
  inspector surface.
- **The platform creates the group; an operator populates it.** Role creation
  stays outside the application, which can grant on what it owns but cannot
  mint roles. Where the platform does not manage Postgres, an operator creates
  the group too.
- **The reconcile is advisory.** It can never prevent the api-server from
  starting, and every start reports what the role can actually reach.
- **The role name is part of the contract**, not a configurable value, because
  the reconcile names it.

## Alternatives Considered

- **Grant the consumer's login directly** — every view-recreating migration
  revokes it silently; that is the failure this record removes.
- **Grant inside the migration that recreates the view** — correct only in
  some orderings: on a bundled upgrade the group is created by a post-upgrade
  hook, which runs after the api-server has already migrated, and where the
  platform does not manage Postgres nothing creates it at all.
- **A build gate enforcing a per-migration grant** — needed only to prop up
  the migration form, and unsound both in principle, since it judges SQL text
  rather than database state, and in practice, having judged 9 of 10 probe
  inputs wrongly.
- **Grant the aggregate views as well** — a consumer able to read an aggregate
  keys metrics on it, re-creating the rename coupling the passthrough surface
  was introduced to remove.
- **Let the api-server create the group** — an api-server able to mint
  database logins could mint itself a better one.

## Consequences

- **Easier:** adding a passthrough carries no privilege step, and adding a
  consumer later needs no release — the group can be created and populated at
  any time. The recurring post-release re-grant, previously required after
  every release that touched a view, disappears.
- **Harder:** a group created after a release is applied only by the next
  api-server start, and nothing in a release forces one, because the
  api-server does not depend on the database role configuration and an upgrade
  at an unchanged application version leaves its pods untouched. Operators
  restart deliberately, or create the group first. A privilege removed by hand
  also does not hold: the reconcile treats the passthrough set as
  authoritative and restores it, so access is withdrawn by removing the member.
- **Committed-to:** the reconcile must never be able to fail a start, since it
  runs before the api-server serves traffic and issues privilege statements
  against a catalog that migrations and operators change concurrently.
  Concurrent starts must stay serialized — unserialized concurrent grants on
  one catalog row failed roughly half the time under load.
