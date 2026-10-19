# 01 — Remove the agent signature in the form Slack delivers

**Part of:** An agent's tag of another agent in Slack reaches the named agent — see [README](./README.md)

## Context

Without the persona scope, the platform signs each agent post with an opening `<emoji> *<name>*` and a blank line.
When the post comes back from Slack, the platform must remove that opening before it reads which agent the post names.
The removal pattern matches only the text that the platform sends, but Slack sends back two spaces in place of the blank line, so the opening stays and the tag goes to the channel's default agent or to nobody.
This slice makes the inbound side use the same signing decision as the outbound side, and match the opening by its shape, so a tag by name reaches the named agent for every emoji form and every whitespace form.
The README has the evidence and the options not taken.

## Implementation plan

Apply the `/typescript-engineering` skill.
All code changes are in `packages/api-server/src/modules/channels/infrastructure/slack.ts`.
Line numbers are from `main` at `ea93a927b` and can move.

1. **Make the existing test show the bug first.**
   In `packages/api-server/src/__tests__/unit/slack-bot-posts.test.ts`, test "starts a turn for the agent it names" (about line 220), change the input of `h.mention(fromAlpha, …)` from the unsigned text to the delivered text, with two spaces:
   `":robot_face: *Alpha*  <@UBOT> Beta, can you check the deploy?"`.
   Change nothing else in the test.
   The fake gateway returns no granted scopes, so the worker signs, the same as a default install.
   Alpha is both the author and the harness default, so with the current code the post reaches nobody and the test fails on `prompts["agent-b"]`.
   Run it and see it fail before you change `slack.ts`.
   The harness echo of an agent's own post replays the text as sent (with `\n\n`), so the other tests in this file keep passing on both the old and the new code.
2. **One signing decision.**
   Beside `grantedScopes` and `hasScope` (about line 1213), add a module-level function that takes the granted scope set (`Set<string> | null`) and returns true when the set is not known to include `chat:write.customize`.
   In `agentPersona` (about line 2072), use it in place of `const customize = scopes?.has("chat:write.customize")`.
   Keep the behavior the same: an unknown set (null) signs.
3. **Strip only signed posts, by shape.**
   - Replace `AGENT_SIGNATURE_RE` (about line 1238) with `/^\S+\s+\*[^*\n]*\*\s+/`.
     Keep it next to `AgentPersona`, so that the pattern and `sign` stay together.
   - Make `withoutAgentSignature` (about line 1245) async and give it the gateway.
     It returns the event unchanged unless the sender is an agent and the helper from step 2 says that the event's workspace (`event.teamId`) signs.
     Widen its type parameter so the event carries `teamId: SlackWorkspace` (both event types have it).
   - Update its two callers, `handleInbound` (about line 4783) and `handleChannelMessage` (about line 5641), to await it after the `if (!gateway) return;` check.
   - Do not change `sign`, `peerTaggedBy` or `routeMention`.
4. **Docs.**
   In `docs/architecture/channels.md`, persona bullet (line 320), after the sentence "When such a post reaches another Agent, the opening is removed first, so a peer named at the start of the reply is still addressed.", add one sentence on its own line, for example:
   "Slack returns the line break after the opening as spaces, so the opening is found by its shape — an emoji in any form, then the bold name — and is removed only in a workspace where the platform signs posts."
   Keep the bullet's indentation.
   Bump `Last verified` to the day of the change.
   `slack-guarantees.md` needs no change: its row "An Agent's post tags the bot and names a peer" already promises this behavior.
5. **Format and check.**
   Run `mise run fix:markdown`, `mise run //packages/api-server:fix:format`, `mise run check:comment-types`, `mise run //packages/api-server:test` and `mise run check`.

## Acceptance criteria

- [ ] The changed test fails on the code before steps 2–3 and passes after them.
- [ ] On a signed post, the opening is removed for each of these first tokens: `:robot_face:`, a custom name with `-` such as `:dam-agent-5:`, raw `🦊`, `👍🏽`, `👩‍💻`, `🇨🇿`, `1️⃣`, and `:+1::skin-tone-4:`.
  It is removed when `\n\n`, two spaces or one space follow the bold name, and when the name has spaces.
  Check this with a throwaway script, and do not commit it.
- [ ] In a workspace that grants `chat:write.customize`, an agent post's text reaches its peers unchanged, for example `:warning: *Heads up*\n\nThe build failed`.
- [ ] Posts by people and by other apps are never changed.
- [ ] `sign` output is unchanged, and the persona and outbound tests pass without edits.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass, with no new test files and no new test cases.
- [ ] `channels.md` has the new sentence and a new `Last verified` date.

## Smoke test

**Automated, current suite:**

```bash
mise run //packages/api-server:test
```

The changed test "starts a turn for the agent it names" passes, and so do the persona, ambient and turn tests.

**Live, on the local cluster.**
The local Slack app has no persona scope, so it signs agent posts like a default install.
Use the [`cluster-ops`](../../../.agents/skills/cluster-ops/SKILL.md) skill for cluster work.

1. Build and roll the api-server from this worktree: `mise run cluster:build api-server`.
   Another session can replace the image; confirm that the running pod has the new pattern before you test.
2. Connect three agents, A, B and C, to one channel, and make A the channel's default (`/<brand.short> default A`).
3. As a person, tag C and ask it to post, with `send_channel_message`, exactly: `<@bot> B, reply with ok.`
   Expected: B gets the turn and answers "ok".
   In the api-server log, a `channel.authz` line for B has `"sender":"agent"` and `senderAgentId` of C.
   Before the fix, A got this turn.
4. Make C the default and repeat step 3.
   Expected: B gets the turn.
   Before the fix, no agent got a turn.
5. Give C a skin-tone emoji avatar (for example `👍🏽`) in the avatar picker, and repeat step 3.
   Expected: B gets the turn.
   Record the delivered `text` from the Bolt `Received a message on the WebSocket` debug line: it shows which emoji form Slack returns.
6. Optional, ambient: make A and B ambient readers, post a plain message as a person, and make A's ambient reply tag B.
   Expected: B answers once as an addressed turn, and the log shows `slack.ambient_turn.skipped_tagged` for B.
7. Remove the test connections and restore the channel's default.

After the run, print a short guide so the user can repeat steps 2–5 by hand in Slack.
