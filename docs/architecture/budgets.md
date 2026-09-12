# Per-user resource budgets

Last verified: 2026-09-12

## Overview

A **Budget** is a per-user ceiling on how much a user's *running* agents may
hold at once. Nodes have a fixed compute pool and every agent draws on it, so
without a ceiling the first users to spin up agents can starve everyone else.

**Nobody chooses an agent's size.** A user picks no CPU and no memory, at
create or ever: the figures come from the template the agent was made from, or
from the install default. Asking someone to predict, before an agent has run
once, how much memory it will want weeks later produced a number that was
wrong in one direction or the other and that they then had to maintain. What a
user does instead is watch what their agents actually use and stop the ones
they are done with — which is the same decision, made with the evidence in
front of them. The one resource question left to a user is how many agents
they can have awake at once, and the answer to that is their Budget.

The Budget is today **a published figure and two narrow gates, not an admission
control**. It is computed live, shown to the user, and enforced at the two
points where a decision would otherwise be unrecoverable — growing a running
agent, and spawning a worker whose Size could never fit. Nothing refuses an
ordinary start: a user who starts agents one at a time can pass their Ceiling,
see it on the meter, and keep going. [What is not enforced](#what-is-not-enforced)
states that gap plainly, because a full set of consumers still expects the gate
that used to exist.

## What is counted

**Reserved** — the consumption side of a Budget — is the sum of **Sizes**
across the owner's running agents. A hibernated agent counts nothing, which is
what makes hibernation the way room is returned.

An agent's **Size** is the CPU/memory figures on its spec, set by its template
or the install default and not by the user. The two dimensions are not the same
kind of promise, and the difference is deliberate:

- **Memory is a guarantee and a ceiling at once.** The supervisor sets it as
  the sandbox's hard memory limit, and the scheduler subtracts it from the node
  for as long as the agent is placed there. A node is therefore never promised
  more memory than it has, and an agent is never killed to make room for
  another.
- **CPU is a weight, not a cap.** The supervisor sets it as the sandbox's CPU
  weight and sets no quota at all. An agent alone on a node uses the whole
  node; agents that want the CPU at the same time divide it in proportion to
  their Sizes. Measured on a four-core node: a one-core Size alone reached
  3.99 cores; two equal Sizes contending took 2.01 and 1.97; a one-core and a
  two-core Size contending took 1.29 and 2.69.

This is why a Size is a platform decision rather than a user's. It sets what an
agent is guaranteed when the install is busy, not what it is allowed when it is
not — an agent doing nothing between somebody's turns holds no CPU, and an
agent in the middle of a build is not held to a figure chosen weeks earlier.
With every agent on the same Size, the Ceiling divided by it is simply how many
agents a user may have awake, which is the form the meter shows.

There is still no requests/limits split: one number per dimension, used for the
ceiling, for placement, and for the sandbox itself. What changed is that the
CPU number means a share of a contended node rather than a throttle.

The paired gateway is deliberately excluded — uniform per-agent platform
overhead, which operators price into default ceilings — as are per-command Run
sandboxes, a known undercount.

## What is measured

Separately from what an agent is promised, the node reports what each of its
agents is **using**: memory from the sandbox's own cgroup, and CPU as a rate
between two readings of the same cgroup's accounting. The supervisor takes a
reading on each reconcile and publishes it on the agent record, so any node can
answer for an agent it does not host and the figure survives a restart of the
one that does.

It is the same accounting the kernel enforces the memory ceiling with, so the
number on the screen and the number that would get an agent killed are the same
number. It counts the sentry as well as the processes inside it, because that
is what the agent costs the node.

This is what replaced the Size picker in the product. The meter ranks a user's
running agents by what they are measured to be using — heaviest first, memory
ordering the list because it is the dimension that is actually finite — so
"which of my agents should I stop" has an answer drawn from the agent's real
behaviour. A freshly started agent reports memory immediately and no CPU until
its second reading, since a rate needs two.

## The Ceiling

Install-wide defaults live in the node configuration. A row in `user_budgets`
overrides them for one user — the owner's plaintext sub as the key, and a CPU
and memory quantity:

| owner | cpu | memory |
|---|---|---|
| `<keycloak-sub>` | `16` | `32Gi` |

The owner is the row's primary key, which makes one-budget-per-user structural,
and quantities are validated on the way in, so a malformed ceiling is rejected
rather than silently parsed to zero. Overrides are operator-managed rows; there
is no self-service path. Role-based budgets and approval flows are out of
scope — when they arrive, richer policy will *materialize* its results as
override rows, and the numeric contract stays as dumb as it is now.

## What is enforced

**A grow that would not fit is refused at save time.** Resizing an Agent always
restarts its sandbox — a kernel limit is not changed under a running
workload — and a *running* Agent resized upward is checked against the Ceiling
before the spec is patched: the mutation fails with both figures and the
settings dialog says which agents to stop. The check is grow-only (a shrink
always helps, even for an owner already over) and the read-check-patch runs
serialized per owner on a Postgres advisory lock, so two resizes by one owner
cannot both slip under.

**A worker Size that could never fit is refused when it is spawned.** An
Invocation target whose Size alone exceeds its owner's Ceiling would wait for
room that no amount of freeing ever provides, so the spawn path rejects it
synchronously with both figures rather than letting it hang until the
Invocation's deadline reaps it.

**Slots** are how the UI presents the rest. One slot is the install's default
Size, and the budget read publishes that unit next to Reserved and Ceiling. An
agent occupies as many slots as its larger dimension needs, rounded up; the
Ceiling holds as many slots as its tighter dimension allows, rounded down.
Since every agent is the same Size, that arithmetic reduces to a count, and the
meter says so: *N of M agents awake*, one cell per agent, coloured working /
awake / free, with the measured consumers listed beneath it and the operator's
budget-request link beside it. First-time users with no agents see none of it.

## What is not enforced

There is **no admission gate at start**. Starting an agent consults no budget:
the supervisor brings up whatever the record says should run, and Reserved
simply grows. The over-budget agent state, the parked-until-room-frees
behaviour, the early-reclaim of an owner's idle agents, and the typed
over-budget wake failure are all still *read* — by the agent list, the wake
path and the UI's unavailable overlay — and nothing writes them, so that state
never appears. A user over their Ceiling sees a full meter and no other
consequence.

What does bound capacity is **placement**, and it bounds a different thing. An
agent is only assigned to a node with room for its Size's *memory*, and an agent
that fits nowhere is left unplaced rather than crammed onto the emptiest node
([platform-topology](platform-topology.md)). CPU never refuses a placement,
because a CPU share cannot run out — a second agent on a busy node makes both
slower in proportion to their Sizes, which is the bargain, rather than being
turned away to keep cores idle. That keeps a node's *memory* from being
oversubscribed — it says nothing about how the room is divided between users,
and it is install capacity, not a budget. The two failures are also not
interchangeable in what they should tell a user: "you are using your share" and
"the install is full" call for different actions, and an unplaced agent is
currently surfaced by neither the meter nor any agent state.

## Freeing room

Users free capacity by stopping a running agent (see
[agent-lifecycle](agent-lifecycle.md) for the hard-stop mechanics) or letting it
hibernate. Reserved is computed from live state and never persisted, so a
hibernate, stop, or delete credits the budget back with nothing to reconcile.
