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
- **Pi** (`@earendil-works/pi-ai` 0.86.1) already ships provider `amazon-bedrock`
  (API `bedrock-converse-stream`); with `AWS_BEARER_TOKEN_BEDROCK` set it sends
  `Authorization: Bearer` instead of SigV4 and reads the region from `AWS_REGION`. Pi's
  dynamic-providers extension selects it as the default provider with the pinned model.

**Out of scope (follow-up issues):** SigV4 with IAM access keys or assumed roles (Envoy's
`aws_request_signing` with a credentials file from the Connection Secret); live model discovery
from Bedrock's list APIs, which would populate the Config panel's model dropdown; harnesses
other than Pi.

**Known limitation:** Pi's model choices in the Config panel come from model discovery, which
reads OpenAI-shaped endpoints only, so a Bedrock agent's dropdown is empty until the discovery
follow-up. The connection's model input and a hand-edit of Pi's `settings.json` still choose
the model.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Bedrock provider connection | Contract preset, connection template with region-derived host, Providers-tab form, icon, CLI prompt, connections doc | — |
| 02 | Pi runs on Bedrock | Pi templates accept `bedrock`; Pi extension selects `amazon-bedrock` + pinned model; Pi README and harness-config doc | 01 |

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

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/4207.
