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
  node; agents that want the CPU at the same time divide it. Measured on a
  four-core node: a one-core Size alone reached 3.99 cores; two equal Sizes
  contending took 2.01 and 1.97; a one-core and a two-core Size contending took
  1.29 and 2.69.

**The contest is between people, not agents.** Each user's sandboxes sit in a
cgroup of their own on the node, and those groups are what compete at the top
level, so a user running ten agents takes one user's share and divides it among
their ten rather than taking ten shares. Without it the platform quietly
rewards whoever leaves the most running, which is the opposite of what a
per-user ceiling is for. Measured on the same four-core node, with one user
running two agents and another running one: the first user's pair took 1.99
cores together (0.98 and 1.01), the second user's single agent took 2.00.

This is per node and needs no coordination between nodes, because contention is
a property of a machine: dividing each machine between the people using *that*
machine is the whole of the problem. A user with agents on two nodes gets a
share of each, and the share they get on the second costs the first node's
users nothing. It does not require a user's agents to be placed together.

Only CPU is divided this way. Memory is promised per agent and subtracted from
the node at placement, so a per-node copy of an install-wide memory ceiling
would let a user hold the whole of it on every node at once.

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

## Fair use over time

The per-user groups divide a busy node evenly between whoever is on it. On top
of that, each node leans the division towards whoever has been using it
**least**, so an hour of somebody's batch job does not cost the person who
shows up wanting one answer the same as it costs the person who has been
running builds all morning.

It is a weight, not a quota, and it never stops anyone. There is no kernel
primitive for "so many CPU-seconds an hour" — cgroup quotas are a rate over a
hundred milliseconds, a cap rather than a budget — so what a node does instead
is move each user's weight, and a weight only decides who yields when two
people want the same core. A user throttled to the floor still gets a whole
node that nobody else is using.

Three choices make it a fair-use policy rather than a cliff:

- **Recent use is an exponential average with a three-minute half-life.** One
  number per user, no history to store, and it forgets at a stated rate: the
  tilt is there a minute or two after somebody arrives, and a finished build is
  forgotten inside a quarter of an hour.
- **A user is only judged against the people who were actually competing.** An
  idle user is not counted in the divisor, and a node with one busy user has
  nothing to be fair about and is left alone — otherwise a user would be
  charged for cores nobody wanted, and the first moment a second person
  arrived would find the first already at the floor.
- **The penalty is the inverse of how far over the share a user is**, floored
  so nobody is starved: twice the share halves the weight, four times quarters
  it, and it decays on its own as the throttle reduces the use that caused it.

Measured on a four-core node with two users. While the heavy one was alone it
stayed at full weight for three minutes of burning all four cores. Once a
second person started wanting CPU its weight fell 70 → 65 → 61 → 59 → 57 over
five minutes, and with both then asking for everything the split was 1.48 cores
to the heavy user against 2.51 to the newcomer — where an even division would
have given 2.00 each.

A tilted user is told. The weight is read back from the group the sandbox sits
in — not asked of the policy that wrote it, so the figure on the screen is the
one the kernel is dividing by — and published with the agent's usage. The meter
says what share of an even split the user is getting and that it lifts on its
own. A user running on more than one node is shown the worst of them, since
"how am I being treated" is not a question an average answers.

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
"the install is full" call for different actions, so they do not share a state.
An agent the scheduler cannot place reads as **no_capacity**, and the scheduler
writes the reason on the record as it declines — distinguishing a node that
would fit if something freed up ("no node has 4.0 Gi of memory free; this agent
starts as soon as room frees up") from a demand no node in the install could
ever meet ("the largest node has 6.7 Gi; it cannot start until an operator adds
a bigger node"). One is worth waiting for and the other is not, and the agent
overlay shows whichever applies instead of claiming the agent is starting.

## Freeing room

Users free capacity by stopping a running agent (see
[agent-lifecycle](agent-lifecycle.md) for the hard-stop mechanics) or letting it
hibernate. Reserved is computed from live state and never persisted, so a
hibernate, stop, or delete credits the budget back with nothing to reconcile.
