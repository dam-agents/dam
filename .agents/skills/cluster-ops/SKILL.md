---
name: cluster-ops
description: Operate the local dev install — a cluster VM (k3s via lima) running the shared services, and one or more node VMs running the api-server that supervises the agents — and the Playwright e2e suite. Use when working with cluster:*, vm:*, e2e:* or node:* tasks; when `vm:install` stops for want of `DAM_DATABASE_URL`; when the UI at localhost:4000 will not log in; when an agent never leaves "starting"; when a second node is needed; or when running in CI sandbox mode. Triggers on "cluster:up", "cluster:install", "cluster:env", "vm:install", "vm:logs", "vm:status", "e2e:loop", "e2e:second-node", "node:cordon", "lima", "k3s", "IS_SANDBOX".
---

# Cluster and node operations

`mise tasks --all | grep -E '^//:(cluster|vm|e2e|node)'` lists every task named here with its description.

## Shape of a local install

Two kinds of lima VM. Guests cannot address each other; a node reaches the cluster through the lima host, and Kubernetes is never told an agent exists.

- **cluster VM** (`dam-cluster`, `etc/lima/k3s.yaml`) — k3s running the shared services: Postgres, Redis, Keycloak, SeaweedFS. Published to the host on fixed NodePorts 30432 / 30379 / 30081 / 30333, shifted by `DAM_CLUSTER_PORT_OFFSET` (100 for the e2e cluster).
- **node VM** (`dam`, `etc/lima/dam.yaml`) — the api-server as a systemd unit (`dam-api-server`), supervising gVisor sandboxes and one Envoy gateway unit per agent (`dam-gateway@<id>`). UI on host port 4000, peer port 4002. The repo checkout is mounted into it.

## Lifecycle

```sh
mise run cluster:up && mise run cluster:install   # shared services
eval "$(mise run cluster:env)"                     # DAM_DATABASE_URL, DAM_REDIS_URL, DAM_KEYCLOAK_URL, …
mise run vm:up && mise run vm:install              # the node
```

- `cluster:up` — create or start the cluster VM. `cluster:install -- [helm args]` — install or upgrade the chart. `cluster:env` — print the endpoints and credentials a node needs; `eval` it in the shell that runs `vm:install`. `cluster:delete` — destroy the VM, database included.
- `vm:up`, `vm:install` (rebuild api-server and UI from the checkout, lay down `/etc/dam/env` and the templates, restart), `vm:logs` (the api-server journal, where the supervisor logs), `vm:status` (units, sandboxes, links, sockets, ruleset), `vm:shell`, `vm:stop`, `vm:delete` (workspaces included).
- After a code change: `mise run vm:install` again. It needs the `cluster:env` variables in the shell.
- `node:cordon <node-id> [--undo]` — stop a node taking new agents; the agents it holds move as they hibernate and wake.

Log in at [localhost:4000](http://localhost:4000) with `dev` / `dev`.

## E2E (Playwright)

The e2e install is its own pair of VMs (`dam-e2e-cluster`, `dam-e2e`) on its own host ports (UI 5555, cluster NodePorts +100, peer 4202), configured by `etc/e2e-env.sh`, so it never disturbs the dev pair.

- `mise run e2e` (alias of `e2e:run`) — fresh install, build the mock harness, run the smoke tier. `--headed`, `--full`.
- `mise run e2e:loop` — rerun against the warm e2e node: reinstall the platform, wipe data, run. `--test=<filter>`.
- `mise run e2e:reset` — wipe data only (agents, database, stored Playwright auth).
- `mise run e2e:second-node` — add `dam-e2e-2`, so the cross-node spec runs instead of skipping. `--down` stops it.

**Suite tiers.** Smoke (`src/tests/smoke/`) is what CI and plain `e2e` / `e2e:loop` run. Full adds the slow specs under `src/tests/full/`, on demand with `--full`. A full spec is self-contained: its own agents, its own token, one `<area>-full` Playwright project per area.

## Sandbox mode (CI)

`IS_SANDBOX=1` means there is no lima: `cluster:up` provisions k3s on the machine itself, `vm:up` provisions it as the node, the kubeconfig is `/etc/rancher/k3s/k3s.yaml`, and no port is shifted. CI also sets `SKIP_IMAGE_BUILD=1`, so `platform-mock:latest` must already be tagged.

## Debugging

- Cluster: `eval "$(mise run cluster:env)"` exports `KUBECONFIG`; then `kubectl -n dam …`. The database is `dam-platform-postgres-0`; node rows are `select id, peer_address, state, last_heartbeat from nodes`.
- Node: `mise run vm:logs` first. `sandbox.reconcile.failed` names what the supervisor could not do; `image.pull.*` and `image.resolve.failed` are the registry; `placement.no-capacity` is the node's memory; `placement.over-budget` is the owner's ceiling (`DEFAULT_USER_*_BUDGET` in `/etc/dam/env`; the e2e node raises them).
- `vm:install` stops at `DAM_DATABASE_URL: run: eval "$(mise run cluster:env)"` — the variables are not in this shell.
- The UI redirects to Keycloak and back for ever — the realm's issuer is the URL the browser uses. A cluster installed for a non-default UI or Keycloak port needs `cluster:install -- --set urls.keycloak=… --set urls.ui=…` (the e2e install does this).
- An agent stays "starting" on a fresh node — the image: a template that names a registry the node cannot reach, or a private registry without a credential on the agent. The failure lands on the agent record as an image-pull failure.
- A second dev node on the same host needs its own `DAM_VM`, `DAM_PORT`, `DAM_PEER_HOST_PORT` and a `DAM_NODE_ADDRESS` the other guest can reach (the lima host, `192.168.5.2`) — see `.mise/tasks/e2e/second-node` for the shape.
- Docker daemon disk: image builds (`vm:install`, the mock) run in the docker VM, whose disk is separate from both lima VMs. `docker system df`, then `docker builder prune`.
