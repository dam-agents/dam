# Migrating an install from Kubernetes-hosted agents to nodes

Status: exercised end to end, against a real install of the released version
— its own cluster, its own database, its agents, their conversations and their
volumes — migrated onto a node and verified there. The workspace copy is now
included in that; see *The full rehearsal* below for what was carried and what
had to be repaired to carry it.

## What actually changes

The platform's data lived in three places on Kubernetes and lives in two after
the move:

| On Kubernetes | After |
|---|---|
| Postgres — everything the api-server owned end to end | unchanged |
| Agent custom resources | rows in the agent record table |
| Secrets holding credential bytes | rows in the credential store |
| UserBudget custom resources | rows in the per-user budget table |
| One PersistentVolumeClaim per agent | a directory on the disk of the node holding that agent |

Postgres is the easy half and is already handled: the schema change is
additive, so an existing database migrates in place with nothing to convert.
Everything that lived in the Kubernetes API has to be read out and written
into Postgres, because nothing reads the Kubernetes API any more.

## What was tested

Against a database built by the released version's own migrations and seeded
with representative rows — channel bindings, schedules, egress rules, API keys,
a public profile, a session directory entry, an identity link:

- The new api-server applied the three pending migrations on startup and
  served immediately afterwards.
- Every pre-existing row survived, values intact.
- The new tables were created and the node registered itself.
- The importer moved an agent, its two credentials and its budget ceiling out
  of the cluster, and the agent then appeared over the API under its own name.
- The agent came up **at rest**: its last activity is whenever it was last used
  before the cutover, so nothing is placed or started until someone asks for
  it. A migrated install wakes on demand rather than stampeding.

So an operator's Postgres needs no preparation, no dump and no conversion. It
is upgraded by pointing the new api-server at it.

**One hazard was found by that test, and it is severe.** Agent-scoped rows name
an agent id. A periodic sweep deletes the rows of any agent id the agent record
table does not contain — the backstop for a delete interrupted halfway. Between
the moment the new api-server starts and the moment the importer has written
the agent records, *every* agent in the install is absent from that table.

This was measured rather than reasoned about. On a migrated database with the
records not yet imported, the first sweep reaped: the channel binding deleted,
the schedule deleted, the egress rule deleted, the API key's agent binding
emptied, the public profile retired — one agent's entire configuration, and it
would have been every agent's. The sweep now refuses to act when no agent
record exists at all, since that state is not the one it was built for, but the
ordering below is what actually keeps the window shut.

## The full rehearsal

A release install was built for real — four agents, two connections, a granted
credential, a cron schedule, an API key, a per-user budget, and a conversation
held with an agent that left files in its volume — and then moved onto a node
by the order of operations below. Everything arrived: the agents under their
own names, the schedule with its next run recomputed, the API key with its
scopes, the budget ceiling with the four agents counted against it, the
conversation's session resumable by its old id, and the agent's own files —
its notes, its harness memory, a nested file — readable from inside the gVisor
sandbox on the new node.

Three things did not arrive by themselves. Each was found by running the move,
not by reading it:

**A connection's credential was left pointing at a store that no longer
exists.** A connection row was always in Postgres, so it migrates in place and
looks finished — but the row carries the *address* of its secret, store id
included, and the importer had just moved that secret to a different store
under a different path. The row survived intact and pointed nowhere.

What that breaks is worth being exact about, because the obvious guess is
wrong. The gateway is *not* affected: it materializes an agent's credentials by
listing what the store holds for that owner and matching the grant by name, so
a migrated agent's egress injection keeps working. What breaks is every path
that hands the stored reference back to the store, which refuses an address it
did not mint: editing a connection's value fails outright, and an OAuth
connection's refresh and token exchange fail — so it keeps working until its
access token expires, and then stops, in a background job, hours after the
cutover looked successful. Reproduced deliberately on the migrated install:
with the old reference restored, `connections.update` returns 500 and the node
logs `pg secret store cannot handle ref with storeId="k8s"`.

The importer now re-addresses every reference a connection holds, at whatever
depth its kind puts them, and only to secrets this migration actually moved.
Across the whole schema this is the only column that stores one — checked
against the released version's own database, not assumed.

**The node's api-server starts itself.** The unit is enabled in the node image,
so "create the node VMs but do not start the api-server yet" is not what
happens when a node VM boots — it reconciled the imported records and created
empty home directories for two agents before their workspaces had been copied.
Stop the unit as soon as the VM is up and start it at step 5, or the copy is
racing a supervisor that is already building the agent an empty workspace.

