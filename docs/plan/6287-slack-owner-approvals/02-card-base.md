# 02 — The card base

**Depends on:** 01-one-hold-decision
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

After [01](./01-one-hold-decision.md), each gateway hold carries a route, but the owner still sees it only in the app.
This slice builds the parts every card reuses, with "Open in app" as the only button: the card tables, placing on the leader under a per-owner lock, the turn card and the background card with one row per request, the fallback row, the card metadata that keeps cards out of every agent's input, the repost when a new waiting row joins an old card, the refusal when a turn card cannot post, the visible line in the thread that waits with its "Don't wait" button, and the log lines that measure the cards.
After this slice, every routed request reaches the owner's DM at once: a `turn` request as a row of the agent's turn card, a `background` request as a row of the agent's background card.
[03](./03-mcp-tool-call-cards.md) and [04](./04-network-and-web-search-cards.md) give the rows their buttons and group network rows per host; [05](./05-card-lifecycle.md) edits cards when a request settles elsewhere; [06](./06-when-cards-go-out.md) adds the timing rule.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Card tables.** In `packages/db/src/schema.ts`, add the channels-owned card and card-item tables of the README's pinned contract, with a uniqueness rule that allows one open turn card and one open background card per owner, agent and workspace, and the dismissal table.
   Generate the migration with `mise run //packages/db:generate`.
   Add their repository in `packages/api-server/src/modules/channels/infrastructure/`.
2. **Request view port.** Add `ownerRequests.view` to the Slack worker's ports (wired in `bootstrap.ts`), with the fields every routed type shares: kind, status, the agent's id and display name, the owner, the route, a one-line summary built on the server from the row (method, host and path; the search; the tool and the Connection), and the expiry.
   [03](./03-mcp-tool-call-cards.md), [04](./04-network-and-web-search-cards.md), [07](./07-subagent-questions.md) and [09](./09-harness-prompts-on-slack-turns.md) add the fields of their types.
3. **Renderers.** In `packages/api-server/src/modules/channels/domain/`, add pure renderers from request views to Block Kit:
   - the **turn card**: "<Agent> waits in Slack: <n> requests", a context line with a link to each thread the card names and the display name of the person who started it ("it cannot tell which thread sent which request"), one row per waiting request, at most 10, then "<n> more: Open in app";
   - the **background card**, built from the same parts: "<Agent> needs you: <n> requests", rows that wait first, at most 10, then "<n> more: Open in app";
   - the **fallback row**: the one-line summary as `plain_text`, the expiry, and "Open in app";
   - the **outcome lines** of the README.
     Every action id starts with `owner-request:`.
