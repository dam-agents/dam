# Slack/Telegram Discoverability — Open Design Decisions

Items below are decisions that need a designer's call. None were taken in code — the prototype builds what was reviewed (part 1) and proposes the rest (parts 2–3) as specified in the prompt.

---

## 1. Two ambient strings promise a channel notification the platform doesn't send

**Priority: high — factual error in shipped copy.**

Three strings in `packages/ui` disagree on whether Slack is notified when ambient mode changes:

| Where | What it says |
|---|---|
| Reviewed ambient-on copy (modal §1.4) | "The channel is told, and you can turn this off anytime." |
| `slack-channel-modal.tsx` (shipped) | "The channel is notified when this changes…" |
| `slack-ambient-offer.tsx` (shipped) | "Nobody in the channel is told, so tell them yourself." |

`docs/architecture/channels.md` line 32 is unambiguous and the third one is right: the platform does **not** announce ambient status changes in the channel. The reviewed copy and the shipped modal both promise a notification the platform doesn't send.

**Decision needed:** If the answer is that the platform *should* announce it, that's a server change and a different ticket. If not, the two incorrect strings need rewording.

---

## 2. `Destination` becomes a set, with "In DAM" as the exclusive no-messenger option

`Destination = "platform" | "slack"` was a single choice with no Telegram option. The prototype changes it to `"platform" | "slack" | "telegram"` where:
- "In the platform" is the no-messenger default (exclusive — selecting it deselects messengers)
- Selecting a messenger deselects "In the platform"
- Both messengers can be selected simultaneously

**Decision needed:** Confirm "In DAM" is mutually exclusive with messengers.

---

## 3. Telegram gated on `availableChannels.telegram` separately

`DestinationSection` returns `null` when neither messenger is configured. Each card gates on its own `slackAvailable` / `telegramAvailable` prop. Today `list-view.tsx` and `coding-agent-setup-view.tsx` read **only** `.slack`.

**Decision needed:** Confirm each card should gate independently.

---

## 4. Setup page per-messenger step callouts dropped when modals teach the steps

With both messengers selected, three callouts × two messengers is six blocks under the fork. The modals now teach the steps, so the setup page repeating them is the same procedure stated twice.

**Decision needed:** Confirm the setup page should not duplicate the modal's step-by-step instructions.

---

## 5. `channel-intent.ts` generalised to cover Telegram, and the Telegram card given a checklist

`channel-intent.ts` was Slack-specific (`platform-slack-channel-intent`). The prototype generalises it to take a channel kind. The Telegram card would get the same checklist treatment as the Slack card.

**Decision needed:** Confirm Telegram should have a post-create checklist like Slack's.

---

## 6. The `Add to Slack Channel` / `Add to Telegram Chat` title casing is the designer's

All 22 uses of "Slack channel" in `packages/ui` are lowercase-c. The modal title "Add to Slack Channel" is the outlier. Built as written — it was reviewed.

**Decision needed:** Confirm or down-case.

---

## 7. The bind-landed promise has no mechanism behind it

"This updates as soon as the channel is added" is in the reviewed copy. It is not currently true:
- `live-hints.ts` maps `EventType.SlackConnected` → `null` (event suppressed)
- No Telegram bind domain event exists
- `useAgents()` has `staleTime: 5000` with no `refetchInterval`

The modal refreshes when the tab regains focus, which happens to work for the tab-to-Slack-and-back path. It is not live.

**Decision needed:** Either add `slack`/`telegram` to the live-events topic map, add a `refetchInterval` while a bind is pending, or change the copy. Owned by Petr Kadlec or Petr Bulanek.

---

## 8. The shared-access fact is missing from the non-create entry points

"Everyone in the channel can drive this, under the agent's own credentials" is stated three times on the create path. It is stated **nowhere** in the two entry points that don't go through create:
- The agents-list row overflow menu
- The Channels tab

This is a consequence of the `WhatThisGrants` paragraph being cut on review. The same hole will exist for Telegram the moment its modal has a second entry point.

**Decision needed:** Where and how to surface the shared-access fact outside the create flow.

---

## 9. All of part 2 (Telegram) and part 3 (Both) are unreviewed proposals

Part 1 (Slack) is built from the reviewed design. Parts 2 and 3 are proposals based on Telegram's constraints (no UI-driven bind, admin-only gate, no ambient mode, link expiry). They need design review before shipping.

**Key Telegram constraints:**
- No "Add it with a channel ID" shortcut — binding must start from Telegram
- Group admins only can run `/dam bind`
- No ambient mode (Slack-only, per architecture docs)
- The bind link expires in ~10 minutes

---

## Implementation notes

- The reviewed flow walks on an **experiment** agent (`cache-tuning`), not a coding agent.
- `DestinationSection` was added to all three setup views (coding, experiment, knowledge base).
- The `ChannelsSection` (selectable cards from earlier iteration) was replaced by `DestinationSection`.
- `BindWalkthrough` is the shared component for the 3-step instructions, used by the modal and intended for the Channels tab card and agents-list overflow menu.
