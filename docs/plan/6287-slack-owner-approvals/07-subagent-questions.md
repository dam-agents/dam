# 07 — Sub-agent questions and launch rules reach the owner

**Depends on:** 06-when-cards-go-out
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

A sub-agent asks its owner with `ask_owner`; the question waits in the Driver's web chat and the approvals bell, for one day by default, and only the owner answers.
An owner who is not in the web UI never sees it, so the sub-agent takes its default.
This slice sends a card for a question under the same timing rule as a `background` request: when it still waits after 60 seconds and the owner is not active in the web UI, wherever its delegation tree started.
The card works like Claude's question UI: a radio list of the options, "Other" with a text field, and "Send answer".
Each card is keyed to its run, so with several sub-agents waiting, each answer reaches the right one, and the Driver still has no way to answer.
The one-day default stays.

A one-off sub-agent can also wait at its launch: an allow rule its Driver sets there waits for the owner (an `egress_proposal` row with `forAgentId`), and the sub-agent's task is held until the owner has answered every one, up to the spawn's deadline.
This slice puts such a rule as a row on the Driver's background card, under the same timing rule.
An agent's own rule proposal does not hold the agent, so it stays in the app and in `/dam approvals`.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Events.** In `packages/api-server/src/events.ts`, add `OwnerQuestionAsked` and `OwnerQuestionClosed` (how it closed: `owner`, `default` or `stopped`), each with the run id, the invocation id and the owner.
   Emit them from `owner-questions.ts` (the ask, and every answer, including the default that `question-deadlines.ts` gives through it) and the stop paths of an asking run (`delegation-stop.ts`, `driver-cascade.ts`).
   Run `mise run //packages/api-server:check:events`.
2. **Question ports.** The invocations module gives the Slack worker its own question ports (`composeOwnerQuestionPorts`), because questions live there and not in the approvals module of `ownerRequests.view`: by run id, the sub-agent's label, its Driver's name, the question, the options, the default, the deadline (`answerBy`), the status, and the answer with how it closed.
   The ports also list the open questions, so the sweep of [05](./05-card-lifecycle.md) places a question card by the timing rule of [06](./06-when-cards-go-out.md) and settles it when the question closes.
3. **Renderer.** In `channels/domain/`, add the question card; the question and the options show as `plain_text`:
   - "<Driver>'s sub-agent <name> asks:" and the question;
   - an `input` block with `radio_buttons`: the options (at most 8) and "Other"; an option can have 80 characters (`MAX_OWNER_OPTION_CHARS`) but Slack shows at most 75, so cut the label at 75 with "…" and carry the option's index in its `value`;
   - an `input` block with a multiline `plain_text_input`, "Your answer";
   - an `actions` block with one `primary` button, "Send answer";
   - a context line: "Waits until <time>, then takes <default>."
     (or "then goes on without an answer" for an open question);
   - an open question (no options) has the text field and "Send answer" only.
     Input blocks send nothing on a pick, so only "Send answer" reaches the click handler, with every field's value (`fields` in `onMessageAction`).
4. **Answer.** In the `owner-request:` click route of [03](./03-mcp-tool-call-cards.md), for the question kind:
   - an option picked → that option's full text, found by the index in its `value`; "Other" picked → the text, which must not be empty; nothing picked but text written → the text; nothing at all → a private "Pick an option or write an answer."
     and no change;
   - check the clicker is the owner, then answer through the same service path as `invocations.answer` (`delegation-control.ts` → `owner-questions.ts`), run as the owner; a closed question answers privately "Already answered".
5. **Lifecycle.** A saga places the card one minute after `OwnerQuestionAsked`, and the sweep places any question the saga missed.
   The saga closes the card on `OwnerQuestionClosed`, with "Answered: <answer>" (by you, or in the app), "Took its default <option> after the deadline", or "The sub-agent was stopped".
6. **Launch rules.** When the approvals service files a Driver rule for a one-off sub-agent (`child-egress-requests.ts`), give the row the route `background`; it already emits `ApprovalRequested`.
   Extend `ownerRequests.view` with that kind: the sub-agent, its Driver, the rule (method, host and path, or the wildcard) as `plain_text`, whether it is wider than the Driver's own reach, and the spawn's deadline.
   The row on the Driver's background card offers the web's verdicts for that type (see `use-approval-actions.ts`), mapped in `decide` to the same service calls; a verdict the web offers only in the app stays behind "Open in app".
   A wildcard rule says so in its label, as the web's does.
   The sweep of [05](./05-card-lifecycle.md) places it by the timing rule of [06](./06-when-cards-go-out.md), and settles it like any approval row.
   An agent's own rule proposal (no `forAgentId`) gets no route and no row.
7. **Slack mobile.** Check the card in the Slack mobile app.
   If the radio list renders poorly, keep the radio list on desktop and add an "Other…" button that opens a modal with the text field (`views.open`); tell Petr.
   Not done in this slice: it needs a person with the Slack mobile app.
8. **Docs.** In `docs/architecture/invocations.md` "Asking the owner": a question also goes to the owner as a Slack card when the owner is not active in the web UI; the one-day default is unchanged.
   In `docs/architecture/invocations.md`, where a Driver's launch rule waits for the owner: it also reaches the owner as a row in Slack.
   In `docs/architecture/home-feed.md` "Sub-agent questions": the bell still lists the question; a Slack answer clears it.
   In `docs/architecture/slack-owner-requests.md`, the question card, the launch-rule row, and their timing.

## Acceptance criteria

- [ ] With the web UI closed, a sub-agent's `ask_owner` with options puts one question card in the owner's DM about 60 seconds later, with the options, "Other", the text field, "Send answer", the deadline and the default.
- [ ] While the owner uses the web UI, no card arrives; when the owner leaves it, the card arrives at the next sweep while the question still waits.
- [ ] Picking an option and sending continues the sub-agent with that option; the card reads "Answered: <option>".
- [ ] "Other" with text continues the sub-agent with the text; "Other" with no text, or nothing at all, gives a private hint and changes nothing.
- [ ] Two waiting sub-agents get two cards, and each answer reaches its own sub-agent.
- [ ] An option of 80 characters shows cut to 75, and picking it answers with the full 80-character text.
- [ ] Answering in the Driver's web chat, the deadline's default and a stop each edit the card to their outcome.
- [ ] A Driver rule for a one-off sub-agent gives a row on the Driver's background card about 60 seconds later; approving it starts the sub-agent's task.
- [ ] An agent's own rule proposal gives no row.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md), with an agent that has the sub-agent tools.

1. In the test channel, ask the agent: "Spawn a sub-agent that must ask me with ask_owner whether to use plan A or plan B, then report my choice."
   Keep the web UI closed.
   About a minute later the owner's DM gets the question card.
2. Pick "Other", leave the text empty, Send: a private hint; type "plan C", Send: the sub-agent's result reaches the Driver with "plan C", and the card reads "Answered: plan C".
3. Ask for two such sub-agents at once: two cards; answer them differently; each result matches its card.
4. Start the same task from the agent's web chat and keep using the web UI: no card arrives; the question shows in the chat as before.
5. With the web UI closed, ask the agent to spawn a one-off sub-agent with its own network rules that allow `https://example.org/`: about a minute later the Driver's background card shows the launch rule; approve it: the sub-agent starts and reports the page's title.
