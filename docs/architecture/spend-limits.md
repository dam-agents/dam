# Spend limits

Last verified: 2026-10-13

## Overview

DAM measures the spend of each model call in the agent's own gateway, for every harness and every provider dialect.
This number is Metered Spend: the agent cannot change it, because the meter runs only in parts that the agent does not control.
The spend that a harness reports through telemetry ([metrics](metrics.md)) stays for display only.

The parts:

- **The meter**, in the agent's paired gateway pod ([credential-gateway](credential-gateway.md)), reads the usage in each provider reply and sends one spend record per call to the api-server.
- **The api-server** receives the records on the same per-agent port that answers the gateway's ext_authz checks, so a record is tied to its agent the same way a check is ([security-and-credentials](security-and-credentials.md#hitl-ext_authz)).

The api-server does not accept spend records yet, so the gateway drops them.
The api-server can price a call ([Prices](#prices)), but the ledger and the limits are not built yet.

```mermaid
flowchart LR
  subgraph pod[agent pod - not trusted]
    H[harness]
  end
  subgraph gw[gateway pod - trusted]
    M[meter]
    A[ext_authz]
  end
  H -->|model call| M --> A --> P[provider]
  M -.spend record.-> S[api-server]
  A -.check.-> S
```

## Meter

**Which chains.** A host chain carries the meter when one of its credentials comes from a model-provider Connection.
The gateway knows this from the Connection's provider template, which the api-server writes on the Connection's Secret.
A chain for any other Connection, and an allow-only chain, has no meter.

**On the request.** Before the ext_authz check, the meter gives the call an id that the agent cannot set: it replaces any value the agent sent.
The gate sees the id, and the gateway removes it before the provider.
The meter also removes the request's compression offer, because a compressed reply cannot be read as it passes.
It notes the path without the query and without a Connection address prefix, the API dialect of the path, and whether the path is billable.
Billable paths are the model calls: Anthropic Messages, OpenAI Chat Completions, legacy Completions, Responses and Embeddings, and the Bedrock invoke and converse calls, streamed or not.
Model lists, token counting and account paths are free, and the gateway sends no record for them.
Other paid paths, such as batch jobs and the later read of a background Responses result, are not metered, so a spend limit does not see their spend.

**On the reply.** The meter reads the reply as it passes, chunk by chunk, and does not buffer or change it.
It chooses the format by the reply's content type, because a streamed request can get a JSON reply: an event stream, a JSON body, or the Bedrock binary event stream with its encoded payloads.
It reads counts only inside usage objects in the structure of the reply.
It takes the reply's model and service tier only from the highest level of the reply where they occur, because a reply can repeat request fields at a lower level, such as Responses metadata, and the agent sets those.
Text from the model sits inside JSON strings, where quotes are escaped, so model text cannot form a usage object.
For each count the highest value wins, so a repeated or forged object can only raise a count, never lower it.
It keeps the raw counts with the dialect and leaves their meaning to pricing: input, output, cache reads, cache writes and their five-minute and one-hour parts, cached tokens, web searches, Bob credits, the service tier, the speed, the inference geography and the reply's model.

**The record.** The gateway sends spend records over a gRPC access log to the agent's ext-authz Service, the address that only this agent's gateway can reach.
A record names the payer, which is the root driver for an Invocation target, and the Connection when the request addressed one of the chain's model-provider Connections.
It carries the reply size, the proxy's own cost figure when the reply has one, and whether the reply ended with its format's end event.
A reply that stops early keeps the counts read so far and is not marked complete.

**Periodic records.** While a call runs, the gateway also sends a periodic record of the same call every 2 seconds, with the counts so far.
So a long call that a gateway restart cuts off still leaves its partial counts.
The gateway's telemetry logs leave periodic records out, so they show one entry per call as before.

## Prices

**Where a price comes from.** The meter counts tokens, and a limit is in money, so the api-server turns each call's counts into a cost.
Only Bob's replies carry their own price, in Bobcoins.
The other providers send tokens only, and IBM LiteLLM's own cost figure is real only on replies that are not streamed.
The api-server looks up a price by the call's provider and model, and the first match wins:

- **An operator price** from the chart.
  The chart ships IBM LiteLLM's own prices, which differ from every public price list and differ per model and per kind of token.
  An operator reads them from IBM's price list with a temporary management key and revokes the key afterwards; an agent never gets such a key, because the gateway adds a Connection's key to every call to its host.
- **A provider rule.**
  RITS models and Curve Bender cost nothing.
  Bob uses the Bobcoins in each reply.
  The Claude subscription is valued at Anthropic's list prices, as a value and not a bill.
- **The Anthropic table:** Anthropic's list prices, copied from a pinned version of LiteLLM's public price list.
  It prices own Anthropic keys and the subscription value.
- **An estimate** for a model with no price: the highest price of its model family among the provider's prices, else the provider's highest price, marked "estimated", so DAM never counts low.

A reply can name its model differently from the request, for example without a routing prefix or with a release date, so the lookup also matches on the model's own name.
OpenAI and Bedrock have no public prices in DAM yet: without an operator price, their calls keep their tokens and cost nothing, so a spend limit does not stop them.

**How a cost is computed.** The rules follow LiteLLM's own cost rules, so DAM's cost equals LiteLLM's for the same counts.
A price sets input, output, cache reads, five-minute and one-hour cache writes, and web searches.
Above a prompt-size threshold, which counts cached tokens too, all token prices change.
When a reply names the flex or priority tier, that tier's prices apply.
A missing cache price falls back to the input price, never to nothing, and a cache write without its five-minute and one-hour split counts at the one-hour price.
On the Anthropic API, fast mode and US-only inference multiply the token prices by the factors of the model's price.
Costs are whole micro-units of the Connection's unit, rounded up.

**When a cost is fixed.** DAM prices a call when its record arrives and stores that cost, so a later price change alters neither the history nor a limit.
When a reply carries a proxy cost figure above zero, DAM compares it with its own cost and logs a large difference, which shows an operator price that is wrong or old.

**Updating prices.** The Anthropic table changes only through a reviewed update to a newer pinned version of LiteLLM's list, which the regular dependency update proposes.
The update stops when a copied price lacks one of its token prices, so a broken upstream list never reaches DAM.
Operator prices change through the chart.
