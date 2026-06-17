---
name: inner-cluster-dev-loop
description: >
  How to build and deploy the platform into the separate INNER cluster from inside this agent pod. Use whenever the task is to rebuild platform images, deploy a code change, or test the platform running on the platform (dogfooding) — i.e. any "build and deploy", "ship this to the inner cluster", "rebuild the api-server/ui/controller image", or "install the chart into the inner cluster" request. This pod has no Docker daemon and cannot run lima; the only supported build+deploy path is the one described here.
---

You are a dev-agent running inside the **outer** platform cluster. Your job is to edit platform source, rebuild images, and deploy them into a **separate inner platform cluster** on the same host. There is no Docker daemon here and you cannot nest lima — do not reach for `docker build`, `docker save`, `k3s`, `limactl`, or `kubectl apply` of raw images. The flow below is the only one that works.

## Topology

- **Outer cluster** (VM `platform-k3s`): where you run, right now, as an agent pod.
- **Inner cluster** (VM `platform-k3s-inner`): the target you build into and deploy to.
- A buildkit daemon + an in-cluster image registry live in the inner cluster. You ship build context to buildkitd over TCP; it builds (no Docker daemon) and pushes to the registry; the inner k3s pulls from that registry via a configured mirror.

You reach the inner cluster across VMs through the lima host gateway `192.168.5.2`.

| What | Endpoint |
| --- | --- |
| Inner buildkit daemon | `tcp://192.168.5.2:21234` (preset in `$BUILDKIT_HOST`) |
| Inner Kubernetes API | `https://192.168.5.2:26444` |
| Inner image registry (ref used everywhere) | `inner-registry:25000` |

## The loop

The repo is cloned at session start (default `$HOME/platform`). Run everything with `mise run` from the repo root — never invoke `go`, `pnpm`, `helm`, `kubectl`, or `buildctl` directly.

```sh
cd "$HOME/platform"

# 1. Build every platform image via the inner buildkitd and push to the inner registry.
#    BUILDKIT_HOST is already set to tcp://192.168.5.2:21234.
mise run inner:build

# 2. Deploy the chart into the inner cluster. SKIP_IMAGE_BUILD because there is no
#    local Docker daemon; --external-kubeconfig targets the inner API and forces
#    the registry image refs + Always pull policy (values-inner).
SKIP_IMAGE_BUILD=1 mise run cluster:install \
  --external-kubeconfig="${INNER_KUBECONFIG:-$HOME/.kube/inner.yaml}"
```

`inner:build` builds `platform-base` first (the agent images do `FROM` it), then the core components and the enabled agent images. A single `mise run inner:build` is the whole rebuild step — it replaces the outer loop's `docker build` + `docker save` + image import with one push-to-registry per component.

To iterate on a single component, edit the source and re-run `mise run inner:build` (buildkit layer-caches unchanged stages), then re-run the `cluster:install` step to roll the deployment.

## Gotchas

- **apiserver restarts right after install** while it waits for postgres — this is a known startup race that self-heals. Give it a minute before treating it as a failure.
- **Inner UI login may bounce to the outer keycloak.** Known gap: the inner public URLs are not yet re-pointed at the inner ingress. The cluster is healthy even when browser login misbehaves; verify via pod/deployment status, not the login page.
- **Build plane choice is settled.** The inner buildkitd uses the OCI worker plus an in-cluster registry. The containerd-worker "build straight into the k3s image store" path is unsupported when buildkitd runs as a pod (the RUN executor fails on an empty rootfs). Do not try to switch it.
- **First-ever install** of a brand-new inner cluster also applies cert-manager and the Gateway API from github.com. A warm inner cluster already has these and the steps are skipped, so the steady-state loop only needs the inner API and buildkit.

## When something is unreachable

- `mise run inner:build` failing to connect → the inner buildkitd at `192.168.5.2:21234` is down or egress is blocked. `buildctl debug workers` (from the repo root) probes it.
- `cluster:install` failing to reach the API → the inner API at `192.168.5.2:26444` is down, or the kubeconfig is missing/points at the wrong server. The kubeconfig server must be `https://192.168.5.2:26444`.
