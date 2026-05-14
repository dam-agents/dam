# ADR-044: Provider twin secrets — multiple injection points per credential

**Date:** 2026-05-14
**Status:** Accepted
**Owner:** @xjacka

## Context

A provider preset (ADR-028) binds one credential to one Envoy injection: a
`hostPattern` plus an `InjectionConfig` that names a header and an
optional `valueFormat`. Bob Shell breaks that mould — its backend reads
the same credential from **two wire positions on the same host**:

- `Authorization: Bearer <token>` for chat / model-info endpoints.
- `?key=<token>` URL parameter for `/key/info`, `/user/info`, and a few
  admin endpoints (Bob's HTTP client emits the value in both places, but
  the URL-keyed routes ignore the header).

Today's Envoy filter chain already supports both forms (the `credential_injector`
filter writes the header; a per-route Lua filter then moves the value
from a throwaway header into the URL parameter and strips the header — see
ADR-033 §Credential injection). But each filter is bound to its own K8s
Secret, so making both work for one provider required the operator to
create two manually-configured generic Secrets:

1. One with `injectionConfig: { headerName: "Authorization", valueFormat: "Bearer {value}" }`.
2. A second on the same host with `injectionConfig: { headerName: "X-Bobshell-Internal", queryParamName: "key" }`.

That's hostile for a provider preset card (Settings → Providers): the
user can only express one wire position per "preset"; the second secret
has to be hand-crafted, granted separately, rotated separately, deleted
separately. Adding Bob without solving this means every new operator
re-discovers the same two-step manual setup.

## Decision

**A provider preset mode declares all its wire injection points up front
in the registry. The api-server fans the credential out across multiple
linked K8s Secrets — a "primary" plus one "twin" per extra injection —
and cascades every lifecycle operation. From the user's perspective the
provider is one card and one credential.**

### Registry shape

`ProviderPresetMode` gets an optional `extraInjections: readonly InjectionConfig[]`
field. Each entry is a complete `{ headerName, valueFormat?, queryParamName? }`
tuple on the same host as the primary. Bob declares:

```ts
extraInjections: [{ headerName: "X-Bobshell-Internal", queryParamName: "key" }]
```

The primary's injection is whatever the preset's `mode.injection` says
(or the default `Authorization: Bearer {value}` fall-through).

### Twin secrets

When `secrets-service.create` lands a primary for a preset that declares
`extraInjections`, it also creates one K8s Secret per entry:

- Same `value` (same wire-level token).
- Same `hostPattern` — twins always live on the primary's host.
- The entry's `InjectionConfig`. No `envMappings` (the primary carries them).
- No `pathPattern` — the primary's scope already governs which routes
  the credential applies to.
- A linking annotation `agent-platform.ai/primary-secret-id: <primary-id>`
  so the service layer can rediscover the twins.

The display name carries a `(?queryParam)` / `(HeaderName)` suffix so
admins inspecting `kubectl get secrets` can tell what each twin does.

### Lifecycle cascade

The service layer treats twins as derived state, never user-visible:

- **`list`** — twins are filtered out (`primarySecretId` set).
- **`create`** — primary first, then twins in a transaction-like loop.
  Any twin write failure rolls back every prior twin + the primary so
  the user never sees a half-injected secret. The user-facing
  `SecretView` carries only the primary's id.
- **`update`** — primary is patched first; `value` and `hostPattern`
  changes cascade onto every twin. `envMappings`, `pathPattern`, and
  `injectionConfig` do **not** propagate — twins have none of those by
  design. ADR-040 fanout (egress-rules sync, secrets-rev bump) runs once,
  keyed on the primary's id.
- **`delete`** — twins first, primary last. A mid-cascade failure leaves
  the primary intact and the user can retry (twins are findable by the
  primary id annotation). Reversing the order would orphan twins if the
  primary delete went through but a twin delete failed afterward.
- **`getAgentAccess`** — twin ids are filtered out so the user view only
  shows primaries.
