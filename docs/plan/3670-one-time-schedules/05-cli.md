# 05 — CLI

**Depends on:** 01-once-spec-and-fire-path
**Part of:** One-time tasks — see [README](./README.md)

## Context

The CLI is a full surface for Schedules today, so one-time tasks need the same: create one at a moment or now, edit it while pending, and read its state. Thin layer over the tRPC procedures from slice 01. Apply **/typescript-engineering**.

## Implementation plan

1. **Client** — `packages/cli/src/modules/schedule/services/schedule-service.ts`: `createOnce`, `updateOnce` beside `createRRule` (l.93) / `updateRRule` (l.103).
2. **`create`** — `commands/create.ts` (flags l.50-85): add `--once`, `--at <YYYY-MM-DD HH:mm>`, `--now`. With `--once`: exactly one of `--at`/`--now` (else invalid-input exit code); `--timezone` defaults to the machine's zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`); reject `--daily/--every/--rrule/--weekdays/--quiet-window/--session-mode/--precheck` with `--once`. Convert `--at` to the contract's `YYYY-MM-DDTHH:mm`. Output (and `--json`) includes the resolved instant.
3. **`update`** — `commands/update.ts` (l.51-82): when the target is a once, accept `--name`, `--task`, `--at`, `--timezone`; reject recurrence/precheck flags. Keep the read-merge-write convention the CLI uses for full-replace mutations if `updateOnce` is full-replace; otherwise send the patch.
4. **`list` / `get`** — `commands/list.ts` `cadenceOf` (l.24): once renders as `once <local time> <tz>`; add or reuse a state column showing the derived state (`pending` / `delivering` / `completed` / `missed` / `failed`, rules in the README). `get.ts` shows the same. `enable`/`disable` on a once surface the server rejection.
5. Update the command help text; no new exit codes unless the existing invalid-input and schedule-not-found ones don't fit.

## Acceptance criteria

- [ ] `dam schedule create <agent> --once --now --task "…" --name t1` fires immediately and prints the resolved instant.
- [ ] `dam schedule create <agent> --once --at "2026-10-01 08:30" --timezone Europe/Prague --task "…"` stores 06:30Z; a past `--at` is rejected; `--once --every 5m` is rejected.
- [ ] `dam schedule list <agent>` shows once rows with their moment and derived state; `--json` carries `type: "once"`.
- [ ] `dam schedule update <id> --task "…"` works on a pending once and fails with a clear message after it fired.
- [ ] `mise run //packages/cli:check` and `mise run //packages/cli:test` green.

## Smoke test

- `mise run //packages/cli:check && mise run //packages/cli:test`.
- Against the local cluster: the four commands from the acceptance criteria, watching `dam schedule list` go `pending` → `delivering` → `completed`.
