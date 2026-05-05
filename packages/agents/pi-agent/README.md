# Pi Agent

Platform agent running [pi coding agent](https://github.com/badlogic/pi-mono) with persistent cross-session memory.

## Stack

| Component | Package | Purpose |
|---|---|---|
| Harness | `@mariozechner/pi-coding-agent` + `pi-acp` | pi runtime + ACP bridge to Platform UI |
| Memory | `@zhafron/pi-memory` | git-free file-based memory, auto-injected at session start |

Default model: `openai / gpt-5.4-mini`. Change in `workspace/.pi/agent/settings.json`.

## File layout

```
workspace/
  .pi/agent/
    settings.json        ← pi config (→ ~/.pi/agent/)
  work/
    .pi/
      APPEND_SYSTEM.md   ← appended to the system prompt (project-scoped)
  .pi/agent/extensions/pi-rits/
    index.ts             ← auto-discovered by pi on startup; registers the RITS provider from env vars
```

## Providers and models

Pi natively supports a long list of API-key providers (OpenAI, Mistral, Groq, DeepSeek, Cerebras, xAI, OpenRouter, Gemini, Fireworks, Hugging Face, ZAI, MiniMax, …) plus any OpenAI-Completions / OpenAI-Responses / Anthropic-Messages / Google-Generative-AI compatible endpoint via [`models.json`](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) or [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md). Authoritative reference: [pi providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md) for env-var names, auth-file shape, and resolution order; [pi models](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md) for the `models.json` schema and `compat` flags.

On the platform the actual credential never lives in pod env. The pod carries a placeholder; the in-pod Envoy sidecar terminates outbound TLS and rewrites the auth header using a [generic secret](../../../docs/architecture/security-and-credentials.md) ([ADR-033](../../../docs/adrs/033-envoy-credential-gateway.md)) scoped to the provider's host. The flow is the same for every provider — only the host pattern and (occasionally) the injection header change.

### Built-in API-key providers

Three steps to enable any pi built-in provider:

1. **Set the provider's env var to a non-empty placeholder** so pi's [credential resolution](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#resolution-order) recognizes the provider. Add to `Dockerfile`, the agent template, or per-instance via the Configure Agent UI:

   ```dockerfile
   ENV OPENAI_API_KEY=dummy-placeholder
   ```

   The literal value pi sends on the wire is rewritten by the Envoy sidecar before the request leaves the pod.

2. **Create a generic secret on the platform** scoped to the provider's host. The default injection (`Authorization: Bearer {value}`) is correct for almost every provider in the table below. Override `injectionConfig.headerName` (and optionally `valueFormat`) only for providers that deviate (`x-api-key`, `RITS_API_KEY`, `Token {value}`, …).

3. **Select the model** in [`settings.json`](workspace/.pi/agent/settings.json) (`defaultProvider` / `defaultModel`) or via `/model` at session start.

#### Provider env vars and host patterns

Sourced from pi-mono [`env-api-keys.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/env-api-keys.ts) and [`models.generated.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/models.generated.ts) — pi's resolution order is documented in [providers.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#resolution-order).

| Provider | pi `provider` id | Env var(s) (placeholder in pod, real value in K8s Secret mounted into the Envoy sidecar) | Host pattern |
|---|---|---|---|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` (or `ANTHROPIC_OAUTH_TOKEN`) | `api.anthropic.com` |
| OpenAI | `openai` | `OPENAI_API_KEY` | `api.openai.com` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `api.deepseek.com` |
| Mistral | `mistral` | `MISTRAL_API_KEY` | `api.mistral.ai` |
| Groq | `groq` | `GROQ_API_KEY` | `api.groq.com` |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | `api.cerebras.ai` |
| xAI | `xai` | `XAI_API_KEY` | `api.x.ai` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `openrouter.ai` |
| Vercel AI Gateway | `vercel-ai-gateway` | `AI_GATEWAY_API_KEY` | `ai-gateway.vercel.sh` |
| ZAI | `zai` | `ZAI_API_KEY` | `api.z.ai` |
| Google Gemini (AI Studio) | `google` | `GEMINI_API_KEY` | `generativelanguage.googleapis.com` |
| Hugging Face | `huggingface` | `HF_TOKEN` | `router.huggingface.co` |
| Fireworks | `fireworks` | `FIREWORKS_API_KEY` | `api.fireworks.ai` |
| OpenCode Zen | `opencode` | `OPENCODE_API_KEY` | `opencode.ai` (path `/zen/`) |
| OpenCode Go | `opencode-go` | `OPENCODE_API_KEY` | `opencode.ai` (path `/zen/go/`) |
| Kimi For Coding | `kimi-coding` | `KIMI_API_KEY` | `api.kimi.com` (path `/coding/`) |
| MiniMax | `minimax` | `MINIMAX_API_KEY` | `api.minimax.io` |
| MiniMax (China) | `minimax-cn` | `MINIMAX_CN_API_KEY` | `api.minimaxi.com` |

> **Anthropic — prefer the dedicated provider.** Platform ships a first-class Anthropic provider that handles the OAuth-vs-API-key shape and is wired into the Configure Agent UI as the *Anthropic secret* type. The plain env-var path above does work, but the dedicated provider is the recommended way and the tRPC router rejects `hostPattern` / `pathPattern` / `injectionConfig` on Anthropic secrets to keep the two paths from drifting.

> When two providers share a host (OpenCode Zen vs Go) or a single host serves several pi providers, scope the secret with `pathPattern` ([ADR-028](../../../docs/adrs/028-generic-secret-injection-config.md)) so each credential matches only its own sub-path.

#### Other providers (env vars from pi-mono; Platform integration not validated end-to-end)

These providers have additional configuration shapes (per-resource URLs, AWS credential chain, OAuth, SA-key files). The env vars below are what pi-mono reads; whether they compose cleanly with the Envoy sidecar's wire-level header rewrite hasn't been verified for each — confirm before relying on them in production.

| Provider | pi `provider` id | Auth env vars | Notes |
|---|---|---|---|
| Azure OpenAI Responses | `azure-openai-responses` | `AZURE_OPENAI_API_KEY` plus `AZURE_OPENAI_BASE_URL` (or `AZURE_OPENAI_RESOURCE_NAME`), optional `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT_NAME_MAP` | Host is your Azure resource (e.g. `<resource>.openai.azure.com`). Should work with the placeholder-env + generic-secret pattern, but not validated. |
| Amazon Bedrock | `amazon-bedrock` | One of: `AWS_PROFILE`; `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`; `AWS_BEARER_TOKEN_BEDROCK`; `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` / `_FULL_URI`; `AWS_WEB_IDENTITY_TOKEN_FILE`. Optional: `AWS_REGION`, `AWS_BEDROCK_FORCE_CACHE`, `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`, `AWS_BEDROCK_SKIP_AUTH`, `AWS_BEDROCK_FORCE_HTTP1` | Host: `bedrock-runtime.<region>.amazonaws.com`. AWS SigV4 is computed in-pod against the secret access key, so a generic-secret header rewrite would break the signature — likely needs the real credential mounted, not sidecar-injected. Untested. |
| Google Vertex AI | `google-vertex` | `GOOGLE_CLOUD_API_KEY` **or** `GOOGLE_APPLICATION_CREDENTIALS` (SA key file) **or** ADC + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` | Host: `<location>-aiplatform.googleapis.com`. The API-key path may work with a generic secret; SA-key / ADC paths require a file mount and aren't a generic-secret shape. Untested. |
| GitHub Copilot | `github-copilot` | `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_TOKEN` | Host: `api.individual.githubcopilot.com`. pi's documented path is OAuth via `/login`, with tokens stored in `~/.pi/agent/auth.json`. Untested with a generic secret. |
| OpenAI Codex (ChatGPT) | (Codex Responses) | OAuth via `/login` — no env var | Host: `chatgpt.com/backend-api`. ChatGPT subscription only; not appropriate for production. |
| Google Gemini CLI / Antigravity | `google-gemini-cli` | OAuth via `/login`, optional `GOOGLE_CLOUD_PROJECT` for paid Cloud Code Assist | Hosts: `cloudcode-pa.googleapis.com`, `daily-cloudcode-pa.sandbox.googleapis.com`. Untested. |

### Custom OpenAI-compatible servers (models.json)

For self-hosted vLLM / Ollama / LM Studio / internal proxies that aren't in pi's built-in list, register the provider in `~/.pi/agent/models.json` (seed via `workspace/.pi/agent/models.json`):

```json
{
  "providers": {
    "internal-vllm": {
      "baseUrl": "https://vllm.internal.example.com/v1",
      "api": "openai-completions",
      "apiKey": "dummy-placeholder",
      "authHeader": true,
      "models": [{ "id": "qwen2.5-coder-32b" }]
    }
  }
}
```

Then create a generic secret on the platform with `hostPattern: vllm.internal.example.com` and the default Bearer injection. The literal `apiKey` is a placeholder satisfying [pi-acp's per-session auth gate](#pi-acp-auth-gate-workarounds-15); the Envoy sidecar rewrites the header on the wire. The full `models.json` schema (`compat`, `reasoning`, `contextWindow`, `thinkingFormat`, `headers`, `modelOverrides`) is in [pi models.md](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md).

For non-Bearer auth, override `injectionConfig` on the secret instead of changing `models.json`:

| Provider style | `injectionConfig.headerName` | `injectionConfig.valueFormat` |
|---|---|---|
| OpenAI-compatible (default) | `Authorization` (default) | `Bearer {value}` (default) |
| Anthropic-compatible proxy | `x-api-key` | `{value}` |
| Portkey | `x-portkey-api-key` | `{value}` |
| RITS | `RITS_API_KEY` | `{value}` |

### RITS (custom provider via extension)

The [`pi-rits`](workspace/.pi/agent/extensions/pi-rits/index.ts) extension is auto-discovered by pi from `~/.pi/agent/extensions/`. It registers a `rits` provider tuned for vLLM (what RITS runs) and mirrors the config into `~/.pi/agent/models.json`. Use an extension instead of a static `models.json` entry when provider knobs need to be derived from env vars at pod start.

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `RITS_URL` | yes | — | Endpoint URL; `/v1` is appended if missing. |
| `RITS_MODEL` | yes | — | Model identifier. |
| `RITS_REASONING` | no | `false` | Enable pi's thinking UI for reasoning-capable models. |
| `RITS_CONTEXT_WINDOW` | no | `128000` | Context window in tokens. |
| `RITS_MAX_TOKENS` | no | `16384` | Max output tokens. |
| `RITS_THINKING_FORMAT` | no | — | `qwen`, `qwen-chat-template`, `zai`, `reasoning_effort`, or `openrouter` — request-body hint for servers with a matching reasoning parser. |

The API key is **not** a pod env var. Configure it as a generic secret on the platform with `injectionConfig.headerName: RITS_API_KEY`, `injectionConfig.valueFormat: {value}`, and a host pattern matching your RITS deployment. The Envoy sidecar injects the header on outbound traffic at the proxy layer.

To make RITS the default model, edit `settings.json`:

```json
"defaultProvider": "rits",
"defaultModel": "<value of RITS_MODEL>"
```

### pi-acp auth-gate workarounds ([#15](https://github.com/svkozak/pi-acp/issues/15))

1. *Startup gate* — `pi-acp` refuses to spawn `pi` unless a recognized credential exists. Satisfied by the dummy `ENV OPENCODE_API_KEY=pi-acp-auth-gate-bypass` in the Dockerfile (allow-listed name, unused by any pi provider).
2. *Per-session gate* — `pi-acp` re-checks `models.json.providers[*].apiKey` on every `session/prompt`. Satisfied by either (a) the placeholder env var for built-in providers, (b) the placeholder `apiKey` in `models.json` for custom OpenAI-compatible servers, or (c) the extension mirroring its `registerProvider` config to `models.json` on load. In every case the `apiKey` is a placeholder; the real credential is sidecar-injected on the wire.

Pi system prompt conventions:

| File | Scope | Behaviour |
|---|---|---|
| `~/.pi/agent/SYSTEM.md` | global | replaces the default system prompt |
| `.pi/SYSTEM.md` | project (cwd) | replaces the default system prompt |
| `~/.pi/agent/APPEND_SYSTEM.md` | global | appended to the system prompt |
| `.pi/APPEND_SYSTEM.md` | project (cwd) | appended to the system prompt |

> **`workspace/`** seeds `/home/agent/` on first boot.  
> **`workspace/work/`** seeds `/home/agent/work/` — the cwd where pi-acp spawns.  
> **`workspace/.pi/agent/`** seeds `~/.pi/agent/` — pi's global config directory.

## Memory scopes

Memory lives on the PVC (`/home/agent/` is the persistent mount), so everything survives restarts. The two scopes:

| Scope | Path | What goes here |
|---|---|---|
| **Personal** (global) | `~/.pi/agent/memory/` | Identity, user profile, preferences — facts about the user, not about a project |
| **Project** (future) | `work/memory/` | Per-workspace context: tech stack, architecture decisions, repo-specific facts |

`@zhafron/pi-memory` uses the personal scope by default (`memoryDir: ~/.pi/agent/memory`). Project-scope memory is not yet implemented.

### Memory files (personal scope)

| File | Auto-injected | Purpose |
|---|---|---|
| `MEMORY.md` | yes | Durable facts, decisions, preferences |
| `IDENTITY.md` | yes | Agent name, persona, behavioral rules |
| `USER.md` | yes | User profile (name, role, preferences) |
| `daily/YYYY-MM-DD.md` | no | Daily activity log (read via `memory` tool) |

### First-run bootstrap

On first session, `@zhafron/pi-memory` seeds all four files with empty templates and a `BOOTSTRAP.md` interview script. The agent asks the user questions, overwrites the templates with real content, then deletes `BOOTSTRAP.md`. Normal memory injection resumes from the next session onward.

### Memory tool

```
memory --action read    --target memory|identity|user|daily [--date YYYY-MM-DD]
memory --action write   --target memory|identity|user|daily --content "..." [--mode append|overwrite]
memory --action search  --query "..."
memory --action list
```

## Usage

```sh
mise run cluster:install        # first time
mise run cluster:build-agent    # rebuild after changes
```

Create an agent from the **pi-agent** template in the Platform UI, open a session, and the bootstrap flow runs automatically.

## Upgrading existing instances

The init seeder runs once (guarded by `/home/agent/.initialized`). After an image rebuild, existing instances won't pick up workspace changes automatically. Options:

- Create a fresh instance (gets the new seed)
- Delete `.initialized` on the pod and restart: `mise run cluster:shell -- rm /home/agent/.initialized`
