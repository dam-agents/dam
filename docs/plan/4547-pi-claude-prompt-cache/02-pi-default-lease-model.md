# 02 — Pi starts when its lease names no model

**Part of:** Pi agents reuse the prompt cache on Claude models — see [README](./README.md)

Added during implementation at the user's request. The 01 smoke test found it on a fresh cluster.

## Context

`pi-platform` passes `--provider` whenever a provider env is set, and `--model` only from
`PLATFORM_MODEL`. Pi 1.0.4 refuses `--provider` without `--model` and exits, so ACP
`session/new` fails with "Cannot call write after a stream was destroyed". The runtime seeds a
model for every lease except the agent's default one (default harness, first provider, no
model), which it leaves to the harness's own defaults
([harness configuration](../../architecture/harness-config.md)). So every Pi session that
names no model fails: an agent with no remembered pair, and fires or channel turns on it.

## Implementation plan

In `pi-platform`, pick the provider and its pin env (`AWS_BEDROCK_MODEL`, `OPENAI_PROXY_MODEL`,
`RITS_MODEL`, `OPENAI_MODEL`) together. With no `PLATFORM_MODEL`, use the saved `defaultModel`
from `~/.pi/agent/settings.json` (the harness-config file; the file wins over a pin), else the
pin. Pass `--provider` only with a model. With no model at all, pass neither, as before #4565.
One sentence in the pi-agent README.

## Acceptance criteria

- [ ] A Pi session with no model pick on IBM LiteLLM starts and runs on the pin.
- [ ] A session that picks a model still runs on it.
- [ ] `mise run //packages/agents:test:pi-provider-selection` and `mise run check` pass.

## Smoke test

On the 01 smoke cluster, with the agent's lease naming no model (no remembered pair):
start a new session without picking a model, send a prompt, get a normal reply on
`aws/claude-opus-4-8`. Then a session that picks `azure/gpt-5.5` still runs on GPT.
