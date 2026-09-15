# 08 — Bind success redesign

**Depends on:** 07-bind-picker-redesign
**Part of:** UI — Slack integration discoverability — see [README](./README.md)

## Context

The page shown after a successful bind. Today it is a dense paragraph covering mentions, multiple
agents, defaults and unbinding all at once. The designer's note on the frame is blunt: *"The
language here today is wordy and a little unclear, we can simplify to just a few lines."* This
slice does that, and puts the ambient control here — the one place the user has just chosen to
lend the agent to a channel.

Apply the `/react-ui-engineering` skill.

## Ask for the Figma frames first

- Bind success page — **views 10, 18, 25**

There is no Telegram frame. Build it from the Slack one plus the differences below.

## Implementation plan

1. **Header.** The messenger icon plus "`<Agent>` has been added to `#design-dev`". For Telegram,
   the chat title with no `#`.

2. **Two lines, no numbered list.**

   > Mention `@DAM` in the channel to use it. If the channel has more than one agent, add the
   > name: `@DAM Jamies-Bot`
   >
   > Disconnect anytime with `/dam unbind Jamies-Bot`.

   Brand strings from `getBrand()`.

   The prototype has a three-item numbered list here whose first item tells the user to invite the
   bot — *after* the bind has already happened. Figma deletes it. Do not carry it over.

   **Telegram's version drops the multi-agent sentence**, because a Telegram conversation binds to
   exactly one agent, and its unbind command takes no agent name. Two shorter lines.

3. **Ambient toggle — Slack only.**

   > **Ambient mode**
   > The agent reads along in the channel and may chime in without being mentioned when it can
   > clearly help.

   **It starts off.** Three Figma frames draw it on; that is illustrative. Current behaviour is off
   on every path — `ambient === true` is the only thing that enables it — and
   [channels.md](../../architecture/channels.md) requires the opt-in to be deliberate, because
   ambient has the agent read every message in the channel. **Do not change the default.**

   Flipping it here writes through to the binding, exactly as the existing ambient controls do,
   and is recorded in the security log by the existing service path. Do not announce the change in
   the channel — the architecture is explicit that ambient changes are not posted.

   **Telegram has no ambient toggle.** There is not one `ambient` reference in the Telegram
   infrastructure.

4. **Keep the Telegram "Open @handle in Telegram" link**, which that page already has.

5. **"Back to Dashboard"** closes the flow.

## Acceptance criteria

- [ ] The header names the agent and the conversation, `#name` for Slack and a bare title for
      Telegram.
- [ ] The body is two short lines, with no numbered list and no post-bind invite step.
- [ ] Telegram's body omits the multi-agent sentence and its unbind command takes no agent name.
- [ ] The ambient toggle appears on Slack only and is **off** when the page loads.
- [ ] Toggling ambient persists to the binding and is visible afterwards on the agent's Channels
      section.
- [ ] Toggling ambient posts nothing into the channel.
- [ ] Telegram keeps its "Open @handle in Telegram" link.
- [ ] `mise run check`, `mise run test` and `mise run check:comment-types` pass.

## Smoke test

```bash
mise run check && mise run test
```

On the local dev cluster, complete a Slack bind and land on this page. Confirm the header names
both, that the body is two lines, and that **ambient is off**. Turn it on, then open the agent's
Channels section and confirm the row now reads "Ambient on". Check the Slack channel itself and
confirm nothing was posted about it. Repeat the bind in Telegram and confirm there is no ambient
toggle, no multi-agent sentence, and that the Open in Telegram link works.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user
can confirm it by hand.
