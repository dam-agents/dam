# Resource alerts

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4759 (epic https://github.com/dam-agents/dam/issues/4753)

## Goal

A user hears about a severe resource problem even when they are not looking at the web app.
A Slack direct message tells them when their agents' shared storage is nearly or completely full, and when their VM agents all restarted because their memory ran out.
Each message says what happened and what to do.
When the platform puts an idle agent to sleep early to make room, the agent says so.

## Approach

**The platform can DM a person.**
Slack identity links ([channels](../../architecture/channels.md)) already map a user to their Slack user ids; a link now also records its workspace.
The Slack worker gains one platform-owned send, `notifyPerson`, that opens a DM with each linked Slack identity and posts as the app, not as an agent.
It runs on the channel leader, and other replicas reach it over the existing channel RPC.
An unlinked user, a workspace whose credential is rejected or that lacks `im:write`, and an install without Slack all send nothing.

**Alerts are evaluated unattended, once, with their state in Postgres.**

- **Storage**: a periodic job every 5 minutes reads each owner's runner usage (the read-only usage read [persistence](../../architecture/persistence.md) describes) and sends at most one DM per level.
  Levels: `high` at ≥90% (the runner refuses new, starting and restarting machines) and `full` at ≥98% (writes are failing).
  A reading below 80% re-arms; at most one DM per 24 h, except one escalation from `high` to `full`.
- **Runner OOM**: the agent watch sees `RunnerOutOfMemory` on an owner's agents ([vm-memory](../../architecture/vm-memory.md)) and, after a short collection window, sends one DM naming every affected agent.
  It re-arms once none of the owner's agents carries the reason, with at least 6 h between DMs.
- A send first claims its slot with a compare-and-set update, so a double tick or a lease handover never sends twice.
  At most once is the intent.
- The level thresholds reuse the budgets domain's `poolLevel()` where it exists on main; `full` (98%) is this feature's own constant.

**Reclaim says so.**
A reclaimed agent already carries the controller's `reclaimed-at` annotation ([budgets](../../architecture/budgets.md)).
The api-server derives `reclaimed { at, for }` from it while the agent sleeps and no newer activity outdated it; a vm agent was reclaimed for memory, a container agent for compute.
The UI shows it in the unavailable overlay, the row's status tooltip and a one-time toast.
This replaces the decision that reclaiming is silent, so it ships with a new ADR.

No CRD and no CRD field change.

## Sub-issues

| #   | Title                                          | Scope                                                              | Depends on             |
| --- | ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------- |
| 01  | The platform can DM a person on Slack (done)   | identity link workspace, `notifyPerson`, channel RPC               | —                      |
| 02  | Unattended resource alerts (done)              | Postgres alert state, storage poll, OOM watch, repeat limits, copy | 01, #4757 (usage read) |
| 03  | A reclaimed agent says why it is asleep (done) | api-server `reclaimed`, overlay, row tooltip, toast, ADR           | —                      |

## Conventions & glossary

- **High / full**: storage at ≥90% / ≥98% of the owner's pool.
- **Re-arm**: the point at which the next crossing may send again (storage below 80%; OOM once every affected agent recovered).
- **Linked user**: a user with a Slack identity link, made by `/dam login` or an in-chat bind.
- Replies to an alert DM are not handled; a reply behaves like any message to the app in that DM.
- Code comments follow `docs/guidelines/comment-guidelines.md`; run `mise run //:check:comment-types`.
- Server-side TS: apply `/typescript-engineering`.
  UI: apply `/react-ui-engineering`.

## Whole-feature smoke test

On a local cluster with virtualization and a fake Slack workspace:

1. Link the dev user with `/dam login`.
2. Give the user a small storage pool; `fallocate` in a guest past 90%: one DM arrives within 5 minutes; nothing more at 92%; one more past 98%.
3. Fill memory past the pool in two guests: one DM names both agents.
4. Run more vm agents than the pool holds: the idle one shows "put to sleep early to free memory".

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4759.
