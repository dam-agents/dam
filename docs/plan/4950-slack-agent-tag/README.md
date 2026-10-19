# An agent's tag of another agent in Slack reaches the named agent

> Working plan — temporary, committed on the feature branch.
> Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/4950

## Goal

An agent's Slack post that opens with the bot mention and another agent's name must start that agent's turn, the same as a person's post does.
Today this fails on every install without the persona scope (`chat:write.customize`).
The app manifest does not ask for that scope (it is opt-in), so every default install is affected.

- When another agent is the channel's default, the default agent gets the request, with its own owner's access and spend.
- When the asking agent is the default, nobody gets the request, because an agent's own post never starts its own turn.
- In an ambient round, the named peer also skips its own turn, so it sees nothing.

Nobody sees that the request went wrong.
After the fix, the named agent gets the turn in all three cases.

## Approach

Architecture: [channels.md](../../architecture/channels.md), section "Posts by Agents and apps" and the persona bullet in the Slack scopes section.
The page already says that the opening is removed before an agent's post reaches another agent.
The code does not do this for the text that Slack sends back.

### How it works today

- Without the persona scope, `agentPersona` in `packages/api-server/src/modules/channels/infrastructure/slack.ts` signs each agent post (`send_channel_message`, `reply`).
  The `text` field gets `<emoji> *<name>*\n\n<text>`, and the markdown block gets `**<name>**`.
- When the post comes back as a Slack event, `withoutAgentSignature` removes the opening with `AGENT_SIGNATURE_RE = /^:[a-z0-9_'+-]+: \*[^*\n]*\*\n\n/`.
  Then `routeMention` in `slack-routing.ts` reads the name after the bot mention.

### Root cause (verified)

A capture from 2026-10-14 shows both texts, checked byte by byte with `od -c`:

- Sent `text`: `:robot_face: *curvebender*\n\n<@U…> meter-claude, …`
- Event `text` from Slack: `:robot_face: *curvebender*  <@U…> meter-claude, …`

Slack turns the line breaks into two spaces.
The stored blocks keep `"\n\n"` in a `rich_text` element; only the `text` changes.
The pattern needs `\n\n`, so it never matches, and the signature stays at the start of the text.

- `routeMention` finds no name after the bot mention and falls back to the channel's default agent.
- When the default is the author, `senderReaches` drops the post, and no notice goes out.
- In an ambient round, `peerTaggedBy` reads the agent's unsigned reply text, so the named peer is marked as tagged and skips its round.
  The echo of the post then goes through `handleInbound` with the signed text and lands on the default.

The security log of the capture shows the first two cases: a `channel.authz` line for the default agent with `senderAgentId` of the author, and, with the author as default, no turn at all.
The ambient case follows from the code.

### Two more gaps in the same pattern

An offline run of the pattern on these forms found them:

- **Emoji forms.** The avatar picker accepts any RGI emoji.
  A signature can open with raw Unicode (`🦊`, `👍🏽`, `👩‍💻`, `🇨🇿`, `1️⃣`).
  If Slack turns it into shortcodes, it opens with `:fox_face:` or `:+1::skin-tone-4:`.
  The current pattern accepts only one `:shortcode:`.
- **Unsigned posts.** The strip runs on every agent post, also where the persona scope is granted and posts are not signed.
  There, a post that opens with `:warning: *Heads up*` and a blank line loses that heading before its peers read it.

### The fix

1. **One signing decision for both directions.**
   A workspace signs agent posts when its granted scopes are not known to include `chat:write.customize`.
   An unknown set signs, as today.
   `agentPersona` and the inbound strip use the same helper.
   The scopes come from `testedAuthFor`, which is cached and which the inbound path already calls for each event, so the inbound check makes no Slack call.
2. **On a signed post, match the opening by its shape, not by its exact bytes.**
   The pattern is one token without whitespace (the emoji in any form), whitespace, the bold name, then any whitespace: `/^\S+\s+\*[^*\n]*\*\s+/`.
   A signed post always opens with the signature, so the loose first token cannot match anything else.
3. **No change to how posts are signed.**

### Options not taken

- **Widen the pattern to a `:shortcode:` or one Unicode emoji, and keep stripping every agent post.**
  It misses `:+1::skin-tone-4:`, and it strips more unsigned headings than today (`:warning: *Heads up* the build failed` loses its first words).
- **Match the author's exact name.**
  Each post needs a name lookup, and Slack can change markdown characters in a name, because agent names are free text.
- **Keep the signature out of `text`, in the block only.**
  Nobody has shown that Slack keeps `text` apart from the blocks.
  Notifications would also lose the agent's name.

### Out of scope

- Catch-up history lines still show the signature after the author label.
  This is noise only; it does not change routing.
- No notice goes to the asking agent or to the channel when a tag reaches the wrong agent.
  The issue does not ask for one.

## Conventions & glossary

- **Signature, opening:** the `<emoji> *<name>*` start that the platform puts on an agent post when it cannot post under the agent's name.
- **Persona scope:** `chat:write.customize`.
  It is opt-in and not in `etc/slack/app-manifest.yaml`.
- **Signing workspace:** a workspace whose granted scopes are not known to include the persona scope.
- **Delivered text:** the `text` of the Slack event, not the text the platform sent.
- Apply `/typescript-engineering` (server-side TS).
  No UI change.
- Comments: follow `docs/guidelines/comment-guidelines.md`.
  The Slack fact goes into `channels.md`, not into a code comment.
- No new tests.
  Sub-issue 01 changes the input of one existing test to the delivered text.

## Whole-feature smoke test

The feature is one sub-issue, so the smoke test of [01](./01-strip-signature-as-delivered.md) covers the whole feature.

## Delivery

Each sub-issue is one atomic commit.
The whole feature lands as a single PR for https://github.com/dam-agents/dam/issues/4950.
