# 09 — Harness prompts on Slack turns

**Depends on:** 05-card-lifecycle
**Part of:** An agent working in Slack or unattended asks its owner in Slack — see [README](./README.md)

## Context

A harness can still stop to ask before a tool call, although the runtime keeps `auto` in Slack turns and schedules: Claude Code's Auto mode now and then, Bob before a write into `~/.bob` or a command its own safety check flags, CUGA before a shell command.
Today the Slack relay answers every such prompt "no" at once (production, 30 days: 184 refusals on 35 agents, none after 2026-11-20).
This slice holds such a prompt on an addressed Slack turn of an owner who can get cards, puts it as a row on the agent's turn card, and answers the harness with the owner's choice; Stop ends the turn, and "Don't wait" refuses the prompt and lets the turn go on.
Prompts in runs nobody watches are [10](./10-harness-prompts-in-unwatched-runs.md).
The runtime's start mode does not change.

## Implementation plan

Apply the `/typescript-engineering` skill.

1. **Data check first.** Ask Petr to get, from the analytics agent, the titles of the expired `acp_native` approvals and of the Slack-turn permission refusals since 2026-11-20, with the harness and the session type (the query is in the Bob issue draft).
   If what is left is only Bob's protection of `~/.bob` and the filed Bob issue removes it, stop and agree the scope of this slice and of [10](./10-harness-prompts-in-unwatched-runs.md) with Petr before going on.
2. **Real prompt shapes.** On the local cluster, capture one `session/request_permission` frame from each harness that asks, and write down its `toolCall` fields and options:
   - Claude Code (`claude-agent-acp` 0.104.0) puts the canonical tool name in a top-level `name`, which the relay's `permissionToolName` reads;
   - Bob sends no `name` and no `_meta`: only `toolCallId`, `title` (display text with the path or command), `kind`, `rawInput` and `content`; its protected calls offer only allow once and reject;
   - CUGA: not yet known; capture it.
     Confirm that a prompt about a platform MCP tool with a canonical name is still allowed once without a hold (`isPlatformMcpTool`).
     A harness that sends no canonical name cannot be recognized safely, because a title can be faked: its prompts, the reply tool included, become ordinary rows.
