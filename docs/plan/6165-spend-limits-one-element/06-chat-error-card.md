# 06 — Chat error card

**Depends on:** 01-black-meter-and-usage-list
**Part of:** Spend and limits read as one thing — see [README](./README.md)

## Context

When a limit refuses a call, the chat already shows the "Spend limit reached" error card.
For the owner, its message ends with "Raise your spend limit" instead of "Continue it on Home", and its hint line holds two links that open the agent's Usage at the list of limits (built in 01) instead of the raw error.

## Implementation plan

Apply `/react-ui-engineering`.

1. **Copy.** In `packages/ui/src/modules/acp/errors.ts` → `describeSpendRefusal`, the owner's message for a limit becomes `${stopped} Raise your spend limit, or wait until ${reset} your time.`.
   The ceiling's and the editor's messages stay as they are.
   Give the description a marker for the limit links (e.g. `kind: "spend-limit"`) instead of `hint: "Details: …"`, for the owner's limit refusal only; the editor and the ceiling keep their `Details:` hint.
2. **Links.** In `sessions/components/send-error-card.tsx`, for that kind and with an `agentId`, the hint line renders two buttons, "Change the limit" · "See what it counts", in reading order after the message, styled `text-accent underline underline-offset-2` with `FOCUS_RING`.
   Both call `openAgentSettings(agentId, "usage")` and then bring `#agent-limits` (slice 01) into view.
3. **Scroll target.** Extend the agent settings slice (`modules/sandboxes/store.ts`) with an optional focus target (`openAgentSettings(agentId, section, { focus: "agent-limits" })`), and in the Usage section (`metrics/components/sandbox-usage-section.tsx` or the limit card) scroll the element with that id into view (`block: "start"`) once it renders, then clear the target.
   Keep the change small: the existing `section` handling stays, and other callers are untouched.
4. **Docs.** `docs/architecture/spend-limits.md` → **Screens**: the chat refusal sentence ("the harness's own error text stays below it as detail") now says the owner's card links to the agent's limits.

## Acceptance criteria

- [ ] The owner's refusal reads "Spend limit reached: This agent reached a daily spend limit, so its model calls stop.
  Raise your spend limit, or wait until <time> your time."
- [ ] The editor's and the ceiling's cards keep today's words and hint.
- [ ] Pressing either link opens the agent's settings on Usage with the limits list in view; both links are keyboard-reachable with a visible focus ring.
- [ ] `spend-refusal-copy.test.ts`, `send-error.test.ts` and `send-error-card.test.ts` are updated; UI checks and tests pass.

## Smoke test

`mise run //packages/ui:test`.
Manually: hit a $0.01 agent limit in the chat, read the new card, press "See what it counts" and land on Usage with the limits list visible.
