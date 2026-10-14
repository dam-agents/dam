# 04 — Codex and Pi reach their provider with addressed injection

**Part of:** Delegation works the same on every harness — see [README](./README.md)

## Context

Since new agents require named connections, the gateway injects a provider key only into a request whose placeholder names the connection.
The runtime gives every lease the provider's addressed placeholder, but two harnesses never send it, so their model calls get 401:

- **Codex.** Codex's `[oci.env]` set `OPENAI_API_KEY=dummy-placeholder`, and the build merges every harness's image env into the one default image.
  The runtime builds a harness's env as the lease env under the pod env, so the image value wins, for every harness.
- **Pi.** The provider extension reads `OPENAI_PROXY_API_KEY`, which no connection sets, and then a literal placeholder.
  Its model discovery sends no key at all.

Every new Codex or Pi agent, and every Codex or Pi sub-agent, fails this way; Claude Code and Bob do not.

## Implementation plan

1. Remove `OPENAI_API_KEY` from Codex's `[oci.env]`; Codex's launch scripts set the placeholder only when no provider sets it.
2. Pi's extension reads the connection's `OPENAI_API_KEY` before the literal, and its model discovery sends that key.
3. Codex's README states where the placeholder now comes from.

## Acceptance criteria

- [ ] A new Codex agent and a new Pi agent on Curve Bender, with named connections required, answer a prompt.
- [ ] A Codex and a Pi sub-agent report their result (check 3 of the README's smoke test).
- [ ] `mise run //packages/agents:check` and `mise run //packages/agents:test:pi-provider-selection` pass.

## Smoke test

Part of the whole-feature 4 × 4 run in the README, on a deployment with the rebuilt default image.
