# 01 — Pi marks Claude prompts for caching

**Part of:** Pi agents reuse the prompt cache on Claude models — see [README](./README.md)

## Context

Pi's provider extension builds each `openai-proxy` model's compat flags and never sets
`cacheControlFormat`, so pi-ai sends no cache markers and Claude models behind IBM LiteLLM never
cache. This slice sets the flag for Claude models, documents it, and proves on the dev cluster
that markers on tool definitions and tool results pass LiteLLM and that an **old** Pi agent and
session get cache reads after the image update, with no migration. The README holds the why, the
scope and the risk.

## Implementation plan

Apply **/typescript-engineering** to the extension change.

### 1. Check the marker placements against IBM LiteLLM first

The issue's probe marked only the system prompt. pi-ai also marks the last tool definition and
the last message, which in a tool loop is a tool result. Prove LiteLLM takes both before you
change code; if it does not, the design changes (README, "Open risk").

- Use a running Pi agent on the IBM LiteLLM connection on the dev cluster, or create one
  (default model). The Mac must be on the IBM VPC, or LiteLLM answers 503.
- Find its pod with `mise run cluster:kubectl -- get pods -A` (bare `kubectl` hits the wrong
  cluster). The agent container has `node`, not `python3`.
- Write a small node script in the scratchpad and run it in the pod, e.g.
  `mise run cluster:kubectl -- exec -i <pod> -c <container> -- node --input-type=module - < probe.mjs`.
  It `fetch`es `https://ete-litellm.ai-models.vpc.res.ibm.com/v1/chat/completions` with
  `Authorization: Bearer dummy-placeholder`; the agent's gateway swaps in the real credential.
  Never read or print the pod's env.
- Request A, shaped the way pi-ai builds it (see `applyAnthropicCacheControl` in
  `@earendil-works/pi-ai/dist/api/openai-completions.js`): model `aws/claude-opus-4-8`,
  `max_completion_tokens`, a system message of ~20k tokens whose text part carries
  `cache_control: { type: "ephemeral" }`, a user message, an assistant message with one
  `tool_calls` entry, and a `tool` message whose content is `[{ type: "text", text, cache_control }]`.
  `tools` holds two function definitions; the last one carries `cache_control`.
- Request B extends A the way Pi's next call would: A's messages without the tool message's
  marker, plus a second assistant `tool_calls` message and a second `tool` message that carries the
  marker. LiteLLM serves identical requests from a response cache, so B must differ from A.
- Print only the HTTP status, an error body if not 200, the `x-litellm-response-cost` header, and
  `usage` (`prompt_tokens`, `prompt_tokens_details.cached_tokens`, `cache_creation_input_tokens`).
- Expected: both 200; B reports `cached_tokens` close to A's prompt size and a much lower cost.
- **If either request fails or B reads nothing from the cache, stop and report to the user.** Do
  not design a workaround alone. The likely fallback is to remove the rejected marker from the
  request body in `providerStreamFetch`.

### 2. Set the flag for Claude models

