# 03 — Bedrock model discovery

**Depends on:** 02-pi-runs-on-bedrock
**Part of:** AWS Bedrock as a model provider — see [README](./README.md)

## Context

Lets the UI and Pi offer only models that Bedrock can actually invoke for the connection's
region, and lets the platform seed one when nothing is pinned. Bedrock's inference-profile
listing is the source; it travels the same credential-injecting path as inference, on the
region's control-plane host.

## Implementation plan

1. **Contract** — `packages/api-server-api/src/modules/connections/providers.ts`: add
   `bedrockControlHost(region)` → `bedrock.${region}.amazonaws.com`; export it.
2. **Connection** — `packages/api-server/src/modules/connections/domain/build-connection.ts`,
   the `bedrock` hook in `buildHeader`: besides the runtime host, push an `egress-inject` on
   `bedrockControlHost(region)` with the same header and format, and an `env` contribution
   `AWS_ENDPOINT_URL_BEDROCK=https://bedrock.<region>.amazonaws.com` (the AWS SDK's own name
   for the control-plane endpoint, which Pi's runtime client never reads).
3. **Discovery sources** — `packages/agent-runtime/src/modules/runtime-channel/manifest.ts`:
   `shape` gains `"bedrock-inference-profiles"`; `harnessConfigBinding.modelDiscovery`
   accepts one spec or a non-empty list of specs (first spec with a set `urlEnv` wins, as the
   env order does today). `infrastructure/model-discovery.ts`: accept a spec or a list; per
   shape, read the list under its key (`data` for the existing shapes,
   `inferenceProfileSummaries` for Bedrock) and the id (`inferenceProfileId`, only entries
   with `status: "ACTIVE"`). `drivers/harness-config-plugin.ts`: pin and redirect checks look
   across all sources. Existing tests keep passing because a single spec is still accepted.
4. **Pi manifest** — `packages/agents/pi-agent/rootfs/app/runtime-manifest.yaml`:
   `modelDiscovery` becomes a list; the second entry is
   `{ urlEnv: [AWS_ENDPOINT_URL_BEDROCK], redirectEnv: [AWS_ENDPOINT_URL_BEDROCK],
   pinEnv: [AWS_BEDROCK_MODEL], path: "/inference-profiles?maxResults=1000",
   shape: bedrock-inference-profiles }`.
5. **Pi's own picker** — `pi-dynamic-providers/index.ts`: when `AWS_ENDPOINT_URL_BEDROCK` is
   set, GET the same listing (bounded timeout, through the gateway); on success, re-register
   `amazon-bedrock` from `builtinProviders()` (via the aliased `@earendil-works/pi-ai/providers/all`)
   with `getModels` narrowed to the ACTIVE profile IDs plus the pinned or kept model; on any
   failure keep Pi's built-in list and warn.
6. **Docs** — `docs/architecture/harness-config.md`: replace the "no discovery source"
   paragraph with Bedrock as a second source whose dialect is the inference-profile listing,
   and note that account access is not knowable from a listing. `connections.md` Bedrock
   passage: the second host and the endpoint variable. Pi README row. Bump `Last verified`.

## Acceptance criteria

- [ ] `mise run //packages/agent-runtime:check` and `:test`, `//packages/api-server:check`
      and `:test`, `//packages/api-server-api:check` pass; the existing discovery tests are
      untouched.
- [ ] A `bedrock` connection built with region `eu-central-1` carries injections on both
      `bedrock-runtime.eu-central-1.amazonaws.com` and `bedrock.eu-central-1.amazonaws.com`
      and env `AWS_ENDPOINT_URL_BEDROCK=https://bedrock.eu-central-1.amazonaws.com`.
- [ ] The discovery fetcher, fed a Bedrock listing fixture, returns the ACTIVE profile IDs
      sorted and drops inactive ones.
- [ ] On the cluster, a Pi agent on the Bedrock connection shows the region's profiles in the
      Config panel's model dropdown, and `/model` inside Pi lists the same set.

## Smoke test

`mise run //packages/agent-runtime:test` and `//packages/api-server:test` stay green. On the
cluster installed from this branch, re-create the Bedrock connection (so it carries the new
host), create a Pi agent on it with no model pinned: it answers its first prompt with the
seeded profile, and the Config panel lists the region's profiles.
