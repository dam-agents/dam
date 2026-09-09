# Always-on — the never-hibernate setting made discoverable

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/dam/issues/3477 (wording: #3541)

## Goal

The never-hibernate option becomes a named choice a user can find. The Lifecycle setting turns
from a numeric timeout into two options — **Hibernate when idle** (editable inactivity window)
and **Always on** — offered on the Configure page, in the agent creation flow, and on the
startup wait screen ("Skip the wait — keep always-on"). The Compute Resources graph hover shows
when an agent is always-on and links to where it is changed.

## Approach

Pure UI feature. The wire contract stays `hibernationTimeoutMin: number` with `0` = always-on:
the api-server already accepts it on create and update, and `AgentView.hibernationTimeoutMin`
already carries the effective value. The UI stops exposing the magic zero and instead renders a
two-option card selector (`LifecycleField`), shared by Configure and the create flow.

Architecture background: [`agent-lifecycle.md`](../../architecture/agent-lifecycle.md)
(hibernation, never-hibernate semantics) and [`budgets.md`](../../architecture/budgets.md)
(always-on holds Reserved compute; never reclaimed by the budget gate, auto-retries a parked
start). Nothing but deliberate user action ends always-on, so the option copy can promise that.

Design: dev-ready Figma frames on the issue (canvas `2251-2`). Copy comes from **#3541's
approved proposal**, which supersedes the frame text:

- **Hibernate when idle** — "Requires time to start. Frees compute when not in use."
- **Always on** — "Instant response (never idles). Always reserves compute."

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Lifecycle option cards on Configure | Shared `LifecycleField`, replaces `HibernationTimeoutField` in Agent Setup | — |
| 02 | Lifecycle in the create flow | Section in coding-agent setup view; create input carries the choice | 01 |
| 03 | Skip the wait on the startup screen | Button on the startup overlay sets always-on | — |
| 04 | Always-on hover in Compute Resources | Segment hover card with always-on line and Manage link | — |

## Conventions & glossary

- Apply the `/react-ui-engineering` skill — all work is in `packages/ui`.
- **Always-on** = `hibernationTimeoutMin === 0` (effective value; an override of `0` or an
  inherited install default of `0s` both count).
- The lifecycle choice always submits the displayed value: picking Hibernate with 60 sends an
  explicit `60`-minute override, never "unset, inherit the install default". WYSIWYG beats a
  hidden inherit.
- Icons: Carbon `Time` (hibernate) and `Power` (always on) from `@carbon/icons-react`.
- Checks: `mise run //packages/ui:check`, `mise run //packages/ui:test`,
  `mise run //packages/ui:fix` after edits.

## Out of scope

- The always-on power icon on the Working/Idle status tag: the issue requires it on the **new**
  tag from #3526, which has not landed. It moves to #3526's scope or a follow-up.
- Hibernation mechanics, power menu wording (#3059), the status tag redesign (#3526).
- The inline create form used by the Slack/Telegram bind flows keeps today's behavior.

## Whole-feature smoke test

Against the dev cluster with the Vite dev server (`localhost:5173`):

1. Create a coding agent picking **Always on** → its Configure page shows Always on selected;
   `agent.hibernationTimeoutMin` is `0` (power menu Pause is disabled, from #3059).
2. Switch it to **Hibernate when idle**, window 30 → save succeeds, field shows 30 after reload.
3. Create a second agent leaving the default (Hibernate, 60), open its chat while it starts →
   the wait screen offers **Skip the wait — keep always-on**; clicking it flips the agent to
   always-on and the button disappears.
4. On Home, hover the always-on agent's segment in Compute resources → the card names the
   agent, shows its size, says it is always-on, and **Manage** navigates to its Agent Setup.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/dam/issues/3477.
