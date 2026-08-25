# 08 — Architecture docs

**Depends on:** 01–07
**Part of:** live updates for pod-sourced state — see [README](./README.md)

## Context

Two architecture pages state the current polling as fact and become wrong the moment this feature lands. They are the agent-facing source of truth for these subsystems, so leaving them stale is worse than not writing them — and `doc-drift` would flag both. Follow [`docs/guidelines/documentation-guidelines.md`](../../guidelines/documentation-guidelines.md).

The ADR and the glossary are already done, in this branch's first commit: [ADR-084](../../adrs/084-pod-owned-live-updates.md) and the **Live Updates** section of [`docs/ubiquitous-language.md`](../../ubiquitous-language.md). Do not restate the ADR's reasoning in the architecture pages — the pages describe what the system *is*, the ADR carries why it was chosen.

## Implementation plan

1. **`docs/architecture/platform-topology.md`** — four places:
   - The **domain events and live updates** paragraph, which describes hints as projected from domain events by a saga. Extend it: an invalidation notice may now also originate in a pod, delivered over the agent's own tRPC surface, produced by a Watch that exists only while a subscriber is attached.
   - The **ui** section, which currently says "with pod-sourced reads (session status, in-pod file listings, runtime metrics) and an agent-reachability probe the remaining polls". After this feature the pod-sourced reads and the reachability probe are all gone; runtime metrics (60s, over the telemetry store, not pod-sourced) remain. Also update the description of the tab's ACP channels — a short-lived channel for the session list is no longer one of them.
   - The paragraph stating that a session's live turn status comes from `session/list` over ACP, and that read state rides the same metadata. The read moved to the pod's tRPC surface; the ownership claim (agent-owned) did not change.
   - The **Protocols** table: add the per-agent tRPC-over-WebSocket relay row, and correct the existing "In-pod file operations for the UI" HTTP row to reflect what still uses it.
2. **`docs/architecture/agent-lifecycle.md`** — two places:
   - The reachability paragraph, which says the `passive=1` opt-out exists for "the sessions-list status poll". That poll is gone; the new per-agent relay is a third policy (passive readiness, no pin, periodic stamp while open) and should be described as such, including that server-held streams stamp nothing.
   - The **hibernate** section's signals list, so the set of things that bump `last-activity` matches reality: the three existing relays, the deliberate lifecycle writes, and the new relay's periodic refresh — and no longer "every proxied call".
3. **Stamp `Last verified:`** at the top of both pages with the current date, per the documentation guidelines.
4. Check whether [`docs/architecture/persistence.md`](../../architecture/persistence.md) needs a touch — this feature adds no new substrate, so it probably does not. Confirm rather than assume.
5. Do **not** reference the ADR from the architecture pages. `CLAUDE.md` is explicit: never link or reference an ADR from code or documentation.
6. Run `mise run common:check:comment-types` (no code changes expected, but cheap) and any docs lint the repo has.

## Acceptance criteria

- [ ] Neither page claims the session list, file listings, or the open file are polled.
- [ ] Neither page mentions the agent-reachability probe as an existing mechanism.
- [ ] The Protocols table includes the new relay and no longer misdescribes the HTTP tRPC proxy's users.
- [ ] The hibernation signals list matches the actual writers of `last-activity` after this feature.
- [ ] `Last verified:` is current on both pages.
- [ ] No ADR is linked or referenced from either page.
- [ ] Running `/doc-drift` against this branch surfaces nothing for these two pages.

## Smoke test

Not a runtime change, so verification is review-shaped:

```
mise run check
```

Then run the `/doc-drift` skill against the branch diff and confirm it reports no drift for `platform-topology.md` or `agent-lifecycle.md`. Read both changed sections top to bottom once and check that a reader who knows nothing about this feature would come away with an accurate picture of how the surfaces refresh and what keeps an agent awake.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the user can confirm it by hand.
