# 05 — E2E: delivery feedback specs

**Depends on:** 04-ui-disconnect-failure-and-docs
**Part of:** Honest prompt delivery feedback — see [README](./README.md)

## Context

Automated regression coverage for the whole feature. The e2e agents run the scripted mock
harness (`packages/e2e/agents/mock`), which speaks real ACP to the real agent-runtime — so
prompt queueing, promotion, and the new lifecycle notifications are all the production code
paths. A script entry's `delayMs` makes turn duration fully controllable, which is what
makes the 60s-watchdog scenarios deterministic. This sub-issue is (with 02) the flagged
exception to the no-new-tests default: the tests *are* the deliverable.

## Implementation plan

All specs go to `packages/e2e/playwright/src/tests/full/` (the slow on-demand tier — three
of the four cross a 60s timer, ~4 minutes total). Build on the existing helpers in
`packages/e2e/playwright/src/lib/agents.ts` (`setMockAgentReply`, `chatInput`,
`readChatMessages`, `sendChatMessage`) and add a script helper for a long turn, e.g.
`setMockLongTurnReply(api, agentId, { head, holdMs, tail })` → entries
`[chunk head, {delayMs: holdMs, chunk tail}]`, `stopReason: "end_turn"`. Use the
`data-testid`s added in sub-issues 03/04 for the waiting indicator, failure indicator, and
Retry button.

1. **Spec: queued prompt survives a >60s turn** (the core #829 regression):
   script a ~75s turn, send prompt A, await its first chunk, send prompt B. Assert the
   waiting indicator appears within a couple of seconds, then assert the failure indicator
   never shows while the prior turn runs out (poll `not.toBeVisible` past the 60s mark),
   then both replies present in order.
2. **Spec: reattach mid-turn** (the literal issue repro): same script; `page.reload()`
   between prompt A and prompt B. Same assertions.
3. **Spec: disconnect while queued fails with Retry, and the failure survives reconnect**:
   script a long turn, queue prompt B, `context.setOffline(true)`, assert B's bubble shows
   the failure indicator with Retry; `setOffline(false)`, wait for the session to reconnect
   and replay, assert the failure indicator is *still* visible (the sub-issue 04 merge
   rule), click Retry, assert B's reply arrives.
4. **Spec: wedged agent still fails**: script `[{delayMs: 75_000, chunk}]` (prompt handed
   over, then silence), send a prompt to an idle session, assert the failure indicator
   appears at ~60s — the started→content watchdog's job.

Out of e2e scope, deliberately: the sending→accepted timeout (no way to make the runtime
accept a socket but stay mute from Playwright) — covered by sub-issue 02's runtime unit
tests.

Keep the specs flake-resistant: generous `expect.poll` timeouts above the 60s boundaries,
no fixed sleeps outside the scripted `delayMs`.

## Acceptance criteria

- [ ] Four specs exist under `src/tests/full/` and pass against the warm test cluster.
- [ ] Spec 1's "no failure indicator" assertion demonstrably fails on a build without the
      feature (verified once by running it against main's UI) — it guards the regression,
      not the happy path.
- [ ] The smoke tier (`src/tests/smoke/`) is untouched — no 60s waits in the always-on set.
- [ ] `mise run e2e-playwright:check` is green.

## Smoke test

`mise run e2e:loop --full` against the warm test cluster (see the `cluster-ops` skill for
cluster state issues) — the four new specs pass alongside the existing full suite.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
