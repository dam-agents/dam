# 04 — Architecture docs

**Depends on:** 01-gateway-attribution-override, 02-spawn-stamps-root-driver, 03-spend-label-excludes-child-rows
**Part of:** Invocation spend attribution — see [README](./README.md)

## Context

The feature changes what "trusted attribution" means for Invocation targets and what the
per-agent spend rollup shows, so the architecture pages and the glossary must say so.
Write the content fresh from this plan's README and the shipped code — do **not** consult
closed PR #3037. Follow
[`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md)
(including `Last verified:` dates); never reference ADRs or this plan folder from the
pages.

## Implementation plan

1. **`docs/architecture/observability.md`** — in *Trusted attribution* (and the *Agent
   export* self-declared-identity bullet where it touches naming): an Invocation target's
   gateway stamps its **root Driver's** id as `platform.agent.id` (a target is not an
   independent principal — same rule as Egress Aliasing), plus the trusted
   `platform.invocation.id` carrying the target's own id; the invocation-id header is
   stripped by the gateway for non-targets so it cannot be forged; the target's
   `platform.agent.name` stays its own, display-only. Mention the spawn-time (write-time)
   nature: attribution is fixed in the gateway's controller-rendered config at create.
2. **`docs/architecture/metrics.md`** — in the *Spend breakdown* per-agent bullet and the
   *Telemetry reader* paragraph: Invocation spend rolls up under the root Driver by
   construction (write-time attribution, not a read-time join); the per-agent label reads
   the latest name among the agent's **own** (non-child) rows; a row with no own-name
   falls back client-side to the id. Note the cutover: rows written before the change
   keep their old attribution.
3. **`docs/ubiquitous-language.md`** — extend the *Agent Attribution* entry (and the
   Invocations section where Egress Aliasing / Driver Cascade are defined) with the spend
   face of the "a target is not an independent principal" rule, and define
   `platform.invocation.id` next to it. Keep entries in the glossary's existing voice and
   format.
4. **Sweep for drift.** Grep `docs/` for "Invocation" and "attribution" and fix any other
   page that now states the old behavior (e.g. `agent-lifecycle.md` if it describes what
   a spawn stamps). Update `Last verified:` on every touched page.

## Acceptance criteria

- [ ] observability.md, metrics.md, and ubiquitous-language.md describe root-Driver spend
      attribution, `platform.invocation.id`, and the label rule consistently with the
      shipped code.
- [ ] No page still claims the telemetry header always carries the agent's own id.
- [ ] No ADR or plan-folder references were added; `Last verified:` dates updated.
- [ ] Formatting passes the repo checks (prettier via the relevant `mise run` check).

## Smoke test

Run the repo's docs/format check (`mise run check` for the touched scope) and print a
short manual guide: read the three updated sections and cross-check each claim against
`envoy_bootstrap.go` (stamping), `invocations-service.ts` (spawn resolution), and
`clickhouse-reader.ts` (label) — the `/doc-drift` skill can be used as the reviewer.
