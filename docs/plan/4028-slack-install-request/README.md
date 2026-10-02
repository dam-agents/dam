# Slack setup links to the workspace install request

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4028

## Goal

The Slack app works only in workspaces where an operator has installed it. Installs happen on
request, through a form. Today the UI never says so. A user in another workspace follows the Slack
Channel steps, Slack answers "app not installed in your workspace", and nothing tells them where to
ask.

After this feature, every place where a user sets up Slack for an agent shows one line:
"{brand} not installed in your workspace? **Request it ↗**". The link opens the deployment's request
form in a new tab. Each deployment sets the link itself, so no deployment's URL is in the code.
A deployment that sets no link shows no line.

## Approach

**Where the link comes from.** The request link follows the path of the compute "Request more"
link exactly: Helm `links.*` → api-server env → api-server config → the `links.all` tRPC query →
the UI's `useLinks()` hook. The new key is `links.slackInstallRequest`, next to
`links.computeRequest`. The `links.all` router and the tRPC context pass `config.links` through
whole, so only the schema, the config read, and the chart change. `brand.*` stays identity only, and
the `apiserver` Slack values stay server credentials.

**Unset means hidden** (the issue's open question, decided at sign-off). The server serves `null`
for an empty value. The UI shows the line only for a usable `http(s)` URL, using the same guard as
`ReleaseNotesLink` (`isExternalHttpUrl`). There is no bundled fallback URL: `values.yaml` already
marks the compute link's bundled fallback as install-specific and "slated for removal".

**Where the line appears.** These are the three surfaces from the issue, matching Jenna's three
design images on the issue (in the comment of 2026-09-24):

| Surface | Component | Placement | Wording |
|---|---|---|---|
| Slack Channel help popover | `SlackChannelExplainer` | muted footer strip below **Go to Connections →** | "your workspace" |
| Slack Account help popover | `SlackAccountExplainer` | muted footer strip below **Go to Channels →** | "your workspace" |
| Add to Slack Channel modal | `ChannelBindModal`, Slack step only | left side of the footer, buttons stay right | "your Slack workspace" |

`SlackChannelExplainer` has two call sites: the agent's Channels card and the create page's
Channels section. Both get the footer, and neither call site changes. `ChannelBindModal` opens from
three places: the agent list row menu (⋮ → **Add to Slack channel**), the new-session launcher's
Slack tile, and right after an agent is created with Slack ticked. All three get the line from the
one component. In a Slack-then-Telegram bind run, the line shows on the Slack step only.

Not in scope: `SlackChannelModal` ("Connect a Slack channel", the channel-ID form behind
**+ Connect channel**). It is a different modal, and the issue does not name it.

**The brand name** comes from `getBrand().name`, like the modal's `/invite @{brand}` command.

**Relevant architecture:** [channels](../../architecture/channels.md). Connecting a workspace is an
operator act and an invitation, not open enrollment. This feature is the user-facing way into that
invitation. The page gets one sentence about it. [platform-topology](../../architecture/platform-topology.md)
covers how the UI reads server config. Nothing there changes.

## Conventions & glossary

- **Install request** — a person asks the operators to install the Slack app in their workspace.
  The request form and the install-link/approval process are outside this feature.
- **Request line** — the "{brand} not installed in your workspace? Request it ↗" line.
- Apply `/react-ui-engineering` for the UI and `/typescript-engineering` for the config schema.
- Never hardcode the brand or a deployment's URL (CLAUDE.md → Branding).
- Visuals: the design images are the source. Reuse existing tokens and the primitives' own spacing.
  Do not measure sizes from the images. The arrow is Carbon `ArrowUpRight` at size 14, to match the
  `ArrowRight` size 14 of the "Go to …" links. It is not `Launch`, which is a box with an arrow.
- No new tests. Verification is `mise run check`, the existing suite, and the manual smoke test.

## Whole-feature smoke test

On the local dev cluster (see the `cluster-ops` skill; the app is `http://localhost:4444`, plain
http):

1. `mise run cluster:build api-server ui`, then
   `mise run cluster:helm --set=links.slackInstallRequest=https://example.com/slack-install-request`.
   (`--set` keeps the personal `values-dev.yaml` overlay. `--helm-values` would replace it.)
2. Open an agent → Channels → hover the **?** next to **Slack Channel**. The popover ends with a
   muted strip: "{brand} not installed in your workspace? Request it ↗".
3. In the agent list, open the row menu (⋮) → **Add to Slack channel**. The Add to Slack Channel
   modal shows the request line, with "Slack workspace", left of **Done**.
4. Open the Connection catalogue → hover the **?** next to **Slack Account**. The popover shows the
   same strip below **Go to Channels →**.
5. Click **Request it** in each place. `https://example.com/slack-install-request` opens in a new tab.
6. Run `mise run cluster:helm` again with no `--set`. Reload the page. None of the three places
   shows the line, and the popovers have no empty strip.

## Delivery

The feature is a single sub-issue, [01](./01-slack-install-request-link.md), which is one atomic
commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/4028.

- [x] 01 — Slack install-request link in the Slack setup places
