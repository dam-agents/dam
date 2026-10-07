---
name: ccweb
description: |
  Run and verify this repo inside a Claude Code on the web sandbox — the cloud container with no systemd, no KVM, no IPv6, a TLS-intercepting egress proxy and a fixed disk allowance. Use when a session there needs mise, the local k3s cluster (`cluster:install` / `e2e:install` with `IS_SANDBOX=1`), platform images, or to drive the UI with agent-browser. Triggers on "ccweb", "Claude Code on the web", "cloud sandbox", "IS_SANDBOX", "agent-browser", and on these symptoms there - `failed to update /proc/self/oom_score_adj: Permission denied`, istio-cni `failed to Statfs "/host/proc/1/ns/net": permission denied`, ztunnel `Address family not supported by protocol`, pods `Evicted` with DiskPressure while `df` shows room, `kubectl logs` failing with `EOF` through the agent proxy.
---

# Claude Code on the web sandbox

Only what differs in the cloud container, plus the helpers in [`scripts/`](scripts/); generic cluster and e2e operation is [cluster-ops](../cluster-ops/SKILL.md). You are here when `CLAUDE_CODE_REMOTE=true`, PID 1 is `process_api`, and `/run/systemd/system` does not exist.

## What is different, and what handles it

| Property of the container | Consequence | Handled by |
|---|---|---|
| No systemd (a `systemctl` binary exists, PID 1 is not systemd) | k3s runs as a plain process | `cluster:install` sandbox branch (installs the pinned k3s itself) |
| `/` mounted private | istio-cni cannot mount the netns dir | `cluster:install` makes `/` rshared |
| HTTPS goes through an agent proxy (`HTTPS_PROXY`) | API server → kubelet calls (logs, exec) hit the proxy | `cluster:install` adds node IPs to `NO_PROXY` for k3s |
| No IPv6 in the kernel | ztunnel crash-loops on its dual-stack bind | `cluster:install` installs the mesh IPv4-only |
| No `CAP_SYS_RESOURCE` | every pod sandbox fails: `oom_score_adj: Permission denied` | [`k3s-launcher`](scripts/k3s-launcher): containerd `restrict_oom_score_adj` |
| PID 1 not inspectable | istio-cni: `Statfs /host/proc/1/ns/net: permission denied` | `k3s-launcher`: k3s in its own PID namespace |
| cgroup v1 | kubelet ≥ 1.35 refuses to start | `k3s-launcher`: `fail-cgroupv1=false` |
| Fixed disk allowance far below the 252G the device reports | kubelet's 5% threshold evicts everything, then GCs images | `k3s-launcher`: absolute 2Gi eviction thresholds |
| No `/dev/kvm` | no vm backend | nothing; `virtualization.enabled` stays off, and the vm lane runs in CI only ([cluster-ops](../cluster-ops/SKILL.md)) |

The launcher's workarounds are sandbox-only on purpose: each turns on only when its probe says so, because clamping OOM scores or lowering eviction thresholds would change behavior on a real host.

## Bring-up (about 15 minutes cold)

```sh
curl -fsSL https://mise.run | sh && export PATH="$HOME/.local/bin:$PATH"
mise trust -a && mise install
export IS_SANDBOX=1                        # every cluster:* / e2e:* task reads it
.agents/skills/ccweb/scripts/pull-images   # api-server ui controller keycloak mock
K3S_LAUNCHER="$PWD/.agents/skills/ccweb/scripts/k3s-launcher" SKIP_IMAGE_BUILD=1 mise run e2e:install
```

`e2e:install` is the tested path: mock agents only (no LLM credentials needed), UI at `http://localhost:5555`, user `dev` / `dev`. A dev install (`cluster:install`, port 4444) renders real harness templates, so pass their components to `pull-images` (e.g. `pull-images claude-code`) and bring provider credentials.

Run the install with a long timeout or in the background (first run about 10 minutes). It is idempotent: re-run after fixing whatever stopped it.

## Images

No image build runs a container, so each builds here as on any Linux host; [`pull-images`](scripts/pull-images) is faster for images your change leaves alone.

