# 01 — Bedrock provider connection

**Part of:** AWS Bedrock as a model provider — see [README](./README.md)

## Context

Makes **AWS Bedrock** a provider a user can connect: the contract preset, the header
Connection template whose injection host follows the region, and every surface that lists
providers (Providers tab form and icon, CLI interactive create). After this slice a Bedrock
Connection can be created and granted; no harness runs on it yet.

## Implementation plan

1. **Contract** — `packages/api-server-api/src/modules/connections/providers.ts`:
   - Add `"bedrock"` to `ProviderPresetType` and a `bedrock` entry to `PROVIDERS`
     (`displayName: "AWS Bedrock"`, one mode `{ key: "api-key", label: "API Key",
     templateId: "bedrock" }`).
   - Export `bedrockRuntimeHost(region)` → `bedrock-runtime.${region}.amazonaws.com`,
     `BEDROCK_REGION_PATTERN` (AWS region ids, e.g. `us-east-1`, `eu-central-2`,
     `us-gov-west-1`), and `bedrockEnvMappings()` returning
     `AWS_BEARER_TOKEN_BEDROCK=dummy-placeholder` and `AWS_BEDROCK_FORCE_HTTP1=1`.
   - Re-export from `packages/api-server-api/src/index.ts` alongside the other provider
     helpers.
2. **Template** — `packages/api-server/src/modules/connections/domain/catalog.ts`: a
   `BEDROCK: HeaderConnectionTemplate` (`category: "app"`, `iconSlug: "bedrock"`, no static
   `host`, `headerName: "Authorization"`, `valueFormat: "Bearer {value}"`,
   `contributions: envContributions(bedrockEnvMappings())`) with `configInputs`:
   `region` → `AWS_REGION` (pattern `BEDROCK_REGION_PATTERN`, hint names an example) and
   `model` → `AWS_BEDROCK_MODEL` (hint: a model or inference-profile ID the key may invoke).
   Register it in `buildCatalog()`.
3. **Host from region** — `packages/api-server/src/modules/connections/domain/build-connection.ts`,
   `buildHeader`: for the `bedrock` template, derive the host from the validated `region`
   config input before the missing-host check (refuse a missing or malformed region with the
   input's label, as config inputs already do). The existing fallback then adds the single
   `egress-inject` on that host with the template's header and format.
4. **Providers tab** — `packages/ui/src/modules/providers/`:
   - `components/bedrock/form.tsx`, modeled on `bob/form.tsx` (key field plus config inputs):
     API key, Region (default `us-east-1`), Model (optional). Persist with
     `{ templateId: "bedrock", authKind: "header", value, configInputs: { region, model } }`.
   - Wire it into `components/provider-connect-dialog.tsx`, `lib/provider-rows.ts`, and the
     exhaustive maps in `components/card-icon.tsx` (add an icon; reuse an existing generic
     cloud/model glyph if no AWS asset is bundled — no third-party logo fetched at runtime).
5. **CLI** — `packages/cli/src/modules/agent/commands/create-interactive.ts`: the per-type
   prompt prompts for region and optional model for `bedrock`, mirroring Bob's config-input
   prompts.
6. **Docs** — `docs/architecture/connections.md`: an "App preset: AWS Bedrock" passage beside
   the LiteLLM one — Bearer API key on the region's runtime host, the region and model inputs,
   the placeholder env, and why SigV4 credentials are not accepted yet (the gateway injects a
   header; it does not sign). Bump `Last verified`.

## Acceptance criteria

- [ ] `mise run //packages/api-server-api:check`, `//packages/api-server:check`,
      `//packages/ui:check`, `//packages/cli:check` pass.
- [ ] Creating a `bedrock` Connection with region `eu-central-1` yields contributions: one
      `egress-inject` on `bedrock-runtime.eu-central-1.amazonaws.com` with
      `Authorization: Bearer {value}`, and env `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`,
      `AWS_BEDROCK_FORCE_HTTP1` (and `AWS_BEDROCK_MODEL` when a model was given).
- [ ] A missing or malformed region is refused before anything is persisted.
- [ ] AWS Bedrock appears on the Providers tab with its form, and in the CLI provider prompt.

## Smoke test

`mise run //packages/api-server:test` and `mise run //packages/ui:test` stay green. On the
local cluster installed from this branch: Providers tab → AWS Bedrock → create with a key and
region; the row reads active, and the Connection's Secret carries the injection-hosts
annotation for `bedrock-runtime.<region>.amazonaws.com` (read the annotation only — never the
Secret's data).
