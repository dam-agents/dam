---
name: platform-models
description: >-
  Reach LLM providers from this platform pod: discover which model-provider
  connection is attached (injected env), wire LiteLLM with placeholder
  credentials through the egress credential gateway, and probe models with a
  cheap completion. Use whenever any code in this pod — a GEPA driver, a
  script, a library — needs to call a model API, or when a model call fails
  with an auth error.
---

# Platform model access — discover → wire → probe

This pod holds **no real model credentials**. The attached model-provider
connection injects **placeholder** env; the egress gateway swaps in the real
credential **on the wire**, keyed by destination host + header. Which
provider is reachable is decided by that connection — never hard-code one.

All examples use `litellm.completion` directly, so they work in any pod with
LiteLLM installed. (In a GEPA pod, `gepa.lm.LM` is a thin wrapper over the
same call — every `model`/`api_base`/`api_key` shown below can be passed to
`LM(...)` unchanged.)

## How auth actually works here (read this before wiring)

The gateway's credential injector runs with **`overwrite: true`** — it
replaces the auth header's value **whatever you send**. You only have to make
the client *send the header at all*. Two consequences:

- The injected key env is often an **empty string or a dummy sentinel** — that
  is expected, not a misconfiguration. An env var present-but-empty still
  means "this provider is available."
- LiteLLM refuses to send a request with an empty API key, so **always pass a
  non-empty placeholder** (`"placeholder"`) when the injected value is empty.
  Its value is irrelevant — the gateway overwrites it — but its presence is
  what makes LiteLLM dispatch the request so injection can happen.

**Never hand-roll raw HTTP calls to a model API** (`httpx`/`requests` against
`/v1/messages` etc.). If LiteLLM seems not to authenticate, the fix is the
placeholder-key rule above — a raw-HTTP shim is provider-specific, brittle,
and throws away retries and cost tracking. And never bypass the egress proxy —
it is what injects the credential and authorizes the destination.

## 1. Discover what the connection injected

Present-but-empty counts as present:

```sh
env | grep -iE '(_API_KEY|_BASE_URL)=' | sed -E 's/=.*/=<set>/'
```

## 2. Wire LiteLLM from what's actually there (first match wins)

The `key or "placeholder"` idiom is the load-bearing part.

- **`OPENAI_BASE_URL` (± `OPENAI_API_KEY`)** — an OpenAI-compatible endpoint
  (a LiteLLM-proxy-class connection, or OpenAI itself). Use
  `openai/<model-id>` strings with an explicit `api_base`/`api_key`, and try
  the catalog first (it may 503/401 behind some proxies — fall back to the
  probe then):

  ```sh
  base="${OPENAI_BASE_URL%/}"; base="${base%/v1}"
  curl -fsS "$base/v1/models" \
    -H "Authorization: Bearer ${OPENAI_API_KEY:-placeholder}" | jq -r '.data[].id'
  ```

  ```python
  import os

  base = os.environ["OPENAI_BASE_URL"].rstrip("/")
  if not base.endswith("/v1"):
      base += "/v1"
  key = os.environ.get("OPENAI_API_KEY") or "placeholder"  # gateway overwrites it

  model = f"openai/{MODEL_ID}"
  lm_kwargs = {"api_base": base, "api_key": key}   # pass alongside model everywhere
  ```

- **A vendor key var LiteLLM natively reads** (`ANTHROPIC_API_KEY`,
  `GEMINI_API_KEY`, `MISTRAL_API_KEY`, …) — use that vendor's LiteLLM prefix
  and pass a non-empty placeholder `api_key` (the env value is a placeholder
  and may be empty; the gateway injects the real key on `api.<vendor>.com`):

  ```python
  import os

  key = os.environ.get("ANTHROPIC_API_KEY") or "placeholder"  # gateway overwrites it
  model = f"anthropic/{MODEL_ID}"
  lm_kwargs = {"api_key": key}
  ```

  There's no catalog endpoint to list here — take the model ids from the
  user or the vendor's current model lineup, then rely on the probe below.

- **Neither** → stop and tell the user to attach a model-provider connection
  (see `AGENTS.md`). Never invent a provider the env doesn't support and
  never ask for a literal key.

## 3. Probe before relying on a model

A cheap completion is the provider-neutral validation gate (a catalog listing
alone can't confirm a completion works, and the probe confirms the
placeholder-key wiring reaches the gateway):

```python
import litellm

resp = litellm.completion(
    model=model,
    messages=[{"role": "user", "content": "Reply with exactly: OK"}],
    max_tokens=10,
    **lm_kwargs,
)
print(model, "->", resp.choices[0].message.content[:40])
```

Triage:

- **Auth error** → the wiring is wrong (wrong provider prefix for the
  injected host, or a missing placeholder key) — fix the wiring; do **not**
  drop to a raw HTTP client.
- **Rate-limit / model-not-found** → that model id isn't provisioned on this
  connection — pick another from discovery, or ask the user.

## Experiment trackers

Leave integrations like `wandb` / `mlflow` off — they'd reach services this
pod has no credentials for.
