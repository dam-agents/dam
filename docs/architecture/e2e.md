# End-to-end suite

Last verified: 2026-10-20

The **e2e suite** is the smoke test that proves an install works from outside the cluster: Playwright drives the web UI and the public API against a real k3s install, and a mock harness answers the Agents' turns.
It is the only test that covers a change across the whole system — login through Keycloak, the mesh's policies, the api-server, the controller and an Agent behind it — so it runs twice for every change, once per lane.

## Lanes

A **lane** is a Backend for the Agents a spec creates.
The **container lane** runs a plain install, where an Agent is a pod; the **vm lane** runs an install with virtualization on, where the Agents a spec creates are machines on their owner's VM runner — except the ones a spec stages as an object with the container backend, which boot as containers.
The lanes differ in nothing else, and both run on every pull request and in every full-suite run, each on its own runner, so a fault only one Backend has shows on the change that caused it.
The lane is one variable, `E2E_VIRTUALIZATION`: the install reads it to turn the vm backend on, and the suite reads it to pick the specs only one lane can run, and so the order the projects run in.

## Projects and the order between them

The specs are grouped into Playwright **projects**, one per area, whose dependencies chain the state they share: the auth project stores the user's login, the agent project creates the suite's mock Agent and the Connection its chat turns need, and the chain project drives that Agent through messages, Sessions, Slack and egress.
A spec that boots and drives an Agent of its own runs in a project after those, one at a time, because each of them competes for the same cluster's compute.
Four specs run in the vm lane alone: the runtime migration needs an install with both Backends, the harness tools and browser tabs specs drive what only a machine has, and the boot matrix breaks a machine's boot the ways a host failure does — it kills the machine's VMM at the steps of a boot that platform-init reports on the machine's console, once at a running guest with writes synced into HOME, and empties the disk's layout mark.
A fifth, the runner release spec, rolls a live machine onto a second runner release and back, with the chart's own upgrade.
The runner release spec runs after every project the run keeps, whatever the scope drops: a runner pod rolls every machine its owner has, so it waits for the suite, and it leaves the install on the values it found there.
The claim-filling case refuses from the host side unless the claim is a filesystem of its own, which is read from inside the runner: the device the kernel gives the claim's filesystem against the devices of the mounts the chart hands the runner from the node itself, and a filesystem that is not one — an overlay, a tmpfs — is refused as no proof either.
Neither the provisioner's name nor the PersistentVolume's source can say where a volume's blocks are, and both are wrong in both directions: a CSI driver named for the node's disk hands out a directory of it, and a CSI driver backed by a network is storage of its own.
Its fill comes off after the spec whether its own case reached the removal or not, and the allocator runs as a process of its own that the teardown kills and waits out before the file is removed, because a local `kubectl` that gave up waiting leaves that process writing to the owner's storage after the removal; the flag that arms the teardown is set before the call that can write the fill.
The boot matrix runs with the other specs that boot an Agent of their own, one at a time, for the compute they would otherwise share.
Its cases that need room a CI node cannot spare, a disk with no block left and a claim with none, are opt-in through `E2E_DISK_FILL_GIB` and `E2E_CLAIM_FILL_GIB`: a machine's disk is a sparse file on its owner's claim, that claim is a directory of the node's disk, and a fill takes that room whenever its filesystem allocates the blocks instead of marking them.
The agent backend spec runs on both lanes, in each lane's own-agents project: on the container lane after the agent project, whose provider connection its chat input needs, and one at a time with the other specs that boot an Agent of their own, and on the vm lane after the rest of the suite, since the VM runner it deletes runs every other machine of that user.
The tier under `src/tests/full/` is on demand: a local run asks for it, and no CI run takes it.

## Scope: what a pull request runs

A pull request runs the smoke suite on both lanes, with a reduced set of specs; every other event runs all of them — the merge queue that puts a change on main, the nightly run, a dispatch, and a tag.
The reduction is measured, not guessed: over five weeks of CI ending 2026-10-18, about 600 failed e2e jobs came from a handful of specs, and only some of those failures were likely real — the same spec failing in both lanes of one run, or again on the pull request's next run.
A spec that never fails for real, or that costs a lane minutes for a surface the other lane proves just as well, earns nothing on a pull request.

Deferral is not a coverage gap: a change reaches main through the merge queue, whose run takes the full set on the tree it queues, and the nightly run takes it on main again.
The Playwright config owns the list, and it is the one place that decides it: the workflow passes the event's scope as `E2E_SCOPE`, and the config turns that into what each project runs and which projects a reduced run leaves with no spec at all.
Each lane's job summary states the scope beside its timings, so a green pull request is never read as a green full suite.
The two summaries hold the same table, so a phase of one lane compares with the same phase of the other; a phase a lane never reached reads `n/a`.

## Running it

`mise run e2e` is the CI path: a fresh cluster, the suite, teardown.
`e2e:loop` iterates against a warm cluster, and the [cluster-ops skill](../../.agents/skills/cluster-ops/SKILL.md) covers both.
