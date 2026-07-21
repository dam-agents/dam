# dam-vm — per-agent VMs on an Incus host

`dam-vm <cmd>` (baked into the platform base image as a second name for the `dam-run` script — [`packages/platform-base/dam-run.mjs`](../platform-base/dam-run.mjs)) runs a command in the agent's own Incus system container on a VM host you provision — a plain Ubuntu VPS. With no command it opens an interactive login shell. Where `dam-run` gives an ephemeral pod that shares the agent's image/creds/workspace, the VM shares nothing: it's a root-capable machine with its own filesystem, for work a sandbox pod can't do (systemd, docker/k3s, nested containers). Containers persist across calls while in use and are deleted after ~1 h idle.

Each container is **Fedora 44** with lazy **auto-install shims** ([`container-init.sh`](container-init.sh)): common tools — `mise`, `docker`, `git`, `node`/`npm`, `jq`, `yq`, `rg`, `fd`, `python`/`pip`, `uv`, `kubectl`, `k9s`, `poetry`, `bun` — install themselves via mise (or dnf) on first use, so the image stays small yet "just works".

**This package is the VPS side**: the relay server (`dam-vm-server`), the provisioning script, and a mise task that issues the certs. Architecture and trust model: [`docs/architecture/dam-vm.md`](../../docs/architecture/dam-vm.md).

How it connects: the in-pod CLI opens a WebSocket to the agent's `/vm` harness endpoint (same rails as `dam-run`); the api-server relays that stream to the VPS over **mutual TLS**, attaching the agent's waypoint-proven id. Agents hold no credential and can't reach the VPS directly. One VPS serves **many DAM clusters** — each authenticates with its own client cert whose CN namespaces its containers (`dam-<cluster>-<agentId>`), so same-named agents in different clusters never share a VM.

---

## Deploying from zero

Prerequisites: an IBM Cloud account with the `ibmcloud` CLI logged in (for the VPS + firewall), `mise` (for the cert task), and a DAM deployment **running a build that includes this feature** (the `/vm` relay in the api-server image and `dam-vm` in the platform base image — i.e. this branch).

### 1. Create the VPS (IBM Cloud VPC example)

- In the account selector (top right) switch to the target account (e.g. "2288434 - cil15 LLM GPU Account").
- Go to https://cloud.ibm.com/infrastructure/compute/vs → "Create +".
  - Any name; image **Ubuntu 26.04** (24.04 LTS or newer works).
  - Instance type with enough CPU/RAM for the agent workloads (it may run multiple k3s stacks).
  - Attach an SSH key (create one if needed).
  - 10 GB boot volume, and **attach a data volume** sized for the workloads (200 GB+). This is required: provisioning puts the whole btrfs storage pool on it (`DAM_VM_DISK`, default `/dev/vdb`) so container images/rootfs never fill the small boot disk.
- Open the instance → **Networking** tab → three-dot menu → **Edit floating IPs** → attach a floating IP; note it.
- Verify: `ssh -i <key> ubuntu@<floating-ip>`.

### 2. Issue the mTLS certs

