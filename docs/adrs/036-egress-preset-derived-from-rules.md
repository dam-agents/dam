# ADR-036: Egress preset derived from rule sources, not stored on the agent spec

**Date:** 2026-05-04
**Status:** Accepted
**Owner:** @jezekra1

## Context

[ADR-035](035-unified-hitl-ux.md) introduced an `egressPreset` field on `AgentSpec` (persisted in the agent's K8s ConfigMap) to record the user's last preset choice. The field had three responsibilities:

1. Drive the preset seeder when the user switches presets — `agents.update({ egressPreset })` was the single commit point.
2. Tell the Configure dialog which preset to highlight when reopening it.
3. Survive across pod restarts and replica failover.

Reviewing the implementation revealed two problems with this storage location:

- **The preset is not part of the agent's identity or workload shape.** It is a HITL/policy concern. The controller — which owns the ConfigMap — never reads it. Every preset switch emits a ConfigMap update event the controller has to filter and no-op on.
- **The data is already in the database.** `egress_rules.source` records each row's origin (`preset:trusted`, `preset:all`, `connection:<id>`, `manual`, `inbox`). The presence of `preset:*` rows IS the preset. Storing a separate `egressPreset` field duplicates state with the rules' own sources.

The redundancy was concrete: `agents-service.update`'s preset branch read the spec field, compared it to the new value, then ran the seeder (which ultimately wrote `preset:*` rows). The seeded rows' `source` already encodes the same fact the spec field was tracking.

## Decision

**Drop `egressPreset` from `AgentSpec`. Derive the agent's current preset from active `egress_rules` rows: any `preset:all` row → `"all"`; any `preset:trusted` row → `"trusted"`; otherwise `"none"`.** Expose the derived value as a dedicated query (`egressRules.currentPreset(agentId)`). Move the "switch preset" UX onto the existing `egressRules.applyPreset` mutation; remove the parallel commit point on `agents.update`.

`CreateAgentInput.egressPreset` stays as a **transient** input parameter — agent-create runs the seeder once with the chosen value, then forgets it. The seeded rows are the durable record.

### What changes

| Concern | ADR-035 | This ADR |
|---|---|---|
| Storage of the preset choice | `AgentSpec.egressPreset` (ConfigMap) | `egress_rules.source` rows (Postgres) |
| Read API | `agents.get` returns `egressPreset` | `egressRules.currentPreset(agentId)` |
| Switch API | `agents.update({ egressPreset })` | `egressRules.applyPreset({ agentId, preset })` |
| Create API | `agents.create({ egressPreset })` | `agents.create({ egressPreset })` (transient) |
| Migration burden for legacy agents | Configure dialog shows blank preset; user must re-pick | Same — legacy agents naturally read as `"none"` (no preset rows) |

The transient field on create is preserved so a fresh agent can be created and its preset seeded in one mutation, avoiding a window where the agent exists with no rules.

### Why this is a separate ADR, not an edit to ADR-035

ADRs are immutable once accepted ([CLAUDE.md memory](../../CLAUDE.md)). ADR-035 is left as the record of the original decision; this ADR records the refinement. The core HITL design (out-of-pod ext_authz authority, two-layer L4/L7, inbox, Redis pub/sub, preset semantics) is unchanged.

## Consequences

- **API server is simpler.** `agents-service.update` loses its preset-handling branch entirely. The preset is no longer threaded through `assembleSpecFromTemplate` / `assembleSpecFromImage` / `patchSpecField`. One field removed from the API contract (`UpdateAgentInput.egressPreset`).
- **Configure dialog reads `egressRules.currentPreset(agentId)` once and stages edits client-side as before.** Save calls `egressRules.applyPreset` instead of including the preset in `agents.update`.
- **No spurious controller reconciliation** on preset switches — the agent ConfigMap is no longer touched.
- **Existing agents migrate to `"none"`** by virtue of having zero `preset:*` rows. Identical to a new agent the user explicitly created with `none`. No backfill migration needed.
- **The tradeoff: "user explicitly chose `none`" is indistinguishable from "user never picked a preset"** (both = no `preset:*` rows). At runtime they are identical (every host falls through to L4 ext_authz with no rule match). If the UI ever wants to differentiate the two — e.g., to render a "default-deny everything" warning more prominently for new agents — it would need a separate signal; today it does not.

## Alternatives Considered

<details>
<summary>Keep <code>egressPreset</code> on <code>AgentSpec</code> (the ADR-035 design)</summary>

Rejected — duplicates state with `egress_rules.source`, couples a HITL/policy concern to a controller-watched ConfigMap, and forces the agent to be re-saved (with reconciliation noise) on every preset switch.

</details>

<details>
<summary>Move the preset to a dedicated table (<code>agent_egress_preset(agent_id, preset)</code>)</summary>

Considered. Distinguishes "user explicitly chose `none`" from "never picked a preset" without a derivation query. Rejected for v1 — the distinction has no runtime consequence today, and adding a second table for one boolean fact is over-engineering. If the distinction ever matters, this is a clean future addition.

</details>

<details>
<summary>Drop <code>egressPreset</code> from <code>CreateAgentInput</code> too; default to <code>trusted</code> server-side; require a follow-up <code>applyPreset</code> for any other choice</summary>

Considered. Cleaner contract (zero preset state in agent inputs). Rejected — creates a window where the agent exists with `trusted` rules briefly before the user-chosen preset replaces them. The transient create-time field avoids the window without re-introducing durable storage on the spec.

</details>

## Related ADRs

- [ADR-035 — Unified HITL UX](035-unified-hitl-ux.md) — the parent decision this ADR refines. Specifically supersedes the §"Preset is persisted on the agent spec" paragraph and the "Persistence on Save" paragraph's mention of `agents.update({ egressPreset })`.
