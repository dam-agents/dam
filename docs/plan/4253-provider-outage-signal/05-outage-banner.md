# 05 — Outage banner

**Depends on:** 03-failed-turn-card
**Part of:** Users see when a model provider is down — see [README](./README.md)

## Context

A user on Home or on any page other than the chat does not see the card or the status line.
This slice shows a banner at the top of the main area while a provider that the user has a Connection to is degraded, or while the DAM-side state is set.
The design is the mockup agreed while planning (README D6, D7): the `Notice` primitive in place, never a fixed bar that covers content.

## Implementation plan

Apply `/react-ui-engineering`.
The texts and actions are in [README — Wording](./README.md#wording).

1. **Danger tone.** `packages/ui/src/components/ui/notice.tsx` gets `tone: "danger"` next to `muted` and `warning`: `Callout` already has the danger tone; the icon and the title take the danger text colour.
2. **Banner** in a new `packages/ui/src/modules/provider-status/components/provider-outage-banner.tsx`:
   - data: `useProviderStatus()` and `useAppConnections()` (`modules/connections/api/queries.ts`);
   - shown outages: those whose template matches one of the user's Connections; the DAM-side state when the user has any provider Connection;
   - one outage: the one-provider text; several: the several-providers text; DAM side: the DAM-side text, `tone="danger"`; otherwise `tone="warning"`;
   - icon: Carbon `Warning` for the warning tone (as `SendErrorCard` uses), `ErrorFilled` for the danger tone;
   - actions: "View providers" (`navigateToSettings("providers")`), "{Provider} status" for each shown outage with a `statusPageUrl` (an `<a>` with `target="_blank"` and `rel="noreferrer"`), and the close button with `aria-label="Hide until the status changes"`.
3. **Close per outage.** The close button writes a persisted flag per shown outage, keyed by template (or `dam-side`) and `since`, with `writePersistedFlag`.
   The banner hides the outages whose flag is set; a new outage, or the DAM-side state after a provider outage, shows again.
4. **When it hides:**
   - in the chat view (README D7), where the status line covers the session's provider;
   - while `ConnectionBanner` shows (the API health store in `lib/api-health.ts` is not `connected`), because the status is then unknown.
5. **Narrow screens:** below `sm`, show only the lead and the close button, with the `sm:hidden` / `hidden sm:inline` pattern of `ConnectionBanner`.
6. **Mount** at the top of the main area in both layouts in `packages/ui/src/app.tsx` (the two branches that mount `ConnectionBanner`), inside the page flow, so it pushes the content down and covers nothing.
   Use the page's own side gutter.
7. **Docs:** `docs/architecture/provider-status.md` § Screens: the banner, who sees it, when it hides, and the close rule.

## Acceptance criteria

- [ ] `mise run check` and `mise run //packages/ui:test` pass.
- [ ] The banner shows on Home, Settings and the agent pages for a user with a Connection to the failing provider, in both layouts.
- [ ] A user without such a Connection sees no banner.
- [ ] The banner does not show in the chat view.
- [ ] Several outages show in one banner with the several-providers text.
- [ ] The DAM-side state shows the danger banner and blames no provider.
- [ ] Close hides the banner after a reload; a new outage shows it again.
- [ ] "View providers" opens Settings › Providers; a status page link opens in a new tab.
- [ ] The banner covers no content, and below `sm` it shows only the lead and the close button.
- [ ] Screen readers announce it politely (`role="status"` from `Notice`).

## Smoke test

On the dev cluster, with the UI image rebuilt:

1. Turn the IBM VPN off and make two IBM LiteLLM agents fail as in slice 01.
2. Within about 2 minutes, Home shows the banner; open a chat: no banner, the status line shows instead.
3. Turn on the new-layout experiment: the banner shows on its Home too.
4. Close the banner, reload: it stays hidden.
5. Sign in as a user without an IBM LiteLLM Connection: no banner.
6. Narrow the window below `sm`: only the lead and the close button.
7. Turn the VPN on: within about 6 minutes, the banner goes away.

Print a short guide so Petr can repeat it by hand, with screenshots for the PR.
