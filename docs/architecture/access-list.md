# Access list

Last verified: 2026-11-09

## Overview

An install can let only some people sign in.
The **Access List** names them, by email address, and lives in the platform's own database, so sign-in never depends on a host outside the cluster.
Operators manage it in the web UI, under Settings → Access list; nobody else sees or changes it.
The chart's `accessList.enabled` turns the check on; while it is off, everyone the realm admits gets in, and operators can fill the list before they turn it on.

## The list

The list is one Postgres table, one row per lowercased email, the way the [artifact library](artifact-library.md)'s viewer list stores people: a listed person may never have signed in.
An operator adds one address or a pasted list of them, and removes one at a time; adding an address already on the list changes nothing.
Every add and remove is a security event naming the operator and the address.

The chart's `accessList.seed` carries an existing list over on rollout: the api-server adds every seeded address at each start, keeping any that is already there.
An address an operator removes comes back at the next start while the seed still names it, so the seed is meant for the first rollout only.

## The check

The check is a Keycloak required action, `dam-access-list`, in the `keycloak-environments` extension that the platform's Keycloak image carries.
A required action runs at the end of every sign-in to the platform realm — the login form, an upstream identity provider, a password grant — after the person is known and before any session or token is handed out, so one check covers every way in.
The extension turns the action on in the platform realm at each Keycloak start, and when the realm is first created, so no realm import or admin step is needed.

The action asks the api-server, `POST /internal/access-check` on its in-cluster Service, whether the person's email is on the list.
That path is outside `/api`, so no ingress routes it, and it carries a shared secret that the chart generates once, keeps across upgrades, and gives only the Keycloak and api-server pods.
A call without that secret is refused before the list is read.

The check fails closed.
An address not on the list sees a page saying so, and a person with no email is refused the same way.
A check that gets no answer — the api-server down, the database unreadable, a timeout — refuses the sign-in as temporarily unavailable; it never lets a person through.
A freshly started Keycloak needs nothing but the api-server, so a restart does not lock people out.

A holder of the [operator](security-and-credentials.md#identity) role is never checked.
The people who manage the list therefore cannot lock themselves out with it, even on an install whose list is still empty.

A change takes effect at the person's next sign-in.
A session already open, and the tokens it refreshes, run until the session ends.

## Limits

The check runs only in the chart's own Keycloak; the chart refuses `accessList.enabled` with an external one.
It decides who may sign in to the platform realm, not what they may do: the Terms of Use gate and the sign-ups switch ([security and credentials](security-and-credentials.md#identity)) still apply after it.