**An image only the old cluster could resolve.** An agent's image reference is
carried across verbatim, which is right for a registry reference and useless
for one that only ever worked because the image had been side-loaded into the
old cluster's container runtime. A node pulls from registries; an unqualified
name becomes a Docker Hub pull and a 401. Such an image has to be published
somewhere the node can reach, or placed on the node, and the record's image
rewritten before the agent will start.

Two further notes, neither of them a defect:

- **The identity provider has to be the same one.** Every owner column is a
  Keycloak subject id. The chart's Keycloak keeps running across the move, so
  this costs nothing — but an install that takes the opportunity to stand up a
  *fresh* Keycloak orphans every agent, connection, schedule and key in the
  database, because their owner no longer exists. There is no mapping step in
  the importer and there should not be one; keep the realm.
- **Users re-accept the terms** whenever the release changes their version,
  which is what the acceptance record is for. The acceptance rows migrate; they
  simply name the version that was accepted.

## The importer

A one-shot command that reads the cluster and writes Postgres. It needs
`kubectl` pointed at the old cluster and the new database's URL, and it is
idempotent, so a partial run is re-runnable and a second run changes nothing.
It reads through the cluster's own client rather than a Kubernetes library:
this runs once per install, and it is not worth re-introducing the dependency
the rewrite removed.

**Agent custom resource → agent record.** Carried over: name, description,
image, environment, the granted secret and connection ids, the hibernation
timeout override, the resource limits (the Size), the telemetry attribution id,
and the activity annotations. Dropped, because the concept is gone: the
backend, runtime class, node selector, storage class and size, image pull
policy, the init block, and the mount declarations — the sandbox has one
persisted directory and no mount model. Not carried: observed status. The
supervisor rebuilds readiness, restart counts and the address from what it
finds, and importing a stale opinion about a pod that no longer exists would
only have to be corrected.

**Secrets → the credential store.** Each managed Secret carries its owner and
purpose as labels and its fields as data; each becomes one row keyed by the
same reference path the agent records already point at. This is the step that
must not be skipped or half-done: an agent whose granted credential did not
arrive starts normally and fails at the first upstream call.

**UserBudget resources → budget rows.** Owner, CPU and memory.

**Connections → re-addressed in place.** A connection row does not move, but
every credential reference it holds is rewritten to name the store and path the
secret landed at. A reference to something this migration did not move is left
alone.

**Registry credentials.** The pull secret an agent referenced becomes a
credential-store row, and the agent's spec refers to it by name rather than by
a path on a node.

**Workspaces.** Each agent's volume is copied to the disk of the node that will
run it, as that agent's home directory, with the work tree inside it rather
than beside it. The record then names that node as the workspace's holder,
which is what lets any other node fetch it later. This is the slow step and the
only one that moves bulk data; it is also the only step that needs the old
cluster to still be running.

## Order of operations

1. **Quiesce.** Scale the controller to zero so nothing reconciles, then
   hibernate every agent so no pod is writing to a volume. Agents are
   unavailable from here until step 5.
2. **Stand up the new install.** The cluster keeps running the shared services
   — the chart is the same one, cut down — and the node VMs are created and
   registered. The api-server starts with the VM, so stop it on each node as
   soon as it is up: it must not serve or reconcile until step 5.
3. **Import.** Run the importer against the new database. It is safe to run
   more than once; run it until it reports no work left. Finish it before the
   install carries traffic: it re-addresses connection references from what the
   cluster says, so a run against an install that has since moved a credential
   would undo that.
4. **Copy the workspaces** onto the nodes the records name.
5. **Start the nodes' api-servers.** Each reconciles the agents assigned to it.
   The first reconcile issues fresh gateway certificates from the install CA
   and materializes credentials onto the node from the database.
6. **Decommission** the controller, the CRDs and the per-agent pods.

Steps 3 and 5 must not be reordered. The sweep guard makes an accident
survivable rather than silent, but an api-server serving before the import is
an install where every agent appears deleted to its users.

## What cannot be carried over

- **In-flight work.** A turn running at quiesce time is lost. Sessions
  themselves survive — they are files in the agent's directory.
- **Per-node certificate authorities.** The install gets one CA and every
  gateway gets a fresh leaf; nothing is imported.
- **Anything that was Kubernetes.** Node selectors, storage classes, runtime
  classes and pull policies have no counterpart. An install relying on them for
  placement should read the node registry's capacity model instead.
- **An image the old cluster held and no registry does.** The reference comes
  across as written; whether it resolves is the node's question, not the
  cluster's.

## Rollback

Until step 6 the old install is intact: its controller is scaled to zero but
its resources, secrets and volumes are untouched, and the new tables are
additive, so scaling the controller back up restores service. After step 6 the
only way back is a database restore taken before step 3, so take one.
