---
id: 108
title: Every spend figure comes from the gateway meter, per session too
status: accepted
subsystem: spend-limits
tags: [spend, model-router, sessions, gateway]
summary: The Model Router stamps each forwarded model call with its session and harness, the gateway meter records them, and every spend figure — per session, per turn and per sub-agent included — reads the meter; the router's own record carries no cost.
---

# ADR-108: Every spend figure comes from the gateway meter, per session too

**Date:** 2026-10-16 **Status:** Accepted **Owner:** @PetrBulanek

## Context

ADR-105 made the gateway meter the source of the spend limits and of Home's total.
The per-session figures still came from the Model Router's own telemetry record (ADR-098), which runs in the agent's pod, prices at list price and exists only where the telemetry store runs.
So one month showed two totals, the session costs did not add up to the trusted one, and an agent's own cost report disagreed with its owner's screens.
The meter could not split spend by session, because the session lives in the agent's pod.

## Decision

The Model Router stamps each model call that it forwards with the session and the harness, and the gateway meter records them with the call.
Every spend figure comes from the meter, per session too; the session split is for display only, and the router's own record carries no cost.
This amends the spend part of ADR-098: the router's record is no longer the source of any spend figure.

- The router finds the session from each harness's own markers, as before, and never forwards a stamp that a harness sent for a session the router identified.
  Pi's extension sends its session id; a Codex or Bob terminal's own id maps back to the platform session through the pins that the harness writes; a Pi or Codex terminal also stamps the platform session id itself.
- The gateway removes the stamp before the provider, on every chain.
- The calling agent of a record is the identity of the gateway's record stream, never a value from the pod.
  A stamped session counts only when the calling agent reported that session to the session directory; any other counts as no session.
- The daily ledger keys its rows by session and calling agent, so the spend of a driver's sub-agents shows apart and under the session that spawned them.
- A per-call row, kept 30 days, gives each chat turn its measured cost: the calls of the session that start inside the turn.
- Telemetry keeps the per-call context rows, logs, spans and the earlier estimates; no screen and no agent reads a spend figure from it.

## Alternatives Considered

- **Keep the router's record for per-session spend** — two figures for one call, list prices, and parts that do not add up to the limits.
- **A turn stamp from the runtime** — the same per-row storage, plus a join between runtime turns and telemetry turns.
- **Price telemetry tokens at read time** — a second pricing path that drifts from the ledger on estimates and price changes.
- **A turn key on the daily ledger** — rows grow with turns, not sessions.

## Consequences

- **Easier:** the session parts add up to the trusted total: on the local install on 2026-10-16, one driver's sessions plus its no-session spend equalled its breakdown and its limit figure (672,030 µ$).
- **Easier:** spend is computed by one parser and one price book; the router's usage parser now only counts tokens.
- **Easier:** an agent's cost report answers on a deployment without the telemetry store, from the same rows as the limits.
- **Harder:** calls that skip the router (Bedrock, a custom template's own harness) and `claude -p` runs that an agent starts in its own shell have no session.
- **Harder:** the agent's own pod writes the session directory, so the ingest check turns a session that the agent never reported into no session but cannot stop a deliberate agent from adding rows under itself; such rows change no total and no limit.
- **Harder:** the session key multiplies the ledger's rows by the sessions of a day; on the local database an agent starts a median of 1 session a day, at most 26.
- **Harder:** a call gets a second write when it ends, and the per-call rows need a retention job: about 60,000 rows a day for 300 agents at 200 calls each.
- **Harder:** the earlier-estimates view reads telemetry, whose router records now carry no cost, so it shows little for days after the upgrade.
- **Committed-to:** the stamp headers are the router's to set and the gateway's to remove; a harness or a provider must not rely on them.
- **Committed-to:** the per-call rows live as long as the window from which the chat reads turns (30 days).
