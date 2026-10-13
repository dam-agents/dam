---
id: 104
title: Model spend is metered and limited in each agent's gateway
status: accepted
supersedes:
subsystem: spend-limits
tags: [spend, gateway, envoy, ext_authz, cost]
summary: DAM measures model spend in each agent's gateway and enforces spend limits there, with soft owner limits that refuse and ask and a hard operator ceiling per user; spend that a harness or an in-pod component reports stays display only.
---

# ADR-104: Model spend is metered and limited in each agent's gateway

**Date:** 2026-10-13
**Status:** Accepted
**Owner:** @PetrBulanek

## Context

Owners and operators must cap what agents spend on models, and today nothing does.
The only cost figure is the one that Claude Code reports through telemetry.
The agent can change or stop that report, and Claude Code prices a model it does not know at the default Claude price.
Codex and Pi report no cost at all.
A LiteLLM key spent about $4,000 in two days before anyone saw it.

## Decision

DAM measures model spend in each agent's gateway and enforces spend limits there.
The spend that a harness or an in-pod component reports stays for display only.

- **The meter.** On each chain whose credential comes from a model-provider Connection, the gateway reads the usage in the provider's reply as the reply passes, and does not change or buffer it.
  It reads only usage objects in the reply's structure, so text from the model cannot fake a count.
  It removes the request's compression offer, so the reply stays readable.
  It sends one record per call to the api-server over a gRPC access log, plus a periodic record every 2 seconds while a call runs.
- **The ledger.** The api-server prices each call when its record arrives and stores that cost, so a later price change never rewrites history or a limit.
  It keeps a daily rollup in Postgres and day counters in Redis for the limit check.
- **Prices.** The first match wins: an operator override per provider and model, then a provider rule (free models, Bob's own credits, list price for the Claude subscription), then a table generated from a pinned version of the LiteLLM price list, then the highest price of the model's family, marked estimated.
  When usage is missing, DAM counts high and marks the call estimated.
- **Limits.** The owner sets soft daily limits for an agent, for all own agents and for one Connection of an agent: at a limit the gateway refuses the next call, and DAM asks the owner whether to continue for one more limit amount today.
  The operator sets a hard daily ceiling per user, which refuses and asks nothing.
  The ext_authz gate checks the limits before each billable call, and at a limit, schedules do not fire and sub-agents do not start.
- **Refusal by API path.** The shape of a refusal follows the API path of the call, never the harness, because one agent can run several harnesses.
- **The Model Router.** An in-pod router's own record can split spend per session for display; the gateway meter gives the totals that limits use, and the api-server keeps the one price table.

## Alternatives Considered

- **A Cortex ext_proc meter** — it breaks requests above 1 MB and keeps records in memory, where a restart loses them.
- **Harness telemetry** — the agent controls it, and Codex and Pi send no cost.
- **Provider-side key limits** — DAM has no admin key for the LiteLLM proxies, Anthropic and OpenAI limits are monthly, and Bedrock has none.
- **Stopping the agent at a limit** — turn recovery resumes an interrupted turn up to five times, and a schedule fire overrides a stop.
- **The Model Router's record as the meter** — the router runs in the agent pod, which the agent controls.
- **Holding the call while the owner decides** — Claude Code re-sends a held call every 360 s unless its timeouts are changed, and older Pi homes give up after 30 s.

## Consequences

- **Easier:** Every harness and every provider dialect is metered by one mechanism: the spike read 28 of 28 cases across Anthropic, OpenAI Chat, OpenAI Responses and Bedrock replies in under 0.5 ms per normal call.
- **Easier:** A refusal that each harness understands stops it at once: in 31 runs, Claude Code stopped on a 429 that says not to retry, and Codex and Pi stopped on a plain-text 400.
- **Harder:** Every gateway restarts once when this ships, and replies in progress at that moment stop.
- **Harder:** The meter is Lua inside Envoy, and the repository has no Lua runtime to test it; a change to it needs a probe against a real Envoy.
- **Harder:** A call that already streams finishes after a limit: one Opus 5.5 call can cost $6.56 at list price, or $10.56 with a one-hour cache write of all input, and parallel sub-agents multiply this.
- **Harder:** The gate fails closed, so an api-server outage refuses new model calls; records of calls running at that moment can be lost, and DAM estimates those calls after 60 minutes.
- **Harder:** The gate does not read request bodies, so it cannot see the model: at a dollar limit it also refuses calls to free models on a paid Connection, and a runaway task on a free model is never stopped.
- **Committed-to:** Providers return usage in their replies; a provider that omits usage or compresses replies against the request makes every call an estimate.
- **Committed-to:** The api-server's ext-authz port also receives spend records, so its identity check by Service authority covers both.
