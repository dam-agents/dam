# ADR-042: Three-layer agent pod configuration

**Date:** 2026-05-12
**Status:** Accepted
**Owner:** @jezekra1

## Context

Controller-rendered agent pods used to get their shape from a single `AgentConfig` that mixed cluster-wide platform policy (security context, scheduling, pull secrets) with template-overridable fields (resources, storage size, image pull policy). Per-agent ConfigMaps could ride on top via a `config:` block that merged into the same struct — so a template could in principle relax the security floor, change the runtime class, or override scheduling constraints. The merge logic was ~80 lines of field-by-field rules and the override surface was too wide.

## Decision

Split agent pod configuration into three explicit layers:

1. **`AgentBase`** (`controller.agent.base` in `values.yaml`) — chart-only platform policy: security context, scheduling (`nodeSelector`, tolerations, affinity, `runtimeClassName`), cluster details (`imagePullSecrets`, `storageClass`, `accessMode`), lifecycle (`idleTimeout`, `terminationGracePeriod`), pod metadata, probes. Applied verbatim to every agent + fork agent pod. **Not exposed in the agent ConfigMap surface.**
2. **`AgentTemplateDefaults`** (`controller.agent.templateDefaults`) — chart-wide fallbacks for fields a template can override: `imagePullPolicy`, `storageSize`, `resources`, `mounts`, `env`, `skillSources`, `init`. Applied per-field when the agent ConfigMap omits the value.
3. **`agentTemplates[]`** — per-template values rendered as agent-template ConfigMaps by a single ranged Helm file. Each entry sets only what differs from the defaults.

The controller falls back per field at reconcile time:

```
x := agentSpec.X
if isEmpty(x) { x = defaults.X }
```

Slice fields (`mounts`, `env`, `skillSources`) use **replace** semantics — a template that sets the field owns the whole list. The literal string `$HOME` in mount paths and skill paths is substituted with `templateDefaults.agentHome` at render time so templates don't hardcode the home directory; init scripts use shell-native `$HOME` (the controller sets the env var on the init container).

## Alternatives Considered

- **Single `AgentConfig` with embedded override (status quo):** Kept the generic merge; security and scheduling stayed overridable per-agent. Rejected — those are operator policy, not template concerns.
- **No chart-wide defaults; every template owns every field:** Maximally explicit, but forces duplication of mounts/env/init across bundled and user-defined templates. Rejected.
- **Helm-time merge via named templates:** Stitch defaults into each agent ConfigMap at chart render. Works for Helm-rendered templates but doesn't help bare-image agents (api-server creates those at runtime). Rejected — controller-side fallback handles both paths uniformly.

## Consequences

- Security context (`podSecurityContext`, `containerSecurityContext`) cannot be set by an agent ConfigMap. Operators wanting to relax the `capabilities.drop: ["ALL"]` floor do so via Helm values, where it's loud and reviewable.
- Bare-image agents (no template) ship a minimal `spec.yaml` (`{image, version, description}`); the controller fills in everything else from chart defaults. The api-server's `defaultTemplateSpec()` was removed.
- All four bundled agent templates collapsed into a single `agentTemplates: []` array and one ranged Helm template file. New templates are added as array entries, not new files.
- `AgentConfig.Merge` is gone; per-field inline fallback (~8 lines per call site) replaces an ~80-line generic merge. Easier to read, easier to extend.
- `$HOME` substitution lets templates inherit chart-wide mounts unchanged regardless of the configured `agentHome`.
