# Per-user resource budgets

Last verified: 2026-09-11

## Overview

A **Budget** is a per-user ceiling on the CPU and memory that user's *running*
agents may hold at once. Nodes have a fixed compute pool and every agent draws
on it, so without a ceiling the first users to spin up agents can starve
everyone else.

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

An agent's **Size** is the CPU/memory limits on its spec: the one resource
concept users see, chosen from the template's default at create, the Size picker
in the agent's settings, or the install default. The limits are real — the
supervisor applies them to the sandbox as kernel-enforced limits, so memory is
capped and CPU throttled at exactly the figure the meter counts. There is no
requests/limits split and no overcommit ratio: one number per dimension, used
for the ceiling, for placement, and for the sandbox itself.

The paired gateway is deliberately excluded — uniform per-agent platform
overhead, which operators price into default ceilings — as are per-command Run
sandboxes, a known undercount.

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
Users never touch CPU or memory directly: the Size picker offers a small fixed
set of slot multiples, and the agent list and the home dashboard show the same
slot meter — one cell per slot, colored working / awake / free, with the
operator's budget-request link beside it. First-time users with no agents see
none of it.

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
agent is only assigned to a node with room for its Size, and an agent that fits
nowhere is left unplaced rather than crammed onto the emptiest node
([platform-topology](platform-topology.md)). That keeps a node from being
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
