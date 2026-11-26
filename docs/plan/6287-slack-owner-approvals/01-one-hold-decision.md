# 01 — One hold-or-refuse decision for the three gates

**Depends on:** 00-measure-before-building
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

Three gates hold an unmatched request: `ext-authz-gate.ts` (network), `web-search-gate.ts` (web search) and `tool-call-hold.ts` (MCP tool calls).
Each has its own copy of one check: a channel turn is open and nobody is attached → refuse at once.
This slice puts the decision in one pure function that also gives each request its route (`turn` or `background`), and makes an addressed Slack turn of an owner who can get cards hold instead of refusing.
An addressed Slack turn is one that a person's message started and that shows the working status, because there a person can end the wait with the "Don't wait" button of [02](./02-card-base.md), in every workspace, whether or not Slack shows its own Stop button; ambient rounds, replies in an agent's own thread, a whisper sent with its message, and turns that a bot, an app or an agent started keep today's refusal.
The slice also makes the network and web-search holds end when their client goes away, counts who still waits on a row so the cards and the thread can say when nobody does, lets an approve once made after that serve the next identical request, and makes a hold's expiry follow its row, so a Slack turn that joins an old row gets the whole hold window.
It also lets every `turn` wait of an agent end on a release, which the "Don't wait" button of [02](./02-card-base.md) sends: the client gets a refusal at once, and the row stays pending for the owner.
No card exists yet: a held request shows on Home and in the web approvals list as today, and a verdict there lets it through.
An owner who cannot get cards keeps today's behavior exactly.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Attendance counts addressed Slack turns apart.** In `packages/api-server/src/core/turn-attendance.ts`, `openChannelTurn(agentId, { channel, addressed })` takes `slack`, `telegram` or `artifact`.
   The channel-turn key gains the channel (illustrative: `channel-turn:agent:<id>:<replica>:<channel>`), each counted apart, so a read answers whether a channel turn is open and of which kinds.
   An addressed Slack turn also counts in a second key (illustrative: `addressed-turn:agent:<id>:<replica>`), with its own count per agent and replica, its own write when the count leaves zero, its own delete when it returns to zero, and the same heartbeat.
   Add a read that answers whether an addressed Slack turn is open on the agent.
   Add `releaseAddressed(handle)`, which moves the turn from the addressed count to a third count (illustrative: `released-turn:agent:<id>:<replica>`) and resolves only after Redis confirms the change; the turn stays in the channel-turn count, and its end drops the released count.
   Add a read that answers whether a released Slack turn is open on the agent.
   A key written by the old code reads as a channel turn of an unknown kind, never as an addressed Slack turn.

