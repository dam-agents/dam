# 01 — Rewrite the Slack channel and connection explainers

**Part of:** The Slack explainers tell a user whether they need a channel or a connection — see
[README](./README.md)

## Context

Replace the copy of both Slack help popovers with the agreed copy, which says when to use each
path and who the agent speaks as. Make the connection popover's "Add a Slack channel →" link work
on the create page, so a user who opened the Connection catalogue there can get back to the
**Slack Channel** row without leaving setup. The copy, the two planning decisions and every place
the popovers show are in the README.

## Implementation plan

Apply the `/react-ui-engineering` skill.

1. **Channel popover copy** —
   [`channel-connection-explainer.tsx`](../../../packages/ui/src/components/channel-connection-explainer.tsx),
   `SlackChannelExplainer`. Replace the two paragraphs and the standalone `CrossLink` with:
   - paragraph 1: the README's channel text, with the bot's name from `getBrand().name`
     (import from `../brand.js`, as `slack-install-request.tsx` does);
   - paragraph 2: the question sentence followed, in the same `<p>`, by
     `<CrossLink label="Use a Slack connection" onFollow={onGoToConnections} />`. `CrossLink` is
     `inline-flex w-fit`, so it flows after the sentence; keep its arrow and its grey fallback.
   Keep the props, the `aria-label`, the `ExplainerPopover` options and the install-request
   footer unchanged. Escape apostrophes the way the file already does (`&apos;`).

2. **Connection popover copy** — same file, `SlackAccountExplainer`. Same structure, the
   README's connection text, link label "Add a Slack channel". Add a boolean prop that says
   whether an agent is in context (name it to match the file's style, e.g. `forAgent`). With it,
   the text says "this agent" / "the agent"; without it, "an agent" in both sentences.

3. **Pass the agent context** —
   [`catalog-provider-card.tsx`](../../../packages/ui/src/modules/connections/components/catalog-provider-card.tsx)
   renders `SlackAccountExplainer`. Set the new prop from `sandbox !== undefined`: the catalogue
   gets `sandbox` on the create page and the agent Connections tab, and none on the global
   Connections page (`connections-view.tsx`). No change to `ConnectionCatalogModal`'s props.

4. **Wire "Add a Slack channel →" on the create page** —
   - [`setup-sections.tsx`](../../../packages/ui/src/modules/sandboxes/components/setup/setup-sections.tsx),
     `useSetupConnectionCatalog`: accept an optional `onGoToChannels`. When it is given, pass the
     modal an `onGoToChannels` that closes the modal (the hook owns `open`) and then calls it.
     When it is absent, pass nothing, so the link stays grey text.
   - [`agent-create-view.tsx`](../../../packages/ui/src/modules/agents/views/agent-create-view.tsx):
     pass `onGoToChannels` only when the **Slack Channel** row renders — `!kit` and
     `availableChannels?.slack`. It moves focus to that row's checkbox. Do **not** tick it.
   - [`setup-channels-section.tsx`](../../../packages/ui/src/modules/sandboxes/components/setup/setup-channels-section.tsx):
     give the create view a way to reach the Slack row's checkbox (a ref is the React way; the
     checkbox already has the id `setup-channel-slack`). Focusing it scrolls it into view and
     shows its focus ring — add no new styling.
   - **Focus-restore trap.** `Modal`'s `useFocusTrap` (`components/modal.tsx`) restores focus to the
     element that opened the modal in its unmount cleanup. A `focus()` call made in the same
     handler that closes the modal is overwritten. Move focus after the modal unmounts — for
     example from an effect in the create view keyed on a "focus the Slack row" request, or in
     the next animation frame.
   - The catalogue opened from a starter kit's requirement card (`connectAccepts` in
     `agent-create-view.tsx`) gets no `onGoToChannels`; leave it so.

5. Run `mise run //packages/ui:fix` if format or lint complain, then the checks below.

## Acceptance criteria

- [ ] Neither popover contains the old copy ("The agent answers as itself always", "that's a
      Connection", "Go to Connections", "Go to Channels").
- [ ] Both popovers show the README's copy word for word, with the bot's name from
      `getBrand().name`; `grep -rn "DAM" packages/ui/src/components/channel-connection-explainer.tsx`
      finds nothing.
- [ ] On the global Connections page, the Slack card's popover says "an agent" in both sentences;
      in the create page's catalogue and on the agent Connections tab it says "this agent" and
      "the agent".
- [ ] On the plain create page, "Add a Slack channel →" closes the catalogue and leaves keyboard
      focus on the **Slack Channel** checkbox, with the row scrolled into view and the checkbox
      still unticked.
- [ ] On a starter-kit create page and on the global Connections page, "Add a Slack channel" is
      grey text with no arrow, as before.
- [ ] On the agent page, both links still switch tabs as before (Channels ↔ Connections).
- [ ] `mise run //packages/ui:check`, `mise run //packages/ui:test` and
      `mise run check:comment-types` pass.

## Smoke test

Automated, against the current suite:

```bash
mise run //packages/ui:check
```

```bash
mise run //packages/ui:test
```

```bash
mise run check:comment-types
```

Manual, on the local dev cluster (Slack must be configured, see the `cluster-ops` skill):

```bash
mise run cluster:build ui
```

1. Open `http://localhost:4444`, start a new agent from the plain path (not a starter kit).
2. In **Channels**, hover the **?** next to **Slack Channel**. Expect the new channel copy with
   the install's brand name, and a **Use a Slack connection →** link at the end of the second
   paragraph. Click it: the **Connection catalogue** opens over the create page.
3. On the **Apps** tab, hover the **?** next to **Slack**. Expect the new connection copy with
   "this agent". Click **Add a Slack channel →**: the catalogue closes, the page shows the
   **Slack Channel** row, focus is on its checkbox, and the checkbox is unticked.
4. Open an existing agent's **Channels** tab; hover the **?** on the **Slack Channel** card.
   Expect the same channel copy; the link switches to the **Connections** tab. There, open the
   catalogue; the Slack card's link switches back to **Channels**.
5. Open the global **Connections** page, open the catalogue, hover the Slack card's **?**.
   Expect "an agent" in both sentences and "Add a Slack channel" as grey text.
