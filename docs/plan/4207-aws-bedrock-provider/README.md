# AWS Bedrock as a model provider

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4207

## Goal

A user whose models live in AWS Bedrock can add **AWS Bedrock** on the Providers tab with a
Bedrock API key, a region and a model ID, pick it as an agent's provider, and run a Pi agent
against Bedrock-hosted models. The platform holds the key; the agent only ever sees a
placeholder.

## Approach

Bedrock API keys authenticate as `Authorization: Bearer <key>` on both the Bedrock and Bedrock
Runtime APIs, so the first version needs **no gateway or controller change**: Bedrock is a
**header Connection** like OpenAI, and the existing Envoy `credential_injector` overwrites the
`Authorization` header on the region's runtime host
([security-and-credentials](../../architecture/security-and-credentials.md#envoy-credential-injection),
[connections](../../architecture/connections.md)).

- **Provider preset** `bedrock` in the contract's provider registry, one mode (`api-key`),
  template id `bedrock`.
- **Connection template** `bedrock` (header auth, `Bearer {value}`) with two config inputs:
  `region` (required, AWS region pattern, projects to `AWS_REGION`) and `model` (optional,
  projects to the model pin `AWS_BEDROCK_MODEL`). The template has no static host: the
  injection host `bedrock-runtime.<region>.amazonaws.com` is derived from the region at build
  time, the same per-template hook shape `github-enterprise-pat` and Kubernetes use in
  `buildHeader`.
- **Env the agent sees:** `AWS_BEARER_TOKEN_BEDROCK=dummy-placeholder` (the gateway replaces
  the header it produces), `AWS_REGION`, `AWS_BEDROCK_MODEL` when pinned, and
  `AWS_BEDROCK_FORCE_HTTP1=1` — Pi's Bedrock client defaults to HTTP/2 unless a proxy env
  applies, and the gateway's credential chains are HTTP/1.1 by default.
- **Pi** (`@earendil-works/pi-ai` 0.99.2) already ships provider `amazon-bedrock`
  (API `bedrock-converse-stream`); with `AWS_BEARER_TOKEN_BEDROCK` set it sends
  `Authorization: Bearer` instead of SigV4 and reads the region from `AWS_REGION`. Pi's
  dynamic-providers extension selects it as the default provider with the pinned model.

- **Model discovery** (slice 03, added after the first end-to-end test): Bedrock serves most
  models only through an **inference profile** whose ID carries a region prefix
  (`eu.anthropic.claude-sonnet-4-6`), and a profile from another region is refused, so a
  typed model ID is a trap. Bedrock's `ListInferenceProfiles` on the region's control-plane
  host (`bedrock.<region>.amazonaws.com`, covered by the same API key) lists exactly the IDs
  that are invocable there. The Connection injects the key on that host too and names it in
  `AWS_ENDPOINT_URL_BEDROCK`; the harness-config driver's model discovery gains a
  `bedrock-inference-profiles` shape and a second source on Pi, so the Config panel's dropdown
  lists invocable profiles and the platform seeds one when nothing is pinned, exactly as for
  LiteLLM. Pi's own `/model` picker is narrowed to the same list by the extension. A model the
  account has not enabled is not knowable from any listing and still fails at first use —
  which is why provider errors must reach the chat (tracked separately).

**Out of scope (follow-up issues):** SigV4 with IAM access keys or assumed roles (Envoy's
`aws_request_signing` with a credentials file from the Connection Secret); harnesses other
than Pi; surfacing every Pi provider error in the chat (its own issue).

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 ✅ | Bedrock provider connection | Contract preset, connection template with region-derived host, Providers-tab form, icon, CLI prompt, connections doc | — |
| 02 ✅ | Pi runs on Bedrock | Pi templates accept `bedrock`; Pi extension selects `amazon-bedrock` + pinned model; Pi README and harness-config doc | 01 |
| 03 ✅ | Bedrock model discovery | Second injection host + `AWS_ENDPOINT_URL_BEDROCK`; discovery sources as a list with a `bedrock-inference-profiles` shape; Pi manifest source; extension narrows Pi's model list; docs | 02 |

## Conventions & glossary

- **Preset type** — `ProviderPresetType` in
  `packages/api-server-api/src/modules/connections/providers.ts`; the UI and CLI key their
  per-provider maps on it exhaustively, so adding one forces every map to be filled in the same
  commit.
- **Config input** — a template-declared connect-time field that projects into an `env`
  contribution (`TemplateCommon.configInputs`).
- **Pin** — a provider-declared model the harness defaults to; outranks the seeded model and
  yields to a per-agent choice ([harness-config](../../architecture/harness-config.md)).
- Apply `/typescript-engineering` for api-server and contract code and `/react-ui-engineering`
  for `packages/ui`.
- Never hardcode the brand; never log or echo the key.

## Whole-feature smoke test

On the local cluster installed from this branch (`mise run cluster:install`):

1. Providers tab → **AWS Bedrock** → paste a Bedrock API key, region (e.g. `us-east-1`), model
   ID the key may invoke (e.g. `us.anthropic.claude-sonnet-4-6`). The row reads active.
2. Create a Pi agent with AWS Bedrock as its provider; send "Reply with OK". The agent answers.
3. The agent's env has `AWS_BEARER_TOKEN_BEDROCK=dummy-placeholder`, never the key.
4. The agent's Config panel lists the region's inference profiles as model choices; picking
   one and sending a prompt answers with it. A connection with no model input seeds the first
   discovered profile instead of failing the first prompt.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/4207.