- **`setAgentAccess`** — primaries-only on the user side. Each primary
  in the request expands to `[primary, ...twins]` before persisting the
  grant list, so the controller mounts every linked Secret and renders
  every Envoy filter. Twin ids supplied directly are silently dropped
  (defence in depth: a buggy caller can't grant a lone twin).
- **`listGrantedAgents`** — uses the existing grant index. Returns the
  same agents whether keyed on primary or twin id (setAgentAccess writes
  both into every grant), and callers always pass primary ids anyway.

The controller is unchanged. ADR-033's Envoy filter rendering already
processes every mounted K8s Secret independently; twins look exactly
like additional generic secrets at that layer.

## Alternatives Considered

**Extend `InjectionConfig` to carry multiple wire points per Secret.**
One K8s Secret would render N Envoy filters. Rejected: requires changes
to the Go reconciler's rendering loop, the K8s annotation schema, and
the SDS file convention (multiple inline strings per Secret). Twin
secrets pile zero new work onto the controller — every twin is just
another generic Secret it already knows how to render.

**Expose twins to the user as separate secrets.** Drop the linking
annotation; let the user see and manage both rows directly. Rejected:
the user came to add "Bob", not "Bob (header)" and "Bob (URL param)";
each subsequent op (grant, rotate, delete) doubles in steps and the
provider card abstraction stops making sense.

**Skip the registry and do it client-side from the preset card.** The
Bob card calls `create` twice with different `injectionConfig` payloads
each time. Rejected: every primary-cascade operation (rotate, change
host, grant, revoke, delete) becomes the UI's responsibility, with no
server-side guarantee they stay coupled. Also leaks the second secret
into `list()` and `setAgentAccess`. The whole point of moving to a
registry-driven model is one source of truth for "what does this
provider need on the wire."

**One generic per wire point at agent-create time, no twin coupling.**
Effectively today's manual workaround. Rejected: scales like O(presets ×
wire-points) of operator toil; rotating a token means N edits with no
atomicity; deleting "Bob" means hunting for N secrets.

## Consequences

- **Provider presets can model real-world auth shapes that need the
  credential in multiple wire positions.** No per-provider service-layer
  branches; everything reads from `PROVIDERS[type].modes[].extraInjections`.
- **K8s annotation schema grows one optional annotation**
  (`agent-platform.ai/primary-secret-id`). Parse-tolerant — missing or
  malformed annotation means the Secret is treated as a stand-alone
  primary (ADR-040's parse-tolerance posture).
- **Twin manual-deletion is an unsupported state.** If an operator
  `kubectl delete`s a twin out-of-band, the primary keeps working for
  its own injection but the twin's wire path goes silently dark.
  Subsequent grant operations re-expand only against the twins that
  still exist. Recovery: delete the primary and recreate via the
  provider card. The service does not auto-heal — a registry-vs-actual
  diff pass on every `setAgentAccess` was rejected as out of scope.
- **Registry changes are not retroactive.** Adding a new `extraInjections`
  entry to a preset doesn't mint twins for already-created primaries.
  Operators must recreate the primary to pick up the new wire point.
  Acceptable today because the registry is internal config, not user
  data; document if it ever becomes a frequent migration concern.
- **Concurrency window on create.** Twin creation isn't atomic with the
  primary at the K8s level; the rollback path is best-effort. In the
  worst case the user retries — `create` is idempotent at the user level
  (a new id is minted each time), so there's no state to disambiguate.
- **Test coverage.** `secrets-service-fanout.test.ts` covers create,
  list filter, update cascade (value + host, with `envMappings` proven
  non-cascading), delete order, grant expansion, getAgentAccess filter,
  defensive twin-id drop on grant, revoke-all, and partial-create
  rollback. Ten tests, each a distinct code path.

## Related ADRs

- [ADR-028](028-generic-secret-injection-config.md) — `injectionConfig`
  schema; extended here from "one per secret" to "one per wire point
  with twin secrets per provider preset."
- [ADR-033](033-envoy-credential-gateway.md) — Envoy filter rendering
  and the Lua URL-rewrite path that the `?key=` twin depends on.
- [ADR-040](040-unified-secret-contributions.md) — fanout model. Twin
  edits inherit the primary's fanout path; no second fanout pipe.
