# 02 — Pi runs on Bedrock

**Depends on:** 01-bedrock-provider-connection
**Part of:** AWS Bedrock as a model provider — see [README](./README.md)

## Context

Makes Pi the first harness that runs on a Bedrock Connection: the Pi templates accept the
`bedrock` provider, and Pi picks its built-in `amazon-bedrock` provider with the pinned model
when the Connection's env is present.

## Implementation plan

1. **Compatibility** — `helm/values.yaml`: add `bedrock` to the pi-agent template's
   `providers` list and to the comment that enumerates the accepted provider types. Leave
   starter kits unchanged.
2. **Pi selects Bedrock** — `packages/agents/pi-agent/rootfs/app/working-dir/.pi/agent/extensions/pi-dynamic-providers/index.ts`:
   when `AWS_BEARER_TOKEN_BEDROCK` is set, write `settings.defaultProvider = "amazon-bedrock"`
   and, if `AWS_BEDROCK_MODEL` is set and `settings.defaultModel` is empty, the pinned model —
   the pin fills an empty slot only, never overrides a chosen model. If the pinned ID is not in
   Pi's built-in Bedrock model list, register it in `models.json` under `amazon-bedrock` with
   API `bedrock-converse-stream` so Pi accepts it. Make no network call at startup.
3. **Docs** — `packages/agents/pi-agent/README.md` (the Bedrock row: Bearer API key through the
   gateway, no in-pod SigV4) and `docs/architecture/harness-config.md` (a provider whose
   harness carries its own model list and no discovery source: the pin is the default; the
   dropdown stays empty until discovery covers it). Bump `Last verified`.

## Acceptance criteria

- [ ] `mise run //helm:check`, `//packages/agents:check` (or the Pi image's own check task)
      and `check:comment-types` pass.
- [ ] A Pi agent created with a Bedrock Connection answers a prompt against Bedrock.
- [ ] With a model chosen in the Config panel or hand-edited, the pin does not overwrite it.

## Smoke test

On the local cluster installed from this branch, run the README's whole-feature smoke test.
Then `mise run cluster:build -- agents`, restart the agent, and confirm it still answers with
the same model (the pin did not re-assert over the existing setting).
