# dam-vm — per-agent virtual machines

Last verified: 2026-07-20

`dam-vm <cmd>` runs a command in the agent's own virtual machine — an Incus system container on an operator-managed VM host (a plain VPS outside the cluster). It complements the [Run executor](agent-lifecycle.md#run-executors-dam-run): where `dam-run` gives an ephemeral pod that shares the agent's image, credentials, and workspace, the VM is the opposite — a root-capable machine with its own filesystem that shares nothing with the pod. It exists for work a sandbox pod cannot do: systemd, docker/k3s, nested containers, kernel-adjacent tooling.

## Topology and protocol

`dam-vm` deliberately rides the same rails as `dam-run`. The CLI ships in the platform base image, derives its target from the harness URL, and opens a single WebSocket carrying the shared terminal frame protocol (input/output/resize/exit) to the agent's `/vm` harness endpoint — through the paired gateway's existing harness passthrough, authorized by the same waypoint policy that proves the caller *is* that agent. The api-server relays the stream to the VM host's own relay (`dam-vm-server`), which lazily creates the agent's container and bridges the socket to an `incus exec` PTY.

Unlike a Run there is no CR and no executor pod — the controller is not involved. The platform's entire coupling to the VM host is the api-server-held mTLS client credential and network reachability from the api-server to the host.

## Identity and auth

The api-server↔host hop is **mutual TLS**. Both the host's server cert and the api-server's client cert are issued by one private CA — natively, IBM Cloud Secrets Manager's private certificate engine. Possession of a CA-signed client cert *is* the deployment's credential; there is no shared API key. The agent holds nothing.

Two identities compose:

- **Deployment (cluster) identity** — the client cert. Its CN names the calling DAM deployment. One VM host serves many clusters, each with its own client cert from the shared CA; the host **namespaces containers by CN**, so agents in different clusters that share an id never collide onto one VM, and a cluster cannot address another's namespace (it cannot present another's cert).
- **Agent identity** — the waypoint already proved the caller cryptographically, so the api-server forwards the agent id inside the authenticated channel, and the host names the container `<cluster>/<agent>`. An agent can never choose an id, so it can never reach another agent's machine. Forks and Run executors act under their parent agent's identity and therefore share the parent's VM. Revocation is a denylist on the host, keyed by agent or cluster/agent.

## Trust boundary

The VM host sits outside the cluster trust boundary. Containers there receive no platform credentials, no gateway, and no workspace — anything the agent wants on the VM it must carry over the wire itself. Conversely, the host must be treated as agent-controlled (agents are root inside privileged, nesting-enabled containers), so nothing else should run on it. Only the api-server needs network reach to the host; agents have no route to it and need no egress rule — like all harness traffic, `dam-vm` streams are platform control-plane, not gated user egress. The host is typically reached over the public internet (a VM host in a VPC and a cluster on separate infrastructure have no private path), which is why the hop is TLS; scoping the host firewall to the deployments' egress IPs is defense-in-depth on top of mTLS.

## Lifecycle

Containers are ephemeral: created on first use, kept while streams are active, and deleted by the VM host after an idle hour — filesystem and all. Per-agent concurrent streams are capped in the relay, mirroring the Run executor cap and for the same reason (it is the local bound on runaway recursion); overall container capacity is a host-wide limit shared across clusters. The VPS-side relay and provisioning live in [`packages/dam-vm/`](../../packages/dam-vm/); the in-pod CLI ships with the platform base image.
