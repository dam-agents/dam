# 06 — The post shows the choice

**Depends on:** 05-button-click-reaches-the-agent
**Part of:** Channel cards on Slack Block Kit — see [README](./README.md)

## Context

After sub-issue 05 a click reaches the Agent, but the post looks the same: the buttons stay live, nobody else sees that someone chose, and each further click wakes the Agent again.
This slice closes the loop: a post takes one answer, and shows it.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Pure part** — `domain/channel-blocks.ts`: add a function that returns a post's blocks with the choice made.
   - Remove every choice button, at any depth.
     Remove an `actions` block, a `card`'s `actions` or a `section`'s `accessory` that the removal leaves empty.
     Link buttons stay.
   - Add one `context` block that names who chose what, placed before the block that ends the post.
     The Agent Footer must stay the last block: `closingBlock` in `infrastructure/agent-footer.ts` reads who wrote a post from there and nowhere else.
   - Add a case for it to `channel-blocks.test.ts`, the test file sub-issue 01 created: a choice button nested in a `layout` item's `card` goes, a link button beside it stays, and the footer is still last.
2. **Worker** — `infrastructure/slack.ts`, `handleMessageAction`:
   - Order matters.
     First run the gates and hand the click to the inbound path, as sub-issue 05 built.
     Only when the click was accepted, replace the post through the `replace` callback the handler already gets, which goes through the click's response URL.
     A click the gates refuse leaves the post as it was, so the person can click again once the cause is gone.
   - The replacement's `text` is the post's text with the choice line added, so the notification text and the history Agents read show the choice too.
   - A failed replacement is logged and does not fail the turn.
3. **One answer** — two people can click before the post changes, and each click arrives with its own copy of the post.
   Deliver the first and not the second: keep the answered posts in process for a short time, and before a delivery read the post with the gateway's `getMessage` and treat one that already holds the choice line as answered.
   Tell the second person in a private notice who already chose.
   The in-process part is lost on a restart, as the catch-up boundary is; the read from Slack is the floor.
4. **An edit by the Agent** — the tool that changes an own post replaces its blocks, so an Agent may put new buttons on the post after an answer.
   Nothing to build: confirm that an edited post with new choice buttons takes a new first click.
5. **Rules for the Agent** — `block-reference.ts` and the `describe_blocks` text: a post takes one answer; after it the buttons go and the post names who chose; for an answer from several people, ask each one or post again.
6. **Docs** — `docs/architecture/channel-cards.md`, the buttons section: one answer per post, what the post shows after it, what happens to a second click and to a click the gates refuse.
   Update `Last verified:`.
   `docs/architecture/slack-guarantees.md`: add the guarantee row for a choice button if the page's cap allows; if not, leave the page alone and say so in the pull request.

## Acceptance criteria

- [ ] After an accepted click the gateway receives a replacement of the post with no choice button, with its link buttons, with a line naming the person and the label, and with the Agent Footer as the last block.
- [ ] A second click on the same post starts no turn, and the person gets a private notice that names who chose.
- [ ] A click the gates refuse (an Agent at its spend limit) leaves the post unchanged.
- [ ] A post the Agent edited to carry new choice buttons takes a new click.

## Smoke test

```sh
mise run //packages/api-server:check
mise run //packages/api-server:test
mise run check:comment-types
mise run check:markdown
mise run //docs:check:doc-size
```

All pass.
Manual, on the local cluster with a Slack workspace: ask the Agent for a question with "Approve", "Reject" and a link button; click "Approve"; the post now shows the link button and a line with your name and "Approve", and the Agent answers in the thread.
Then run the whole-feature smoke test in the [README](./README.md#whole-feature-smoke-test).

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
