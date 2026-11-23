# 06 — When background cards go out

**Depends on:** 05-card-lifecycle
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

Until now, a `background` request becomes a row of its agent's background card at once.
That pings an owner who works in the web UI and would answer there.
The server cannot tell who is attached to an agent: presence keys name the agent only, and a stale tab, an SSH session or an editor's browser writes them too.
So this slice uses the owner's own activity instead: the web UI tells the server while its tab is visible and used, and a `background` request becomes a row only when it still waits after 60 seconds and the owner is not active there.
It also adds the hint for an agent that keeps reaching new hosts, which a rule per host cannot stop.
Slack-turn requests keep getting their row at once, because a person waits in the thread.
There is no cap: each agent has at most one open background card, and a call card or a question card needs its own answer.

## Implementation plan

Apply the `/typescript-engineering` skill to the server, and `/react-ui-engineering` to the UI.

1. **Owner activity, server.** Add the core seam of the README's pinned contract (illustrative: `packages/api-server/src/core/owner-activity.ts`): `touch(ownerSub)` sets a per-owner Redis key with a 120-second TTL; `isActive(ownerSub)` reads it and fails toward "not active".
   Add a tRPC mutation for the signed-in user that calls `touch`.
2. **Owner activity, UI.** In `packages/ui`, add a hook mounted once in the app shell, beside `modules/agents/hooks/use-page-visible.ts`: while the page is visible and the user used the keyboard, the mouse or touch in the last two minutes, it calls the mutation every 60 seconds.
   It shows nothing and sends nothing else.
   The owner then counts as active for two to four minutes after the last input, and for up to two minutes after the tab is hidden.
3. **The timing rule.** The place saga of [02](./02-card-base.md) keeps placing `turn` requests at once and stops placing `background` ones.
   The sweep of [05](./05-card-lifecycle.md) places a `background` request that is no item yet when it is at least 60 seconds old and still pending (or, for a refused row, still within its hold window), `canCard` is `ok`, and the owner is not active.
   An owner who becomes inactive later gets the row at the next sweep, while the request still waits.
4. **The hint.** When one agent was blocked on 10 or more different hosts in the day (from the card items of the day), its background card says: "<Agent> was blocked on <n> different hosts today.
   A rule for each host will not stop this."
   with "Open network settings", a link to the agent's network settings in the app.
   The hint never suggests a rule for every host.
5. **Docs.** In `docs/architecture/slack-owner-requests.md`, add the timing rule, owner activity (what the UI sends, when, and how long the owner counts as active), why there is no cap, and the hint.
   In `.quality-inspector/qi-profile-dam/SKILL.md`: a background request reaches the owner after about a minute, and not while the owner is active in the web UI.
   The pull request carries a capture of the UI's activity request (the browser's network panel), because the change shows nothing.

## Acceptance criteria

- [ ] While the owner uses the web UI, a schedule fire's blocked request gets no row; the bell shows it.
- [ ] With the web UI closed, or its tab hidden for two minutes, the row arrives about 60 seconds after the request.
- [ ] A Slack-turn request gets its row at once, also while the owner is active in the web UI.
- [ ] Seven blocked hosts of one agent give one background card with seven rows.
- [ ] A schedule's MCP call card and a question card are posted while the agent's background card is open.
- [ ] An agent blocked on ten different hosts in a day gets the hint on its background card, with a link to its network settings.
- [ ] `mise run check`, `mise run //packages/api-server:test` and `mise run //packages/ui:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md).

1. Keep the web UI open and use it; run a schedule that fetches `https://example.net/`: no row after two minutes; the bell shows the request.
2. Close the web UI and run it again: the background card arrives about a minute later.
3. Run a schedule whose task fetches seven different unallowed hosts: one background card with seven rows.
4. Run a schedule that fetches ten more new hosts: the card shows the hint and links to the agent's network settings.
5. While the card is open, ask the agent in the test channel to fetch a new host: its turn card arrives at once.
