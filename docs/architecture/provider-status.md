# Provider status

Last verified: 2026-10-19

## Overview

When a model provider fails, a user cannot tell the outage from a fault in DAM or in their own setup.
Provider Status is the platform's view of whether each model provider answers, per Connection template: healthy, degraded, or a fault on the platform's side.
The api-server computes it from the model calls that the agents' gateways see, and from public status sources that need no key; the screens read it to name an outage where a user meets it.

```mermaid
flowchart LR
  M[gateway meter] -- spend record --> I[spend ingest]
  I -- call ended --> W[call window in Redis]
  J[evaluate job, 60 s] --> W
  J -- no key --> P[proxy readiness, status pages]
  J --> S[status snapshot in Redis]
  S --> Q[status query]
  Q --> UI[screens]
```

## The gateway signal

Every model call goes through the agent's gateway, and the [meter](spend-limits.md#meter) sends a final record for each call.
The record names the Connection template of the call, its payer, the status of the reply, and whether the gate refused the call.
The meter sets these facts on the request, so a call whose upstream connection fails still sends a record.
For each final record, the spend ingest emits a domain event before it measures the call, so a failed call without usage also counts here.

Provider Status keeps a window of the last five minutes per template in Redis, in one-minute buckets: the calls, the failed calls, the agents with calls, and the agents with failed calls.
Every replica writes into the same window, because each replica receives the records of its own gateway streams.

A failed call is a final record with a status that a provider gives when it is down or overloaded: 500, 502, 503, 504 or 529.
These records do not count: a periodic record, a call that the gate refused, a call with no status because the harness closed it, and a call whose record names more than one template.
An agent here is the payer, so the sub-agents of one root driver count as one agent.

## Detection

A template is degraded when, in the window, at least three calls failed, at least half of its calls failed, and at least two agents had failed calls or every agent that called it had failed calls.
So the broken setup of one agent does not blame a provider that other agents use without problems.

When at least two templates had calls, every one of them is degraded, and at least two agents had failed calls, the fault is on the platform's side, and no provider is blamed.
So one agent whose own gateway fails does not tell every user that the platform is down.
A degraded template keeps its start time until it is no longer degraded, also while the fault is on the platform's side.
The status is per template, not per model: a provider with one broken model shows as degraded when most calls use that model.
The thresholds are constants in the code.

## Public sources

The gateway signal needs traffic: a provider that nobody called in the last five minutes has no window.
So the job also reads public sources that need no key, as a second signal.
It reads only the sources of templates that have a Connection in the install.

| Templates                          | Source                      | Degraded when                                                                                     |
| ---------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| Curve Bender, IBM LiteLLM          | the proxy's readiness check | in two runs in a row, it does not answer within five seconds or does not say healthy: unreachable |
| Anthropic key, Claude subscription | Anthropic's status page     | the Claude API component, or for the subscription also Claude Code, has a partial or major outage |
| OpenAI                             | OpenAI's status page        | the Chat Completions or the Responses component has a partial or major outage                     |
| Bob                                | Bob's status API            | the chat completion check of Bob's region is not operational                                      |

A proxy's readiness shows only that the proxy and its database run, not that its models answer, so it can say "unreachable" but never "healthy models".
The api-server reaches a proxy by another path than the agents' gateways, so an unreachable proxy counts only while no agent's call to it succeeds in the window.
One failed check does not count, because a single slow or reset check would tell every user that the provider is down; the outage starts at the first failed run of the two.
The job keeps the count of failed runs in the snapshot, so it holds whichever replica runs the job.
A degraded component, and the overall indicator of a status page, do not count: OpenAI's overall indicator also counts products that DAM does not use.
A status page or Bob's API that does not answer, or answers in an unknown shape, gives no signal, so it never makes a provider degraded.
Bob's API is not documented, so DAM matches its check by name and by the region in its name.
When the gateway and a public source both report a template, the gateway's reason wins, and a public source never makes the fault on the platform's side.
The job warns in the log when a source fails three runs in a row.

## The snapshot and the job

A periodic job runs every 60 seconds in one replica.
It reads the window, computes the state of each template with its start time, and writes one snapshot to Redis that expires after three minutes.
When the job stops, the snapshot expires and the status becomes unknown.
A new outage shows after up to about two minutes: the one-minute bucket, the job, and the poll of the screen.

## The query

The status query reads only the snapshot, so a request never calls a provider.
It returns the outages with their start times and, for Anthropic, OpenAI and Bob, the link to the provider's status page; the fault on the platform's side with its start time; and the time of the last check.
While the fault is on the platform's side, only the outages that a public source reports stay listed.
A template that the query does not list is healthy or unknown.
Every signed-in user reads the same status, because an outage belongs to the provider and not to a user.
