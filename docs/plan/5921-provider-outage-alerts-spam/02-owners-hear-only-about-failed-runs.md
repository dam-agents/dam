# 02 — Owners hear only about failed scheduled runs

**Part of:** Outage messages only where work failed — see [README](./README.md)

## Context

Outage alerts today tell an owner when any call of their Agents failed, web chat included, and when their Agents only *could* fail, because a Schedule or a channel fires on the template.
This slice replaces both rules with one: an Agent is affected only when a scheduled run made a failed call to the template since the outage started.
It also sends each owner one copy (Slack first, Telegram only when Slack reaches nobody), lets the stored Agent list grow without a message, and rewrites the message and card copy.
It covers AC-1, AC-2, AC-5, AC-6 and AC-7.

## Implementation plan

Apply `/typescript-engineering` to the api-server changes and `/react-ui-engineering` to the card copy.

1. **Carry the Session on the call event.**
   Add `callingAgentId: string` and `sessionId: string | null` to `GatewayCallEnded` in `packages/api-server/src/events.ts`.
   `packages/api-server/src/modules/spend/services/spend-ingest.ts` sets them from the record (`record.agentId`, `record.sessionId`).
   Provider Status ignores the new fields.

2. **Share the failed-call rule.**
   Export `outcomeOf` (and its `GatewayCall` type) from `packages/api-server/src/modules/provider-status/index.ts`, so `outage-alerts` counts a failed call exactly as detection does.

3. **Add the failed-work store.**
   New `packages/api-server/src/modules/outage-alerts/infrastructure/redis-failed-work.ts`, in the style of `provider-status/infrastructure/redis-call-window.ts`:
   - one sorted set per template, member = a small JSON entry, score = the failure time in ms;
   - entry kind `session`: `{ kind: "session", agentId, sessionId }` (the calling Agent and its stamped Session);
   - `record(templateId, entry, at)` writes with `ZADD GT`, so a member keeps its latest failure, trims members older than 24 hours, and sets a 24-hour expiry on the key;
   - `since(templateId, since)` returns the entries with a score at or after `since`.

   Make the entry a discriminated union now; slice 03 adds the kind `ambient`.
   `composeOutageAlerts` gets `redis` as a new dependency.

4. **Record failed calls.**
   A new saga in `packages/api-server/src/modules/outage-alerts/sagas/` subscribes to `GatewayCallEnded`.
   For a call where `outcomeOf` says failed and `sessionId` is set, it records a `session` entry under the call's template.
   It logs and drops a Redis error; it never throws into the bus.
   Start it beside `startAlertOnOutageSaga` in `compose.ts`, so `startSaga` returns both, or return one merged subscription.

5. **Decide who is affected.**
   In `packages/api-server/src/modules/outage-alerts/services/outage-alerts-service.ts`, rewrite `affectedOwners(outage)`:
   - read `failedWork.since(outage.templateId, outage.since)`;
   - look up the `session` entries in one call to the Session directory's `categorize(agentIds, sessionIds)` (`packages/api-server/src/modules/session-directory/services/session-directory-service.ts`), injected as a function;
   - keep the entries whose Session is in the category `scheduled`; each gives its `agentId` the reason `schedule`;
   - a failed directory read counts as no evidence for that run, logged, and the next run tries again;
   - then group by owner with `describe`, as today (disabled and deleted Agents drop out).

   It runs only for outages that pass `tellable`, so the delay and the platform-side rule stay.

6. **Tell once, then grow quietly.**
   In `tell`: when the stored alert is already `told` for the same outage, write the merged Agent list (old plus new, sorted by name) with `repo.claim` and send no message, and only when the list grew; otherwise keep today's path.
   Emit `AttentionChanged` after a quiet growth too, so the card updates.
   Recovery is unchanged: it reads the stored list, so the recovery message names every Agent.

7. **Remove the old rules.**
   - Delete `packages/api-server/src/modules/outage-alerts/services/unattended-agents.ts` and its test.
   - Drop the dependencies `unattendedCandidates`, `enabledSchedules` and `fireTemplate` from `composeOutageAlerts` and from its call in `packages/api-server/src/bootstrap.ts`.
     If slice 01 already landed, the template resolution it extracted stays for the channel workers.
   - Delete `createUnattendedAgentsReader` (`packages/api-server/src/modules/harness-config/infrastructure/unattended-agents.ts`) and its export from `harness-config/index.ts`; outage alerts were its only user.
     `unattended-work.ts` stays: the default-model notices use it.
   - Stop reading `failedPayers` in the alerts.
     If nothing else reads it, remove `failedPayers` from `ProviderStatusEvaluated` and from the snapshot in `provider-status` (`domain/status.ts`, `infrastructure/redis-status-snapshot.ts`, `services/provider-status-service.ts`), and make sure a snapshot written by the previous version still parses.