- **Unchanged code:** `pull-images` pulls CI's images. api-server, ui and controller come from the newest main commit at or behind your merge base. keycloak and agents come via `image:resolve`.
- **Changed controller, ui, api-server or keycloak:** `mise run //packages/<pkg>:oci` (keycloak's package is `keycloak-theme`), then `mise run cluster:import -- "$(.mise/tasks/image/resolve tar-path <component>)"`.
- **Image gone from the node** (`ErrImageNeverPull` / `ImagePullBackOff` on `platform-*:latest`, typically after an eviction GC): pull it straight into containerd and re-tag it, e.g. `k3s ctr -n k8s.io images pull --platform linux/amd64 quay.io/dam-agents/mock:<tag> && k3s ctr -n k8s.io images tag --force quay.io/dam-agents/mock:<tag> docker.io/library/platform-mock:latest`.

## Disk

The allowance is roughly 30G per session; `df` reports the whole device, not what is left. Images are stored twice, as the `dist/oci/` tars the install imports and in k3s containerd; deleting the tars needs `SKIP_IMAGE_LOAD=1` on later runs, or `pull-images` again first.

## Driving the UI with agent-browser

```sh
npm i -g agent-browser
AB=.agents/skills/ccweb/scripts/ab     # preinstalled Chromium, *.localhost off the proxy, 1280x1400 viewport
$AB open http://localhost:5555/ && $AB snapshot -i
```

- **First login:** Keycloak form (`dev` / `dev`), then "I accept the Terms of Use".
- **Creating an agent** needs a provider: add a placeholder under Settings → Providers → Anthropic → API Key (the mock never calls the model).
- **Clicks that silently do nothing:** the app scrolls inside its own containers, which agent-browser doesn't scroll before a click, so below-the-fold elements get clicked off-screen (e.g. "Create agent", the lower scopes in the API key dialog). Run `$AB scrollintoview @eN` before `$AB click @eN`; check `$AB get url` or a snapshot after each click.
- **No API calls in the network log:** tRPC runs over a WebSocket, invisible to `$AB network requests`; read `mise run cluster:kubectl -- logs deploy/platform-apiserver` instead.
- **Hidden Experimental features tab:** click the version string under Settings → Account five times.

## Acting as an agent

The mock harness replays scripts and calls no tools. To call the platform MCP server as an agent, use [`agent-mcp`](scripts/agent-mcp); it runs `curl` inside the agent's pod, so the call carries that agent's mesh identity:

```sh
.agents/skills/ccweb/scripts/agent-mcp agent-1a2b tools/list
```

The mock doesn't render incoming prompts, so a platform-opened session (initialization, satellite outcome) looks empty in the UI. Read what the agent received through the e2e API:

```sh
curl -sG http://localhost:5555/api/trpc/e2e.getReceivedPrompts --data-urlencode 'input={"agentId":"agent-1a2b"}' -H "Authorization: Bearer $KEY"
```

`$KEY` is an API key from Settings → API keys; the `dam` CLI reads it from `DAM_TOKEN`. Build the CLI with `mise run //packages/cli:build` and pass `--server http://localhost:5555`.

## Running the Playwright suite

- **Browsers:** the pinned Playwright expects a newer Chromium revision than the preinstalled `/opt/pw-browsers/chromium*-1194`, and `playwright install` must not run here. Point `PLAYWRIGHT_BROWSERS_PATH` at a scratch directory of symlinks, laid out the way the error message names the missing path. For 1223 that is `chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell` linking to the 1194 `chrome-linux/headless_shell`, plus empty `INSTALLATION_COMPLETE` and `DEPENDENCIES_VALIDATED` markers.
- **`*.localhost`:** Chromium resolves it internally, but Node's `fetch` (token minting in the specs) goes through glibc, which does not. Add `127.0.0.1 keycloak.localhost` to `/etc/hosts`.
- **Environment:** set `PLATFORM_BASE_URL=http://localhost:5555` and `PLATFORM_KEYCLOAK_URL=http://keycloak.localhost:5555` for an `e2e:install` cluster, then run `mise exec -- pnpm exec playwright test --project=<name>` from `packages/e2e/playwright`. The `run` task depends on `install-browsers`, which downloads.
- **CPU:** 4 cores; one agent already brings requests to about 87%, so a spec creating a second agent waits on `FailedScheduling: Insufficient cpu`. Delete idle agents first.

## Restart and recovery

- **Restart k3s:** `mise run cluster:stop`; under the launcher every pod dies with its PID namespace. The task also clears the mounts and pod iptables rules left in the host netns, as `k3s-killall.sh` would on a supervised host; a stale hostport rule silently sends `:5555` to a dead pod IP. Then re-run the install with `K3S_LAUNCHER` set: with no supervisor, it starts k3s whenever no `k3s-server` process is running. Restarting k3s by hand loses the install's `NO_PROXY` export, so `kubectl logs` and `exec` break through the proxy.
- **Full reset:** `mise run cluster:stop`, then `rm -rf /var/lib/rancher/k3s /etc/rancher/k3s`, then the bring-up from `pull-images` on.
- **Never `pgrep -f`/`pkill -f` on a pattern like `k3s`:** it matches your own shell's command line and kills it. Use `pgrep -x k3s-server` or `mise run cluster:stop`.
- **After a k3s upgrade:** delete `/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl`, and the launcher re-derives it.
- **Postgres:** `mise run cluster:kubectl -- exec platform-postgres-0 -- psql -U platform -d platform`.
- **Curated catalog warnings** (`self-signed certificate in certificate chain`) come from the proxy's CA inside the api-server pod; harmless locally.