4. **Safe rendering.** Add the shared helpers every renderer uses: agent-written text goes out only as `plain_text`, or inside a code block with its backticks neutralized, never as Slack markup; the cut lengths of the README (about 200 characters for a query string, about 2,500 for arguments and input, 75 for an option's label).
   Host, Connection and agent names come from the request view, never from agent-written text.
5. **Cards are no agent input.** Every card post carries Slack message metadata (illustrative event type `owner_request`, with the card's id), through the gateway's existing metadata support.
   Message intake, history catch-up, message edits, `read_channel_history` and `read_thread` in `slack.ts` drop every post with that event type, so an agent bound to the owner's DM through the DM Bridge never reads or answers a card.
6. **Placing on the leader.** Add a channel RPC method beside `notifyPerson` (`services/worker-contract.ts`, `services/channel-manager.ts` and its `METHOD_NAMES`) that places one request, under a per-owner lock on the leader:
   - it reads the view and `canCard`; an owner whose `canCard` is not `ok` gets no card;
   - `turn` → join the agent's open turn card (add the item, add the thread and the person who started it to the names, edit the card), or write a new turn card;
   - `background` → join the agent's open background card (add the row, edit the card), or write a new background card;
   - for each Slack identity link of the owner, write the card row first, then open the DM (`openDirectMessage`), post with the metadata (`postMessage` returns the `ts`) and store the `ts`; an edit uses `updateMessage`;
   - check the workspace's scopes before posting, since `hasScope` treats unknown scopes as granted.
     The card comes from the app with no agent persona, like the resource and outage alerts.
     Log one line per post (illustrative `owner_request.card_posted`: card, kind, request, route, workspace), never a path, argument or question.
7. **A turn card that cannot post.** When a turn card fails to post for a lasting reason (a missing scope, a DM that cannot open, a revoked token), call a new `ownerRequests.refuseUnreachable(id)` port for each waiting row of it: the approvals service denies the row as the system, with the reason `owner-unreachable`, so the thread does not wait for a card that never comes.
   A passing error (a rate limit, a timeout) is logged and left for the sweep of [05](./05-card-lifecycle.md).
8. **Repost.** When a `turn` request from a thread the card does not name yet joins a turn card posted more than 5 minutes ago, or a new waiting row joins a background card posted more than 5 minutes ago, delete the post (the gateway's delete of the app's own message), post the card again, and store the new `ts`, so Slack notifies the owner once more.
   Any other join edits the card, and Slack sends no notice.
9. **Sagas.** In `packages/api-server/src/modules/channels/sagas/`, subscribe to `ApprovalRequested` with an `ownerRoute`, and to `ApprovalRouteRaised`, and call the place method; on a raise, the place method moves the item from the agent's background card to its turn card and adds the thread.
   Log and continue on failure.
10. **The line in the thread.** When the place method places a `turn` request, it posts one visible line, from the app and with the card metadata, in the thread of each open addressed Slack turn of the agent, once per turn: "<Agent> waits for its owner, <owner's display name>, to approve a step.
    Up to <hold window>."
    It has a "Don't wait" button (action id `owner-request:release`, with the team, the channel and the thread `ts` in its value) and a context line: "The person who asked can go on without the step."
    The line names only "Don't wait", not Stop, because Slack shows Stop only where the app has agent messaging, and the line then needs no record of which workspace shows it.
    Keep the line's `ts` on the turn card's entry for that thread, so [05](./05-card-lifecycle.md) can still change the line after the turn ended.
    - The line names the owner by display name, never as a mention, so the owner gets no second notice; it names no host, path or command.
    - An owner who sent the turn (the sender's identity link resolves to the owner) also gets a private note (`postEphemeral`) with a link to the card; an editor of the agent who sent it gets a private note that they can answer in the app.
    - In the owner's own 1:1 DM with the app, no line goes out, because the card lands in that same conversation.
      [05](./05-card-lifecycle.md) changes the line to "The wait ended."
      when nothing waits any more.
      Put the copy in a new copy file beside the others in `channels/infrastructure/`; take the app's name from the brand config, never a literal.
11. **Don't wait.** A click on "Don't wait" reaches `handleMessageAction` (`slack.ts`):
    - only the person who started the turn, a person whose message joined it, or the owner may press it: reuse the Stop check and its private refusal, which find the turn by channel and thread; anyone else gets a private note (`postEphemeral`) that only the person who asked can choose, and nothing changes;
    - when the turn has ended, or its release was already sent, the click changes nothing;
    - otherwise, first, the turn stops counting as addressed: call `releaseAddressed` of [01](./01-one-hold-decision.md) for every `TurnRef` the turn carries (a batched turn holds several), and set each stored `addressed` to false, so the nudge after an undelivered reply does not hold again; a message that joins the turn later does not make it addressed again;
    - then, once Redis has confirmed the change, the worker publishes the release for the agent on the channel of [01](./01-one-hold-decision.md), with the time the turn began and its session ids, so the turn's waits end with the neutral refusal and the agent finishes its answer without those steps; a held harness prompt of the turn is released in the turn's relay ([09](./09-harness-prompts-on-slack-turns.md));
    - the line changes to "<Agent> goes on without the step.
      <owner's display name> can still approve it until <time>.", and each waiting row of the agent's turn card gets the note "Nobody waits for this now.
      Your answer counts for the next try.";
    - every other open addressed turn of the agent loses its current waits too, because the gateway cannot tell which thread sent which request; its line changes the same way, and its next held request changes the line back to the waiting text.
      Store the release time, and the people whose messages the turn carried, on the turn card's entry for the thread, so [05](./05-card-lifecycle.md) knows which lines wait for a late answer and whom its reply mentions.
      Log one line (illustrative `owner_request.released`: card, agent, who pressed — starter, joiner or owner —, how many waits it ended, and the delay since the line was posted).
12. **Docs.** In `docs/architecture/slack-owner-requests.md`, add: the card kinds, the turn card, the fallback, safe rendering, the card metadata and the read paths that drop it, the card tables, placing through the leader, the repost, the refusal on a lasting failure, the line in the thread, "Don't wait", and the log lines that measure the cards.
    In `docs/architecture/channels.md`, the bullet "The platform can message a linked person" gains cards, linking the page.
    In `docs/architecture/slack-dm-bridge.md`, one sentence: cards land in the owner's DM with the app, and an agent bound there never reads them.
    In `docs/architecture/channel-turns.md`, beside Stop: "Don't wait" ends the turn's waits and lets the turn go on, and who may press it.
    In `docs/architecture/slack-guarantees.md`, what the thread shows while the agent waits, and what "Don't wait" does.
    In `.quality-inspector/qi-profile-dam/SKILL.md`, what a tester should know: a held Slack-turn request reaches a linked owner as a DM card, and the thread shows a line that the agent waits, with "Don't wait".

## Acceptance criteria

- [ ] With a linked owner, a Slack-turn request to an unallowed host puts one turn card in the owner's DM within seconds, for each workspace the owner is linked in, with a row and "Open in app".
- [ ] Three requests of one turn at the same time give one turn card with three rows.
- [ ] A request from a second thread that joins a turn card posted more than 5 minutes ago reposts the card, and Slack shows one new notice.
- [ ] A schedule fire's request gives a background card with a row; a second request of the same agent adds a row to the same card.
- [ ] Every card post carries the `owner_request` metadata; an agent bound to the owner's DM gets no turn from a card, and its history read names no card.
- [ ] A row whose text holds `<https://example.org|Open in app>` shows it as plain text, not as a link.
- [ ] A turn card that cannot post because the DM cannot open refuses the waiting request at once.
- [ ] A leader restart between the card row and the post gives at most one card.
- [ ] A waiting Slack turn shows one visible line per turn that names the owner without a mention and names no host; the owner as sender also gets a private link to the card; the owner's own DM gets no line.
- [ ] "Don't wait" pressed by the member who asked ends the wait at once: the agent answers without the step, the line says that the owner can still approve it, and the row still waits on the owner's card with the note.
- [ ] After "Don't wait", a new request of the same turn to another unallowed host is refused at once.
- [ ] "Don't wait" pressed by a member who neither started nor joined the turn gives that member a private note, and the wait goes on.
- [ ] Every card post writes one log line without the request's content.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md).

1. From another member, ask the agent to fetch `https://example.org/`: the owner's DM shows a turn card with one row, "Open in app", and a link to the thread with the member's name; the thread shows the line that the agent waits, with "Don't wait".
2. As a third member, press "Don't wait": a private note says that only the person who asked can choose, and the wait goes on.
3. As the member who asked, press "Don't wait": the agent answers at once without the page; the line says that the owner can still approve it; the owner's row still waits, with the note.
4. Ask for three pages on three new hosts in one message: one turn card with three rows.
5. Wait six minutes, then ask the agent from a second thread for a new host: the card is posted again, with both threads named.
6. Run a schedule that fetches `https://example.net/` and `https://example.com/` with no browser open: one background card with two rows arrives.
7. Bind a second agent to the owner's DM with the app and ask it there to read that conversation's history: its answer names no card.
