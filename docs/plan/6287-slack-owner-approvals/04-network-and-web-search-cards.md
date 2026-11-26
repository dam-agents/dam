# 04 — Network and web-search cards

**Depends on:** 03-mcp-tool-call-cards
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

Network holds are most of the volume: 78% of them expire unanswered today.
After [03](./03-mcp-tool-call-cards.md), only MCP tool calls have buttons.
This slice gives network and web-search requests theirs: on a Slack turn they are rows of the agent's turn card, with "Allow all once" and "Deny all" when the card names one thread; in the background they are rows of the agent's background card, one row per host.
An expired row stays as a rule row, because a client often gives up long before the hold window, and a rule fixes the next run.
A rule row can deny as well as allow, so an owner can end a host that keeps coming back without opening the app.
A row shows the query string while the request waits, as the web does, because a query can carry data out.
A request the gate refused at once (an ambient round, a Telegram chat, an artifact's viewer) gets a row that says so and where, with the rule buttons only.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Request view.** Extend `ownerRequests.view` with the `ext_authz` and `web_search` kinds: status, host, port, method, the path and its query string, the sub-agent or Environment it is for (`forAgentId`, `viaEnvironment`), the count of waiting rows of the same host, the expiry, and `refusedIn` when the gate refused it at once; for a web search, what the web card shows.
2. **Rows on the turn card.** A `turn` network or web-search request is a row of the agent's turn card: "<METHOD> <host>\[:port\]<path>" and, while it waits, the query string as `plain_text` cut at about 200 characters (or the search), with the web card's verdicts for its type in one set of Slack labels (Allow once, Deny, "Always allow this path", "Allow whole host", "Always deny…"; see `packages/ui/src/modules/approvals/hooks/use-approval-actions.ts` for the verdicts), mapped in `decide` to the same approvals service calls (`approveOnce`, `approvePermanent`, `approveHost`, `denyForever`, and the web-search verdicts).
   A verdict the web offers only in the app (for example `approveForChildren`) stays behind "Open in app".
   A web-search verdict that allows every search says so in its label, as the web's does.
3. **"Allow all once" and "Deny all".** The turn card shows them only when it names one thread and shows at least two network or web-search rows that wait.
   They apply the choice to those shown rows only: an MCP row, a harness prompt row, and a row past the 10 the card shows keep waiting for their own click.
4. **Host rows on the background card.** A `background` network or web-search request joins the row of its host on the agent's background card, or adds one (a web search counts as one host):
   - "Blocked on <host>", its paths with their query strings while they wait (up to 5, then "and <n> more"), "<n> times today", the sub-agent or Environment when the row says so, and the expiry of the newest waiting request;
   - while a request waits: Allow once (every waiting request of that host), Deny, and the rule buttons of step 5;
   - a block on a host joins its row, raises the count and edits the card; only a new row that waits can repost the card ([02](./02-card-base.md)).
5. **Rule rows.** An expired row ([05](./05-card-lifecycle.md) edits it at expiry), and a row of a request the gate refused at once, offer only:
   - "Allow whole host";
   - "Always allow this path" when the row has one path, with a Slack `confirm` step when the rule restarts the agent's gateway: the place method asks `gatewayRestartImpact` (`api-server-api`'s egress-rules promotion) as the web's "Allow & restart" does, and the confirm text says that the agent's outbound requests stop for a moment;
   - "Always deny…", with a `confirm` step, mapped to `denyForever`; a deny rule refuses the next request at once and files no row;
   - "Dismiss" (step 6).
     `approvePermanent`, `approveHost` and `denyForever` already write their rule on an expired row.
     A refused row reads "Refused at once in a Slack channel", "… in a Telegram chat" or "… in an artifact's viewer" (from `refusedIn`), and shows no "Allow once".
6. **Dismiss.** "Dismiss" denies the row's waiting requests once, shows "Dismissed for 7 days", and writes a dismissal for that owner, agent and host: no new background row goes out for them for 7 days; their blocks show only on Home and in `/dam approvals`, and a Slack-turn request still gets its row.
7. **A raised row moves.** When `ApprovalRouteRaised` names a request that is an item of a background card, the place method of [02](./02-card-base.md) takes the item off its host row (count down, or remove the row when it held only that item) and adds it as a row of the turn card, with the thread's line.
8. **Docs.** In `docs/architecture/slack-owner-requests.md`, add the network and web-search rows, "Allow all once" and what it covers, the query string, the host rows, rule rows with their confirm steps, refused rows, Dismiss, and the move on a raise.
   In `.quality-inspector/qi-profile-dam/SKILL.md`: a held network request reaches a linked owner as a row of a turn card or a background card; "Always deny…" and a gateway-restarting path rule ask to confirm.

## Acceptance criteria

- [ ] A Slack-turn request to an unallowed host is a row of the agent's turn card; Allow once lets it through and the agent answers.
- [ ] A turn that fetches 6 unallowed hosts at once gives one turn card with 6 rows; "Allow all once" lets all 6 through.
- [ ] A turn card with two network rows and one MCP row: "Allow all once" lets the two network requests through, and the MCP row still waits.
- [ ] A turn card that names two threads shows no "Allow all once".
- [ ] A request to `https://example.org/collect?d=abc` shows `?d=abc` on its row while it waits.
- [ ] A schedule fire's request adds a host row to the agent's background card; Allow whole host writes the same rule the web writes, and the next run passes.
- [ ] Six paths on one host give one row that lists the paths and the count, without "Always allow this path".
- [ ] "Always deny…" asks to confirm, writes the web's deny rule, and the next request to that host is refused at once with no new row.
- [ ] A path rule that restarts the gateway asks to confirm first.
- [ ] After Dismiss, a new block on that host adds no row for 7 days.
- [ ] A request an ambient round makes reads "Refused at once in a Slack channel" and offers no "Allow once".
- [ ] A held web search gives a row with the web's verdicts.
- [ ] A Slack-turn request that joins a waiting background request moves it from the background card to the turn card.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md).

1. From another member, ask the agent to fetch `https://example.org/?q=test`: the owner's turn card shows the row with `?q=test`.
2. Click Allow once: the agent answers with the page's title; the row shows "Allowed once by you".
3. Ask for three pages on three new hosts in one message: one turn card with three rows; "Allow all once": the agent answers with all three.
4. Run a schedule that fetches two paths on `https://example.net/` with no browser open: the background card has one row with both paths; Allow whole host, run it again: it passes.
5. Run a schedule that fetches `https://example.com/`; click "Always deny…" and confirm; run it again: refused at once, and no row comes back.
6. Run a schedule that fetches `https://example.edu/`, click Dismiss, run it again: no row.
7. Turn on ambient mode, write a message that makes the agent fetch a new host on its own: the background card gets a row that reads "Refused at once in a Slack channel".
8. Run a schedule that fetches `https://example.info/`; while it waits, ask the agent in the channel for the same page: the row leaves the background card and shows on the turn card.
