---
id: 136
title: IBM LiteLLM calls are priced from LiteLLM's own model info
status: accepted
supersedes:
subsystem: spend-limits
tags: [spend, prices, litellm, estimates]
summary: DAM prices IBM LiteLLM calls from LiteLLM's own model info, read with the Connections' keys while DAM runs, not from a list in the chart; a call with no price counts $0 until its price arrives, and DAM then prices it again, together with the estimates of the last 30 days.
---

# ADR-136: IBM LiteLLM calls are priced from LiteLLM's own model info

**Date:** 2026-11-14 **Status:** Accepted **Owner:** @PetrBulanek

## Context

ADR-105 prices IBM LiteLLM calls from an operator list in the chart, and counts a call high when DAM cannot price it.
The list was written once, on 2026-10-15, with a temporary management key, because an ordinary key got 403 on LiteLLM's model info.
Four weeks later, 9 of the 27 models that a test key can use had no price, and some prices were wrong.
The high estimate for those models charged up to 131x LiteLLM's cost, and $0 for two models whose names were close to a free model.
On 2026-11-04 alone, such estimates added $1,011 on a development installation.
Since 2026-11-11, an ordinary IBM key reads LiteLLM's model info, which holds IBM's own price of every model that the key can use.

## Decision

For IBM LiteLLM, DAM takes each model's price from LiteLLM's own model info, which it reads with the Connections' keys while it runs, not from a list in the chart.
A call that no source can price counts $0 and waits for its price.
When the price arrives, DAM prices that call again.
Once, DAM also prices again the estimated calls of the last 30 days.
A call that had a real price never changes.

The rules:

- **Sources, first match wins:** an operator price from the chart, the prices read from LiteLLM, LiteLLM's own cost in the reply, then $0 with the mark "awaiting price".
- **One list for the proxy.** All IBM LiteLLM Connections reach the same proxy, and a price belongs to a deployment, not to a key. So DAM keeps one list by model, filled from every Connection's read. When two reads disagree, the higher price wins and DAM logs it.
- **When DAM reads:** every hour, when a Connection is added or its key changes, and when a call names a model that is not in the list.
- **Kept, not cached.** The last prices read stay in Postgres, so a restart or a later refusal does not lose them.
- **No guesses for IBM.** No IBM call takes the highest price of a model family or of all models, and none takes $0 from a model with a similar name.
- **The operator price stays a correction.** The chart ships no IBM prices; an operator price still wins, and DAM logs when it differs from LiteLLM's.
- **The check.** DAM compares its cost with LiteLLM's on every reply that carries LiteLLM's cost, and logs and counts a difference.

## Alternatives Considered

- **Keep the hand-written list and alarm on drift** — each change needs a person and a release, and CI cannot reach IBM, which answers only on IBM's network.
- **LiteLLM's cost in each reply as the source** — native Claude streams and cut streams carry no cost on IBM.
- **LiteLLM's spend log** — it needs a key that reads every user's spend, and it corrects a cost only after the call.
- **LiteLLM's public cost map** — it is keyed by deployment, and the meter does not know which deployment served a call.
- **A list per Connection** — every key that can use a model reads the same price, so it stores the same prices many times and still needs another Connection's prices after a refusal.
- **Keep the high estimate for a model with no price** — it charged 131x for Haiku 5.5 and $0 for two DeepSeek models.
- **Refuse calls to a model with no price** — it breaks users each time IBM adds a model.

## Consequences

- **Easier:** A model that IBM adds gets IBM's price on its first call, with no release; the hand-kept list missed 9 models after four weeks.
- **Easier:** No management key is needed; LiteLLM 1.108.4 and 1.109.1 let a key that may call only the model APIs read the model info.
- **Easier:** Prices are exact; for all 13 models measured on 2026-11-13, the model-info prices gave LiteLLM's own cost for every kind of token.
- **Harder:** DAM depends on IBM keeping the model info open to ordinary keys; it gave 403 in October. After a refusal, prices stay at the last read, and a new model counts $0 until an operator adds a chart price.
- **Harder:** A spend limit does not see a call that waits for its price; the wait lasts one read, normally seconds, but as long as the reads fail.
- **Harder:** Usage figures of the last 30 days can drop once after the deploy, when the estimates are priced again.
- **Harder:** DAM's cost rules must follow LiteLLM's. Price fields that DAM does not apply, such as a reasoning-token price or a regional uplift, only write a log line; today no IBM deployment has a value that changes a cost.
- **Harder:** Gemini's free search quota is counted by LiteLLM for the whole proxy, so DAM can count up to $0.014 too much per Gemini search when the reply carries no cost.
- **Committed-to:** The per-reply comparison with LiteLLM's cost is the check that DAM's cost rules still match LiteLLM's; nothing delivers its counters as an alert yet.
- **Committed-to:** An IBM call that no source prices counts low, not high, until its price arrives.
