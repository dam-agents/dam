# ADR-040: Unified secret contributions — controller-merged at render time

**Date:** 2026-05-07
**Status:** Accepted
**Owner:** @Tomas2D

## Context

A user-typed secret declares two things that flow to any granted agent:
its **host/path** (where the credential goes) and its **env mappings**
(placeholders the Envoy credential injector rewrites on the wire). Both
sit on the same K8s Secret as annotations.

Today the platform fans them out through different pipes:

- **Hosts** — `secrets-service.setAgentAccess` → `connectionRules.syncForAgent`
  ([`connection-rules-sync.ts`](../../packages/api-server/src/modules/egress-rules/services/connection-rules-sync.ts))
  → rows in Postgres `egress_rules` → ext_authz reads them live.
- **Envs** — the **browser** computes a diff via
  `envsToAddOnGrant` / `envsAfterUngrant` (formerly `connection-env-helpers.ts`, removed by this ADR)
  and patches the agent ConfigMap's `spec.env` directly. The api-server
  never learns "env X on agent Y came from secret Z."

Consequences: #118 was a UI-path regression; editing a secret's
`envMappings` after grants does not propagate at all; editing
`hostPattern` after grants doesn't either (egress_rules row keeps the
old host); a non-UI grant call gets hosts but no envs. Adding a third
contribution kind picks one pipe arbitrarily.

The runtime read path for hosts (`egress_rules`, ADR-035) is locked in
and out of scope.

## Decision

**A secret's contributions flow through one server-orchestrated fanout;
the controller merges envs into the pod at render time; user-typed envs
win on collision.**

- **Fanout.** Every `secrets-service.update` and `setAgentAccess` walks
  the granted agents (via the existing `granted-secret-ids` annotation)
  and applies the right side-effect per field. Host/path edits call
  `connectionRules.syncForAgent` per agent — hot, no roll. Env-mapping
  edits bump a `secrets-rev` annotation on the agent ConfigMap — the
  controller's existing watch sees the diff, re-renders, rolls.
- **Merge.** Agent `spec.env` carries only user-typed entries. The
  controller, when rendering the pod ([`resources.go`](../../packages/controller/pkg/reconciler/resources.go)),
  reads `granted-secret-ids`, fetches each Secret's `env-mappings`
  annotation, and merges. No stored projection, no copy that can drift.
  Parse-tolerant: a missing, deleted, or malformed Secret contributes
  nothing and the render proceeds (parity with today's host-sync
  tolerance for missing sources).
- **Precedence.** User-typed > first-granted secret (lex order on
  `granted-secret-ids`) > later-granted secrets > system-managed. UI
  surfaces collisions on the affected env row so shadowing is visible;
  there is no api-server precheck and no rejection error. Per-agent
  variation is expressed either by creating a separate secret with the
  per-agent variant, or by typing a user env on that agent's spec —
  user-typed wins, so the shadow is surgical.

The `secrets-rev` annotation is a hash over **render-affecting fields
only** (`envMappings`, `hostPattern`, `pathPattern`). Display-name
changes and other cosmetic edits do not bump the hash and do not roll
pods. Hashing the full annotation set would cause gratuitous rolls and
must be avoided.

Public API is unchanged. The UI's grant-toggle stops mutating
`spec.env`; `connection-env-helpers.ts` and its callers shrink.
Existing agent specs that already carry secret-derived placeholders
need no migration: every reconcile dedupes exact `(name, value)`
matches at render time, so duplicates never reach the running pod.
Stale entries persist on the ConfigMap's `spec.env` until a user
explicitly saves the agent — no controller path rewrites `spec.env`,
so a deploy alone will not roll pods to clean them up. Operators
should expect the cleanup to lag behind deploy and only complete as
users edit affected agents.

## Alternatives Considered

**Server-side projection into `spec.env` with a `source` tag.** Mirrors
the host pipe most literally but reintroduces a stored copy of envMappings
that has to be reconciled on every secret edit. Live merge eliminates
the projection entirely.

**Promote envMappings to Postgres alongside `egress_rules`.** Pod env is
immutable on a running pod, so envs have no equivalent live read path —
a table buys nothing the annotation doesn't.

**Reject user-vs-secret env collisions at the api-server.** The platform
already permits literal credentials in `spec.env` without any grant;
collision rejection only catches one spelling of that footgun while
adding an error path. Envoy's credential injector overwrites the header
on the wire regardless of pod env, so the on-the-wire boundary is
unaffected by user shadowing.

## Consequences

- **One orchestration entry point.** Adding a fourth contribution kind
  is one annotation on the K8s Secret plus one fanout step in
  `secrets-service`. No second pipe to plumb.
- **Env edits roll granted agents — must be visible in the UI.** Today,
  editing `envMappings` after grants is a no-op; users may have come to
  rely on that silently. Under this ADR, every env-affecting edit rolls
  every granted agent's pod (Kubernetes makes pod env immutable; there
  is no hot path). The secret-edit form **must** show this before
  submit: list the affected agents and require the user to confirm.
  Host/path edits stay hot and need no confirmation. The two form
  states must be visually distinguishable so "I changed a field" maps
  predictably to "did this disturb my running sessions."
- **Annotations are bounded; the UI must enforce it.** K8s annotations
  cap at 256 KiB total per object; `env-mappings` is one JSON-encoded
  annotation among several. The controller's parse-tolerant fallback
  hides corruption as "no env contribution" — silent failure mode that
  is hard to diagnose. The secret-edit form must size-check the encoded
  `env-mappings` (and the per-secret total annotation budget) at submit
  time and reject obviously-too-large input with a clear error, rather
  than letting the K8s write succeed and the runtime go quiet. To make
  the post-write silent path observable, the controller emits a
  `slog.Warn` per reconcile naming any `granted-secret-ids` (and
  `granted-connection-ids`) entries that resolve to no owner-owned
  Secret — operators have a log signal for "id present, contributes
  nothing" without depending on a future metric.
- **Controller learns one merge step.** [`resources.go`](../../packages/controller/pkg/reconciler/resources.go)
  reads `granted-secret-ids` and each referenced Secret's annotations.
  The Secrets are already mounted into the gateway pod; the access
  pattern exists.
- **Fork pods inherit the merge.** Per-turn fork pods (ADR-027 / 038)
  render through the same controller path. The fork's grant set is the
  parent instance's, but Secrets are read under the **replier's** owner
  label; granted IDs that don't exist under the replier's ownership
  contribute nothing (same parse-tolerant fallback as the missing-Secret
  case). Behavior matches today's host-side handling for forks.

## Related ADRs

- [ADR-005](005-credential-gateway.md) — credential-gateway pattern,
  unchanged.
- [ADR-028](028-generic-secret-injection-config.md) — `injectionConfig`
  joins `hostPattern` and `envMappings` as a contribution under this
  model.
- [ADR-033](033-envoy-credential-gateway.md) — Envoy filter chains and
  on-the-wire injection unchanged.
- [ADR-035](035-unified-hitl-ux.md) — `egress_rules` model unchanged;
  host fanout calls existing `syncForAgent` for every granted agent.
- Closes #122; supersedes the partial fix in #118.
