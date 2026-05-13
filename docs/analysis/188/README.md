# #188 — Implementation plan

Concrete implementation plan for [#188](https://github.com/dam-agents/dam/issues/188) (`dam instances create` and template discovery). Each phase is a self-contained sub-issue an agent can execute without reading the spec.

## How to use

1. Pick the lowest-numbered phase whose prerequisite is satisfied.
2. Read **that file only** — it has full context, file paths, snippets, and the smoke-test checklist needed to land the work.
3. Run the smoke test from §"Verification" before declaring the phase done. Do not start the next phase until smoke test passes.

## Phases

| # | File | Goal | Blocks |
|---|------|------|--------|
| 1 | [phase-1-server.md](phase-1-server.md) | Widen `Instance` projection (`templateId`, `image`); convert template-not-found to typed `TRPCError({ code: "NOT_FOUND" })` | All of 2–5 |
| 2 | [phase-2-cli-refactor.md](phase-2-cli-refactor.md) | Extract shared CLI error helpers, lift trpc-client to `shared/trpc/`, align existing user-facing strings to the UX conventions | 3, 4 |
| 3 | [phase-3-templates-create.md](phase-3-templates-create.md) | New `templates/` CLI module + `dam templates list`; new `dam instances create` with `--wait`, `--env`, `--description`, rollback | 4 |
| 4 | [phase-4-delete-restart.md](phase-4-delete-restart.md) | `dam instances delete` (with confirmation prompt) and `dam instances restart` (with `--wait` + 2 s grace) | 5 |
| 5 | [phase-5-docs.md](phase-5-docs.md) | Add lifecycle section to [`docs/architecture/cli.md`](../../architecture/cli.md); bump `Last verified:` | — |

## References

- [Issue #188](https://github.com/dam-agents/dam/issues/188)
- [Analysis](../188-instances-create.md) — scope, lifecycle model, RPC sequencing
- [Spec](../188-instances-create-spec.md) — locked UX conventions (§1), test strategy (§5), phase smoke tests (§6)