3. **A port to record and read a held prompt.** In the approvals module, expose (and wire in `bootstrap.ts` into the Slack worker's deps) a port with two calls:
   - record: an `acp_native` row through the same path as `recordAcpNativePending` in `approvals-relay-service.ts` (id from `acpNativeRowId(agent, session, rpcId)`), with the route `turn`, `expiresAt` at the hold window, and the Slack turn in its payload (team, channel, thread `ts`, sender); it emits `ApprovalRequested` with `ownerRoute`;
   - read: the settled outcome of a row (verdict and the option the verdict picks, through `pickOptionId`), or "still pending".
4. **The relay holds instead of refusing.** In `packages/api-server/src/core/acp-client.ts`, the `requestPermission` handler of `withAcpConnection`:
   - keeps the platform-tool allow-once first, unchanged;
   - when the caller passed a hold hook in the `sendPrompt` options (new, optional), calls it with the request and its JSON-RPC id (pass the id from `ctx` in `connectClient`'s `onRequest`), and answers the harness with the option the hook returns;
   - with no hook, or when the hook returns nothing, refuses as today (same security log line).
     The Slack worker passes the hook only on an addressed Slack turn (the `addressed` value of [01](./01-one-hold-decision.md)) of an owner whose `canCard` is `ok`; the artifact viewer and Telegram pass none.
     The hook records the row, then waits for it to settle: subscribe to `approval:<id>` on the Redis bus and poll as `held-verdict.ts` does, up to the hold window.
     Settled with an allow → answer that option; settled with a deny → the deny option; the window ends → expire the row (`expirePending`) and answer the reject option, or cancel where the prompt offers none, as today.
     The relay's own answer and the approvals service's frame delivery (`resolveAndDeliverAcpNative`) may both reach the runtime; the runtime takes the first answer (`pending-agent-requests.ts`), so check that the second is dropped quietly.
5. **Stop settles the wait.** When the turn is cancelled (the `agent_session_stopped` path, or any abort of the relay's prompt), the hook stops waiting, expires the row with a recorded reason `stopped` (in the row's payload, so the request view can tell it), and answers the harness `cancelled`; the settle path of [05](./05-card-lifecycle.md) renders "The turn was stopped".
6. **"Don't wait" settles the wait.** The prompt waits in the turn's own relay, so the press of [02](./02-card-base.md) releases it there, not on the bus: the turn's bookkeeping in `slack.ts` keeps a handle that ends the hook's wait, and only this turn's prompts end.
   On a release, the hook answers the harness with the reject option (or `cancelled` where the prompt offers none) and expires the row with the recorded reason `released`, because the harness takes one answer per prompt and a later answer can no longer reach it; the row reads "The person who asked went on without it".
7. **Renderer and answer.** In `channels/domain/`, add the prompt row of the turn card: the tool (its canonical name, else its title as `plain_text`), its `rawInput` in a code block cut at about 2,500 characters with "Open in app" when cut, the expiry, who asked (a Slack mention) with a link to the thread, and one button per harness option (allow ones `primary`, reject ones `danger`).
   "Allow all once" and "Deny all" never cover a prompt row.
   In `decide`, map each option kind to the approvals service verdict Home uses for an `acp_native` row, so `pickOptionId` gives the harness the option clicked.
8. **Thread line and turn contract.** A held prompt posts the thread line of [02](./02-card-base.md), once per turn.
   In `packages/api-server/src/modules/channels/infrastructure/permission-check-copy.ts`, pick the text by `canCard`: `ok` → a tool call that asks waits for the owner's answer in Slack, up to the hold window, and a refusal after "Don't wait" means that the person who asked went on without it; `unlinked` or `muted` → today's text, plus the hint of [01](./01-one-hold-decision.md) or [08](./08-dam-approvals-and-mute.md).
9. **Security log.** A held prompt logs `approval.slack_hold` (category `approval`, agent, tool label, session, route) in place of `approval.unattended_deny`; the expiry logs the refusal with reason `owner-did-not-answer`; Stop logs `stopped`; "Don't wait" logs `released`.
10. **Docs.** In `docs/architecture/channel-turns.md`, rewrite the paragraph "A relayed turn answers its own permission prompts, and it answers them no" for an addressed turn of an owner who can get cards (held, then answered), keep the refusal for the rest, and add Stop and "Don't wait" during a wait.
    In `docs/architecture/tool-approval.md`, one sentence that a prompt in an addressed Slack turn reaches the owner in Slack, while the start mode stays as it is.
    In `docs/architecture/slack-owner-requests.md`, the prompt row and the prompt shapes per harness.
    In `docs/architecture/slack-guarantees.md`, the rows about refused permission prompts.
    In `.quality-inspector/qi-profile-dam/SKILL.md`, the prompt row.

## Acceptance criteria

- [ ] With a linked owner, a harness prompt on an addressed Slack turn does not fail at once: the owner's turn card gets a row with the tool, its input and the harness's options, and the thread shows the line that the agent asked its owner.
- [ ] Allow once runs the call and the agent replies in the thread; Reject refuses it and the agent says so.
- [ ] No answer within the hold window refuses the call, and the row reads "Expired".
- [ ] Stop during a wait ends the turn at once, and the row reads "The turn was stopped".
- [ ] "Don't wait" during a wait answers the harness with the reject option at once; the agent replies without the call, and the row reads "The person who asked went on without it".
- [ ] A prompt on an ambient round, an artifact turn or a turn an app started is refused at once, as before.
- [ ] A Claude Code prompt about a platform MCP tool is still allowed once without a row.
- [ ] An unlinked owner's prompt on a Slack turn is refused at once, as before.
- [ ] `mise run check` and `mise run //packages/api-server:test` pass.

## Smoke test

Set up as in [01](./01-one-hold-decision.md), with a Bob agent on Auto-approve bound to the test channel.

1. From another member, ask the Bob agent to write a file into `~/.bob`: Bob asks; the owner's turn card gets a row with the path and Allow once / Reject; the thread shows the line that the agent asked its owner.
2. Click Allow once: the write goes through and the agent replies; the row shows the outcome without the input.
3. Ask again and press Stop on the working status: the turn ends, and the row reads "The turn was stopped".
4. Ask again and press "Don't wait" on the thread's line: the agent replies without the write, and the row reads "The person who asked went on without it".
5. `/dam logout`, repeat step 1: the prompt is refused at once, as before this slice.
