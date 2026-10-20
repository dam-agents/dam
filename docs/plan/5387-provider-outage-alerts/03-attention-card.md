# 03 — Outage alert in the Approvals panel

**Depends on:** 01-slack-alert
**Part of:** Owners hear when a provider outage hits their unattended agents — see [README](./README.md)

## Context

A Slack DM reaches only an owner who linked Slack.
The Approvals panel reaches every owner, and it already tells an owner that unattended runs fail: it lists the default-model notices next to the approvals, Home's banner counts them, and the panel's badge counts them ([home-feed § Default-model notices](../../architecture/home-feed.md#default-model-notices)).
This slice adds the owner's outage alerts to the same attention list (D4): a card per alert with the affected agents, a count in the panel's badge, and a dismissal in the attention record.
A recovered alert shows for 7 days after the recovery (O6).
The live banner of Provider Status stays as it is: it says that a provider is down; the card says which of the owner's agents it hits.
So this slice adds no line to the banner on Home: during an outage, the Provider Status banner already shows there.

## Implementation plan

Apply `/typescript-engineering` for the server part and `/react-ui-engineering` for the UI part.
The shapes and texts are in [README — The contract](./README.md#the-contract) and [Wording](./README.md#wording).

### The card

No Figma frame exists for this card (O13).
So the card uses only parts that the Approvals panel and the Provider Status banner already have.
It adds no new sizes, colours or icons.

A told alert:

```text
┌──────────────────────────────────────────────────────────┐
│ ● Provider outage                                Dismiss │
│ Anthropic is not responding                              │
│ Since 10:00. 3 of your agents use it and can fail until  │
│ it works again.                                          │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ (C) Coder                            Switch provider │ │
│ │     Calls failed                                     │ │
│ │ (D) Daily Report                     Switch provider │ │
│ │     Schedule                                         │ │
│ │ (S) Support Bot                      Switch provider │ │
│ │     Slack channel · Calls failed                     │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ 12 min ago                            Anthropic status ↗ │
└──────────────────────────────────────────────────────────┘
```

A recovered alert:

```text
┌──────────────────────────────────────────────────────────┐
│ Provider recovered                                       │
│ Anthropic works again                                    │
│ It had problems from 10:00 to 11:42. Runs that failed in │
│ that time do not run again.                              │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ (C) Coder                                            │ │
│ │     Calls failed                                     │ │
│ │ (D) Daily Report                                     │ │
│ │     Schedule                                         │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ 3 min ago                        Anthropic status ↗   OK │
└──────────────────────────────────────────────────────────┘
```

Each part and the part it reuses:

| Part         | Told alert                                                                                                                             | Recovered alert                     | Reuses                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Frame        | The card frame, the header row and the footer row                                                                                      | The same                            | `FeedDefaultModelCard`                                                                                                |
| Meta line    | Warning dot and "Provider outage"; no avatar, because the card is about a provider, not one agent                                      | "Provider recovered", no dot        | The dot of `FeedDefaultModelCard`; no dot for an information-only card, as its "changed" state                        |
| Headline     | "{Provider} is not responding"                                                                                                         | "{Provider} works again"            | The lead of the Provider Status banner, so the user sees one term for the outage                                      |
| Detail       | README § Wording; times with `clockLabel`                                                                                              | The same                            | `clockLabel` of `lib/format-time.ts`, as the banner                                                                   |
| Agent list   | One row per agent, sorted by name: `AgentAvatar` at size 20, the name on line 1, the reasons on line 2, "Switch provider" on the right | The same rows, with no action       | The command box of `FeedApprovalCard` (border, muted background); two lines, so a narrow panel never cuts the reasons |
| Long list    | Five rows, then "Show all {n} agents", and "Show less" when open                                                                       | The same                            | The toggle of `tool-chip.tsx`                                                                                         |
| Footer left  | The time since the start                                                                                                               | The time since the recovery         | `timeAgo`, as `FeedApprovalCard` shows it                                                                             |
| Footer right | "{Provider} status" with the `Launch` icon, when a status page exists                                                                  | The same, and "OK", which dismisses | The status link of the Provider Status banner (`externalLinkProps`); "OK" of the "changed" default-model card         |
| Dismiss      | A text button in the header, shown on hover and on focus                                                                               | "OK" in the footer instead          | `FeedDefaultModelCard`                                                                                                |

"Switch provider" and "Show all {n} agents" are link buttons (`Button` with `variant="link"` and `size="inline"`), as in the Provider Status banner.
"OK" is `Button` with `variant="outline"` and `size="sm"`, as in the default-model card.
The told alert uses the warning tone, which is the tone of the Provider Status banner for a provider outage.
The danger tone stays for the fault on the platform's side.
If the two notice cards then repeat the same frame markup, move the frame into one component in `home/components/`.

1. **Contract** in `packages/api-server-api/src/modules/attention/`:
   - `types.ts`: add `"outage-alert"` to `AttentionItemKind`, add `OutageAlertAffectedBy`, `OutageAlertAgent` and `OutageAlertNotice`, and add `outageAlerts` to `AttentionList`.
   - `schemas.ts`: add `"outage-alert"` to the item kinds that `dismiss` accepts.
   - Export the new types from `src/index.ts`.
     The router and the context field stay as they are.
2. **Server, outage-alerts module:**
   - Repository: `listForOwner(ownerSub, recoveredAfter)` returns the told rows and the recovered rows with `recovered_at` after `recoveredAfter`.
     Put the 7 days in the domain as a constant.
   - Service: `noticesFor(ownerSub, now): Promise<OutageAlertNotice[]>` maps the rows to notices, with the id `${templateId}:${since}:${state}`.
   - Pass the service to the API app through `apps/api-server/deps.ts`, as the provider status service is.
3. **Server, attention module:**
   - `composeAttentionService` and `createAttentionService` get a port `outageAlerts: () => Promise<OutageAlertNotice[]>`, next to `defaultModelNotices`.
   - `listForOwner` reads the alerts beside the default-model notices and returns them in `outageAlerts`.
     It drops an `outage-alert` dismissal whose id is no longer a current alert, as it drops a default-model dismissal; when the read fails, it returns no alerts and drops nothing.
   - `dismiss` accepts the kind `outage-alert` for an id that is one of the caller's current alerts.
   - `apps/api-server/trpc/context.ts`: pass `outageAlerts: () => outageAlerts.noticesFor(user.sub, new Date())`.
4. **Live updates.** Nothing new: slice 01 emits `AttentionChanged`, and the `attention` hint already makes open tabs read the attention list again (O11).
5. **UI** in `packages/ui/src/modules/home/`:
   - `hooks/use-outage-alerts.ts`: the alerts from `useAttention()`, the ones not dismissed (`waiting`), and `dismiss` through `trpc.attention.dismiss` with the kind `outage-alert`, as `use-default-model-notices.ts` does.
   - `lib/outage-alert-copy.ts`: the headline, the detail and the reason labels of README § Wording; the provider name from `providerNameFor`; times in the viewer's local time.
   - `components/feed-outage-alert-card.tsx`: one card per alert, as in [The card](#the-card).
     "Switch provider" calls `navigateToSandboxHome(agentId, "providers")`, as the default-model card does.
     The agent's name and avatar come from the agents the panel already reads (`useFeed`), and fall back to the name the alert stored.
   - `components/approvals-panel.tsx`: the waiting outage cards come first, newest first, above the default-model cards.
     The empty state shows only when no approval, default-model notice or outage alert waits.
   - `components/approvals-banner.tsx` stays as it is.
   - `packages/ui/src/modules/sessions/hooks/use-app-side-panel-tabs.tsx`: the badge also counts the waiting outage alerts.
6. **Docs:**
   - `docs/architecture/home-feed.md`: in "What Home reads", the outage alerts are read beside the default-model notices; a new section "Outage alerts" after "Default-model notices": what the card lists, how long a recovered one stays, that a dismissal is per owner on the server and keyed by template, start time and state, and that the banner on Home does not count it, because the Provider Status banner shows the live outage there.
   - `docs/architecture/provider-status.md`, section "Outage alerts": one sentence with a link to home-feed for the card.
   - Bump `Last verified:` on both pages; run `mise run fix:markdown`.

## Acceptance criteria

- [ ] `mise run check`, `mise run //packages/api-server:test` and `mise run //packages/ui:test` pass; `mise run check:comment-types` passes.
- [ ] `attention.listForOwner` returns only the caller's alerts; another user's alerts never show, and another user's alert id cannot be dismissed.
- [ ] A told alert shows as a card in the Approvals panel in both layouts, with the agents and their reasons, and the panel's badge counts it.
- [ ] Both states of the card match [The card](#the-card), in the light and the dark theme and on a narrow screen, and the card adds no new size, colour or icon.
- [ ] With more than five agents, the card shows five rows and "Show all {n} agents".
- [ ] The banner on Home is the same as before: only the Provider Status banner names the outage there.
- [ ] Dismissing hides the card on every device of the owner; a new outage or the recovery of the same template shows it again; a dismissal whose alert is gone is dropped.
- [ ] A recovered alert shows "works again" and is gone 7 days after the recovery.
- [ ] A new alert appears in an open panel without a reload, through the `attention` hint.
- [ ] "Switch provider" opens the agent's Providers section.
- [ ] The default-model notices and the approvals behave as before.

## Smoke test

On the dev cluster, with the api-server and UI images rebuilt and the chart redeployed with `apiServer.outageAlertDelay: "2m"`:

1. Run steps 1–4 of slice 01's smoke test, with Home open in the standard layout.
2. After the delay, the panel's badge counts the alert without a reload.
   Open the Approvals panel: the card names IBM LiteLLM, the start time and both agents.
   Home shows the outage once, in the Provider Status banner.
3. Turn on the JanUI layout: the Approvals panel shows the same card.
   Switch to the dark theme and to a phone width: the card keeps its layout, and no reason line is cut.
4. Click "Switch provider" on one agent: its Providers section opens.
5. Dismiss the card and reload: it stays dismissed; it stays dismissed in a second browser too.
6. Remove the iptables rules and send again; after the recovery, the card shows again as "works again".
7. Take screenshots of steps 2, 3 and 6 for the PR (Web UI proof), in the light and the dark theme.

Print a short guide so Petr can repeat the steps by hand.
