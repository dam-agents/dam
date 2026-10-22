# 03 — CLI ceiling commands

**Depends on:** 02-ceilings-in-postgres
**Part of:** Spend ceilings in Postgres, set by platform operators — see [README](./README.md)

## Context

Operators need a way to manage ceilings from a terminal, without cluster access.
This slice adds `dam spend ceiling list|set|clear` on top of the `spend.ceilings` procedures from 02 ([Contract](./README.md#contract-pinned)).
The commands sit next to `dam spend limit`, which an owner uses for their own limits.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Service** — [`packages/cli/src/modules/spend/services/spend-service.ts`](../../../packages/cli/src/modules/spend/services/spend-service.ts): add `listCeilings()` and `setCeiling(input)` over `spend.ceilings.list` and `spend.ceilings.set`, in the same style as the existing calls.
2. **Commands** — new [`packages/cli/src/modules/spend/commands/ceiling.ts`](../../../packages/cli/src/modules/spend/commands/): `buildCeilingCommand(deps)` returns a `ceiling` command with three subcommands.
   Follow [`limit.ts`](../../../packages/cli/src/modules/spend/commands/limit.ts) for host resolution, `--server`, `--json`, input errors and service errors.
   - `dam spend ceiling list`: first a line with the default ("Default spend ceiling: $50.00 a day" or "No default spend ceiling"), then a table with `renderTable`: User, Spend ceiling, Set by, Changed.
     A user or setter without an email shows the sub.
     "Changed" is in the reader's local time.
     With no rows, print "No user has a spend ceiling of their own."
   - `dam spend ceiling set <amount> --user <user>`: parse `<amount>` with `spendCeilingUsdTextSchema` (dollars, at most 2 decimals); print what was set, for whom, and that it applies to the user's next model call.
   - `dam spend ceiling clear --user <user>`: send `amountMicros: null`; print that the user now has the default ceiling, or none when the default is off.
   - `--user` takes an email, or the sub that `list` shows for a user without an email: a value with `@` is `{ email }`, any other value is `{ ownerSub }`.
     It is required for `set` and `clear`.
   - A `FORBIDDEN` answer prints one line that says the command needs the platform operator role, and exits with the code the CLI uses for a refused request.
     A `NOT_FOUND` answer prints the server's message.
3. **Register** — [`packages/cli/src/modules/spend/compose.ts`](../../../packages/cli/src/modules/spend/compose.ts): add the command, and extend the `spend` description so it mentions that operators set Spend Ceilings.
4. **Docs** — [`docs/architecture/cli.md`](../../architecture/cli.md): extend the `spend` bullet with the operator commands that list, set and clear a user's Spend Ceiling, owned by [spend-limits.md](../../architecture/spend-limits.md#spend-ceiling).
   In [`spend-limits.md`](../../architecture/spend-limits.md) › Spend ceiling, name the command where the section says how an operator sets a ceiling.

## Acceptance criteria

- [ ] `dam spend ceiling --help` lists `list`, `set` and `clear`, and each subcommand's help names its arguments and options.
- [ ] As an operator, `set 12.50 --user <email>`, `list` and `clear --user <email>` work against the dev cluster, and `--json` prints the raw answer of each.
- [ ] `set 12.505 …` fails locally with the amount rule, before any request.
- [ ] `set` and `clear` without `--user` fail with a usage error.
- [ ] As a non-operator, each subcommand prints the operator role message and exits non-zero.
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.

## Smoke test

Run it yourself, then print a short guide so the user can repeat it.
Build the CLI with `mise run` (see [`packages/cli/.mise/`](../../../packages/cli/.mise/)) and point it at the local dev cluster (`cluster-ops` skill; `DAM_TOKEN` and `DAM_SERVER` for a headless login):

1. As `dev`: `dam spend ceiling set 12.50 --user <second-user>@platform.local`, then `dam spend ceiling list` shows the row with `dev`'s email and the local time.
2. As `dev`: `dam spend ceiling set 5 --user <second-user>@platform.local`, then `list` shows `$5.00` and a newer time.
3. As the second user: `dam spend status` shows the $5.00 spend ceiling, set by the operator.
4. As the second user: `dam spend ceiling list` prints the operator role message and exits non-zero.
5. As `dev`: `dam spend ceiling clear --user <second-user>@platform.local`, then `list` no longer shows the user.