8. **The affected reasons.**
   In `packages/api-server-api/src/modules/attention/types.ts`, `OutageAlertAffectedBy` loses `failed-calls`; `schedule` now means "a scheduled run failed", and `slack` and `telegram` stay for slice 03.
   In `outage-alerts-repository.ts`, parse each Agent's `affectedBy` so that an unknown value in an older row is dropped, not a parse failure of the whole list.

9. **One copy per owner.**
   In `packages/api-server/src/modules/channels/services/channel-manager.ts`, `notifyPerson` sends to Slack first and to Telegram only when Slack reached nobody (`sent === 0`), instead of both at once.
   The RPC schema does not change.

10. **Message copy.**
    In `packages/api-server/src/modules/outage-alerts/domain/messages.ts`:
    - outage: "`<Provider>` has had an outage since `<time>`.
      Work that ran on its own failed for these agents of yours:", then the Agent lines, then "Runs that failed do not run again.
      Wait, or switch an agent to another provider: `<home>`", then the status line;
    - the Agent line label for `schedule`: "scheduled run failed";
    - the recovery message keeps its shape ("works again … check the last runs of").

11. **Card copy.**
    In `packages/ui/src/modules/home/lib/outage-alert-copy.ts`:
    - the told detail: "Since `<time>`.
      Work that ran on its own failed for 1 of your agents."
      / "… for N of your agents.";
    - the label for `schedule`: "Scheduled run failed"; remove the `failed-calls` label;
    - `outageAlertDismissHint` keeps its meaning.

12. **Docs and Helm.**
    - `docs/architecture/provider-status.md`, section **Outage alerts**: rewrite who is affected (failed scheduled runs, from the stamped Session and the directory), the failed-work record and its 24 hours, the quiet growth, one copy per owner, and remove the "could fail" rules and the failed-payers sentence in **The snapshot and the job** if step 7 removed them.
    - `docs/architecture/home-feed.md`, section **Outage alerts**: the card shows only after an owner's unattended work failed.
    - `docs/architecture/channels.md`: the two `notifyPerson` bullets say Telegram gets a notice only when Slack reached nobody.
    - `helm/values.yaml`: the comment on `outageAlertDelay` says the delay is how long an outage lasts before owners whose unattended work failed get a message.
    - Update `Last verified:` on each page.

## Acceptance criteria

- [ ] An outage with no failed call in a schedule Session tells nobody, whatever Schedules and channels the Agents have (AC-1).
- [ ] A failed call in a chat Session tells nobody (AC-2).
- [ ] A failed call in a schedule Session, once the outage passed the delay, tells the owner once, naming the Agent (AC-5).
- [ ] A failure of another of the owner's Agents in the same outage sends nothing, and the card lists both Agents (AC-6).
- [ ] Recovery sends one message that names every Agent in the stored list (AC-7).
- [ ] An owner with a Slack link gets no Telegram copy; an owner without one gets the copy in their private Telegram chats.
- [ ] `unattended-agents.ts` (both files) and `createUnattendedAgentsReader` are gone, and nothing references them.
- [ ] A stored alert with `failed-calls` in it still reads.
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.

## Smoke test

Run `mise run test` for the api-server (`outage-alerts`, `provider-status`, `spend-ingest`, `channel-manager` tests) and the UI (`outage-alert-copy`), then `mise run check`.

Then on the local dev cluster ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)), with `apiServer.outageAlertDelay` at `2m` and two Agents on Anthropic, each with a Schedule:

1. Wake both Agents, block Anthropic's API address in the cluster VM as the README describes, and delete both gateway pods.
2. Wait past the delay with no run: no Slack direct message, no card in Approvals (AC-1).
3. Send a web chat message to one Agent; the turn fails; no message follows (AC-2).
4. Press Run now on the first Agent's Schedule; within five minutes the owner gets one Slack direct message naming that Agent, and the card shows (AC-5).
5. Press Run now on the second Agent's Schedule; no new message; the card lists both Agents (AC-6).
6. Remove the rule, then send a web chat message to one Agent so a call succeeds; within five minutes one recovery message names both Agents (AC-7).

Print a short manual guide for the user with the same steps and what each message says.
