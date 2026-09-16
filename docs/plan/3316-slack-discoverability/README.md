# UI — Slack integration discoverability

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3316

## Goal

New users do not learn that a DAM agent can work with their team in Slack until after they
have built an agent — if at all. The users who do find it then meet a second problem: DAM has
two Slack paths that look alike. A **channel** binding lends the agent to a conversation, where
it posts as itself. A **Slack Account connection** hands the agent the person's own Slack
account, so it acts as them. Nothing at the point of choice says which is which.

After this feature:

- Channels are offered during agent creation, before the first agent exists, for Slack **and**
  Telegram.
- A short explainer at every point of choice says plainly that a channel answers as the agent
  and a connection acts as you.
- Finishing the setup takes one link, not a command the user has to discover.
- Connected channels are visible on the agent list, the chat launcher, the agent's Channels
  section, and on each session — by **name**, not by a raw `C0…` id.

## Approach

Everything here sits in two subsystems, and neither changes shape:

- [channels](../../architecture/channels.md) — bindings, the in-chat bind flow, ambient mode.
- [connections](../../architecture/connections.md) — the Slack Account connection and the
  catalogue it lives in.

The feature is mostly UI, over one genuine backend gap and one backend addition.

**The backend gap.** A Slack binding carries only `slackChannelId`
([`types.ts:25`](../../../packages/api-server-api/src/modules/agents/types.ts)). The channel's
name exists only on the ephemeral bind-flow record and is never persisted. Sessions are the same
story with a twist: `SessionView` has no channel field at all, but `threadTs` already encodes the
channel id (`<channelId>:<ts>`, or `ambient:<channelId>`). So both surfaces already hold the id
and both lack the name. Sub-issue 01 solves that once for both.

**The backend addition.** `/dam bind` is only a link factory: it notes which channel and which
Slack user, mints a one-time login link, and replies with it. A bot join event carries the same
two facts, so the same link can be offered without anyone typing a command. The reply copy
already exists verbatim at
[`slack.ts:1795`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts).
Sub-issue 09 changes the trigger, not the flow.

Telegram is included throughout, except where it genuinely does not apply — see the glossary.

### Design source of truth

The design is a **dev-ready Figma file**, reviewed and approved on the issue. Thirty views
across eight groups were read during planning; each sub-issue names the view numbers it needs.

There is also a **prototype branch**, `worktree-feat+slack-discovery` (tip `0d217455`, 20
commits, UI-only, never merged). It is a **UX reference only — never an implementation
reference.** It runs on mock data, fakes both channel names and session channel names, and
contains superseded components. Where it disagrees with Figma, **Figma wins**. Known places it
is wrong are called out in the sub-issues that touch them.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | [x] [Slack channel name resolution](./01-channel-name-resolution.md) | Backend. Resolve a Slack conversation id to its name, for bindings and sessions alike. | — |
| 02 | [x] [Bind walkthrough modal and setup Channels section](./02-bind-modal-setup-section.md) | The shared bind modal and the Channels section on the three setup views. | — |
| 03 | [Channel vs connection explainer](./03-channel-vs-connection-explainer.md) | Accessible popover, the "Slack Account" rename, three placements, two cross-links. | 02 |
| 04 | [Channel visibility on the agent list and chat launcher](./04-channel-visibility-list-launcher.md) | Row chips, overflow entries, launcher tiles. | 01, 02 |
| 05 | [Agent Channels section](./05-agent-channels-section.md) | Names instead of ids; Telegram rows reach parity. | 01, 03 |
| 06 | [Session rows show their channel](./06-session-rows-channel.md) | Messenger logo, channel name, relative time. | 01 |
| 07 | [Bind picker redesign](./07-bind-picker-redesign.md) | Search, sections, card rows, sticky action — both messengers. | 01 |
| 08 | [Bind success redesign](./08-bind-success-redesign.md) | Simplified copy and the ambient toggle — both messengers. | 07 |
| 09 | [x] [Slack posts the bind link on join](./09-slack-on-join-bind-link.md) | The bot offers the link when it is invited. | — |

The order is linear. 01 comes first because 04, 05 and 06 all need it. 02 comes early because
three later slices reach its modal.

## Conventions & glossary

### Ask for the Figma frame before building any visual

**Every sub-issue that changes how a component looks begins by requesting its Figma frames from
the user.** Do not infer colours, spacing, sizes, radii, weights or state styling from the
prototype, from neighbouring components, or from this plan's prose — this plan describes
behaviour and copy, not visual detail. Each sub-issue lists the view numbers to ask for. Wait
for the screenshots, then build.

### Engineering skills

- Server-side TypeScript: apply the `/typescript-engineering` skill.
- UI in `packages/ui`: apply the `/react-ui-engineering` skill.

Each sub-issue names the one that applies.

### Tests

**Do not author new tests.** Verification leans on the existing suite (`mise run test`,
`mise run check`) plus the manual smoke test each sub-issue specifies. Sub-issue 01 proposed one
exception for a pure parsing helper; the user declined it during implementation, so the rule has
no exceptions.

### Vocabulary

