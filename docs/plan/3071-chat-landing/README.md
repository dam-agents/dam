# Opening a sandbox in chat takes too many clicks

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issues:** https://github.com/dam-agents/dam/issues/3071 (the landing) and
https://github.com/dam-agents/dam/issues/3070 (reaching configuration from it) — the second
is the first's consequence, so they ship together.

## Goal

Clicking a sandbox opens it: one click from the Home list lands in chat, and a sleeping
sandbox starts on its own while the chat comes up. Chat stops being one option among four
behind a menu on a page you first pass through.

The other ways in are not lost — browser terminal, local terminal, and local editor move
into the new-session state, where they sit beside the message box. `+ New` opens a chat
session with no menu in the way. The sandbox configuration page stays reachable from the
chat header's ⋮ menu ("Configure sandbox").

## Approach

Everything here is `packages/ui`. No tRPC contract changes, no api-server or controller
work — the platform already supports all of it.

**Chat entry and wake.** [agent-lifecycle](../../architecture/agent-lifecycle.md#wake)
already wakes a hibernated Agent on a connect-driven frame, so the platform never needed an
explicit Start. Requiring one is a UI policy: `AgentUnavailableOverlay` gates the chat
whenever `useIsAgentOperable` is false and offers a Start button. We keep the overlay (it
still reports lifecycle state) and simply fire the same wake mutation the button fires,
once, whenever chat opens on a hibernated sandbox.

The rule is **per chat entry, not per entry point**: a card click, a followed session link,
a deep link, and back/forward all behave the same. Two states are deliberately excluded and
still need a deliberate click:

- `over_budget` (parked) — Start *is* the retry through the budget gate ([budgets](../../architecture/budgets.md)). Auto-retrying would hammer a gate that just refused.
- `error` — the action there is Restart, and an error the user hasn't seen should not be papered over.

**Launch options.** The two "Open in" dialogs (local terminal, local editor) are pure copy
around a `CopyableCommand`, already keyed on the agent id. They move out of
`open-in-menu.tsx` into their own module-level component so the chat empty state can open
them; the menu itself, and its "Chat (browser)" item, cease to have a purpose and go.

**Reaching configuration.** Making chat the landing takes away the page a row click used to
open, so #3070 rides along: the chat header's ⋮ stops hiding until hover, and the list row's own
⋮ gains a "Configure sandbox" item. Nothing becomes unreachable — it moves one click.

**Surfaces.** The knowledge-base chat (`view === "knowledge-base-chat"`) does not get the
launcher row — that surface speaks in knowledge-base terms and the dialogs speak about a
sandbox. Experiments and knowledge-base rows already open chat directly
(`selectAgent` / `openKnowledgeBase`), so only the Sandboxes list needs changing for
consistency across the three.

**Known collision.** PR #3241 rewrites the same empty-state region of
`modules/sessions/views/chat-view.tsx`. This branch is cut from `main`; whichever lands
second resolves the conflict.

## Sub-issues

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | [Sandbox rows open chat and start a sleeping sandbox](./01-rows-open-chat.md) | Home row click → chat; auto-wake on chat entry; e2e helper | — | ✅ |
| 02 | [Launch options in the new-session state](./02-launch-options.md) | extract the Open-in dialogs; launcher row in the empty chat; drop the menu from the config header | 01 | ✅ |
| 03 | [`+ New` opens a chat session directly](./03-new-opens-chat.md) | sessions sidebar dropdown → plain button | 02 | ✅ |
| 04 | [Configuration is visible in chat and reachable from the list](./04-configuration-discoverable.md) | #3070: always-visible chat ⋮; "Configure sandbox" on the row menu | 01 | |

Order between 02 and 03 is load-bearing: 02 lands the "Terminal (browser)" button before 03
removes the menu item that is currently the only route to a browser terminal. 04 only needs
01, so it can land any time after it.

**Considered and dropped: opening the last conversation on entry.** The landing is where the
alternative ways into a sandbox live (slice 02) — terminal and editor sit in the new-session
state, and that state only exists while the chat is empty. Resuming a conversation on entry
would hide them behind a `+ New` click on every return visit, defeating the scope item that put
them there. The session list in the sidebar is already one click from the same conversation.

A second reason, had the first not settled it: on a sleeping sandbox — the common case for one
you are returning to — the sessions list is a passive read that fails closed while the pod is
down ([agent-lifecycle](../../architecture/agent-lifecycle.md#wake)), so the landing cannot know
whether a conversation exists, let alone which, until the wake finishes. Both a silent
auto-resume and a reserved `/chat/<sandbox>/latest` route were worked through and rejected on
these grounds.

## Design references

Jenna's mockups, copied into [`screens/`](./screens/) so they survive the branch:

| File | What it shows |
|---|---|
| `DAM.png` | Sandboxes (Home) list — the rows whose click behavior changes in 01 |
| `DAM-1.png` | New-session state: heading, subtitle, the three launch buttons; sidebar `+ New` as a plain button |
| `DAM-5.png` | Same, pointer on **Terminal (browser)** |
| `DAM-7.png` | Same, pointer on **Terminal (local)** |
| `DAM-2.png` | Same, pointer on **Vs Code / Zed (local)** |
| `DAM-4.png` | **Open in Terminal** dialog — `dam chat <sandbox>` plus the CLI quickstart note |
| `DAM-3.png` | **Open in Vs Code / Zed (local)** dialog — the two `dam ssh connect -x …` commands |
| `DAM-6.png` | Chat pane with the centre block absent (transitional frame) — no behavior of its own |

Two deliberate divergences from the mockups: the heading reads **"Start a new session"**
(the mockup's "Start a new sessions" is a typo), and the editor dialog title uses the
product's own casing, **"Open in VS Code / Zed"**.

## Conventions & glossary

- Apply the [`react-ui-engineering`](../../../.claude/skills/react-ui-engineering/SKILL.md) skill throughout. No server-side TS is touched.
- Icons come from `@carbon/icons-react`.
- Run tasks through `mise run` only — `mise run ui:check`, `mise run ui:test`, `mise run ui:fix`. Add `--force` to bypass mise's task cache.
- Do not author new tests. Verification leans on the existing suite plus the manual smoke test in each slice.
- **Sandbox** is the user-facing name for an Agent. **Parked** = `over_budget`: it wants to run but its owner is over budget.

## Whole-feature smoke test

Against the Vite dev server (`localhost:5173`) — never a cluster deploy:

1. From Home, click a **hibernating** sandbox row. It lands on `/chat/<id>`, the overlay
   reads "Starting", and the chat comes up without any further click.
2. The empty chat reads "Start a new session" and offers Terminal (browser),
   Terminal (local), Vs Code / Zed (local). The two local ones open dialogs with copyable
   commands; the browser one opens a terminal in the chat pane.
3. `+ New` in the sessions sidebar opens a blank chat immediately — no menu.
4. The chat header ⋮ is visible without hovering, and "Configure sandbox" reaches the config
   page, whose header offers a single "Open in chat" button in place of the old menu.
5. A Home row's ⋮ also offers "Configure sandbox"; a knowledge-base row's says
   "Configure knowledge base".
6. An **over-budget** sandbox still shows the parked overlay with its Start button — it does
   not retry the gate by itself.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR closing
[#3071](https://github.com/dam-agents/dam/issues/3071) and
[#3070](https://github.com/dam-agents/dam/issues/3070).
