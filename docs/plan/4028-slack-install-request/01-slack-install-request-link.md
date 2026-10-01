# 01 — Slack install-request link in the Slack setup places

**Part of:** Slack setup links to the workspace install request — see [README](./README.md)

## Context

This slice is the whole feature. A new per-deployment Helm value, `links.slackInstallRequest`,
reaches the UI through the existing `links.all` query. The UI shows the request line in the Slack
Channel popover, in the Slack Account popover, and on the Slack step of the Add to Slack Channel
modal. The line is hidden when the value is unset. The design images are on the issue (Jenna's
comment of 2026-09-24): one image for each place.

## Implementation plan

Apply `/typescript-engineering` for the config schema (steps 1–2) and `/react-ui-engineering` for
the UI (steps 5–9).

**Link config — copy the `links.computeRequest` path exactly.**

1. `packages/api-server-api/src/modules/links/types.ts`: add `slackInstallRequest:
   z.string().nullable()` to `linksSchema`. The `links.all` router and the tRPC context
   (`packages/api-server/src/apps/api-server/trpc/context.ts`) already pass `config.links` through
   whole, so neither changes.
2. `packages/api-server/src/config.ts`, the `links:` block (next to `computeRequest`, about line 366):
   `slackInstallRequest: process.env.LINKS_SLACK_INSTALL_REQUEST || null`.
3. `helm/values.yaml`, the `links:` block: add `slackInstallRequest: ""`. Give it an operator
   comment in the style of `computeRequest`. The comment says what the value is (the form people use
   to ask for the Slack app in a workspace that does not have it yet), that it must be a complete
   URL, and that an empty string hides the request line. Unlike `computeRequest`, there is no
   bundled default.
4. `helm/templates/apiserver/app.yaml`, next to `LINKS_COMPUTE_REQUEST` (about line 535): add the
   same `{{- if .Values.links.slackInstallRequest }}` block that sets `LINKS_SLACK_INSTALL_REQUEST`.

**UI.**

5. `packages/ui/src/modules/links/api/queries.ts`: add `useSlackInstallRequestUrl(): string | null`.
   It reads `useLinks().data?.slackInstallRequest` and returns the value only when
   `isExternalHttpUrl` (from `@/lib/external-link`) accepts it, else `null`. This is the guard that
   `ReleaseNotesLink` uses. Every surface gets "unset or unusable → hidden" from this one place.
6. New `packages/ui/src/modules/slack/components/slack-install-request.tsx`, exporting
   `SlackInstallRequest({ href, workspaceLabel = "workspace" })`. It renders the line from the
   designs as one `text-sm text-muted-foreground` paragraph:
   `{getBrand().name} not installed in your {workspaceLabel}?` followed by an `<a href={href}
   {...externalLinkProps}>` that reads **Request it** with Carbon `ArrowUpRight` at size 14. Style
   the link like the "Go to …" `CrossLink` in `channel-connection-explainer.tsx`
   (`inline-flex items-center gap-1 font-medium text-accent hover:underline`). The component takes
   `href` and does not read the query itself, because the popovers must know whether a footer exists
   before they render one (step 7).
7. `packages/ui/src/components/explainer-popover.tsx`: add an optional `footer?: ReactNode` prop.
   Move the panel's padding from `PopoverContent` (`p-4` → `p-0`) onto the existing
   `flex flex-col gap-3` body div (`p-4`). Without a footer, the result looks the same as today, so
   `satellites-group-card.tsx` does not change. When `footer` is set, render it below the body as a
   strip that reaches the panel's edges: a top border, a muted background, the body's horizontal
   padding, and rounded bottom corners that follow the panel's `rounded-xl`. Reuse token
   combinations that already exist, for example `border-t border-border/60 bg-muted/40` in
   `folder-group.tsx`. Do not measure sizes from the images. Do not put `overflow-hidden` on
   `PopoverContent`: the Radix arrow tail renders inside it, and `overflow-hidden` clips it.
8. `packages/ui/src/components/channel-connection-explainer.tsx`: in both `SlackChannelExplainer`
   and `SlackAccountExplainer`, call `useSlackInstallRequestUrl()` and pass
   `footer={href ? <SlackInstallRequest href={href} /> : undefined}`. The call sites
   (`slack-channel-card.tsx`, `setup-channels-section.tsx`, `catalog-provider-card.tsx`) do not
   change.
9. `packages/ui/src/modules/sandboxes/components/channels/channel-bind-modal.tsx`: in
   `ChannelBindModal`, call `useSlackInstallRequestUrl()` next to the existing `useState`, before
   the `if (!messenger) return null` early return (rules of hooks). In the footer row, put
   `<SlackInstallRequest href={href} workspaceLabel="Slack workspace" />` on the left when
   `messenger === "slack"` and `href` is set. Keep the buttons on the right in all cases: give the
   line `mr-auto` and keep `justify-end`, so the row looks as it does today when there is no line.
   Let the row wrap (`flex-wrap`, with a row gap) so that, at phone width, the line goes above the
   buttons and does not squeeze them.

**Architecture doc.**

10. `docs/architecture/channels.md`: in the bullet that starts "**Connecting a workspace is an
    operator act, and an invitation rather than open enrollment.**", add one sentence at the
    architecture level. An install may name where people ask for that invitation. Every Slack setup
    surface (the channel and account explainers and the bind instructions) then points there. An
    install that names none shows nothing. Use no field names, env names, or paths (see
    `docs/guidelines/documentation-guidelines.md`). Bump `Last verified:`. The page is well under
    its 40,000-character cap.

No code comments are needed. The `values.yaml` operator comment follows the comment style of that
file.

## Acceptance criteria

- [ ] With `links.slackInstallRequest` unset, `links.all` returns `slackInstallRequest: null`, and
      the chart sets no `LINKS_SLACK_INSTALL_REQUEST` env. With the value set, `links.all` returns
      the URL.
- [ ] With the link set, the Slack Channel popover (agent Channels card and create-page Channels
      section) and the Slack Account popover (Connection catalogue) end with a muted strip that
      reaches the panel's edges: "{brand} not installed in your workspace? Request it ↗".
- [ ] With the link set, the Add to Slack Channel modal shows "{brand} not installed in your Slack
      workspace? Request it ↗" left of the buttons, on the Slack step only. A Telegram step and a
      Telegram-only run show no line.
- [ ] Every **Request it** opens the configured URL in a new tab (`target="_blank"`,
      `rel="noopener noreferrer"`).
- [ ] The brand name comes from `getBrand()`. No brand string and no deployment URL is in the code.
- [ ] With the link unset, or set to a value that is not an `http(s)` URL, no surface shows the line,
      the popovers have no empty strip, and the modal footer looks as it does on `main`.
- [ ] The satellites explainer popover looks as it does on `main`.
- [ ] Open each popover both above and below its trigger. The arrow tail still looks attached. If the
      tail shows as a white notch against the muted strip, report it. Do not style around it in
      silence.
- [ ] At phone width (375 px), the modal's request line wraps above the buttons, and the page does
      not scroll sideways.
- [ ] `mise run check` passes, including `mise run //:check:comment-types` and
      `mise run //helm:check:render`.

## Smoke test

1. `mise run check` (this covers UI tsc/lint/format, the api-server, the chart render, and the doc
   size).
2. Run the [whole-feature smoke test](./README.md#whole-feature-smoke-test) on the dev cluster:
   build `api-server` and `ui`, set the link with `--set`, check all three places, click each
   **Request it**, then redeploy without the value and check that every line is gone.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
