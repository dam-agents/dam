# Invocation spend attribution — spend by agent credits the Driver

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3041

## Goal

Spend an agent causes by delegating counts as that agent's spend. Today the Usage tab's
"Spend by agent" list fragments a delegating agent's cost across short-lived
`invocation-<hex>` rows that name agents already cleaned up — unactionable rows, and the
Driver that caused the spend looks cheap. After this feature, the list shows one row per
agent the user actually created, covering both direct spend and spend through Invocations
it drove. The breakdown keeps summing exactly to the month total.

## Approach

An Invocation target has **no spend identity of its own** — its telemetry rows *are* the
Driver's rows. This is the third face of the rule the glossary already commits to twice:
Egress Aliasing (egress) and Driver Cascade (deletion) both treat a target as not being an
independent principal.

The attribution is decided at **write time (spawn), not read time**, because it has to be:
`invocations` rows are deleted 10 minutes after completion
(`packages/api-server/src/modules/invocations/services/invocation-liveness.ts:44`,
`RESULT_RETENTION_MS`), so `driver_agent_id` is not durable history and a read-time rollup
has nothing to join against. Spawn-time resolution is safe: retention only drops
**terminal** rows, and every ancestor of a spawning target is necessarily still `running`
(it is mid-spawn), so the chain is always fully present at the moment it is resolved.

Mechanism, riding the existing trusted-attribution path
([observability — trusted attribution](../../architecture/observability.md#trusted-attribution)):

1. At spawn, the api-server resolves the **root Driver** (same resolution Egress Aliasing
   uses — `driver-resolution.ts`, `resolveRoot`) and stamps it into a new Agent CR spec
   field on the target.
2. The target's paired gateway stamps that root Driver id as the trusted
   `x-platform-agent-id` header instead of the target's own id, and additionally stamps a
   new `x-platform-invocation-id` header carrying the target's own id (an Invocation's id
   *is* its target agent's id). The collector promotes it to a `platform.invocation.id`
   resource attribute with the same delete-then-upsert sanitization as `platform.agent.id`.
3. The spend read path ([metrics](../../architecture/metrics.md)) needs **no grouping
   change** — target rows are already the Driver's by the time ClickHouse sees them. The
   one read-path fix is the row label: `argMax(platform.agent.name, Timestamp)` must
   exclude child rows (those with a `platform.invocation.id`), or a Driver gets relabelled
   to `invocation-<hex>` whenever a target made the last call in the window.

`platform.invocation.id` is load-bearing, not a nice-to-have: it is the only thing keeping
child rows distinguishable after their attribution has been deliberately merged (correct
label now, findable target in the exploration UI, per-invocation drill-down later).

Decisions that bound the scope (settled in the design session for #3041):

- **Root Driver, not immediate parent.** Chains attribute all the way up to the root
  non-target agent.
- **Unresolvable root fails the create.** `resolveRoot` returns null past depth 16 — a
  corruption guard. Stamping self would manufacture exactly the orphan row this feature
  eliminates, so spawn refuses at the door with a message the Driver can read. (Egress
  Aliasing already fails closed on the same null, so such a target could never make an
  admitted LLM call anyway.)
- **Target keeps its own `platform.agent.name`.** Display identity stays self-declared
  (`telemetry-env.ts` unchanged); only attribution merges. A Driver that made zero direct
  calls in a window has no label to take — the UI already falls back to the agent id
  (`packages/ui/src/modules/metrics/components/agent-spend-bars.tsx:8`), so no UI change.
- **Sessions are not folded.** A target keeps its own `session.id` and shows as its own
  session row under the Driver's agent; sessions still sum to the agent's bar. The
  trace-aware session fold is deliberately deferred (would put a whole Ralph loop into one
  trace) — out of scope here, per the issue.
- **Forks are out of scope** — they are being removed. The fork gateway path
  (`fork.go`) keeps stamping the fork's own id.
- **Cutover, not migration.** Existing orphan rows stay orphaned; their `driver_agent_id`
  is long deleted, so no backfill is possible. Applies from the change onwards.

Architecture pages this touches: [observability](../../architecture/observability.md)
(export + trusted attribution), [metrics](../../architecture/metrics.md) (spend read
path), and the glossary ([ubiquitous-language](../../ubiquitous-language.md)). Read both
architecture pages before implementing any slice.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Gateway attribution override + invocation id stamp | Go CRD field + codegen, Envoy collector chain stamping, collector promotion | — |
| 02 | Spawn resolves root Driver and stamps the target | api-server: service-only create field, spawn-time resolution, fail-closed error | 01 |
| 03 | Spend-by-agent label excludes child rows | `clickhouse-reader.ts` label `argMaxIf` | 01 |
| 04 | Architecture docs | metrics.md, observability.md, ubiquitous-language.md | 01–03 |

## Conventions & glossary

- **Driver** — the agent that spawned an Invocation. **Root Driver** — the first
  non-target agent reached by following `invocations.driver_agent_id` upward.
- **Invocation / target** — a one-shot ephemeral Agent spawned to run a delegated task;
  its id equals the invocation id (pre-minted in `invocations-service.ts` `spawn`).
- **Egress Aliasing / Driver Cascade** — existing rules that a target is not an
  independent principal; this feature adds the spend face of the same rule. See
  [ubiquitous-language](../../ubiquitous-language.md).
- **Trusted attribution** — the gateway-stamped `x-platform-agent-id` header promoted by
  the collector to the `platform.agent.id` resource attribute; the sole authority for
  whose spend a row is.
- Skills: apply `/typescript-engineering` for all api-server work (02, 03). Slice 01 is
  Go + Helm; follow the surrounding controller code style. Slice 04 follows
  [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md).
- The new spec field must **never** be settable through the wire create schema
  (`schemas.ts`) — a user-supplied value would forge attribution onto an agent the caller
  does not drive. It is service-only input, like the pre-minted `id`.
- Do not consult closed PR #3037; it is abandoned. Docs are written fresh from this plan.

## Whole-feature smoke test

On the local cluster with the telemetry backend enabled (`clickstack.enabled=true` — see
the `cluster-ops` skill for install/status):

1. Create an agent (the Driver) and have it spawn an Invocation via the harness REST
   endpoint (`POST /api/agents/:id/invocations`) with a trivial prompt/schema.
2. `kubectl get agent <target-id> -o yaml` — spec carries the Driver's id in the new
   attribution field.
3. After the target runs, query ClickHouse (or the Usage tab): the target's
   `claude_code.api_request` rows carry `ResourceAttributes['platform.agent.id']` equal to
   the **Driver's** id and `platform.invocation.id` equal to the target's id; "Spend by
   agent" shows no `invocation-<hex>` row, and the Driver's bar includes the target's
   spend while keeping the Driver's name.
4. Month total still equals the sum of the visible bars.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3041.
