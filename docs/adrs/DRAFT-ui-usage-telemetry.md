---
title: UI usage telemetry collected in the browser, kept apart from the activity log
status: proposed
subsystem: usage-tracking
tags: [usage, telemetry, privacy, qa]
summary: The web UI records views, clicks on test ids, friction signals and journey steps itself, into a 30-day table of its own; a QA agent reads only k-anonymous aggregates of it, by an inspector's API key on one endpoint.
---

# DRAFT: UI usage telemetry collected in the browser, kept apart from the activity log

**Date:** 2026-10-31 **Status:** Proposed **Owner:** @xjacka

## Context

The activity log records what people do to the platform — turns, schedules, connections — but nothing about how they get through the web UI: which controls they use, where they click without effect, which dialogs they give up on.
A QA agent is meant to turn exactly that into UI bugs with screenshots and hand them to the design agent, and it can only read DAM over HTTP.

## Decision

The web UI records its own usage in the browser and reports it to the api-server, which stores it in a table of its own, kept 30 days, and serves only aggregates in which every row stands for at least three people.

- **Off by default, on per install.** An install enables it explicitly; for now only the DEV environment does, until a production install's users are told through the terms of use.
- **Collected by the platform's own code, never a third-party analytics service.** The data stays in the cluster with the rest of the usage record.
- **Signals are computed in the browser** — rage and dead clicks, errors shown, script errors, navigation bounces, abandoned dialogs, slow requests — because only the browser sees them; the server stores events and does not interpret raw clicks.
- **Nothing identifying is recorded**: routes as patterns, elements as test ids with any identifier stripped, no input values, message text or error text.
  The actor is pseudonymized like every other usage actor.
- **A separate table, not the activity log**: a different volume, retention and read path.
- **Reads are aggregates over a period** with the core team excluded and every row under three distinct people dropped; there is no per-user or raw-event read.
- **An inspector's API key opens this one endpoint**: an API key carries no realm roles, so the api-server checks with Keycloak, live and cached for a minute, that the key's owner holds the inspector role.
  Every other inspector route still needs the role on a session.

## Alternatives Considered

- **Rows in the activity log** — a click stream would dwarf the semantic events there and share their 180-day retention.
- **A third-party product analytics or session replay service** — sends user behaviour out of the cluster.
- **Session recording (DOM replay)** — captures typed text and content by design.
- **A new API key scope for usage reads** — changes the fixed scope vocabulary, which is a public contract, for a single read-only endpoint.
- **The inspector flag recorded at sign-in, as the core flag is** — a role withdrawn in Keycloak would keep working for the key until the owner's next sign-in.

## Consequences

- **Easier:** the QA agent gets friction ranked by rate against views and compared with the previous period, journey funnels and the steps before each signal, without reading code or raw events.
- **Harder:** a new control whose test id is built from an identifier must be added to the UI's prefix list; a UI test fails until it is.
  Small installs see little: with fewer than three people behind a row it is dropped, so a pilot of a handful of users yields mostly empty friction.
- **Harder:** every API-key call to the endpoint may cost a Keycloak admin request once a minute per key owner.
- **Committed-to:** the endpoint's response shape is a contract with the QA agent in another repository; changing it needs both sides.
  The record is pseudonymized personal data, so enabling it beyond DEV needs a user-facing notice in the terms of use and a privacy sign-off.