| Term | Meaning |
|---|---|
| **Channel** (Slack) / **Chat** (Telegram) | A messenger conversation bound to an agent. The agent posts **as itself**. |
| **Slack Account connection** | A catalogue connection granting the agent the person's own Slack account. The agent acts **as them**. Renamed from "Slack" in sub-issue 03. |
| **Binding** | The (agent, conversation) pair. Slack allows many agents per conversation; Telegram allows exactly one. |
| **Ambient mode** | A Slack binding where the agent reads along and may answer unmentioned. **Slack only**, **off by default** on every path. |

### Where Telegram deliberately differs

Do not "fix" these — each is grounded:

- **No explainer.** There is no Telegram connection template in
  [`catalog.ts`](../../../packages/api-server/src/modules/connections/domain/catalog.ts), so
  there is no identity confusion to resolve.
- **No name resolution needed.** Telegram captures the chat title at bind time via
  `fetchChatTitle`, and `useTelegramChats` already returns `{ conversationId, title }`.
- **No ambient.** There is not one `ambient` reference in the Telegram infrastructure.
- **No `#` prefix, no default agent, nothing to edit.** A Telegram conversation binds to exactly
  one agent ([channels.md](../../architecture/channels.md)), and the code refuses a second bind.
- **A group-admin gate on bind**, which Slack does not have. Keep saying so in Telegram copy.

### Ambient stays off by default

Three Figma frames draw the ambient toggle **on**. That is illustrative. Current behaviour is
off on every path — `ambient === true` is the only thing that enables it
([`agents-service.ts:544`](../../../packages/api-server/src/modules/agents/services/agents-service.ts))
— and [channels.md](../../architecture/channels.md) requires it. **Do not change the default.**

### Open with the designer

One point the frames do not answer. Build the assumption; flag it in the PR.

| Question | Sub-issue | Assumption |
|---|---|---|
| Where does "Go to Channels →" land? | 03 | Closes the modal and returns to the Channels section; plain text when there is no agent context. |

### Resolved, with the reasoning

Not open questions. Recorded so nobody reopens them.

- **The "Open @handle in Telegram ↗" button stays.** It exists in production today, under step 1
  of the Telegram modal. The frame shows the no-handle fallback, so it cannot distinguish
  "rejected" from "not rendered" — and an existing, working affordance is not removed without a
  reason to.
- **The modal's step 2 stays.** Sub-issue 09 has the bot post a bind link on join, which makes
  `/dam bind` optional *for that path only*. A join event does not fire for a channel the bot is
  already in, and a DM has no invite at all — the modal itself says to skip step 1 there. So step 2
  is the only route in both cases, and remains load-bearing. There is no contradiction to resolve.
- **Telegram does not prompt on join.** Telegram has no ephemeral, so any such message reaches the
  whole group, and only admins may bind. Nothing is built either way in this feature; if it is
  wanted later it is its own issue.
- **A Telegram channel row ships with no subtitle.** No frame covers that row at all, since its
  overflow menu is new. The Figma-first rule already sends the implementing agent to ask for the
  frame before building it, which is where this gets settled.
- **Resolve channel names on read, with a cache** — not persisted at bind. Channels get renamed,
  and a stale name is worse than a slightly slower one. Reasoning in sub-issue 01.
- **Session channel names are a client-side join**, decided during implementation of 01. The UI
  parses `threadTs` and matches the agent's channels, which already carry names. `SessionView`
  gains no field. Sub-issue 01 step 5 and sub-issue 06 step 3 are updated to agree.
- **Figma frames come from the user**, pasted per sub-issue. The `figma-dev` MCP server refused
  the connection, so the implementing agent cannot pull them itself.
- **Keep the "Default" badge** on Slack channel rows, which Figma does not draw. The frame shows
  a channel that is not a default; removing the badge would lose real information.

## Whole-feature smoke test

Once every sub-issue is done, on the local dev cluster:

1. Create a coding agent and tick both **Slack Channel** and **Telegram Chat**. The two-step bind
   modal opens, showing "Step 1 of 2" then "Step 2 of 2".
2. Hover and **tab to** the `?` on the Slack row. The explainer appears both ways. Follow
   "Go to Connections →" — the catalogue modal opens, scoped to that agent, showing
   **Slack Account** with its own `?` and the reverse explanation.
3. In Slack, invite the bot to a channel. It posts a link, privately, without anyone typing
   `/dam bind`. Follow it: the picker searches, groups by Most recent and A–Z, and the button
   enables only on a selection.
4. Complete the bind. The success page names the agent and channel, and its ambient toggle is
   **off**.
5. Back in DAM: the agent list row shows the channel by **name**; the agent's Channels section
   shows `#name` rather than `C0…`; the chat launcher offers both messenger tiles.
6. Send a message in the Slack channel. A new session appears with the Slack logo and a subtitle
   reading `#channel-name · <relative time>`.
7. Repeat 3–6 for Telegram, where the chat title appears without a `#` and no ambient toggle is
   offered.
8. `mise run check` and `mise run test` pass.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3316.

The final commit of the branch deletes `docs/plan/3316-slack-discoverability/`. The `Plan check`
CI job fails while that folder exists, so the PR cannot merge until it is gone.
