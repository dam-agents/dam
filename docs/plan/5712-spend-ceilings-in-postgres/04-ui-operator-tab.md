# 04 — Settings › Operator tab

**Depends on:** 02-ceilings-in-postgres
**Part of:** Spend ceilings in Postgres, set by platform operators — see [README](./README.md)

## Context

Operators also manage ceilings in the web UI.
This slice adds an Operator tab to Settings that only platform operators see, the way only role holders see the Slack workspaces and Analytics tabs.
Its first section is Spend ceilings: the default, the users with a ceiling of their own, and a dialog to set, change or remove one.
The tab is named for the role, not the subject, because later operator acts (compute budgets first) join it as more sections.
No Figma frame exists for it, so the design reuses the primitives of the API keys list and the spend limit dialog; take every size from those primitives, and do not invent one.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. **Availability** — new module `packages/ui/src/modules/operator/`:
   - `api/queries.ts`: `useOperatorAvailability()` over `trpc.operator.status.queryOptions()`, returning the query; its `data?.isOperator` gates the tab.
2. **Route** — [`packages/ui/src/modules/platform/lib/routes.ts`](../../../packages/ui/src/modules/platform/lib/routes.ts): add `"operator"` to `settingsTabSchema`, after `"analytics"`.
   [`packages/ui/src/lib/document-title.ts`](../../../packages/ui/src/lib/document-title.ts): add `operator: "Operator"`.
3. **Settings** — [`packages/ui/src/modules/settings/views/settings-view.tsx`](../../../packages/ui/src/modules/settings/views/settings-view.tsx): add the `operator` tab when `isOperator` is true, after Analytics.
   Treat it exactly as `analytics` in `hiddenTab` and `hiddenTabSettled`, so a non-operator who opens the URL lands on Account once the status query settles.
   Render `<OperatorView />` for the tab.
4. **View** — `packages/ui/src/modules/operator/views/operator-view.tsx`: a `PageHeader` titled "Operator", with a description such as "Settings that apply to every user of {brand}.", from `getBrand()`.
   Below it, the Spend ceilings section from the spend module.
5. **Section** — `packages/ui/src/modules/spend/components/spend-ceilings-section.tsx`, built like [`api-keys-list.tsx`](../../../packages/ui/src/modules/api-keys/components/api-keys-list.tsx) and [`api-key-row.tsx`](../../../packages/ui/src/modules/api-keys/components/api-key-row.tsx):
   - A `ListSection` titled "Spend ceilings", with a `HelpTip` ([`help-tip.tsx`](../../../packages/ui/src/modules/spend/components/help-tip.tsx)): "The most a user's agents may spend on paid providers in one UTC day.
     At the ceiling, their model calls stop until the day resets, and nobody can continue them."
   - One line for the default, from `defaultMicros`: "Users without their own spend ceiling: $50.00 a day", or "No default spend ceiling.
     Users without their own have none."
   - One `LIST_ROW` row per entry: the user's email (else the sub), the daily amount, and a muted line "Set by {setter email or sub}, {local date and time}".
     The row has a "Change" button that opens the dialog for that user, and a `RemoveButton` that clears the ceiling (`amountMicros: null`), with an accessible label that names the user.
   - An `AddRow` "Set a spend ceiling" that opens the dialog with no user.
   - With no entries, the list shows "No user has a spend ceiling of their own."
   - While the list loads, and when it fails, follow what the API keys list does.
6. **Dialog** — `packages/ui/src/modules/spend/components/spend-ceiling-dialog.tsx`, modelled on [`spend-limit-dialog.tsx`](../../../packages/ui/src/modules/spend/components/spend-limit-dialog.tsx) (`Modal`, `DialogHeader`, `DialogBody`, `DialogActions`, `Input`):
   - For a new ceiling: an email `Input` and an amount `Input`.
     For a row: the user as text, and the amount filled in.
   - Validate the amount with `spendCeilingUsdTextSchema`, and show its message under the field, as the limit dialog does.
   - On save, call the mutation with `{ email }` for a new ceiling or `{ ownerSub }` for a row.
     A `NOT_FOUND` answer shows the server's message under the email field and keeps the dialog open; other errors use the mutation's error toast.
   - A line under the amount says that the ceiling applies to the user's next model call.
7. **Mutation** — [`packages/ui/src/modules/spend/api/mutations.ts`](../../../packages/ui/src/modules/spend/api/mutations.ts): `useSetSpendCeiling()` over `trpc.spend.ceilings.set.mutationOptions()`, invalidating `trpc.spend.ceilings.list.queryKey()` and `trpc.spend.status.queryKey()` (the operator's own ceiling can change), with `errorToast: "Couldn't save the spend ceiling"`.
   [`queries.ts`](../../../packages/ui/src/modules/spend/api/queries.ts): `useSpendCeilings()` over `trpc.spend.ceilings.list.queryOptions()`.
8. **Copy** — put every new string in [`packages/ui/src/modules/spend/lib/copy.ts`](../../../packages/ui/src/modules/spend/lib/copy.ts), next to `CEILING_NAME` and `CEILING_HELP`, and format amounts with the existing spend formatters.
   Every surface says "spend ceiling", never "ceiling" alone.
9. **Docs** — [`docs/architecture/spend-limits.md`](../../architecture/spend-limits.md) › Screens: add a bullet for **Settings › Operator**: only platform operators see the tab; its Spend ceilings section gives the default, each user's own ceiling with who set it and when, and sets, changes or removes one by the user's email.
   In › Spend ceiling, name the tab next to the CLI command where the section says how an operator sets a ceiling.

## Acceptance criteria

- [ ] An operator sees the Operator tab in Settings; a non-operator does not, and the `/settings/operator` URL takes them to Account.
- [ ] The section shows the default line, one row per user with a ceiling, and the empty text when there are none.
- [ ] "Set a spend ceiling" with a known email and `12.50` adds the row; an unknown email shows the server's message in the dialog; `12.505` shows the amount rule and sends nothing.
- [ ] "Change" on a row updates its amount, setter and time; the remove button deletes the row.
- [ ] The tab, the dialog and the rows work with the keyboard, and every icon button has an accessible name.
- [ ] Light and dark themes both read correctly.
- [ ] `mise run check` and `mise run test` pass; `mise run check:comment-types` passes.
- [ ] Screenshots or a short recording of the tab, the dialog, the unknown-email error and the empty state are ready for the PR (Web UI proof).

## Smoke test

Run it yourself, then print a short guide so the user can repeat it.
Build and roll out the UI and the api-server on the local dev cluster (`cluster-ops` skill), then drive the app in the browser pane or with Playwright:

1. Sign in as `dev`, open Settings: the Operator tab is there.
2. Open it: the Spend ceilings section shows the default line and the empty text.
3. Set `12.50` for the second test user's email: the row appears with `dev` as the setter.
4. Change it to `5`: the row updates.
   Remove it: the empty text comes back.
5. Set a ceiling for `nobody@platform.local`: the dialog shows the "no user" message.
6. Sign in as the second test user: Settings shows no Operator tab, and the tab's URL lands on Account.
7. Capture the screenshots for the PR.
