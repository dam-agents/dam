# End-to-end suite

Last verified: 2026-10-20

The **e2e suite** is the smoke test that proves an install works from outside the cluster: Playwright drives the web UI and the public API against a real k3s install, and a mock harness answers the Agents' turns.
It is the only test that covers a change across the whole system — login through Keycloak, the mesh's policies, the api-server, the controller and an Agent behind it — so it runs twice for every change, once per lane.

## Lanes

A **lane** is a Backend for the Agents a spec creates.
The **container lane** runs a plain install, where an Agent is a pod; the **vm lane** runs an install with virtualization on, where the Agents a spec creates are machines on their owner's VM runner — but the one the migration spec stages as an object, which boots as a container.
The lanes differ in nothing else, and both run on every pull request and in every full-suite run, each on its own runner, so a fault only one Backend has shows on the change that caused it.
The lane is one variable, `E2E_VIRTUALIZATION`: the install reads it to turn the vm backend on, and the suite reads it to pick the specs only one lane can run, and so the order the projects run in.

## Projects and the order between them

The specs are grouped into Playwright **projects**, one per area, whose dependencies chain the state they share: the auth project stores the user's login, the agent project creates the suite's mock Agent and the Connection its chat turns need, and the chain project drives that Agent through messages, Sessions, Slack and egress.
A spec that boots and drives an Agent of its own runs in a project after those, one at a time, because each of them competes for the same cluster's compute.
Five specs run in the vm lane alone: the runtime migration needs an install with both Backends, the harness tools and browser tabs specs drive what only a machine has, the boot matrix breaks a machine's boot the ways a host failure does — it kills the machine's VMM at points of a boot and empties the disk's layout mark — and the storage trim spec measures the claim under an agent's machine.
The boot matrix runs with the other specs that boot an Agent of their own, one at a time, for the compute they would otherwise share.
Its cases that need room a CI node cannot spare, a disk with no block left and a claim with none, are opt-in through `E2E_DISK_FILL_GIB` and `E2E_CLAIM_FILL_GIB`: a machine's disk is a sparse file on its owner's claim, that claim is a directory of the node's disk, and a fill takes that room whenever its filesystem allocates the blocks instead of marking them.
The storage trim spec's refusal case runs everywhere: it marks blocks in the guest's own filesystem with `fallocate`, so the guest is held at its share without the claim paying for it, and the case that reads the claim's ceiling beside it writes real bytes, so it is opt-in through `E2E_DISK_FILL_GIB` like the boot matrix's.
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