Auth is mutual TLS — the VPS and the api-server each present a cert signed by one private CA. Generate everything with one command (the id after the IP is a **cluster id** — one per DAM deployment that will use this VPS; `[a-z0-9]` only, ≤16 chars, no hyphens — it becomes that cluster's container namespace, and hyphens would make the hyphen-joined container names ambiguous across clusters):

```sh
mise run dam-vm:issue-certs -- <floating-ip> <cluster-id> [<cluster-id> ...]
# e.g. mise run dam-vm:issue-certs -- 203.0.113.7 damdev
```

This writes a CA + a server leaf (with the floating-IP SAN) + one client leaf per cluster into [`cert/`](./) (git-ignored), and **prints a ready-to-paste helm block per cluster**. Re-running reuses the CA (add a cluster anytime); `CERT_DAYS=` sets leaf validity (default 825; the CA lives 10 years). Managed alternative: issue the same certs from an IBM Cloud Secrets Manager private CA — no code change, just PEMs.

### 3. Provision the VPS

```sh
scp -r packages/dam-vm ubuntu@<floating-ip>:
ssh ubuntu@<floating-ip> sudo bash ./dam-vm/provision.sh
```

Installs Incus (+ the host kernel modules/sysctls k3s-in-container needs), Node.js, the `cert/` material into `/etc/dam-vm/`, the container shim script, and the `dam-vm` systemd service (serving `wss://` with mutual TLS). The storage pool is created as whole-disk btrfs on the data volume (`DAM_VM_DISK`, default `/dev/vdb`) — **required**: provisioning aborts if that block device is absent (a loop image on the boot disk fills up and wedges the pool read-only, so there's no fallback). Idempotent — re-run to upgrade the server, shims, or rotate certs (it leaves an already-initialized incus's storage/network alone).

### 4. Restrict the network path (recommended)

mTLS is the access control, but scope TCP 8090 to the cluster's egress IP as defense-in-depth. Only the api-server connects (agents never do); SSH on 22 working doesn't imply 8090 is open. Note: an IBM Cloud *classic* cluster and a *VPC* VPS have **no private path**, so this is over the public internet on the floating IP (hence TLS); if the cluster shares the VPS's VPC, use the private IP in `url` instead and scope to the subnet.

```sh
# each cluster's egress IP as the VPS sees it (run against its api-server pod)
oc exec -n <ns> deploy/dam-platform-apiserver -- curl -s https://ifconfig.me/ip

SG=$(ibmcloud is instance <vps-name> --output json | jq -r '.network_interfaces[0].security_groups[0].id')
ibmcloud is security-group-rule-add "$SG" inbound tcp --port-min 8090 --port-max 8090 --remote <egress-ip>
```

### 5. Point each DAM cluster at the VPS

Add that cluster's block (printed by step 2) to its Helm values. The chart puts the cert/key into a Secret and injects the env via `secretKeyRef` — but the values themselves carry the private key, so treat this values file as a secret. This project has **no secret-sealing tooling** (no SealedSecrets/SOPS/External Secrets); operator secret values live wherever your deploy keeps them — e.g. the reference deployment stores the whole values file in a manually-managed `dam-values` Kubernetes Secret that `helm upgrade -f` reads. Put the block there, the same way other operator secrets (Slack token, Keycloak client secret, …) are handled.

```yaml
apiServer:
  vmHost:
    url: "wss://<floating-ip>:8090/run"
    clientCert: |
      -----BEGIN CERTIFICATE-----
      ...this cluster's client leaf...
    clientKey: |
      -----BEGIN PRIVATE KEY-----
      ...its key...
    caCert: |
      -----BEGIN CERTIFICATE-----
      ...the CA chain...
```

`helm upgrade` and the api-server picks it up. That's the whole integration — no agent env, no egress rules, no gateway changes.

To wire an already-running cluster without a full redeploy, create the Secret and env directly (they mirror exactly what the chart renders):

```sh
oc create secret generic <release>-apiserver-vmhost -n <ns> \
  --from-file=PLATFORM_VM_HOST_CLIENT_CERT=cert/<cluster>.crt \
  --from-file=PLATFORM_VM_HOST_CLIENT_KEY=cert/<cluster>.key \
  --from-file=PLATFORM_VM_HOST_CA_CERT=cert/client-ca.crt
oc set env deploy/<release>-apiserver -n <ns> \
  PLATFORM_VM_HOST_URL=wss://<floating-ip>:8090/run \
  --from=secret/<release>-apiserver-vmhost
```

This is an override that a later `helm upgrade` reconciles — still add the block to the values so it survives (and label/annotate the hand-made Secret for Helm adoption to avoid an ownership clash).

### 6. Verify end-to-end

Create an agent in the UI, then run the CLI from its pod (exercises CLI → gateway → api-server `/vm` relay → VPS mTLS → `incus exec`):

```sh
kubectl exec -n <agent-ns> <agent-pod> -c agent -- sh -c \
  'echo | dam-vm sh -c "uname -r; whoami; systemd-detect-virt"'
# expect the VPS kernel, root, and "lxc" — a container on the host, not the agent pod
```

The container appears as `dam-<cluster>-<agentId>`: `ssh ubuntu@<floating-ip> sudo incus list dam-`. `provision.sh` pre-pulls the Fedora image, so the first call just boots + runs the shim init; the first use of any shimmed tool then does a one-time install (visible as an `installing <tool>…` line).

---

## Security notes

- Auth is mutual TLS; there is no shared API key. A client without a CA-signed cert is refused at the TLS handshake. Each cluster's client-cert CN must be a canonical id (the host rejects a non-conforming CN rather than mapping it lossily); keep CNs distinct per cluster.
- Containers are privileged with nesting enabled (so full k3s/docker run inside) — treat the whole host as agent-controlled and keep nothing else on it.
- **A shared host is one trust domain.** A privileged container can escape to host root, so the per-cluster CN namespace and per-cluster cap (`DAM_VM_MAX_CONTAINERS`, counted per cluster) prevent accidental collisions and cross-cluster starvation — not a malicious escape. Run a separate host per trust boundary where isolation between clusters actually matters.
- Rotate certs by re-issuing (step 2) and re-running provision (server) / updating helm (clients). Revocation (`denied.json`, entries `<agentId>` or `<cluster>/<agentId>`) is read at startup, so cutting off an agent needs `systemctl restart dam-vm`, which drops live sessions.

## Ops

- Service: `systemctl status dam-vm`, logs: `journalctl -u dam-vm -f`
- Containers: `incus list dam-` — named `dam-<cluster>-<agentId>`. Ephemeral: no live connection and no activity for `DAM_VM_IDLE_DELETE_MIN` (default 60 min) → deleted, filesystem and all. Delete one manually: `incus delete -f dam-<cluster>-<agentId>`.
- Server knobs (`KEY=value` lines in `/etc/dam-vm/env`, read by the systemd unit and preserved across re-provisioning; `systemctl restart dam-vm` to apply): `DAM_VM_PORT`, `DAM_VM_LISTEN_HOST`, `DAM_VM_IMAGE`, `DAM_VM_MAX_CONTAINERS`, `DAM_VM_IDLE_DELETE_MIN`, `DAM_VM_TLS_CERT_FILE`, `DAM_VM_TLS_KEY_FILE`, `DAM_VM_CLIENT_CA_FILE`

## Tests

- `mise run dam-vm:test` — generates a throwaway CA + certs and drives the real server: a CA-signed client is accepted, a client with no cert is refused at the TLS layer. Incus not required.
- `packages/api-server/src/__tests__/unit/harness-vm-relay.test.ts` — drives the real `dam-vm` CLI through the real api-server relay against a stand-in VM host (agent-identity forwarding, config gating, close-code propagation).
