# 05 — Cards follow their request to the end

**Depends on:** 04-network-and-web-search-cards
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

After [04](./04-network-and-web-search-cards.md), only a click on a card edits that card.
A request can also settle in the web, by an editor, at its expiry, or on a second workspace's card, and a card event can be lost between replicas or when the leader changes.
This slice makes every card a faithful view of its requests to the end, removes the details when a request settles, turns an expired network row into a rule row, changes the thread's line when the wait ends, logs how each carded request settled, repairs what a lost event missed, closes cards nobody touches, and closes an owner's cards when they unlink Slack.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Every settle is an event.** Check that each way a routed request settles emits `ApprovalResolved` with `ownerRoute`: a verdict through the approvals service, a hold's expiry (`expirePending`, `held-verdict.ts`, the `delivery-sweeper.ts` expiry), a grouped verdict that answers several rows, the MCP hold's expiry, and the refusal of [02](./02-card-base.md) when a turn card cannot post.
   Add the field, or the event, where one is missing.
2. **Close the items.** Add a channel RPC method (beside the place method of [02](./02-card-base.md)) that settles the items of one request on every card that holds them, under the same per-owner lock:
   - an MCP row or a call card → the outcome line; the arguments leave Slack;
   - a network or web-search row of a turn card → the outcome line when a verdict ended it; when it expired, "Expired: the call was refused" as a rule row of [04](./04-network-and-web-search-cards.md); the path's query string leaves Slack;
   - a host row of a background card → a rule row when its last waiting request expired, or the outcome line when a verdict ended it;
   - a turn card with no waiting row takes no new rows: it closes when none of its rows offers a rule, else 24 hours after its last row settled;
   - the thread lines of [02](./02-card-base.md): when every row a line covered has settled, the line changes to "The wait ended."; while one is still pending, the line keeps the went-on text of [02](./02-card-base.md), also after the turn ended;
   - a late allow: when a verdict allows a row whose wait count of [01](./01-one-hold-decision.md) is zero (its requests stopped waiting: the tool gave up, Stop, or "Don't wait"), the app posts one new reply in each thread whose line shows the went-on text, because Slack sends no notice for an edit: it mentions the people whose messages the turn carried, and says "<owner's display name> allowed it.
     Ask again by <time>."
     for an approve once (its decision time plus the hold window, [01](./01-one-hold-decision.md)), or "… Ask again to use it."
     for a rule.
     An allow while a request still waits posts no reply, because the turn goes on with it.
     A deny or an expiry posts no reply.
     A saga in `modules/channels/sagas/` calls it on `ApprovalResolved` with `ownerRoute`.
     Log one line per settled item (illustrative `owner_request.card_settled`: card, request, how it settled, who and where — Slack, the web, expiry or Stop —, whether a request still waited when it settled, whether its thread had pressed "Don't wait", and the delay since the post), never the request's content.
     The share of requests that the owner allows after nobody waited any more tells whether a turn that resumes by itself is worth building.
3. **Who decided, in words.** The click path of [03](./03-mcp-tool-call-cards.md) settles the request's items itself after its `decide` wins, with "… by you".
   Any other settle reaches the saga, which writes "Answered in the app by <name>" (the decider's display name; "you" when it is the owner), "Expired: the call was refused", or the denial line.
   An item already settled is left alone, so the two paths never fight.
4. **Several workspaces.** An owner linked in two workspaces has one card per workspace; a click on one settles the items on both.
5. **Unlinking.** When an owner's Slack identity link in a workspace is removed (`/dam logout`, or the unlink in the web), close the owner's cards in that workspace with "Slack was unlinked: answer in the app"; their requests stay pending on Home.
6. **Sweep.** Register a job in `packages/api-server/src/bootstrap.ts` (like `approvals-delivery-sweep`), run on the channels leader only, every 30 seconds:
   - a card row with no `ts` that is more than a minute old → post it;
   - a pending routed request that has not expired and is no item of an open card → place it;
   - an item whose request settled → settle it;
   - a turn card with no waiting row → apply the close rule of step 2;
   - a turn card or a background card with nothing waiting whose last change is 24 hours old → close it;
   - a dismissal past its date → delete it.
     It reads through `ownerRequests.waiting` (by route, bounded by age), so it never scans every approval; add an index on `pending_approvals (owner_route, status, created_at)` for that read.
     Write it so [06](./06-when-cards-go-out.md), [07](./07-subagent-questions.md) and [10](./10-harness-prompts-in-unwatched-runs.md) can add their rules to the same sweep.
7. **Failures.** A Slack error on one card (a workspace that revoked the token, a deleted DM) is logged and leaves that item as it is; the sweep retries it until the request's own end, then stops.
8. **Docs.** In `docs/architecture/slack-owner-requests.md`, add the card lifecycle: the outcome lines, who decided, details removed, rule rows after expiry, the thread line's end and its late-answer text, the settle log line, several workspaces, unlinking, the sweep and its bounds, the 24-hour close.

## Acceptance criteria

- [ ] Approving a carded request in the web edits its row or card to "Answered in the app by <name>" within seconds.
- [ ] An expired Slack-turn network row reads "Expired: the call was refused" and keeps the rule buttons; a click on "Allow whole host" writes the rule.
- [ ] After the hold window ends, a host row of a background card offers only the rule buttons, and Allow whole host still writes the rule.
- [ ] The thread's line reads "The wait ended."
  once every row it covered has settled; until then, after the tool gave up, it keeps the text that the agent went on without the step, also after the turn ended.
- [ ] After the agent went on without the step (its tool gave up, Stop, or "Don't wait"), an approve once on the card posts one new reply in the thread that mentions the member and says by when to ask again; the next identical request passes.
- [ ] An approve once while the request still waits posts no reply; a deny or an expiry posts no reply and only changes the line.
- [ ] Each settle of a carded request writes one log line with how it settled and the delay since the post.
- [ ] An owner linked in two workspaces gets two cards; a click on one edits both.
- [ ] No settled row or card still shows the request's query string or arguments.
- [ ] A turn card whose rows all settled with verdicts closes; one with an expired network row closes 24 hours later.
- [ ] With the place saga disabled for a test (or the leader restarted between the card row and the post), the sweep posts the missing card within a minute; with the settle saga disabled, the sweep settles the item.
- [ ] A click after a web answer still answers "Already answered", and the card is not edited twice.
- [ ] A background card with nothing waiting closes 24 hours after its last change.
- [ ] `/dam logout` closes the owner's cards in that workspace.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md).

1. From another member, ask the agent to fetch `https://example.org/?q=test`; approve it in the web: the row reads "Answered in the app by you" without the query.
2. Ask for `https://example.com/` and let the hold window pass: the row reads "Expired: the call was refused" and keeps "Allow whole host"; click it, ask again: it passes.
3. Ask for `https://www.iana.org/`, press "Don't wait" as the member, then click Allow once on the card: a new reply in the thread mentions the member and says that the owner allowed it; ask again: it passes.
4. Ask for `https://www.wikipedia.org/` and do not answer; when the fetch gives up and the agent has answered without the page, click Allow once: the same reply arrives, with the time to ask again; ask again: it passes.
5. Run a schedule that fetches `https://example.net/` and let the hold window pass: its row keeps Allow whole host and "Always deny…".
6. Restart the api-server leader pod right after a schedule fires (`mise run cluster:kubectl -- rollout restart …` per the `cluster-ops` skill): the card still arrives within a minute, once.
7. `/dam logout`: the open cards read "Slack was unlinked: answer in the app".
