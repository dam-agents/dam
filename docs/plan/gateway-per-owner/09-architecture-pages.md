# 09 — Architecture pages

**Depends on:** 08
**Part of:** gateway per owner — see [README](./README.md)

## Context

The architecture pages are the source of truth and describe the per-agent gateway throughout.
This slice rewrites them for the owner gateway, following `docs/guidelines/documentation-guidelines.md` (one sentence per line, no ADR references).

## Implementation plan

1. `security-and-credentials.md`: overview rule 3, the diagram, "Intra-cluster identity and admission" (per-owner SA, per-agent Service port as identity, harness path guard), the gateway egress policy, and the new blast radius (one gateway process holds the owner's vm Agents' keys).
2. `credential-gateway.md`: per-owner configuration, file-watched listeners, per-owner credential Secret and leaf, what a change of one agent costs the others, rotation.
3. `vm-runner.md`: the allowlist line, the gateway's ingress policy line, the runner's egress policy, transparent egress paragraph.
4. `agent-lifecycle.md`: owned resources, Wake (no gateway scale), Hibernate.
5. `platform-topology.md`: the gateway section and the owned-resources paragraph; `spend-limits.md`, `observability.md` (attribution is per listener), `budgets.md`, `vm-host-runner.md`, `vm-runtime-migration.md` where they name the paired gateway pod.
6. Run the `doc-drift` skill on the branch.

## Acceptance criteria

- [ ] No page describes a vm Agent's gateway as a pod of its own or as scaling with hibernation.
- [ ] `mise run //docs:check` and `mise run check:markdown` pass.

## Smoke test

`mise run fix:markdown && mise run //docs:check && mise run check:markdown`, then `/doc-drift`.
