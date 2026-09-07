# The document skeleton

Follow this structure exactly. Angle brackets are what you write; the guidance
under each section is for you, not for the document.

```
# Agent Case Study: <generalized role, e.g. "Support-triage agent for a SaaS product">
_Generated: <date> · Covers: <window>, <session count> sessions_

## At a glance

## Use case

## Platform in use

## Platform friction
```

## At a glance

Two-column table, five rows, bare facts; the first cell is the row's label:

- What · the job and who it serves
- Runs as · the mix of scheduled and on-demand work
- Needs · the connections it relies on
- Since last edition · what appeared, what stopped, or "first edition" / "no change"
- Friction · the worst things the platform put in the way, or "none worth naming"

## Use case

One short paragraph in plain terms: what the agent is for, who it serves (a
role, never a person), the kinds of requests it handles, and roughly how much
of it there is. Name the request kinds as a stranger to the domain would
("health and career advice", "planning a long-term project"): the domain's
detail is the owner's business, not the reader's. No task inventory, no
per-job detail.

## Platform in use

One line per platform feature the deployment touches: how the use case uses
it, or that it is offered and unused plus the reason when visible. Cover at
least sessions, schedules, channels, connections, memory or files on the pod,
the artifact library, skills.

## Platform friction

Only friction that happened: a real attempt in the window, by the owner or by
the agent doing the owner's work, that the platform blocked or made harder.
Platform state merely observed (an empty source list, an unused feature,
leftover files) is not friction until someone hits it. "None this window" in
one line beats a padded list. At most 5 items, worst first, one line each: the
goal, the obstacle, the workaround or "no workaround". One item per underlying
gap: two symptoms of one missing feature merge. Tag an item already present in
the previous edition "(also last edition)". Platform feature names are
expected; company and product names are not.
