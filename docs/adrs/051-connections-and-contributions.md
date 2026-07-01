# ADR-051: Connections, Connection Templates, and Contributions — unified configuration model

**Date:** 2026-06-30
**Status:** Accepted
**Owner:** @jezekra1

## Context

External integrations reach an agent through two parallel code-declared registries — the OAuth-app registry (`OAuthAppDescriptor`) for OAuth-typed integrations like GitHub, Spotify, Google, and the typed-secret registry (`ProviderPreset`) for header-injected credentials like Anthropic, OpenAI, IBM LiteLLM. Each declares envs, hosts, and injection rules in a different shape, with its own CRUD path and its own UI surface. MCP servers are not first-class at all (one hardcoded `platform-outbound` URL written at boot, no per-agent declaration). Skill sources are a third, separate domain. Adding a new external-integration kind today is a per-registry change in code, a new domain entity, and bespoke UI. Granting one integration to an agent fans state out across at least four disjoint mechanisms (env-merge at controller render, host-rules to Postgres, file pushes to the pod, ad-hoc tRPC calls), with no shared evolution path.

## Decision

Replace the parallel registries with a single configuration model. Every external integration is a `Connection`, instantiated from a code-declared `Connection Template`, and emits a typed `Contribution[]` set when granted to an Agent.

- **Connection** is a uniform shape: a chosen `AuthConfig` (a discriminated union over `oauth`, `header`, `none`), a `Contribution[]` (a discriminated union over the kinds below), the `Connection Template` it was built from, and the user-supplied inputs. A user-built custom connection and a premade preset connection share the same on-the-wire shape — the only difference is which defaults were filled in for them. The `header` kind covers anything injected as a request header — API keys, PATs, bearer tokens, basic auth — distinguished by `headerName` + `valueFormat`.
- **Connection Template** is a code-level catalog entry shipping inputs the user fills in plus the defaulted `auth` and `contributions[]` recipe. Two display-axis attributes — `category` (`app` | `mcp` | `other`) for UI grouping, and `isCustom` for templates that exist solely to drive user-typed instances — are the only structural metadata that exists alongside the shared shape.
- **Contribution** kinds in the initial set: `env`, `egress-host`, `file`, `mcp-entry`, `skill-ref`. The set is open; new kinds extend the union under the evolution rule of ADR-052.
- Contribution **routing** is per-kind. `env` keeps its render-time merge into the pod spec (ADR-040 unchanged). `egress-host` keeps its sync into the egress-rules table and Envoy filter chains (ADR-033 / 035 unchanged). `file`, `mcp-entry`, `skill-ref` ride the runtime channel (ADR-052). The api-server is the fan-out router.
- **Channel** (Slack / Telegram inbound pathways) is not a Connection and never becomes one. Its shape — inbound, conversational, no host-egress or env contribution — is unrelated to outbound-integration shape.
- This refactor is a clean break. The existing AppConnection and Secret data, and the OAuth-app and provider-preset registries, are reshaped in place; no migration choreography is preserved across the cutover.

## Alternatives Considered

- **Single top-level entity collapsing every distinct noun (AppConnection, Secret, Skill Source) into one** — rejected, the noun distinctions carry domain meaning the discriminator would just rebuild.
- **Keep parallel registries, unify only the delivery rail** — rejected, the duplication between OAuth-app and provider-preset descriptors is the cost the new model amortizes; unifying delivery without unifying templates leaves the per-integration code paths.
- **Promote MCP server to its own top-level entity alongside Connection** — rejected, MCP is a contribution shape (one entry in a config file), not an integration shape; a Linear-MCP integration is an `app` Connection that emits an `mcp-entry` contribution.
- **Treat `oauth` and `header` as integration categories rather than auth modes** — rejected, OAuth-vs-PAT for the same integration (e.g. GitHub) is the same external service with two acquisition flows; the two-axis model expresses that without inventing two Connection types.

## Consequences

- **Easier:** Adding a new external integration is one Connection Template entry in code; the wire format, delivery rail, and per-kind drivers are unchanged. Today's equivalent change is at minimum a registry edit, a Zod input schema, host-rule wiring, env-rule wiring, a UI form, and (for MCP) a hardcoded boot-time file write.
- **Easier:** Detaching a Connection from an agent removes its contributions everywhere the same way — snapshot reconciliation + per-kind removal semantics — with no mechanism-specific cleanup logic per integration.
- **Easier:** The user model collapses to one Connections page with `category`-driven grouping and one "Custom Connection" affordance covering MCP, OAuth, and Header in one place.
- **Harder:** The cutover is a wide-blast-radius schema and module reshape — the OAuth-app registry, the provider-preset registry, the egress-rules sync, the env-merge controller path, and the AppConnection + Secret UIs all reshape together. No phased dual-write story; the version of the api-server that ships the new model is incompatible with agents on the old delivery mechanisms.
- **Harder:** Users authoring a custom connection see more abstraction than they did before — what was three buttons (Add OAuth, Add MCP, Add Secret) becomes one with a kind selector, and the UI must teach the discrimination.
- **Committed-to:** The discriminated-union `Contribution` shape and its initial kind set are now a wire-level contract. Adding a new kind is the standard evolution path, governed by the capability-flag rule of ADR-052. The two-axis classification on Connection Template (`category` × `isCustom`) is the surface the UI binds to and is durable; renaming either is a UX-visible change.

## Supersedes

- ADR-005 (gateway pattern for credentials) — preserved in principle (agent never sees raw tokens), but the OneCLI-era mechanism it described has already been replaced by Envoy injection (ADR-033); this ADR completes the displacement by relocating the per-integration declarations out of that ADR's vocabulary into the Connection Template surface.
- ADR-024 (connector-declared envs) — its load-bearing principle ("the entity owning the credential declares which envs it needs") is preserved as the `env` Contribution rule. The OneCLI app-registry mechanism it documented is retired; the same rule now applies uniformly to all Contribution kinds.
- ADR-028 (configurable injection on generic secrets) — folded into the `header` AuthConfig + `egress-host` Contribution shape, no separate entity for "generic secret injection config."

Pass-through mentions of `AppConnection`, `Secret`, `OAuthAppDescriptor`, and `ProviderPreset` in other ADRs (030, 034, 040, 044) remain unedited per the project's ADR-immutability convention; the canonical position is this ADR.
