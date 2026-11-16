# 05 — A button click reaches the Agent

**Depends on:** 02-blocks-replace-card-in-tools-and-slack, 04-describe-blocks-and-docs
**Part of:** Channel cards on Slack Block Kit — see [README](./README.md)

## Context

Until now a click in a channel had no way back to the Agent, so every choice button was refused.
This slice builds that way back for buttons: a click on a choice button in an Agent's Slack post behaves as a message in that post's thread, addressed to the Agent that made the post.
The post itself is not changed yet; sub-issue 06 does that.

## Implementation plan

Apply the `/typescript-engineering` skill.
Read [channel-turns](../../architecture/channel-turns.md) (inbound and the threading model) and [slack-threads](../../architecture/slack-threads.md) before changing the inbound path: the click must enter it, not copy it.

1. **Choice buttons pass** — `mcp-endpoint.ts`, `thread-tools.ts`: call `checkChannelBlocks` with `choiceButtons: "allow"` for a Slack post.
   Keep `"refuse"` for a private answer to a whisper, with an issue that says a private answer carries link buttons only: that answer is ephemeral and has no thread a click could go to.
   Find where the tool call knows the answer is a whisper's; when only the worker knows, refuse there in `infrastructure/slack.ts` on the same error path.
2. **Telegram** — choice buttons already show in the text form as a line of labels.
   Add to the turn's result or the tool description nothing more than `describe_blocks` says: in Telegram a choice button is an option the person answers by typing.
3. **Gateway** — `infrastructure/slack-gateway.ts`, `bolt-slack-gateway.ts`, `fake-slack-gateway.ts`:
   extend `SlackMessageAction` with what a click on a post carries and the menu did not need: the post's `ts`, its `threadTs` when it sits in a thread, and the clicked button's label.
   Read them from the `block_actions` payload in the `bolt.action` handler.
   Leave the command-menu fields and behavior as they are.
4. **Worker** — `infrastructure/slack.ts`, `handleMessageAction`:
   - Keep the first line's rule for the menu: an ephemeral click with the command-menu prefix goes to the menu and nowhere else.
   - A click whose `action_id` has the `agent-button:` prefix is an Agent's button.
     Take the Agent from the id; never from the post's text or from a block the Agent wrote.
     Ignore such a click on an ephemeral message.
   - Hand the click to the inbound path as an addressed message: the sender is the person who clicked, the conversation is the post's, the thread is the post's thread or the post itself when it is top-level, and the addressed Agent is the one from the id.
     Reuse `handleInbound` and what it calls (`routeOwnedThreadMessage`, `enqueueAddressed`), so the binding check, the owner's Terms-of-Use gate, the spend limits, wake, burst gathering and steering apply with no second copy.
     The routing that follows is today's: a post in a turn's thread reaches that thread's session, a thread from `start_thread` reaches the session that owns it, a plain `post` opens a fresh session with the thread's history.
   - The message text the Agent reads says that a person clicked a button, which label, the Agent's own `value` when it set one, and gives the post's permalink where Slack resolves one.
     Word it as a fact about a click, not as words the person typed.
   - A click has no message of its own.
     Decide what the turn contract names as the triggering message: the clicked post is the honest target for `react`, and `reply` goes to the thread as always.
   - When the conversation has no binding for that Agent (a post it made through its reach), tell the person who clicked in a private notice that the Agent is not connected there, and start no turn.
5. **Rules for the Agent** — `block-reference.ts` and the `describe_blocks` text: a button without a `url` sends a choice back; the click arrives as a message in the post's thread; to get it in the session that asked, ask with `start_thread`; a `value` on the button comes back with the click; choice buttons work in Slack only.
6. **Docs** — `docs/architecture/channel-cards.md`: a section on buttons that covers who may click, where the click goes and why the platform writes the button ids.
   `docs/ubiquitous-language.md`: no new term unless the page needs "choice button"; add it then.
   `channel-turns.md` is at its size cap: link to the new section from it only if a line fits.

## Acceptance criteria

- [ ] A `reply` with an "Approve" button without a `url` is posted to Slack with a platform `action_id` that names the Agent.
- [ ] The same blocks in a private answer to a whisper are refused with an issue that names link buttons.
- [ ] A click on that button in the fake gateway starts an addressed turn for the Agent in the post's thread, and the prompt names the person, the label and the button's `value`.
- [ ] A click on a button of a thread started with `start_thread` reaches the session that started it.
- [ ] A click with the command-menu prefix on an ephemeral message still runs the menu, and one with the `agent-button:` prefix on an ephemeral message starts nothing.
- [ ] A click in a conversation with no binding for the Agent starts no turn and sends the person a private notice.

## Smoke test

```sh
mise run //packages/api-server:check
mise run //packages/api-server:test
mise run check:comment-types
mise run check:markdown
mise run //docs:check:doc-size
```

All pass.
Manual, on the local cluster with a Slack workspace: ask the Agent in a channel to post a question with "Approve" and "Reject" buttons; click "Approve"; within a few minutes the Agent answers in the thread and names the person who clicked and the choice.
The buttons are still there after the click; sub-issue 06 removes them.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
