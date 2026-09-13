# Nodes

Last verified: 2026-09-13

## Overview

A node is one machine running one api-server, and the install is several of them sharing Postgres and Redis. This page covers what makes them one install: how a node registers and is judged alive, how the **scheduler** places each agent that wants to run onto a node, how an operator drains one, how nodes authenticate to each other over the **peer link**, and how an agent's home directory follows it from node to node. The components that run on a node — the supervisor, the sandbox, the gateway — are on [platform-topology](platform-topology.md).

**Registration.** A node is told who it is and where the shared services are,
and that is all. At boot it writes its own row — address, capacity, state — and
refreshes a heartbeat on its own clock. Liveness is *computed on read*
(`now - heartbeat < T`, both sides the database's clock, so one drifted node
cannot read the install as dead) rather than stored, so each row has exactly
one writer and no arbiter decides who is alive; a node that stops heartbeating stops
being eligible without anyone marking it down. Capacity is the VM's resources
less a fixed reservation for the node's own work, so placement can use the whole
number it sees.

**Placement.** The scheduler assigns an agent that wants to run and has none,
and releases one assigned to a node that no longer wants it. Policy is
sticky-first: the node that ran the agent last, if it is ready and the agent
still fits, otherwise the least full node by the larger of its CPU and memory
fractions. An agent that fits nowhere stays unassigned rather than being forced
onto a node — the alternative is a sandbox the node cannot start, reported as
the agent's fault.

An operator drains a node by **cordoning** it: it keeps its agents and its
heartbeat but takes no new ones. The state is a field on the node's row that
only an operator sets — a node writes it when it first registers and never
again, so a cordon outlives the node's own restarts. There is no product
surface for it: the operator writes the row, and the repo ships a task that
does so for the dev cluster. Moving the agents off it is then the ordinary
lifecycle — the scheduler releases them, whichever node picks each one up
fetches its workspace, and nothing special-cases migration.

**Peer links.** Nodes speak to each other over one mutually authenticated
connection, both ends holding a leaf from the install CA and each proving the
node id it claims. It carries two things: a relay to an agent held by that node,
and a workspace export.

Holding a node's certificate is necessary and not sufficient. A workspace is an
agent's whole history, so an export is served only to the node that agent is
*assigned* to — the one node with a reason to fetch it — which is why the leaf
carries its node id rather than only the name every node shares. One node
compromised is otherwise every workspace in the install readable, and the
install CA lives in Postgres, which is a shorter walk than it sounds. The relay
needs no equivalent rule: a node only holds addresses for agents it runs, so
there is nothing to ask it for. Callers inside the api-server are unaware of it — an
agent's address resolves either to its sandbox's link on this node or to a local
address that tunnels to the node holding it, so the ~18 relays and proxies that
dial an agent are written once, for the local case, and are correct for both.

**Workspaces follow the agent.** An agent's home directory lives on the disk of
the node that ran it — which is what makes it fast enough to build in — and the
agent record names that node. A node placed with an agent it does not hold
fetches the directory from the named node over the peer link before starting it;
a node that already holds it does nothing, so a reconcile does not re-fetch on
every sweep. The record, not the presence of a directory, decides: a node that
ran the agent last month still has one, stale by exactly the work done since.

The transfer is node to node rather than through the object store, because the
node named on the record is the only place the workspace exists and a second
copy would be a second truth to explain. The cost is stated rather than hidden:
an agent cannot move off a node that is down. That is the same fact the record
already carries — the agent is unavailable until its node returns — rather than
a new failure mode, and it is why node-local disk is the durability story. A
node VM that restarts comes back with its disk and its agents intact.

## Invariants

- **Placement has one writer.** Only the scheduler assigns and releases, and only one scheduler runs, because it is gated on the install-wide lock — so everything able to call it ends when the lock does, a pass already under way included: losing the lock stops it between records rather than letting it race the node that took over.
- **Peer links belong to the node, not the leader.** A relay and a workspace export are what a node does for the others whichever one leads, so both last as long as the node.
- **Peers are named by certificate.** A node proves which node it is with a leaf from the install CA; nothing on the wire can change which node it is taken to be. Identity-by-socket, one level out.
- **A workspace is exported to one node.** Holding a node certificate is not enough to fetch an agent's directory; only the node the agent is assigned to is served, because the export is the agent's whole history.
