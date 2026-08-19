# 06 — Owner-wide schedule list

**Part of:** A Home page — see [README](./README.md)

## Context

The schedules widget shows the user's top five schedules across every sandbox, and a "See all" modal
over the rest. `schedules.list` today requires an `agentId` and checks the caller against that one
agent, so there is no way to ask for "my schedules". This is the plan's only contract change; slice 07
builds the widget on top of it.

This is server-side TypeScript — apply `/typescript-engineering`. There is no `schedules.md`; the
subsystem is documented in [agent-lifecycle](../../architecture/agent-lifecycle.md) — Postgres rows
owned by the api-server, each armed as a delayed job on a Redis-backed queue, with quiet-hours
skipping and per-schedule session continuity. Read that before changing its surface.
Note the plan's other slices are UI; keep this one narrow.

## Implementation plan

### 1. The contract — `packages/api-server-api/src/modules/schedules/`

`router.ts` today:

```
list: readAgentProcedure.input(scheduleListInputSchema)  // agentId: z.string().min(1)
  → checkAgentBinding(ctx, input.agentId)
  → ctx.schedules.list(input.agentId)
```

Add an owner-scoped read beside it rather than loosening `list`. Loosening `list` would make `agentId`
optional and turn one authorization check into a branch — the existing per-agent call keeps its
`checkAgentBinding` exactly as it is, and the new procedure carries its own owner-scoped check. Two
procedures with one rule each beats one procedure with two.

Model the authorization on `approvals.listForOwner`, which is the existing precedent for an
owner-scoped list, and follow whichever procedure wrapper it uses.

The view type each schedule returns should stay the one `list` already produces via `toView`, so slice
07 renders the same shape the per-agent panel does. Each schedule must carry the agent it belongs to —
the widget lists across sandboxes, so an item without its agent is unusable.

### 2. The service — `packages/api-server/src/modules/schedules/`

Add the owner-scoped query to the schedules service and its repository. Filter by owner in the query,
not in application code after fetching everything — this is a list that grows with the install.

Order and bound it in the repository: the widget wants the top five, and "See all" wants the rest, so
the natural shape is a sorted list with a limit the caller passes. Sort by next run time, since that is
what a user scanning a schedule widget wants to know; confirm against the prototype before fixing the
order.

### 3. The client hook — `packages/ui/src/modules/schedules/api/queries.ts`

Add `useOwnerSchedules()` beside the existing `useSchedules(agentId)`, `prefetchSchedules` and
`fetchSchedulesForAgent`. Keep the existing per-agent hooks untouched — the sandbox-level schedules
panel still uses them.

Make sure the schedule mutations in `api/mutations.ts` (`useToggleSchedule`, `useCreateSchedule`,
`useUpdateSchedule`, `useDeleteSchedule`) invalidate the new owner-scoped key as well as the per-agent
one, or slice 07's toggle will not refresh. This is the easiest thing in the slice to forget and the
first thing to break.

### 4. Live updates

`ScheduleFired` already flows through the live-events invalidation map. Check whether the new key is
covered there; if not, add it, so a schedule firing updates the widget without a refresh.

## Acceptance criteria

- [ ] `mise run --force api-server:check`, `--force api-server:test`, `--force ui:check`,
      `--force ui:test` and `--force common:check:comment-types` pass.
- [ ] An owner-scoped procedure returns the caller's schedules across all their sandboxes, each
      carrying its agent.
- [ ] `schedules.list` keeps its per-agent signature and its `checkAgentBinding` unchanged.
- [ ] The owner-scoped read cannot return another owner's schedules — verified by a test, since this is
      an authorization boundary and manual checking will not cover it.
- [ ] Owner filtering happens in the query, not after fetching.
- [ ] The schedule mutations invalidate the owner-scoped key as well as the per-agent one.
- [ ] The sandbox-level schedules panel still works unchanged.

## Smoke test

```sh
mise run --force api-server:check
mise run --force api-server:test
mise run --force ui:check
```

Then, with two sandboxes each carrying a schedule, call the new procedure directly — the CLI or the
tRPC panel is enough — and confirm it returns both schedules with their agents, and that
`schedules.list` for one agent still returns only that agent's.

This slice is the one place a test is worth writing rather than leaning on manual checks: it introduces
an authorization boundary, and "does this leak another owner's data" is not something a dev-cluster
smoke test can answer. Add the owner-isolation test.

Run this, then print a short manual smoke-test guide so the user can confirm it by hand.
