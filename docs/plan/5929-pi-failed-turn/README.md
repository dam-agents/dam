# A failed Pi model call fails the turn

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/5929

## Goal

When a Pi model request still fails after Pi's own retries, pi-acp (Pi's bridge to the platform) ends the turn as a normal reply and drops the error (upstream [svkozak/pi-acp#135](https://github.com/svkozak/pi-acp/issues/135)).
The platform works around a part of this: in the web chat, Pi writes "Model request failed: …" as reply text.
So on Pi, a failed model call never looks like a failure:

- **Web chat:** the reply holds the error text, with no failed-message card, no Retry and no Switch provider.
- **Slack and Telegram:** the person who wrote gets no reply.

After this change, a failed model call on Pi fails the turn, as it does on Claude Code.
The web chat shows its failed-message card with Retry, and Slack and Telegram get their failure reply.
The error shows once, on the card.
A request that succeeds within Pi's own retries stays a normal reply.

## Acceptance criteria

### AC-1 — the web chat shows the failed-message card

Given an agent on the Pi harness with an Anthropic Connection, and the banner names an Anthropic outage
When the owner sends a message in the agent's chat
Then within five minutes the chat shows a card that says Anthropic has had problems since the outage started, with a Retry action

### AC-2 — the error shows once

Given that card
When the owner reads the agent's reply
Then the chat shows no "Model request failed" text as a reply above the card

### AC-3 — the Slack thread gets a reply

Given an agent on the Pi harness with an Anthropic Connection, connected to a Slack channel, and the banner names an Anthropic outage
When a person mentions the agent in that channel
Then within five minutes the thread gets a reply that says the message failed

### AC-4 — the Telegram chat gets a reply

Given an agent on the Pi harness with an Anthropic Connection, bound to a Telegram chat, and the banner names an Anthropic outage
When a person writes to the agent in that chat
Then within five minutes the chat gets a reply that says the message failed

## Approach

Read these first:

- [`packages/agents/pi-agent/README.md`](../../../packages/agents/pi-agent/README.md), sections **Provider errors in the chat** and **pi-acp patch**: what the patch changes in pi-acp today, and how it stays safe across pi-acp versions.
- [provider-status](../../architecture/provider-status.md), **The failed turn** and **The status line**: the card, its Retry rule, and the line that names an outage while a turn runs.
- [channel-turns](../../architecture/channel-turns.md): the failure reply of an addressed Slack or Telegram turn.

### Where the fix goes

The whole fix is in the Pi image.
[`pi-acp-patch.mjs`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs) already edits pi-acp 0.0.34 in memory as it loads; since #4459 it ends a reply cut at the output limit with `max_tokens`.
The same patch now fails a turn whose last model request failed.
The agent-runtime, the api-server and the UI need no change: they already handle a failed turn from Claude Code, and the facts below show that a failed Pi turn takes the same paths.

### How pi-acp ends a turn (0.0.34)

- Pi sends `turn_end` after each model call, with the assistant message: its `stopReason` (`stop`, `toolUse`, `length`, `error`, `aborted`) and, on `error`, its `errorMessage`.
  The patch already records the `stopReason` there.
- Pi sends `agent_settled` once the whole run is over, retries included.
  pi-acp then calls `settleTurn`, which resolves the pending turn with a stop reason; the patch already picks `max_tokens` there for a `length` stop.
- A rejected turn makes pi-acp's `session/prompt` handler throw.
  The ACP library (`@agentclientprotocol/sdk` 0.26) answers with JSON-RPC `-32603` `"Internal error"` and `data.details` set to the error's message.
  It first tries to read that message as JSON: a message that is pure JSON, or only a number, becomes `data` with no `details`, and the chat then shows only "The agent couldn't process this message."
  The patch's existing `settleTurnsOnExit` already rejects turns this way when pi exits.

### What the patch does after this change

1. **Records the error.**
   At `turn_end`, the patch keeps the `errorMessage` together with the `stopReason`.
   `startTurn` already clears the record.
2. **Fails the turn.**
   In `settleTurn`, when no cancel was requested and the last recorded `stopReason` is `error`, the patch rejects the pending turn with an `Error` whose message is `Model request failed: <errorMessage>`.
   Only the last model call counts: a call that failed and then succeeded on Pi's retry, or after Pi's compaction, ends with a success stop and stays a normal reply.
   The prefix keeps the message from being read as JSON, and it gives the chat's outage pattern `failed: 503` also when the provider's error text has no `HTTP 503` (for example `503 status code (no body)`).
3. **Drops pi-acp's retry lines.**
   For each retry, pi-acp writes `Retrying (attempt n/3, waiting Ns)...` as reply text, and at the end `Retry finished, resuming.`, also when every retry failed.
   The patch removes those two writes, so a reply holds no harness text of its own.

`pi-dynamic-providers` then stops writing `Model request failed: …` into the chat: its `reportProviderErrors` handler and the `PI_PLATFORM_REPORT_ERRORS` switch in `harness-chat` go.

### Why the retry lines go

Pi retries 5xx, 429, "overloaded", timeouts and connection errors 3 times, after 2, 4 and 8 seconds; it does not retry an expired key, a refused model, or a quota or billing error.
So an outage error is exactly the error that writes retry lines.
The chat treats a reply that has text before its error as an interrupted answer, and an interrupted answer's card has no Retry, by design ([provider-status](../../architecture/provider-status.md)).
With the retry lines, AC-1 would fail.
Claude Code also retries without writing into the reply, and during a known outage the chat's status line already says that the provider is not responding and the agent keeps trying.
The cost: when no outage is known, a throttled or briefly failing call shows only the working dots and the "Working for" timer during Pi's retries, for about 14 seconds.

### How the failure reaches each surface

- **Web chat, the tab that sent the message.** The reply has no text, so `use-acp-prompt.ts` marks the user's message as failed (`failUserMessage`) and drops the empty reply.
  `chat-message.tsx` then shows the provider card in the agent's column, with Retry; the card's text comes from Provider Status for the session's template, so it names Anthropic and its outage start.
  The raw error shows only under the card's Raw error.
- **Web chat, another open tab.** The runtime's `platform_turn_ended` frame carries the error, and the projection puts it on the reply; that tab shows the card with no Retry, as it does for Claude Code today.
- **Slack and Telegram.** `acp.sendPrompt` rejects, and the worker posts the failure reply of `turn-failure-copy.ts`: "Something went wrong while relaying this message — try again."
  Text output never reaches these channels, so the retry lines never mattered there.
  When #5921 lands, that reply names the outage, for Pi too, with no extra code.

### Side effects

- A spend refusal or an expired key on Pi now gets the chat's own spend-limit or key message, in place of reply text.
- A scheduled run, a sub-agent call or a CLI run on Pi whose last model call failed now ends as failed, as on Claude Code.
- The terminal (`pi` in a shell) never had the workaround and does not change.

### The decisions

The user made these decisions while the plan was discussed:

1. **The retry lines go.** The patch drops pi-acp's retry lines, in place of a chat rule that ignores Pi's text or a new status for retries.
   Retry feedback in the chat, if wanted later, is a feature for every harness.

## Conventions & glossary

- **pi-acp**: Pi's ACP bridge, pinned at 0.0.34 in [`image.toml`](../../../packages/agents/pi-agent/image.toml); the agent-runtime talks ACP to it.
- **The patch**: [`pi-acp-patch.mjs`](../../../packages/agents/pi-agent/rootfs/usr/local/share/pi-platform/pi-acp-patch.mjs), loaded by `harness-chat` with `--import`; each edit is an exact `find`/`replace` with an expected match `count`, and the patch applies only when every edit matches.
- **Failed turn**: a `session/prompt` that ends with a JSON-RPC error, not a stop reason.
- **Engineering skills**: the change is plain ESM JavaScript in the image and one TypeScript Pi extension; no server-side or UI TypeScript changes.
  Apply `/typescript-engineering` only if the slice ends up touching `packages/agent-runtime` or `packages/api-server`, which this plan does not expect.
- **Comments**: none, except typed comments ([comment guidelines](../../guidelines/comment-guidelines.md)).
  Run `mise run check:comment-types`.
- **Tests**: add no new tests.
  The existing Pi image tests run the real Pi through the patched pi-acp and fail when an edit does not match the bundle.
- **Docs**: the slice updates the pi-agent README and [provider-status](../../architecture/provider-status.md) in the same commit, with one sentence per line and a new `Last verified:` date.

## Whole-feature smoke test

Run on the local dev cluster with Slack, and Telegram if it is configured ([`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md)).
Rebuild the agent images from this worktree (`mise run cluster:build -- agents`), and check that the Pi agent's pod runs the new image.
Use a Pi agent with an Anthropic Connection, connected to a Slack channel and, if possible, bound to a Telegram chat.

1. **A normal reply first.** Send a message in the agent's chat: the reply is normal, with no retry text.
2. **Simulate the Anthropic outage** in the cluster VM (`mise run cluster:shell`): resolve the Anthropic API host and add an `iptables` REJECT rule (`--reject-with tcp-reset`) for its address in the `FORWARD` chain.
   Wake the agent before you add the rule, then delete the agent's gateway pod, because open upstream connections bypass the rule.
   Wait until the banner names an Anthropic outage.
3. **AC-1 and AC-2:** send a message in the agent's chat.
   Within about 20 seconds the chat shows the provider card in the agent's column: Anthropic has had problems since the outage started, with Retry.
   No "Model request failed" or "Retrying" text shows as a reply; Raw error holds `Model request failed: …`.
   Take a screenshot of this state for the PR.
4. **AC-3:** mention the agent in its Slack channel; within five minutes the thread gets the failure reply.
5. **AC-4:** write to the agent in its Telegram chat; within five minutes the chat gets the failure reply.
6. **Recovery:** remove the REJECT rule, press Retry on the card: the message goes again and the agent answers normally.
7. **Reload:** reload the chat once and note what it shows for the failed exchange.
   A card lost on reload is a known limit (#3761).
   If the failed message shows twice, file an issue for it: it is not part of this fix, because every harness takes that path when a turn fails with no reply text.

Remove every rule you added before you finish.

## Delivery

The feature is one sub-issue, and so one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/5929.
