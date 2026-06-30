# K-Search workload

LLM-driven GPU kernel optimization ([K-Search](https://github.com/caoshiyi/K-Search),
[paper](https://arxiv.org/abs/2602.19128)). Opening a terminal session runs a
kernel-optimization job out of the box.

## How it runs

Terminal-mode launches `ksearch-run`, which drives
`generate_kernels_and_eval.py` with the co-evolving world model enabled.

LLM calls use the OpenAI-compatible endpoint injected by DAM (`OPENAI_BASE_URL`,
`OPENAI_API_KEY`, `OPENAI_MODEL`) — i.e. the LiteLLM proxy.

KernelBench problems are read from the copy baked into the image
(`dataset_src=local`, patched at build time), not fetched from Hugging Face — so
the only egress an eval needs is the LLM endpoint. This keeps Hugging Face off
the platform-wide egress allowlist.

## Eval backend: Modal vs local GPU

Pick by selecting the workload at sandbox creation:

- **`k-search`** — kernels benchmarked on **Modal cloud GPUs** (`KSEARCH_EVAL_MODE=modal`);
  no in-cluster GPU needed. Requires the Modal connection.
- **`k-search-local`** — kernels benchmarked on an **in-cluster NVIDIA GPU**
  (`KSEARCH_EVAL_MODE=local`); the pod requests `nvidia.com/gpu` and schedules onto
  a GPU node. No Modal connection needed.

Both are the same image — only the eval backend (env) and GPU request differ.

> **Kata note:** agents run under a sandboxed Kata runtime. GPU passthrough
> needs a GPU-capable Kata runtime class (VFIO) distinct from the default agent
> class, so `k-search-local` sets `runtimeClassName` + `nodeSelector`
> per-template (the chart-wide class can't carry the GPU VM config for every
> agent). The operator fills in the cluster's actual GPU Kata class and GPU node
> label — see the `k-search-local` block in `deploy/helm/platform/values.yaml`.

## Configuration (env)

| Variable | Default | Notes |
|----------|---------|-------|
| `KSEARCH_TASK_SOURCE` | `kernelbench` | Only `kernelbench` supports Modal eval |
| `KSEARCH_EVAL_MODE` | `modal` | Switch to `local` on a GPU node |
| `KSEARCH_TARGET_GPU` | `H100` | Modal GPU type |
| `KSEARCH_KERNELBENCH_LEVEL` | `1` | KernelBench difficulty (1–4) |
| `KSEARCH_KERNELBENCH_PROBLEM_ID` | `1` | Problem within the level |
| `KSEARCH_MAX_OPT_ROUNDS` | `50` | Optimization rounds |
| `KSEARCH_LANGUAGE` | `triton` | `triton` or `cuda` |

## Modal through the DAM gateway

The modal client ignores `HTTPS_PROXY` on both its transports, so DAM's
proxy-only egress would drop it. `dam_modal_proxy_patch.py` (auto-loaded via a
`.pth`) fixes this: it teaches grpclib to CONNECT through the proxy and rebuilds
modal's aiohttp blob session with `trust_env=True`. All modal traffic then flows
through the gateway.

Requirements — supplied by the **Modal connection** granted to the agent:
- `MODAL_TOKEN_SECRET` — the secret; gateway-injected into the
  `x-modal-token-secret` header over the HTTP/2 chain (the pod env holds only a
  placeholder, never the real value).
- `MODAL_TOKEN_ID` — non-secret identifier, delivered as a plain pod env.
- Egress allow-rules for `api.modal.com` (control plane) plus the blob hosts
  `storage.googleapis.com` and `s3.amazonaws.com`.
