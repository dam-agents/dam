# ADR-024: Connector-declared pod envs + per-agent env overrides

**Date:** 2026-04-17 (revised 2026-04-21 to cover app connections)
**Status:** Accepted
**Owner:** @tomas2d

## Context

Pod env vars used to live in hardcoded platform code and Helm templates. Adding a credential-backed env required a template edit, agents got sentinel envs even without the corresponding grant, and users had no way to set their own envs.

## Decision

Pod envs come from two user-managed surfaces, governed by one principle: **the entity that owns the credential declares which env vars it needs.**

1. **Connector-declared envs.**
   - **Secrets:** `secret.metadata.envMappings` — user-settable, persisted in OneCLI's JSONB column. The controller reads it at reconcile and injects into the pod.
   - **App connections:** declared per-provider in OneCLI's app registry (hardcoded in code, not DB — no migration per new provider). `GET /api/connections` returns the mapping as a joined field. Platform's Configure Agent UI copies it into the agent's editable env list at grant time and removes it on ungrant when the entry is still untouched.
2. **Per-agent envs.** User-edited `{name, value}` list on `agentSpec.env`, applied to every instance of that agent.

Env resolution (last-occurrence-wins): `platform < connector-envs < template-envs < agent-envs < instance-envs`. Protected names (`PORT`) are server-enforced against client edits.

### Guiding constraints

- Users shouldn't have to know env var names to make a connected app work.
- Platform shouldn't decide env names for OneCLI-owned providers — single source of truth, clean separation of concerns.
- Agent templates shouldn't bake connection envs — connections are runtime choices.
- Power users can still tweak per-agent — populated envs land in an editable list, never a read-only section.
- `envMappings: EnvMapping[]` is an array so a provider can prescribe multiple envs when more than one CLI/library is commonly used against it.

## Alternatives Considered

**Per-connection metadata (mirror of the secret path).** Rejected: the env name doesn't vary per connection — it's a provider-level fact. Per-connection storage adds a PATCH endpoint and backfill for no signal.

**Platform-side provider → env table.** Rejected: puts provider knowledge in the wrong layer. A new OneCLI provider would require a Platform PR.

**Re-add envs to the helm template.** Rejected: regresses "no injection without grant" and locks the template to a fixed set of providers.

## Consequences

- Platform is provider-agnostic on the connection path — adding a provider is one line in OneCLI.
- Two-repo coordination: credential-owning side (OneCLI) and consuming side (Platform) ship together — kagenti/onecli#9 for secrets, kagenti/onecli#16 + kagenti/platform#262 for connections.
- Envs take effect on next pod restart. Editing agent envs rolls the StatefulSet automatically; editing a provider's envMappings in OneCLI does not — users restart the pod.
- **Known exception — Anthropic secrets.** Defaults (`CLAUDE_CODE_OAUTH_TOKEN` for OAuth, `ANTHROPIC_API_KEY` for api-key) are hardcoded in Platform's `api-server-api` and backfilled into the secret's metadata based on OneCLI's detected auth mode. This violates the principle (Platform decides env names for a credential OneCLI owns) and predates the connection work. Follow-up: OneCLI adds a secret-type registry analogous to the app registry; Platform drops the constants.
