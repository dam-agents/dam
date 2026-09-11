# Migrating an install from Kubernetes-hosted agents to nodes

Status: the importer exists and the whole path has been exercised against a
database built by the released version's own migrations and a cluster holding
the resources that version keeps there. What has not been exercised is the
workspace copy, which needs real volumes.

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
the agent records, *every* agent in the install is absent from that table, so
the sweep would delete every install's channel bindings, schedules, API-key
scopes, egress rules, knowledge-base shares and public profiles, and emit a
deletion event for each. The sweep now refuses to act when no agent record
exists at all — that state is not the one it was built for — but the ordering
below is what actually keeps the window shut.

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
   registered. Do not start the api-server on them yet.
3. **Import.** Run the importer against the new database. It is safe to run
   more than once; run it until it reports no work left.
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

## Rollback

Until step 6 the old install is intact: its controller is scaled to zero but
its resources, secrets and volumes are untouched, and the new tables are
additive, so scaling the controller back up restores service. After step 6 the
only way back is a database restore taken before step 3, so take one.
