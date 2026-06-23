# K-Search workload

LLM-driven GPU kernel optimization ([K-Search](https://github.com/caoshiyi/K-Search),
[paper](https://arxiv.org/abs/2602.19128)). Opening a terminal session runs a
kernel-optimization job out of the box.

## How it runs

Terminal-mode launches `ksearch-run`, which drives
`generate_kernels_and_eval.py` with the co-evolving world model enabled. Kernels
are benchmarked on **Modal cloud GPUs** by default, so no local GPU is required.

LLM calls use the OpenAI-compatible endpoint injected by DAM (`OPENAI_BASE_URL`,
`OPENAI_API_KEY`, `OPENAI_MODEL`) — i.e. the LiteLLM proxy.

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

Requirements:
- `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET` in the pod env (real values, via the
  Agent `SecretRef` — the modal client consumes them itself; no gateway injection).
- Gateway egress allow-rules for: `api.modal.com` (control plane) plus the blob
  hosts `storage.googleapis.com`, `*.r2.cloudflarestorage.com`, `*.amazonaws.com`.
