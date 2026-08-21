# 03 — Decouple the Slack agent footer from attribution

**Depends on:** 02-public-agent-page-surface
**Part of:** Public Agent Page — see [README](./README.md)

## Context

The footer under every agent post in Slack has to point at the new page and read "Powered by DAM"
instead of the agent's name. That copy change cannot be made safely today, because the footer is not
just a link: it is a **wire format** the platform parses back out of Slack history to attribute each
line to the agent that wrote it ([channels.md](../../architecture/channels.md), "Injected history is
attributed per Agent").

[`FOOTER_RE`](../../../packages/api-server/src/modules/channels/infrastructure/agent-footer.ts) captures
the agent id in group 1 **and the link label in group 2, which becomes `agentName`**. Change the label to
a fixed string and every agent's footer parses to the same name; an agent reading channel history then
sees `Powered by DAM (another agent):` for every other agent's post. This slice severs that coupling
first, then makes the change.

Apply the **`/typescript-engineering`** skill.

## Implementation plan

### 1. Sever the coupling

In [`agent-footer.ts`](../../../packages/api-server/src/modules/channels/infrastructure/agent-footer.ts):

- Change `parseAgentFooter` to return `{ agentId: string } | null`. Drop `agentName` from the return
  type. The id in the URL is the durable, structured part; the label is presentation.
- Change `labelHistoryMessage` to take a resolved display name rather than digging one out of the parsed
  footer. Its existing fallback chain (own post, another agent, bot label, raw user id) is otherwise
  unchanged.

In [`slack.ts`](../../../packages/api-server/src/modules/channels/infrastructure/slack.ts) around line
521, where history messages are labelled: collect the distinct agent ids parsed out of the history batch,
resolve them to names in **one** batched lookup, and pass each name into `labelHistoryMessage`. Fall back
to the raw agent id when an agent is gone, which is what the current code already does when a name is
empty.

Behaviour change to accept and note in the PR: a **renamed** agent's older posts now label with its
current name rather than the name it had when it posted. That is more correct, not less, but it is a
visible difference.

### 2. Teach the regex the new URL

Still in `agent-footer.ts`, add the new path alongside the existing ones. `CHAT_PATH` and
`LEGACY_AGENT_PATH` stay: every message already posted in every channel carries the old form, and
`LEGACY_AGENT_PATH` is the precedent for exactly this migration.

The tail of the pattern is `(?:/[^>|]*)?`, which tolerates a trailing path segment but **not** a query
string, so `/a/agent-abc?s=xyz|Label>` fails to match outright. Widen it to accept an optional query as
well. Keep the `[^>|]` character classes so the pattern cannot run past the end of a Slack link.

### 3. Change the link

- `agentFooterMrkdwn` builds `<uiBaseUrl>/a/<agentId>?s=<sessionId>|Powered by DAM`, with the `?s=`
  segment omitted when there is no session. URL-encode the session id as the current code does.
- The label is now fixed copy. Because of step 1 it is pure presentation, so future rewording is free.
  Keep `escapeLinkLabel` on the way in regardless.
- The session id in a public URL is not a new exposure: it is already in the footer link that every
  channel member can see today.

## Acceptance criteria

- [ ] `parseAgentFooter` returns only an agent id; no caller reads a name out of a footer label
- [ ] History labelling resolves display names from agent ids in one batched lookup, falling back to the raw id
- [ ] `FOOTER_RE` matches the new `/a/<id>?s=<session>` form **and** both legacy forms `/chat/<id>` and `/sandboxes/<id>`
- [ ] A footer posted before this change still attributes correctly in injected history
- [ ] New footers read "Powered by DAM" and link to `/a/<agentId>?s=<sessionId>`
- [ ] Two bound agents in one channel are labelled by their own names in each other's history, not by the link text
- [ ] `mise run check` and `mise run test` pass, including the existing footer tests

## Smoke test

```sh
mise run api-server:check
mise run api-server:test
```

The existing unit tests around `agent-footer` cover the parse path; they will need updating for the new
return type, which is the point of running them. Only add a new case if the legacy-form regression is not
already covered, since a legacy footer failing to parse is the highest-cost silent failure in this slice.

On the dev cluster:

```sh
mise run cluster:build-apiserver
```

1. Bind **two** agents to one Slack channel and have both post.
2. Confirm each footer reads "Powered by DAM" and the link resolves to the page from slice 02.
3. Start a fresh thread and prompt one agent about what was said in the channel. It must refer to the
   other agent **by name**. Seeing "Powered by DAM (another agent)" means step 1 was not done.
4. Confirm a message posted before the upgrade still attributes by name.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can
confirm it by hand.