2. **The Slack worker says which turns are addressed.** In `packages/api-server/src/modules/channels/infrastructure/slack.ts`, decide `addressed` per message when its `TurnRef` is built, and store it on the `TurnRef`, so the nudge after an undelivered reply reuses its turn's value; `beginTurn` passes it on.
   - `true`: a message whose sender is a person (`SlackSender.kind === "person"`) on a turn that runs the turn presenter: a mention, a message in a DM, a whisper thread in a DM (`privateReply: false`);
   - `false`: ambient rounds, `ownedRefOf` turns (replies in an agent's own thread), a whisper sent with its message (`privateReply: true`, which runs `SILENT_PRESENTER`), and a message whose sender is an app, a companion or an agent.
   - A workspace whose app has no agent messaging is no exception: its status shows as text without Stop, and "Don't wait" works there.
     Telegram (`telegram.ts`) passes `telegram`, and the artifact viewer's prompt delivery (`viewer-prompt-delivery.ts`) passes `artifact`, both with `addressed: false`.

3. **Owner can get cards.** In the channels module, add `canCard(ownerSub)`, which returns `ok`, `unlinked` or `muted`: `ok` when at least one `identityLinks.externalLinksOf("slack", sub)` link is in a workspace that is installed and active, read from the database.
   [08](./08-dam-approvals-and-mute.md) adds `muted`; until then the read returns `ok` or `unlinked`.
   Do not check scopes here: Slack's grant set is not in the database, and the leader checks it when it posts ([02](./02-card-base.md)).
   Wire it at the composition root (`bootstrap.ts`) into the deps of the three gates as a port; the read fails toward `unlinked`.
   Add the operator switch: one Helm value (illustrative `slackOwnerRequests.enabled`, on by default) carried into the api-server config; off makes `canCard` answer `unlinked` for every owner, which gives today's behavior everywhere.

4. **The decision.** In `packages/api-server/src/modules/approvals/domain/`, add the pure function of the README's pinned contract, with its five rules in that order, returning the verdict and the route.
   The rule for a released Slack turn comes before the attended check, so a retry after "Don't wait" is refused at once also while someone has the agent open in the web.

5. **The three gates call it.** In `ext-authz-gate.ts`, `web-search-gate.ts` and `tool-call-hold.ts`, replace each copy of the `unattended` check with a call to the decision; the sub-agent refusal (`child`) stays before it.
   The web-search gate passes its `sessions.isScheduled` read as the "web search of a scheduled session" input.
   - `refuse` → today's refusal path, unchanged: the row is filed for Home, with the route and where the gate refused it (illustrative payload field `refusedIn`: `slack`, `telegram`, `artifact` or `unknown`, from the attendance read);
   - `hold` → today's hold path, with the route on the row and on `ApprovalRequested`.
     The browser's in-session prompt (`injectChannelOf`) is unchanged.

6. **Route on the row, and the raise.** In `packages/db/src/schema.ts`, add `owner_route` (text, nullable: `turn` or `background`) to `pending_approvals`; generate the migration with `mise run //packages/db:generate`.
   Carry it through `approvals-repository.ts` and the approval row types in `packages/api-server-api/src/modules/approvals/`.
   A `turn` request that joins a waiting `background` row raises the route to `turn` and moves the row's `expires_at` to now plus the hold window, in one update; a route is never lowered.
   In `packages/api-server/src/events.ts`, give `ApprovalRequested` and `ApprovalResolved` an optional `ownerRoute`, and add (illustrative) `ApprovalRouteRaised` with the row id, the agent and the owner; the gate emits it after a raise.
   Run `mise run //packages/api-server:check:events`.

7. **The expiry follows the row.** In `approvals-repository.ts`, `expirePending` flips a row only when its `expires_at` has passed.
   In `held-verdict.ts`, a waiter whose timer fires reads the row: when its expiry moved, it waits on to the new expiry; otherwise it expires the row as today.
   The network and web-search gates pass the row's expiry to `waitForVerdict` (`expiresAt`), as `tool-call-hold.ts` does, so a joined request waits until the row's expiry, not a full window from its own start.

8. **A hold ends with its client.** Add `signal` to `WebSearchGateInput`, and let the ext-authz app pass the gRPC cancel `signal` to both the network gate and the web-search gate; both pass it to `waitForVerdict`, as `tool-call-hold.ts` does.
   On `hold-abandoned`, log the decision with that reason and leave the row pending for the owner.
   In `held-verdict.ts`, count the live waits of each routed row on the Redis bus (illustrative key `approval-waiters:<id>`): up when a wait starts, down when it ends, refreshed with the attendance heartbeat so the waits of a replica that died expire.
   When the count leaves zero, or returns to zero without a verdict (`hold-abandoned` or `hold-released`), emit (illustrative) `ApprovalWaitChanged` with the row id, the agent, the owner, the route and `waiting: true` or `false`; a verdict emits nothing here, because `ApprovalResolved` covers it.
   Add a read that answers whether a row's count is zero; [05](./05-card-lifecycle.md) uses it to tell a late allow.
   The count tells the owner and the member what is true now: in most cases the client gives up long before the hold window (Claude Code's WebFetch after 60 s, its Bash tool after 120 s), and the gateway ends a hold after 15 s to 5 minutes until #6855 is fixed.

9. **A release ends the turn waits.** In `held-verdict.ts`, `waitForVerdict` takes an optional release channel and ends with a new reason (illustrative `hold-released`) when a release on it matches the wait; like `hold-abandoned`, it leaves the row pending, and the expiry sweep (`delivery-sweeper.ts`) flips the row at its `expires_at`.
   Each of the three gates passes the release channel of its attendee (illustrative `turn-release:<agentId>` on the Redis bus) only for a request whose route is `turn`, so a `background` wait never ends on a release.
   A release carries the time its turn began and the turn's session ids:
   - a wait that began before the turn did is not released, so a schedule's request that a raise moved to `turn` keeps waiting;
   - a web search is released only when its session stamp (`WebSearchGateInput.sessionId`) is one of the turn's sessions; network and MCP requests carry no session, so their release is per agent.
     Each gate answers a released request with its own refusal text: a network refusal with a body (a held network request ends today as a bare `deny`, a 403 with no reason), a new `WebSearchRefusalReason`, and a new end of the MCP hold.
     The text is neutral, because a press in one thread can also release another thread's wait: the wait for the owner's answer was ended in Slack, the request was not denied, it still waits for the owner until the row's expiry, and the agent can ask again once the owner answers.
     [02](./02-card-base.md) sends the release; a held harness prompt is released inside its turn's own relay ([09](./09-harness-prompts-on-slack-turns.md)).

10. **Approve once outlives the client.** Generalize `consumeAllowOnce` in `approvals-repository.ts` by type: a network row matches on host, port, method and path; a web-search row on the query key; an MCP row on the call's key, as today.
    An unused approve once stays usable until its decision time plus the hold window, not until the row's own expiry (today `expires_at > now()`), so an owner who answers in the last minute still gives the person who asked a full window to ask again.
    In the network and web-search gates:
    - a wait that ends in "allow" marks the row used (`deliveredAt`) and passes; every other request that waited on the row passes too, as today;
    - before filing a row, a request that finds a usable approve once of its shape uses it and passes, once.
      The MCP hold keeps its rule: one call per approve once.

11. **Turn contract.** In `packages/api-server/src/modules/channels/infrastructure/network-access-copy.ts`, and in the refusal and hold texts of the web-search and MCP holds, pick the text by `canCard`:
    - `ok`: an unallowed host, search or tool call goes to the owner in Slack and waits for the answer while the tool waits, with no promised time; the person who asked can press "Don't wait" on the thread's line to go on without the step, or Stop where Slack shows it to end the turn; a request that ends without an answer (the tool gave up, or `hold-released`) was not denied, so the agent goes on without it and tells the person who asked that the thread will say when the owner allows it, and that they can then ask again;
    - `unlinked`: today's text, plus that the agent's owner can answer such requests from Slack after linking their Slack account with the login command.
      Address the owner, not the sender, and take the command's name from the brand config.

12. **Security log.** The decision logs which rule decided (`basis`), the route, and whether the turn was addressed, on the existing hold and refusal lines; a raise logs the row and the new expiry; a release logs each wait it ended with the reason `hold-released`; never the request body.

13. **Docs.** Create `docs/architecture/slack-owner-requests.md` (title "Owner requests in Slack"): why it exists, addressed Slack turns and why only they hold, the routes, the shared decision with its five rules, "owner can get cards", the raise and the expiry that follows the row, the hold that ends with its client, the count of who still waits, the release that ends the turn waits, and approve once.
    Add its line to `docs/architecture.md`.
    In `docs/configuration.md`, the operator switch.
    In `docs/architecture/security-and-credentials.md`, "Unattended requests are refused, not held" and "Channel turns": an addressed Slack turn of an owner who can get cards holds, and an approve once outlives the client; link the new page rather than adding prose.
    In `docs/architecture/web-search-control.md`, a scheduled session's search holds for an owner who can get cards, and a search hold ends with its client.
    In `docs/architecture/connections.md`, the tool-call approval paragraph: the same decision as the other holds, linking the new page.
    In `docs/architecture/channel-turns.md`, the bullet "An unallowed host is refused, not held".
    In `docs/architecture/slack-guarantees.md`, the rows about unallowed hosts, and that a tag from a bot, app or agent keeps the refusal.

## Acceptance criteria

- [ ] With a linked owner, a request of an addressed Slack turn to a host no rule covers waits instead of being refused, shows on Home with the route `turn`, and an approval there lets it through.
- [ ] The same holds for a web search and for an MCP tool call on "needs approval" (with `mcp-tool-approval` on).
- [ ] With an unlinked owner, the same requests are refused at once and recorded for Home, as before.
- [ ] Requests of an ambient round, a reply in an agent's own thread, a whisper sent with its message, and a turn that an app's tag started are refused at once with the route `background`, also for a linked owner.
- [ ] An ambient round and a mention that overlap on one replica: the mention's request holds with the route `turn`.
- [ ] In a workspace whose app has no agent messaging, a mention's request holds with the route `turn`, as in a workspace with agent messaging.
- [ ] A refused row records where the gate refused it.
- [ ] With the operator switch off, every request behaves as before this slice.
- [ ] A Telegram turn and an artifact turn with nobody attached still refuse at once.
- [ ] A schedule fire's request holds with the route `background`; a scheduled session's web search holds for a linked owner and is refused at once for an unlinked one, also while someone is attached.
- [ ] A Slack-turn request that joins a 25-minute-old `background` row raises it to `turn`, emits the raise event, and waits a full hold window from the join.
- [ ] Stop on a turn that waits on a held network request, or on a held web search, ends the wait at once; the row stays pending.
- [ ] When the last wait on a routed row ends without a verdict (the client gave up, Stop, or a release), the row stays pending and `ApprovalWaitChanged` says `waiting: false`; a request that joins it later emits `waiting: true`; a verdict emits no such event.
- [ ] A release for an agent ends at once every `turn` wait of its network, web-search and MCP holds that began after the released turn did: each client gets the neutral refusal with its gate's text, and each row stays pending.
  A `background` wait of the same agent, a wait that began before the turn, and a web search of another session go on.
- [ ] After a release, a new request of the agent is refused at once, also while someone has the agent open in the web, while no other addressed turn of the agent is open.
- [ ] An approve once given while three identical network requests wait lets all three through; given after the clients left, it lets the next identical request through once within the hold window after the answer, also after the row's own expiry, and a second one holds again.
- [ ] The turn contract carries the "goes to your owner in Slack" text, with no promised time, for a linked owner, and the link hint, addressed to the owner, for an unlinked one.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

On the local cluster with Slack wired (`cluster-ops` skill; a worktree passes `--helm-values=`), with `APPROVAL_HOLD_SECONDS=300`.
Until #6855 is fixed, a site can drop a held HTTPS request after 15 s, and Claude Code's fetch tool gives up after 60 s: approve a request that must pass while it waits within 10 seconds.

1. Link the owner with `/dam login` and bind an agent to a test channel.
2. From another member, ask the agent to fetch `https://example.org/`: the thread shows the working status, and Home shows a waiting network approval.
3. Approve once on Home within 10 seconds: the agent answers with the page's title.
   Ask for `https://example.edu/` and do not answer: when the fetch gives up, the security log shows the wait ended with `hold-abandoned`, the row's wait count reads zero, and the row stays pending; approve once, ask again: it passes.
4. Ask for `https://example.com/` and press Stop: the turn ends at once; Home still shows the approval.
   Approve once on Home, then ask again: the request goes through.
5. Ask for `https://www.iana.org/`, and while it waits publish a release for the agent by hand (`valkey-cli` with the pod's auth, per the `cluster-ops` skill): the agent answers at once that the wait ended and that the owner can still approve the request; Home still shows the approval.
   Approve once on Home, then ask again: the request goes through.
6. Turn on ambient mode for the agent, write a message that makes it fetch a new host on its own: refused at once.
7. Post a message from a workflow or a webhook that tags the agent and asks for a new host: refused at once.
8. In a second Slack test workspace whose app has no agent messaging, repeat step 2: the thread shows the working status as text without Stop, and the request holds with the route `turn`.
9. Run a schedule that fetches `https://example.net/` with no browser open: Home shows the waiting approval; its row has the route `background` (check with a read-only query on the local database through the `cluster-ops` skill).
   About four minutes later, ask the agent in the channel for the same page: the row's route becomes `turn` and its expiry moves; approve once on Home: both requests pass.
10. `/dam logout`, repeat step 2: the request is refused at once, and the agent's reply says that its owner can link Slack.
11. Link again, turn the operator switch off in the Helm values, repeat step 2: refused at once, as before this slice.