File:
[`packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts),
`buildModelConfig` (line ~322).

- Next to `responses`, derive whether the model is a Claude model on the proxy:
  `envPrefix === "OPENAI_PROXY" && /(^|\/)claude-/i.test(model.id)`, the same style as the `gpt-`
  checks there.
- In the returned `compat`, add `cacheControlFormat: "anthropic"` for those models only, before
  the `...compat` spread, as the RITS `maxTokensField` entry does. Use `as const` (or the existing
  conditional-spread pattern) so the literal type matches `OpenAICompletionsCompat`.
- Leave `cacheRetention`, `supportsLongCacheRetention` and every other flag alone. The 5-minute
  default is the intended lifetime.
- Comments: the function already has a `UNIT_BOUNDARY_DESCRIPTION`. If the new line needs a reason,
  add one clause there (the proxy caches a Claude prompt only when the request marks it); do not
  add a separate comment. Follow
  [comment guidelines](../../guidelines/comment-guidelines.md).

### 3. Update the docs

- [`packages/agents/pi-agent/README.md`](../../../packages/agents/pi-agent/README.md), the
  `pi-dynamic-providers` paragraph (line ~144): after the sentence on `max_completion_tokens` and
  streamed counts, add one sentence: on `openai-proxy`, requests to Claude models carry Anthropic
  cache markers, because the proxy caches a Claude prompt only when the request marks it; GPT
  models cache on their own.
- [`docs/architecture/connections.md`](../../architecture/connections.md), section
  "App preset: IBM LiteLLM proxy" (line ~204): add one durable sentence in domain words, no file
  or flag names, e.g. that the endpoint caches a Claude prompt only when the request marks it, so
  the image's Pi extension marks requests to Claude models, while GPT models cache on their own.
  Bump `Last verified:` to the commit date. The page is ~400 characters under its 40,000 cap, so
  keep the sentence short and run `mise run //docs:check:doc-size`.

### 4. Run the checks

- `mise run //packages/agents:check` and `mise run //packages/agents:test:pi-provider-selection`
  (the existing extension check and the provider-selection test; its model is a GPT model, so it
  must pass unchanged).
- `mise run check:comment-types`, then `mise run check`.

### 5. Build the image and smoke-test an old agent

Follow the Smoke test below. It must run on an agent and a session that existed **before** the
new image, to prove that no migration is needed.

## Acceptance criteria

- [ ] The direct probe (step 1) returns 200 for both requests, with markers on a tool definition
      and a tool result, and request B reports cached tokens. Its numbers go in the PR description.
- [ ] `buildModelConfig` sets `cacheControlFormat: "anthropic"` only for `openai-proxy` models
      whose id matches `(^|/)claude-`; GPT, Gemini, GLM and every `rits` model keep their compat.
- [ ] No migration, env change or connection change is part of the diff.
- [ ] The pi-agent README and the IBM LiteLLM section of `connections.md` each say, in one
      sentence, that Pi marks Claude prompts for caching; `Last verified:` is bumped.
- [ ] `mise run //packages/agents:check`, `mise run //packages/agents:test:pi-provider-selection`,
      `mise run check:comment-types`, `mise run //docs:check:doc-size` and `mise run check` pass.
- [ ] The smoke test below passes on an old Pi agent and an old session.

## Smoke test

Needs the dev cluster on the IBM VPC. See the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)
skill.

1. **Before the import:** pick (or create, then use once) a Pi agent on the IBM LiteLLM
   connection with the default model, and a chat session in it with at least one turn. Note
   their ids. Optional baseline: run the prompt from step 4 there and see `cacheRead: 0`.
2. **Build and import the image:** `mise run //packages/agents:oci -- pi-agent`, then
   `mise run cluster:import -- <tar>` with the tar path the build prints. Other sessions share
   the cluster: if one rebuilds `platform-pi-agent:latest` during your test, your import is gone
   (check the pod's image ID).
3. **Restart the old agent** so Pi starts on the new image: delete its pod (the StatefulSet
   recreates it), or stop and wake the agent. Prove the image carries the fix:
   `grep -c cacheControlFormat /usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts`
   in the pod gives 1 or more.
4. **Run a turn in the old session:** "Read `/etc/os-release`, then list `/home/agent`, then
   tell me the Debian version." The turn must call at least two tools and end with a normal
   reply, with no "Model request failed".
5. **Read the Pi session file** in the pod (under `~/.pi/agent/sessions/`, newest `.jsonl` of
   that session; `cat` it and parse on the host, or `grep -o '"cacheRead":[0-9]*'`). Expected:
   every assistant message after the turn's first call has `usage.cacheRead` > 0, close to the
   previous call's prompt size. The first call may show `cacheRead: 0` (it writes the cache).
6. **GPT is unchanged:** in a new session of the same agent, pick a GPT model (e.g. `gpt-5.5`)
   and run the same prompt. It completes with no error. GPT models use the Responses path,
   which this slice does not touch.

Then print a short manual guide so the user can repeat steps 3–5 by hand.
