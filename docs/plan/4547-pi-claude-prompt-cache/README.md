# Pi agents reuse the prompt cache on Claude models

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4547

## Goal

A Pi agent on the IBM LiteLLM connection runs on a Claude model by default. Today every model
call it makes reports 0 cached tokens, so each call resends the whole conversation at full input
price. A turn with tool use makes several calls, and each one pays again for 20k+ tokens.

After this change, repeat calls in a Pi session read the cached conversation, as Claude Code's
calls do. Most input tokens are billed as cache reads (about a tenth of the full price, per the
probe in the issue), and cached calls return faster. GPT, Gemini and open models do not change:
they cache on their own or do not take the markers.

## Approach

**Why Pi gets no cache today.** Claude models cache only when the request marks what to cache.
Pi talks to `openai-proxy` models over OpenAI Chat Completions. pi-ai 1.0.4 (the version the image
pins) can add Anthropic-style `cache_control` markers to such a request: the model's compat flag
`cacheControlFormat: "anthropic"` makes it mark the system prompt, the last tool definition and the
last user, assistant or tool-result text. pi-ai turns that flag on by itself only for OpenRouter
`anthropic/*` models. Our provider extension
[`pi-dynamic-providers`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/extensions/pi-dynamic-providers/index.ts)
builds each model's compat in `buildModelConfig` and never sets it. Codex and Pi on GPT models
cache automatically; Claude Code adds the markers itself.

**The fix.** `buildModelConfig` sets `cacheControlFormat: "anthropic"` for `openai-proxy` models
whose id names a Claude model. It uses the same id-pattern style as the existing `gpt-` check
(`/(^|\/)claude-/i`, which matches IBM LiteLLM's `aws/claude-opus-4-8`). Everything else in the
model config stays as it is. `rits` (vLLM) does not change.

**Where it applies.** Two connection types set `OPENAI_PROXY_URL`, and both are LiteLLM proxies:
IBM LiteLLM and Curve Bender ([connections](../../architecture/connections.md)). Any Claude model
either one lists gets the markers. The flag follows the model, so a session that switches to a
Claude model in Pi's picker gets the markers too.

**Cache lifetime.** pi-ai's default is the 5-minute cache (`cacheRetention: "short"`). Nothing sets
`PI_CACHE_RETENTION=long`, so no 1-hour TTL goes out. The first call in each cache window costs
about 25% more because it writes the cache. The first repeat within 5 minutes pays that back, and
agents almost always make one.

**Pi's cache warmer stays off.** pi-coding-agent 1.0.4 has a cache warmer that re-sends a request
to keep a cache entry alive. It needs the model's `promptCache` TTL and an expected saving of at
least $0.05. Our models set no `promptCache` and have cost 0, so it never fires.

**No migration.** The extension ships at an image-owned path, and Pi loads it from there on every
start ([agent images](../../architecture/agent-images.md)). It derives the flag from the model id
at each start and rewrites `~/.pi/agent/models.json` each time. Nothing is stored in the agent's
home, the connection or the database. Old agents get the fix when they take the new image through
the normal agent update ([agent lifecycle](../../architecture/agent-lifecycle.md)): a running agent
restarts, a hibernated one takes it on its next wake. An agent that skips the update keeps paying
full price. Old sessions get it too: the first call after the restart writes the cache.

**Open risk the issue names.** The issue's probe marked only the system prompt. Here the markers
also go on the last tool definition and on a tool result. IBM LiteLLM must accept both. The slice
checks this with a direct request before it builds the image. If LiteLLM rejects either marker,
the implementer stops and asks the user. The likely fallback is to remove the rejected marker from
the request body in the extension's own `fetch` wrapper (`providerStreamFetch`), which already
sees every request.

**Out of scope.** A 1-hour cache option or a Pi session setting for the cache TTL (Claude Code has
one, see [harness configuration](../../architecture/harness-config.md)). Bob has the same gap; it
gets its own issue.

## Conventions & glossary

- **Cache markers**: Anthropic `cache_control: { type: "ephemeral" }` fields in the request.
  LiteLLM translates them for the Claude backend.
- **Cache read / cache write**: pi-ai reports them per assistant message as `usage.cacheRead`
  (from `prompt_tokens_details.cached_tokens`) and `usage.cacheWrite`. LiteLLM may not report
  writes in a field pi-ai reads, so `cacheWrite` can stay 0. `cacheRead` is the signal.
- Apply **/typescript-engineering** when changing the extension (server-side TS). The change is
  small; the skill's rules on naming and keeping logic in one place are the ones that matter.
- Follow [comment guidelines](../../guidelines/comment-guidelines.md). Comment sparingly; run
  `mise run check:comment-types` after the change.
- **No new tests.** Verification is the existing suite plus the manual smoke test below.
- **Production secrets rule (AGENTS.md):** on the dev cluster too, read only the session file and
  logs. Never print the pod's env.

## Whole-feature smoke test

The feature is one sub-issue, so its smoke test in
[01-pi-claude-prompt-cache.md](./01-pi-claude-prompt-cache.md) is the whole-feature test. In short:

1. A direct request from an agent pod with markers on a tool definition and a tool result passes
   IBM LiteLLM, and its repeat reports cached tokens.
2. After the new Pi image is imported, an **old** Pi agent on IBM LiteLLM restarts, and an **old**
   session of it runs a turn that calls a tool twice. Its Pi session file shows `cacheRead > 0` on
   every call after the first, and the chat shows no "Model request failed".
3. A Pi session on a GPT model on the same connection still works.

The dev cluster reaches IBM LiteLLM only from the IBM VPC.

## Delivery

Two atomic commits, one per slice:

- [x] [01 — Pi marks Claude prompts for caching](./01-pi-claude-prompt-cache.md)
- [x] [02 — Pi starts when its lease names no model](./02-pi-default-lease-model.md) (added during implementation)

The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/4547.
