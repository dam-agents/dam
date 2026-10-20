# 01 — Slack alert for agents with failed calls

**Part of:** Owners hear when a provider outage hits their unattended agents — see [README](./README.md)

## Context

This slice builds the whole alert path for the owners of agents whose model calls failed during an outage.
Provider Status keeps the failed payers of each outage and emits `ProviderStatusEvaluated` after each run, with the evidence that a template answers again.
A new module `outage-alerts` applies the delay, keeps one row per owner and template, and sends a Slack DM when the outage lasts longer than the delay and again when there is evidence that it ended.
Slice 02 adds the unattended agents that did not call during the outage, slice 03 adds the card in the Approvals panel, and slice 04 adds Telegram.
This slice is verified with a simulated outage and the Slack DM.

## Implementation plan

Apply `/typescript-engineering`.
The rules, shapes and texts are in [README — The event](./README.md#the-event), [The alert rules](./README.md#the-alert-rules), [The table](./README.md#the-table) and [Wording](./README.md#wording).

1. **Failed payers in the snapshot** (`packages/api-server/src/modules/provider-status/`):
   - `domain/status.ts`: add `failedPayers: readonly string[]` to `DegradedTemplate`.
     In `nextSnapshot`, a degraded template gets the union of the previous snapshot's `failedPayers` for that template and `failedAgentsOf` of its own buckets.
     A template that is no longer degraded drops them.
   - `infrastructure/redis-status-snapshot.ts`: accept the new field in the zod schema, with `[]` as the default, so a snapshot written before the change still reads.
   - `statusView` stays the same: the query never returns payers.
2. **The evidence** (`domain/`), pure functions:
   - `answeringTemplates(calls)`: the templates whose window passes `hasSucceededCalls` (`domain/window.ts`).
   - `clearedTemplates(readings, streaks, at)` in `domain/public-signals.ts`: for each reading that `answered` accepts, the templates of its source (`SOURCE_TEMPLATES`) minus the templates of its `signalsOf`.
3. **The event.** In `packages/api-server/src/events.ts`, add `EventType.ProviderStatusEvaluated`, its type (README) and its place in the `DomainEvent` union.
   In `services/provider-status-service.ts`, `evaluate(now)` emits it after the snapshot write, with every degraded template, `statusPageUrl` from `STATUS_PAGES`, `damSide`, `answering` and `cleared`.
   Add an arm that returns `null` in `modules/live-events/sagas/live-hints.ts`.
4. **The table.** In `packages/db/src/schema.ts`, add `outageAlerts` (README § The table) next to `resourceAlerts`, export it from `packages/db/src/index.ts`, and generate the migration with `mise run //packages/db:generate`.
5. **The module** `packages/api-server/src/modules/outage-alerts/`, with `modules/resource-alerts/` as the model:
   - `domain/alert-rules.ts`: pure functions.
     `tellable(outage, damSide, checkedAt, delayMs)`; `toRecover(toldRows, event)` returns the told rows whose template is not degraded and that have evidence (README § The alert rules).
   - `domain/messages.ts`: `outageMessage(...)` and `recoveryMessage(...)` with the README texts, the provider name by the rule in [Conventions](./README.md#conventions--glossary), Slack date tokens, at most 10 agent lines, the Home URL and the status page link.
   - `infrastructure/outage-alerts-repository.ts`: `listTold()`, `read(ownerSub, templateId)`, and `claim(ownerSub, templateId, seenVersion, next)` with the compare-and-set of `ResourceAlertsRepository.claim`.
     A "told" write stores the outage's reason.
   - `services/outage-alerts-service.ts`: `handle(event)` applies the README rules.
     The affected agents of an outage come from a port `affectedAgents(outage)`; in this slice it maps each failed payer through `describeAgent` and gives the reason `failed-calls`.
     Skip a payer whose agent is gone or disabled.
     After each won claim, emit `AttentionChanged { ownerSub, agentId }` with the first agent of the row, then call `notify(ownerSub, text)`.
     Log a send that reached no Slack identity, as resource alerts do.
   - `sagas/alert-on-outage.ts`: subscribe to `ProviderStatusEvaluated` with `concatMap`, call `handle`, log and continue on an error.
   - `compose.ts` (`composeOutageAlerts({ db, notify, describeAgent, uiBaseUrl, brandName, delayMs })` returns the service and `startSaga()`) and `index.ts`.
6. **The delay.** `helm/values.yaml`: `apiServer.outageAlertDelay: "15m"` with a `# --` comment, next to `approvalHoldSeconds`.
   `helm/templates/apiserver/app.yaml`: env `OUTAGE_ALERT_DELAY`.
   `packages/api-server/src/config.ts`: `outageAlertDelayMinutes`, read in the loader with `durationToMinutesStrict(process.env.OUTAGE_ALERT_DELAY ?? "15m")`, as `agentIdleTimeoutMinutes` is.
7. **Wiring** in `packages/api-server/src/bootstrap.ts`, after the provider status job:
   - `notify: (ownerSub, text) => channelManager.notifyPerson(ownerSub, text)`;
   - `describeAgent: async (id) => { const a = await agentsRepo.get(id); return a && { ownerSub: a.owner, name: a.name, disabled: a.disabled }; }` (the real owner from the Agent's label);
   - `brandName: config.brand.name` and `delayMs` from `config.outageAlertDelayMinutes`;
   - start the saga, and unsubscribe at shutdown next to `providerStatusSaga`.
8. **Docs:**
   - `docs/architecture/provider-status.md`: in "The snapshot and the job", one sentence that each run emits the evaluated state with its evidence; a new section "Outage alerts": the delay, one row per owner and template with compare-and-set, the tell and recover rules, the evidence a recovery needs, the fault on the platform's side, the Slack DM, and who is told (owners of agents with failed calls).
     Bump `Last verified:`.
   - `docs/architecture/channels.md`, "The platform can message a linked person": name the outage alert next to the resource alert.
   - `docs/ubiquitous-language.md`, Provider Status: the term Outage Alert.
   - Run `mise run fix:markdown`.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/api-server:test` pass; `mise run check:comment-types` passes.
- [ ] `providerStatus.list` returns the same shape as before; no payer ids reach the UI.
- [ ] A degraded template keeps the failed payers of earlier runs while it stays degraded.
- [ ] Each evaluate run emits exactly one `ProviderStatusEvaluated`, also with no outages.
- [ ] No message goes out before the delay; one message per owner goes out after it.
- [ ] A second run after the message sends nothing more to that owner.
- [ ] When the template is no longer degraded and has evidence, the owner gets one recovery message, and the row reads "recovered".
- [ ] When the template is no longer degraded and has no evidence, nothing is sent, and the row stays "told".
- [ ] A gateway-only outage while the fault is on the platform's side sends no new message.
- [ ] An outage that ends before the delay sends nothing.
- [ ] The message names the platform's own provider with the brand name, and a template outside the presets with its id.
- [ ] The module imports no other module's internals; it gets its ports from `bootstrap.ts`.

## Smoke test

On the dev cluster, with the api-server image rebuilt and the chart redeployed with `apiServer.outageAlertDelay: "2m"` (from a worktree, pass `--helm-values=` with the main checkout's `values-dev.yaml`, or Slack is off):

1. Link Slack for the dev user, and prepare two agents on IBM LiteLLM.
   Boot them.
2. Cut IBM LiteLLM off with the iptables recipe (REJECT in the Lima VM) and delete the agents' gateway pods.
3. Send two messages to each agent.
4. Within about 4 minutes, one Slack DM names IBM LiteLLM, the start time and both agents with "calls failed".
   The `outage_alerts` row reads `told`.
5. Wait 2 more minutes: no second DM.
6. Remove the rules and send again.
   Within about 6 minutes, one recovery DM arrives and the row reads `recovered`.
7. Cut off again for less than 2 minutes, then remove the rules: no DM.
8. Cut off only the agents' calls: add the REJECT rule with `! -s <api-server pod IP>`, so the readiness check still passes.
   Send messages until the DM arrives, then stop sending for 7 minutes and keep the rule: no recovery DM, and the row still reads `told`.
   Remove the rule and send again: within about 6 minutes, the recovery DM arrives.

Print a short guide so Petr can repeat steps 2–8 by hand.
