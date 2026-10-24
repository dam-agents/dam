# K-Search workload

LLM-driven GPU kernel optimization ([K-Search](https://github.com/caoshiyi/K-Search), [paper](https://arxiv.org/abs/2602.19128)).
Opening a terminal session runs a kernel-optimization job out of the box.

## How it runs

Terminal-mode launches `ksearch-run`, which drives `generate_kernels_and_eval.py` with the co-evolving world model enabled.

LLM calls use the OpenAI-compatible endpoint injected by DAM (`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`) — i.e. the LiteLLM proxy.

KernelBench problems are read from the copy baked into the image (`dataset_src=local`, patched at build time), not fetched from Hugging Face — so the only egress an eval needs is the LLM endpoint.
This keeps Hugging Face off the platform-wide egress allowlist.

## Eval backend: Modal vs local GPU

Pick by selecting the workload at sandbox creation:

- **`k-search`** — kernels benchmarked on **Modal cloud GPUs** (`KSEARCH_EVAL_MODE=modal`); no in-cluster GPU needed.
  Requires the Modal connection.
- **`k-search-local`** — kernels benchmarked on an in-cluster NVIDIA GPU (`KSEARCH_EVAL_MODE=local`); no Modal connection needed.

Both are the same image — only the eval backend (env) differs.

> **GPU note:** `k-search-local` is not offered on the platform: the template no longer sets a runtime class or a node selector, and a machine's spec forwards no GPU device to its guest, so GPU passthrough is not available to one today.

## Configuration (env)

| Variable                         | Default       | Notes                                  |
| -------------------------------- | ------------- | -------------------------------------- |
| `KSEARCH_TASK_SOURCE`            | `kernelbench` | Only `kernelbench` supports Modal eval |
| `KSEARCH_EVAL_MODE`              | `modal`       | Switch to `local` on a GPU             |
| `KSEARCH_TARGET_GPU`             | `H100`        | Modal GPU type                         |
| `KSEARCH_KERNELBENCH_LEVEL`      | `1`           | KernelBench difficulty (1–4)           |
| `KSEARCH_KERNELBENCH_PROBLEM_ID` | `1`           | Problem within the level               |
| `KSEARCH_MAX_OPT_ROUNDS`         | `50`          | Optimization rounds                    |
| `KSEARCH_LANGUAGE`               | `triton`      | `triton` or `cuda`                     |

## Modal through the DAM gateway

DAM's egress is proxy-only.
The modal client is installed with its `api-proxy-support` extra, so both its transports, gRPC and the aiohttp blob session, CONNECT through `HTTPS_PROXY`.
All modal traffic then flows through the gateway.

Requirements — supplied by the **Modal connection** granted to the agent:

- `MODAL_TOKEN_SECRET` — the secret; gateway-injected into the `x-modal-token-secret` header over the HTTP/2 chain (the agent's env holds only a placeholder, never the real value).
- `MODAL_TOKEN_ID` — non-secret identifier, delivered as plain env.
- Egress allow-rules for `api.modal.com` (control plane) plus the blob hosts `storage.googleapis.com` and `s3.amazonaws.com`.
